import type { DepotRole } from "../economy";
import { checkPlacement, FEAT_BUILDING, FEAT_DEPOT, FEAT_FIELD, FEAT_SHED, FEAT_STATION, hillsOf, isWater, onFixedSite, SURF_LANE, SURF_ROAD, SURF_TOWN, type Landscape } from "../landscape";
import { footprintCorners, footprintsOverlap, inFootprint, scaleFootprint, standsAside, type Footprint } from "../props/placement";
import type { PropStore } from "../props/store";
import { DEPOT_LAYOUT } from "../render/depot-view";
import { createSample, findOverlap, findSplice, getPieceDef, ignores, isPlainStraight, kitOf, straightLength, normalizeAngle, pathLength, samplePath, TRAIN_CLEARANCE, type Ignore, type KitDef, type Layout, type PieceTypeId, type Pose } from "../track";
import { DEPOT_NAMES, INDUSTRY_ROLE, type World } from "./world";

/**
 * Room for a depot's yard: a depot piece (the workshop, sawmill, harbour and the rest) is its track plus a yard beside
 * it, on its +l side (depot coordinates, as `DEPOT_LAYOUT` lays them out: t along the track from its socket end, l
 * across), where its buildings, piles and crane stand. The track is checked as track is; this checks the rest:
 * clear of raised ground, water (but a harbour's quay side), town buildings, fields, roads, props, other track, and
 * other depots' yards.
 *
 * A depot can't mirror (Flip turns it right round), so its yard is on the +l side however it's placed.
 *
 * Kit pieces (src/track/kits.ts) have a footprint too, their `footprint` rectangles in the same frame: the same checks,
 * the refusals named after the kit ("The platform needs open ground", "That's the platform"). Everything here takes a
 * piece type and finds its footprint source (a depot's role, or a kit) once per type: see `shapeFor`.
 */

/**
 * Why a depot's yard can't go somewhere: something on the ground there, a hill, or water; "crane-…" when only a
 * gantry crane's legs are in the way (the yard itself is clear).
 */
export type YardBlock = "yard-ground" | "yard-hill" | "yard-water" | "crane-ground" | "crane-hill" | "crane-water";

/** Is this a refusal for want of room for a depot's yard (or its crane's legs)? */
export const isYardBlock = (reason: string | null): reason is YardBlock => !!reason && (reason.startsWith("yard-") || reason.startsWith("crane-"));

/** A part of a depot's footprint beside its track (depot frame: Footprint's x is t, its z is l). */
interface YardPart extends Footprint {
  /** A gantry crane's leg (not the yard pad). */
  readonly crane: boolean;
  /** A leg on the far side of the line: only the ground and props are checked there, not other track. */
  readonly post: boolean;
}

interface YardShape {
  readonly parts: readonly YardPart[];
  /** Sample points over the parts (t, l pairs), edges included: the pad's first, then the crane's legs'. */
  readonly samples: Float64Array;
  /** Of each sample, is it a crane leg's (1) or the yard pad's (0)? */
  readonly legs: Uint8Array;
  /** Water may lie beyond this l (a harbour's quay side); Infinity: nowhere. */
  readonly wetFrom: number;
  /** Furthest any part reaches from the piece's origin (mm), for broad phases. */
  readonly reach: number;
}

/** Sample spacing over a yard (mm): under a quarter square, so a hill block's rounded corner can't slip between. */
const STEP = 12;
/** Samples stand this far in from the edges (mm), so ground that only meets the yard's edge leaves it clear. */
const INSET = 2;
/** A gantry's legs stand this far either side of its beam's middle (see depot-view). */
const GANTRY_HALF = 70;
const LEG = 3;
/** Ground this much over the track's base (mm) is a hill in the yard's way. */
const HILL_SLACK = 0.5;
/** A harbour's quay is over the water's edge: water only matters on the yard's near part. */
const HARBOUR_DRY = 84;
/** Other track this close to the yard (mm: its discs' radius, as in `findOverlap`) runs through it. */
const TRACK_RADIUS = 14;
/** Other track this far above or below the depot's base (mm) passes clear of its yard: two levels. */
const HEADROOM = TRAIN_CLEARANCE;

const shapes = new Map<DepotRole, YardShape | null>();

/** A depot role's footprint beside its track (worked out once per role: it doesn't change). */
function shapeOf(role: DepotRole): YardShape | null {
  let s = shapes.get(role);
  if (s !== undefined) return s;
  const layout = DEPOT_LAYOUT[role];
  const parts: YardPart[] = [];
  if (layout.pad) parts.push({ cx: layout.pad.t, cz: layout.pad.l, hw: layout.pad.w / 2, hd: layout.pad.d / 2, crane: false, post: false });
  if (layout.crane.kind === "gantry") {
    for (const l of [layout.crane.l - GANTRY_HALF, layout.crane.l + GANTRY_HALF]) parts.push({ cx: layout.crane.t, cz: l, hw: LEG, hd: LEG, crane: true, post: l < 0 });
  }
  s = shapeFrom(parts, role === "harbour" ? HARBOUR_DRY : Infinity);
  shapes.set(role, s);
  return s;
}

/** A kit's footprint beside its track: its rectangles, all of them pad (checked against everything). */
function kitShape(kit: KitDef): YardShape | null {
  return shapeFrom(
    kit.footprint.map((r) => ({ cx: r.t, cz: r.l, hw: r.w / 2, hd: r.d / 2, crane: false, post: false })),
    Infinity,
  );
}

/** Footprints by piece type: a depot's yard, a kit's ground, or null (read on every move: one map lookup). */
const typeShapes = new Map<PieceTypeId, YardShape | null>();

/** The footprint source of a piece type (a depot's role, or a kit), worked out once per type. */
function shapeFor(type: PieceTypeId): YardShape | null {
  let s = typeShapes.get(type);
  if (s !== undefined) return s;
  const role = INDUSTRY_ROLE[type];
  const kit = role ? undefined : kitOf(type);
  s = role ? shapeOf(role) : kit ? kitShape(kit) : null;
  typeShapes.set(type, s);
  return s;
}

/** Does this piece type have a footprint beside its track (a depot's yard, a kit's ground)? */
export const hasFootprint = (type: PieceTypeId): boolean => shapeFor(type) !== null;

/** Sample points over a footprint's parts, and how far it reaches; null for no parts. */
function shapeFrom(parts: YardPart[], wetFrom: number): YardShape | null {
  if (parts.length === 0) return null;
  const pts: number[] = [];
  const legs: number[] = [];
  let reach = 0;
  for (const p of parts) {
    const t0 = p.cx - p.hw + INSET;
    const l0 = p.cz - p.hd + INSET;
    const w = Math.max(0, 2 * (p.hw - INSET));
    const d = Math.max(0, 2 * (p.hd - INSET));
    const nt = Math.max(1, Math.ceil(w / STEP));
    const nl = Math.max(1, Math.ceil(d / STEP));
    for (let i = 0; i <= nt; i++) {
      for (let k = 0; k <= nl; k++) {
        pts.push(t0 + (w * i) / nt, l0 + (d * k) / nl);
        legs.push(p.crane ? 1 : 0);
      }
    }
    reach = Math.max(reach, Math.hypot(Math.abs(p.cx) + p.hw, Math.abs(p.cz) + p.hd));
  }
  return { parts, samples: Float64Array.from(pts), legs: Uint8Array.from(legs), wetFrom, reach };
}

/** A depot or kit piece's footprint beside its track (its own frame), or null if it has none. */
export function yardParts(type: PieceTypeId): readonly Footprint[] | null {
  return shapeFor(type)?.parts ?? null;
}

/** What the yard check reads of a piece type, in its own frame: its track's sample points, how far they reach, and its yard. */
interface PieceShape {
  /** Track sample points (x, z, track height triples). */
  readonly track: Float64Array;
  /** Furthest the track or yard reaches from the piece's origin (mm), for broad phases. */
  readonly reach: number;
  readonly yard: YardShape | null;
}

/** Per piece type, unflipped and flipped (read for every piece on every move while a depot is held: no string keys). */
const pieceShapes = new Map<PieceTypeId, [PieceShape | undefined, PieceShape | undefined]>();
const sample = createSample();
function pieceShape(type: PieceTypeId, flipped: boolean): PieceShape {
  let both = pieceShapes.get(type);
  if (!both) pieceShapes.set(type, (both = [undefined, undefined]));
  const k = flipped ? 1 : 0;
  const known = both[k];
  if (known) return known;
  const def = getPieceDef(type, flipped);
  const pts: number[] = [];
  // A riser: its block.
  if (def.paths.length === 0) for (const [x, z] of [[0, 0], [14, 14], [14, -14], [-14, 14], [-14, -14]]) pts.push(x, z, 0);
  for (const path of type === "joiner" ? [] : def.paths) {
    const len = pathLength(path.geom);
    const n = Math.max(1, Math.ceil(len / STEP));
    for (let i = 0; i <= n; i++) {
      samplePath(path.geom, (len * i) / n, sample);
      pts.push(sample.x, sample.z, sample.y);
    }
  }
  const yard = shapeFor(type);
  let reach = yard?.reach ?? 0;
  for (let i = 0; i < pts.length; i += 3) reach = Math.max(reach, Math.hypot(pts[i], pts[i + 1]));
  const shape: PieceShape = { track: Float64Array.from(pts), reach, yard };
  both[k] = shape;
  return shape;
}

export interface YardCheck {
  land: Landscape;
  layout: Layout;
  props: PropStore;
  /** Footprints of props' models built so far (a prop whose model isn't built yet doesn't block). */
  footprint(asset: string): Footprint | undefined;
}

/**
 * Is there room for the yard of a depot piece at `pose` (track base at `y`)? Null when there is (or it isn't a depot
 * piece), else why not. `ignore` leaves out the piece being moved and any straights it takes the place of. Called on
 * every pointer move while a depot is held: about a hundred squares looked up, and a pass over the pieces nearby.
 */
export function checkYard(ctx: YardCheck, type: PieceTypeId, pose: Pose, y: number, ignore: Ignore): YardBlock | null {
  const shape = shapeFor(type);
  if (!shape) return null;
  const hills = hillsOf(ctx.land.grid);
  const c = Math.cos(pose.heading);
  const s = Math.sin(pose.heading);
  const pts = shape.samples;
  // The pad's samples come first: what's wrong there is said first; the crane's legs only if the pad is clear.
  let legs: "ground" | "hill" | "water" | null = null;
  for (let i = 0, k = 0; i < pts.length && !legs; i += 2, k++) {
    const t = pts[i];
    const l = pts[i + 1];
    const why = groundWhy(ctx.land, hills, pose.x + t * c - l * s, pose.z + t * s + l * c, y, l >= shape.wetFrom);
    if (!why) continue;
    if (shape.legs[k] === 0) return `yard-${why}`;
    legs = why;
  }
  if (propsInYard(ctx, shape, pose, false) || piecesInYard(ctx.layout, type, shape, pose, y, ignore, false)) return "yard-ground";
  if (legs) return `crane-${legs}`;
  return propsInYard(ctx, shape, pose, true) || piecesInYard(ctx.layout, type, shape, pose, y, ignore, true) ? "crane-ground" : null;
}

/** What's wrong with the ground at a point of a yard: something stands there, it's a hill, or water (unless `wet` may be). */
function groundWhy(land: Landscape, hills: ReturnType<typeof hillsOf>, x: number, z: number, y: number, wet: boolean): "ground" | "hill" | "water" | null {
  const g = land.grid;
  const cell = g.cellAtWorld(x, z);
  if (cell === -1) return "ground";
  const f = g.feature[cell];
  if (f === FEAT_BUILDING || f === FEAT_SHED || f === FEAT_FIELD) return "ground";
  if ((f === FEAT_STATION || f === FEAT_DEPOT) && onFixedSite(land, cell, x, z)) return "ground";
  const surface = g.surface[cell];
  if (isWater(surface)) {
    if (!wet) return "water";
  } else if (surface === SURF_TOWN || surface === SURF_ROAD || surface === SURF_LANE || g.road[cell] !== 0) return "ground";
  return hills.groundAt(x, z) > y + HILL_SLACK ? "hill" : null;
}

/** Does a prop stand on the yard pad (or, with `crane`, under the crane's legs)? */
function propsInYard(ctx: YardCheck, shape: YardShape, pose: Pose, crane: boolean): boolean {
  if (ctx.props.size === 0) return false;
  for (const prop of ctx.props.all()) {
    // (A crossing prop stands on its crossing's track: it's the crossing's look, not in anything's way.)
    const fp = standsAside(prop.asset) ? undefined : scaleFootprint(ctx.footprint(prop.asset), prop.scale);
    if (!fp) continue;
    if (Math.hypot(prop.x - pose.x, prop.z - pose.z) > shape.reach + Math.hypot(Math.abs(fp.cx) + fp.hw, Math.abs(fp.cz) + fp.hd)) continue;
    for (const part of shape.parts) if (part.crane === crane && footprintsOverlap(part, pose, fp, prop)) return true;
  }
  return false;
}

/** Does other track run through the yard, or another depot's yard overlap it (or this one's track run through that)? */
function piecesInYard(layout: Layout, type: PieceTypeId, shape: YardShape, pose: Pose, y: number, ignore: Ignore, crane: boolean): boolean {
  if (crane && !shape.parts.some((p) => p.crane && !p.post)) return false;
  const me = pieceShape(type, false);
  const c = Math.cos(pose.heading);
  const s = Math.sin(pose.heading);
  for (const id of layout.pieceIds()) {
    if (ignores(ignore, id) || layout.isLifted(id)) continue;
    const other = layout.getPiece(id)!;
    if (Math.abs(other.y - y) >= HEADROOM) continue;
    const them = pieceShape(other.type, other.flipped);
    const dx = other.pose.x - pose.x;
    const dz = other.pose.z - pose.z;
    const near = me.reach + them.reach + TRACK_RADIUS;
    if (dx * dx + dz * dz > near * near) continue;
    const theirs = them.yard;
    // Their track through my yard.
    const pts = them.track;
    const oc = Math.cos(other.pose.heading);
    const os = Math.sin(other.pose.heading);
    for (let i = 0; i < pts.length; i += 3) {
      if (Math.abs(other.y + pts[i + 2] - y) >= HEADROOM) continue;
      const x = other.pose.x + pts[i] * oc - pts[i + 1] * os;
      const z = other.pose.z + pts[i] * os + pts[i + 1] * oc;
      for (const part of shape.parts) if (part.crane === crane && !part.post && inFootprint(part, pose, x, z, TRACK_RADIUS)) return true;
    }
    if (!theirs) continue;
    // Their yard and mine; my track through their yard.
    for (const a of shape.parts) if (a.crane === crane) for (const b of theirs.parts) if (footprintsOverlap(a, pose, b, other.pose)) return true;
    // (My track through their yard is said once, with the pad.)
    if (crane) continue;
    const mine = me.track;
    for (let i = 0; i < mine.length; i += 3) {
      const x = pose.x + mine[i] * c - mine[i + 1] * s;
      const z = pose.z + mine[i] * s + mine[i + 1] * c;
      for (const b of theirs.parts) if (!b.post && inFootprint(b, other.pose, x, z, TRACK_RADIUS)) return true;
    }
  }
  return false;
}

/** What a depot's yard is called in messages: "The workshop's yard", or just "The forest yard". */
function yardName(role: DepotRole): string {
  const name = role === "town" ? "station" : DEPOT_NAMES[role].toLowerCase();
  return name.endsWith("yard") ? `The ${name}` : `The ${name}'s yard`;
}

/** What a refused piece in town is told: "Keep the track out of town", or for a depot "Keep the workshop out of town". */
export function townMessage(type: PieceTypeId): string {
  const role = INDUSTRY_ROLE[type];
  const name = role ? (role === "town" ? "station" : DEPOT_NAMES[role].toLowerCase()) : (kitOf(type)?.name ?? "track");
  return `Keep the ${name} out of town`;
}

/** The message for a yard that can't go somewhere ("The workshop's yard is on a hill"). */
export function yardMessage(type: PieceTypeId, why: YardBlock): string {
  if (why === "crane-hill") return "The crane's legs are on a hill";
  if (why === "crane-water") return "The crane's legs are in the water";
  if (why === "crane-ground") return "The crane's legs need open ground";
  const role = INDUSTRY_ROLE[type];
  const kit = role ? undefined : kitOf(type);
  const yard = role ? yardName(role) : kit ? `The ${kit.name}` : "The yard";
  if (why === "yard-hill") return `${yard} is on a hill`;
  if (why === "yard-water") return `${yard} is in the water`;
  return `${yard} needs open ground`;
}

/** A player's depot as placed, with its yard's world bounding box: for keeping other things out of its yard. */
export interface PlacedYard {
  readonly pieceId: number;
  readonly type: PieceTypeId;
  readonly pose: Pose;
  readonly y: number;
  readonly parts: readonly YardPart[];
  readonly x0: number;
  readonly z0: number;
  readonly x1: number;
  readonly z1: number;
}

/** A depot piece's yard where it stands (null if it isn't a depot piece with one). */
export function placedYard(pieceId: number, type: PieceTypeId, pose: Pose, y: number): PlacedYard | null {
  const shape = shapeFor(type);
  if (!shape) return null;
  let [x0, z0, x1, z1] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const part of shape.parts) {
    const c = footprintCorners(part, pose);
    for (let i = 0; i < 8; i += 2) {
      x0 = Math.min(x0, c[i]);
      x1 = Math.max(x1, c[i]);
      z0 = Math.min(z0, c[i + 1]);
      z1 = Math.max(z1, c[i + 1]);
    }
  }
  return { pieceId, type, pose: { ...pose }, y, parts: shape.parts, x0, z0, x1, z1 };
}

/**
 * The placed yard a piece's track would run into (its pad, or a crane leg on the yard's side), or null. Bounding boxes
 * first: cheap on every pointer move (the player's depots are few).
 */
export function trackInYards(yards: readonly PlacedYard[], type: PieceTypeId, flipped: boolean, pose: Pose, y: number, ignore: Ignore): PlacedYard | null {
  if (yards.length === 0) return null;
  const me = pieceShape(type, flipped);
  const r = me.reach + TRACK_RADIUS;
  let c = NaN;
  let s = NaN;
  for (const yard of yards) {
    if (ignores(ignore, yard.pieceId) || Math.abs(yard.y - y) >= HEADROOM) continue;
    if (pose.x + r < yard.x0 || pose.x - r > yard.x1 || pose.z + r < yard.z0 || pose.z - r > yard.z1) continue;
    if (Number.isNaN(c)) {
      c = Math.cos(pose.heading);
      s = Math.sin(pose.heading);
    }
    const pts = me.track;
    for (let i = 0; i < pts.length; i += 3) {
      if (Math.abs(y + pts[i + 2] - yard.y) >= HEADROOM) continue;
      const x = pose.x + pts[i] * c - pts[i + 1] * s;
      const z = pose.z + pts[i] * s + pts[i + 1] * c;
      if (x < yard.x0 - TRACK_RADIUS || x > yard.x1 + TRACK_RADIUS || z < yard.z0 - TRACK_RADIUS || z > yard.z1 + TRACK_RADIUS) continue;
      for (const part of yard.parts) if (!part.post && inFootprint(part, yard.pose, x, z, TRACK_RADIUS)) return yard;
    }
  }
  return null;
}

/** The placed yard a prop's footprint at `pose` would stand on (its pad or a crane leg), or null. */
export function footprintInYards(yards: readonly PlacedYard[], fp: Footprint, pose: Pick<Pose, "x" | "z" | "heading">): PlacedYard | null {
  if (yards.length === 0) return null;
  const c = footprintCorners(fp, pose);
  const x0 = Math.min(c[0], c[2], c[4], c[6]);
  const x1 = Math.max(c[0], c[2], c[4], c[6]);
  const z0 = Math.min(c[1], c[3], c[5], c[7]);
  const z1 = Math.max(c[1], c[3], c[5], c[7]);
  for (const yard of yards) {
    if (x1 <= yard.x0 || x0 >= yard.x1 || z1 <= yard.z0 || z0 >= yard.z1) continue;
    for (const part of yard.parts) if (footprintsOverlap(part, yard.pose, fp, pose)) return yard;
  }
  return null;
}

/** What to say when something would go in a player depot's yard ("That's the workshop's yard"). */
export function inYardMessage(type: PieceTypeId): string {
  const role = INDUSTRY_ROLE[type];
  const kit = role ? undefined : kitOf(type);
  return role ? `That's ${yardName(role).replace(/^The /, "the ")}` : kit ? `That's the ${kit.name}` : "That's a depot's yard";
}

/** Most of the player's straights tried for a spot a depot fits (it runs on a tap: bounded). */
const SPOT_TRIES = 200;
const spots = new WeakMap<World, { key: string; spot: Pose | null }>();

/**
 * A straight of the player's line where a depot of `type` could be dropped and fit, yard and all (either way round):
 * the middle of that straight and the line's heading there, or null. The straights nearest `near` are tried first, at
 * most `SPOT_TRIES` of them; the answer is kept until the layout, the land or the props change.
 */
export function depotSpot(w: World, type: PieceTypeId, near: readonly { x: number; z: number }[]): Pose | null {
  const layout = w.layout;
  const fixed = new Set([...w.stations.values(), ...w.depots.values()]);
  const straights: { id: number; x: number; z: number; heading: number; d: number }[] = [];
  let sig = 0;
  for (const id of layout.pieceIds()) {
    const p = layout.getPiece(id)!;
    if (fixed.has(id) || layout.isLifted(id) || !isPlainStraight(p.type)) continue;
    const half = straightLength(p.type, false) / 2;
    const x = p.pose.x + half * Math.cos(p.pose.heading);
    const z = p.pose.z + half * Math.sin(p.pose.heading);
    sig = (sig * 31 + x * 7 + z * 13 + p.y + id) % 1e9;
    let d = near.length === 0 ? 0 : Infinity;
    for (const q of near) d = Math.min(d, Math.hypot(q.x - x, q.z - z));
    straights.push({ id, x, z, heading: p.pose.heading, d });
  }
  const key = `${type}|${layout.pieceCount}|${layout.jointCount}|${w.landscape.grid.revision}|${w.props.version}|${sig}|${near.map((q) => `${q.x},${q.z}`).join(";")}`;
  const known = spots.get(w);
  if (known?.key === key) return known.spot;
  straights.sort((a, b) => a.d - b.d);
  const ctx: YardCheck = { land: w.landscape, layout, props: w.props, footprint: () => undefined };
  const free = (id: number) => !w.sim.pieceOccupied(id);
  let spot: Pose | null = null;
  for (const st of straights.slice(0, SPOT_TRIES)) {
    for (const heading of [st.heading, st.heading + Math.PI]) {
      const s = findSplice(layout, type, false, { x: st.x, z: st.z }, heading, TRACK_RADIUS, free);
      if (s.kind !== "splice") continue;
      const ignore = new Set(s.covers);
      if (checkPlacement(w.landscape, type, false, s.pose, s.y).kind !== "clear") continue;
      if (findOverlap(layout, type, false, s.pose, s.y, ignore) !== -1) continue;
      if (checkYard(ctx, type, s.pose, s.y, ignore)) continue;
      spot = { x: st.x, z: st.z, heading: s.pose.heading };
      break;
    }
    if (spot) break;
  }
  spots.set(w, { key, spot });
  return spot;
}

/** What to say when the yard would fit on the other side of the line (the depot turned right round). */
export const YARD_FLIP_HINT = "Flip it to put the yard on the other side";

/** What to say when the yard fits neither side of the line. */
export const YARD_NO_ROOM = "No room for the yard here";

/** The flip hint for a piece type: a depot's yard, or the kit by name ("Flip it to put the platform on the other side"). */
export function flipHintMessage(type: PieceTypeId): string {
  const kit = INDUSTRY_ROLE[type] ? undefined : kitOf(type);
  return kit ? `Flip it to put the ${kit.name} on the other side` : YARD_FLIP_HINT;
}

/** No room either side, for a piece type: "No room for the yard here", or for a kit "No room for the platform here". */
export function noRoomMessage(type: PieceTypeId): string {
  const kit = INDUSTRY_ROLE[type] ? undefined : kitOf(type);
  return kit ? `No room for the ${kit.name} here` : YARD_NO_ROOM;
}

/**
 * A depot at `pose` refused for its yard: what to say about turning it right round (Flip), given `why`, the full
 * placement check (its track's and its yard's) of a pose. The flip hint only if turned round it passes it all; "No
 * room for the yard here" if its yard is refused that way too; else nothing (what's said for where it's held stands).
 */
export function flipHint(type: PieceTypeId, pose: Pose, why: (pose: Pose) => string | null): string | null {
  const turned = why(turnedRound(type, pose));
  return turned === null ? flipHintMessage(type) : isYardBlock(turned) ? noRoomMessage(type) : null;
}

/** A straight depot at `pose` turned right round on the same track: the same ends, its yard on the other side. */
export function turnedRound(type: PieceTypeId, pose: Pose): Pose {
  const end = getPieceDef(type, false).connectors[1].pose;
  const c = Math.cos(pose.heading);
  const s = Math.sin(pose.heading);
  return { x: pose.x + end.x * c - end.z * s, z: pose.z + end.x * s + end.z * c, heading: normalizeAngle(pose.heading + Math.PI) };
}

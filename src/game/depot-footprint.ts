import type { DepotRole } from "../economy";
import { FEAT_BUILDING, FEAT_DEPOT, FEAT_FIELD, FEAT_SHED, FEAT_STATION, hillsOf, isWater, onFixedSite, SURF_LANE, SURF_ROAD, SURF_TOWN, type Landscape } from "../landscape";
import { footprintsOverlap, inFootprint, type Footprint } from "../props/placement";
import type { PropStore } from "../props/store";
import { DEPOT_LAYOUT } from "../render/depot-view";
import { createSample, getPieceDef, ignores, normalizeAngle, pathLength, samplePath, TRAIN_CLEARANCE, type Ignore, type Layout, type PieceTypeId, type Pose } from "../track";
import { DEPOT_NAMES, INDUSTRY_ROLE } from "./world";

/**
 * Room for a depot's yard: a depot piece (the workshop, sawmill, harbour and the rest) is its track plus a yard beside
 * it, on its +l side (depot coordinates, as `DEPOT_LAYOUT` lays them out: t along the track from its socket end, l
 * across), where its buildings, piles and crane stand. The track is checked as track is; this checks the rest:
 * clear of raised ground, water (but a harbour's quay side), town buildings, fields, roads, props, other track, and
 * other depots' yards.
 *
 * A depot can't mirror (Flip turns it right round), so its yard is on the +l side however it's placed.
 */

/** Why a depot's yard can't go somewhere: something on the ground there, a hill, or water. */
export type YardBlock = "yard-ground" | "yard-hill" | "yard-water";

/** A part of a depot's footprint beside its track (depot frame: Footprint's x is t, its z is l). */
interface YardPart extends Footprint {
  /** A crane's leg, a post on the far side of the line: only the ground and props are checked, not other track. */
  readonly post: boolean;
}

interface YardShape {
  readonly parts: readonly YardPart[];
  /** Sample points over the parts (t, l pairs), edges included. */
  readonly samples: Float64Array;
  /** Of each sample, is it a post's (1) or the yard's (0)? */
  readonly posts: Uint8Array;
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
  if (layout.pad) parts.push({ cx: layout.pad.t, cz: layout.pad.l, hw: layout.pad.w / 2, hd: layout.pad.d / 2, post: false });
  if (layout.crane.kind === "gantry") {
    for (const l of [layout.crane.l - GANTRY_HALF, layout.crane.l + GANTRY_HALF]) parts.push({ cx: layout.crane.t, cz: l, hw: LEG, hd: LEG, post: l < 0 });
  }
  if (parts.length === 0) {
    shapes.set(role, null);
    return null;
  }
  const pts: number[] = [];
  const posts: number[] = [];
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
        posts.push(p.post ? 1 : 0);
      }
    }
    reach = Math.max(reach, Math.hypot(Math.abs(p.cx) + p.hw, Math.abs(p.cz) + p.hd));
  }
  s = { parts, samples: Float64Array.from(pts), posts: Uint8Array.from(posts), wetFrom: role === "harbour" ? HARBOUR_DRY : Infinity, reach };
  shapes.set(role, s);
  return s;
}

/** A depot piece's footprint beside its track (depot frame), or null if it's not a depot piece with a yard. */
export function yardParts(type: PieceTypeId): readonly Footprint[] | null {
  const role = INDUSTRY_ROLE[type];
  return (role && shapeOf(role)?.parts) || null;
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
  const role = INDUSTRY_ROLE[type];
  const yard = role ? shapeOf(role) : null;
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
  const role = INDUSTRY_ROLE[type];
  const shape = role ? shapeOf(role) : null;
  if (!shape) return null;
  const g = ctx.land.grid;
  const hills = hillsOf(g);
  const c = Math.cos(pose.heading);
  const s = Math.sin(pose.heading);
  const pts = shape.samples;
  for (let i = 0, k = 0; i < pts.length; i += 2, k++) {
    const t = pts[i];
    const l = pts[i + 1];
    const x = pose.x + t * c - l * s;
    const z = pose.z + t * s + l * c;
    const cell = g.cellAtWorld(x, z);
    if (cell === -1) return "yard-ground";
    const f = g.feature[cell];
    if (f === FEAT_BUILDING || f === FEAT_SHED || f === FEAT_FIELD) return "yard-ground";
    if ((f === FEAT_STATION || f === FEAT_DEPOT) && onFixedSite(ctx.land, cell, x, z)) return "yard-ground";
    const surface = g.surface[cell];
    if (isWater(surface)) {
      if (l < shape.wetFrom) return "yard-water";
    } else if (surface === SURF_TOWN || surface === SURF_ROAD || surface === SURF_LANE || g.road[cell] !== 0) return "yard-ground";
    if (hills.groundAt(x, z) > y + HILL_SLACK) return "yard-hill";
  }
  if (propsInYard(ctx, shape, pose)) return "yard-ground";
  return piecesInYard(ctx.layout, type, shape, pose, y, ignore) ? "yard-ground" : null;
}

function propsInYard(ctx: YardCheck, shape: YardShape, pose: Pose): boolean {
  if (ctx.props.size === 0) return false;
  for (const prop of ctx.props.all()) {
    const fp = ctx.footprint(prop.asset);
    if (!fp) continue;
    if (Math.hypot(prop.x - pose.x, prop.z - pose.z) > shape.reach + Math.hypot(Math.abs(fp.cx) + fp.hw, Math.abs(fp.cz) + fp.hd)) continue;
    for (const part of shape.parts) if (footprintsOverlap(part, pose, fp, prop)) return true;
  }
  return false;
}

/** Does other track run through the yard, or another depot's yard overlap it (or this one's track run through that)? */
function piecesInYard(layout: Layout, type: PieceTypeId, shape: YardShape, pose: Pose, y: number, ignore: Ignore): boolean {
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
      for (const part of shape.parts) if (!part.post && inFootprint(part, pose, x, z, TRACK_RADIUS)) return true;
    }
    if (!theirs) continue;
    // Their yard and mine; my track through their yard.
    for (const a of shape.parts) for (const b of theirs.parts) if (footprintsOverlap(a, pose, b, other.pose)) return true;
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

/** The message for a yard that can't go somewhere ("The workshop's yard is on a hill"). */
export function yardMessage(type: PieceTypeId, why: YardBlock): string {
  const role = INDUSTRY_ROLE[type];
  const yard = role ? yardName(role) : "The yard";
  if (why === "yard-hill") return `${yard} is on a hill`;
  if (why === "yard-water") return `${yard} is in the water`;
  return `${yard} needs open ground`;
}

/** What to say when the yard would fit on the other side of the line (the depot turned right round). */
export const YARD_FLIP_HINT = "Flip it to put the yard on the other side";

/** A straight depot at `pose` turned right round on the same track: the same ends, its yard on the other side. */
export function turnedRound(type: PieceTypeId, pose: Pose): Pose {
  const end = getPieceDef(type, false).connectors[1].pose;
  const c = Math.cos(pose.heading);
  const s = Math.sin(pose.heading);
  return { x: pose.x + end.x * c - end.z * s, z: pose.z + end.x * s + end.z * c, heading: normalizeAngle(pose.heading + Math.PI) };
}

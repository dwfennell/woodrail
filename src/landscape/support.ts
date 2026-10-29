import { ARCH_CENTRES, ARCH_RADIUS, canStandOnArches, createSample, getPieceDef, ignores, isBridge, isLift, isRamp, pathLength, samplePath, JOINT_POS_TOLERANCE, RISER_HEIGHT, TRACK_WIDTH, type Ignore, type Layout, type PieceTypeId, type Pose } from "../track";
import type { Landscape } from "./generate";
import { hillsOf } from "./hill-shape";

/** How close to a riser's centre a track end must be to rest on it (a riser is 46 mm across). */
export const RISER_REACH = 24;
/** A track end this close to a block's edge can rest on the block. */
const EDGE_REACH = 10;
/** Heights within this count as resting on each other. */
const TOL = 1;
/** The most risers added under one end of a dropped piece. */
export const MAX_AUTO_RISERS = 3;
/** The tallest a bridge's arches stand, in riser heights. */
export const MAX_BRIDGE_LEVELS = 4;

export interface RiserPlacement {
  pose: Pose;
  y: number;
}

/** Is a piece held up where it's going? Risers it needs (whole risers under ends in the air) come with "held". */
export type Support = { readonly kind: "held"; readonly risers: RiserPlacement[] } | { readonly kind: "unsupported" };

interface Foot {
  x: number;
  z: number;
  /** Height of the foot above the piece's base. */
  dy: number;
}

const bridgeSample = createSample();

/** The lowest ground under a piece's track. */
function groundUnder(land: Landscape, type: PieceTypeId, flipped: boolean, pose: Pose): number {
  return groundAlong(land, type, flipped, pose, Math.min, Infinity);
}

/** Ground heights along a piece's track (plan samples along its paths), folded with `pick`. */
function groundAlong(land: Landscape, type: PieceTypeId, flipped: boolean, pose: Pose, pick: (a: number, b: number) => number, start: number): number {
  const ch = Math.cos(pose.heading);
  const sh = Math.sin(pose.heading);
  let out = start;
  for (const path of getPieceDef(type, flipped).paths) {
    const len = pathLength(path.geom);
    const n = Math.max(2, Math.ceil(len / 18));
    for (let k = 0; k <= n; k++) {
      samplePath(path.geom, (len * k) / n, bridgeSample);
      out = pick(out, hillsOf(land.grid).groundAt(pose.x + bridgeSample.x * ch - bridgeSample.z * sh, pose.z + bridgeSample.x * sh + bridgeSample.z * ch));
    }
  }
  return Number.isFinite(out) ? out : 0;
}

/** The highest ground under a piece's track. */
function groundOver(land: Landscape, type: PieceTypeId, flipped: boolean, pose: Pose): number {
  return groundAlong(land, type, flipped, pose, Math.max, -Infinity);
}

/**
 * How many riser heights a bridge's (or raised ramp's) arches stand, from the lowest ground under it up to its base at
 * `y` (a ramp's low end); 0 when that isn't a whole number of levels above the ground, or the deck would top
 * MAX_BRIDGE_LEVELS. A ramp with 0 is a plain ramp, held up the usual way.
 */
export function bridgeLevels(land: Landscape, type: PieceTypeId, flipped: boolean, pose: Pose, y: number): number {
  if (!canStandOnArches(type)) return 0;
  const n = (y - groundUnder(land, type, flipped, pose)) / RISER_HEIGHT;
  const whole = Math.round(n);
  // A bridge ramp's high end counts toward the limit too.
  const rise = Math.max(0, ...getPieceDef(type, flipped).connectors.map((c) => c.y)) / RISER_HEIGHT;
  return whole >= 1 && whole + rise <= MAX_BRIDGE_LEVELS && Math.abs(n - whole) * RISER_HEIGHT <= TOL ? whole : 0;
}

/**
 * How many whole levels a piece at base height `y` stands above the lowest ground under its track (0 at ground level,
 * or less than a level up): where a drawn line refused over a river can take a bridge straight on, rather than first
 * ramping up (see `drawRefusal`).
 */
export function levelsOver(land: Landscape, type: PieceTypeId, flipped: boolean, pose: Pose, y: number): number {
  return Math.max(0, Math.floor((y - groundUnder(land, type, flipped, pose)) / RISER_HEIGHT + TOL / RISER_HEIGHT));
}

/**
 * How far down each of a bridge's arch openings reaches (`ARCH_CENTRES` order), in riser heights below its base:
 * down to the highest ground under that arch, so an arch over a hill springs from the hilltop rather than running
 * down into it. (The viaduct itself still stands on the lowest ground under the deck: its foot in the hill is hidden
 * by the hill.) Null when every opening reaches all `levels` down, as on level ground.
 */
export function archFloors(land: Landscape, type: PieceTypeId, flipped: boolean, pose: Pose, y: number, levels: number): number[] | null {
  if (levels <= 0) return null;
  const def = getPieceDef(type, flipped);
  if (def.paths.length !== 1) return null;
  const path = def.paths[0].geom;
  const len = pathLength(path);
  const ch = Math.cos(pose.heading);
  const sh = Math.sin(pose.heading);
  const hills = hillsOf(land.grid);
  const reach = len * ARCH_RADIUS + 2;
  const floors = ARCH_CENTRES.map((at) => {
    let high = 0;
    for (let k = -2; k <= 2; k++) {
      samplePath(path, Math.min(len, Math.max(0, len * at + (reach * k) / 2)), bridgeSample);
      for (const across of [-TRACK_WIDTH / 2, 0, TRACK_WIDTH / 2]) {
        const lx = bridgeSample.x - Math.sin(bridgeSample.heading) * across;
        const lz = bridgeSample.z + Math.cos(bridgeSample.heading) * across;
        high = Math.max(high, hills.groundAt(pose.x + lx * ch - lz * sh, pose.z + lx * sh + lz * ch));
      }
    }
    // Whole levels above that ground (never below it).
    return Math.max(0, Math.min(levels, Math.floor((y - high) / RISER_HEIGHT + 0.02)));
  });
  return floors.every((f) => f === levels) ? null : floors;
}

/** Where a piece rests: each track end at its own height, and a riser on its base. (Bridges stand on their arches.) */
function feet(type: PieceTypeId, flipped: boolean, pose: Pose): Foot[] {
  const def = getPieceDef(type, flipped);
  if (def.connectors.length === 0) return [{ x: pose.x, z: pose.z, dy: 0 }];
  const ch = Math.cos(pose.heading);
  const sh = Math.sin(pose.heading);
  return def.connectors.map((c) => ({
    x: pose.x + c.pose.x * ch - c.pose.z * sh,
    z: pose.z + c.pose.x * sh + c.pose.z * ch,
    dy: c.y,
  }));
}

/** Risers, bridges, ramps and train lifts near a point (the pieces that can hold others up), gathered in one pass over the layout. */
interface Holder {
  type: PieceTypeId;
  flipped: boolean;
  pose: Pose;
  y: number;
}
const holders: Holder[] = [];
/** A piece's ends are at most this far from its pose origin (the longest that hold others up: a train lift, 288 mm). */
const PIECE_REACH = 300;

function gatherHolders(layout: Layout, x: number, z: number, ignoreId: Ignore): Holder[] {
  holders.length = 0;
  const r = PIECE_REACH + RISER_REACH + JOINT_POS_TOLERANCE;
  for (const id of layout.pieceIds()) {
    if (ignores(ignoreId, id)) continue;
    const p = layout.getPiece(id)!;
    if (p.type !== "riser" && !canStandOnArches(p.type) && !isLift(p.type)) continue;
    if (Math.abs(p.pose.x - x) > r || Math.abs(p.pose.z - z) > r || layout.isLifted(id)) continue;
    holders.push(p);
  }
  return holders;
}

/** The top riser of the stack nearest (x, z) within reach, ignoring piece `ignoreId`. */
export function riserStackAt(layout: Layout, x: number, z: number, ignoreId: number): { pose: Pose; top: number } | null {
  return stackIn(gatherHolders(layout, x, z, ignoreId), x, z);
}

function stackIn(near: readonly Holder[], x: number, z: number): { pose: Pose; top: number } | null {
  let best: { pose: Pose; top: number } | null = null;
  let bestD = Infinity;
  for (const p of near) {
    if (p.type !== "riser") continue;
    const d = Math.hypot(p.pose.x - x, p.pose.z - z);
    if (d > RISER_REACH) continue;
    const top = p.y + RISER_HEIGHT;
    // The stack is the tallest riser here; among stacks, the nearest.
    if (best && Math.abs(d - bestD) < 1 ? top > best.top : d < bestD) {
      best = { pose: { ...p.pose }, top };
      bestD = d;
    }
  }
  return best;
}

/** Heights something could rest on at a plan point: the ground (blocks within reach of their edge), riser tops, bridge ends. */
function restHeights(land: Landscape, near: readonly Holder[], x: number, z: number): number[] {
  const g = land.grid;
  const out: number[] = [];
  for (const [dx, dz] of [[0, 0], [EDGE_REACH, 0], [-EDGE_REACH, 0], [0, EDGE_REACH], [0, -EDGE_REACH]]) {
    if (g.cellAtWorld(x + dx, z + dz) !== -1) out.push(hillsOf(g).groundAt(x + dx, z + dz));
  }
  for (const p of near) {
    if (p.type === "riser") {
      if (Math.hypot(p.pose.x - x, p.pose.z - z) <= RISER_REACH) out.push(p.y + RISER_HEIGHT);
    } else if (isBridge(p.type) || isLift(p.type) || bridgeLevels(land, p.type, p.flipped, p.pose, p.y) > 0) {
      // Bridge ends, the ends of a ramp on arches, and a train lift's (its high end held up by its tower).
      for (const f of feet(p.type, p.flipped, p.pose)) {
        if (Math.hypot(f.x - x, f.z - z) <= JOINT_POS_TOLERANCE) out.push(p.y + f.dy);
      }
    }
  }
  return out;
}

/** The base height for a piece dropped loose: high enough that no foot is below what's under it. */
export function looseHeight(land: Landscape, layout: Layout, type: PieceTypeId, flipped: boolean, pose: Pose, ignoreId: number): number {
  const near = gatherHolders(layout, pose.x, pose.z, ignoreId);
  if (getPieceDef(type, flipped).connectors.length === 0) {
    const stack = stackIn(near, pose.x, pose.z);
    return Math.max(stack?.top ?? 0, hillsOf(land.grid).groundAt(pose.x, pose.z));
  }
  // A bridge dropped loose stands one level above the highest ground under it.
  if (isBridge(type)) return groundOver(land, type, flipped, pose) + RISER_HEIGHT;
  let y = 0;
  for (const f of feet(type, flipped, pose)) y = Math.max(y, Math.max(0, ...restHeights(land, near, f.x, f.z)) - f.dy);
  return y;
}

/**
 * What holds a piece up at base height `y`: each foot rests on the ground, a riser or a bridge end, or is a whole
 * number of risers (up to `MAX_AUTO_RISERS`) above the ground or riser stack under it, which become risers to add.
 */
export function checkSupport(
  land: Landscape,
  layout: Layout,
  type: PieceTypeId,
  flipped: boolean,
  pose: Pose,
  y: number,
  ignoreId: Ignore,
): Support {
  const risers: RiserPlacement[] = [];
  if (getPieceDef(type, flipped).connectors.length === 0) {
    // A riser rests on whatever it was dropped on (see `looseHeight`).
    return { kind: "held", risers };
  }
  // A bridge needs no risers: its arches reach the ground, if it isn't too high (or too low) for them.
  if (isBridge(type)) return bridgeLevels(land, type, flipped, pose, y) > 0 ? { kind: "held", risers } : { kind: "unsupported" };
  // So does a ramp up off the ground (coming off a bridge or raised track).
  if (bridgeLevels(land, type, flipped, pose, y) > 0) return { kind: "held", risers };
  const near = gatherHolders(layout, pose.x, pose.z, ignoreId);
  for (const f of feet(type, flipped, pose)) {
    const fy = y + f.dy;
    if (restHeights(land, near, f.x, f.z).some((h) => Math.abs(h - fy) <= TOL)) continue;
    // A ramp's high end stands on the ramp's own support, down to where its low end rests (no riser); a train lift's
    // on its tower.
    if ((isRamp(type) || isLift(type)) && f.dy > 0 && restHeights(land, near, f.x, f.z).some((h) => Math.abs(h - y) <= TOL)) continue;
    // In the air: stack risers from the ground right under the foot, or on top of a riser stack there.
    const stack = stackIn(near, f.x, f.z);
    const ground = hillsOf(land.grid).groundAt(f.x, f.z);
    const onStack = !!stack && stack.top > ground && stack.top < fy;
    const base = onStack ? stack.top : ground;
    const n = (fy - base) / RISER_HEIGHT;
    const whole = Math.round(n);
    if (whole < 1 || whole > MAX_AUTO_RISERS || Math.abs(n - whole) * RISER_HEIGHT > TOL) return { kind: "unsupported" };
    const at = onStack ? stack.pose : { x: f.x, z: f.z, heading: pose.heading };
    for (let k = 0; k < whole; k++) risers.push({ pose: { ...at }, y: base + k * RISER_HEIGHT });
  }
  return { kind: "held", risers };
}

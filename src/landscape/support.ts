import { bridgeLevels, getPieceDef, JOINT_POS_TOLERANCE, RISER_HEIGHT, type Layout, type PieceTypeId, type Pose } from "../track";
import type { Landscape } from "./generate";

/** How close to a riser's centre a track end must be to rest on it (a riser is 46 mm across). */
export const RISER_REACH = 24;
/** A track end this close to a block's edge can rest on the block. */
const EDGE_REACH = 10;
/** Heights within this count as resting on each other. */
const TOL = 1;
/** The most risers added under one end of a dropped piece. */
export const MAX_AUTO_RISERS = 3;

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

/**
 * Where a piece rests: each track end at its own height, except a bridge, which stands on its arch at both ends,
 * and a riser, on its base.
 */
function feet(type: PieceTypeId, flipped: boolean, pose: Pose): Foot[] {
  const def = getPieceDef(type, flipped);
  if (def.connectors.length === 0) return [{ x: pose.x, z: pose.z, dy: 0 }];
  const ch = Math.cos(pose.heading);
  const sh = Math.sin(pose.heading);
  return def.connectors.map((c) => ({
    x: pose.x + c.pose.x * ch - c.pose.z * sh,
    z: pose.z + c.pose.x * sh + c.pose.z * ch,
    dy: bridgeLevels(type) > 0 ? 0 : c.y,
  }));
}

/** Risers and bridges near a point (the only pieces that hold others up), gathered in one pass over the layout. */
interface Holder {
  type: PieceTypeId;
  flipped: boolean;
  pose: Pose;
  y: number;
}
const holders: Holder[] = [];
/** A piece's ends are at most this far from its pose origin (the longest pieces are 216 mm). */
const PIECE_REACH = 240;

function gatherHolders(layout: Layout, x: number, z: number, ignoreId: number): Holder[] {
  holders.length = 0;
  const r = PIECE_REACH + RISER_REACH + JOINT_POS_TOLERANCE;
  for (const id of layout.pieceIds()) {
    if (id === ignoreId) continue;
    const p = layout.getPiece(id)!;
    if (p.type !== "riser" && bridgeLevels(p.type) === 0) continue;
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
    const i = g.cellAtWorld(x + dx, z + dz);
    if (i !== -1) out.push(g.groundY(i));
  }
  for (const p of near) {
    if (p.type === "riser") {
      if (Math.hypot(p.pose.x - x, p.pose.z - z) <= RISER_REACH) out.push(p.y + RISER_HEIGHT);
    } else {
      for (const f of feet(p.type, p.flipped, p.pose)) {
        if (Math.hypot(f.x - x, f.z - z) <= JOINT_POS_TOLERANCE) out.push(p.y + bridgeLevels(p.type) * RISER_HEIGHT);
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
    const i = land.grid.cellAtWorld(pose.x, pose.z);
    return Math.max(stack?.top ?? 0, i === -1 ? 0 : land.grid.groundY(i));
  }
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
  ignoreId: number,
): Support {
  const risers: RiserPlacement[] = [];
  if (getPieceDef(type, flipped).connectors.length === 0) {
    // A riser rests on whatever it was dropped on (see `looseHeight`).
    return { kind: "held", risers };
  }
  const near = gatherHolders(layout, pose.x, pose.z, ignoreId);
  for (const f of feet(type, flipped, pose)) {
    const fy = y + f.dy;
    if (restHeights(land, near, f.x, f.z).some((h) => Math.abs(h - fy) <= TOL)) continue;
    // In the air: stack risers from the ground right under the foot, or on top of a riser stack there.
    const stack = stackIn(near, f.x, f.z);
    const i = land.grid.cellAtWorld(f.x, f.z);
    const ground = i === -1 ? 0 : land.grid.groundY(i);
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

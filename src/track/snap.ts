import { SNAP_CAPTURE_RADIUS, SNAP_HEIGHT_TOLERANCE } from "./constants";
import { createWorldConnector, pieceOfRef, type Layout } from "./layout";
import { angleDiff, solveParentPose, transformPose, type Pose } from "./math";
import { getPieceDef, type PieceTypeId } from "./pieces";

export type SnapResult =
  | {
      readonly kind: "snapped";
      readonly pose: Pose;
      readonly y: number;
      /** Connector index on the dragged piece that seats. */
      readonly connector: number;
      /** Connector ref in the layout it seats onto. */
      readonly target: number;
      readonly distance: number;
      /** Mirrored or not, as it seats (as held). */
      readonly flipped: boolean;
    }
  | { readonly kind: "none" };

const NONE: SnapResult = { kind: "none" };
/** Seating an end that turns the piece from how it's held counts as this many mm further away per radian turned. */
const TURN_COST = 200;
const local: Pose = { x: 0, z: 0, heading: 0 };
const target = createWorldConnector();
const candidates: number[] = [];

/**
 * Where should a piece being dragged at `pose` land? Its ends seat on any free end of track near them, peg or hole
 * alike (a joint doesn't care: see `Layout`): the piece keeps the turn and the hand it's held with, and the end of it
 * nearest a free end seats there. Called on pointer move (not per sim tick), so returning a fresh result object is fine.
 */
export function findSnap(
  layout: Layout,
  type: PieceTypeId,
  flipped: boolean,
  pose: Pose,
  y: number,
  excludePieceId = -1,
  captureRadius = SNAP_CAPTURE_RADIUS,
): SnapResult {
  const def = getPieceDef(type, flipped);
  let best: SnapResult = NONE;
  let bestDistance = Infinity;
  for (let i = 0; i < def.connectors.length; i++) {
    const c = def.connectors[i];
    transformPose(pose, c.pose, local);
    const cy = y + c.y;
    const n = layout.queryFreeConnectors(local.x, local.z, captureRadius, candidates);
    for (let j = 0; j < n; j++) {
      const ref = candidates[j];
      if (pieceOfRef(ref) === excludePieceId) continue;
      const t = layout.worldConnector(ref, target);
      const distance = Math.hypot(t.x - local.x, t.z - local.z);
      if (distance > captureRadius || distance >= bestDistance || Math.abs(t.y - cy) > SNAP_HEIGHT_TOLERANCE) continue;
      bestDistance = distance;
      const seat = { x: t.x, z: t.z, heading: t.heading + Math.PI };
      best = { kind: "snapped", pose: solveParentPose(c.pose, seat, { x: 0, z: 0, heading: 0 }), y: t.y - c.y, connector: i, target: ref, distance, flipped };
    }
  }
  return best;
}

/** Place a new piece exactly seated on free connector `fromRef`, through its connector `connectorIndex`. */
export function appendPiece(
  layout: Layout,
  type: PieceTypeId,
  flipped: boolean,
  fromRef: number,
  connectorIndex = 0,
): number {
  const c = getPieceDef(type, flipped).connectors[connectorIndex];
  const t = layout.worldConnector(fromRef, target);
  const pose = solveParentPose(c.pose, { x: t.x, z: t.z, heading: t.heading + Math.PI }, { x: 0, z: 0, heading: 0 });
  const y = t.y - c.y;
  return layout.addPiece(type, pose, y, flipped);
}

/**
 * Seat the piece on the free connector nearest `point` (where the finger or mouse is), if one is within
 * `captureRadius`: a piece is put where it's pointed, not only where its held ends happen to be. The end of the held
 * piece nearest that connector seats there, peg or hole alike; the piece keeps the hand it's held with.
 */
export function findSnapAtPoint(
  layout: Layout,
  type: PieceTypeId,
  flipped: boolean,
  pose: Pose,
  y: number,
  point: { x: number; z: number },
  excludePieceId = -1,
  captureRadius = SNAP_CAPTURE_RADIUS,
): SnapResult {
  const held = getPieceDef(type, flipped);
  const n = layout.queryFreeConnectors(point.x, point.z, captureRadius, candidates);
  let ref = -1;
  let distance = Infinity;
  for (let j = 0; j < n; j++) {
    if (pieceOfRef(candidates[j]) === excludePieceId) continue;
    const t = layout.worldConnector(candidates[j], target);
    const d = Math.hypot(t.x - point.x, t.z - point.z);
    // Within reach of the held piece's height: the floor, or one of the levels the caller tries.
    if (d > captureRadius || d >= distance || held.connectors.every((c) => Math.abs(t.y - (y + c.y)) > SNAP_HEIGHT_TOLERANCE)) continue;
    ref = candidates[j];
    distance = d;
  }
  if (ref === -1) return NONE;
  const t = layout.worldConnector(ref, target);
  // Which of the held piece's ends seats there (at a height that reaches it): the one that keeps the piece turned most
  // as it's held, then the nearest. (Seating the other end of a straight would turn it right round.)
  const seat = { x: t.x, z: t.z, heading: t.heading + Math.PI };
  let best: SnapResult = NONE;
  let bestScore = Infinity;
  for (let k = 0; k < held.connectors.length; k++) {
    const c = held.connectors[k];
    if (Math.abs(t.y - (y + c.y)) > SNAP_HEIGHT_TOLERANCE) continue;
    const p = solveParentPose(c.pose, seat, { x: 0, z: 0, heading: 0 });
    transformPose(pose, c.pose, local);
    const score = angleDiff(p.heading, pose.heading) * TURN_COST + Math.hypot(local.x - t.x, local.z - t.z);
    if (score >= bestScore) continue;
    bestScore = score;
    best = { kind: "snapped", pose: p, y: t.y - c.y, connector: k, target: ref, distance, flipped };
  }
  return best;
}

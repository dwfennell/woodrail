import { SNAP_CAPTURE_RADIUS, SNAP_HEIGHT_TOLERANCE } from "./constants";
import { createWorldConnector, pieceOfRef, type Layout } from "./layout";
import { solveParentPose, transformPose, type Pose } from "./math";
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
    }
  | { readonly kind: "none" };

const NONE: SnapResult = { kind: "none" };
const local: Pose = { x: 0, z: 0, heading: 0 };
const target = createWorldConnector();
const candidates: number[] = [];

/**
 * Where should a piece being dragged at `pose` land? Called on pointer move (not per sim tick),
 * so returning a fresh result object is fine.
 */
export function findSnap(
  layout: Layout,
  type: PieceTypeId,
  flipped: boolean,
  pose: Pose,
  y: number,
  excludePieceId = -1,
): SnapResult {
  const def = getPieceDef(type, flipped);
  let best: SnapResult = NONE;
  let bestDistance = Infinity;
  for (let i = 0; i < def.connectors.length; i++) {
    const c = def.connectors[i];
    transformPose(pose, c.pose, local);
    const cy = y + c.y;
    const n = layout.queryFreeConnectors(local.x, local.z, SNAP_CAPTURE_RADIUS, candidates);
    for (let j = 0; j < n; j++) {
      const ref = candidates[j];
      if (pieceOfRef(ref) === excludePieceId) continue;
      const t = layout.worldConnector(ref, target);
      if (t.kind === c.kind) continue;
      const distance = Math.hypot(t.x - local.x, t.z - local.z);
      if (distance > SNAP_CAPTURE_RADIUS || Math.abs(t.y - cy) > SNAP_HEIGHT_TOLERANCE) continue;
      if (distance >= bestDistance) continue;
      bestDistance = distance;
      const snapped = solveParentPose(c.pose, { x: t.x, z: t.z, heading: t.heading + Math.PI }, { x: 0, z: 0, heading: 0 });
      best = { kind: "snapped", pose: snapped, y: t.y - c.y, connector: i, target: ref, distance };
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

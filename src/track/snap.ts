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
      /** Mirrored or not, as it seats (with auto-fit this may differ from the piece as held). */
      readonly flipped: boolean;
    }
  | { readonly kind: "none" };

/**
 * When a dragged piece's end is near a connector of the same kind (peg to peg, hole to hole): "off" ignores it,
 * "turn" seats one of the piece's other ends there instead, "turn-or-mirror" may also mirror the piece to fit.
 */
export type AutoFit = "off" | "turn" | "turn-or-mirror";

/** Auto-fit seats count as this much further away (mm) than an exact fit, so the piece as held wins a near tie. */
export const AUTO_FIT_PENALTY = 4;

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
  captureRadius = SNAP_CAPTURE_RADIUS,
  autoFit: AutoFit = "off",
): SnapResult {
  const def = getPieceDef(type, flipped);
  let best: SnapResult = NONE;
  let bestScore = Infinity;
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
      if (distance > captureRadius || Math.abs(t.y - cy) > SNAP_HEIGHT_TOLERANCE) continue;
      const seat = { x: t.x, z: t.z, heading: t.heading + Math.PI };
      if (t.kind !== c.kind) {
        if (distance >= bestScore) continue;
        bestScore = distance;
        best = { kind: "snapped", pose: solveParentPose(c.pose, seat, { x: 0, z: 0, heading: 0 }), y: t.y - c.y, connector: i, target: ref, distance, flipped };
        continue;
      }
      if (autoFit === "off") continue;
      // The end near this connector is the wrong kind (peg to peg, hole to hole): seat one of the piece's other ends
      // here instead, as held or mirrored, whichever leaves the piece most where it's being held.
      const score = distance + AUTO_FIT_PENALTY;
      if (score >= bestScore) continue;
      const centre = centreOf(def, pose);
      let fit: SnapResult = NONE;
      let fitCentreDistance = Infinity;
      for (const f of def.flippable && autoFit === "turn-or-mirror" ? [flipped, !flipped] : [flipped]) {
        const d = getPieceDef(type, f);
        for (let k = 0; k < d.connectors.length; k++) {
          const c2 = d.connectors[k];
          if (c2.kind === t.kind || Math.abs(c2.y - c.y) > SNAP_HEIGHT_TOLERANCE) continue;
          const p = solveParentPose(c2.pose, seat, { x: 0, z: 0, heading: 0 });
          const m = centreOf(d, p);
          const away = Math.hypot(m.x - centre.x, m.z - centre.z);
          if (away >= fitCentreDistance) continue;
          fitCentreDistance = away;
          fit = { kind: "snapped", pose: p, y: t.y - c2.y, connector: k, target: ref, distance, flipped: f };
        }
      }
      if (fit.kind === "snapped") {
        bestScore = score;
        best = fit;
      }
    }
  }
  return best;
}

/** Plan centre of a piece (the mean of its connectors) at `pose`. */
function centreOf(def: ReturnType<typeof getPieceDef>, pose: Pose): { x: number; z: number } {
  let x = 0;
  let z = 0;
  for (const c of def.connectors) {
    transformPose(pose, c.pose, local2);
    x += local2.x;
    z += local2.z;
  }
  const n = Math.max(1, def.connectors.length);
  return { x: x / n, z: z / n };
}
const local2: Pose = { x: 0, z: 0, heading: 0 };

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
 * `captureRadius`: a piece is put where it's pointed, not only where its held ends happen to be. Of the ways it can
 * seat there (each of its ends of the other kind; mirrored too, with "turn-or-mirror"), the one most like the piece as
 * held at `pose` wins.
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
  autoFit: AutoFit = "off",
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
  const seat = { x: t.x, z: t.z, heading: t.heading + Math.PI };
  // The held piece's ends, to compare each seating against.
  const ends = held.connectors.map((c) => {
    transformPose(pose, c.pose, local);
    return { x: local.x, z: local.z };
  });
  let best: SnapResult = NONE;
  let bestScore = Infinity;
  const flips = autoFit === "turn-or-mirror" && held.flippable ? [flipped, !flipped] : [flipped];
  for (const f of flips) {
    const d = getPieceDef(type, f);
    for (let k = 0; k < d.connectors.length; k++) {
      const c = d.connectors[k];
      if (c.kind === t.kind || Math.abs(t.y - (y + c.y)) > SNAP_HEIGHT_TOLERANCE) continue;
      // Only the end nearest the finger may seat unless the piece may turn to fit.
      if (autoFit === "off" && k !== nearestEnd(ends, point)) continue;
      const p = solveParentPose(c.pose, seat, { x: 0, z: 0, heading: 0 });
      let score = f === flipped ? 0 : AUTO_FIT_PENALTY;
      d.connectors.forEach((c2, m) => {
        transformPose(p, c2.pose, local2);
        const e = ends[m] ?? ends[0];
        score += Math.hypot(local2.x - e.x, local2.z - e.z);
      });
      if (score >= bestScore) continue;
      bestScore = score;
      best = { kind: "snapped", pose: p, y: t.y - c.y, connector: k, target: ref, distance, flipped: f };
    }
  }
  return best;
}

function nearestEnd(ends: { x: number; z: number }[], point: { x: number; z: number }): number {
  let best = 0;
  ends.forEach((e, k) => {
    if (Math.hypot(e.x - point.x, e.z - point.z) < Math.hypot(ends[best].x - point.x, ends[best].z - point.z)) best = k;
  });
  return best;
}

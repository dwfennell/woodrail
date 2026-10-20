import { JOINT_ANGLE_TOLERANCE, JOINT_POS_TOLERANCE } from "./constants";
import type { Layout } from "./layout";
import { connectorRef, createWorldConnector, indexOfRef, pieceOfRef } from "./layout";
import { angleDiff, type Pose } from "./math";
import { getPieceDef } from "./pieces";

/** Joints seated worse than this (mm, or the angle's sideways reach at REACH) are worth taking up. */
const SLACK_EPSILON = 0.3;
/** How far along the track a connector's heading is weighed (mm): 4° of twist reads as about 2 mm. */
const REACH = 30;
/** How many joints away from the change pieces may shift. */
const RELAX_DEPTH = 8;
const MAX_SWEEPS = 400;
const SETTLED = 0.005;
/**
 * How much more the heading is weighed on each try after the first, when the fit leaves a joint turned past the joint
 * tolerance (`JOINT_ANGLE_TOLERANCE`): the turn is spread over more of the loose run's joints, each shifting a little
 * more sideways instead. (QA: with stations and depots fixed, a drawn line closing between two of them took 8.1° at
 * one joint, which loading then refused.)
 */
const TWIST_WEIGHTS = [1, 3, 8];

const wa = createWorldConnector();
const extra = new Map<number, number>();
/** A connector's partner for this relaxing: the one it's joined to, or a near miss it's being closed with. */
let partnerOf: (ref: number) => number = () => -1;
const wb = createWorldConnector();

/**
 * Spread joint play along the line, like real wooden track: after a change near `seeds`, loose pieces up to a few
 * joints away each shift and turn a little so that no one joint is left gaping. Pieces for which `pinned` is true
 * (stations, depots, track under a train) and pieces beyond the reach stay put and the others fit to them.
 *
 * No joint (nor near miss closed) is left turned past the joint tolerance, as seating it afresh on loading would part
 * it: a fit that would is tried again with the heading weighed more, spreading the turn over more of the loose run.
 *
 * Returns the new poses of the pieces that moved (empty when every nearby joint is already snug, or when spreading
 * would not help, or can't within the tolerance). Pure: the layout is not changed — apply with `layout.nudgePieces`.
 */
export function relaxJoints(
  layout: Layout,
  seeds: readonly number[],
  pinned: (pieceId: number) => boolean,
  near: readonly (readonly [number, number])[] = [],
): Map<number, Pose> {
  const result = new Map<number, Pose>();
  // Near misses to close (pairs of free ends): fitted as if joined, so the loose track gives a little at every joint.
  extra.clear();
  for (const [a, b] of near) {
    extra.set(a, b);
    extra.set(b, a);
  }
  partnerOf = (ref) => {
    const p = layout.joinedConnector(ref);
    return p !== -1 ? p : (extra.get(ref) ?? -1);
  };
  // The loose pieces within reach of the change, nearest first.
  const depth = new Map<number, number>();
  const order: number[] = [];
  for (const id of seeds) {
    if (!layout.getPiece(id) || layout.isLifted(id) || depth.has(id)) continue;
    depth.set(id, 0);
    order.push(id);
  }
  for (let i = 0; i < order.length; i++) {
    const id = order[i];
    const d = depth.get(id)!;
    if (d >= RELAX_DEPTH) continue;
    forPartners(layout, id, (other) => {
      if (depth.has(other)) return;
      depth.set(other, d + 1);
      order.push(other);
    });
  }
  const free = order.filter((id) => !pinned(id));
  if (free.length === 0) return result;

  const poses = new Map<number, Pose>();
  for (const id of order) poses.set(id, { ...layout.getPiece(id)!.pose });
  const before = worstSlack(layout, free, poses);
  if (before <= SLACK_EPSILON) return result;
  const turnedBefore = jointTurns(layout, free, null);

  // Fit, weighing the heading more on each try, until the result helps and leaves every joint well seated and none
  // turned past the joint tolerance (one already past it, from an older build's save, may not turn further). Each try
  // goes on from where the last left the pieces. If none does, nothing moves: a near miss being closed stays open.
  let fitted = false;
  for (const weight of TWIST_WEIGHTS) {
    settle(layout, free, poses, REACH * weight);
    const after = worstSlack(layout, free, poses);
    if (after >= before || after > JOINT_POS_TOLERANCE / 2) {
      // (Seated worse or no better: weighing the heading more only seats it worse still.)
      if (weight === TWIST_WEIGHTS[0]) break;
      continue;
    }
    if (!withinTurn(layout, free, poses, turnedBefore)) continue;
    fitted = true;
    break;
  }
  if (!fitted) return result;
  for (const id of free) {
    const old = layout.getPiece(id)!.pose;
    const now = poses.get(id)!;
    if (Math.hypot(now.x - old.x, now.z - old.z) > 1e-6 || Math.abs(now.heading - old.heading) > 1e-9) result.set(id, now);
  }
  return result;
}

/** Gauss–Seidel: fit each loose piece in turn to where its neighbours are now, until nothing moves. */
function settle(layout: Layout, free: readonly number[], poses: Map<number, Pose>, reach: number): void {
  const ps = psScratch;
  const qs = qsScratch;
  for (let sweep = 0; sweep < MAX_SWEEPS; sweep++) {
    let moved = 0;
    for (const id of free) {
      ps.length = 0;
      qs.length = 0;
      const piece = layout.getPiece(id)!;
      const count = getPieceDef(piece.type, piece.flipped).connectors.length;
      for (let i = 0; i < count; i++) {
        const ref = connectorRef(id, i);
        const partner = partnerOf(ref);
        if (partner === -1) continue;
        connectorAt(layout, ref, poses.get(id)!, wa);
        const otherId = pieceOfRef(partner);
        connectorAt(layout, partner, poses.get(otherId) ?? layout.getPiece(otherId)!.pose, wb);
        // The connector's mouth, and a point a little way along the track either side of it: each should meet the
        // same point carried along the partner's line. Both pieces of a joint weigh the same three pairs (were each to
        // weigh only a point inside itself, the two would pull toward different fits, and a joint that must bend
        // sideways would swing wider every sweep). The further along those points, the more the heading weighs.
        const ca = Math.cos(wa.heading);
        const sa = Math.sin(wa.heading);
        const cb = Math.cos(wb.heading);
        const sb = Math.sin(wb.heading);
        ps.push(wa.x, wa.z, wa.x - reach * ca, wa.z - reach * sa, wa.x + reach * ca, wa.z + reach * sa);
        qs.push(wb.x, wb.z, wb.x + reach * cb, wb.z + reach * sb, wb.x - reach * cb, wb.z - reach * sb);
      }
      if (ps.length === 0) continue;
      moved = Math.max(moved, fitRigid(poses.get(id)!, ps, qs));
    }
    if (moved < SETTLED) break;
  }
}

const psScratch: number[] = [];
const qsScratch: number[] = [];

/**
 * How far each joint of `ids` (and each near miss being closed) is turned off true, by its lower connector ref: where
 * the pieces are in `poses`, or (null) where the layout has them.
 */
function jointTurns(layout: Layout, ids: readonly number[], poses: Map<number, Pose> | null): Map<number, number> {
  const out = new Map<number, number>();
  for (const id of ids) {
    const piece = layout.getPiece(id)!;
    const count = getPieceDef(piece.type, piece.flipped).connectors.length;
    for (let i = 0; i < count; i++) {
      const ref = connectorRef(id, i);
      const partner = partnerOf(ref);
      if (partner === -1) continue;
      const otherId = pieceOfRef(partner);
      connectorAt(layout, ref, poses?.get(id) ?? piece.pose, wa);
      connectorAt(layout, partner, poses?.get(otherId) ?? layout.getPiece(otherId)!.pose, wb);
      out.set(Math.min(ref, partner), angleDiff(wa.heading, wb.heading + Math.PI));
    }
  }
  return out;
}

/**
 * Is every joint of `ids` (and near miss being closed) turned within the joint tolerance at `poses`, or, if it was
 * already past it (`before`: an older build's joint, loaded as it was saved), no further?
 */
function withinTurn(layout: Layout, ids: readonly number[], poses: Map<number, Pose>, before: ReadonlyMap<number, number>): boolean {
  for (const [a, turn] of jointTurns(layout, ids, poses)) {
    const was = layout.joinedConnector(a) !== -1 ? (before.get(a) ?? 0) : 0;
    if (turn > Math.max(JOINT_ANGLE_TOLERANCE, was) + 1e-9) return false;
  }
  return true;
}

function forPartners(layout: Layout, id: number, visit: (other: number) => void): void {
  const piece = layout.getPiece(id)!;
  const count = getPieceDef(piece.type, piece.flipped).connectors.length;
  for (let i = 0; i < count; i++) {
    const partner = partnerOf(connectorRef(id, i));
    if (partner !== -1) visit(pieceOfRef(partner));
  }
}

/** A connector's world position for its piece at `pose` (instead of where the layout has the piece). */
function connectorAt(layout: Layout, ref: number, pose: Pose, out: typeof wa): void {
  const piece = layout.getPiece(pieceOfRef(ref))!;
  const c = getPieceDef(piece.type, piece.flipped).connectors[indexOfRef(ref)];
  const ch = Math.cos(pose.heading);
  const sh = Math.sin(pose.heading);
  out.x = pose.x + c.pose.x * ch - c.pose.z * sh;
  out.z = pose.z + c.pose.x * sh + c.pose.z * ch;
  out.heading = pose.heading + c.pose.heading;
}

/** Worst seating error over the joints of `ids`, the angle counted as its reach along the track. */
function worstSlack(layout: Layout, ids: readonly number[], poses: Map<number, Pose>): number {
  let worst = 0;
  for (const id of ids) {
    const piece = layout.getPiece(id)!;
    const count = getPieceDef(piece.type, piece.flipped).connectors.length;
    for (let i = 0; i < count; i++) {
      const ref = connectorRef(id, i);
      const partner = partnerOf(ref);
      if (partner === -1) continue;
      const otherId = pieceOfRef(partner);
      connectorAt(layout, ref, poses.get(id)!, wa);
      connectorAt(layout, partner, poses.get(otherId) ?? layout.getPiece(otherId)!.pose, wb);
      const twist = Math.abs(Math.sin(wa.heading - wb.heading - Math.PI)) * REACH;
      worst = Math.max(worst, Math.hypot(wa.x - wb.x, wa.z - wb.z), twist);
    }
  }
  return worst;
}

/**
 * Move `pose` rigidly (in plan) so the points `ps` (flat x,z pairs, attached to the piece) best meet `qs`.
 * Returns how far the piece moved (mm, the turn counted at REACH).
 */
function fitRigid(pose: Pose, ps: readonly number[], qs: readonly number[]): number {
  const n = ps.length / 2;
  let px = 0;
  let pz = 0;
  let qx = 0;
  let qz = 0;
  for (let i = 0; i < n; i++) {
    px += ps[2 * i];
    pz += ps[2 * i + 1];
    qx += qs[2 * i];
    qz += qs[2 * i + 1];
  }
  px /= n;
  pz /= n;
  qx /= n;
  qz /= n;
  let dot = 0;
  let cross = 0;
  for (let i = 0; i < n; i++) {
    const ax = ps[2 * i] - px;
    const az = ps[2 * i + 1] - pz;
    const bx = qs[2 * i] - qx;
    const bz = qs[2 * i + 1] - qz;
    dot += ax * bx + az * bz;
    cross += ax * bz - az * bx;
  }
  const turn = n > 1 ? Math.atan2(cross, dot) : 0;
  const ct = Math.cos(turn);
  const st = Math.sin(turn);
  // Turn the piece about the points' centre, then carry that centre onto the targets' centre.
  const ox = pose.x - px;
  const oz = pose.z - pz;
  const nx = qx + ox * ct - oz * st;
  const nz = qz + ox * st + oz * ct;
  const moved = Math.max(Math.hypot(nx - pose.x, nz - pose.z), Math.abs(turn) * REACH);
  pose.x = nx;
  pose.z = nz;
  pose.heading += turn;
  return moved;
}

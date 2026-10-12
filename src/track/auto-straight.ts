import { JOINT_ANGLE_TOLERANCE, JOINT_POS_TOLERANCE } from "./constants";
import { createWorldConnector, pieceOfRef, type Layout } from "./layout";
import { normalizeAngle, type Pose } from "./math";
import type { PieceTypeId } from "./pieces";

/** The auto straight's lengths (mm), every 18 mm from the tiny straight up to the long one, which it starts as. */
export const AUTO_LENGTHS = [36, 54, 72, 90, 108, 126, 144, 162, 180, 198, 216] as const;
export const AUTO_FULL = 216;

const t = createWorldConnector();
const near: number[] = [];

/**
 * The auto straight, held as a long straight seated by one end (connector 0, its hole, at `pose`; or connector 1,
 * its peg, `AUTO_FULL` along), shrinks so its other end meets the nearest free end of the right kind lying along its
 * line inside its length. Returns the length and where the piece then goes (null: nothing to meet; stay long).
 */
export function fitAutoStraight(layout: Layout, pose: Pose, y: number, seated: 0 | 1, ignore: readonly number[]): { length: number; type: PieceTypeId; pose: Pose } | null {
  const dx = Math.cos(pose.heading);
  const dz = Math.sin(pose.heading);
  // Seated by its hole: look forward for a hole facing back. Seated by its peg: look back for a peg facing forward.
  const sign = seated === 0 ? 1 : -1;
  const ax = seated === 0 ? pose.x : pose.x + dx * AUTO_FULL;
  const az = seated === 0 ? pose.z : pose.z + dz * AUTO_FULL;
  const kind = seated === 0 ? "socket" : "peg";
  const facing = seated === 0 ? pose.heading + Math.PI : pose.heading;
  let best = Infinity;
  let length = 0;
  const n = layout.queryFreeConnectors(ax + (sign * dx * AUTO_FULL) / 2, az + (sign * dz * AUTO_FULL) / 2, AUTO_FULL / 2 + JOINT_POS_TOLERANCE, near);
  for (let i = 0; i < n; i++) {
    if (ignore.includes(pieceOfRef(near[i]))) continue;
    layout.worldConnector(near[i], t);
    if (t.kind !== kind || Math.abs(t.y - y) > 2 || Math.abs(normalizeAngle(t.heading - facing)) > JOINT_ANGLE_TOLERANCE) continue;
    const rx = t.x - ax;
    const rz = t.z - az;
    const along = sign * (rx * dx + rz * dz);
    const across = Math.abs(-rx * dz + rz * dx);
    if (across > JOINT_POS_TOLERANCE || along >= best) continue;
    const fit = AUTO_LENGTHS.reduce((a, b) => (Math.abs(b - along) < Math.abs(a - along) ? b : a));
    if (Math.abs(fit - along) > JOINT_POS_TOLERANCE) continue;
    best = along;
    length = fit;
  }
  if (length === 0) return null;
  const at = seated === 0 ? { ...pose } : { x: ax - dx * length, z: az - dz * length, heading: pose.heading };
  return { length, type: `straight-${length}` as PieceTypeId, pose: at };
}

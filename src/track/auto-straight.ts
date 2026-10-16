import { JOINT_POS_TOLERANCE } from "./constants";
import { createWorldConnector, pieceOfRef, type Layout } from "./layout";
import { normalizeAngle, type Pose } from "./math";
import { FIT_LENGTHS, JOIN_SIZES, joinType, type PieceTypeId } from "./pieces";

/** The auto straight's lengths (mm), every 18 mm from the tiny straight up to the long one, which it starts as. */
export const AUTO_LENGTHS = FIT_LENGTHS;
export const AUTO_FULL = 216;

const t = createWorldConnector();
const near: number[] = [];

/** How far off facing it (radians) an end the auto piece meets may be: the near-miss angle the editor closes. */
export const AUTO_ANGLE = (12 * Math.PI) / 180;

/** How far to the side (mm) the auto piece looks for an end to meet with a join (an S-bend). */
export const AUTO_REACH_ACROSS = 90;

/**
 * The auto straight, held as a long straight seated by one end (connector 0, its hole, at `pose`; or connector 1,
 * its peg, `AUTO_FULL` along), fits itself to the nearest free end facing it inside its length: a straight that
 * shrinks to meet an end on its line, or a join (an S-bend, `JOIN_SIZES`) to meet one a little to one side. Its far
 * end becomes whatever that end needs: two holes facing each other get a piece with a peg at both ends (`FitTypeId`).
 * Returns the piece, mirrored or not, and where it goes (null: nothing to meet; stay long).
 */
export function fitAutoStraight(layout: Layout, pose: Pose, y: number, seated: 0 | 1, ignore: readonly number[]): { length: number; type: PieceTypeId; pose: Pose; flipped: boolean } | null {
  const dx = Math.cos(pose.heading);
  const dz = Math.sin(pose.heading);
  // Seated by its hole: look forward for an end facing back. Seated by its peg: look back for one facing forward.
  const sign = seated === 0 ? 1 : -1;
  const ax = seated === 0 ? pose.x : pose.x + dx * AUTO_FULL;
  const az = seated === 0 ? pose.z : pose.z + dz * AUTO_FULL;
  const facing = seated === 0 ? pose.heading + Math.PI : pose.heading;
  let best = Infinity;
  let found: { length: number; offset: number; kind: "peg" | "socket" } | null = null;
  const n = layout.queryFreeConnectors(ax + (sign * dx * AUTO_FULL) / 2, az + (sign * dz * AUTO_FULL) / 2, Math.hypot(AUTO_FULL / 2, AUTO_REACH_ACROSS) + JOINT_POS_TOLERANCE, near);
  for (let i = 0; i < n; i++) {
    if (ignore.includes(pieceOfRef(near[i]))) continue;
    layout.worldConnector(near[i], t);
    // Either kind of end: the piece's far end becomes whatever meets it (a peg for a hole, a hole for a peg).
    // A few degrees off facing it still counts: once put down, the loose track gives to close the joint (as a near
    // miss is closed when a piece goes down).
    if (Math.abs(t.y - y) > 2 || Math.abs(normalizeAngle(t.heading - facing)) > AUTO_ANGLE) continue;
    const rx = t.x - ax;
    const rz = t.z - az;
    // Along the piece from its seated end, and to its left (as the piece runs, socket to peg).
    const along = sign * (rx * dx + rz * dz);
    const across = sign * (-rx * dz + rz * dx);
    if (along >= best || along <= 0) continue;
    let fit: { length: number; offset: number } | null = null;
    if (Math.abs(across) <= JOINT_POS_TOLERANCE) {
      const length = AUTO_LENGTHS.reduce((a, b) => (Math.abs(b - along) < Math.abs(a - along) ? b : a));
      if (Math.abs(length - along) <= JOINT_POS_TOLERANCE) fit = { length, offset: 0 };
    } else {
      for (const [length, offset] of JOIN_SIZES) {
        if (Math.abs(length - along) <= JOINT_POS_TOLERANCE && Math.abs(offset - Math.abs(across)) <= JOINT_POS_TOLERANCE) fit = { length, offset: Math.sign(across) * offset };
      }
    }
    if (!fit) continue;
    best = along;
    found = { ...fit, kind: t.kind };
  }
  if (!found) return null;
  const { length, offset } = found;
  // Any two ends join (peg or hole alike), so a plain straight or join meets it.
  const type: PieceTypeId = offset === 0 ? (`straight-${length}` as PieceTypeId) : joinType(length, Math.abs(offset));
  // Seated by its peg, the piece starts back along the line and over to the side, where the end it meets is.
  const at =
    seated === 0
      ? { ...pose }
      : { x: ax - dx * length + dz * offset, z: az - dz * length - dx * offset, heading: pose.heading };
  return { length, type, pose: at, flipped: offset < 0 };
}

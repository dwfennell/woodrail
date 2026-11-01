/**
 * Placing signal marks (docs/superpowers/specs/2026-10-31-signals.md §4): where a mark on a joint stands, which joint a
 * finger over the track snaps to and which way it faces, and the blocks a mark guards and ends (for the tint shown
 * while one is held or its card is open). Pure: no view, no sim. Cheap enough for a pointer move (a few pieces walked).
 */
import { connectorRef, createSample, getPieceDef, indexOfRef, normalizeAngle, pathLength, pieceOfRef, samplePath, type Layout } from "../track";
import type { Cursor } from "../sim";

/** A joint end as the mark stands on it: the joint (plan x, z; y the track's top) and the way trains cross it there. */
export interface JointPose {
  x: number;
  y: number;
  z: number;
  /** The way a train guarded by the mark is going as it crosses the joint (plan heading, radians). */
  heading: number;
}

const sample = createSample();

/** The path of a piece that ends at its connector `c` (null: none, or it ends at a buffer inside the piece). */
function pathEndingAt(layout: Layout, pieceId: number, c: number): { index: number; toEnd: boolean } | null {
  const p = layout.getPiece(pieceId);
  if (!p) return null;
  const def = getPieceDef(p.type, p.flipped);
  for (let i = 0; i < def.paths.length; i++) {
    const path = def.paths[i];
    if (path.to === c) return { index: i, toEnd: true };
    if (path.from === c && path.to !== null) return { index: i, toEnd: false };
  }
  return null;
}

/** Where a mark at joint end `at` (a connector ref: trains cross from its piece) stands, or null if `at` is no joint. */
export function jointPose(layout: Layout, at: number): JointPose | null {
  const id = pieceOfRef(at);
  const p = layout.getPiece(id);
  const end = pathEndingAt(layout, id, indexOfRef(at));
  if (!p || !end) return null;
  const geom = getPieceDef(p.type, p.flipped).paths[end.index].geom;
  samplePath(geom, end.toEnd ? pathLength(geom) : 0, sample);
  const ch = Math.cos(p.pose.heading);
  const sh = Math.sin(p.pose.heading);
  return {
    x: p.pose.x + sample.x * ch - sample.z * sh,
    z: p.pose.z + sample.x * sh + sample.z * ch,
    y: p.y + sample.y,
    heading: normalizeAngle(p.pose.heading + sample.heading + (end.toEnd ? 0 : Math.PI)),
  };
}

/** How far (mm) to the right of the track a mark's post stands, and back from its joint. */
export const POST_SIDE = 26;
export const POST_BACK = 10;

/** Where a mark's post stands (plan x, z), on the driver's right just short of the joint, and the joint's pose. */
export function postAt(layout: Layout, at: number): (JointPose & { px: number; pz: number }) | null {
  const j = jointPose(layout, at);
  if (!j) return null;
  const c = Math.cos(j.heading);
  const s = Math.sin(j.heading);
  // (Heading h runs along (cos h, sin h); the driver's right is (−sin h, cos h), as a signal piece's post at +z.)
  return { ...j, px: j.x - c * POST_BACK - s * POST_SIDE, pz: j.z - s * POST_BACK + c * POST_SIDE };
}

/** The plan heading a cursor's path runs along from its `from` end to its `to` end, where the cursor is. */
export function pathHeading(layout: Layout, c: Cursor): number {
  const p = layout.getPiece(c.pieceId)!;
  const geom = getPieceDef(p.type, p.flipped).paths[c.pathIndex].geom;
  const len = pathLength(geom);
  samplePath(geom, c.reversed ? len - c.s : c.s, sample);
  return normalizeAngle(p.pose.heading + sample.heading);
}

/**
 * The joint end a mark held over this cursor goes on: the nearer joint of the piece under the finger (the other if that
 * end is joined to nothing), facing so it guards trains going `dir` along the path (+1: from its `from` end to its
 * `to` end; −1: back). −1: no joint at either end.
 */
export function snapJoint(layout: Layout, c: Cursor, dir: 1 | -1): number {
  const p = layout.getPiece(c.pieceId);
  if (!p) return -1;
  const def = getPieceDef(p.type, p.flipped);
  const path = def.paths[c.pathIndex];
  if (!path || path.to === null) return -1;
  const len = pathLength(path.geom);
  const u = c.reversed ? len - c.s : c.s;
  const ends: { conn: number; towards: 1 | -1 }[] = [
    { conn: path.to, towards: 1 },
    { conn: path.from, towards: -1 },
  ];
  // (The nearer end first.)
  if (u < len / 2) ends.reverse();
  for (const e of ends) {
    const ref = connectorRef(c.pieceId, e.conn);
    const other = layout.joinedConnector(ref);
    if (other === -1) continue;
    // Going toward this end: trains cross it from this piece. Going away: they cross it from the piece beyond.
    return dir === e.towards ? ref : other;
  }
  return -1;
}

/** A block: each piece and the paths of it (a bit each) the block takes. */
export type Block = Map<number, number>;

/** The paths (a bit each) of a piece that end at its connector `c`. */
function pathsAt(layout: Layout, pieceId: number, c: number): number {
  const p = layout.getPiece(pieceId)!;
  const def = getPieceDef(p.type, p.flipped);
  let bits = 0;
  def.paths.forEach((path, i) => {
    if (path.from === c || path.to === c) bits |= 1 << i;
  });
  return bits;
}

const MAX_BLOCK = 400;

/**
 * The track reachable from entering `pieceId` by its connector `entry`, every way through points, till any mark (`marks`:
 * joint ends; one facing on at a joint: the block ends there; facing back, it ends at it too), a signal piece (on it), a
 * buffer or an open end. As the sim's blocks (`Sim.findBlock`).
 */
function reach(layout: Layout, pieceId: number, entry: number, marks: ReadonlySet<number>, out: Block): void {
  const stack: [number, number][] = [[pieceId, entry]];
  const seen = new Set<number>();
  while (stack.length > 0 && out.size < MAX_BLOCK) {
    const [id, at] = stack.pop()!;
    const key = connectorRef(id, at);
    if (seen.has(key)) continue;
    seen.add(key);
    const p = layout.getPiece(id);
    if (!p) continue;
    const def = getPieceDef(p.type, p.flipped);
    const ways = pathsAt(layout, id, at);
    out.set(id, (out.get(id) ?? 0) | ways);
    if (def.signal) continue;
    def.paths.forEach((path, i) => {
      if (((ways >> i) & 1) === 0) return;
      const exit = path.from === at ? path.to : path.from;
      if (exit === null || exit === undefined) return;
      const ref = connectorRef(id, exit);
      if (marks.has(ref)) return;
      const n = layout.joinedConnector(ref);
      if (n === -1 || marks.has(n)) return;
      stack.push([pieceOfRef(n), indexOfRef(n)]);
    });
  }
}

/** Every mark's joint end on the layout, and `also` (a mark not yet placed). */
function markSet(layout: Layout, also: number, ignore = -1): Set<number> {
  const s = new Set<number>();
  for (const m of layout.signals()) if (m.id !== ignore) s.add(m.at);
  if (also !== -1) s.add(also);
  return s;
}

/**
 * The block a mark at `at` guards (ahead: past its joint) and the one it ends (behind: its approach piece and on back
 * from it), as if it were placed there (signals spec §4: tinted green and blue). `ignore`: a mark (id) left out (one
 * being moved).
 */
export function blocksOf(layout: Layout, at: number, ignore = -1): { ahead: Block; behind: Block } {
  const ahead: Block = new Map();
  const behind: Block = new Map();
  const marks = markSet(layout, at, ignore);
  const past = layout.joinedConnector(at);
  if (past !== -1) reach(layout, pieceOfRef(past), indexOfRef(past), marks, ahead);
  // (Behind: into its approach piece by the joint, the other way.)
  reach(layout, pieceOfRef(at), indexOfRef(at), marks, behind);
  return { ahead, behind };
}

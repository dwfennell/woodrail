/**
 * Placing signal marks (docs/superpowers/specs/2026-10-31-signals.md §4): where a mark on a joint stands, which joint a
 * finger over the track snaps to and which way it faces, and the blocks a mark guards and ends (for the tint shown
 * while one is held or its card is open). Pure: no view, no sim. Cheap enough for a pointer move (a few pieces walked).
 */
import { connectorRef, createSample, DOUBLE_TRACK_SPACING, getPieceDef, indexOfRef, normalizeAngle, pathLength, pieceOfRef, samplePath, TRACK_WIDTH, type Layout } from "../track";
import type { Cursor } from "../sim";
import { closestS } from "../sim/nearest";
import { FEAT_BUILDING, FEAT_DEPOT, FEAT_FIELD, FEAT_RUIN, FEAT_SECRET, FEAT_SHED, FEAT_STATION, SURF_ROAD, SURF_SEA, inRiver, isWater, onFixedSite, type Landscape } from "../landscape";
import { hillsOf } from "../landscape/hill-shape";

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

/**
 * Where a mark's post stands from its joint (mm): this far out from the track's centre line, and back from the joint
 * along it. The drawn toy light (`signal-marks-view.ts`), its ghost in the hand and the clearance check all read these,
 * so a signal stands where its preview showed.
 */
export const POST_SIDE = TRACK_WIDTH / 2 + 13;
export const POST_BACK = 20;
/** How far around its post a mark takes room (mm): its foot and its head over it, with a little to spare. */
export const POST_ROOM = 8;

/** A mark as it stands: its joint, its post (plan x, z) and the side it's on (+1 the driver's right, −1 the left). */
export interface MarkStand extends JointPose {
  px: number;
  pz: number;
  side: 1 | -1;
  /** False when neither side has room (the post stands on the right, in the way): such a mark isn't put down. */
  room: boolean;
  /** With no room: what's in the way on the driver's right (`TRACK`, `AIR`, or a phrase: "a hill", "the river"). */
  why: string | null;
}

/** Other track is in the way of a post (`MarkStand.why`). */
export const TRACK = "track";
/** No ground beside the line at its height: it's raised (a bridge, a viaduct, risers, a ramp's top), the post in the air. */
export const AIR = "air";

/**
 * What's in a post's way on the ground at plan (x, z) beside a joint at height `y` (a phrase, or `AIR`), or null where
 * it's open ground at that height. One per map, set by the game (`setPostGround`): the landscape and what the player
 * has put on it (yards, props). A layout with none (a test's bare track) has open ground everywhere.
 */
export type PostGround = (x: number, z: number, y: number) => string | null;
const grounds = new WeakMap<Layout, PostGround>();

/** Use `ground` for where posts may stand by this layout's track (null: open ground everywhere). */
export function setPostGround(layout: Layout, ground: PostGround | null): void {
  if (ground) grounds.set(layout, ground);
  else grounds.delete(layout);
}

/** How far the ground may be off the joint's height for a post to stand on it (mm): a cutting's bank, a hill's edge. */
const GROUND_SLACK = 3;

/**
 * The landscape's part of `PostGround`, as track's own placement rules see it (`checkPlacement`): a house,
 * a field, the shed, a station's, depot's or old yard's footprint, a town's street, a road, the river or sea as drawn;
 * then the ground's height: higher than the joint is a hill's side (or a cutting's bank), lower is no ground (`AIR`).
 * A town's green takes a post, as it takes track.
 */
export function groundForPost(land: Landscape, x: number, z: number, y: number): string | null {
  const g = land.grid;
  const i = g.cellAtWorld(x, z);
  // (Past the land's edge: the table, flat at the felt's height. A post by a line along the last square stands there.)
  if (i === -1) return y > GROUND_SLACK ? AIR : null;
  const f = g.feature[i];
  if (f === FEAT_BUILDING) return "a house";
  if (f === FEAT_FIELD) return "a field";
  if (f === FEAT_SHED) return "the engine shed";
  if ((f === FEAT_STATION || f === FEAT_DEPOT || f === FEAT_RUIN || f === FEAT_SECRET) && onFixedSite(land, i, x, z))
    return f === FEAT_STATION ? "the station" : f === FEAT_DEPOT ? "a yard" : f === FEAT_RUIN ? "an old yard" : "something hidden";
  if (g.surface[i] === SURF_ROAD || g.road[i] !== 0) return "a road";
  if (isWater(g.surface[i]) && inRiver(g, x, z)) return g.surface[i] === SURF_SEA ? "the sea" : "the river";
  const ground = hillsOf(g).groundAt(x, z);
  if (ground > y + GROUND_SLACK) return "a hill";
  if (ground < y - GROUND_SLACK) return AIR;
  return null;
}

/** What's in the way of a post at plan (x, z) by a joint at height `y`: other track, then the ground (null: room). */
function postBlock(layout: Layout, x: number, y: number, z: number): string | null {
  if (!roomForPost(layout, x, y, z)) return TRACK;
  return grounds.get(layout)?.(x, z, y) ?? null;
}

/** What to say when a signal can't go somewhere: what's in the way (`MarkStand.why`). */
export function noRoomMessage(why: string | null): string {
  if (why === AIR) return "No ground beside the line there: it's raised. Put signals where the track runs on the ground";
  if (!why || why === TRACK) return "No room for a signal there: other track's in the way";
  // ("a hill's in the way", "swans are in the way".)
  return `No room for a signal there: ${why}${/[^s]s$/.test(why) ? " are" : "'s"} in the way`;
}

/** Where a post stands on `side` of joint `j` (plan x, z). */
function postOn(j: JointPose, side: 1 | -1): { x: number; z: number } {
  const c = Math.cos(j.heading);
  const s = Math.sin(j.heading);
  // (Heading h runs along (cos h, sin h); the driver's right is (−sin h, cos h), as a signal piece's post at +z.)
  return { x: j.x - c * POST_BACK - side * s * POST_SIDE, z: j.z - s * POST_BACK + side * c * POST_SIDE };
}

/** How far a piece's track reaches from its origin (plan, mm), per piece def: the clearance check's quick reject. */
const reachOf = new WeakMap<object, number>();
function pieceReach(def: ReturnType<typeof getPieceDef>): number {
  let r = reachOf.get(def);
  if (r !== undefined) return r;
  r = 0;
  for (const g of [...def.paths.map((p) => p.geom), ...(def.web ? [def.web] : [])]) {
    const len = pathLength(g);
    for (let k = 0; k <= 16; k++) {
      samplePath(g, (len * k) / 16, sample);
      r = Math.max(r, Math.hypot(sample.x, sample.z));
    }
  }
  reachOf.set(def, r);
  return r;
}

/** Track this far below a post's foot, or up to this far above it, is in its way (mm): a line on a bridge overhead is not. */
const BELOW = 24;
const ABOVE = 70;
const near: { lx: number; lz: number }[] = [];

/**
 * Is there room for a post at plan (x, z), a joint at height `y`: no track's board within `POST_ROOM` of it? Any piece's,
 * its own approach piece's other roads too: a centre line nearer than half a track's width and the room, or (on a piece
 * built as one board over two lines, a crossover's or a double track's: `web`) between two of its roads.
 */
export function roomForPost(layout: Layout, x: number, y: number, z: number): boolean {
  const clear = TRACK_WIDTH / 2 + POST_ROOM;
  for (const id of layout.pieceIds()) {
    if (layout.isLifted(id)) continue;
    const p = layout.getPiece(id)!;
    const dx = x - p.pose.x;
    const dz = z - p.pose.z;
    const def = getPieceDef(p.type, p.flipped);
    const reach = pieceReach(def) + clear + DOUBLE_TRACK_SPACING;
    if (dx * dx + dz * dz > reach * reach) continue;
    const ch = Math.cos(p.pose.heading);
    const sh = Math.sin(p.pose.heading);
    const lx = dx * ch + dz * sh;
    const lz = -dx * sh + dz * ch;
    near.length = 0;
    for (const path of def.paths) {
      const g = path.geom;
      const at = closestS(g, lx, lz);
      samplePath(g, at, sample);
      const dy = p.y + sample.y - y;
      if (dy < -BELOW || dy > ABOVE) continue;
      const d = Math.hypot(sample.x - lx, sample.z - lz);
      if (d < clear) return false;
      // (Square across the road there, not off its end: a post just past a board's end is beside it, not on it.)
      if (def.web && d < DOUBLE_TRACK_SPACING + clear && at > 0.5 && at < pathLength(g) - 0.5) near.push({ lx: sample.x - lx, lz: sample.z - lz });
    }
    // (Between two roads of one board: their nearest points lie on opposite sides of the post.)
    for (let i = 0; i < near.length; i++)
      for (let k = i + 1; k < near.length; k++) if (near[i].lx * near[k].lx + near[i].lz * near[k].lz < 0) return false;
  }
  return true;
}

/**
 * Where a mark at joint end `at` stands: its post on the driver's right just short of the joint, or on the left when
 * the right has no room (`postBlock`: other track, the other road of points or a crossover, a parallel line; or the
 * ground: a hill's side, a house, the river, no ground at all beside raised track). Neither has: `room` false (on the
 * right), with what's in the way there. Null if `at` is no joint. The one place a mark's stand is worked out, for the
 * drawn mark, its ghost in the hand and where a drop is let go.
 */
export function standAt(layout: Layout, at: number): MarkStand | null {
  const j = jointPose(layout, at);
  if (!j) return null;
  let why: string | null = null;
  for (const side of [1, -1] as const) {
    const q = postOn(j, side);
    const block = postBlock(layout, q.x, j.y, q.z);
    if (!block) return { ...j, px: q.x, pz: q.z, side, room: true, why: null };
    why ??= block;
  }
  const q = postOn(j, 1);
  return { ...j, px: q.x, pz: q.z, side: 1, room: false, why };
}

/** Where a mark's post stands (plan x, z) and the joint's pose (`standAt`). */
export function postAt(layout: Layout, at: number): MarkStand | null {
  return standAt(layout, at);
}

/** Has a mark at joint end `at` room to stand on either side? (False for no joint.) */
export function hasRoom(layout: Layout, at: number): boolean {
  return standAt(layout, at)?.room ?? false;
}

/** What to say when a signal can't go on joint end `at` (`noRoomMessage`). */
export function noRoomAt(layout: Layout, at: number): string {
  return noRoomMessage(standAt(layout, at)?.why ?? null);
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
 * end is joined to nothing, or `ok` refuses it), facing so it guards trains going `dir` along the path (+1: from its
 * `from` end to its `to` end; −1: back). −1: no joint at either end.
 */
export function snapJoint(layout: Layout, c: Cursor, dir: 1 | -1, ok?: (at: number) => boolean): number {
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
    const at = dir === e.towards ? ref : other;
    // (No room there (`ok`): the piece's other joint, so a signal held by a crossover still finds somewhere to go.)
    if (ok && !ok(at)) continue;
    return at;
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

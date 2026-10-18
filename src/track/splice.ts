import { connectorRef, createWorldConnector, indexOfRef, pieceOfRef, type Layout } from "./layout";
import { JOINT_ANGLE_TOLERANCE, JOINT_POS_TOLERANCE, SWITCH_LENGTH } from "./constants";
import { angleDiff, normalizeAngle, solveParentPose, transformPose, type Pose } from "./math";
import { FIT_LENGTHS, getPieceDef, PIECE_TYPES, type ConnectorKind, type PieceTypeId } from "./pieces";

/**
 * A straight-shaped piece (a depot, a station) dropped onto a line: the plain straights it takes the place of, and
 * where it goes, end to end with the track either side. `misfit`: over a straight, but no run of straights there is
 * its length; `busy`: a train stands on that straight.
 */
export type Splice =
  | { readonly kind: "splice"; readonly covers: readonly number[]; readonly pose: Pose; readonly y: number; readonly rest?: readonly FillPiece[] }
  | { readonly kind: "misfit" | "busy"; readonly onto: number }
  | { readonly kind: "none" };

const NONE: Splice = { kind: "none" };
/** Lengths (mm) that add up within this count as equal (track joints have a little play). */
const LENGTH_SLACK = 0.5;
/** Joined straights this far off parallel (radians) are still one line. */
const LINE_ANGLE = 0.02;
/** A gap's two ends this far off facing each other along it (radians: a joint's play) are still in line. */
const GAP_ANGLE = 0.05;
/** Pieces placed in the same spot as the straight they'd replace this far up or down (mm) count as on it. */
const SAME_HEIGHT = 1;
/** Held square across a line, the piece lies along it as if held turned this little (radians) further back. */
const TIE_TURN = 1e-3;
/** Choosing which straight its track is over: each mm from its middle counts as this many mm off the line. */
const MIDDLE_WEIGHT = 0.25;

const PLAIN_STRAIGHT = /^straight-\d+$/;

/** A plain straight (not a signal, bridge, adapter or joiner): what a depot may be dropped onto. */
export const isPlainStraight = (type: PieceTypeId): boolean => PLAIN_STRAIGHT.test(type);

/** Each piece type's length as a plain straight, or 0 (worked out once per type: read on every pointer move). */
const plainLengths = new Map<PieceTypeId, number>();
function plainLength(type: PieceTypeId): number {
  let l = plainLengths.get(type);
  if (l === undefined) {
    l = isPlainStraight(type) ? straightLength(type, false) : 0;
    plainLengths.set(type, l);
  }
  return l;
}

/** A straight piece's length, or 0 if it isn't one straight line between two ends (curves, switches, ramps). */
export function straightLength(type: PieceTypeId, flipped: boolean): number {
  const def = getPieceDef(type, flipped);
  if (def.connectors.length !== 2 || def.paths.length !== 1 || def.isSwitch) return 0;
  const g = def.paths[0].geom;
  if (g.kind !== "line" || g.rise !== 0 || g.start.x !== 0 || g.start.z !== 0 || g.start.heading !== 0) return 0;
  const end = def.connectors[1].pose;
  return Math.abs(end.z) < 1e-6 && Math.abs(end.x - g.length) < 1e-6 ? g.length : 0;
}

const a = createWorldConnector();
const b = createWorldConnector();

/**
 * Where a held piece's centre is, seen at a height (it's under the finger, which points at different spots at
 * different heights), or null if the finger points nowhere at that height. A point: the same at every height.
 */
export type HeldCentre = { x: number; z: number } | ((y: number) => { x: number; z: number } | null);

/**
 * Where would a straight-shaped piece `type`, held with its centre at `centre` (seen at the height of each straight
 * it may be over) and turned to `heading`, go if it were dropped onto the plain straight its track is over (some
 * part of its track within `reach` mm of the straight's centre line: held across a line, its middle may be well off
 * it)? It takes the place of that straight, or of a run of straights joined in line with it whose
 * lengths add up to its own, and lies along the line, whichever way round is nearer to how it's held (so turning it
 * right round puts its building on the other side).
 * `canTake` says which straights may be taken up (none a train stands on); `skip`, straights not to drop it onto at all
 * (as if not there). Called on pointer move while a depot is held: one pass over the pieces, then a short walk along
 * the line.
 */
export function findSplice(
  layout: Layout,
  type: PieceTypeId,
  flipped: boolean,
  centre: HeldCentre,
  heading: number,
  reach: number,
  canTake: (pieceId: number) => boolean = () => true,
  skip?: ReadonlySet<number>,
): Splice {
  const length = straightLength(type, flipped);
  if (length === 0) return NONE;
  const at = typeof centre === "function" ? centre : () => centre;
  const half = length / 2;
  const hc = Math.cos(heading);
  const hs = Math.sin(heading);
  // The plain straight its own track (held along `heading`, `length` long, through the held centre) comes nearest,
  // within `reach` of its centre line: held across a line with its middle well off it, its track still crosses it.
  // Of those, the one met nearest its middle (a straight under the middle is taken over one under an end).
  let onto = -1;
  let best = Infinity;
  const held = { x: 0, z: 0 };
  for (const id of layout.pieceIds()) {
    const p = layout.getPiece(id)!;
    const l = plainLength(p.type);
    if (l === 0 || layout.isLifted(id) || skip?.has(id)) continue;
    const c = at(p.y);
    if (!c) continue;
    const dx = c.x - p.pose.x;
    const dz = c.z - p.pose.z;
    if (Math.abs(dx) > l + half + reach || Math.abs(dz) > l + half + reach) continue;
    const ch = Math.cos(p.pose.heading);
    const sh = Math.sin(p.pose.heading);
    // The held track in this straight's frame: along = a0 + t·ca, across = c0 + t·sa, for t in [−half, half].
    const a0 = ch * dx + sh * dz;
    const c0 = -sh * dx + ch * dz;
    const ca = ch * hc + sh * hs;
    const sa = ch * hs - sh * hc;
    // The part of it beside the straight (0 ≤ along ≤ l).
    let lo = -half;
    let hi = half;
    if (Math.abs(ca) > 1e-9) {
      const t0 = -a0 / ca;
      const t1 = (l - a0) / ca;
      lo = Math.max(lo, Math.min(t0, t1));
      hi = Math.min(hi, Math.max(t0, t1));
    } else if (a0 < 0 || a0 > l) continue;
    if (lo > hi) continue;
    // Where on that part it comes nearest the centre line (nearest its own middle, if all of it is as near).
    const t = Math.abs(sa) > 1e-9 ? Math.min(hi, Math.max(lo, -c0 / sa)) : Math.min(hi, Math.max(lo, 0));
    const across = Math.abs(c0 + t * sa);
    if (across >= reach) continue;
    const score = across + MIDDLE_WEIGHT * Math.abs(t);
    if (score >= best) continue;
    onto = id;
    best = score;
    held.x = c.x + t * hc;
    held.z = c.z + t * hs;
  }
  if (onto === -1) return NONE;
  if (!canTake(onto)) return { kind: "busy", onto };
  const here = layout.getPiece(onto)!;
  const own = plainLength(here.type);
  // The straights joined in line beyond each end, as far as could be needed: [ids, lengths, the run's far end].
  const side = (end: 0 | 1) => {
    const ids: number[] = [];
    const lengths: number[] = [];
    const ends: number[] = [connectorRef(onto, end)];
    let total = own;
    let ref = connectorRef(onto, end);
    while (total < length - LENGTH_SLACK) {
      const partner = layout.joinedConnector(ref);
      if (partner === -1) break;
      const id = pieceOfRef(partner);
      const p = layout.getPiece(id);
      const l = p ? plainLength(p.type) : 0;
      if (!p || l === 0 || id === onto || ids.includes(id) || !canTake(id) || skip?.has(id)) break;
      if (Math.abs(p.y - here.y) > SAME_HEIGHT || angleDiff(2 * p.pose.heading, 2 * here.pose.heading) > 2 * LINE_ANGLE) break;
      ids.push(id);
      lengths.push(l);
      total += l;
      ref = connectorRef(id, 1 - indexOfRef(partner));
      ends.push(ref);
    }
    return { ids, lengths, ends };
  };
  const back = side(0);
  const ahead = side(1);
  // Of the runs through this straight that are just the right length, the one centred nearest where it's held.
  let pick: { from: number; to: number; off: number } | null = null;
  let behind = 0;
  for (let i = 0; i <= back.ids.length; i++) {
    if (i > 0) behind += back.lengths[i - 1];
    let beyond = 0;
    for (let j = 0; j <= ahead.ids.length; j++) {
      if (j > 0) beyond += ahead.lengths[j - 1];
      const total = own + behind + beyond;
      if (total > length + LENGTH_SLACK) break;
      if (total < length - LENGTH_SLACK) continue;
      layout.worldConnector(back.ends[i], a);
      layout.worldConnector(ahead.ends[j], b);
      const off = Math.hypot((a.x + b.x) / 2 - held.x, (a.z + b.z) / 2 - held.z);
      if (!pick || off < pick.off) pick = { from: i, to: j, off };
    }
  }
  if (!pick) return halfOf(layout, onto, here.y, own, length, held, heading) ?? { kind: "misfit", onto };
  layout.worldConnector(back.ends[pick.from], a);
  layout.worldConnector(ahead.ends[pick.to], b);
  const covers = [...back.ids.slice(0, pick.from).reverse(), onto, ...ahead.ids.slice(0, pick.to)];
  // Lie along the line from one far end to the other, whichever way round is nearer to how it's held. Held square
  // across the line, it's a tie: a hair's turn decides it, the same way every time, so turning it right round (Flip)
  // always swaps it.
  const h = Math.atan2(b.z - a.z, b.x - a.x);
  const pose = angleDiff(h, heading - TIE_TURN) < Math.PI / 2 ? { x: a.x, z: a.z, heading: normalizeAngle(h) } : { x: b.x, z: b.z, heading: normalizeAngle(h + Math.PI) };
  return { kind: "splice", covers, pose, y: here.y };
}

/** Held this near (mm) the joint between two straights, it's as much over the one as the other (unless told). */
const JOINT_REACH = 36;

/**
 * `findSplice`, but held at a joint between straights where the one it picks won't do (`fits` says no: too few trees
 * by it, no room for its yard), the straight on the other side of the joint, if it fits there. Only at the joint:
 * the two places share an end, and the held centre or `near` (the finger: on touch the piece is drawn above it) is
 * within `jointReach` of it. So a piece held over the middle of a straight never hops along the line to the next, nor
 * onto another line. `fits` is asked of the first splice, and of the other only when the first won't do and it's at
 * the joint (a few placement checks, on pointer move while a depot is held).
 */
export function findSpliceThatFits(
  layout: Layout,
  type: PieceTypeId,
  flipped: boolean,
  centre: HeldCentre,
  heading: number,
  reach: number,
  canTake: (pieceId: number) => boolean,
  fits: (s: Extract<Splice, { kind: "splice" }>) => boolean,
  near: HeldCentre = centre,
  jointReach = JOINT_REACH,
): Splice {
  const s = findSplice(layout, type, flipped, centre, heading, reach, canTake);
  if (s.kind !== "splice" || fits(s)) return s;
  const length = straightLength(type, flipped);
  const ends = (f: Pose) => [
    { x: f.x, z: f.z },
    { x: f.x + Math.cos(f.heading) * length, z: f.z + Math.sin(f.heading) * length },
  ];
  const close = (h: HeldCentre, at: { x: number; z: number }) => {
    const c = typeof h === "function" ? h(s.y) : h;
    return !!c && Math.hypot(c.x - at.x, c.z - at.z) <= jointReach;
  };
  const [a, b] = ends(s.pose);
  for (const [joint, from] of [
    [a, b],
    [b, a],
  ]) {
    if (!close(near, joint) && !close(centre, joint)) continue;
    // Held half its length on along the line, past that joint: what's there, end to end with this one.
    const k = length / 2 / Math.max(1e-9, Math.hypot(joint.x - from.x, joint.z - from.z));
    const past = { x: joint.x + (joint.x - from.x) * k, z: joint.z + (joint.z - from.z) * k };
    const other = findSplice(layout, type, flipped, past, heading, reach, canTake, new Set(s.covers));
    if (other.kind !== "splice" || Math.abs(other.y - s.y) > SAME_HEIGHT) continue;
    if (!ends(other.pose).some((e) => Math.hypot(e.x - joint.x, e.z - joint.z) < LENGTH_SLACK)) continue;
    if (fits(other)) return other;
  }
  return s;
}

/**
 * No run of straights its length, but the straight it's over is longer (a 108 kit on a line of 216s): it takes that
 * straight's place on the half nearer where it's held, and a shorter straight fills the rest. Null if no straight
 * fills what's left.
 */
function halfOf(layout: Layout, onto: number, y: number, own: number, length: number, held: { x: number; z: number }, heading: number): Splice | null {
  if (own <= length + LENGTH_SLACK) return null;
  const restTypes = straightsFor(own - length);
  if (!restTypes) return null;
  layout.worldConnector(connectorRef(onto, 0), a);
  layout.worldConnector(connectorRef(onto, 1), b);
  const dx = (b.x - a.x) / own;
  const dz = (b.z - a.z) / own;
  // The kit at the start (connector 0's end) or the end of the straight, whichever is nearer where it's held.
  const t = (held.x - a.x) * dx + (held.z - a.z) * dz;
  const kitFrom = t < own / 2 ? 0 : own - length;
  const restFrom = kitFrom === 0 ? length : 0;
  const ka = { x: a.x + dx * kitFrom, z: a.z + dz * kitFrom };
  const kb = { x: a.x + dx * (kitFrom + length), z: a.z + dz * (kitFrom + length) };
  const h = Math.atan2(kb.z - ka.z, kb.x - ka.x);
  const pose = angleDiff(h, heading - TIE_TURN) < Math.PI / 2 ? { x: ka.x, z: ka.z, heading: normalizeAngle(h) } : { x: kb.x, z: kb.z, heading: normalizeAngle(h + Math.PI) };
  const rest: FillPiece[] = [];
  let at = restFrom;
  for (const type of restTypes) {
    rest.push({ type, pose: { x: a.x + dx * at, z: a.z + dz * at, heading: normalizeAngle(h) }, y });
    at += plainLength(type);
  }
  return { kind: "splice", covers: [onto], pose, y, rest };
}

/** A plain straight to put down: one piece of a gap's fill. */
export interface FillPiece {
  readonly type: PieceTypeId;
  readonly pose: Pose;
  readonly y: number;
}

/** Plain straights and their lengths, longest first (worked out once). */
let straightTypes: { type: PieceTypeId; length: number }[] | null = null;
function plainStraights(): { type: PieceTypeId; length: number }[] {
  return (straightTypes ??= PIECE_TYPES.map((type) => ({ type, length: plainLength(type) }))
    .filter((s) => s.length > 0)
    .sort((x, y) => y.length - x.length));
}

/**
 * Plain straights whose lengths add up to `length` (within the joints' play): one if there's one that long, else two,
 * longest first and as near the same length as can be. Null if no one or two do.
 */
export function straightsFor(length: number): PieceTypeId[] | null {
  const all = plainStraights();
  const one = all.find((s) => Math.abs(s.length - length) <= LENGTH_SLACK);
  if (one) return [one.type];
  let best: PieceTypeId[] | null = null;
  let spread = Infinity;
  for (const x of all) {
    for (const y of all) {
      if (y.length > x.length || Math.abs(x.length + y.length - length) > LENGTH_SLACK || x.length - y.length >= spread) continue;
      spread = x.length - y.length;
      best = [x.type, y.type];
    }
  }
  return best;
}

/**
 * The gap a straight-shaped piece (a depot) leaves in a line when it's taken out from between two track ends, `from`
 * and `to` (refs of the ends it was joined to, now free): plain straights to fill it, end to end from `from` to `to`,
 * aligned to the gap. Null unless both ends are still free, at the same height, facing each other along one line, and
 * the gap is a length plain straights make (see `straightsFor`).
 */
export function gapFill(layout: Layout, from: number, to: number): FillPiece[] | null {
  for (const ref of [from, to]) {
    const id = pieceOfRef(ref);
    if (!layout.getPiece(id) || layout.isLifted(id) || layout.joinedConnector(ref) !== -1) return null;
  }
  layout.worldConnector(from, a);
  layout.worldConnector(to, b);
  if (Math.abs(a.y - b.y) > SAME_HEIGHT) return null;
  const h = Math.atan2(b.z - a.z, b.x - a.x);
  // Each end faces out of its own piece, into the gap: toward the other.
  if (angleDiff(a.heading, h) > GAP_ANGLE || angleDiff(b.heading, h + Math.PI) > GAP_ANGLE) return null;
  const types = straightsFor(Math.hypot(b.x - a.x, b.z - a.z));
  if (!types) return null;
  const out: FillPiece[] = [];
  let x = a.x;
  let z = a.z;
  for (const type of types) {
    out.push({ type, pose: { x, z, heading: normalizeAngle(h) }, y: a.y });
    x += Math.cos(h) * plainLength(type);
    z += Math.sin(h) * plainLength(type);
  }
  return out;
}

/*
 * Swapping a piece into a line (Draw N2 phase 2: docs/superpowers/specs/2026-10-17-draw-junctions-ramps-bridges-design.md
 * §3). A switch takes the place of part of a run of plain straights, as a depot does (`findSplice`), but needn't be
 * their length: what's left over either side is filled with plain straights (`straightsFor`: none, or at least 36 mm,
 * in 18 mm steps). Nothing here changes the layout: the caller takes up `covers` and puts down `pieces`.
 */

/** A piece to put down in a swap. */
export interface SwapPiece {
  readonly type: PieceTypeId;
  readonly pose: Pose;
  readonly y: number;
  readonly flipped: boolean;
  /** A switch set this way when it goes down (the old line's route), if not its first. */
  readonly state?: number;
  /** The piece taken up whose pin this one keeps, if it was pinned (a switch swapped for a three-way, set the same way). */
  readonly pinOf?: number;
}

/** A switch swapped into a line: the straights it takes up, what goes down instead (the switch first), and its branch end. */
export interface PieceSwap {
  readonly kind: "swap";
  readonly covers: readonly number[];
  readonly pieces: readonly SwapPiece[];
  /** The switch's branch end, facing out (where a drawn line goes on from, or comes in to). */
  readonly end: { x: number; z: number; heading: number; y: number; kind: ConnectorKind };
  /** A crossing's other end on the line's path, facing out (where the line goes on from), or absent. */
  readonly exit?: { x: number; z: number; heading: number; y: number; kind: ConnectorKind };
}

/** A swap, or why there's none: `busy`, a train is on the straights it would take up; `none`, nowhere it fits. */
export type SwapResult = PieceSwap | { readonly kind: "busy"; readonly onto: number } | { readonly kind: "none" };

const NO_SWAP: SwapResult = { kind: "none" };

/** A run of plain straights joined in line: their ids, where each starts along it (mm), and its frame. */
interface Run {
  ids: number[];
  starts: number[];
  lengths: number[];
  /** Where it starts (the far end of its first straight), the way it runs, its length, and its height. */
  x: number;
  z: number;
  h: number;
  length: number;
  y: number;
}

/** How many straights either side of the one pressed a swap looks along (enough for a switch and what's left over). */
const RUN_REACH = 4;
/** Swap positions are this far apart along a run (mm): the plain straights' lengths are all multiples of it. */
const SWAP_STEP = 18;
/** Leaving a line, the switch's branch end is looked for this far back and on from where it's pressed (mm). */
const BRANCH_BACK = 180;
const BRANCH_ON = 40;
/** Scoring a branch: each radian its leg leaves off the stroke's way costs as much as this many mm off the stroke. */
const BRANCH_TURN = 60;
/** Facings scoring within this (mm) are a tie: the switch faces the line's nearer end. */
const BRANCH_TIE = 3;
/** A swap that covers whole straights (nothing left over) is taken over one up to this much better (mm) that doesn't. */
const WHOLE_SLACK = 36;
/** Merging: the finger must have been let go this close (mm) to the line's centre line. */
export const MERGE_REACH = 50;
/** Walking a line to its nearer free end looks at no more than this many pieces each way. */
const END_WALK = 40;

/** The run of plain straights through `onto`, in line and at its height, up to `RUN_REACH` either side. */
function runThrough(layout: Layout, onto: number): Run | null {
  const here = layout.getPiece(onto);
  const own = here ? plainLength(here.type) : 0;
  if (!here || own === 0 || layout.isLifted(onto)) return null;
  const side = (end: 0 | 1) => {
    const ids: number[] = [];
    const lengths: number[] = [];
    let ref = connectorRef(onto, end);
    for (let k = 0; k < RUN_REACH; k++) {
      const partner = layout.joinedConnector(ref);
      if (partner === -1) break;
      const id = pieceOfRef(partner);
      const p = layout.getPiece(id);
      const l = p ? plainLength(p.type) : 0;
      if (!p || l === 0 || id === onto || ids.includes(id) || layout.isLifted(id)) break;
      if (Math.abs(p.y - here.y) > SAME_HEIGHT || angleDiff(2 * p.pose.heading, 2 * here.pose.heading) > 2 * LINE_ANGLE) break;
      ids.push(id);
      lengths.push(l);
      ref = connectorRef(id, 1 - indexOfRef(partner));
    }
    return { ids, lengths, far: ref };
  };
  const back = side(0);
  const ahead = side(1);
  layout.worldConnector(back.ids.length ? back.far : connectorRef(onto, 0), a);
  layout.worldConnector(ahead.ids.length ? ahead.far : connectorRef(onto, 1), b);
  const ids = [...back.ids.reverse(), onto, ...ahead.ids];
  const lengths = [...back.lengths.reverse(), own, ...ahead.lengths];
  const starts: number[] = [];
  let u = 0;
  for (const l of lengths) {
    starts.push(u);
    u += l;
  }
  return { ids, starts, lengths, x: a.x, z: a.z, h: Math.atan2(b.z - a.z, b.x - a.x), length: u, y: here.y };
}

const swapEnd: Pose = { x: 0, z: 0, heading: 0 };

/**
 * A switch at `s` mm along a run (its 144 mm from there), facing on along the run (`facing` 1: trunk at `s`) or back
 * (−1: trunk at `s` + 144), mirrored or not: what it covers, the straights either side, and its branch end. Null if
 * what's left over can't be made of plain straights, or a train is on what it covers (`busy` is told).
 */
function switchAt(
  run: Run,
  s: number,
  facing: 1 | -1,
  flipped: boolean,
  canTake: (id: number) => boolean,
  busy: { onto: number },
  type: PieceTypeId = "switch",
  port = 2,
  exitPort = -1,
): PieceSwap | null {
  let first = -1;
  let last = -1;
  for (let i = 0; i < run.ids.length; i++) {
    if (run.starts[i] + run.lengths[i] <= s + LENGTH_SLACK || run.starts[i] >= s + SWITCH_LENGTH - LENGTH_SLACK) continue;
    if (first === -1) first = i;
    last = i;
  }
  if (first === -1) return null;
  const fill = (gap: number) => (gap < LENGTH_SLACK ? [] : straightsFor(gap));
  let fillLeft = fill(s - run.starts[first]);
  // What's left over too short for a straight (18 mm): the straight beyond is taken up too, and the two made again.
  if (!fillLeft && first > 0) fillLeft = fill(s - run.starts[--first]);
  let fillRight = fill(run.starts[last] + run.lengths[last] - s - SWITCH_LENGTH);
  if (!fillRight && last < run.ids.length - 1) fillRight = fill(run.starts[++last] + run.lengths[last] - s - SWITCH_LENGTH);
  if (!fillLeft || !fillRight) return null;
  const u0 = run.starts[first];
  const covers = run.ids.slice(first, last + 1);
  for (const id of covers)
    if (!canTake(id)) {
      busy.onto = id;
      return null;
    }
  const ch = Math.cos(run.h);
  const sh = Math.sin(run.h);
  const at = (u: number): Pose => ({ x: run.x + ch * u, z: run.z + sh * u, heading: run.h });
  const pose = facing === 1 ? at(s) : { ...at(s + SWITCH_LENGTH), heading: normalizeAngle(run.h + Math.PI) };
  const def = getPieceDef(type, flipped);
  const c = def.connectors[port];
  transformPose(pose, c.pose, swapEnd);
  const end = { x: swapEnd.x, z: swapEnd.z, heading: normalizeAngle(swapEnd.heading), y: run.y + c.y, kind: c.kind };
  let exit: PieceSwap["exit"];
  if (exitPort >= 0) {
    const x = def.connectors[exitPort];
    transformPose(pose, x.pose, swapEnd);
    exit = { x: swapEnd.x, z: swapEnd.z, heading: normalizeAngle(swapEnd.heading), y: run.y + x.y, kind: x.kind };
  }
  const pieces: SwapPiece[] = [{ type, pose, y: run.y, flipped }];
  let u = u0;
  for (const type of fillLeft) {
    pieces.push({ type, pose: at(u), y: run.y, flipped: false });
    u += plainLength(type);
  }
  u = s + SWITCH_LENGTH;
  for (const type of fillRight) {
    pieces.push({ type, pose: at(u), y: run.y, flipped: false });
    u += plainLength(type);
  }
  return exit ? { kind: "swap", covers, pieces, end, exit } : { kind: "swap", covers, pieces, end };
}

/** Is a swap a whole-straights one (nothing left over: the switch is all it puts down)? */
const whole = (w: PieceSwap): boolean => w.pieces.length === 1;

/**
 * Which way along a run (1: on, the way it runs; −1: back) its line reaches a free end sooner, in pieces (0 if it's
 * a tie, or neither does within `END_WALK`).
 */
function nearerEnd(layout: Layout, run: Run): 1 | -1 | 0 {
  const walk = (id: number, end: number): number => {
    let ref = connectorRef(id, end);
    for (let k = 0; k < END_WALK; k++) {
      const partner = layout.joinedConnector(ref);
      if (partner === -1) return k;
      const next = pieceOfRef(partner);
      const p = layout.getPiece(next);
      if (!p) return k;
      const def = getPieceDef(p.type, p.flipped);
      if (def.connectors.length !== 2) return Infinity;
      ref = connectorRef(next, 1 - indexOfRef(partner));
    }
    return Infinity;
  };
  // Each end of the run: whichever of the first and last straights' ends faces out of the run.
  const outOf = (id: number, toward: number): number => {
    const p = layout.getPiece(id)!;
    const def = getPieceDef(p.type, p.flipped);
    const w = transformPose(p.pose, def.connectors[1].pose, swapEnd);
    const out1 = Math.cos(w.heading) * Math.cos(run.h) + Math.sin(w.heading) * Math.sin(run.h);
    return toward * out1 > 0 ? 1 : 0;
  };
  const first = run.ids[0];
  const last = run.ids[run.ids.length - 1];
  const back = walk(first, outOf(first, -1));
  const on = walk(last, outOf(last, 1));
  return on < back ? 1 : back < on ? -1 : 0;
}

/**
 * A stroke starting on plain straight `onto` at (px, pz) and leaving it along `heading` (its first few centimetres):
 * the switch that takes the place of part of its run, its branch leaving to the side the stroke does, placed so the
 * branch's end lies nearest the stroke and its leg runs nearest the stroke's way (the facing whose leg is nearer the
 * stroke's way; level, the one facing the line's nearer free end). A position covering whole straights is preferred
 * within `WHOLE_SLACK`. About a dozen positions 18 mm apart, both facings: each a pose's arithmetic, no placement checks
 * (the caller checks the one it gets). `canTake`: straights that may be taken up (no train on them).
 */
export function findBranch(layout: Layout, onto: number, px: number, pz: number, heading: number, canTake: (id: number) => boolean = () => true): SwapResult {
  const run = runThrough(layout, onto);
  if (!run) return NO_SWAP;
  // (A train on the straight pressed: refused, not a switch somewhere else along the line.)
  if (!canTake(onto)) return { kind: "busy", onto };
  const ch = Math.cos(run.h);
  const sh = Math.sin(run.h);
  const up = (px - run.x) * ch + (pz - run.z) * sh;
  const dx = Math.cos(heading);
  const dz = Math.sin(heading);
  // Which side of the line the stroke leaves to.
  const side = ch * dz - sh * dx > 0 ? 1 : -1;
  const busy = { onto: -1 };
  type Scored = { w: PieceSwap; score: number; facing: 1 | -1 };
  const found: Scored[] = [];
  const lo = Math.max(0, Math.ceil((up - BRANCH_BACK) / SWAP_STEP) * SWAP_STEP);
  for (let s = lo; s <= up + BRANCH_ON && s + SWITCH_LENGTH <= run.length + LENGTH_SLACK; s += SWAP_STEP) {
    for (const facing of [1, -1] as const) {
      for (const flipped of [false, true]) {
        const w = switchAt(run, s, facing, flipped, canTake, busy);
        if (!w) continue;
        // The branch must leave to the stroke's side.
        const ex = w.end.x - run.x;
        const ez = w.end.z - run.z;
        if ((ch * ez - sh * ex) * side <= 0) continue;
        // How far its end is from the stroke (a ray from the press, its way), and how far its leg turns off it.
        const rx = w.end.x - px;
        const rz = w.end.z - pz;
        const along = rx * dx + rz * dz;
        const off = along > 0 ? Math.abs(-rx * dz + rz * dx) : Math.hypot(rx, rz);
        found.push({ w, facing, score: off + BRANCH_TURN * angleDiff(w.end.heading, heading) });
      }
    }
  }
  if (found.length === 0) return busy.onto !== -1 ? { kind: "busy", onto: busy.onto } : NO_SWAP;
  found.sort((p, q) => p.score - q.score);
  let pick = found[0];
  // Level between the two facings: toward the line's nearer free end.
  const other = found.find((f) => f.facing !== pick.facing);
  if (other && other.score - pick.score <= BRANCH_TIE) {
    const toward = nearerEnd(layout, run);
    if (toward !== 0 && pick.facing !== toward) pick = other;
  }
  // Whole straights, if one is nearly as good (and faces the same way).
  if (!whole(pick.w)) {
    const w = found.find((f) => f.facing === pick.facing && whole(f.w) && f.score <= pick.score + WHOLE_SLACK);
    if (w) pick = w;
  }
  return pick.w;
}

/** A merge: the switch swap, and the straights (none, one or two) from the line's end to its branch end. */
export interface MergeSwap {
  readonly swap: PieceSwap;
  readonly links: readonly SwapPiece[];
}

/**
 * The plain straights that span a gap along the line's heading: one (36 to 216 mm in 18 mm steps, as the Auto piece
 * fits), else two (up to 432 mm), by total. A line's pieces are all whole 18 mm steps long, so where its end lies
 * short of a swap's end by a few mm more than a step, keeping a piece less doesn't help: a gap just over 216 mm needs
 * two (QA: a crossing stroke started 300 mm off the line found none).
 */
const LINK_RUNS: readonly (readonly number[])[] = (() => {
  const out = new Map<number, number[]>();
  for (const t of FIT_LENGTHS) out.set(t, [t]);
  for (const a of FIT_LENGTHS) for (const b of FIT_LENGTHS) if (b <= a && !out.has(a + b)) out.set(a + b, [a, b]);
  return [...out.keys()].sort((x, y) => x - y).map((k) => out.get(k)!);
})();
const LINK_TOTALS = LINK_RUNS.map((r) => r.reduce((a, b) => a + b, 0));

/**
 * A drawn line ending at `end` (heading the way it goes on), its finger let go at (fx, fz) on or close to a plain
 * straight: a switch swapped into that straight's run whose branch end meets the line, arriving at 45° to it, either
 * straight away or through plain straights on along the line's heading (one or two: see `LINK_RUNS`, to within the
 * joints' play). Null if none does. One pass over the pieces for straights near the finger,
 * then for each run two facings, two hands and the two positions either side of where the branch would line up.
 */
export function findMerge(layout: Layout, end: { x: number; z: number; heading: number; y: number }, fx: number, fz: number, canTake: (id: number) => boolean = () => true): MergeSwap | null {
  return findPortSwap(layout, end, canTake, [{ type: "switch", port: 2, exit: -1 }], (run) => {
    // The finger let go on or close to the run.
    const ch = Math.cos(run.h);
    const sh = Math.sin(run.h);
    const fu = (fx - run.x) * ch + (fz - run.z) * sh;
    const fv = -(fx - run.x) * sh + (fz - run.z) * ch;
    return Math.abs(fv) <= MERGE_REACH && fu >= -MERGE_REACH && fu <= run.length + MERGE_REACH;
  }, { x: fx, z: fz, reach: MERGE_REACH });
}

/** A crossing at the line's end: the swap (its `exit`, the far end of its path the line takes on), and the straights to it. */
export type CrossingSwap = MergeSwap;

/** A drawn line crosses a plain straight's run at about 90° or 45° when it's this close (mm) to it along its heading, at most. */
export const CROSS_REACH = 300;

/**
 * A drawn line ending at `end` (heading the way it goes on) and going on across a run of plain straights at 90° or
 * 45°: a crossing (or 45° crossing) swapped into the run where the line meets it, the line coming in to one end of its
 * cross path, straight away or through one plain straight on its heading, and going on from the other (`exit`). Null
 * if none fits. As `findMerge`: one pass over the pieces near the line's end, then two facings, two hands, both ends.
 */
export function findCrossing(layout: Layout, end: { x: number; z: number; heading: number; y: number }, canTake: (id: number) => boolean = () => true): CrossingSwap | null {
  const ax = end.x + Math.cos(end.heading) * (CROSS_REACH / 2);
  const az = end.z + Math.sin(end.heading) * (CROSS_REACH / 2);
  return findPortSwap(
    layout,
    end,
    canTake,
    [
      { type: "crossing", port: 2, exit: 3 },
      { type: "crossing", port: 3, exit: 2 },
      { type: "crossing-45", port: 2, exit: 3 },
      { type: "crossing-45", port: 3, exit: 2 },
    ],
    () => true,
    { x: ax, z: az, reach: CROSS_REACH / 2 },
  );
}

/**
 * The swap, among those `kinds` (a piece type, the end the line comes in to, and the one it goes on from or −1) at
 * each facing and hand, put into a run of plain straights near `near` (and `onRun` says the run may be used), whose
 * end `port` meets the line's end facing it, straight away or through one or two plain straights on the line's heading:
 * the nearest fit within the joints' play, or null.
 */
function findPortSwap(
  layout: Layout,
  end: { x: number; z: number; heading: number; y: number },
  canTake: (id: number) => boolean,
  kinds: readonly { type: PieceTypeId; port: number; exit: number }[],
  onRun: (run: Run) => boolean,
  near: { x: number; z: number; reach: number },
): MergeSwap | null {
  const seen = new Set<number>();
  const busy = { onto: -1 };
  const ex = Math.cos(end.heading);
  const ez = Math.sin(end.heading);
  let best: { m: MergeSwap; err: number } | null = null;
  for (const id of layout.pieceIds()) {
    const p = layout.getPiece(id)!;
    const l = plainLength(p.type);
    if (l === 0 || seen.has(id) || Math.abs(p.y - end.y) > SAME_HEIGHT) continue;
    if (Math.abs(p.pose.x - near.x) > l + near.reach || Math.abs(p.pose.z - near.z) > l + near.reach) continue;
    const run = runThrough(layout, id);
    if (!run) continue;
    for (const r of run.ids) seen.add(r);
    if (!onRun(run)) continue;
    const ch = Math.cos(run.h);
    const sh = Math.sin(run.h);
    for (const kind of kinds) {
      for (const facing of [1, -1] as const) {
        for (const flipped of getPieceDef(kind.type, false).flippable ? [false, true] : [false]) {
          // Where the end it meets is with the piece at 0, and the way it faces: the line must come in facing it.
          const def = getPieceDef(kind.type, flipped);
          const c = def.connectors[kind.port].pose;
          const base: Pose = facing === 1 ? { x: run.x, z: run.z, heading: run.h } : { x: run.x + ch * SWITCH_LENGTH, z: run.z + sh * SWITCH_LENGTH, heading: normalizeAngle(run.h + Math.PI) };
          transformPose(base, c, swapEnd);
          if (Math.abs(normalizeAngle(end.heading - swapEnd.heading - Math.PI)) > JOINT_ANGLE_TOLERANCE) continue;
          // That end moves along the run with the piece: where it's straight ahead of the line's end.
          const bx = swapEnd.x - end.x;
          const bz = swapEnd.z - end.z;
          const across0 = -bx * ez + bz * ex;
          const rate = -ch * ez + sh * ex;
          if (Math.abs(rate) < 1e-6) continue;
          const sStar = -across0 / rate;
          for (const s of [Math.floor(sStar / SWAP_STEP) * SWAP_STEP, Math.ceil(sStar / SWAP_STEP) * SWAP_STEP]) {
            if (s < 0 || s + SWITCH_LENGTH > run.length + LENGTH_SLACK) continue;
            const along = (bx + ch * s) * ex + (bz + sh * s) * ez;
            const across = across0 + rate * s;
            let k = -1;
            if (Math.abs(along) > JOINT_POS_TOLERANCE) for (let i = 0; i < LINK_TOTALS.length; i++) if (k < 0 || Math.abs(LINK_TOTALS[i] - along) < Math.abs(LINK_TOTALS[k] - along)) k = i;
            const link = k < 0 ? 0 : LINK_TOTALS[k];
            const err = Math.hypot(along - link, across);
            if (err > JOINT_POS_TOLERANCE || (best && err >= best.err)) continue;
            const w = switchAt(run, s, facing, flipped, canTake, busy, kind.type, kind.port, kind.exit);
            if (!w) continue;
            const links: SwapPiece[] = [];
            let at = 0;
            for (const t of k < 0 ? [] : LINK_RUNS[k]) {
              links.push({ type: `straight-${t}` as PieceTypeId, pose: { x: end.x + ex * at, z: end.z + ez * at, heading: normalizeAngle(end.heading) }, y: end.y, flipped: false });
              at += t;
            }
            best = { m: { swap: w, links }, err };
          }
        }
      }
    }
  }
  return best?.m ?? null;
}

const swapA = createWorldConnector();
const swapB = createWorldConnector();
const swapPose: Pose = { x: 0, z: 0, heading: 0 };
const legEnd: Pose = { x: 0, z: 0, heading: 0 };

/**
 * A stroke starting on a large curve (`onto`) at (px, pz) along `heading`: the curve becomes a switch whose branch is
 * the old curve (the new line goes straight on from its trunk's way), or a Y switch with the old curve as one leg (the
 * new line curves the other way), whichever's free end lies nearest the stroke. An exact swap: nothing left over, every
 * joint kept, set to the old line (the curve's leg). Eight placements looked at (two pieces, two hands, either end of
 * the curve as the trunk), pose arithmetic only.
 */
export function findCurveSwap(layout: Layout, onto: number, px: number, pz: number, heading: number, canTake: (id: number) => boolean = () => true): SwapResult {
  const p = layout.getPiece(onto);
  if (!p || p.type !== "curve-large" || layout.isLifted(onto)) return NO_SWAP;
  if (!canTake(onto)) return { kind: "busy", onto };
  let best: { w: PieceSwap; score: number } | null = null;
  for (let trunk = 0; trunk < 2; trunk++) {
    layout.worldConnector(connectorRef(onto, trunk), swapA);
    layout.worldConnector(connectorRef(onto, 1 - trunk), swapB);
    for (const type of ["switch", "switch-y"] as const) {
      for (const flipped of getPieceDef(type, false).flippable ? [false, true] : [false]) {
        const def = getPieceDef(type, flipped);
        // The trunk where the curve's end was, facing out the same way.
        solveParentPose(def.connectors[0].pose, { x: swapA.x, z: swapA.z, heading: swapA.heading }, swapPose);
        const pose = { ...swapPose, heading: normalizeAngle(swapPose.heading) };
        // A leg on the curve's other end (its path is the old curve), and the other leg free: where the line goes on.
        let on = -1;
        let free = -1;
        for (let k = 1; k < def.connectors.length; k++) {
          transformPose(pose, def.connectors[k].pose, legEnd);
          if (Math.hypot(legEnd.x - swapB.x, legEnd.z - swapB.z) < 1 && angleDiff(legEnd.heading, swapB.heading) < 0.01) on = k;
          else free = k;
        }
        if (on === -1 || free === -1) continue;
        transformPose(pose, def.connectors[free].pose, legEnd);
        const rx = legEnd.x - px;
        const rz = legEnd.z - pz;
        const along = rx * Math.cos(heading) + rz * Math.sin(heading);
        const off = along > 0 ? Math.abs(-rx * Math.sin(heading) + rz * Math.cos(heading)) : Math.hypot(rx, rz);
        const score = off + BRANCH_TURN * angleDiff(legEnd.heading, heading);
        if (best && score >= best.score) continue;
        // Set to the old line: the path that runs to the leg on the curve's end.
        const state = def.paths.findIndex((q) => q.to === on);
        const c = def.connectors[free];
        best = {
          score,
          w: { kind: "swap", covers: [onto], pieces: [{ type, pose, y: p.y, flipped, state: Math.max(0, state) }], end: { x: legEnd.x, z: legEnd.z, heading: normalizeAngle(legEnd.heading), y: p.y + c.y, kind: c.kind } },
        };
      }
    }
  }
  return best?.w ?? NO_SWAP;
}

/** The three-way's legs (its connectors) on its + and − sides: a switch's branch goes on one, the new line off the other. */
const THREE_WAY_PLUS = 2;
const THREE_WAY_MINUS = 3;

/**
 * A stroke starting on a switch (`onto`) and leaving on its open side (the side its branch isn't): a three-way in its
 * place, with the same trunk, the same straight and the switch's branch, the new line off its other curve (every joint
 * kept). Set as the switch was. `none` if the stroke doesn't leave the way that curve does (within 60°).
 */
export function findThreeWay(layout: Layout, onto: number, heading: number, canTake: (id: number) => boolean = () => true): SwapResult {
  const p = layout.getPiece(onto);
  if (!p || p.type !== "switch" || layout.isLifted(onto)) return NO_SWAP;
  if (!canTake(onto)) return { kind: "busy", onto };
  const def = getPieceDef("switch-3way", false);
  // A switch mirrored has its branch on the − side: the new leg is the other.
  const branchLeg = p.flipped ? THREE_WAY_MINUS : THREE_WAY_PLUS;
  const newLeg = p.flipped ? THREE_WAY_PLUS : THREE_WAY_MINUS;
  const pose = { ...p.pose };
  transformPose(pose, def.connectors[newLeg].pose, legEnd);
  // The stroke must leave the way that leg does (within 60°), on its side of the switch.
  if (angleDiff(legEnd.heading, heading) > Math.PI / 3) return NO_SWAP;
  const old = layout.switchState(onto);
  // The switch's own paths: 0 straight on, 1 its branch. The three-way's: 0 straight, then its + curve, then its −.
  const state = old === 0 ? 0 : def.paths.findIndex((q) => q.to === branchLeg);
  const c = def.connectors[newLeg];
  return { kind: "swap", covers: [onto], pieces: [{ type: "switch-3way", pose, y: p.y, flipped: false, state, pinOf: onto }], end: { x: legEnd.x, z: legEnd.z, heading: normalizeAngle(legEnd.heading), y: p.y + c.y, kind: c.kind } };
}

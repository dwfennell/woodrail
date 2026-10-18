import { createSample, findBranch, findCrossing, findCurveSwap, findMerge, findThreeWay, getPieceDef, pathLength, samplePath, transformPose, type DrawEnd, type DrawnPiece, type Layout, type PieceSwap, type PieceTypeId, type Pose, type SwapPiece } from "../track";

/**
 * Junctions in a drawn line (Draw N2 phase 2, docs/superpowers/specs/2026-10-17-draw-junctions-ramps-bridges-design.md
 * §3): a line drawn off the middle of a line leaves it through a switch swapped in there (a branch), and one that comes
 * in to a line at 45° and is let go on it joins it through another (a merge). The swaps are worked out here, from the
 * map and the rules the caller gives; DrawHand shows them and puts them down with the line, in one undo step.
 */
export interface JunctionRules {
  readonly layout: Layout;
  /** May this piece go here, the pieces in `ignore` left out (the straights it takes the place of)? Null, or why not. */
  check(type: PieceTypeId, flipped: boolean, pose: Pose, y: number, ignore: ReadonlySet<number>): string | null;
  /** Is a train on this piece? */
  occupied(id: number): boolean;
  /** May the line use one more of this piece, `used` already being in it? Null, or what to say ("Out of switches"). */
  may(type: PieceTypeId, used: number): string | null;
}

/** The finger must go this far (mm) off the line it was pressed on before a branch is decided (as a new line waits). */
export const BRANCH_MOVE = 30;
/** ... and this far (mm) from where it was pressed. */
export const BRANCH_WAY = 50;

/** What it says when a train is on the straight a switch would go in place of. */
export const BUSY_MESSAGE = "A train is on that straight";
/** What it says when no switch fits there. */
export const NO_ROOM_MESSAGE = "No room for a switch there";
/** Can a drag that starts on this piece draw a branch off it (with a switch, Y or three-way swapped in)? */
export const branchesOff = (type: PieceTypeId): boolean => /^straight-\d+$/.test(type) || type === "curve-large" || type === "switch";

export type BranchStart = { readonly kind: "wait" } | { readonly kind: "refused"; readonly message: string } | { readonly kind: "branch"; readonly swap: PieceSwap };

/**
 * A press on plain straight `onto` at `press` (on the track, at its height), the finger now at `finger`: wait till it
 * has gone `BRANCH_MOVE` off the line, then the switch it branches through (see `findBranch`), checked where it goes
 * (the straights it replaces left out), or why not.
 */
export function branchFrom(r: JunctionRules, onto: number, press: { x: number; z: number }, finger: { x: number; z: number }): BranchStart {
  const p = r.layout.getPiece(onto);
  if (!p) return { kind: "refused", message: NO_ROOM_MESSAGE };
  const off = offTrack(p.type, p.flipped, p.pose, finger);
  // (And its way is taken over its first 50 mm: which way the switch faces is the leg nearer that way.)
  if (off < BRANCH_MOVE || Math.hypot(finger.x - press.x, finger.z - press.z) < BRANCH_WAY) return { kind: "wait" };
  const way = Math.atan2(finger.z - press.z, finger.x - press.x);
  const canTake = (id: number) => !r.occupied(id);
  // Off a straight: a switch in part of its run. Off a large curve: a switch (or Y) in its place. Off a switch's open
  // side: a three-way in its place.
  const w =
    p.type === "curve-large" ? findCurveSwap(r.layout, onto, press.x, press.z, way, canTake) : p.type === "switch" ? findThreeWay(r.layout, onto, way, canTake) : findBranch(r.layout, onto, press.x, press.z, way, canTake);
  if (w.kind === "busy") return { kind: "refused", message: BUSY_MESSAGE };
  if (w.kind === "none") return { kind: "refused", message: NO_ROOM_MESSAGE };
  const short = r.may(w.pieces[0].type, 0);
  if (short) return { kind: "refused", message: short };
  const why = swapBlocked(r, w);
  return why ? { kind: "refused", message: why } : { kind: "branch", swap: w };
}

const offSample = createSample();
const offPose: Pose = { x: 0, z: 0, heading: 0 };

/** How far (mm) a point is from a piece's track (its paths, every 12 mm along them). */
function offTrack(type: PieceTypeId, flipped: boolean, pose: Pose, at: { x: number; z: number }): number {
  let best = Infinity;
  for (const path of getPieceDef(type, flipped).paths) {
    const len = pathLength(path.geom);
    const n = Math.max(1, Math.ceil(len / 12));
    for (let k = 0; k <= n; k++) {
      samplePath(path.geom, (len * k) / n, offSample);
      transformPose(pose, { x: offSample.x, z: offSample.z, heading: 0 }, offPose);
      best = Math.min(best, Math.hypot(at.x - offPose.x, at.z - offPose.z));
    }
  }
  return best;
}

/** May a swap's pieces go where they go (the straights they replace left out)? Null, or why not. */
function swapBlocked(r: JunctionRules, w: PieceSwap, also: ReadonlySet<number> = new Set()): string | null {
  const ignore = new Set([...w.covers, ...also]);
  for (const p of w.pieces) {
    const why = r.check(p.type, p.flipped, p.pose, p.y, ignore);
    if (why) return why;
  }
  return null;
}

/** A merge at the line's end: how many of its pieces it keeps, then a straight (if any) and the switch it comes in through. */
export interface Merge {
  readonly kind: "merge";
  readonly keep: number;
  readonly link: SwapPiece | null;
  readonly swap: PieceSwap;
}

/**
 * The line (`pieces`, those that may go down, from `start`) let go with the finger at `finger`: if that's on or close
 * to a plain straight the line comes in to at 45°, a switch swapped in there, its branch end met by the line's end, or
 * by the end before its last piece (which comes off: it ran on into the line). `taken`: straights already being
 * replaced (a branch's). `switches`: switches the line already uses. Null if none; "short" if the player has no
 * switch for it (what to say).
 */
export function mergeAt(r: JunctionRules, start: DrawEnd, pieces: readonly DrawnPiece[], finger: { x: number; z: number }, taken: ReadonlySet<number>, switches: number): Merge | { readonly kind: "short"; readonly message: string } | null {
  for (const keep of [pieces.length, pieces.length - 1]) {
    if (keep < 0) continue;
    const e = keep > 0 ? pieces[keep - 1].end : start;
    const m = findMerge(r.layout, e, finger.x, finger.z, (id) => !r.occupied(id) && !taken.has(id));
    if (!m) continue;
    const short = r.may("switch", switches);
    if (short) return { kind: "short", message: short };
    const why = swapBlocked(r, m.swap, taken) ?? (m.link ? r.check(m.link.type, m.link.flipped, m.link.pose, m.link.y, new Set([...taken, ...m.swap.covers])) : null);
    if (why) continue;
    return { kind: "merge", keep, link: m.link, swap: m.swap };
  }
  return null;
}

/** A crossing the line goes on through: how many of its pieces it keeps, the straight to it (if any), and the swap (its `exit`, where the line goes on). */
export interface Crossing {
  readonly kind: "crossing";
  readonly keep: number;
  readonly link: SwapPiece | null;
  readonly swap: PieceSwap;
}

/**
 * The line (`pieces`, those that may go down, from `start`) stopped where it ran into a plain straight's run: a
 * crossing (or a 45° crossing) swapped into the run there, the line going on across it (see `findCrossing`), from its
 * end or the end before its last piece. `taken`: straights already being replaced; `used`: crossings the line already
 * has of each type. Null if none; "short" if the player has none of the crossing it needs (what to say).
 */
export function crossingAt(
  r: JunctionRules,
  start: DrawEnd,
  pieces: readonly DrawnPiece[],
  taken: ReadonlySet<number>,
  used: (type: PieceTypeId) => number,
): Crossing | { readonly kind: "short"; readonly message: string } | null {
  for (const keep of [pieces.length, pieces.length - 1]) {
    if (keep < 0) continue;
    const e = keep > 0 ? pieces[keep - 1].end : start;
    const c = findCrossing(r.layout, e, (id) => !r.occupied(id) && !taken.has(id));
    if (!c) continue;
    const type = c.swap.pieces[0].type;
    const short = r.may(type, used(type));
    if (short) return { kind: "short", message: short };
    const why = swapBlocked(r, c.swap, taken) ?? (c.link ? r.check(c.link.type, c.link.flipped, c.link.pose, c.link.y, new Set([...taken, ...c.swap.covers])) : null);
    if (why) continue;
    return { kind: "crossing", keep, link: c.link, swap: c.swap };
  }
  return null;
}

/** All that goes down for a line with its swaps: the straights taken up, and the pieces put down (the branch's swap first, then the crossings', then the line, then the merge). */
export function linePlan(
  branch: PieceSwap | null,
  pieces: readonly DrawnPiece[],
  merge: Merge | null,
  crossed: { readonly pieces: readonly SwapPiece[]; readonly covers: readonly number[] } = { pieces: [], covers: [] },
): { covers: number[]; pieces: SwapPiece[]; line: number } {
  const keep = merge ? merge.keep : pieces.length;
  // The branch's swap, then what the line laid before each crossing it went on through (and the crossings), then the line.
  const out: SwapPiece[] = [...(branch?.pieces ?? []), ...crossed.pieces];
  const line = out.length;
  for (const p of pieces.slice(0, keep)) out.push({ type: p.type, pose: p.pose, y: p.y, flipped: p.flipped });
  if (merge?.link) out.push(merge.link);
  if (merge) out.push(...merge.swap.pieces);
  return { covers: [...(branch?.covers ?? []), ...crossed.covers, ...(merge?.swap.covers ?? [])], pieces: out, line };
}

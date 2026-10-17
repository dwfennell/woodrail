import { findBranch, findMerge, type DrawEnd, type DrawnPiece, type Layout, type PieceSwap, type PieceTypeId, type Pose, type SwapPiece } from "../track";

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

/** What it says when a train is on the straight a switch would go in place of. */
export const BUSY_MESSAGE = "A train is on that straight";
/** What it says when no switch fits there. */
export const NO_ROOM_MESSAGE = "No room for a switch there";

export type BranchStart = { readonly kind: "wait" } | { readonly kind: "refused"; readonly message: string } | { readonly kind: "branch"; readonly swap: PieceSwap };

/**
 * A press on plain straight `onto` at `press` (on the track, at its height), the finger now at `finger`: wait till it
 * has gone `BRANCH_MOVE` off the line, then the switch it branches through (see `findBranch`), checked where it goes
 * (the straights it replaces left out), or why not.
 */
export function branchFrom(r: JunctionRules, onto: number, press: { x: number; z: number }, finger: { x: number; z: number }): BranchStart {
  const p = r.layout.getPiece(onto);
  if (!p) return { kind: "refused", message: NO_ROOM_MESSAGE };
  const off = Math.abs(-(finger.x - p.pose.x) * Math.sin(p.pose.heading) + (finger.z - p.pose.z) * Math.cos(p.pose.heading));
  if (off < BRANCH_MOVE) return { kind: "wait" };
  const short = r.may("switch", 0);
  if (short) return { kind: "refused", message: short };
  const w = findBranch(r.layout, onto, press.x, press.z, Math.atan2(finger.z - press.z, finger.x - press.x), (id) => !r.occupied(id));
  if (w.kind === "busy") return { kind: "refused", message: BUSY_MESSAGE };
  if (w.kind === "none") return { kind: "refused", message: NO_ROOM_MESSAGE };
  const why = swapBlocked(r, w);
  return why ? { kind: "refused", message: why } : { kind: "branch", swap: w };
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

/** All that goes down for a line with its swaps: the straights taken up, and the pieces put down (the branch's swap first, then the line, then the merge). */
export function linePlan(branch: PieceSwap | null, pieces: readonly DrawnPiece[], merge: Merge | null): { covers: number[]; pieces: SwapPiece[]; line: number } {
  const keep = merge ? merge.keep : pieces.length;
  const out: SwapPiece[] = [...(branch?.pieces ?? [])];
  const line = out.length;
  for (const p of pieces.slice(0, keep)) out.push({ type: p.type, pose: p.pose, y: p.y, flipped: p.flipped });
  if (merge?.link) out.push(merge.link);
  if (merge) out.push(...merge.swap.pieces);
  return { covers: [...(branch?.covers ?? []), ...(merge?.swap.covers ?? [])], pieces: out, line };
}

import { createRouteStep, createSample, getPieceDef, pathLength, routeFrom, samplePath, TRACK_THICKNESS, type Layout } from "../track";
import type { Cursor } from "../sim";
import { SEARCH, type PinnedTest } from "../routing/graph";
import { walkTo, type At, type PathRun, type Leg } from "../routing/plan";

export type { Leg, PathRun } from "../routing/plan";

const lengthOf = (layout: Layout, pieceId: number, pathIndex: number): number => {
  const piece = layout.getPiece(pieceId)!;
  return pathLength(getPieceDef(piece.type, piece.flipped).paths[pathIndex].geom);
};

/** Total length of some runs (mm). */
export const runsLength = (runs: readonly PathRun[]): number => runs.reduce((t, r) => t + Math.abs(r.s1 - r.s0), 0);

/**
 * From a train's front cursor to a piece: the way a routed train would go (as the router chooses), or null. `pinned`: see
 * `walkTo`.
 */
export function legFromCursor(layout: Layout, front: Cursor, targetPiece: number, pinned?: PinnedTest): Leg {
  if (!layout.getPiece(front.pieceId) || !layout.getPiece(targetPiece)) return null;
  const len = lengthOf(layout, front.pieceId, front.pathIndex);
  const s = front.reversed ? len - front.s : front.s;
  if (front.pieceId === targetPiece) {
    // On the stop already, short of its middle: just on to the middle.
    const ahead = front.reversed ? s >= len / 2 : s <= len / 2;
    if (ahead) return [{ pieceId: front.pieceId, pathIndex: front.pathIndex, s0: s, s1: len / 2 }];
  }
  return walkTo(layout, { pieceId: front.pieceId, pathIndex: front.pathIndex, reversed: front.reversed, s }, targetPiece, pinned);
}

/**
 * The way from the middle of stop piece `from` to the middle of `to`, leaving by whichever end of `from` is shorter.
 * Empty when they're the same piece. Only where the way into `from` isn't known (`lineLegs` chains the rest).
 */
function legBetween(layout: Layout, from: number, to: number): Leg {
  if (from === to) return layout.getPiece(from) ? [] : null;
  if (!layout.getPiece(from) || !layout.getPiece(to)) return null;
  const mid = lengthOf(layout, from, 0) / 2;
  const a = walkTo(layout, { pieceId: from, pathIndex: 0, reversed: false, s: mid }, to);
  const b = walkTo(layout, { pieceId: from, pathIndex: 0, reversed: true, s: mid }, to);
  if (!a || !b) return a ?? b;
  return runsLength(b) < runsLength(a) ? b : a;
}

/** Where a leg leaves the train: at its end (the stop's middle), running the way its last run runs. Null for none. */
export function arrivalOf(leg: Leg): At | null {
  const last = leg && leg[leg.length - 1];
  return last ? { pieceId: last.pieceId, pathIndex: last.pathIndex, reversed: last.s1 < last.s0, s: last.s1 } : null;
}

/** The way on from `at` (standing at a stop, running one way) to the middle of `to`. A train doesn't turn at a stop. */
function legOn(layout: Layout, at: At, to: number): Leg {
  if (at.pieceId === to) return [];
  if (!layout.getPiece(to)) return null;
  return walkTo(layout, at, to);
}

/**
 * A line's legs: stop k to stop k+1, cyclically (the last back to the first), for stops given as depot piece ids.
 * Fewer than two stops: no legs.
 *
 * A train doesn't turn round at a stop: it runs on the way it came in (round a balloon or teardrop loop past it, or to
 * the end of the line and back). So each leg starts the way the one before it arrives (`arrivalOf`). `from`: the train's
 * own way to stop `from.k` (as `legFromCursor` gives it), which the legs from there follow; without it, the legs go
 * round twice from the first stop and the second lap is drawn, so the way into the first stop is known too. Where a leg
 * is null (no way leads there), the next leaves its stop by the shorter end.
 */
export function lineLegs(layout: Layout, stopPieces: readonly number[], from?: { k: number; leg: Leg }): Leg[] {
  const n = stopPieces.length;
  if (n < 2) return [];
  const legs: Leg[] = new Array<Leg>(n).fill(null);
  const lap = (k0: number, start: At | null) => {
    let at = start;
    for (let i = 0; i < n; i++) {
      const k = (k0 + i) % n;
      const a = stopPieces[k];
      const b = stopPieces[(k + 1) % n];
      const leg = at && at.pieceId === a ? legOn(layout, at, b) : legBetween(layout, a, b);
      legs[k] = leg;
      if (leg && leg.length > 0) at = arrivalOf(leg);
      else if (!leg) at = null;
      // (An empty leg, a stop visited twice running: the train stands on, the way it was going.)
      else if (at && at.pieceId !== b) at = null;
    }
    return at;
  };
  const known = from ? arrivalOf(from.leg) : null;
  if (from && known && known.pieceId === stopPieces[from.k]) lap(from.k, known);
  else lap(0, lap(0, null));
  return legs;
}

const step = createRouteStep();

/**
 * Where the switches send a train, from its front cursor, as they are set now (routeFrom), up to `length` mm or the
 * end of the line.
 */
export function aheadRuns(layout: Layout, front: Cursor, length: number): PathRun[] {
  const runs: PathRun[] = [];
  if (!layout.getPiece(front.pieceId) || length <= 0) return runs;
  let pieceId = front.pieceId;
  let pathIndex = front.pathIndex;
  let reversed = front.reversed;
  let len = lengthOf(layout, pieceId, pathIndex);
  let s = reversed ? len - front.s : front.s;
  let left = length;
  for (let k = 0; k < SEARCH && left > 0; k++) {
    const end = reversed ? 0 : len;
    const room = Math.abs(end - s);
    if (room >= left) {
      runs.push({ pieceId, pathIndex, s0: s, s1: reversed ? s - left : s + left });
      break;
    }
    if (room > 0) runs.push({ pieceId, pathIndex, s0: s, s1: end });
    left -= room;
    const piece = layout.getPiece(pieceId)!;
    const path = getPieceDef(piece.type, piece.flipped).paths[pathIndex];
    const exit = reversed ? path.from : (path.to ?? -1);
    if (exit === -1 || !routeFrom(layout, pieceId, exit, step)) break;
    pieceId = step.pieceId;
    pathIndex = step.pathIndex;
    reversed = step.reversed;
    len = lengthOf(layout, pieceId, pathIndex);
    s = reversed ? len : 0;
  }
  return runs;
}

const at = createSample();

/** The world point at distance `s` along a piece's path, on the track's top. */
export function pointOnPath(layout: Layout, pieceId: number, pathIndex: number, s: number): { x: number; y: number; z: number } | null {
  const piece = layout.getPiece(pieceId);
  if (!piece) return null;
  samplePath(getPieceDef(piece.type, piece.flipped).paths[pathIndex].geom, s, at);
  const ch = Math.cos(piece.pose.heading);
  const sh = Math.sin(piece.pose.heading);
  return { x: piece.pose.x + at.x * ch - at.z * sh, y: piece.y + at.y + TRACK_THICKNESS, z: piece.pose.z + at.x * sh + at.z * ch };
}

/** The cursors leaving the middle of a stop piece, both ways along its first path. */
export function stopCursors(layout: Layout, pieceId: number): Cursor[] {
  if (!layout.getPiece(pieceId)) return [];
  const mid = lengthOf(layout, pieceId, 0) / 2;
  return [
    { pieceId, pathIndex: 0, reversed: false, s: mid },
    { pieceId, pathIndex: 0, reversed: true, s: mid },
  ];
}

/**
 * Where the way on from `starts` (as the switches send a train, up to `length` mm each) comes nearest to (x, z): where
 * a way to a stop no track reaches runs out (its gap is drawn from there). Null if there's no track there at all.
 */
export function nearestAhead(layout: Layout, starts: readonly Cursor[], length: number, x: number, z: number): { x: number; y: number; z: number } | null {
  let best: { x: number; y: number; z: number } | null = null;
  let bestD = Infinity;
  for (const start of starts) {
    for (const run of aheadRuns(layout, start, length)) {
      const n = Math.max(1, Math.ceil(Math.abs(run.s1 - run.s0) / 12));
      for (let i = 0; i <= n; i++) {
        const p = pointOnPath(layout, run.pieceId, run.pathIndex, run.s0 + ((run.s1 - run.s0) * i) / n);
        if (!p) continue;
        const d = Math.hypot(p.x - x, p.z - z);
        if (d < bestD) {
          bestD = d;
          best = p;
        }
      }
    }
  }
  return best;
}

/**
 * Why a stop can't be reached, where it's a pinned switch: the first pinned switch that, set the other way, would let
 * the way from `starts` reach piece `target`. −1 if none (nothing pinned, or no track leads there whatever the switches).
 * Asks the way with that one switch counted as unpinned (steer's `pinned` test): the layout itself isn't touched (no
 * version bumps).
 */
export function pinnedBlocking(layout: Layout, starts: readonly Cursor[], target: number): number {
  if (layout.pinnedCount === 0) return -1;
  for (const pin of layout.pinnedIds()) {
    const test: PinnedTest = (id) => id !== pin && layout.isPinned(id);
    if (starts.some((start) => legFromCursor(layout, start, target, test) !== null)) return pin;
  }
  return -1;
}

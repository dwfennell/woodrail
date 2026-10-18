import { createRouteStep, createSample, getPieceDef, pathLength, routeFrom, samplePath, TRACK_THICKNESS, type Layout } from "../track";
import type { Cursor } from "../sim";
import { distanceTo, next, SEARCH, wayToward, waysFrom } from "../economy/steer";

/** A stretch of one path of one piece, from s0 to s1 along the path's own geometry (s0 > s1 when run backwards). */
export interface PathRun {
  pieceId: number;
  pathIndex: number;
  s0: number;
  s1: number;
}

/** The way between two stops: the runs in order, or null if no way leads there. */
export type Leg = PathRun[] | null;

/** Where a walk along the track stands: on a path, going one way, from `s` (the path's own geometry). */
interface At {
  pieceId: number;
  pathIndex: number;
  reversed: boolean;
  s: number;
}

const lengthOf = (layout: Layout, pieceId: number, pathIndex: number): number => {
  const piece = layout.getPiece(pieceId)!;
  return pathLength(getPieceDef(piece.type, piece.flipped).paths[pathIndex].geom);
};

/** Total length of some runs (mm). */
export const runsLength = (runs: readonly PathRun[]): number => runs.reduce((t, r) => t + Math.abs(r.s1 - r.s0), 0);

/**
 * The way a routed train goes from `start` to the middle of piece `target`, choosing at each switch as `steer` does
 * (`wayToward`, the shortest way on by `distanceTo`) and turning back at the end of a line. Null if it never gets
 * there: no way leads there, or it would go round for ever. Bounded by `SEARCH` steps; `distanceTo` is memoised per
 * call, so each (piece, entry) is searched from at most once.
 */
function walkTo(layout: Layout, start: At, target: number): Leg {
  const memo = new Map<number, number>();
  const dist = (at: { pieceId: number; entry: number }) => {
    const key = at.pieceId * 8 + at.entry;
    let d = memo.get(key);
    if (d === undefined) memo.set(key, (d = distanceTo(layout, at, target)));
    return d;
  };
  const runs: PathRun[] = [];
  const visited = new Set<number>();
  let at = { ...start };
  for (let step = 0; step < SEARCH; step++) {
    const piece = layout.getPiece(at.pieceId);
    if (!piece) return null;
    const def = getPieceDef(piece.type, piece.flipped);
    const path = def.paths[at.pathIndex];
    const len = pathLength(path.geom);
    const end = at.reversed ? 0 : len;
    // The walk is decided by where it stands, so coming round to a path the same way again is a loop.
    const key = (at.pieceId * 8 + at.pathIndex) * 2 + (at.reversed ? 1 : 0);
    if (visited.has(key)) return null;
    visited.add(key);
    if (at.s !== end) runs.push({ pieceId: at.pieceId, pathIndex: at.pathIndex, s0: at.s, s1: end });
    const exit = at.reversed ? path.from : (path.to ?? -1);
    const n = next(layout, at.pieceId, exit);
    const ways = n ? waysFrom(layout, n.pieceId, n.entry) : [];
    if (!n || ways.length === 0) {
      // The end of the line: the train comes back along this path.
      at = { pieceId: at.pieceId, pathIndex: at.pathIndex, reversed: !at.reversed, s: end };
      continue;
    }
    let option = 0;
    if (n.pieceId !== target && ways.length > 1) {
      option = wayToward(layout, n.pieceId, ways, target, dist);
      // No way on leads there: the switch stays as it's set.
      if (option === -1) option = layout.switchState(n.pieceId) % ways.length;
    } else if (ways.length > 1) option = layout.switchState(n.pieceId) % ways.length;
    const w = ways[option];
    const nPiece = layout.getPiece(n.pieceId)!;
    const p = getPieceDef(nPiece.type, nPiece.flipped).paths[w.path];
    const reversed = p.to === n.entry; // as routeFrom has it
    const nLen = pathLength(p.geom);
    if (n.pieceId === target) {
      runs.push({ pieceId: n.pieceId, pathIndex: w.path, s0: reversed ? nLen : 0, s1: nLen / 2 });
      return runs;
    }
    at = { pieceId: n.pieceId, pathIndex: w.path, reversed, s: reversed ? nLen : 0 };
  }
  return null;
}

/** From a train's front cursor to a piece: the way a routed train would go (as steer.ts chooses), or null. */
export function legFromCursor(layout: Layout, front: Cursor, targetPiece: number): Leg {
  if (!layout.getPiece(front.pieceId) || !layout.getPiece(targetPiece)) return null;
  const len = lengthOf(layout, front.pieceId, front.pathIndex);
  const s = front.reversed ? len - front.s : front.s;
  if (front.pieceId === targetPiece) {
    // On the stop already, short of its middle: just on to the middle.
    const ahead = front.reversed ? s >= len / 2 : s <= len / 2;
    if (ahead) return [{ pieceId: front.pieceId, pathIndex: front.pathIndex, s0: s, s1: len / 2 }];
  }
  return walkTo(layout, { pieceId: front.pieceId, pathIndex: front.pathIndex, reversed: front.reversed, s }, targetPiece);
}

/**
 * The way from the middle of stop piece `from` to the middle of `to`, leaving by whichever end of `from` is shorter.
 * Empty when they're the same piece.
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

/**
 * A line's legs: stop k to stop k+1, cyclically (the last back to the first), for stops given as depot piece ids.
 * Fewer than two stops: no legs.
 */
export function lineLegs(layout: Layout, stopPieces: readonly number[]): Leg[] {
  const n = stopPieces.length;
  if (n < 2) return [];
  const legs: Leg[] = [];
  for (let k = 0; k < n; k++) legs.push(legBetween(layout, stopPieces[k], stopPieces[(k + 1) % n]));
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
 * Asks a view of the layout with that one switch unpinned: the layout itself isn't touched (no version bumps).
 */
export function pinnedBlocking(layout: Layout, starts: readonly Cursor[], target: number): number {
  if (layout.pinnedCount === 0) return -1;
  for (const pin of layout.pinnedIds()) {
    const view = Object.create(layout, { isPinned: { value: (id: number) => id !== pin && layout.isPinned(id) } }) as Layout;
    if (starts.some((start) => legFromCursor(view, start, target) !== null)) return pin;
  }
  return -1;
}

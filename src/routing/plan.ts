/**
 * Plans: the way a routed train goes to its stop, piece by piece. Step 1 (docs/superpowers/specs/2026-10-30-train-routing.md
 * §13): a walk choosing at each switch as the router steers (`wayToward`, the shortest way on by the piece-count
 * `distanceTo`), so the way drawn on the map is the way the train takes.
 */
import { getPieceDef, pathLength, type Layout } from "../track";
import { distanceTo, next, SEARCH, wayToward, waysFrom, type PinnedTest } from "./graph";

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
export interface At {
  pieceId: number;
  pathIndex: number;
  reversed: boolean;
  s: number;
}

/**
 * The way a routed train goes from `start` to the middle of piece `target`, choosing at each switch as the router steers
 * (`wayToward`, the shortest way on by `distanceTo`) and turning back at the end of a line. Null if it never gets
 * there: no way leads there, or it would go round for ever. Bounded by `SEARCH` steps; `distanceTo` is memoised per
 * call, so each (piece, entry) is searched from at most once. `pinned`: which switches stay as they're set (by default the
 * layout's pinned ones).
 */
export function walkTo(layout: Layout, start: At, target: number, pinned?: PinnedTest): Leg {
  const memo = new Map<number, number>();
  const dist = (at: { pieceId: number; entry: number }) => {
    const key = at.pieceId * 8 + at.entry;
    let d = memo.get(key);
    if (d === undefined) memo.set(key, (d = distanceTo(layout, at, target, pinned)));
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
    const ways = n ? waysFrom(layout, n.pieceId, n.entry, pinned) : [];
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

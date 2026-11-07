/**
 * Walking the track ahead of a cursor: the one loop that follows a train's way piece by piece, as the points lie (or as
 * a chooser picks), for a distance. Before it, the same loop was written out in the shadow (`signalAhead`), the
 * router's look-aheads and road checks, the sim's cover and the give-way code, each with its own off-by-one at piece
 * ends (routing redesign §6.2).
 *
 * `walkTrack` visits each piece the walk is on, with the stretch of its path walked (mm from the walk's start), and
 * stops when the distance is used, at a buffer or an open end, or when the visitor says so. No allocation per call
 * beyond the visitor the caller passes.
 */
import { createRouteStep, getPieceDef, pathExitConnector, pathLength, routeFrom, type Layout, type RouteStep } from "../track";
import { ADV_BUFFER, ADV_OK, ADV_OPEN_END, type Cursor } from "./cursor";

/** How a walk ended: `ADV_OK` (the distance used, or the visitor stopped it), `ADV_BUFFER`, `ADV_OPEN_END`. */
export type WalkEnd = typeof ADV_OK | typeof ADV_BUFFER | typeof ADV_OPEN_END;

/**
 * Told of each piece a walk is on: its path and direction, and the stretch walked on it (`from` to `to`, mm from the
 * walk's start; the first piece's `from` is 0). Return false to stop the walk there.
 */
export type WalkVisit = (pieceId: number, pathIndex: number, reversed: boolean, from: number, to: number) => boolean | void;

/**
 * The way on at a joint: fill `out` with the piece, path and direction the walk goes on by from `pieceId`'s connector
 * `exit`, and return true; false: it goes nowhere (an open end). Default: as the points lie (`routeFrom`).
 */
export type WalkChooser = (layout: Layout, pieceId: number, exit: number, out: RouteStep) => boolean;

const step = createRouteStep();

/**
 * Walk `dist` mm on from `start` (not moved), visiting each piece on the way (`visit`), at most `maxPieces` of them.
 * Returns how the walk ended.
 */
export function walkTrack(layout: Layout, start: Cursor, dist: number, visit: WalkVisit, choose: WalkChooser = routeFrom, maxPieces = 64): WalkEnd {
  let pieceId = start.pieceId;
  let pathIndex = start.pathIndex;
  let reversed = start.reversed;
  let s = start.s;
  let done = 0;
  for (let k = 0; k < maxPieces; k++) {
    const piece = layout.getPiece(pieceId);
    if (!piece) return ADV_OPEN_END;
    const def = getPieceDef(piece.type, piece.flipped);
    const len = pathLength(def.paths[pathIndex].geom);
    const rest = Math.max(0, len - s);
    const to = Math.min(dist, done + rest);
    if (visit(pieceId, pathIndex, reversed, done, to) === false) return ADV_OK;
    if (done + rest >= dist) return ADV_OK;
    done += rest;
    const exit = pathExitConnector(def, pathIndex, reversed);
    if (exit === -1) return ADV_BUFFER;
    if (!choose(layout, pieceId, exit, step)) return ADV_OPEN_END;
    pieceId = step.pieceId;
    pathIndex = step.pathIndex;
    reversed = step.reversed;
    s = 0;
  }
  return ADV_OK;
}

/** The distance (mm) from a cursor to the far end of the path it's on, the way it heads. */
export function toPathEnd(layout: Layout, c: Cursor): number {
  const piece = layout.getPiece(c.pieceId);
  if (!piece) return 0;
  return pathLength(getPieceDef(piece.type, piece.flipped).paths[c.pathIndex].geom) - c.s;
}

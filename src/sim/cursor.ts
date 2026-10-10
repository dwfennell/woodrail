import {
  createRouteStep,
  createSample,
  getPieceDef,
  normalizeAngle,
  pathExitConnector,
  pathLength,
  routeFrom,
  samplePath,
  type Layout,
} from "../track";

/** A point on the track: distance `s` travelled along a path, in the cursor's direction of travel. */
export interface Cursor {
  pieceId: number;
  pathIndex: number;
  /** True when travelling from the path's `to` end toward its `from` end. */
  reversed: boolean;
  s: number;
}

export const ADV_OK = 0;
export const ADV_BUFFER = 1;
export const ADV_OPEN_END = 2;

export interface Advance {
  moved: number;
  status: number;
}

export const createAdvance = (): Advance => ({ moved: 0, status: ADV_OK });

/** Switch choices a train has committed to, shared by all its bogies until the last one passes. */
export type RouteMemory = Map<number, { path: number; remaining: number }>;

export interface WorldSample {
  x: number;
  y: number;
  z: number;
  /** Direction of travel. */
  heading: number;
  /** dy/ds in the direction of travel. */
  slope: number;
}

export const createWorldSample = (): WorldSample => ({ x: 0, y: 0, z: 0, heading: 0, slope: 0 });

const step = createRouteStep();
const local = createSample();

function lengthOf(layout: Layout, c: Cursor): number {
  const piece = layout.getPiece(c.pieceId)!;
  return pathLength(getPieceDef(piece.type, piece.flipped).paths[c.pathIndex].geom);
}

/**
 * Move a cursor `ds` (≥ 0) along the track, following switches. Stops at buffers and open ends.
 * With `memory`, switch choices made from the trunk are recorded for `bogieCount - 1` followers.
 * Writes into and returns `out`. No allocation unless a new switch memory entry is created.
 */
export function advanceCursor(
  layout: Layout,
  c: Cursor,
  ds: number,
  memory: RouteMemory | null,
  out: Advance,
  bogieCount = 1,
): Advance {
  let remaining = ds;
  out.moved = 0;
  out.status = ADV_OK;
  for (;;) {
    const piece = layout.getPiece(c.pieceId)!;
    const def = getPieceDef(piece.type, piece.flipped);
    const len = pathLength(def.paths[c.pathIndex].geom);
    if (c.s + remaining <= len) {
      c.s += remaining;
      out.moved += remaining;
      return out;
    }
    const toEnd = len - c.s;
    out.moved += toEnd;
    remaining -= toEnd;
    c.s = len;
    const exit = pathExitConnector(def, c.pathIndex, c.reversed);
    if (exit === -1) {
      out.status = ADV_BUFFER;
      return out;
    }
    if (!routeFrom(layout, c.pieceId, exit, step)) {
      out.status = ADV_OPEN_END;
      return out;
    }
    const next = layout.getPiece(step.pieceId)!;
    if (memory && !step.reversed && getPieceDef(next.type, next.flipped).isSwitch) {
      const m = memory.get(step.pieceId);
      if (m) {
        step.pathIndex = m.path;
        if (--m.remaining <= 0) memory.delete(step.pieceId);
      } else if (bogieCount > 1) {
        memory.set(step.pieceId, { path: step.pathIndex, remaining: bogieCount - 1 });
      }
    }
    c.pieceId = step.pieceId;
    c.pathIndex = step.pathIndex;
    c.reversed = step.reversed;
    c.s = 0;
  }
}

/** Reverse the cursor's direction of travel without moving it. */
export function flipCursor(layout: Layout, c: Cursor): void {
  c.s = lengthOf(layout, c) - c.s;
  c.reversed = !c.reversed;
}

/** World position, heading and slope of a cursor. Writes into and returns `out`. */
export function cursorWorld(layout: Layout, c: Cursor, out: WorldSample): WorldSample {
  const piece = layout.getPiece(c.pieceId)!;
  const geom = getPieceDef(piece.type, piece.flipped).paths[c.pathIndex].geom;
  const len = pathLength(geom);
  samplePath(geom, c.reversed ? len - c.s : c.s, local);
  const ch = Math.cos(piece.pose.heading);
  const sh = Math.sin(piece.pose.heading);
  out.x = piece.pose.x + local.x * ch - local.z * sh;
  out.z = piece.pose.z + local.x * sh + local.z * ch;
  out.y = piece.y + local.y;
  out.heading = normalizeAngle(piece.pose.heading + local.heading + (c.reversed ? Math.PI : 0));
  out.slope = c.reversed ? -local.slope : local.slope;
  return out;
}

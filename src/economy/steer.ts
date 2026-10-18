import { connectorRef, getPieceDef, indexOfRef, MAX_CONNECTORS, pieceOfRef, type Layout } from "../track";
import { flipCursor, type Cursor, type Train } from "../sim";

/** How far ahead of a train (pieces) a switch is set for it: the next one it will choose at, within this many. */
const LOOK_AHEAD = 6;
/** The most track pieces a search for the way to a stop goes through. */
export const SEARCH = 4000;

/**
 * The way out of a piece entered through `entry`: each path from that end (`option` counts them, as switch states do;
 * `path` is its index in the piece's paths), and where it leaves (−1: a buffer). A pinned switch (or a deck) has just
 * the one way it's set to, so `steer` passes it by and `distanceTo` follows only that route.
 */
export function waysFrom(layout: Layout, pieceId: number, entry: number): { option: number; path: number; exit: number }[] {
  const piece = layout.getPiece(pieceId);
  if (!piece) return [];
  const def = getPieceDef(piece.type, piece.flipped);
  const paths = def.paths;
  // A deck (a turntable's): only the way it lies now goes anywhere (steering doesn't turn it).
  const open = def.gated ? (layout.deckTurning(pieceId) ? paths.length : layout.switchState(pieceId) % paths.length) : -1;
  const out: { option: number; path: number; exit: number }[] = [];
  for (let i = 0; i < paths.length; i++) {
    const p = paths[i];
    if (open !== -1 && i !== open) continue;
    if (p.from !== entry && p.to !== entry) continue;
    out.push({ option: out.length, path: i, exit: p.from === entry ? (p.to ?? -1) : p.from });
  }
  // A pinned switch: only the route it's set to goes anywhere (steering doesn't throw it), picked as `routeFrom` does.
  if (out.length > 1 && layout.isPinned(pieceId)) {
    const set = out[layout.switchState(pieceId) % out.length];
    return [{ option: 0, path: set.path, exit: set.exit }];
  }
  return out;
}

/** Where track leaving `pieceId` through connector `exit` goes on: the next piece and the end it's entered by. */
export function next(layout: Layout, pieceId: number, exit: number): { pieceId: number; entry: number } | null {
  if (exit < 0) return null;
  const joined = layout.joinedConnector(connectorRef(pieceId, exit));
  return joined === -1 ? null : { pieceId: pieceOfRef(joined), entry: indexOfRef(joined) };
}

/** What turning back at the end of a line costs a way to a stop, in pieces: a way straight on is better. */
export const TURN_COST = 12;

/**
 * How many pieces from (piece, entry) to `target` along the track; −1 if it can't be reached. A train turns back at
 * the end of a line (a buffer, or track that just stops), so a way may too, at a cost (`TURN_COST`).
 */
export function distanceTo(layout: Layout, start: { pieceId: number; entry: number }, target: number): number {
  const seen = new Set<number>([start.pieceId * MAX_CONNECTORS + start.entry]);
  // Ways by length: turning back puts a way further down the list.
  const byDepth: { pieceId: number; entry: number }[][] = [[start]];
  let count = 1;
  for (let depth = 0; depth < byDepth.length && count < SEARCH; depth++) {
    for (const at of byDepth[depth] ?? []) {
      if (at.pieceId === target) return depth;
      const push = (n: { pieceId: number; entry: number }, d: number) => {
        if (seen.has(n.pieceId * MAX_CONNECTORS + n.entry)) return;
        seen.add(n.pieceId * MAX_CONNECTORS + n.entry);
        (byDepth[d] ??= []).push(n);
        count++;
      };
      for (const w of waysFrom(layout, at.pieceId, at.entry)) {
        const n = next(layout, at.pieceId, w.exit);
        if (n) push(n, depth + 1);
        // The end of the line: the train comes back the way it came, through this piece and out where it came in.
        else {
          const back = next(layout, at.pieceId, at.entry);
          if (back) push(back, depth + TURN_COST);
        }
      }
    }
  }
  return -1;
}

/**
 * At a choice (`ways` out of `pieceId`, from `waysFrom`), the option that reaches `target` soonest (as `steer` chooses);
 * −1 if none does. `dist` is the search (`distanceTo` by default; a caller may pass a memo of it).
 */
export function wayToward(
  layout: Layout,
  pieceId: number,
  ways: readonly { option: number; exit: number }[],
  target: number,
  dist: (at: { pieceId: number; entry: number }) => number = (at) => distanceTo(layout, at, target),
): number {
  let best = -1;
  let bestD = Infinity;
  for (const w of ways) {
    const after = next(layout, pieceId, w.exit);
    const d = after ? (after.pieceId === target ? 0 : dist(after)) : -1;
    if (d >= 0 && d < bestD) {
      bestD = d;
      best = w.option;
    }
  }
  return best;
}

/**
 * Set the next switch ahead of a train (the next piece it enters where it has a choice) toward the piece `target`,
 * the shortest way on. Leaves it as it is if no way leads there. Returns true if a switch was changed. A pinned switch
 * is never thrown: it offers no choice (`waysFrom`), so the next one beyond it is set instead.
 */
export function steer(layout: Layout, train: Train, forward: boolean, target: number): boolean {
  // The cursor at the train's front, pointing the way it goes.
  const b = forward ? train.bogies[0] : train.bogies[train.bogies.length - 1];
  const c: Cursor = { ...b };
  if (!forward) flipCursor(layout, c);
  const piece = layout.getPiece(c.pieceId);
  if (!piece || c.pieceId === target) return false;
  const def = getPieceDef(piece.type, piece.flipped);
  const path = def.paths[c.pathIndex];
  let exit = c.reversed ? path.from : (path.to ?? -1);
  let at = c.pieceId;
  for (let k = 0; k < LOOK_AHEAD; k++) {
    const n = next(layout, at, exit);
    if (!n || n.pieceId === target) return false;
    const ways = waysFrom(layout, n.pieceId, n.entry);
    if (ways.length > 1) {
      const best = wayToward(layout, n.pieceId, ways, target);
      if (best === -1 || layout.switchState(n.pieceId) % ways.length === best) return false;
      layout.setSwitchState(n.pieceId, best);
      return true;
    }
    if (ways.length === 0) return false;
    at = n.pieceId;
    exit = ways[0].exit;
  }
  return false;
}

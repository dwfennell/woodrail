/**
 * The stretch of track between two trains (a stuck card's Show, when what's wanting is a passing place: there, a loop
 * would let them pass). The shortest way along the track from either end of one train to a piece under the other,
 * through points either way they could lie. Asked on a tap, never per frame; the search is capped.
 */
import { getPieceDef, type Layout } from "../track";
import { flipCursor, type Cursor, type Train } from "../sim";
import { next, SEARCH, waysFrom } from "./graph";

/** Its end's way out: the piece and end the track goes on to past cursor `c` (heading the way `c` points). */
function beyond(layout: Layout, c: Cursor): { pieceId: number; entry: number } | null {
  const piece = layout.getPiece(c.pieceId);
  if (!piece) return null;
  const path = getPieceDef(piece.type, piece.flipped).paths[c.pathIndex];
  if (!path) return null;
  return next(layout, c.pieceId, c.reversed ? path.from : (path.to ?? -1));
}

/**
 * The pieces between train `a` and the train standing on `under` (its pieces), in order from `a`, neither train's own;
 * [] where they touch, null where no way joins them within the cap.
 */
export function stretchBetween(layout: Layout, a: Train, under: ReadonlySet<number>): number[] | null {
  if (a.bogies.length === 0 || under.size === 0) return null;
  const mine = new Set<number>();
  for (const b of a.bogies) mine.add(b.pieceId);
  for (const id of mine) if (under.has(id)) return [];
  const rear = { ...a.bogies[a.bogies.length - 1] };
  flipCursor(layout, rear);
  const from = new Map<number, number>(); // node (piece × 8 + entry) → the node it was come to from (−1: an end of `a`)
  const queue: number[] = [];
  for (const c of [a.bogies[0], rear]) {
    const n = beyond(layout, c);
    if (!n) continue;
    const k = n.pieceId * 8 + n.entry;
    if (from.has(k)) continue;
    from.set(k, -1);
    queue.push(k);
  }
  const all = () => false;
  for (let i = 0; i < queue.length && i < SEARCH; i++) {
    const k = queue[i];
    const pieceId = k >> 3;
    if (under.has(pieceId)) {
      const out: number[] = [];
      for (let p = from.get(k)!; p !== -1; p = from.get(p)!) out.push(p >> 3);
      return out.reverse().filter((id) => !mine.has(id));
    }
    for (const w of waysFrom(layout, pieceId, k & 7, all)) {
      const n = next(layout, pieceId, w.exit);
      if (!n) continue;
      const nk = n.pieceId * 8 + n.entry;
      if (from.has(nk)) continue;
      from.set(nk, k);
      queue.push(nk);
    }
  }
  return null;
}

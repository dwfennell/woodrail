/**
 * Giving way (economy/stalls.ts): may a routed train, nose to nose with another for good, turn round and go another way
 * to its next stop? Only where the track gives it one: a way round (a ring, a loop round, a wye or a balloon) that runs
 * no turn-back and over none of the pieces the train in its way stands on. Else turning it would only bring it back.
 */
import { getPieceDef, type Layout } from "../track";
import { flipCursor, type Cursor, type Train } from "../sim";
import { next, waysFrom } from "./graph";
import { plan } from "./plan";

/**
 * Turned round where it stands (heading out past its last axle), does `train` have a way to piece `target` with no
 * turn-back and over none of `avoid`'s pieces? One plan search (capped), asked only when a ring of waits has held.
 */
export function wayRound(layout: Layout, train: Train, target: number, avoid: ReadonlySet<number>): boolean {
  if (target < 0 || train.bogies.length === 0) return false;
  const c = { ...train.bogies[train.bogies.length - 1] };
  flipCursor(layout, c);
  const piece = layout.getPiece(c.pieceId);
  if (!piece) return false;
  const path = getPieceDef(piece.type, piece.flipped).paths[c.pathIndex];
  const exit = c.reversed ? path.from : (path.to ?? -1);
  if (exit < 0) return false;
  const n = next(layout, c.pieceId, exit);
  if (!n || avoid.has(n.pieceId)) return false;
  if (n.pieceId === target) return true;
  const p = plan(layout, { pieceId: n.pieceId, entry: n.entry, lead: true }, target);
  if (!p) return false;
  for (const s of p.steps) if (s.reverse || avoid.has(s.pieceId)) return false;
  return true;
}

/** How far (pieces) a box is walked: further than any line the fuzz lays. */
const WALK = 64;

/**
 * The dead end a train is boxed into: its pieces and the plain track from one of its ends on to the end of the line (no
 * facing points, no other train); null if neither end runs so. (Both ends: a train alone on a plain line; then the box
 * is the side away from `toward`'s pieces, if given.)
 */
export function boxOf(layout: Layout, trains: readonly Train[], t: Train, toward?: ReadonlySet<number>): Set<number> | null {
  if (t.bogies.length === 0) return null;
  const others = new Set<number>();
  for (const o of trains) if (o.id !== t.id && !o.derailed) for (const b of o.bogies) others.add(b.pieceId);
  const own = new Set(t.bogies.map((b) => b.pieceId));
  const front: Cursor = { ...t.bogies[0] };
  const back: Cursor = { ...t.bogies[t.bogies.length - 1] };
  flipCursor(layout, back);
  for (const c of [front, back]) {
    const walked = plainToEnd(layout, c, others);
    if (!walked) continue;
    if (toward && [...walked].some((p) => toward.has(p))) continue;
    return new Set([...own, ...walked]);
  }
  return null;
}

/** From cursor `c` on out its way: the pieces to the end of the line, or null at facing points or another train. */
function plainToEnd(layout: Layout, c: Cursor, others: ReadonlySet<number>): Set<number> | null {
  const piece = layout.getPiece(c.pieceId);
  if (!piece) return null;
  const path = getPieceDef(piece.type, piece.flipped).paths[c.pathIndex];
  let exit = c.reversed ? path.from : (path.to ?? -1);
  let at = c.pieceId;
  const out = new Set<number>();
  for (let k = 0; k < WALK; k++) {
    if (exit < 0) return out;
    const n = next(layout, at, exit);
    if (!n) return out;
    if (others.has(n.pieceId)) return null;
    const ways = waysFrom(layout, n.pieceId, n.entry);
    if (ways.length > 1) return null;
    out.add(n.pieceId);
    if (ways.length === 0) return out;
    at = n.pieceId;
    exit = ways[0].exit;
  }
  return null;
}

/**
 * Turned round, may a routed train let the train in its way by? Only where that one is a train boxed into a dead end
 * (`boxOf`) on the routed one's way, the routed train's next stop (`target`) in that box, and behind the routed train
 * plain track runs to facing points (a passing loop's, a siding's) with no train between: turned back to them, it
 * leaves the boxed one a way out, and they pass there. (Fuzz seed 125: the routed train stood on the single line past a
 * passing loop, bound for the line's end, a hand-run train boxed in there on its stop; each waited on the other for good.)
 */
export function letsBy(layout: Layout, trains: readonly Train[], train: Train, by: Train, target: number): boolean {
  if (target < 0 || train.bogies.length === 0) return false;
  const box = boxOf(layout, trains, by, new Set(train.bogies.map((b) => b.pieceId)));
  if (!box || !box.has(target) || train.bogies.some((b) => box.has(b.pieceId))) return false;
  const others = new Set<number>();
  for (const o of trains) if (o.id !== train.id && !o.derailed) for (const b of o.bogies) others.add(b.pieceId);
  const c: Cursor = { ...train.bogies[train.bogies.length - 1] };
  flipCursor(layout, c);
  const piece = layout.getPiece(c.pieceId);
  if (!piece) return false;
  const path = getPieceDef(piece.type, piece.flipped).paths[c.pathIndex];
  let exit = c.reversed ? path.from : (path.to ?? -1);
  let at = c.pieceId;
  for (let k = 0; k < WALK && exit >= 0; k++) {
    const n = next(layout, at, exit);
    if (!n || others.has(n.pieceId)) return false;
    const ways = waysFrom(layout, n.pieceId, n.entry);
    if (ways.length === 0) return false;
    if (ways.length > 1) return true;
    at = n.pieceId;
    exit = ways[0].exit;
  }
  return false;
}

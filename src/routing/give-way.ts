/**
 * Giving way (economy/stalls.ts): may a routed train, nose to nose with another for good, turn round and go another way
 * to its next stop? Only where the track gives it one: a way round (a ring, a loop round, a wye or a balloon) that runs
 * no turn-back and over none of the pieces the train in its way stands on. Else turning it would only bring it back.
 */
import { getPieceDef, type Layout } from "../track";
import { flipCursor, type Train } from "../sim";
import { next } from "./graph";
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

/**
 * The booking table (routing redesign §3.2, corrected by §6 F3): who holds which road of which piece. The unit is a
 * (piece, path), not a piece: two trains may hold the two roads of a double straight, or a crossover's two straights, at
 * once, because those paths don't foul (`track/points.ts`, `masksFoul`). On a switch, a crossing, a slip or a deck, any
 * two holds whose paths foul exclude each other.
 *
 * A hold is a train's (its key: a stable number per train) mask of paths on a piece, and what it's for: `under` (the
 * track under its cars, end to end: §6 F1, F8) or `ahead` (booked on ahead of it). A train may hold several pieces, and
 * several paths on one. The table only records and answers; the rules for when to take and give back are its users'.
 */
import { getPieceDef, masksFoul, type Layout } from "../track";

export type HoldKind = "under" | "ahead";

export interface Hold {
  key: number;
  mask: number;
  kind: HoldKind;
}

export class BookingTable {
  private readonly byPiece = new Map<number, Hold[]>();
  private readonly byKey = new Map<number, Set<number>>();
  /** Bumped on every change (readers that cache by it see a new table). */
  version = 0;

  constructor(private readonly layout: Layout) {}

  /** Forget every hold. */
  clear(): void {
    if (this.byPiece.size === 0) return;
    this.byPiece.clear();
    this.byKey.clear();
    this.version++;
  }

  /** Record a hold of paths `mask` on a piece for train `key` (merged with one of the same kind it has there). */
  hold(pieceId: number, key: number, mask: number, kind: HoldKind): void {
    let list = this.byPiece.get(pieceId);
    if (!list) this.byPiece.set(pieceId, (list = []));
    const h = list.find((x) => x.key === key && x.kind === kind);
    if (h) {
      if ((h.mask | mask) === h.mask) return;
      h.mask |= mask;
    } else list.push({ key, mask, kind });
    let pieces = this.byKey.get(key);
    if (!pieces) this.byKey.set(key, (pieces = new Set()));
    pieces.add(pieceId);
    this.version++;
  }

  /** Give back a train's holds on a piece (of `kind`, or all). */
  release(pieceId: number, key: number, kind?: HoldKind): void {
    const list = this.byPiece.get(pieceId);
    if (!list) return;
    const n = list.length;
    for (let i = list.length - 1; i >= 0; i--) if (list[i].key === key && (kind === undefined || list[i].kind === kind)) list.splice(i, 1);
    if (list.length === n) return;
    if (list.length === 0) this.byPiece.delete(pieceId);
    if (!list.some((h) => h.key === key)) this.byKey.get(key)?.delete(pieceId);
    this.version++;
  }

  /** Give back every hold of a train (of `kind`, or all). */
  releaseAll(key: number, kind?: HoldKind): void {
    const pieces = this.byKey.get(key);
    if (!pieces) return;
    for (const p of [...pieces]) this.release(p, key, kind);
    if (pieces.size === 0) this.byKey.delete(key);
  }

  /** The holds on a piece (none: empty). */
  holdsOn(pieceId: number): readonly Hold[] {
    return this.byPiece.get(pieceId) ?? NONE;
  }

  /** The pieces a train holds anything on. */
  piecesOf(key: number): ReadonlySet<number> {
    return this.byKey.get(key) ?? NO_PIECES;
  }

  /**
   * The first other train (its key) whose hold on this piece fouls paths `mask`; −1: none, the paths are free for
   * `key`. `kind` limits it to holds of that kind.
   */
  blocker(pieceId: number, mask: number, key: number, kind?: HoldKind): number {
    const list = this.byPiece.get(pieceId);
    if (!list) return -1;
    const p = this.layout.getPiece(pieceId);
    if (!p) return -1;
    const def = getPieceDef(p.type, p.flipped);
    for (const h of list) if (h.key !== key && (kind === undefined || h.kind === kind) && masksFoul(def, h.mask, mask)) return h.key;
    return -1;
  }

  /** Does any train but `key` hold anything on this piece? */
  heldByOther(pieceId: number, key: number): boolean {
    const list = this.byPiece.get(pieceId);
    return !!list && list.some((h) => h.key !== key);
  }
}

const NONE: readonly Hold[] = [];
const NO_PIECES: ReadonlySet<number> = new Set();

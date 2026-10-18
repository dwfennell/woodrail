import type { PieceTypeId } from "../track";
import type { Progress } from "./progress";
import { isFree, ruleOf, thingsFor } from "./things";
import type { World } from "./world";

/**
 * Game mode's supply of track pieces, for a drawn line (DrawHand.stock and .unlearned): how many of a piece the player
 * could put down now (0 if not learned), and what to say of one not learned yet, as the tray says it.
 */
export function pieceStock(progress: Progress, world: World, type: PieceTypeId): number {
  const needs = thingsFor({ kind: "piece", type });
  let n = Infinity;
  for (const [id, k] of needs) {
    if (!progress.knows(id)) return 0;
    if (isFree(id)) continue;
    n = Math.min(n, Math.floor(progress.available(world, id) / k));
  }
  return n;
}

/** A track piece not learned yet, as the tray says it ("Three-way: not learned yet"), or null. */
export function pieceUnlearned(progress: Progress, type: PieceTypeId): string | null {
  for (const id of thingsFor({ kind: "piece", type }).keys()) if (!progress.knows(id)) return `${ruleOf(id)!.label}: not learned yet`;
  return null;
}

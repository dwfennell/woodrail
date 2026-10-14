import type { CargoKind } from "../economy/cargo";
import type { Progress } from "./progress";
import { offerFor } from "./tech";
import { payFor, type TownStatus } from "./towns";

/**
 * What Game mode gives for what happens on the railway, in one place for the game and for headless playthroughs:
 * coins for goods a town receives, and a choice of blueprints when a town grows.
 */

/** A town received `n` units of `kind` (it was `before` then): pay for them. Returns the coins paid. */
export function payDelivery(p: Progress, kind: CargoKind, n: number, before: TownStatus): number {
  const paid = payFor(kind, before) * n;
  p.coins += paid;
  return paid;
}

/** A town grew: it offers two blueprints to choose from (one learned free). Returns them (none left: empty). */
export function offerOnGrowth(p: Progress, townName: string, random: () => number): string[] {
  const offer = offerFor(p, random);
  if (offer.length > 0) p.offers.push({ from: townName, ids: offer });
  return offer;
}

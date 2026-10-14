import type { CargoKind } from "../economy/cargo";
import type { Landscape, Town } from "../landscape";
import { MARKET_BONUS, SCHOOL_IDEA_SECONDS, townLandmarks } from "./landmarks";
import type { Progress } from "./progress";
import { offerFor } from "./tech";
import { payFor, type TownStatus } from "./towns";

/**
 * What Game mode gives for what happens on the railway, in one place for the game and for headless playthroughs:
 * coins for goods a town receives, and a choice of blueprints when a town grows.
 */

/** A town received `n` units of `kind` (it was `before` then): pay for them. Returns the coins paid. */
export function payDelivery(p: Progress, kind: CargoKind, n: number, before: TownStatus, town?: Town): number {
  // A town with a market pays half again.
  const bonus = town && townLandmarks(town).has("market") ? MARKET_BONUS : 1;
  const paid = Math.round(payFor(kind, before) * n * bonus);
  p.coins += paid;
  return paid;
}

/**
 * Schools have ideas: every `SCHOOL_IDEA_SECONDS` of play (sooner with more schools), a town with a school offers two
 * blueprints to choose from, unless one of its offers is still waiting. `clock` carries the time between calls.
 * Returns the town that offered, or null.
 */
export function schoolIdeas(p: Progress, land: Landscape, clock: { seconds: number }, seconds: number, random: () => number): string | null {
  const schools = land.towns.filter((t) => townLandmarks(t).has("school"));
  if (schools.length === 0 || p.offers.some((o) => o.from.endsWith(" school"))) return null;
  clock.seconds += seconds * schools.length;
  if (clock.seconds < SCHOOL_IDEA_SECONDS) return null;
  clock.seconds = 0;
  const town = schools[Math.floor(random() * schools.length)];
  const from = `${town.name} school`;
  const offer = offerFor(p, random);
  if (offer.length === 0) return null;
  p.offers.push({ from, ids: offer });
  return from;
}

/** A town grew: it offers two blueprints to choose from (one learned free). Returns them (none left: empty). */
export function offerOnGrowth(p: Progress, townName: string, random: () => number): string[] {
  const offer = offerFor(p, random);
  if (offer.length > 0) p.offers.push({ from: townName, ids: offer });
  return offer;
}

import type { DepotRole } from "../economy/economy";
import type { CargoKind } from "../economy/cargo";
import { BLUEPRINTS, type Blueprint } from "./blueprints";

/**
 * Know-how: a balancing sheet for research "option B". DATA ONLY: nothing in the game imports this file, and nothing
 * that runs today reads it. It is here to be argued over before anything is wired in.
 *
 * Option B, in short: every load delivered earns know-how (a bar beside the coins); blueprints cost know-how, and
 * from tier 2 on coins as well (the coin prices stay as they are today); planks go to the workshop only to make
 * pieces; a town's school, library or college multiplies the know-how its deliveries earn. School ideas stay.
 *
 * The rates
 * - A load (one crane move off a wagon) that reaches a place that uses it (a town, the workshop, a harbour's quay)
 *   earns KNOWHOW_PER_LOAD = 1. A load into an industry (logs to a sawmill, grain to a mill, coal and ore to a
 *   foundry...) earns half: it is half-way along a chain, and the chain's end pays the rest. A warehouse earns
 *   nothing (storage, and a train shuttling between two warehouses would otherwise farm know-how); the load earns
 *   when it is taken on from there. A rider getting off earns half: riders appear at every station by themselves,
 *   a coach seats 4 to a wagon's 3, and the passenger line already learns its own blueprints by riders carried.
 * - A town's landmarks multiply what is delivered to its station: school ×1.5, library ×1.75, college ×2 (a market
 *   pays coins, not know-how). They don't stack: the best one counts (see `townMultiplier`), so a city with all
 *   three learns ×2, not ×5.25, and the one college town doesn't run away with the game.
 * - Prices: Switches is 15 know-how (6 planks today: 2.5 know-how a plank). Each tier is a band, priced
 *   KNOWHOW_TIER_BASE[tier] + 2.5 a plank of today's price, so the order within a tier stays today's order and
 *   every tier-2 blueprint costs more than every tier-1 one, every tier-3 more than every tier-2:
 *   tier 1 15–30, tier 2 40–85, tier 3 90–190. Coins and other goods (stone, iron) stay as they are.
 *
 * Measured rate (the timber oval of `economy/scenario.test.ts`, one engine and three timber wagons, timed from its
 * first delivery in `knowhow.test.ts`): about 3.1 planks a minute to the town and 3.8 logs to the sawmill, which is
 * about 5.0 know-how a minute; 6.6 if the town has a school (its planks ×1.5; the logs aren't a town's).
 *
 * Expected time to each tier on that one train, along the grand tour's path (Switches; then Train routes; then
 * Farming, Mills and Quarries), from the first delivery:
 *                          know-how   no school   with a school
 *   tier 1 (Switches)           15      ~3 min        ~2.3 min
 *   tier 2 (+ Routes)           65     ~13 min         ~10 min
 *   tier 3 (+ Farming, Mills,  310     ~62 min         ~47 min
 *           Quarries)
 * A second train on the line about halves these (the grand tour runs two or three from tier 2 on), and the library
 * (×1.75, from a city) and college (×2) shorten tier 3 further. Today the grand tour (learning by shortcut) reaches
 * Quarries at about 12 minutes and Mines and Foundry at about 55.
 *
 * Note: the design note's "Switches in about the first 10 minutes of deliveries" doesn't hold at 1 a load: one
 * timber train earns 15 know-how in its first 3 minutes. Ten minutes would take about 0.3 a load, or Switches at
 * about 50.
 */

/** Know-how for one load delivered where it's used (a town, the workshop, a harbour). */
export const KNOWHOW_PER_LOAD = 1;

/** A load into an industry (half-way along a chain) earns this share. */
export const INPUT_SHARE = 0.5;

/** A rider getting off at a town earns this share of a load. */
export const RIDER_SHARE = 0.5;

/** What a load unloaded at each kind of depot earns, as a share of `KNOWHOW_PER_LOAD`. */
export const ROLE_SHARE: Readonly<Record<DepotRole, number>> = {
  town: 1,
  workshop: 1,
  harbour: 1,
  sawmill: INPUT_SHARE,
  mill: INPUT_SHARE,
  foundry: INPUT_SHARE,
  carpenter: INPUT_SHARE,
  smithy: INPUT_SHARE,
  power: INPUT_SHARE,
  warehouse: 0,
  // These take nothing in (they only give), so nothing is ever delivered to them.
  forest: 0,
  farm: 0,
  quarry: 0,
  mine: 0,
};

/**
 * Per-goods weights, all 1: a load is a crane move whatever it holds, and the longer chains already earn more
 * (each step of the chain earns its share). Weighting by price would make one van of furniture worth 12 of logs.
 * Kept as a table so a weighting can be tried without changing the helpers.
 */
export const GOODS_WEIGHT: Readonly<Record<CargoKind, number>> = {
  log: 1,
  planks: 1,
  grain: 1,
  flour: 1,
  stone: 1,
  coal: 1,
  ore: 1,
  iron: 1,
  furniture: 1,
  tools: 1,
};

/** What a town's landmark multiplies its deliveries' know-how by (landmark ids from `landmarks.ts`). */
export const LANDMARK_MULTIPLIER: Readonly<Record<string, number>> = {
  school: 1.5,
  library: 1.75,
  college: 2,
  market: 1,
};

/**
 * A town's know-how multiplier: its best landmark's, not their product (max, not multiply). The landmarks come in
 * order as a town grows (school, then library, and one town gets the college), so the product would run away in
 * the one big city; the best one is also simpler to show on a town's card ("learns ×2").
 */
export function townMultiplier(landmarks: Iterable<string>): number {
  let best = 1;
  for (const id of landmarks) best = Math.max(best, LANDMARK_MULTIPLIER[id] ?? 1);
  return best;
}

/**
 * Know-how for `n` loads of `kind` unloaded at a depot of `role`; `landmarks` are the town's, for a town's station
 * (a depot that isn't a town's has none).
 */
export function knowHowFor(role: DepotRole, kind: CargoKind, n = 1, landmarks: Iterable<string> = []): number {
  const town = role === "town" ? townMultiplier(landmarks) : 1;
  return n * KNOWHOW_PER_LOAD * ROLE_SHARE[role] * GOODS_WEIGHT[kind] * town;
}

/** Know-how for `n` riders getting off at a town with these landmarks. */
export function knowHowForRiders(n: number, landmarks: Iterable<string> = []): number {
  return n * KNOWHOW_PER_LOAD * RIDER_SHARE * townMultiplier(landmarks);
}

/** Know-how a plank of today's price is worth (Switches: 6 planks, 15 know-how). */
export const KNOWHOW_PER_PLANK = 2.5;

/** Where each tier's prices start (see the note at the top). */
export const KNOWHOW_TIER_BASE: Readonly<Record<1 | 2 | 3, number>> = { 1: 0, 2: 25, 3: 90 };

/** The ending's blueprints have no tier or plank price today: their know-how, set by hand. */
export const ENDING_KNOWHOW: Readonly<Record<string, number>> = { rocket: 300, launch: 0 };

/** Prices are rounded to this (an easy number on a bar). */
const ROUND_TO = 5;

/**
 * A blueprint's know-how price: its tier's base plus 2.5 a plank of today's price, rounded to 5. Blueprints learned
 * by themselves (the school, the library, the passenger line) cost nothing, as today. A blueprint without a tier is
 * priced as tier 1 (none on the board today).
 */
export function knowHowPrice(b: Blueprint): number {
  if (b.learn === "auto") return 0;
  if (b.id in ENDING_KNOWHOW) return ENDING_KNOWHOW[b.id];
  const tier = b.tier ?? 1;
  const raw = KNOWHOW_TIER_BASE[tier] + (b.price.planks ?? 0) * KNOWHOW_PER_PLANK;
  return Math.max(ROUND_TO, Math.round(raw / ROUND_TO) * ROUND_TO);
}

/** What a blueprint costs under option B: know-how, today's coins, and today's goods other than planks. */
export interface KnowHowPrice {
  readonly knowhow: number;
  readonly coins?: number;
  readonly goods?: Readonly<Record<string, number>>;
}

export function optionBPrice(b: Blueprint): KnowHowPrice {
  return {
    knowhow: knowHowPrice(b),
    ...(b.price.coins ? { coins: b.price.coins } : {}),
    ...(b.price.goods ? { goods: b.price.goods } : {}),
  };
}

/** Every blueprint's option-B price, by id. */
export const KNOWHOW_PRICES: ReadonlyMap<string, KnowHowPrice> = new Map(BLUEPRINTS.map((b) => [b.id, optionBPrice(b)]));

/**
 * Old saves: a one-off grant of know-how for the planks in the workshops' yards when the save is first loaded under
 * option B, at the rate the prices were set by (2.5 a plank: what those planks would have bought). Blueprints
 * already learned stay learned.
 */
export const OLD_SAVE_KNOWHOW_PER_PLANK = KNOWHOW_PER_PLANK;

export function knowHowFromOldSave(workshopPlanks: number): number {
  return Math.floor(Math.max(0, workshopPlanks) * OLD_SAVE_KNOWHOW_PER_PLANK);
}

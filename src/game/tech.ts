import { WORKSHOP_CAP } from "../economy/economy";
import type { Bag } from "../economy/goods";
import { BLUEPRINTS, type Blueprint, type Need, type Price } from "./blueprints";
import { takeFromWorkshops } from "./crafting";
import type { Progress } from "./progress";
import { THING_RULES, type ThingId } from "./things";
import type { World } from "./world";

/**
 * The rules for learning blueprints (Game mode), on the catalogue in `blueprints.ts`: what can be learned now, what a
 * growing town offers, learning one free or at its price, and the ones learned by themselves.
 */

/** A blueprint (see `Blueprint`). */
export type Tech = Blueprint;

/** Every blueprint, built or planned. */
export const TECHS: readonly Tech[] = BLUEPRINTS;

/**
 * On the board from a new game's start, to be learned with goods. Farming and mills are here (not left to a town's
 * offer) because a town wants flour to grow past a town: without them in reach a game could stall there for an hour.
 */
export const STARTING_BOARD: readonly string[] = ["switches", "bridges", "farming", "mills"];

const BY_ID = new Map(TECHS.map((t) => [t.id, t]));
export const techOf = (id: string): Tech | undefined => BY_ID.get(id);

/** Is it in the game yet (not just planned, "coming soon")? */
export const built = (t: Tech): boolean => t.plan === undefined;

/** What a blueprint lets you make. */
export function unlocksOf(id: string): ThingId[] {
  return (Object.keys(THING_RULES) as ThingId[]).filter((t) => THING_RULES[t]!.tech === id);
}

/** A counted thing toward a requirement: people carried, blueprints learned, and the counters the game keeps. */
export function statOf(p: Progress, stat: string): number {
  if (stat === "riders") return p.riders;
  if (stat === "blueprints") return p.learned.size;
  return p.counts.get(stat) ?? 0;
}

/** Has this requirement been met? (Ones the game can't check yet, like "a town by water", never are.) */
export function needMet(p: Progress, n: Need): boolean {
  switch (n.kind) {
    case "count":
      return statOf(p, n.stat) >= n.n;
    case "delivered":
      return statOf(p, `delivered:${n.good}`) >= n.n;
    case "level":
      return (n.towns ?? 1) <= 1 && p.bestLevel >= n.level;
    case "landmark":
      return p.landmarks.has(n.id);
    case "place":
      return false;
  }
}

/** Can it be learned now: built, not learned, everything it needs learned and everything it requires done? */
export function ready(p: Progress, id: string): boolean {
  const t = techOf(id);
  return !!t && built(t) && !p.learned.has(id) && t.needs.every((n) => p.learned.has(n)) && t.requires.every((n) => needMet(p, n));
}

/**
 * How much of each blueprint a player sees: "shown" if it's a key one, learned, offered, on the board, or next to
 * something learned; a "?" (hint) one step further on; beyond that nothing yet, so the web grows as you learn. A
 * university shows everything.
 */
export function seenOf(p: Progress, offered: ReadonlySet<string> = new Set()): Map<string, "shown" | "hint" | "unseen"> {
  const all = p.learned.has("university");
  const shown = new Set(TECHS.filter((t) => all || t.key || p.learned.has(t.id) || offered.has(t.id) || p.board.has(t.id) || t.needs.some((n) => p.learned.has(n))).map((t) => t.id));
  return new Map(TECHS.map((t) => [t.id, shown.has(t.id) ? "shown" : t.needs.some((n) => shown.has(n)) ? "hint" : "unseen"]));
}

/** What it costs this player: its price, a fifth fewer planks once a college is learned. */
export function priceOf(p: Progress, t: Tech): Price {
  if (!p.learned.has("college") || !t.price.planks) return t.price;
  return { ...t.price, planks: Math.ceil(t.price.planks * 0.8) };
}

/**
 * Planks the workshop keeps (towns don't take them from unrouted trains, which carry them on to it) until its yard
 * holds this many: enough for the cheapest blueprint ready on the board, or, if more, for the one the current goal is
 * after (`aim`: Bridges for "Build a bridge"). With only the cheapest, a 10-plank Bridges waited at 9 while an 8-plank
 * one was ready (QA); keeping for the dearest starved the towns (the balance play-through: a City up to 76 minutes
 * later). No more than the yard holds. 0: nothing to keep for.
 */
export function planksWanted(p: Progress, aim: string | null = null, yardCap = WORKSHOP_CAP): number {
  const open = (t: Tech) => p.board.has(t.id) && !p.learned.has(t.id) && ready(p, t.id);
  let cheapest = Infinity;
  for (const t of TECHS) {
    const planks = open(t) ? (priceOf(p, t).planks ?? 0) : 0;
    if (planks > 0) cheapest = Math.min(cheapest, planks);
  }
  const goal = aim ? techOf(aim) : undefined;
  const aimed = goal && open(goal) ? (priceOf(p, goal).planks ?? 0) : 0;
  const want = Math.max(cheapest === Infinity ? 0 : cheapest, aimed);
  return Math.min(want, yardCap);
}

/** Does the workshop keep planks now, holding `stock`? (See `planksWanted`.) */
export function keepsPlanks(p: Progress, stock: number, aim: string | null = null): boolean {
  return stock < planksWanted(p, aim);
}

/** The goods a price takes from the workshop's yard (planks and others; coins aside). */
export function goodsOf(t: Tech, price: Price = t.price): Bag {
  return { ...(price.planks ? { planks: price.planks } : {}), ...price.goods } as Bag;
}

/**
 * Learn the blueprints that come by themselves once what they require is done (the passenger line, by people carried;
 * the school and library, when a town builds one). Returns the ones learned now, in order.
 */
export function learnAuto(p: Progress): string[] {
  const out: string[] = [];
  for (const t of TECHS) {
    if (t.learn !== "auto" || !ready(p, t.id)) continue;
    p.learned.add(t.id);
    out.push(t.id);
  }
  return out;
}

/**
 * Two blueprints a growing town offers: of its own `tier` first (a village track, a town industries, a city the
 * advanced ones; 0: any), then any other; within each, ready ones not yet on the board before ones that are. Picked by
 * `random` (0–1). Fewer when fewer are left.
 */
export function offerFor(p: Progress, random: () => number, tier = 0): string[] {
  const can = TECHS.filter((t) => t.learn === "board" && ready(p, t.id));
  const mine = (t: Tech) => tier === 0 || (t.tier ?? 1) === tier;
  const pools = [
    can.filter((t) => mine(t) && !p.board.has(t.id)),
    can.filter((t) => mine(t) && p.board.has(t.id)),
    can.filter((t) => !mine(t) && !p.board.has(t.id)),
    can.filter((t) => !mine(t) && p.board.has(t.id)),
  ].map((pool) => pool.map((t) => t.id));
  const out: string[] = [];
  for (const pool of pools) {
    const left = [...pool];
    while (out.length < 2 && left.length > 0) out.push(left.splice(Math.floor(random() * left.length), 1)[0]);
  }
  return out;
}

/** Learn a blueprint chosen when a town grew: free. The other one offered goes on the board. */
export function choose(p: Progress, id: string, offered: readonly string[]): boolean {
  if (!ready(p, id)) return false;
  p.learned.add(id);
  p.board.delete(id);
  for (const o of offered) if (o !== id && ready(p, o)) p.board.add(o);
  return true;
}

/**
 * Learn a blueprint from the board at its price: planks (and goods) from the workshops' yards, and coins. False, taking
 * nothing, if it can't be (yet).
 */
export function learnWithGoods(world: World, p: Progress, id: string): boolean {
  if (!ready(p, id) || !p.board.has(id)) return false;
  const t = techOf(id)!;
  const price = priceOf(p, t);
  const coins = price.coins ?? 0;
  if (p.coins < coins || !takeFromWorkshops(world, goodsOf(t, price))) return false;
  p.coins -= coins;
  p.learned.add(id);
  p.board.delete(id);
  return true;
}

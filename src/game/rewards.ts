import type { CargoKind } from "../economy/cargo";
import type { Landscape, Town } from "../landscape";
import { MARKET_BONUS, SCHOOL_IDEA_SECONDS, townLandmarks } from "./landmarks";
import type { Progress } from "./progress";
import { choose, offerFor, ready, TECHS } from "./tech";
import { ruleOf, THING_RULES, type ThingId } from "./things";
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

/** No school ideas while this many blueprints already wait on the board to be learned (there's plenty to do). */
export const SCHOOL_BOARD_CAP = 3;

/**
 * Schools have ideas: every `SCHOOL_IDEA_SECONDS` of play, a school puts a blueprint on the board, to learn at its
 * price (not free: delivering goods and paying planks stay the way forward). A school only thinks while its town is
 * supplied (`supplied`: a delivery lately); two or more schools think half again as fast, no faster. No ideas while
 * `SCHOOL_BOARD_CAP` blueprints wait on the board. `clock` carries the time between calls. Returns the school and the
 * blueprint, or null.
 */
export function schoolIdeas(
  p: Progress,
  land: Landscape,
  clock: { seconds: number },
  seconds: number,
  random: () => number,
  supplied: (townId: number) => boolean = () => true,
): { from: string; id: string } | null {
  const schools = land.towns.filter((t) => townLandmarks(t).has("school") && supplied(t.id));
  if (schools.length === 0) return null;
  const waiting = TECHS.filter((t) => p.board.has(t.id) && !p.learned.has(t.id) && ready(p, t.id)).length;
  if (waiting >= SCHOOL_BOARD_CAP) return null;
  clock.seconds += seconds * (schools.length > 1 ? 1.5 : 1);
  if (clock.seconds < SCHOOL_IDEA_SECONDS) return null;
  clock.seconds = 0;
  const id = offerFor(p, random).find((x) => !p.board.has(x));
  if (!id) return null;
  p.board.add(id);
  const town = schools[Math.floor(random() * schools.length)];
  return { from: `${town.name} school`, id };
}

/**
 * A town grew to `level` (1 a village, 2 a town, 3 a city; 0: unknown): it offers two blueprints suited to its new size,
 * one to learn free, or instead a crate of things for the toy box. Returns the blueprints (none left: empty; the crate
 * may still be offered).
 */
export function offerOnGrowth(p: Progress, townName: string, random: () => number, level = 0): string[] {
  const offer = offerFor(p, random, Math.min(level, 3));
  const crate = level > 0 ? crateFor(p, level, random) : [];
  if (offer.length > 0 || crate.length > 0) p.offers.push({ from: townName, ids: offer, ...(crate.length > 0 ? { crate } : {}) });
  return offer;
}

/** Industry buildings (and the workshop): never in a crate. */
const isBuilding = (id: ThingId) => id.startsWith("piece:depot-");

/**
 * A crate for a town that grew to `level`: `level + 1` different things you know how to make (no buildings), two of a
 * piece of track, one of a car. Empty if you know nothing that costs anything yet.
 */
export function crateFor(p: Progress, level: number, random: () => number): [ThingId, number][] {
  const known = (Object.keys(THING_RULES) as ThingId[]).filter((id) => !isBuilding(id) && p.knows(id));
  const out: [ThingId, number][] = [];
  while (out.length < level + 1 && known.length > 0) {
    const id = known.splice(Math.floor(random() * known.length), 1)[0];
    out.push([id, id.startsWith("car:") ? 1 : 2]);
  }
  return out;
}

/** "2 Switches, 1 Coach": what's in a crate (or a gift), for cards and toasts. */
export function describeThings(things: readonly [ThingId, number][]): string {
  return things.map(([id, n]) => `${n} ${n === 1 ? (ruleOf(id)?.label ?? id) : plural(ruleOf(id)?.label ?? id)}`).join(", ");
}

/** "Turnbacks", "Switches", "Flatbed wagons". */
function plural(label: string): string {
  return /(s|x|ch|sh)$/.test(label) ? `${label}es` : `${label}s`;
}

/**
 * Take the crate instead of a blueprint: its things go into the toy box, and the blueprints offered go on the board (to
 * learn later at their own price). False if that offer has no crate.
 */
export function takeCrate(p: Progress, k: number): boolean {
  const o = p.offers[k];
  if (!o?.crate) return false;
  for (const [id, n] of o.crate) p.add(id, n);
  for (const id of o.ids) if (ready(p, id)) p.board.add(id);
  p.offers.splice(k, 1);
  return true;
}

/** Choose a blueprint from an offer: learned free; the other goes on the board. False if it can't be. */
export function takeBlueprint(p: Progress, k: number, id: string): boolean {
  const o = p.offers[k];
  if (!o || !o.ids.includes(id) || !choose(p, id, o.ids)) return false;
  p.offers.splice(k, 1);
  return true;
}

/**
 * The first time any of your towns reaches a level, a present: a second train for your first village, an industry
 * building for your first town, an engine and the grandest industry you know for your first city. Returns what was
 * given (into the toy box), or empty if that level was reached before.
 */
export function firstTimeGift(p: Progress, level: number): [ThingId, number][] {
  if (level <= p.bestLevel) return [];
  const gifts: [ThingId, number][] = [];
  for (let l = p.bestLevel + 1; l <= Math.min(level, 3); l++) gifts.push(...giftFor(p, l));
  p.bestLevel = level;
  for (const [id, n] of gifts) p.add(id, n);
  return gifts;
}

function giftFor(p: Progress, level: number): [ThingId, number][] {
  // Industry buildings you know, cheapest first (by the coins they'd cost).
  const industries = (Object.keys(THING_RULES) as ThingId[]).filter((id) => isBuilding(id) && THING_RULES[id]!.coins && p.knows(id));
  industries.sort((a, b) => THING_RULES[a]!.coins! - THING_RULES[b]!.coins!);
  if (level === 1) return [["car:engine", 1], ["car:timber", 1]];
  if (level === 2) return industries.length > 0 ? [[industries[0], 1], ["piece:buffer-turnback", 2]] : [["piece:depot-workshop", 1], ["piece:buffer-turnback", 2]];
  return [["car:engine", 1], ...(industries.length > 0 ? [[industries[industries.length - 1], 1] as [ThingId, number]] : [])];
}

import { BLUEPRINTS, type Blueprint, type Need } from "./blueprints";
import type { Progress } from "./progress";
import { THING_RULES, type ThingId } from "./things";

/**
 * The rules for learning blueprints (Game mode), on the catalogue in `blueprints.ts`: what can be researched now, and
 * what a player sees. Every built blueprint is researched at a school (`research.ts`); the workshop only makes things.
 * (A growing town offers resources, never a blueprint.)
 */

/** A blueprint (see `Blueprint`). */
export type Tech = Blueprint;

/** Every blueprint, built or planned. */
export const TECHS: readonly Tech[] = BLUEPRINTS;

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
 * How much of each blueprint a player sees: "shown" if it's a key one, learned, being researched or up next, or next
 * to something learned; a "?" (hint) one step further on; beyond that nothing yet, so the web grows as you learn. A
 * university shows everything.
 */
export function seenOf(p: Progress, offered: ReadonlySet<string> = new Set()): Map<string, "shown" | "hint" | "unseen"> {
  const all = p.learned.has("university");
  const shown = new Set(TECHS.filter((t) => all || t.key || p.learned.has(t.id) || offered.has(t.id) || p.research.current === t.id || p.research.next === t.id || t.needs.some((n) => p.learned.has(n))).map((t) => t.id));
  return new Map(TECHS.map((t) => [t.id, shown.has(t.id) ? "shown" : t.needs.some((n) => shown.has(n)) ? "hint" : "unseen"]));
}

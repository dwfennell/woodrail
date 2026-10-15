import type { Bag } from "../economy/goods";
import { takeFromWorkshops } from "./crafting";
import type { Progress } from "./progress";
import { THING_RULES, type ThingId } from "./things";
import type { World } from "./world";

/** A blueprint: learned once (paid in goods at the workshop, or chosen free when a town grows). */
export interface Tech {
  readonly id: string;
  readonly label: string;
  /** One line for the board. */
  readonly blurb: string;
  readonly cost: Bag;
  /** Blueprints to learn first. */
  readonly needs: readonly string[];
  /** A town landmark one of your towns must have first (a city's library, for the advanced blueprints). */
  readonly landmark?: string;
  /** What it lets you do that isn't a thing to make (train routes), with an icon for the board. */
  readonly feature?: { readonly label: string; readonly icon: string };
  /**
   * Learned by itself, free, once you've carried this many passengers (the passenger line): never offered by a town or
   * put on the board.
   */
  readonly riders?: number;
  /**
   * Which size of town offers it when it grows (1 a village, 2 a town, 3 a city): track for villages, industries and
   * logistics for towns, the advanced blueprints for cities. A growing town offers its own tier first.
   */
  readonly tier?: number;
}

/**
 * The blueprint board's tree, as data. What each blueprint lets you make comes from `THING_RULES` (the things whose
 * `tech` it is), so a new piece is added in one place.
 */
export const TECHS: readonly Tech[] = [
  { id: "switches", label: "Switches", blurb: "Branch a line in two.", cost: { planks: 6 }, tier: 1, needs: [] },
  // A bridge stands a level up, so ramps come with it (a bridge alone can't be reached).
  { id: "bridges", label: "Bridges and ramps", blurb: "Ramp up and cross rivers and other lines.", cost: { planks: 8 }, tier: 1, needs: [] },
  { id: "heights", label: "Risers", blurb: "Raise track higher, over bridges and hills.", cost: { planks: 6 }, tier: 1, needs: ["bridges"] },
  { id: "sawmills", label: "Sawmills", blurb: "Build your own sawmill, wherever you like.", cost: { planks: 15 }, tier: 2, needs: [] },
  { id: "passengers", label: "Passengers", blurb: "Coaches carry people between towns: they pay a fare by how far they ride.", cost: { planks: 10 }, tier: 1, needs: [] },
  { id: "loops", label: "Turning loops", blurb: "Turn a train round without stopping.", cost: { planks: 6 }, tier: 1, needs: ["switches"] },
  { id: "junctions", label: "Junctions", blurb: "Three-ways, crossings, double track.", cost: { planks: 10 }, tier: 2, needs: ["switches"] },
  // The industry line: more logs, then the farm chain.
  { id: "harvesters", label: "Harvesters", blurb: "A forest yard of your own, beside the trees.", cost: { planks: 10 }, tier: 1, needs: [] },
  // Early, on its own: a farm yard, hoppers for its grain, and fields to plant (with coins) where there are few.
  { id: "farming", label: "Farming", blurb: "A farm yard by the fields, hoppers for its grain, and fields to plant.", cost: { planks: 12 }, tier: 1, needs: [] },
  { id: "mills", label: "Mills", blurb: "Grind grain into flour, for the towns.", cost: { planks: 16 }, tier: 2, needs: ["farming"] },
  // The logistics line: trains that know where to go.
  {
    id: "routes",
    tier: 2,
    label: "Train routes",
    blurb: "Give a train its stops: it sets the switches on its way.",
    cost: { planks: 10 },
    needs: ["switches"],
    feature: { label: "Routes on the engine card", icon: "🗺️" },
  },
  { id: "warehouses", label: "Warehouses", blurb: "Keep goods for later: routed trains drop them off and pick them up.", cost: { planks: 16 }, tier: 2, needs: ["routes"] },
  // Needs a city's library: the stone a city wants to keep growing.
  { id: "quarries", label: "Quarries", blurb: "Cut stone from the hills, for growing cities.", cost: { planks: 24 }, tier: 3, needs: ["mills"], landmark: "library" },
  // The passenger line: each learned by itself as you carry more people (see `learnByRiders`).
  {
    id: "dining",
    label: "Dining car",
    blurb: "Everyone on a train with a dining car pays half as much again.",
    cost: {},
    needs: ["passengers"],
    riders: 20,
    feature: { label: "Dining car (Trains tab)", icon: "🍽️" },
  },
  {
    id: "first-class",
    label: "First class",
    blurb: "A first-class coach: three seats, each paying double.",
    cost: {},
    needs: ["dining"],
    riders: 60,
    feature: { label: "First-class coach (Trains tab)", icon: "🥇" },
  },
  {
    id: "stations",
    label: "Busy stations",
    blurb: "Twice as many people come to each station, and more can wait.",
    cost: {},
    needs: ["first-class"],
    riders: 100,
    feature: { label: "More people at stations", icon: "🚉" },
  },
  {
    id: "double-decker",
    label: "Double-decker",
    blurb: "A coach with eight seats.",
    cost: {},
    needs: ["stations"],
    riders: 160,
    feature: { label: "Double-decker coach (Trains tab)", icon: "🚃" },
  },
  {
    id: "express",
    label: "Express engine",
    blurb: "An engine that runs half as fast again.",
    cost: {},
    needs: ["double-decker"],
    riders: 250,
    feature: { label: "Express engine (Trains tab)", icon: "⚡" },
  },
];

/** On the board from a new game's start, to be learned with goods. */
export const STARTING_BOARD: readonly string[] = ["switches", "bridges"];

export const techOf = (id: string): Tech | undefined => TECHS.find((t) => t.id === id);

/** What a blueprint lets you make. */
export function unlocksOf(id: string): ThingId[] {
  return (Object.keys(THING_RULES) as ThingId[]).filter((t) => THING_RULES[t]!.tech === id);
}

/** Can it be learned now: not learned, and everything it needs is? */
export function ready(p: Progress, id: string): boolean {
  const t = techOf(id);
  return !!t && !p.learned.has(id) && t.needs.every((n) => p.learned.has(n)) && (!t.landmark || p.landmarks.has(t.landmark)) && (t.riders === undefined || p.riders >= t.riders);
}

/** Learn the passenger line's blueprints you've carried enough people for (in order). Returns the ones learned now. */
export function learnByRiders(p: Progress): string[] {
  const out: string[] = [];
  for (const t of TECHS) {
    if (t.riders === undefined || !ready(p, t.id)) continue;
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
  const can = TECHS.filter((t) => t.riders === undefined && ready(p, t.id));
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

/** Learn a blueprint from the board, paying its goods from the workshops' yards. False if it can't be (yet). */
export function learnWithGoods(world: World, p: Progress, id: string): boolean {
  if (!ready(p, id) || !p.board.has(id)) return false;
  if (!takeFromWorkshops(world, techOf(id)!.cost)) return false;
  p.learned.add(id);
  p.board.delete(id);
  return true;
}

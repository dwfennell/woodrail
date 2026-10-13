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
}

/**
 * The blueprint board's tree, as data. What each blueprint lets you make comes from `THING_RULES` (the things whose
 * `tech` it is), so a new piece is added in one place.
 */
export const TECHS: readonly Tech[] = [
  { id: "switches", label: "Switches", blurb: "Branch a line in two.", cost: { planks: 6 }, needs: [] },
  { id: "bridges", label: "Bridges", blurb: "Cross rivers and other lines.", cost: { planks: 8 }, needs: [] },
  { id: "heights", label: "Ramps and risers", blurb: "Take the track up and down.", cost: { planks: 6 }, needs: [] },
  { id: "sawmills", label: "Sawmills", blurb: "Build your own sawmill, wherever you like.", cost: { planks: 15 }, needs: [] },
  { id: "passengers", label: "Passengers", blurb: "Coaches and cabooses.", cost: { planks: 10 }, needs: [] },
  { id: "loops", label: "Turning loops", blurb: "Turn a train round without stopping.", cost: { planks: 6 }, needs: ["switches"] },
  { id: "junctions", label: "Junctions", blurb: "Three-ways, crossings, double track.", cost: { planks: 10 }, needs: ["switches"] },
  { id: "hoppers", label: "Hopper wagons", blurb: "Wagons for loose loads.", cost: { planks: 8 }, needs: ["junctions"] },
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
  return !!t && !p.learned.has(id) && t.needs.every((n) => p.learned.has(n));
}

/**
 * Two blueprints a growing town offers: ready ones not yet on the board first, then ones that are; picked by `random`
 * (0–1). Fewer when fewer are left.
 */
export function offerFor(p: Progress, random: () => number): string[] {
  const fresh = TECHS.filter((t) => ready(p, t.id) && !p.board.has(t.id)).map((t) => t.id);
  const shown = TECHS.filter((t) => ready(p, t.id) && p.board.has(t.id)).map((t) => t.id);
  const out: string[] = [];
  for (const pool of [fresh, shown]) {
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

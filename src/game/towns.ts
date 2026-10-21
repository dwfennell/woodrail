import type { CargoKind } from "../economy/cargo";
import { covers, minus, plus, times, total, type Bag } from "../economy/goods";

/**
 * Game mode's towns: what each wants, and how it grows. A table, so a new good or level is a row, not code. A level's
 * `wants` is what the town must receive (on top of earlier levels) to grow to the next; `houses` is how many buildings
 * it adds when it does.
 */
export interface TownLevel {
  readonly name: string;
  readonly wants: Bag;
  readonly houses: number;
}

export const TOWN_LEVELS: readonly TownLevel[] = [
  { name: "Hamlet", wants: { planks: 4 }, houses: 2 },
  { name: "Village", wants: { planks: 8 }, houses: 3 },
  // A town wants flour to become a city: the farm chain (Harvesters → Farming → Mills) is the mid-game.
  { name: "Town", wants: { planks: 14, flour: 6 }, houses: 3 },
  // A city wants stone to grow on (quarries are researched at a school beside a city: its library wing).
  { name: "City", wants: { planks: 22, flour: 12, stone: 10 }, houses: 4 },
];

/** Past the table, each level wants this much more than the one before: demand keeps rising. */
const GROWTH = 1.5;

/** Level `n` (0 = a hamlet), carrying on past the table. */
export function townLevel(n: number): TownLevel {
  if (n < TOWN_LEVELS.length) return TOWN_LEVELS[n];
  const last = TOWN_LEVELS[TOWN_LEVELS.length - 1];
  const beyond = n - TOWN_LEVELS.length + 1;
  // Phase C's goods: a city ★ wants iron and furniture to grow its second star (the foundry is learned at ★), and a
  // city ★★ tools too.
  const iron = beyond >= 1 ? { iron: Math.round(10 * GROWTH ** (beyond - 1)), furniture: Math.round(6 * GROWTH ** (beyond - 1)) } : {};
  const tools = beyond >= 2 ? { tools: Math.round(4 * GROWTH ** (beyond - 2)) } : {};
  return { name: `${last.name} ${"★".repeat(Math.min(beyond, 5))}`, wants: { ...times(last.wants, GROWTH ** beyond), ...iron, ...tools }, houses: last.houses };
}

export interface TownStatus {
  /** 0 = hamlet. */
  level: number;
  name: string;
  /** What it wants to grow again, and how much of that it has had since it last grew. */
  wants: Bag;
  got: Bag;
  /** 0–1 toward the next level. */
  fill: number;
}

/** Where a town stands, from everything it has received. Pure: a save holds only what was received. */
export function townStatus(received: Bag): TownStatus {
  let level = 0;
  let spent: Bag = {};
  for (;;) {
    const wants = townLevel(level).wants;
    const next = plus(spent, wants);
    if (!covers(received, next)) {
      const got: Bag = {};
      const over = minus(received, spent);
      for (const k of Object.keys(wants) as (keyof Bag)[]) got[k] = Math.min(over[k] ?? 0, wants[k]!);
      return { level, name: townLevel(level).name, wants, got, fill: total(got) / Math.max(1, total(wants)) };
    }
    spent = next;
    level++;
  }
}

/** Buildings a town has gained by `level` (levels past the first each add theirs). */
export function housesBy(level: number): number {
  let n = 0;
  for (let k = 0; k < level; k++) n += townLevel(k).houses;
  return n;
}

/** Coins a town pays for one unit of each good it takes (the full price for what it wants now, half otherwise). */
export const PRICES: Bag = { planks: 4, log: 1, grain: 2, flour: 6, stone: 5, coal: 2, ore: 2, iron: 8, furniture: 12, tools: 14 };

/** Made goods a town always takes (and pays for), wanted for growth or not: they're treats. */
export const LUXURIES: ReadonlySet<CargoKind> = new Set(["furniture", "tools"]);

/**
 * What a hamlet or a village pays for a plank it wants: more than a town does, so a new game's first coins come sooner
 * (QA P5: 48 coins at minute 15, short of Routes' 40 and a farm yard's 90).
 */
export const EARLY_PLANK_PRICE = 6;

/** What a town pays for one unit of `kind`, as it is now. */
export function payFor(kind: CargoKind, status: TownStatus): number {
  const price = kind === "planks" && status.level <= 1 ? EARLY_PLANK_PRICE : (PRICES[kind] ?? 0);
  return (status.wants[kind] ?? 0) > 0 ? price : Math.ceil(price / 2);
}

/** Coins for the next plot of land: dearer the more land you have (a new game's land is four plots). */
export function plotPrice(plots: number): number {
  return 60 + 30 * Math.max(0, plots - 4);
}

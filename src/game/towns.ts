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
  { name: "Town", wants: { planks: 14 }, houses: 3 },
  { name: "City", wants: { planks: 22 }, houses: 4 },
];

/** Past the table, each level wants this much more than the one before: demand keeps rising. */
const GROWTH = 1.5;

/** Level `n` (0 = a hamlet), carrying on past the table. */
export function townLevel(n: number): TownLevel {
  if (n < TOWN_LEVELS.length) return TOWN_LEVELS[n];
  const last = TOWN_LEVELS[TOWN_LEVELS.length - 1];
  const beyond = n - TOWN_LEVELS.length + 1;
  return { name: `${last.name} ${"★".repeat(Math.min(beyond, 5))}`, wants: times(last.wants, GROWTH ** beyond), houses: last.houses };
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

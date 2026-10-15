import { CARGO, CARGO_KINDS, type CargoKind, type DepotRole, type Economy } from "../economy";
import { CRANE_TICKS, ticks } from "../economy/constants";
import type { Stat } from "./blueprints";
import type { Progress } from "./progress";

/**
 * Upgrades (Game mode): blueprints that make every industry of a kind work faster (Harvesters II, Sawmills III…), and
 * cranes that load quicker. Also the counters they ask for ("100 logs cut", "200 loads moved"), taken from the economy.
 */

/** Each upgrade's industry and how much faster it makes all of that kind (the best one learned counts). */
export const RATE_UPGRADES: readonly { readonly tech: string; readonly role: DepotRole; readonly factor: number }[] = [
  { tech: "harvesters2", role: "forest", factor: 1.5 },
  { tech: "harvesters3", role: "forest", factor: 2 },
  { tech: "sawmills2", role: "sawmill", factor: 1.5 },
  { tech: "sawmills3", role: "sawmill", factor: 2 },
  { tech: "farming2", role: "farm", factor: 1.5 },
  { tech: "mills2", role: "mill", factor: 1.5 },
  { tech: "quarries2", role: "quarry", factor: 1.5 },
];

/** The machine each upgrade puts in its yard (a model part); a yard shows its best one. */
const MACHINES: Record<string, string> = {
  harvesters2: "upgrade-log-loader",
  harvesters3: "upgrade-steam-log-crane",
  sawmills2: "upgrade-saw-bench",
  sawmills3: "upgrade-steam-saw-house",
  farming2: "upgrade-tractor",
  mills2: "upgrade-millstones",
  quarries2: "upgrade-stone-crusher",
};

/** The machines a kind of yard shows for the upgrades learned: the best one. */
export function machinesFor(p: Progress, role: DepotRole): string[] {
  let best: { factor: number; part: string } | null = null;
  for (const u of RATE_UPGRADES) if (u.role === role && p.learned.has(u.tech) && (!best || u.factor > best.factor)) best = { factor: u.factor, part: MACHINES[u.tech] };
  return best ? [best.part] : [];
}

/** How much faster industries of this kind work, from the upgrades learned (1: none). */
export function boostOf(p: Progress, role: DepotRole): number {
  let f = 1;
  for (const u of RATE_UPGRADES) if (u.role === role && p.learned.has(u.tech)) f = Math.max(f, u.factor);
  return f;
}

/** The upgrades learned, as a key (so rates are worked out again only when it changes). */
export function upgradeKey(p: Progress): string {
  return [...RATE_UPGRADES.map((u) => u.tech), "cranes1", "cranes2", "cranes3"].filter((t) => p.learned.has(t)).join(",");
}

/** Quicker cranes: a load in 0.45 s, then 0.3 s; grab cranes lift two at a time. */
export function applyCranes(economy: Economy, p: Progress): void {
  economy.craneTicks = p.learned.has("cranes2") ? ticks(0.3) : p.learned.has("cranes1") ? ticks(0.45) : CRANE_TICKS;
  economy.craneLoads = p.learned.has("cranes3") ? 2 : 1;
}

/** What making each good counts toward. */
const MADE_STAT: Partial<Record<CargoKind, Stat>> = { log: "logsCut", planks: "planksSawn", grain: "grainGrown", flour: "flourGround", stone: "stoneCut" };

/**
 * Carries the economy's counters (goods made, loads moved) into the player's progress, a little at a time: what was
 * added since the last look. Start it again (`reset`) whenever the world is replaced (a load, a new game).
 */
export class Counters {
  private made = new Int32Array(CARGO_KINDS.length);
  private moved = 0;

  reset(economy: Economy): void {
    this.made = economy.made.slice();
    this.moved = economy.loadsMoved;
  }

  /** Add what's new to `p.counts`, and the goods delivered to towns so far. True if anything changed. */
  collect(economy: Economy, p: Progress): boolean {
    let changed = false;
    const add = (key: string, n: number) => {
      if (n <= 0) return;
      p.counts.set(key, (p.counts.get(key) ?? 0) + n);
      changed = true;
    };
    for (const kind of CARGO_KINDS) {
      const i = CARGO[kind].index;
      const stat = MADE_STAT[kind];
      if (stat) add(stat, economy.made[i] - this.made[i]);
      this.made[i] = economy.made[i];
    }
    add("loadsMoved", economy.loadsMoved - this.moved);
    this.moved = economy.loadsMoved;
    // Delivered to towns: the economy keeps the totals (saved with the world), so these are set, not added.
    const totals: Record<string, number> = {};
    for (const bag of economy.deliveredGoods.values()) for (const [k, n] of Object.entries(bag)) totals[k] = (totals[k] ?? 0) + (n ?? 0);
    for (const [k, n] of Object.entries(totals)) {
      const key = `delivered:${k}`;
      if ((p.counts.get(key) ?? 0) < n) {
        p.counts.set(key, n);
        changed = true;
      }
    }
    return changed;
  }
}

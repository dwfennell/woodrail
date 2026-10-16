import { CARGO, CARGO_KINDS } from "../economy/cargo";
import type { DepotState } from "../economy/economy";
import { covers, kindsOf, minus, total, type Bag } from "../economy/goods";
import type { Progress } from "./progress";
import { isFree, ruleOf, type ThingId } from "./things";
import type { World } from "./world";

/** Seconds of play to make one thing, once its goods are taken. */
export const CRAFT_SECONDS = 3;

/** The workshops on the map now (one whose piece was taken up doesn't count). */
export function workshops(world: World): DepotState[] {
  return world.economy.allDepots().filter((d) => d.role === "workshop" && world.layout.getPiece(d.pieceId));
}

/** Goods on all the workshops' piles together. */
export function workshopStock(world: World): Bag {
  const out: Bag = {};
  for (const d of workshops(world)) for (const k of CARGO_KINDS) out[k] = (out[k] ?? 0) + d.piles[CARGO[k].index];
  return out;
}

/** Take `bag` from the workshops' piles, first workshop first. False (taking nothing) if they haven't enough. */
export function takeFromWorkshops(world: World, bag: Bag): boolean {
  if (!covers(workshopStock(world), bag)) return false;
  for (const k of kindsOf(bag)) {
    let left = bag[k]!;
    for (const d of workshops(world)) {
      const i = CARGO[k].index;
      const n = Math.min(left, d.piles[i]);
      d.piles[i] -= n;
      left -= n;
    }
  }
  return true;
}

/**
 * The goods and coins to make `wants` (how many of each thing), from the tray (Game mode).
 */
export function costOf(wants: ReadonlyMap<ThingId, number>): { goods: Bag; coins: number } {
  const goods: Bag = {};
  let coins = 0;
  for (const [id, n] of wants) {
    const rule = ruleOf(id);
    if (!rule) continue;
    for (const k of kindsOf(rule.cost)) goods[k] = (goods[k] ?? 0) + rule.cost[k]! * n;
    coins += (rule.coins ?? 0) * n;
  }
  return { goods, coins };
}

/**
 * Make `wants` (how many of each thing) at once, from the tray (Game mode): all of them or none. Their goods come from
 * the workshops' yards and their coins from hand, into the toy box. Returns null if made, else "no-workshop", or
 * what's missing for the lot (goods still needed in the yards, and coins), having taken nothing.
 */
export function craftNow(world: World, p: Progress, wants: ReadonlyMap<ThingId, number>): null | "no-workshop" | { goods: Bag; coins: number } {
  if (workshops(world).length === 0) return "no-workshop";
  const cost = costOf(wants);
  const goods = minus(cost.goods, workshopStock(world));
  const coins = Math.max(0, cost.coins - p.coins);
  if (total(goods) > 0 || coins > 0) return { goods, coins };
  takeFromWorkshops(world, cost.goods);
  p.coins -= cost.coins;
  for (const [id, n] of wants) p.add(id, n);
  return null;
}

/** What `needs` lacks in the toy box: how many more of each thing (none: empty). */
export function lacking(world: World, p: Progress, needs: ReadonlyMap<ThingId, number>): Map<ThingId, number> {
  const out = new Map<ThingId, number>();
  for (const [id, n] of needs) {
    if (isFree(id)) continue;
    const short = n - p.available(world, id);
    if (short > 0) out.set(id, short);
  }
  return out;
}

/**
 * The workshop's orders: made one at a time, in order. Each waits until the workshops hold its goods, takes them,
 * and is done `CRAFT_SECONDS` later, into the toy box. Orders are kept in the progress (saved); the time into the
 * one being made is not (it starts again after loading, its goods already taken).
 */
export class Crafting {
  /** Seconds into the front order (−1: its goods not yet taken). */
  private elapsed = -1;

  constructor(private progress: Progress) {}

  setProgress(progress: Progress): void {
    this.progress = progress;
    this.elapsed = progress.making ? 0 : -1;
  }

  order(id: ThingId): void {
    if (ruleOf(id) && this.progress.knows(id)) this.progress.orders.push(id);
  }

  /** Take the last order of this kind off the list (not one already being made). */
  cancel(id: ThingId): boolean {
    const k = this.progress.orders.lastIndexOf(id);
    if (k < 0 || (k === 0 && this.progress.making)) return false;
    this.progress.orders.splice(k, 1);
    return true;
  }

  /** What's being made now, and how far along (0–1); or what it's waiting for. */
  get now(): { id: ThingId; fill: number; waiting: boolean } | null {
    const id = this.progress.orders[0];
    if (!id) return null;
    return { id, fill: this.progress.making ? Math.min(1, this.elapsed / CRAFT_SECONDS) : 0, waiting: !this.progress.making };
  }

  /** Advance by `dt` seconds of play. Returns what was finished (into the toy box). */
  tick(world: World, dt: number): ThingId | null {
    const id = this.progress.orders[0];
    if (!id) return null;
    if (!this.progress.making) {
      // Its coins first (it waits for them as for goods), paid once its goods are taken.
      const rule = ruleOf(id)!;
      if ((rule.coins ?? 0) > this.progress.coins) return null;
      if (!takeFromWorkshops(world, rule.cost)) return null;
      this.progress.coins -= rule.coins ?? 0;
      this.progress.making = true;
      this.elapsed = 0;
    }
    this.elapsed += dt;
    if (this.elapsed < CRAFT_SECONDS) return null;
    this.progress.orders.shift();
    this.progress.making = false;
    this.elapsed = -1;
    this.progress.add(id);
    return id;
  }
}

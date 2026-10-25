import { CARGO, CARGO_KINDS, type CargoKind } from "../economy/cargo";
import { RECIPES, WORKSHOP_CAP, type DepotState } from "../economy/economy";
import { covers, kindsOf, minus, total, type Bag } from "../economy/goods";
import { costTag } from "../ui/cost-tag";
import type { Progress } from "./progress";
import { isFree, ruleOf, THING_RULES, type ThingId } from "./things";
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
 * Planks the workshop keeps for its waiting tray order (towns don't take them from unrouted trains, which carry them on
 * to it) until its yard holds this many: that order's planks, no more than the yard holds; 0 with no order waiting (or
 * one being made, its goods taken). The workshop only makes things: it keeps nothing for research, which a school
 * takes for itself (`research.ts`), so no plank is counted by both.
 */
export function orderPlanks(p: Progress, yardCap = WORKSHOP_CAP): number {
  const id = p.making ? undefined : p.orders[0];
  const planks = id ? (THING_RULES[id]?.cost.planks ?? 0) : 0;
  return Math.min(planks, yardCap);
}

/** Does the workshop keep planks now, holding `stock`? (See `orderPlanks`.) */
export function keepsForOrder(p: Progress, stock: number): boolean {
  return stock < orderPlanks(p);
}

/**
 * Planks a workshop's yard takes with no order waiting while a town the train goes on to wants planks: a few to build
 * with, enough for an engine or a farm yard (QA P5: with research idle, the yard took every plank, 1 → 16, and the
 * next town starved). With no town ahead wanting them, the yard fills up to its cap. (The balance play-through, spec
 * §5: 3 and 5 starve the towns or research on some seeds, 7 meets every band.)
 */
export const WORKSHOP_SPARE = 7;

/**
 * How many planks the workshop's yard takes while a town later on the line wants them (`Economy.shopKeeps`): its
 * waiting tray order's planks, or `WORKSHOP_SPARE` if more. The rest ride on to the towns.
 */
export function yardKeeps(p: Progress, spare = WORKSHOP_SPARE): number {
  return Math.max(orderPlanks(p), spare);
}

/** Per progress: the most of each good any one thing it knows costs, and how many blueprints were learned then. */
const dearestOf = new WeakMap<Progress, { learned: number; most: Int32Array }>();

/**
 * How many of `kind` the workshop needs for what the player may pay for there: the dearest thing they know how to
 * make (a harbour's 10 stone once Harbours is learned), or all their waiting tray orders' if more, no more than the
 * yard holds. That covers restoring a ruin too: its price is a share of the new one's (`restorePrice`), and its card
 * offers Restore only once the same blueprint is learned. (There is no "wanted" list to go by: the harbour's card
 * shows its price from the moment it's learned, so the stone has to be welcome from then, not only after a tap.)
 * Cached per progress until another blueprint is learned; the orders are a few, read each time.
 */
export function shopNeeds(p: Progress, kind: CargoKind, yardCap = WORKSHOP_CAP): number {
  let c = dearestOf.get(p);
  if (!c || c.learned !== p.learned.size) {
    const most = new Int32Array(CARGO_KINDS.length);
    for (const id of Object.keys(THING_RULES) as ThingId[]) {
      const rule = THING_RULES[id]!;
      if (!p.knows(id) || isFree(id)) continue;
      for (const k of kindsOf(rule.cost)) most[CARGO[k].index] = Math.max(most[CARGO[k].index], rule.cost[k]!);
    }
    c = { learned: p.learned.size, most };
    dearestOf.set(p, c);
  }
  let ordered = 0;
  // (The order being made has had its goods taken already.)
  for (let i = p.making ? 1 : 0; i < p.orders.length; i++) ordered += THING_RULES[p.orders[i]]?.cost[kind] ?? 0;
  return Math.min(yardCap, Math.max(c.most[CARGO[kind].index], ordered));
}

/**
 * How many more of `kind` the workshops take from trains (`Economy.owes`, for the goods a workshop takes only while
 * owed: stone): what's needed (`shopNeeds`) less what their yards hold. 0 once that's covered.
 */
export function shopOwes(world: World, p: Progress, kind: CargoKind): number {
  const need = shopNeeds(p, kind);
  if (need <= 0) return 0;
  let have = 0;
  for (const d of world.economy.allDepots()) if (d.role === "workshop" && world.layout.getPiece(d.pieceId)) have += d.piles[CARGO[kind].index];
  return Math.max(0, need - have);
}

/** Is any good a workshop takes only while owed (`RECIPES.workshop.owed`) owed now? (Routed lines plan again when this flips.) */
export function shopOwing(world: World, p: Progress): boolean {
  return (RECIPES.workshop.owed ?? []).some((k) => shopOwes(world, p, k) > 0);
}

/** The text on a price with goods only a workshop takes while owed: "Needs 5🪨 at the workshop" (none: null). */
export function owedText(goods: Bag): string | null {
  const owed: Bag = {};
  for (const k of RECIPES.workshop.owed ?? []) if (goods[k]) owed[k] = goods[k];
  return total(owed) > 0 ? `Needs ${costTag(owed)} at the workshop` : null;
}

/** Said beside a second engine before Signals (see `makeNote`). */
export const ENGINE_NOTE = "Needs Signals to share a line";

/**
 * A note on making `id`, or null: an engine before Signals, with one owned already (`owned`: how many before it), "Needs Signals to share a line"
 * (QA: the workshop made the second engine the presents hold back till Signals). Not a gate: a second engine on a
 * line of its own runs fine.
 */
export function makeNote(p: Progress, id: ThingId, owned = p.owned.get(id) ?? 0): string | null {
  return id === "car:engine" && !p.learned.has("signals") && owned >= 1 ? ENGINE_NOTE : null;
}

/**
 * The toast as the workshop finishes an order of `id` (now in the toy box): "+1 Engine in your toy box", and for a
 * second engine before Signals its note (QA P5: said when made from the tray, not when ordered on the workshop's card).
 * Asked after it's made, so the one just made isn't counted as owned before.
 */
export function madeText(p: Progress, id: ThingId, label: string): string {
  const note = makeNote(p, id, (p.owned.get(id) ?? 0) - 1);
  return `+1 ${label} in your toy box${note ? `. ${note}` : ""}`;
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
  const short = craftShort(world, p, wants);
  if (short) return short;
  const cost = costOf(wants);
  takeFromWorkshops(world, cost.goods);
  p.coins -= cost.coins;
  for (const [id, n] of wants) p.add(id, n);
  return null;
}

/**
 * Undo a `craftNow` of `wants` that came to nothing (a train taken from the tray and dropped off the track): its goods
 * go back to the (first) workshop's yard, its coins back, and the things out of the toy box.
 */
export function uncraft(world: World, p: Progress, wants: ReadonlyMap<ThingId, number>): void {
  const cost = costOf(wants);
  const d = workshops(world)[0];
  if (d) for (const k of kindsOf(cost.goods)) d.piles[CARGO[k].index] += cost.goods[k]!;
  p.coins += cost.coins;
  for (const [id, n] of wants) p.add(id, -n);
}

/** Could `wants` be made now, from the tray (as `craftNow`, taking nothing)? Null if so, else why not. */
export function craftShort(world: World, p: Progress, wants: ReadonlyMap<ThingId, number>): null | "no-workshop" | { goods: Bag; coins: number } {
  const cost = costOf(wants);
  // (Something of coins alone, a school, needs no workshop to make it.)
  if (workshops(world).length === 0 && total(cost.goods) > 0) return "no-workshop";
  const goods = minus(cost.goods, workshopStock(world));
  const coins = Math.max(0, cost.coins - p.coins);
  return total(goods) > 0 || coins > 0 ? { goods, coins } : null;
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
    if (ruleOf(id) && !isFree(id) && this.progress.knows(id)) this.progress.orders.push(id);
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

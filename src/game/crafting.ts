import { CARGO, CARGO_KINDS, type CargoKind } from "../economy/cargo";
import { RECIPES, WORKSHOP_CAP, type DepotRole, type DepotState } from "../economy/economy";
import { covers, kindsOf, minus, total, type Bag } from "../economy/goods";
import { costTag } from "../ui/cost-tag";
import type { Progress } from "./progress";
import { costOf as researchCost } from "./research";
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
 * waiting tray order's planks, or the spare if more (`shopSpare`: the game works it out once a second and passes it
 * here). The rest ride on to the towns.
 */
export function yardKeeps(p: Progress, spare = WORKSHOP_SPARE): number {
  return Math.max(orderPlanks(p), spare);
}

/**
 * Per progress: the most of each good any one thing it knows and hasn't built costs, and what that was worked out
 * from: how many blueprints were learned, and which map's pieces as of which `Layout.piecesVersion`.
 */
const dearestOf = new WeakMap<Progress, Needs>();

/**
 * What the workshop may be asked to make, from the things a progress knows and hasn't built (`needsOf`): the most of
 * each good any one of them costs (`shopNeeds`); and for `shopSpare`, the industries among them, and the goods some
 * industry on the map makes.
 */
interface Needs {
  learned: number;
  layout: World["layout"] | null;
  pieces: number;
  most: Int32Array;
  /** The least of each good any one of them costs, of those that cost some (0: none does): for `owedSpare`. */
  least: Int32Array;
  /** Industries known and not built ("piece:depot-…", as their role: "mill"). */
  industries: readonly DepotRole[];
  /** Goods some industry on the map makes (`RECIPES[role].gives`), the map's own included. */
  made: ReadonlySet<CargoKind>;
}

/**
 * Of the piece types in `types`, those the player has standing on `world`'s map: placed, or an old one restored
 * (`restoreRuin` swaps the ruin's stub for it). A depot that came with the map isn't theirs and doesn't count.
 * One pass over the pieces.
 */
function builtOf(world: Pick<World, "layout" | "depots">, types: ReadonlySet<string>): Set<string> {
  const n = new Map<string, number>();
  for (const pid of world.layout.pieceIds()) {
    const type = world.layout.getPiece(pid)!.type;
    if (types.has(type)) n.set(type, (n.get(type) ?? 0) + 1);
  }
  if (n.size > 0) {
    for (const pid of world.depots.values()) {
      const type = world.layout.getPiece(pid)?.type;
      if (type && n.has(type)) n.set(type, n.get(type)! - 1);
    }
  }
  return new Set([...n].filter(([, k]) => k > 0).map(([t]) => t));
}

/**
 * How many of `kind` the workshop needs for what the player may pay for there: the dearest thing they know how to
 * make and haven't built (a harbour's 10 stone once Harbours is learned, until one stands on `world`'s map), or all
 * their waiting tray orders' if more (a second harbour queued still gets its stone), no more than the yard holds.
 * That covers restoring a ruin too: its price is a share of the new one's (`restorePrice`), and its card offers
 * Restore only once the same blueprint is learned; one restored counts as built. (There is no "wanted" list to go
 * by: the harbour's card shows its price from the moment it's learned, so the stone has to be welcome from then, not
 * only after a tap. Once one is built the stone rides on to research: QA, Foundry sat at 9/10 stone for an hour of
 * the goals play-through while the workshop kept 10 for a harbour already standing.)
 * "Built" is for pieces only, on the map (one in the toy box isn't yet); cars and props are made again and again.
 * Without `world`, nothing is built.
 * Cached per progress until another blueprint is learned or a piece is added to or taken from the map
 * (`Layout.piecesVersion`: a miss is one pass over the pieces); the orders are a few, read each time.
 */
export function shopNeeds(p: Progress, kind: CargoKind, world?: Pick<World, "layout" | "depots">, yardCap = WORKSHOP_CAP): number {
  const c = needsOf(p, world);
  let ordered = 0;
  // (The order being made has had its goods taken already.)
  for (let i = p.making ? 1 : 0; i < p.orders.length; i++) ordered += THING_RULES[p.orders[i]]?.cost[kind] ?? 0;
  return Math.min(yardCap, Math.max(c.most[CARGO[kind].index], ordered));
}

/** The things `p` knows and hasn't built on `world`'s map, as `shopNeeds` and `shopSpare` read them (cached: see there). */
function needsOf(p: Progress, world?: Pick<World, "layout" | "depots">): Needs {
  const c = dearestOf.get(p);
  const layout = world?.layout ?? null;
  const pieces = layout?.piecesVersion ?? 0;
  if (c && c.learned === p.learned.size && c.layout === layout && c.pieces === pieces) return c;
  const known: ThingId[] = [];
  const types = new Set<string>();
  for (const id of Object.keys(THING_RULES) as ThingId[]) {
    if (!p.knows(id) || isFree(id) || total(THING_RULES[id]!.cost) === 0) continue;
    known.push(id);
    if (id.startsWith("piece:")) types.add(id.slice("piece:".length));
  }
  const built = world && types.size > 0 ? builtOf(world, types) : null;
  const most = new Int32Array(CARGO_KINDS.length);
  const least = new Int32Array(CARGO_KINDS.length);
  const industries: DepotRole[] = [];
  for (const id of known) {
    if (id.startsWith("piece:") && built?.has(id.slice("piece:".length))) continue;
    const cost = THING_RULES[id]!.cost;
    for (const k of kindsOf(cost)) {
      const i = CARGO[k].index;
      most[i] = Math.max(most[i], cost[k]!);
      least[i] = least[i] === 0 ? cost[k]! : Math.min(least[i], cost[k]!);
    }
    if (id.startsWith(DEPOT) && RECIPES[id.slice(DEPOT.length) as DepotRole]) industries.push(id.slice(DEPOT.length) as DepotRole);
  }
  const made = new Set<CargoKind>();
  if (layout) {
    for (const pid of layout.pieceIds()) {
      const type = layout.getPiece(pid)!.type;
      if (type.startsWith("depot-")) for (const k of RECIPES[type.slice("depot-".length) as DepotRole]?.gives ?? []) made.add(k);
    }
  }
  const out: Needs = { learned: p.learned.size, layout, pieces, most, least, industries, made };
  dearestOf.set(p, out);
  return out;
}

const DEPOT = "piece:depot-";

/** Per progress: the last spare worked out (`shopSpare`), and from what. */
const spareOf = new WeakMap<Progress, { needs: Needs; key: string; out: { planks: number; for: ThingId | null } }>();

/**
 * The planks the workshop's yard keeps with no order waiting while a town ahead wants them (`yardKeeps`): `spare`
 * (`WORKSHOP_SPARE`), or enough for the next industry if that costs more, no more than `yardCap`. `for`: that industry
 * (null: just the spare). The next industry is one the player knows and hasn't built (as `shopNeeds` has it) that
 *  - the current goal points at (`goal`: the GoalTracker's current goal's id, "Open a mine" → the mine), or
 *  - research is waiting on: the research being done (or up next, with none being done) costs a good no industry on
 *    the map makes, and this one would (Quarries' flour → the mill).
 * The cheapest of those, if two. Nothing else raises it: no railway kit, no car. (QA: the mill costs 8; a player who
 * didn't order it sat one plank short for most of an hour while the rest rode on to the towns. Raised for anything
 * known and unbuilt, the yard held a plank more for the rest of the game for station kits the player never built, and
 * a town went 54 minutes without planks in the balance play-through.)
 * Cached by its inputs (blueprints learned, the map's pieces, the goal, the research): the game asks once a second.
 */
export function shopSpare(p: Progress, world?: Pick<World, "layout" | "depots">, goal: string | null = null, spare = WORKSHOP_SPARE, yardCap = WORKSHOP_CAP): { planks: number; for: ThingId | null } {
  const needs = needsOf(p, world);
  const research = p.research.current ?? p.research.next;
  const key = `${goal ?? ""}|${research ?? ""}|${spare}|${yardCap}`;
  const c = spareOf.get(p);
  if (c && c.needs === needs && c.key === key) return c.out;
  const wanted = new Set<DepotRole>();
  if (goal?.startsWith("open-")) wanted.add(goal.slice("open-".length) as DepotRole);
  const lacks = research ? kindsOf(researchCost(research).goods).filter((k) => !needs.made.has(k)) : [];
  for (const role of lacks.length > 0 ? needs.industries : []) if (RECIPES[role].gives.some((k) => lacks.includes(k))) wanted.add(role);
  let out: { planks: number; for: ThingId | null } = { planks: Math.min(spare, yardCap), for: null };
  for (const role of needs.industries) {
    const id = `${DEPOT}${role}` as ThingId;
    const planks = THING_RULES[id]?.cost.planks ?? 0;
    if (wanted.has(role) && planks > spare && (out.for === null || planks < out.planks)) out = { planks: Math.min(planks, yardCap), for: id };
  }
  spareOf.set(p, { needs, key, out });
  return out;
}

/** The goods owed at the workshop with a spare on top (`owedSpare`): iron, not a harbour's stone. */
const SPARE_OWED: ReadonlySet<CargoKind> = new Set(["iron"]);

/**
 * The spare of `kind` the workshop takes on top of what's owed (`shopOwes`), for iron only: while some thing the
 * player knows and hasn't built costs iron (as `shopNeeds` has it), the cheapest such thing's iron (a smithy's 4; a
 * colour-light signal's 1 beside a power station's 6), so the next one can be made straight after the dearest one,
 * with no train to wait for. None once every such thing is built (only waiting orders are owed for then), and no
 * more than the yard holds with what's owed. Small, as the yard's iron is out of research's reach: Electricity asks
 * for 10 while a smithy is still to build. (Not for stone: a harbour's 10 is the only stone price, and a second one
 * is a tray order.) Cached with `shopNeeds` (blueprints learned, the map's pieces): a read, however often trains ask.
 */
export function owedSpare(p: Progress, kind: CargoKind, world?: Pick<World, "layout" | "depots">): number {
  return SPARE_OWED.has(kind) ? needsOf(p, world).least[CARGO[kind].index] : 0;
}

/**
 * How many more of `kind` the workshops take from trains (`Economy.owes`, for the goods a workshop takes only while
 * owed: stone, iron): what's needed (`shopNeeds`) and the spare (`owedSpare`), no more than a yard holds, less what
 * their yards hold. 0 once that's covered.
 */
export function shopOwes(world: World, p: Progress, kind: CargoKind): number {
  const need = Math.min(WORKSHOP_CAP, shopNeeds(p, kind, world) + owedSpare(p, kind, world));
  if (need <= 0) return 0;
  let have = 0;
  for (const d of world.economy.allDepots()) if (d.role === "workshop" && world.layout.getPiece(d.pieceId)) have += d.piles[CARGO[kind].index];
  return Math.max(0, need - have);
}

/** Is any good a workshop takes only while owed (`RECIPES.workshop.owed`) owed now? (Routed lines plan again when this flips.) */
export function shopOwing(world: World, p: Progress): boolean {
  return (RECIPES.workshop.owed ?? []).some((k) => shopOwes(world, p, k) > 0);
}

/** The text on a price with goods only a workshop takes while owed: "Needs 5🪨 at the workshop", "Needs 4🔩 at the workshop" (none: null). */
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

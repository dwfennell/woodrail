import { CARGO, GOODS_ICON, type CargoKind } from "../economy/cargo";
import { capOf, RECIPES } from "../economy/economy";
import { kindsOf, type Bag } from "../economy/goods";
import type { Town } from "../landscape";
import { workshops } from "./crafting";
import { amountAt, CARD_AMOUNTS, CARD_KINDS, CARDS_PER_OFFER, type CardKind, type GrowthCard, type Offer } from "./growth-cards";
import { MARKET_BONUS, townLandmarks } from "./landmarks";
import type { Progress } from "./progress";
import { deliver, lacking, lacks } from "./research";
import { techOf } from "./tech";
import { isFree, ruleOf, THING_RULES, type ThingId } from "./things";
import { payFor, townStatus, type TownStatus } from "./towns";
import type { World } from "./world";
import type { CarKind } from "../sim";
import { trainIcon } from "../ui/icons";

/**
 * What Game mode gives for what happens on the railway, in one place for the game and for headless playthroughs:
 * coins for goods a town receives, and when a town grows a choice of three cards (planks, coins, a crate, a wagon, a
 * research boost, rare cargo), never a blueprint: blueprints are researched at a school.
 */

/** A town received `n` units of `kind` (it was `before` then): pay for them. Returns the coins paid. */
export function payDelivery(p: Progress, kind: CargoKind, n: number, before: TownStatus, town?: Town): number {
  // A town with a market pays half again.
  const bonus = town && townLandmarks(town).has("market") ? MARKET_BONUS : 1;
  const paid = Math.round(payFor(kind, before) * n * bonus);
  p.coins += paid;
  return paid;
}

/** The school's piece (the first village's present). */
const SCHOOL: ThingId = "piece:depot-school";

/** Industry buildings (and the workshop): never in a crate. */
const isBuilding = (id: ThingId) => id.startsWith("piece:depot-");

/**
 * A crate for a town that grew to `level`: `level + 1` different things you know how to make (no buildings), two of a
 * piece of track, one of a car or furniture. Empty if you know nothing that costs anything yet.
 */
export function crateFor(p: Progress, level: number, random: () => number): [ThingId, number][] {
  const known = (Object.keys(THING_RULES) as ThingId[]).filter((id) => !isBuilding(id) && !isFree(id) && p.knows(id));
  const out: [ThingId, number][] = [];
  while (out.length < level + 1 && known.length > 0) {
    const id = known.splice(Math.floor(random() * known.length), 1)[0];
    out.push([id, id.startsWith("piece:") ? 2 : 1]);
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
 * The first time any of your towns reaches a level, a present: a timber wagon and a school for your first village, an
 * industry building for your first town, an engine (once Signals are learned) and the grandest industry you know for
 * your first city. Returns what was given (into the toy box), or empty if that level was reached before. (No second
 * engine before Signals: on one line two trains only turn each other back. It comes with Signals: see `learnGift`.)
 */
export function firstTimeGift(p: Progress, level: number): [ThingId, number][] {
  if (level <= p.bestLevel) return [];
  const gifts: [ThingId, number][] = [];
  for (let l = p.bestLevel + 1; l <= Math.min(level, 3); l++) gifts.push(...giftFor(p, l));
  p.bestLevel = level;
  for (const [id, n] of gifts) p.add(id, n);
  return gifts;
}

/**
 * A present for learning blueprint `id`: Signals bring a second engine (a passing loop with signals is where two trains
 * can share a line), unless you've two already. Returns what was given (into the toy box), or empty.
 */
export function learnGift(p: Progress, id: string): [ThingId, number][] {
  if (id !== "signals" || (p.owned.get("car:engine") ?? 0) >= 2) return [];
  p.add("car:engine", 1);
  return [["car:engine", 1]];
}

function giftFor(p: Progress, level: number): [ThingId, number][] {
  // Industry buildings you know, cheapest first (by the coins they'd cost). (Not the school: the first village's.)
  const industries = (Object.keys(THING_RULES) as ThingId[]).filter((id) => isBuilding(id) && id !== SCHOOL && THING_RULES[id]!.coins && p.knows(id));
  industries.sort((a, b) => THING_RULES[a]!.coins! - THING_RULES[b]!.coins!);
  // The first village: a wagon, and a school to research blueprints at (beside a town).
  if (level === 1) return [["car:timber", 1], [SCHOOL, 1]];
  if (level === 2) return industries.length > 0 ? [[industries[0], 1], ["piece:buffer-turnback", 2]] : [["piece:depot-workshop", 1], ["piece:buffer-turnback", 2]];
  // The first city: an engine only once Signals are learned (till then it would only meet the first train head on).
  const engine: [ThingId, number][] = p.learned.has("signals") ? [["car:engine", 1]] : [];
  return [...engine, ...(industries.length > 0 ? [[industries[industries.length - 1], 1] as [ThingId, number]] : [])];
}

/** Room for planks left in the workshops' yards (each up to its cap). */
export function plankRoom(world: World): number {
  let n = 0;
  for (const d of workshops(world)) n += Math.max(0, capOf(d.role) - d.piles[CARGO.planks.index]);
  return n;
}

/** Put up to `n` planks into the workshops' yards, first workshop first. Returns how many went in. */
function plankYards(world: World, n: number): number {
  let left = n;
  for (const d of workshops(world)) {
    const i = CARGO.planks.index;
    const put = Math.min(left, Math.max(0, capOf(d.role) - d.piles[i]));
    d.piles[i] += put;
    left -= put;
  }
  return n - left;
}

/** Is a school on the map? */
function schoolPlaced(world: World): boolean {
  return world.economy.allDepots().some((d) => d.role === "school" && world.layout.getPiece(d.pieceId));
}

/** What a research boost of `share` puts into the current research now: that share of each good it lacks (rounded up). */
export function boostGoods(p: Progress, share: number): Bag {
  const out: Bag = {};
  const short = lacks(p);
  for (const k of kindsOf(short)) out[k] = Math.min(short[k]!, Math.ceil(short[k]! * share));
  return out;
}

/**
 * A rare good for the current research: one it lacks that none of your depots makes (grain before a farm, stone before
 * a quarry). Null if there's none.
 */
export function rareGood(p: Progress, world: World): CargoKind | null {
  const short = kindsOf(lacks(p));
  if (short.length === 0) return null;
  const made = new Set<CargoKind>();
  for (const d of world.economy.allDepots()) if (world.layout.getPiece(d.pieceId)) for (const k of RECIPES[d.role].gives) made.add(k);
  return short.find((k) => !made.has(k)) ?? null;
}

/** Wagons a card can give (known ones; not the engine, which a city gives, nor the track cleaner). */
function wagonsKnown(p: Progress): ThingId[] {
  return (Object.keys(THING_RULES) as ThingId[]).filter((id) => id.startsWith("car:") && id !== "car:engine" && id !== "car:cleaner" && p.knows(id));
}

/** A card of `kind` for a town that grew to `level`, or null if that kind can't be offered now. */
export function cardFor(p: Progress, world: World, kind: CardKind, level: number, random: () => number): GrowthCard | null {
  switch (kind) {
    case "planks": {
      // Only what fits in the yards (the card says so), so none is lost.
      const n = Math.min(amountAt(CARD_AMOUNTS.planks, level), plankRoom(world));
      return n > 0 ? { kind, n } : null;
    }
    case "coins":
      return { kind, n: amountAt(CARD_AMOUNTS.coins, level) };
    case "crate": {
      const things = crateFor(p, amountAt(CARD_AMOUNTS.crate, level) - 1, random);
      return things.length > 0 ? { kind, things } : null;
    }
    case "wagon": {
      // A city's is an engine, but only once Signals are learned (before, a second train only meets the first head on).
      if (level >= 3 && p.learned.has("signals")) return { kind, id: "car:engine" };
      const known = wagonsKnown(p);
      return known.length > 0 ? { kind, id: known[Math.floor(random() * known.length)] } : null;
    }
    case "boost":
      // Only while a research is picked and short of goods.
      return kindsOf(lacks(p)).length > 0 ? { kind, share: amountAt(CARD_AMOUNTS.boost, level) } : null;
    case "rare": {
      // From a town up, with a school to bring it to, and only a good the research lacks that you can't make.
      const n = amountAt(CARD_AMOUNTS.rare, level);
      const good = n > 0 && schoolPlaced(world) ? rareGood(p, world) : null;
      return good ? { kind, good, n } : null;
    }
  }
}

/**
 * Cards that are each a real choice: the wagon card's car is never in the crate beside it (QA: a crate with the wagon's
 * car and more made the wagon card no choice). The crate keeps its size; the wagon card takes another known wagon not
 * in the crate, or goes from the pool if there's none. (The other kinds aren't counted in things: none holds another.)
 */
function apart(p: Progress, pool: GrowthCard[], random: () => number): GrowthCard[] {
  const crate = pool.find((c) => c.kind === "crate");
  const k = pool.findIndex((c) => c.kind === "wagon");
  if (!crate || k === -1) return pool;
  const inCrate = new Set(crate.things.map(([id]) => id));
  const wagon = pool[k] as Extract<GrowthCard, { kind: "wagon" }>;
  if (!inCrate.has(wagon.id)) return pool;
  const others = wagonsKnown(p).filter((id) => !inCrate.has(id));
  if (others.length > 0) pool[k] = { kind: "wagon", id: others[Math.floor(random() * others.length)] };
  else pool.splice(k, 1);
  return pool;
}

/**
 * A town grew to `level` (1 a village, 2 a town, 3 a city…): it offers three cards of different kinds, drawn from those
 * that can be offered now, with amounts by its level. Never a blueprint. The offer waits in `p.offers` till one is
 * taken. Returns it (null if none could be offered, or the level is unknown).
 */
export function offerOnGrowth(p: Progress, world: World, townName: string, level: number, random: () => number): Offer | null {
  if (level <= 0) return null;
  const pool = apart(p, CARD_KINDS.map((k) => cardFor(p, world, k, level, random)).filter((c): c is GrowthCard => c !== null), random);
  const cards: GrowthCard[] = [];
  while (cards.length < CARDS_PER_OFFER && pool.length > 0) cards.push(pool.splice(Math.floor(random() * pool.length), 1)[0]);
  if (cards.length === 0) return null;
  const offer: Offer = { from: townName, level, cards };
  p.offers.push(offer);
  return offer;
}

/**
 * A v12 save's offers (`p.oldOffers`), now its map is in: each drawn again as a growing town's cards, at its town's
 * level now (a village's if the town's not found). True if any were.
 */
export function redrawOldOffers(p: Progress, world: World, random: () => number): boolean {
  if (p.oldOffers.length === 0) return false;
  for (const from of p.oldOffers.splice(0)) {
    const town = world.landscape.towns.find((t) => t.name === from);
    const level = town ? townStatus({ ...world.economy.deliveredGoods.get(town.id), planks: world.economy.delivered.get(town.id) ?? 0 }).level : 0;
    offerOnGrowth(p, world, from, Math.max(1, level), random);
  }
  return true;
}

/** A card as the growth sheet shows it: a big icon, its amount, one line, and whether it can be taken now (if not, why). */
export interface CardView {
  kind: CardKind;
  icon: string;
  amount: string;
  line: string;
  ok: boolean;
  why?: string;
  /** What the toast says once it's taken, where that's more than the amount: "+3🪵 to Bridges" (QA: where it went). */
  taken?: string;
}

/** A car's picture, as the toy box and the tray draw it ("car:hopper" → a hopper's side view). */
export function carIcon(id: ThingId): string {
  return `<span class="gs-car">${trainIcon([id.slice(4) as CarKind])}</span>`;
}

/** "4🪵 3🌾". */
const goodsLine = (bag: Bag) =>
  kindsOf(bag)
    .map((k) => `${bag[k]}${GOODS_ICON[k]}`)
    .join(" ");

/** How a card reads now (what it gives depends on the yards and the research as they are now). */
export function cardView(p: Progress, world: World, card: GrowthCard): CardView {
  switch (card.kind) {
    case "planks": {
      const n = Math.min(card.n, plankRoom(world));
      const line = "Into your workshop's yard";
      if (n > 0) return { kind: card.kind, icon: GOODS_ICON.planks, amount: `+${n} planks`, line, ok: true };
      return { kind: card.kind, icon: GOODS_ICON.planks, amount: `+${card.n} planks`, line, ok: false, why: workshops(world).length === 0 ? "Place your workshop first" : "Your workshop's yard is full" };
    }
    case "coins":
      return { kind: card.kind, icon: "🪙", amount: `+${card.n} coins`, line: "To spend as you like", ok: true };
    case "crate":
      return { kind: card.kind, icon: "📦", amount: `A crate: ${card.things.length} things`, line: describeThings(card.things), ok: true };
    case "wagon":
      // The car itself, drawn as the toy box and the tray draw it (QA: it was always 🚃).
      return { kind: card.kind, icon: carIcon(card.id), amount: `1 ${ruleOf(card.id)?.label ?? card.id}`, line: "Into your toy box", ok: true };
    case "boost": {
      const bag = boostGoods(p, card.share);
      const id = p.research.current;
      const pct = `${Math.round(card.share * 100)}%`;
      if (id && kindsOf(bag).length > 0) return { kind: card.kind, icon: "📘", amount: `+${goodsLine(bag)}`, line: `${pct} of what ${techOf(id)!.label} still needs`, ok: true, taken: `+${goodsLine(bag)} to ${techOf(id)!.label}` };
      return { kind: card.kind, icon: "📘", amount: `${pct} research boost`, line: "Goods into your research", ok: false, why: "Pick a research that needs goods" };
    }
    case "rare": {
      const label = CARGO[card.good].label.toLowerCase();
      const n = Math.min(card.n, lacking(p, card.good));
      const line = "Rare cargo for your research";
      const id = p.research.current;
      if (n > 0) return { kind: card.kind, icon: GOODS_ICON[card.good], amount: `+${n} ${label}`, line, ok: true, ...(id ? { taken: `+${n} ${label} to ${techOf(id)!.label}` } : {}) };
      return { kind: card.kind, icon: GOODS_ICON[card.good], amount: `+${card.n} ${label}`, line, ok: false, why: `Your research needs no ${label} now` };
    }
  }
}

/**
 * Take card `i` of offer `k`: it's applied (planks into the yards, coins, things into the toy box, goods into the
 * research) and the offer is done. Returns how it read (for the toast), or null if it can't be taken now (the offer
 * keeps waiting). Goods into the research change what schools take: the caller tells the economy.
 */
export function takeCard(p: Progress, world: World, k: number, i: number): CardView | null {
  const card = p.offers[k]?.cards[i];
  if (!card) return null;
  const view = cardView(p, world, card);
  if (!view.ok) return null;
  switch (card.kind) {
    case "planks":
      plankYards(world, card.n);
      break;
    case "coins":
      p.coins += card.n;
      break;
    case "crate":
      for (const [id, n] of card.things) p.add(id, n);
      break;
    case "wagon":
      p.add(card.id, 1);
      break;
    case "boost": {
      const bag = boostGoods(p, card.share);
      for (const g of kindsOf(bag)) deliver(p, g, bag[g]!);
      break;
    }
    case "rare":
      deliver(p, card.good, card.n);
      break;
  }
  p.offers.splice(k, 1);
  return view;
}

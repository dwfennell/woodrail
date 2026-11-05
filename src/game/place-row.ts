import { kindsOf, type Bag } from "../economy/goods";
import type { Town } from "../landscape";
import { canResearch, coinsShort } from "./research";
import { BUILDINGS, MAX_SMILES, placeOf, planDone, placesOnMap, SMILE_CUT, TOWN_HALL, townPlaces, townSmiles, treatPrice, TREATS, TREATS_OPEN_LEVEL, treatsOnMap, type Place } from "./places";
import type { Progress } from "./progress";
import type { TownLife } from "./town-life";
import { townLevel } from "./towns";
import type { World } from "./world";

/**
 * A town card's Places and Treats rows (spec 2026-11-04-civic-leisure-design.md): what each tile says and whether its
 * button works, from the world and progress (pure: the card draws it), and the taps that build, stop or buy.
 */

export type PlaceState =
  /** Standing in this town. */
  | "built"
  /** Under way here: its goods are coming. */
  | "building"
  /** Its goods are all in, but there's no lot for it yet. */
  | "waiting-room"
  | "build"
  /** Not enough coins. */
  | "short"
  /** Research is waiting for coins: it comes first. */
  | "saving"
  /** Another place is under way here. */
  | "busy"
  /** One per map, and it stands in another town. */
  | "elsewhere"
  /** The town is too small for it yet. */
  | "level"
  /** Its blueprint can be researched now, but isn't learned. */
  | "research";

export interface PlaceTile {
  id: string;
  name: string;
  icon: string;
  blurb: string;
  state: PlaceState;
  coins: number;
  goods: Bag;
  /** What the button or note says. */
  note: string;
}

export interface PlaceRowView {
  /** The town's smiles (0–`MAX_SMILES`) and a line about them. */
  smiles: number;
  smileLine: string;
  /** No town hall here: the one line and tile to build one (or null when it has one). */
  needsHall: boolean;
  /** The place under way here: its goods and what it's had. */
  plan: { id: string; name: string; icon: string; goods: Bag; got: Bag; stuck: boolean } | null;
  tiles: PlaceTile[];
  /** Treats (null: not on sale yet: no town is a City). */
  treats: PlaceTile[] | null;
  /** What the next treat costs. */
  treatPrice: number;
}

/** "Larkfield needs 10% fewer goods to grow." */
export function smileLine(town: Town, smiles: number): string {
  if (smiles === 0) return `Parks and places with 😊 help ${town.name} grow.`;
  const cut = Math.round(SMILE_CUT * smiles * 100);
  return `${smiles} ${smiles === 1 ? "smile" : "smiles"}: ${town.name} needs ${cut}% fewer goods to grow${smiles >= MAX_SMILES ? " (the most)" : ""}.`;
}

/** "10🪵 6🪨" */
export function goodsText(goods: Bag, icon: (k: string) => string): string {
  return kindsOf(goods)
    .map((k) => `${goods[k]}${icon(k)}`)
    .join(" ");
}

/** The town level's name for a "when it's a city" note. */
const levelName = (n: number): string => townLevel(n).name.toLowerCase();

/** One tile's state for a building place (not a treat). */
function placeState(world: World, p: Progress, town: Town, level: number, place: Place, have: Set<string>, onMap: Map<string, number>): PlaceState | null {
  if (have.has(place.id)) return "built";
  const plan = world.economy.placePlans.get(town.id);
  if (plan?.id === place.id) return planDone(plan) ? "waiting-room" : "building";
  if (!place.tech || !p.learned.has(place.tech)) return place.tech && canResearch(p, place.tech) ? "research" : null;
  if (place.onePerMap && (onMap.get(place.id) ?? 0) > 0) return "elsewhere";
  if (level < place.level) return "level";
  if (plan) return "busy";
  if (coinsShort(p) > 0) return "saving";
  if (p.coins < place.coins) return "short";
  return "build";
}

const NOTES: Record<PlaceState, (place: Place) => string> = {
  built: () => "✓ Built",
  building: () => "On its way",
  "waiting-room": () => "Waiting for room",
  build: (pl) => `Build · ${pl.coins} 🪙`,
  short: (pl) => `Needs ${pl.coins} 🪙`,
  saving: () => "Research first",
  busy: () => "After the one being built",
  elsewhere: () => "One per map: built",
  level: (pl) => `When it's a ${levelName(pl.level)}`,
  research: () => "🔒 Research it at the school",
};

/**
 * The town card's Places and Treats rows for `town` at `level` (Game mode). Shows: the town hall first (it opens the
 * rest); then every place learned, and those whose blueprint can be researched now (locked); treats once any town is
 * a City.
 */
export function placeRow(world: World, p: Progress, town: Town, level: number): PlaceRowView {
  const have = townPlaces(town);
  const onMap = placesOnMap(world.landscape);
  const smiles = townSmiles(town);
  const planned = world.economy.placePlans.get(town.id);
  const planPlace = planned ? placeOf(planned.id) : undefined;
  const needsHall = !have.has(TOWN_HALL);
  const tiles: PlaceTile[] = [];
  for (const place of BUILDINGS) {
    if (needsHall && place.id !== TOWN_HALL) continue;
    const state = placeState(world, p, town, level, place, have, onMap);
    if (state === null) continue;
    tiles.push({ id: place.id, name: place.name, icon: place.icon, blurb: place.blurb, state, coins: place.coins, goods: place.goods, note: NOTES[state](place) });
  }
  let treats: PlaceTile[] | null = null;
  const price = treatPrice(treatsOnMap(world.landscape));
  if (p.bestLevel >= TREATS_OPEN_LEVEL) {
    treats = TREATS.map((t) => {
      const state: PlaceState = have.has(t.id) ? "built" : level < t.level ? "level" : coinsShort(p) > 0 ? "saving" : p.coins < price ? "short" : "build";
      const note = state === "built" ? "✓ Bought" : state === "build" ? `Buy · ${price} 🪙` : state === "short" ? `Needs ${price} 🪙` : NOTES[state](t);
      return { id: t.id, name: t.name, icon: t.icon, blurb: t.blurb, state, coins: price, goods: {}, note };
    });
  }
  return {
    smiles,
    smileLine: smileLine(town, smiles),
    needsHall,
    plan: planned && planPlace ? { id: planned.id, name: planPlace.name, icon: planPlace.icon, goods: planPlace.goods, got: { ...planned.got }, stuck: planDone(planned) } : null,
    tiles,
    treats,
    treatPrice: price,
  };
}

/** A key that changes whenever the rows would say something new (the card draws them again only then). */
export function placeRowKey(world: World, p: Progress, town: Town): number {
  let k = town.buildings.length * 131 + p.bestLevel * 17 + p.learned.size * 7 + (coinsShort(p) > 0 ? 1 : 0);
  // Coins matter only against the prices (Build or "Needs …"): how many of them they reach, not every coin a train pays.
  let reach = 0;
  for (const place of BUILDINGS) if (p.coins >= place.coins) reach++;
  if (p.coins >= treatPrice(treatsOnMap(world.landscape))) reach += 100;
  k = Math.imul(k, 31) + reach;
  for (const b of town.buildings) if (b.landmark) k = Math.imul(k, 31) + b.landmark.length + b.id;
  const plan = world.economy.placePlans.get(town.id);
  if (plan) {
    k = Math.imul(k, 31) + plan.id.length;
    for (const v of Object.values(plan.got)) k = Math.imul(k, 31) + (v ?? 0);
  }
  k = Math.imul(k, 31) + treatsOnMap(world.landscape);
  k = Math.imul(k, 31) + world.economy.placePlans.size;
  return k | 0;
}

export type BuildResult = "started" | "built" | "no-room" | "not-now";

/**
 * Tap Build on a place's tile: its coins paid, and its goods awaited at the town's station (it goes up as the last
 * lands; one with no goods goes up now). Refused (`not-now`) unless the tile says Build, and (`no-room`, nothing
 * paid) when there's no lot for it in the town now.
 */
export function startPlace(world: World, life: TownLife, p: Progress, town: Town, level: number, id: string): BuildResult {
  const place = placeOf(id);
  if (!place || place.kind === "treat") return "not-now";
  if (placeState(world, p, town, level, place, townPlaces(town), placesOnMap(world.landscape)) !== "build") return "not-now";
  if (!life.lotFor(town, place)) return "no-room";
  p.coins -= place.coins;
  world.economy.placePlans.set(town.id, { id, got: {} });
  world.economy.acceptsChanged();
  if (kindsOf(place.goods).length === 0) {
    life.retryPlaces();
    life.update();
    return world.economy.placePlans.has(town.id) ? "started" : "built";
  }
  return "started";
}

/** Stop the place under way in `town`: its coins back; goods it had are used up. Returns the place, or null. */
export function stopPlace(world: World, p: Progress, town: Town): Place | null {
  const plan = world.economy.placePlans.get(town.id);
  const place = plan && placeOf(plan.id);
  if (!plan) return null;
  world.economy.placePlans.delete(town.id);
  world.economy.acceptsChanged();
  if (place) p.coins += place.coins;
  return place ?? null;
}

export type TreatResult = "bought" | "no-room" | "not-now";

/** Tap Buy on a treat: it goes up now, then its coins are taken (none taken when there's no room). */
export function buyTreat(world: World, life: TownLife, p: Progress, town: Town, level: number, id: string): TreatResult {
  const treat = placeOf(id);
  if (!treat || treat.kind !== "treat") return "not-now";
  const view = placeRow(world, p, town, level);
  if (view.treats?.find((t) => t.id === id)?.state !== "build") return "not-now";
  const price = view.treatPrice;
  if (!life.addPlace(town, treat)) return "no-room";
  p.coins -= price;
  return "bought";
}

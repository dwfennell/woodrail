import type { CargoKind } from "../economy/cargo";
import { kindsOf, type Bag } from "../economy/goods";
import type { Landscape, Town } from "../landscape";

/**
 * A town's places (spec 2026-11-04-civic-leisure-design.md): civic and leisure buildings you build in a town from its
 * card, and treats (looks only). A table, so a new place is a row (and a model).
 *
 * - A place is a town `Building` whose `landmark` is its id: the save, dressing, street plans and the move guards that
 *   landmarks have cover it. The map is the record: a town has the places standing in it, nothing else is saved but the
 *   one under way (`Economy.placePlans`).
 * - Built from the town's card once its blueprint is learned, a town hall first (it opens the Places row). Coins are
 *   paid as it's chosen; its goods come by train to the town's station (like a school's research goods); it goes up as
 *   the last of them lands.
 * - What it does: a 😊 smile (the town needs `SMILE_CUT` fewer of each good to grow, up to `MAX_SMILES`), 🎟️ visitors
 *   (riders getting off there pay more), or one special rule. Treats do nothing but look loved.
 */

export type PlaceKind = "civic" | "leisure" | "treat";
/** When a place's visitors come in force: summer Jun–Aug, winter Nov–Feb, spring and autumn the rest. */
export type Season = "all" | "summer" | "winter" | "spring-autumn";

export interface Visitors {
  /** Riders who get off at its town pay this many times the fare (in its season, `peak`). */
  readonly factor: number;
  readonly season: Season;
  /** In its season (absent: `factor` all year). */
  readonly peak?: number;
}

export interface Place {
  readonly id: string;
  readonly name: string;
  readonly icon: string;
  readonly kind: PlaceKind;
  /** The blueprint that unlocks it (none: a treat, unlocked by the town's level). */
  readonly tech?: string;
  /** The town's level it needs (0 a hamlet, 1 a village, 2 a town, 3 a city, 4 City ★…). */
  readonly level: number;
  /** What it does, in a line, for its tile. */
  readonly blurb: string;
  /** Coins, paid as it's chosen. */
  readonly coins: number;
  /** Goods it's built from, brought by train to the town (none: it goes up at once). */
  readonly goods: Bag;
  /** +1 😊. */
  readonly smile?: true;
  readonly visitors?: Visitors;
  /** One on the whole map. */
  readonly onePerMap?: true;
  /** A plain town building already standing in this model becomes this place, free, once its blueprint is learned. */
  readonly opensFree?: string;
  /** Its catalogue model on a 2×2 lot, two squares and one (the first that fits; see `fitScale`). */
  readonly models: { readonly four?: readonly string[]; readonly two: readonly string[]; readonly one: readonly string[] };
}

/** Each 😊 cuts what a town needs to grow by this share of every good. */
export const SMILE_CUT = 0.05;
export const MAX_SMILES = 4;

/** The gateway: a town's Places row opens once it has a town hall. */
export const TOWN_HALL = "town-hall";

/** Treats are on sale once any town is a City (coins come then: treats plan a57a272). */
export const TREATS_OPEN_LEVEL = 3;
/** A treat's price: the more treats on the map, the dearer the next. */
export const treatPrice = (onMap: number): number => 100 + 50 * onMap;

export const PLACES: readonly Place[] = [
  // Town life
  { id: "town-hall", name: "Town hall", icon: "🏛️", kind: "civic", tech: "town-hall", level: 2, blurb: "Plan this town's places.", coins: 60, goods: { planks: 12 }, opensFree: "bldg-town-hall", models: { four: ["bldg-town-hall"], two: ["bldg-town-hall"], one: [] } },
  { id: "fire-station", name: "Fire station", icon: "🔥", kind: "civic", tech: "fire-station", level: 2, blurb: "Keeps the town safe. +1 😊", coins: 120, goods: { planks: 10, stone: 6 }, smile: true, opensFree: "bldg-fire-station", models: { two: ["bldg-fire-station"], one: ["bldg-fire-station"] } },
  { id: "police", name: "Police station", icon: "🌟", kind: "civic", tech: "police", level: 2, blurb: "Friendly faces on the corner. +1 😊", coins: 120, goods: { planks: 10, stone: 6 }, smile: true, opensFree: "bldg-police-station", models: { two: ["bldg-police-station"], one: ["bldg-police-station"] } },
  { id: "hospital", name: "Hospital", icon: "🏥", kind: "civic", tech: "hospital", level: 3, blurb: "Doctors for the whole town. +1 😊", coins: 200, goods: { stone: 10, planks: 8 }, smile: true, opensFree: "bldg-hospital", models: { four: ["bldg-hospital"], two: ["bldg-hospital"], one: ["bldg-hospital"] } },
  { id: "bank", name: "Bank", icon: "🪙", kind: "civic", tech: "bank", level: 3, blurb: "Land and lowering hills cost a quarter less.", coins: 300, goods: { stone: 10, iron: 6 }, onePerMap: true, models: { two: ["bldg-post-office"], one: [] } },
  { id: "museum", name: "Museum", icon: "🖼️", kind: "civic", tech: "museum", level: 3, blurb: "Visitors all year: riders pay ×1.5.", coins: 300, goods: { stone: 12, planks: 8 }, onePerMap: true, visitors: { factor: 1.5, season: "all" }, models: { two: ["bldg-library"], one: ["bldg-library"] } },
  { id: "clock-tower", name: "Clock tower", icon: "⏱️", kind: "civic", tech: "clock-tower", level: 3, blurb: "The whole town keeps time. +1 😊", coins: 200, goods: { stone: 8, iron: 6 }, smile: true, models: { two: ["bldg-station-clock"], one: ["bldg-station-clock"] } },
  // Leisure and sports
  { id: "park", name: "Park", icon: "🌳", kind: "leisure", tech: "park", level: 2, blurb: "A bandstand and trees. +1 😊", coins: 80, goods: { planks: 8 }, smile: true, models: { two: ["scene-bandstand"], one: [] } },
  { id: "sports-field", name: "Sports field", icon: "⚽", kind: "leisure", tech: "sports-field", level: 2, blurb: "Matches in spring and autumn. +1 😊", coins: 120, goods: { planks: 10 }, smile: true, visitors: { factor: 1, season: "spring-autumn", peak: 1.5 }, models: { two: ["scene-bunting"], one: ["scene-flagpole"] } },
  { id: "swimming", name: "Swimming baths", icon: "🌊", kind: "leisure", tech: "swimming", level: 2, blurb: "Visitors all year. +1 😊", coins: 240, goods: { stone: 10, planks: 6 }, smile: true, visitors: { factor: 1.5, season: "all" }, models: { two: ["scene-lily-pond"], one: ["scene-lily-pond"] } },
  { id: "cinema", name: "Cinema", icon: "🎬", kind: "leisure", tech: "cinema", level: 2, blurb: "Visitors, most in winter (×2).", coins: 200, goods: { planks: 10, stone: 6 }, visitors: { factor: 1.5, season: "winter", peak: 2 }, models: { two: ["bldg-toy-shop"], one: ["bldg-toy-shop"] } },
  { id: "theatre", name: "Theatre", icon: "🎭", kind: "leisure", tech: "theatre", level: 3, blurb: "Visitors all year: riders pay ×2.", coins: 260, goods: { planks: 12, stone: 8 }, visitors: { factor: 2, season: "all" }, models: { four: ["bldg-castle-gate"], two: ["bldg-cafe"], one: [] } },
  { id: "beach", name: "Beach and pier", icon: "🏖️", kind: "leisure", tech: "beach", level: 2, blurb: "Day trippers in summer (×2).", coins: 160, goods: { planks: 12 }, visitors: { factor: 1, season: "summer", peak: 2 }, models: { two: ["scene-beach"], one: [] } },
  { id: "sailing", name: "Sailing club", icon: "⛵", kind: "leisure", tech: "sailing", level: 2, blurb: "Regattas in summer (×2).", coins: 180, goods: { planks: 12 }, visitors: { factor: 1, season: "summer", peak: 2 }, models: { two: ["bldg-lighthouse"], one: ["bldg-lighthouse"] } },
  { id: "golf", name: "Golf course", icon: "⛳", kind: "leisure", tech: "golf", level: 3, blurb: "Visitors who pay first-class fares (×2).", coins: 300, goods: { planks: 10, stone: 6 }, visitors: { factor: 2, season: "all" }, models: { two: ["scene-flagpole"], one: ["scene-flagpole"] } },
  { id: "funfair", name: "Funfair", icon: "🎠", kind: "leisure", tech: "funfair", level: 2, blurb: "Visitors all year (×1.5); food sells for more.", coins: 240, goods: { planks: 12, iron: 6 }, visitors: { factor: 1.5, season: "all" }, models: { two: ["bldg-ice-cream-kiosk"], one: ["scene-market-stall"] } },
  { id: "stadium", name: "Football stadium", icon: "🏟️", kind: "leisure", tech: "stadium", level: 3, blurb: "Crowds all year: riders pay ×2.5.", coins: 500, goods: { stone: 20, iron: 6 }, onePerMap: true, visitors: { factor: 2.5, season: "all" }, models: { four: ["bldg-castle-gate"], two: [], one: [] } },
  // Treats: looks only, by the town's level (no blueprint)
  { id: "playground", name: "Playground", icon: "🛝", kind: "treat", level: 1, blurb: "Village treat", coins: 0, goods: {}, models: { two: ["scene-playground"], one: [] } },
  { id: "fountain", name: "Fountain", icon: "⛲", kind: "treat", level: 2, blurb: "Town treat", coins: 0, goods: {}, models: { two: ["scene-fountain"], one: ["scene-fountain"] } },
  { id: "flower-clock", name: "Flower clock", icon: "🌼", kind: "treat", level: 3, blurb: "City treat", coins: 0, goods: {}, models: { two: ["scene-clock-post"], one: ["scene-clock-post"] } },
  { id: "statue", name: "Engine statue", icon: "🚂", kind: "treat", level: 4, blurb: "City ★ treat", coins: 0, goods: {}, models: { two: ["scene-statue"], one: ["scene-statue"] } },
  { id: "street-party", name: "Street party", icon: "✨", kind: "treat", level: 5, blurb: "City ★★ treat", coins: 0, goods: {}, models: { two: ["scene-picnic"], one: ["scene-picnic"] } },
];

const BY_ID = new Map(PLACES.map((p) => [p.id, p]));
export const placeOf = (id: string): Place | undefined => BY_ID.get(id);
export const isPlace = (id: string | undefined): boolean => id !== undefined && BY_ID.has(id);
/** Places that aren't treats, in the table's order (civic, then leisure). */
export const BUILDINGS: readonly Place[] = PLACES.filter((p) => p.kind !== "treat");
export const TREATS: readonly Place[] = PLACES.filter((p) => p.kind === "treat");

/** The places standing in a town (its buildings' landmark ids that are places). */
export function townPlaces(town: Town): Set<string> {
  const out = new Set<string>();
  for (const b of town.buildings) if (b.landmark && BY_ID.has(b.landmark)) out.add(b.landmark);
  return out;
}

/** Places on the whole map, by id: how many stand. */
export function placesOnMap(land: Landscape): Map<string, number> {
  const out = new Map<string, number>();
  for (const t of land.towns) for (const b of t.buildings) if (b.landmark && BY_ID.has(b.landmark)) out.set(b.landmark, (out.get(b.landmark) ?? 0) + 1);
  return out;
}

/** Treats standing on the whole map (the price curve counts them). */
export function treatsOnMap(land: Landscape): number {
  // (Counted straight off the towns' buildings: no map made. A town card asks every frame it's open.)
  let n = 0;
  for (const t of land.towns) for (const b of t.buildings) if (b.landmark && BY_ID.get(b.landmark)?.kind === "treat") n++;
  return n;
}

/** A town's smiles: one per smiling place standing, at most `MAX_SMILES`. Cheap (a town's buildings). */
export function townSmiles(town: Town): number {
  let n = 0;
  for (const b of town.buildings) if (b.landmark && BY_ID.get(b.landmark)?.smile) n++;
  return Math.min(MAX_SMILES, n);
}

/** The share of every good a town with `smiles` still needs to grow (1: all of it). */
export const smileShare = (smiles: number): number => 1 - SMILE_CUT * Math.min(MAX_SMILES, Math.max(0, smiles));

/** Is `month` (0 = January) in `season`? */
export function inSeason(season: Season, month: number): boolean {
  if (season === "all") return true;
  if (season === "summer") return month >= 5 && month <= 7;
  if (season === "winter") return month >= 10 || month <= 1;
  return (month >= 2 && month <= 4) || month === 8 || month === 9;
}

/** What a place's visitors pay now, against a plain fare (1: no more). */
export function visitorsNow(v: Visitors, month: number | undefined): number {
  return month !== undefined && v.peak !== undefined && inSeason(v.season, month) ? v.peak : v.factor;
}

/** Riders getting off in this town pay this many times the fare: its best place now (1: none). */
export function visitorFactor(town: Town, month?: number): number {
  let best = 1;
  for (const b of town.buildings) {
    const v = b.landmark ? BY_ID.get(b.landmark)?.visitors : undefined;
    if (v) best = Math.max(best, visitorsNow(v, month));
  }
  return best;
}

/** Foods sell for this much more at a town with a funfair. */
export const FUNFAIR_FOOD = 1.25;
/** With a bank on the map: land and lowering hills cost this share. */
export const BANK_SHARE = 0.75;
export const hasBank = (land: Landscape): boolean => (placesOnMap(land).get("bank") ?? 0) > 0;

/** A place under way in a town: what it is, and the goods it has had so far. */
export interface PlacePlan {
  id: string;
  got: Bag;
}

/** How many more of `kind` a plan wants (0: none). */
export function planLacks(plan: PlacePlan, kind: CargoKind): number {
  const place = placeOf(plan.id);
  if (!place) return 0;
  return Math.max(0, (place.goods[kind] ?? 0) - (plan.got[kind] ?? 0));
}

/** Has a plan had every good it wants? */
export function planDone(plan: PlacePlan): boolean {
  const place = placeOf(plan.id);
  return !!place && kindsOf(place.goods).every((k) => planLacks(plan, k) === 0);
}

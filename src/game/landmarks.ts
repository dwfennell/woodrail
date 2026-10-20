import type { DepotState } from "../economy/economy";
import type { Landscape, Town } from "../landscape";
import { CITY_SCHOOL_ID } from "./blueprints";
import { townStatus } from "./towns";
import type { World } from "./world";

/**
 * A town's landmarks: a special building that goes up as it reaches a level, and what it does for you (a market). A
 * table, so a new landmark is a row (and a model). Learning has no landmark: your school grows with its town instead
 * (`schoolGrade`).
 */
export interface Landmark {
  readonly id: string;
  readonly name: string;
  /** Goes up when a town grows to this level (1 = village, 2 = town, 3 = city). */
  readonly level: number;
  /** What it does, for the town's card and the toast. */
  readonly blurb: string;
  /**
   * Its catalogue model on a 2×2 lot, a two-square lot, and a one-square lot (the first that's in the catalogue and
   * fits: see `fitsLot`). One with `four` models takes a 2×2 lot where there's room. One that comes with a blueprint
   * goes up only on two squares or more.
   */
  readonly models: { readonly four?: readonly string[]; readonly two: readonly string[]; readonly one: readonly string[] };
  /** Goes up only once this blueprint is learned (at the next town to grow to its level), and in one town only. */
  readonly tech?: string;
}

export const LANDMARKS: readonly Landmark[] = [
  {
    id: "market",
    name: "Market",
    level: 2,
    blurb: "Pays half again for everything delivered to this town.",
    models: { four: ["bldg-market-hall"], two: ["bldg-market-hall", "bldg-post-office"], one: ["bldg-corner-shop"] },
  },
];

/**
 * The landmarks due in `town` now it's at `level`: those of its level or below it hasn't got, and (for one that comes
 * with a blueprint) only if `knows` it and no town has it yet.
 */
export function dueLandmarks(land: Landscape, town: Town, level: number, knows: (tech: string) => boolean): Landmark[] {
  const have = townLandmarks(town);
  const anywhere = landmarksOf(land);
  return LANDMARKS.filter((m) => m.level <= level && !have.has(m.id) && (!m.tech || (knows(m.tech) && !anywhere.has(m.id))));
}

export const landmarkOf = (id: string): Landmark | undefined => LANDMARKS.find((l) => l.id === id);

/** The landmark that goes up when a town reaches `level`, if any. */
export const landmarkAt = (level: number): Landmark | undefined => LANDMARKS.find((l) => l.level === level);

/** The landmarks a town has. */
export function townLandmarks(town: Town): Set<string> {
  return new Set(town.buildings.flatMap((b) => (b.landmark ? [b.landmark] : [])));
}

/** The schools on the map (a school whose piece was taken up doesn't count). */
export function placedSchools(world: World): DepotState[] {
  return world.economy.allDepots().filter((d) => d.role === "school" && world.layout.getPiece(d.pieceId));
}

/** The level of a school's town (0: not yet a village, or no town). */
export function schoolTownLevel(world: World, d: DepotState): number {
  if (d.townId < 0 || !world.landscape.towns.some((t) => t.id === d.townId)) return 0;
  return townStatus({ ...world.economy.deliveredGoods.get(d.townId), planks: world.economy.delivered.get(d.townId) ?? 0 }).level;
}

/**
 * How a school has grown with its town (spec §1): `college` once College is learned and its town is a town or bigger
 * (it studies twice as fast, and wears the college); `wing`, a library wing, once its town is a city (it opens tier-3
 * research). Asked when schools, towns' levels or what's learned change, never per frame.
 */
export interface SchoolGrade {
  college: boolean;
  wing: boolean;
}

export function schoolGrade(world: World, d: DepotState, learned: ReadonlySet<string>): SchoolGrade {
  const level = schoolTownLevel(world, d);
  return { college: level >= 2 && learned.has("college"), wing: level >= 3 };
}

/** How fast research is studied: the fastest of your schools (a college 2, a schoolhouse 1). */
export function researchSpeed(world: World, learned: ReadonlySet<string>): number {
  return placedSchools(world).some((d) => schoolGrade(world, d, learned).college) ? 2 : 1;
}

/** The schools' grades in a few characters, for keys: their models are drawn again only when this changes. */
export function schoolGradesKey(world: World, learned: ReadonlySet<string>): string {
  return placedSchools(world)
    .map((d) => {
      const g = schoolGrade(world, d, learned);
      return `${d.id}${g.college ? "c" : ""}${g.wing ? "w" : ""}`;
    })
    .join(",");
}

/**
 * What your railway has that a blueprint can require: every landmark on the map (a market), and `CITY_SCHOOL_ID` once
 * one of your schools stands beside a city (its library wing opens tier-3 research).
 */
export function landmarksAt(world: World): Set<string> {
  const out = landmarksOf(world.landscape);
  if (placedSchools(world).some((d) => schoolTownLevel(world, d) >= 3)) out.add(CITY_SCHOOL_ID);
  return out;
}

/** Every landmark on the map (a blueprint that needs one needs it somewhere). */
export function landmarksOf(land: Landscape): Set<string> {
  const out = new Set<string>();
  for (const t of land.towns) for (const id of townLandmarks(t)) out.add(id);
  return out;
}

/** Coins for goods delivered to a town with a market: half again. */
export const MARKET_BONUS = 1.5;

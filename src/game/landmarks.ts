import type { Landscape, Town } from "../landscape";
import type { World } from "./world";

/**
 * A town's landmarks: a special building that goes up as it reaches a level, and what it does for you. A table, so a
 * new landmark is a row (and a model).
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
  {
    id: "library",
    name: "Library",
    level: 3,
    blurb: "Opens the advanced blueprints (quarries and more).",
    models: { four: ["bldg-library"], two: ["bldg-library", "bldg-apartment-block"], one: ["bldg-bakery"] },
  },
  {
    id: "college",
    name: "College",
    level: 2,
    tech: "college",
    blurb: "A seat of learning for your towns.",
    models: { four: ["bldg-college"], two: ["bldg-college", "bldg-library", "bldg-school"], one: [] },
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

/**
 * What your railway has that a blueprint can require: every landmark on the map (a blueprint that needs a library
 * needs one somewhere), and "school" once a school depot stands beside a town (towns don't build schools: you place
 * yours, the first village's present).
 */
export function landmarksAt(world: World): Set<string> {
  const out = landmarksOf(world.landscape);
  if (world.economy.allDepots().some((d) => d.role === "school" && world.layout.getPiece(d.pieceId))) out.add("school");
  return out;
}

/** Every landmark on the map (a blueprint that needs a library needs one somewhere). */
export function landmarksOf(land: Landscape): Set<string> {
  const out = new Set<string>();
  for (const t of land.towns) for (const id of townLandmarks(t)) out.add(id);
  return out;
}

/** Coins for goods delivered to a town with a market: half again. */
export const MARKET_BONUS = 1.5;

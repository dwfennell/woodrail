import type { Landscape, Town } from "../landscape";

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
   * Its catalogue model on a two-square lot, and on a one-square lot (the first that's in the catalogue). One that
   * comes with a blueprint goes up only on a two-square lot.
   */
  readonly models: { readonly two: readonly string[]; readonly one: readonly string[] };
  /** Goes up only once this blueprint is learned (at the next town to grow to its level), and in one town only. */
  readonly tech?: string;
}

export const LANDMARKS: readonly Landmark[] = [
  {
    id: "school",
    name: "School",
    level: 1,
    blurb: "Its pupils have ideas: a new blueprint on the board now and then, while the town is supplied.",
    models: { two: ["bldg-school", "bldg-church"], one: ["bldg-corner-shop"] },
  },
  {
    id: "market",
    name: "Market",
    level: 2,
    blurb: "Pays half again for everything delivered to this town.",
    models: { two: ["bldg-market-hall", "bldg-post-office"], one: ["bldg-corner-shop"] },
  },
  {
    id: "library",
    name: "Library",
    level: 3,
    blurb: "Opens the advanced blueprints (quarries and more).",
    models: { two: ["bldg-library", "bldg-apartment-block"], one: ["bldg-cafe"] },
  },
  {
    id: "college",
    name: "College",
    level: 2,
    tech: "college",
    blurb: "Ideas come twice as often, and blueprints cost a fifth fewer planks.",
    models: { two: ["bldg-college", "bldg-library", "bldg-school"], one: [] },
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

/** Every landmark on the map (a blueprint that needs a library needs one somewhere). */
export function landmarksOf(land: Landscape): Set<string> {
  const out = new Set<string>();
  for (const t of land.towns) for (const id of townLandmarks(t)) out.add(id);
  return out;
}

/** How long (seconds of play) a school takes to come up with a blueprint idea. */
export const SCHOOL_IDEA_SECONDS = 480;

/** Coins for goods delivered to a town with a market: half again. */
export const MARKET_BONUS = 1.5;

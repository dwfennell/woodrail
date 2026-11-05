import { statusOf } from "./town-life";
import type { DepotState } from "../economy/economy";
import type { Landscape, Town } from "../landscape";
import { BLUEPRINTS, CITY_SCHOOL_ID, COLLEGE_SCHOOL_ID, SCHOOL_RANK, UNIVERSITY_SCHOOL_ID, type SchoolLevel } from "./blueprints";
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
  // City ★★'s free gift (spec 2026-11-04-civic-leisure §4): bunting strung over a street, in flags of every colour.
  {
    id: "bunting",
    name: "Bunting",
    level: 5,
    blurb: "Flags over its streets, for the biggest towns of all.",
    // (A one-square lot is too short for the bunting's string: a flagpole there.)
    models: { two: ["scene-bunting"], one: ["scene-flagpole"] },
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
  // (Only `LANDMARKS`: a town's places and treats share `Building.landmark` but are never landmarks: game/places.ts.)
  return new Set(town.buildings.flatMap((b) => (b.landmark && landmarkOf(b.landmark) ? [b.landmark] : [])));
}

/** The schools on the map (a school whose piece was taken up doesn't count). */
export function placedSchools(world: World): DepotState[] {
  return world.economy.allDepots().filter((d) => d.role === "school" && world.layout.getPiece(d.pieceId));
}

/** The level of a school's town (0: not yet a village, or no town). */
export function schoolTownLevel(world: World, d: DepotState): number {
  if (d.townId < 0 || !world.landscape.towns.some((t) => t.id === d.townId)) return 0;
  return statusOf(world, d.townId).level;
}

/**
 * How a school has grown with its town (spec §1): `college` once College is learned and its town is a town or bigger
 * (it studies twice as fast, and wears the college); `wing`, a library wing, once its town is a city (it opens tier-3
 * research). Asked when schools, towns' levels or what's learned change, never per frame.
 */
export interface SchoolGrade {
  college: boolean;
  wing: boolean;
  /** A University (tech tree 3): a College whose town is a city, once University is learned. */
  university: boolean;
}

export function schoolGrade(world: World, d: DepotState, learned: ReadonlySet<string>): SchoolGrade {
  const level = schoolTownLevel(world, d);
  const college = level >= 2 && learned.has("college");
  return { college, wing: level >= 3, university: college && level >= 3 && learned.has("university") };
}

/**
 * A school's level for research that must be studied at one (`Blueprint.school`): a University, a College in a city
 * (its library wing: those are tier-3 lessons), or neither.
 */
export function schoolLevel(world: World, d: DepotState, learned: ReadonlySet<string>): SchoolLevel | "school" {
  const g = schoolGrade(world, d, learned);
  return g.university ? "university" : g.college && g.wing ? "college" : "school";
}

/** Can school `d` take a research that must be studied at `need` (none: any school can)? */
export function schoolTakes(world: World, d: DepotState, learned: ReadonlySet<string>, need: SchoolLevel | undefined): boolean {
  return !need || SCHOOL_RANK[schoolLevel(world, d, learned)] >= SCHOOL_RANK[need];
}

/** Each blueprint's school, for those that must be studied at a College or a University. */
const SCHOOL_OF = new Map(BLUEPRINTS.flatMap((b) => (b.school ? [[b.id, b.school] as const] : [])));

/**
 * Does school `d` take the goods of the research under way: any school does, but one that must be studied at a College
 * or a University only such a school (the short way first: most research has no such need).
 */
export function atSchool(world: World, d: DepotState, p: { readonly learned: ReadonlySet<string>; readonly research: { readonly current: string | null } }): boolean {
  const need = p.research.current === null ? undefined : SCHOOL_OF.get(p.research.current);
  return !need || schoolTakes(world, d, p.learned, need);
}

/** Does school `d` take goods for research `id` (one studied at a College or a University: only such a school)? */
export function schoolTakesFor(world: World, d: DepotState, learned: ReadonlySet<string>, id: string): boolean {
  return schoolTakes(world, d, learned, SCHOOL_OF.get(id));
}

/**
 * What to do for a school of `need`'s level, in words for a locked card: "learn College", "grow Larkfield into a city",
 * "place a school by a town". The school nearest it (its town the biggest) is named.
 */
export function schoolHowTo(world: World, learned: ReadonlySet<string>, need: SchoolLevel): string {
  const tech = need === "college" ? "college" : "university";
  const schools = placedSchools(world);
  if (need === "university" && !learned.has("college")) return "learn College, then University";
  if (!learned.has(tech)) return need === "college" ? "learn College" : "learn University";
  if (schools.length === 0) return "place a school by a town";
  const best = [...schools].sort((a, b) => schoolTownLevel(world, b) - schoolTownLevel(world, a))[0];
  const town = world.landscape.towns.find((t) => t.id === best.townId)?.name;
  if (!town) return "place a school by a town";
  return `grow ${town} into a city`;
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
      return `${d.id}${g.college ? "c" : ""}${g.wing ? "w" : ""}${g.university ? "u" : ""}`;
    })
    .join(",");
}

/**
 * What your railway has that a blueprint can require: every landmark on the map (a market), `CITY_SCHOOL_ID` once
 * one of your schools stands beside a city (its library wing opens tier-3 research), and a College and a University
 * once one of your schools is one (`schoolLandmarks`).
 */
export function landmarksAt(world: World, learned: ReadonlySet<string> = new Set()): Set<string> {
  const out = landmarksOf(world.landscape);
  if (placedSchools(world).some((d) => schoolTownLevel(world, d) >= 3)) out.add(CITY_SCHOOL_ID);
  for (const id of schoolLandmarks(world, learned)) out.add(id);
  return out;
}

/** Your schools' levels as landmarks a blueprint can require (a College, a University: `Blueprint.school`). */
export function schoolLandmarks(world: World, learned: ReadonlySet<string>): string[] {
  const out: string[] = [];
  for (const d of placedSchools(world)) {
    const g = schoolGrade(world, d, learned);
    if (g.college && g.wing && !out.includes(COLLEGE_SCHOOL_ID)) out.push(COLLEGE_SCHOOL_ID);
    if (g.university && !out.includes(UNIVERSITY_SCHOOL_ID)) out.push(UNIVERSITY_SCHOOL_ID);
  }
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

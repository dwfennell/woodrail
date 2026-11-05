import { CELL } from "../landscape/grid";

/**
 * Towns growing upward (issue #17): as a Game-mode town reaches each size (village, town, city, city ★), its houses
 * gain storeys, the centre most. A house with storeys is stacked like a wooden toy from the storey blocks in
 * `public/models/floors.glb` (spec 2026-10-14-blender-models-design.md §8): its ground block (with the door), plain
 * floor blocks, then the house itself on top. Only the houses that have blocks can grow; the rest stay as modelled.
 */

/** Height of one storey block (mm), and the most storeys each house that has blocks can gain. */
const STACKS: Readonly<Record<string, { storey: number; most: number }>> = {
  "bldg-townhouse": { storey: 20, most: 4 },
  "bldg-narrow-house": { storey: 20, most: 4 },
  "bldg-brick-house": { storey: 20, most: 3 },
  "bldg-timber-house": { storey: 20, most: 3 },
  "bldg-corner-shop": { storey: 20, most: 3 },
  "bldg-toy-shop": { storey: 20, most: 3 },
  // (Already the tallest house: two more, or it towers over the station.)
  "bldg-apartment-block": { storey: 24, most: 2 },
  "bldg-terrace": { storey: 20, most: 2 },
  "bldg-semi-detached": { storey: 20, most: 2 },
  "bldg-villa": { storey: 20, most: 2 },
  // Cottages and bungalows stay low: one storey more at most.
  "bldg-thatched-cottage": { storey: 20, most: 1 },
  "bldg-bungalow": { storey: 20, most: 1 },
  "bldg-cottage-row": { storey: 20, most: 1 },
};

/** Can this model gain storeys (it has storey blocks)? */
export const stacks = (asset: string): boolean => asset in STACKS;

/** One storey block's height for this model (mm), 0 if it has none. */
export const storeyHeight = (asset: string): number => STACKS[asset]?.storey ?? 0;

/** The width (mm) of each ring out from a town's centre: one storey fewer per ring. */
export const RING = 1.5 * CELL;
/** The first ring's inner edge (mm from the centre): a town's middle squares are mostly its streets and greens. */
export const INNER = 2.5 * CELL;
/** By level (village, town, city, city ★ and on), the share of a town's buildings out from the centre (see `tallChance`). */
const BANDS: readonly (readonly [number, number])[] = [
  [0, 0],
  [0.05, 0.45],
  [0.15, 0.6],
  [0.25, 0.75],
  [0.4, 0.8],
];

/**
 * Where in its town a house rises at `level`, as shares of the town's buildings counted out from the centre (0 the
 * nearest, 1 the farthest): every house that can rises inside the first, none past the second, fewer and fewer between.
 * About a quarter of a village's houses, three in eight of a town's, half a city's and three in five of a city ★'s; the
 * outer fifth always stays single-storey.
 */
export function tallBand(level: number): readonly [number, number] {
  return BANDS[Math.max(0, Math.min(BANDS.length - 1, Math.floor(level)))];
}

/** The chance (0–1) that a house at `share` of its town out from the centre (see `tallBand`) rises at `level`: soft, not a ring. */
export function tallChance(level: number, share: number): number {
  if (level <= 0) return 0;
  const [a, b] = tallBand(level);
  if (share <= a) return 1;
  if (share >= b) return 0;
  const x = (share - a) / (b - a);
  return 1 - x * x * (3 - 2 * x);
}

/** Where a house stands in its town, and its own numbers (see `storeysFor`). */
export interface StoreyPlace {
  /** From the town's centre (mm). */
  distance: number;
  /** The share of its town's other buildings nearer the centre than it (0–1; none: 0, the middle). */
  share?: number;
  /** The house's own jitter (0–1, `jitterOf`): shifts its ring a little, so the steps aren't perfect circles. */
  jitter?: number;
  /** The house's own draw (0–1, `chanceOf`): it rises only where its town's chance there (`tallChance`) is above it. */
  chance?: number;
}

/**
 * How many storeys a town building gains at `level` (0 a hamlet, 1 a village, 2 a town, 3 a city, 4 city ★ ...: the
 * levels its town has grown since the building went up). Only some rise: those near the centre, by a soft chance that
 * falls off toward the town's edge (`tallChance`, against the house's own `chance`), so the edge stays single-storey.
 * One that rises gains `level` less one for each ring (`RING`) it stands out past the first (`INNER`), at least one, as
 * many as its model can take (none for one without blocks). Never fewer at a higher level: a town only grows.
 */
export function storeysFor(asset: string, level: number, at: StoreyPlace): number {
  const s = STACKS[asset];
  if (!s || level <= 0) return 0;
  const { distance, share = 0, jitter = 0, chance = 0 } = at;
  if (chance >= tallChance(level, share)) return 0;
  const ring = Math.floor(Math.max(0, distance - INNER) / RING + jitter * 0.5);
  return Math.max(1, Math.min(s.most, level - ring));
}

/** A building's own jitter (0–1) from its id, the same every time. */
export const jitterOf = (building: number): number => (((Math.imul(building + 1, 2654435761) >>> 0) % 1000) / 1000);

/** A building's own draw (0–1) from its id, the same every time, apart from its jitter (whether it rises at all). */
export function chanceOf(building: number): number {
  let h = Math.imul(building ^ 0x5bd1e995, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** The storey blocks that make a house of `n` storeys more: ground, n − 1 floors, then the house on top; at heights. */
export function stackOf(asset: string, n: number): { piece: string; y: number }[] {
  const h = storeyHeight(asset);
  if (n <= 0 || h === 0) return [];
  const out = [{ piece: `${asset}-ground`, y: 0 }];
  for (let k = 1; k < n; k++) out.push({ piece: `${asset}-floor`, y: k * h });
  out.push({ piece: `${asset}-upper`, y: n * h });
  return out;
}

/**
 * The extra house styles a town builds with as it gets bigger, on top of its own few (see `townProps`): a town gets
 * tall townhouses and narrow houses, a city flats and civic buildings. By lot size (1 square, 2, or a 2×2 block).
 * Each list adds to the ones before it.
 */
export const STYLES_BY_LEVEL: readonly { level: number; one: readonly string[]; two: readonly string[]; four: readonly string[] }[] = [
  { level: 2, one: ["bldg-townhouse", "bldg-narrow-house"], two: ["bldg-apartment-block"], four: [] },
  { level: 3, one: ["bldg-corner-shop", "bldg-ice-cream-kiosk"], two: ["bldg-fire-station", "bldg-police-station", "bldg-apartment-block"], four: ["bldg-town-hall"] },
  { level: 4, one: ["bldg-townhouse"], two: ["bldg-apartment-block"], four: ["bldg-hospital", "bldg-town-hall"] },
];

/**
 * Models a town no longer builds plain houses in (Game mode): a fire station, police station, hospital or town hall
 * once its place's blueprint is learned, so a building that looks like one is one (game/places.ts, `opensFree`). Set
 * by the game as blueprints are learned and on loading; empty in Sandbox and in the headless play-throughs.
 */
const retired = new Set<string>();
export function retireStyles(assets: Iterable<string>): void {
  retired.clear();
  for (const a of assets) retired.add(a);
}

/** The extra styles a town of `level` builds with on lots of `squares` (1, 2 or 4). */
export function extraStyles(level: number, squares: number): string[] {
  const out: string[] = [];
  for (const s of STYLES_BY_LEVEL) if (level >= s.level) out.push(...(squares >= 4 ? s.four : squares === 2 ? s.two : s.one));
  return retired.size > 0 ? out.filter((a) => !retired.has(a)) : out;
}

/** From this level a town wants a tower over its roofs: a church (its spire) on its next two-square house lot. */
export const SPIRE_LEVEL = 3;

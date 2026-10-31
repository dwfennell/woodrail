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

/**
 * How many storeys a town building gains: `level` of its town (0 a hamlet, 1 a village, 2 a town, 3 a city, 4 city ★
 * ...), less one for each ring (`RING`) it stands out past the first (`INNER` from the centre), as many as its model can take (none for one
 * without blocks). `jitter` (0–1, the building's own) shifts its ring a little, so the steps aren't perfect circles.
 * Never fewer at a higher level: a town only grows.
 */
export function storeysFor(asset: string, level: number, distance: number, jitter = 0): number {
  const s = STACKS[asset];
  if (!s || level <= 0) return 0;
  const ring = Math.floor(Math.max(0, distance - INNER) / RING + jitter * 0.5);
  return Math.max(0, Math.min(s.most, level - ring));
}

/** A building's own jitter (0–1) from its id, the same every time. */
export const jitterOf = (building: number): number => (((Math.imul(building + 1, 2654435761) >>> 0) % 1000) / 1000);

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

/** The extra styles a town of `level` builds with on lots of `squares` (1, 2 or 4). */
export function extraStyles(level: number, squares: number): string[] {
  const out: string[] = [];
  for (const s of STYLES_BY_LEVEL) if (level >= s.level) out.push(...(squares >= 4 ? s.four : squares === 2 ? s.two : s.one));
  return out;
}

/** From this level a town wants a tower over its roofs: a church (its spire) on its next two-square house lot. */
export const SPIRE_LEVEL = 3;

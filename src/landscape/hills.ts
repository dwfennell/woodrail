import { MAX_HEIGHT, PLOT_COLS, PLOT_ROWS } from "./grid";

/**
 * How hilly a map is: chosen before a new game (the new-game sheet, `ui/new-game.ts`) and saved with the map, so its
 * land beyond the start (made as it's bought, from the seed) has the same hills. In order, flattest first.
 */
export const HILLINESS = ["flat", "gentle", "hilly", "mountains"] as const;
export type Hilliness = (typeof HILLINESS)[number];

/** A new map's hills unless the player picks others. */
export const DEFAULT_HILLS: Hilliness = "gentle";
/** The hills of a map saved before there was a choice (no `hills` in its save): the land as it was made then. */
export const LEGACY_HILLS: Hilliness = "hilly";

/** The new-game sheet's words for each. */
export const HILLS_LABEL: Record<Hilliness, string> = { flat: "Flat", gentle: "Gentle", hilly: "Hilly", mountains: "Mountainous" };
export const HILLS_BLURB: Record<Hilliness, string> = {
  flat: "Flat land to start on; a few low hills further out",
  gentle: "Open ground to start on, with hills further out",
  hilly: "Hills all round, the start too",
  mountains: "High hills everywhere, more of them",
};

export const isHilliness = (v: unknown): v is Hilliness => typeof v === "string" && (HILLINESS as readonly string[]).includes(v);

/**
 * Each step's sum, from the noise (`n`, about 0 to 1) to blocks: `floor((n − at) × scale)`, with `at` raised by `start`
 * about the middle of the start region, fading to nothing by `reach` (in half-regions: see `startNearness`), so the
 * start is flatter than the land beyond it. Hilly is the sum as it was before the choice (0.42 × 7, the same
 * everywhere): an older map's land comes out as it was.
 */
const STEPS: Record<Hilliness, { at: number; scale: number; start: number; reach: number }> = {
  // No hills on the start (to its corners); beyond it, a few: a quarry, a mine, a tunnel or a lookout still have
  // somewhere to go, on land bought.
  flat: { at: 0.5, scale: 7, start: 1, reach: 1.6 },
  // A few fewer than Hilly beyond the start; the start's middle (the first towns and their line) open, its rim hilly.
  gentle: { at: 0.45, scale: 7, start: 0.12, reach: 1.2 },
  hilly: { at: 0.42, scale: 7, start: 0, reach: 0 },
  mountains: { at: 0.34, scale: 9, start: 0, reach: 0 },
};

/** Half the start region (2 × 2 plots about the origin) in squares: its middle to its edges' middles. */
const HALF_COLS = PLOT_COLS;
const HALF_ROWS = PLOT_ROWS;
/** Within this (in half-regions) of the start's middle, a step's `start` counts in full. */
const INNER = 0.35;

/** How near a square is to the start's middle: 1 within `INNER` (in half-regions), falling smoothly to 0 at `reach`. */
export function startNearness(col: number, row: number, reach = 1.2): number {
  const d = Math.hypot((col + 0.5) / HALF_COLS, (row + 0.5) / HALF_ROWS);
  if (d <= INNER) return 1;
  if (d >= reach) return 0;
  const t = (d - INNER) / (reach - INNER);
  // (Smooth both ends: no ridge of hills along a line where the fade starts.)
  return 1 - t * t * (3 - 2 * t);
}

/** A square's hill height, in blocks (0 to `MAX_HEIGHT`), from the noise there (`n`), for a map with these hills. */
export function hillLevel(n: number, col: number, row: number, hills: Hilliness): number {
  const s = STEPS[hills];
  const at = s.start > 0 ? s.at + s.start * startNearness(col, row, s.reach) : s.at;
  return Math.max(0, Math.min(MAX_HEIGHT, Math.floor((n - at) * s.scale)));
}

import { hashInts } from "./edges";
import { PLOT_COLS, PLOT_ROWS } from "./grid";

/**
 * The coast: every map (since the coast came in) has the sea along one side, a plot or two beyond the start region,
 * so it's one or two plots' purchase away. Plots past the coast are all sea; the coast plots have a wavy shoreline
 * with a strip of sand. Worked out from the seed and the square alone (like the hills), so plots either side of an
 * edge agree on it whichever is generated first.
 */
export interface Coast {
  /** Which way the sea is from the start region. */
  readonly side: "n" | "e" | "s" | "w";
  /** The coast plots' index along the way out (pz for n and s, px for e and w). */
  readonly plot: number;
  readonly seed: number;
}

/** Squares of sand between the grass and the sea. */
export const SAND = 2;
/** The start region's plots (see `START_REGION`): px −1…0, pz −1…0. */
const START = { px0: -1, px1: 0, pz0: -1, pz1: 0 };

const coasts = new Map<number, Coast>();

/** A seed's coast. The starter map's is the next plot out; others' one or two plots out. */
export function coastOf(seed: number, starter = false): Coast {
  const key = starter ? -seed - 1 : seed;
  let c = coasts.get(key);
  if (c) return c;
  const h = hashInts(seed, 0xc0a57);
  const side = (["n", "e", "s", "w"] as const)[h % 4];
  const out = starter ? 1 : 1 + ((h >>> 3) % 2);
  const plot = side === "n" ? START.pz0 - out : side === "s" ? START.pz1 + out : side === "w" ? START.px0 - out : START.px1 + out;
  c = { side, plot, seed };
  if (coasts.size > 64) coasts.clear();
  coasts.set(key, c);
  return c;
}

/** Smooth noise along a line, 0–1: hashed values at whole numbers, eased between. */
function lineNoise(seed: number, x: number): number {
  const i = Math.floor(x);
  const t = x - i;
  const e = t * t * (3 - 2 * t);
  const a = hashInts(seed, i, 0x5ea) / 4294967296;
  const b = hashInts(seed, i + 1, 0x5ea) / 4294967296;
  return a + (b - a) * e;
}

/** Each coast's shore depths worked out so far, by `along` (the shore is the same along its whole length). */
const depths = new WeakMap<Coast, Map<number, number>>();

/** How far the shore is into a coast plot (squares from its land edge) at `along` (a column, or a row). */
function shoreDepth(c: Coast, along: number): number {
  let known = depths.get(c);
  if (!known) depths.set(c, (known = new Map()));
  let d = known.get(along);
  if (d === undefined) {
    if (known.size > 20000) known.clear();
    known.set(along, (d = depthAt(c, along)));
  }
  return d;
}

function depthAt(c: Coast, along: number): number {
  const span = c.side === "n" || c.side === "s" ? PLOT_ROWS : PLOT_COLS;
  const wave = lineNoise(c.seed, along / 9) * 0.7 + lineNoise(c.seed + 1, along / 3.5) * 0.3;
  // From about a third to two thirds of the way across, leaving room for land (and a town) on the land side.
  return Math.round(span * (0.3 + 0.38 * wave));
}

/**
 * Where the shore is at `along` (a column for a coast to the north or south, else a row): the line, in squares along
 * the way out to sea, between the last square of land and the first of sea.
 */
export function shoreLine(c: Coast, along: number): number {
  switch (c.side) {
    case "s":
      return c.plot * PLOT_ROWS + shoreDepth(c, along);
    case "n":
      return (c.plot + 1) * PLOT_ROWS - shoreDepth(c, along);
    case "e":
      return c.plot * PLOT_COLS + shoreDepth(c, along);
    case "w":
      return (c.plot + 1) * PLOT_COLS - shoreDepth(c, along);
  }
}

/**
 * Squares from a square to the shore, counted out toward the sea: 1 for the first square of land, more inland; 0 or
 * less in the sea. (Large inland, well away from the coast plots.)
 */
export function shoreDistance(c: Coast | null, col: number, row: number): number {
  if (!c) return 1e9;
  switch (c.side) {
    case "s":
      return c.plot * PLOT_ROWS + shoreDepth(c, col) - row;
    case "n":
      return row - ((c.plot + 1) * PLOT_ROWS - 1 - shoreDepth(c, col));
    case "e":
      return c.plot * PLOT_COLS + shoreDepth(c, row) - col;
    case "w":
      return col - ((c.plot + 1) * PLOT_COLS - 1 - shoreDepth(c, row));
  }
}

/**
 * Could squares of this rectangle of plots (and `pad` squares round it) be within `reach` squares of the shore? The
 * shore is never less than `MIN_DEPTH` of the way into its coast plot, so a region well inland can skip the coast.
 */
export function coastNear(c: Coast | null, r: { px0: number; pz0: number; w: number; h: number }, reach: number, pad = 0): boolean {
  if (!c) return false;
  const rows = Math.round(PLOT_ROWS * MIN_DEPTH);
  const cols = Math.round(PLOT_COLS * MIN_DEPTH);
  switch (c.side) {
    case "s":
      return c.plot * PLOT_ROWS + rows - ((r.pz0 + r.h) * PLOT_ROWS - 1 + pad) <= reach;
    case "n":
      return r.pz0 * PLOT_ROWS - pad - ((c.plot + 1) * PLOT_ROWS - 1 - rows) <= reach;
    case "e":
      return c.plot * PLOT_COLS + cols - ((r.px0 + r.w) * PLOT_COLS - 1 + pad) <= reach;
    case "w":
      return r.px0 * PLOT_COLS - pad - ((c.plot + 1) * PLOT_COLS - 1 - cols) <= reach;
  }
}

/** The least the shore is into its coast plot, as a fraction of it (see `depthAt`: its wave is never below 0). */
const MIN_DEPTH = 0.3;

/** Is this whole plot sea (past the coast plots)? Such plots aren't for sale. */
export function seaPlot(c: Coast | null, px: number, pz: number): boolean {
  if (!c) return false;
  switch (c.side) {
    case "s":
      return pz > c.plot;
    case "n":
      return pz < c.plot;
    case "e":
      return px > c.plot;
    case "w":
      return px < c.plot;
  }
}

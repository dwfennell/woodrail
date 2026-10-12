import { CELL, extentOf, forEachInPlot, LandscapeGrid, MAX_HEIGHT, type PlotCoord } from "./grid";
import { hillsOf } from "./hill-shape";

/** A block with rounded corners (see `HillShape.blockCorners`): it can't merge into a slab. */
export interface RoundBlock {
  /** Centre of its square. */
  x: number;
  z: number;
  /** Level, 1 for the bottom layer (as for slabs). */
  level: number;
  corners: number;
}

/**
 * The hills as solid pieces: square-cornered blocks merged into slabs, and the blocks with rounded corners on their
 * own. For shadows and physics, which need the true silhouette. `skip` leaves out blocks (level 0 = on the felt),
 * such as those a cutting is drawn through. `plots` limits them to some plots (slabs never span a plot's edge, so
 * each plot's pieces can be built on their own).
 */
export function hillPieces(
  grid: LandscapeGrid,
  skip?: (col: number, row: number, level: number) => boolean,
  plots: readonly number[] = grid.plots.map((_, slot) => slot),
): { slabs: Slab[]; round: RoundBlock[] } {
  const hills = hillsOf(grid);
  const round: RoundBlock[] = [];
  const slabs: Slab[] = [];
  for (const slot of plots) {
    forEachInPlot(slot, grid.plots[slot], (i, col, row) => {
      const h = grid.height[i];
      for (let level = 0; level < h; level++) {
        const corners = hills.blockCorners(col, row, level);
        if (corners && !skip?.(col, row, level)) round.push({ x: grid.centreX(col), z: grid.centreZ(row), level: level + 1, corners });
      }
    });
    slabs.push(...plotSlabs(grid.plots[slot], (c, r, level) => hills.hasBlock(c, r, level - 1) && hills.blockCorners(c, r, level - 1) === 0 && !skip?.(c, r, level - 1)));
  }
  return { slabs, round };
}

/** Greedy rectangle merge over one plot's squares (global columns and rows), where `solid(col, row, level)` holds. */
export function plotSlabs(plot: PlotCoord, solid: (col: number, row: number, level: number) => boolean): Slab[] {
  const e = extentOf([plot]);
  return mergeSlabsWhere((c, r, level) => solid(e.col0 + c, e.row0 + r, level), e.col1 - e.col0, e.row1 - e.row0, e.x0, e.z0, CELL, MAX_HEIGHT);
}

/** One layer of stacked blocks covering a rectangle of the mat (world mm). Level 1 is the bottom layer. */
export interface Slab {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  level: number;
}

/** Greedy rectangle merge per block level, so hills render (and collide) as a few big blocks, not many cubes. */
export function hillSlabs(grid: LandscapeGrid, plots: readonly number[] = grid.plots.map((_, slot) => slot)): Slab[] {
  const at = (c: number, r: number) => {
    const i = grid.index(c, r);
    return i === -1 ? 0 : grid.height[i];
  };
  return plots.flatMap((slot) => plotSlabs(grid.plots[slot], (c, r, level) => at(c, r) >= level));
}

/** Greedy rectangle merge of any grid of block heights (`height(col, row)`), cells `cell` mm square from (x0, z0). */
export function mergeSlabs(
  height: (col: number, row: number) => number,
  cols: number,
  rows: number,
  x0: number,
  z0: number,
  cell: number,
  maxLevel: number,
): Slab[] {
  return mergeSlabsWhere((c, r, level) => height(c, r) >= level, cols, rows, x0, z0, cell, maxLevel);
}

/** Greedy rectangle merge of the cells where `solid(col, row, level)` holds, level by level (1 = the bottom layer). */
export function mergeSlabsWhere(
  solid: (col: number, row: number, level: number) => boolean,
  cols: number,
  rows: number,
  x0: number,
  z0: number,
  cell: number,
  maxLevel: number,
): Slab[] {
  const slabs: Slab[] = [];
  const used = new Uint8Array(cols * rows);
  for (let level = 1; level <= maxLevel; level++) {
    used.fill(0);
    const wants = (c: number, r: number) => solid(c, r, level) && !used[r * cols + c];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (!wants(c, r)) continue;
        let w = 1;
        while (c + w < cols && wants(c + w, r)) w++;
        let h = 1;
        grow: while (r + h < rows) {
          for (let k = 0; k < w; k++) if (!wants(c + k, r + h)) break grow;
          h++;
        }
        for (let dr = 0; dr < h; dr++) for (let k = 0; k < w; k++) used[(r + dr) * cols + c + k] = 1;
        slabs.push({ x0: x0 + c * cell, z0: z0 + r * cell, x1: x0 + (c + w) * cell, z1: z0 + (r + h) * cell, level });
      }
    }
  }
  return slabs;
}

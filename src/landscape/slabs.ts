import { CELL, COLS, LandscapeGrid, MAT_DEPTH, MAT_WIDTH, MAX_HEIGHT, ROWS } from "./grid";
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
 * own. For shadows and physics, which need the true silhouette.
 */
export function hillPieces(grid: LandscapeGrid): { slabs: Slab[]; round: RoundBlock[] } {
  const hills = hillsOf(grid);
  const round: RoundBlock[] = [];
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      const h = grid.height[grid.index(col, row)];
      for (let level = 0; level < h; level++) {
        const corners = hills.blockCorners(col, row, level);
        if (corners) round.push({ x: grid.centreX(col), z: grid.centreZ(row), level: level + 1, corners });
      }
    }
  }
  const slabs = mergeSlabsWhere(
    (c, r, level) => hills.hasBlock(c, r, level - 1) && hills.blockCorners(c, r, level - 1) === 0,
    COLS,
    ROWS,
    -MAT_WIDTH / 2,
    -MAT_DEPTH / 2,
    CELL,
    MAX_HEIGHT,
  );
  return { slabs, round };
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
export function hillSlabs(grid: LandscapeGrid): Slab[] {
  return mergeSlabs((c, r) => grid.height[grid.index(c, r)], COLS, ROWS, -MAT_WIDTH / 2, -MAT_DEPTH / 2, CELL, MAX_HEIGHT);
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

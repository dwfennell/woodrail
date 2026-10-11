import { CELL, COLS, LandscapeGrid, MAT_DEPTH, MAT_WIDTH, MAX_HEIGHT, ROWS } from "./grid";

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
  const slabs: Slab[] = [];
  const used = new Uint8Array(cols * rows);
  for (let level = 1; level <= maxLevel; level++) {
    used.fill(0);
    const wants = (c: number, r: number) => height(c, r) >= level && !used[r * cols + c];
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

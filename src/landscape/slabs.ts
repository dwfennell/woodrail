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
  const slabs: Slab[] = [];
  const used = new Uint8Array(COLS * ROWS);
  for (let level = 1; level <= MAX_HEIGHT; level++) {
    used.fill(0);
    const wants = (c: number, r: number) => grid.height[grid.index(c, r)] >= level && !used[grid.index(c, r)];
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        if (!wants(c, r)) continue;
        let w = 1;
        while (c + w < COLS && wants(c + w, r)) w++;
        let h = 1;
        grow: while (r + h < ROWS) {
          for (let k = 0; k < w; k++) if (!wants(c + k, r + h)) break grow;
          h++;
        }
        for (let dr = 0; dr < h; dr++) for (let k = 0; k < w; k++) used[grid.index(c + k, r + dr)] = 1;
        slabs.push({
          x0: -MAT_WIDTH / 2 + c * CELL,
          z0: -MAT_DEPTH / 2 + r * CELL,
          x1: -MAT_WIDTH / 2 + (c + w) * CELL,
          z1: -MAT_DEPTH / 2 + (r + h) * CELL,
          level,
        });
      }
    }
  }
  return slabs;
}

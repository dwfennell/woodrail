import { RISER_HEIGHT } from "../track";
import { CELL, MAT_DEPTH, MAT_WIDTH, type LandscapeGrid } from "./grid";

/**
 * Hill blocks have their outer corners rounded off where a hill's edge turns a corner, so hills follow soft curves
 * like the felt rivers and roads beside them (and a ramp or a curve fits closer in). The rounding is this radius (mm).
 */
export const CORNER_RADIUS = CELL / 2;

/** Corner bits of a block, by direction: +x (next column) and +z (next row) as signs. */
export const CORNERS = [
  { sx: 1, sz: 1, bit: 1 },
  { sx: 1, sz: -1, bit: 2 },
  { sx: -1, sz: 1, bit: 4 },
  { sx: -1, sz: -1, bit: 8 },
] as const;

/** Is there a block at this level in this square (off the mat counts as solid: the mat's edge stays square)? */
function solid(grid: LandscapeGrid, col: number, row: number, level: number): boolean {
  if (!grid.inBounds(col, row)) return true;
  return grid.height[grid.index(col, row)] > level;
}

/**
 * Which corners of the block at `level` (0 = on the felt) in this square are rounded off: those where the hill's edge
 * turns — the two squares beside the corner and the one across it all have no block at this level.
 */
export function blockCorners(grid: LandscapeGrid, col: number, row: number, level: number): number {
  if (!solid(grid, col, row, level) || !grid.inBounds(col, row)) return 0;
  let mask = 0;
  for (const { sx, sz, bit } of CORNERS) {
    if (!solid(grid, col + sx, row, level) && !solid(grid, col, row + sz, level) && !solid(grid, col + sx, row + sz, level)) mask |= bit;
  }
  return mask;
}

/** Is a point (offsets from the square's centre) inside a block with these corners rounded off? */
export function insideBlock(mask: number, ox: number, oz: number): boolean {
  if (mask === 0) return true;
  const half = CELL / 2;
  for (const { sx, sz, bit } of CORNERS) {
    if (!(mask & bit)) continue;
    // In the corner's square of the rounding, and outside its quarter circle: cut away.
    const cx = sx * (half - CORNER_RADIUS);
    const cz = sz * (half - CORNER_RADIUS);
    if ((ox - cx) * sx > 0 && (oz - cz) * sz > 0 && Math.hypot(ox - cx, oz - cz) > CORNER_RADIUS) return false;
  }
  return true;
}

/** Height of the ground (top of the highest block, or the felt) at a point, minding rounded corners. */
export function groundAt(grid: LandscapeGrid, x: number, z: number): number {
  const i = grid.cellAtWorld(x, z);
  if (i === -1) return 0;
  const col = Math.floor((x + MAT_WIDTH / 2) / CELL);
  const row = Math.floor((z + MAT_DEPTH / 2) / CELL);
  const ox = x - grid.centreX(col);
  const oz = z - grid.centreZ(row);
  for (let level = grid.height[i] - 1; level >= 0; level--) {
    if (insideBlock(blockCorners(grid, col, row, level), ox, oz)) return (level + 1) * RISER_HEIGHT;
  }
  return 0;
}

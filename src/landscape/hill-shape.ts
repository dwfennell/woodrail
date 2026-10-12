import { RISER_HEIGHT } from "../track";
import { CELL, MAT_DEPTH, MAT_WIDTH, type LandscapeGrid } from "./grid";

/**
 * Hill blocks have their outer corners rounded off where a hill's edge turns, so hills follow soft curves like the
 * felt rivers and roads beside them. The rounding's radius (mm).
 */
export const CORNER_RADIUS = CELL / 2;

/** A block's corners by direction (+x = next column, +z = next row), and their bits in a corner mask. */
export const CORNERS = [
  { sx: 1, sz: 1, bit: 1 },
  { sx: 1, sz: -1, bit: 2 },
  { sx: -1, sz: 1, bit: 4 },
  { sx: -1, sz: -1, bit: 8 },
] as const;

/**
 * The one description of the hills: which blocks there are, and how high the ground is at any point. Everything that
 * cares about hill shape (placement, supports, bridges' arches, trees, and in time rendering, shadows and physics)
 * asks here rather than reading block heights off the grid, so they can never disagree.
 *
 * See `docs/superpowers/specs/2026-10-12-hill-shapes-design.md`.
 */
export class HillShape {
  constructor(readonly grid: LandscapeGrid) {}

  /** Height of the ground at a plan point: the top of the highest block there (minding rounded corners), or the felt (0). */
  groundAt(x: number, z: number): number {
    const i = this.grid.cellAtWorld(x, z);
    if (i === -1) return 0;
    const col = Math.floor((x + MAT_WIDTH / 2) / CELL);
    const row = Math.floor((z + MAT_DEPTH / 2) / CELL);
    const ox = x - this.grid.centreX(col);
    const oz = z - this.grid.centreZ(row);
    for (let level = this.grid.height[i] - 1; level >= 0; level--) {
      if (insideBlock(this.blockCorners(col, row, level), ox, oz)) return (level + 1) * RISER_HEIGHT;
    }
    return 0;
  }

  /** Is there a block at this level (0 = on the felt) in this square? */
  hasBlock(col: number, row: number, level: number): boolean {
    return this.grid.inBounds(col, row) && this.grid.height[this.grid.index(col, row)] > level;
  }

  /**
   * Which corners of the block at `level` in this square are rounded off (a mask of `CORNERS` bits): those where the
   * hill's edge turns outward — the squares beside the corner and the one across it have no block at this level.
   * Off the mat counts as solid, so the mat's own edge stays square. 0 if there's no block.
   */
  blockCorners(col: number, row: number, level: number): number {
    if (!this.hasBlock(col, row, level)) return 0;
    const solid = (c: number, r: number) => !this.grid.inBounds(c, r) || this.hasBlock(c, r, level);
    let mask = 0;
    for (const { sx, sz, bit } of CORNERS) {
      if (!solid(col + sx, row) && !solid(col, row + sz) && !solid(col + sx, row + sz)) mask |= bit;
    }
    return mask;
  }
}

const shapes = new WeakMap<LandscapeGrid, HillShape>();

/** The hill shape of a map (one per grid, made on first use). */
export function hillsOf(grid: LandscapeGrid): HillShape {
  let h = shapes.get(grid);
  if (!h) shapes.set(grid, (h = new HillShape(grid)));
  return h;
}

/** Is a point (offsets from a square's centre) inside a block with these corners rounded off? */
export function insideBlock(corners: number, ox: number, oz: number): boolean {
  if (corners === 0) return true;
  const half = CELL / 2;
  for (const { sx, sz, bit } of CORNERS) {
    if (!(corners & bit)) continue;
    // In the corner's square of the rounding and outside its quarter circle: cut away.
    const cx = sx * (half - CORNER_RADIUS);
    const cz = sz * (half - CORNER_RADIUS);
    if ((ox - cx) * sx > 0 && (oz - cz) * sz > 0 && Math.hypot(ox - cx, oz - cz) > CORNER_RADIUS) return false;
  }
  return true;
}

/**
 * A block's plan outline (offsets from its square's centre, anticlockwise from above in x/z), its rounded corners
 * as arcs of `steps` segments. `inset` shrinks it (for the gap between blocks, or a core inside them).
 */
export function blockOutline(corners: number, inset = 0, steps = 6): { x: number; z: number }[] {
  const half = CELL / 2 - inset;
  const round = CORNER_RADIUS - inset;
  const out: { x: number; z: number }[] = [];
  // Corners in turn round the square: (+,+), (−,+), (−,−), (+,−).
  const order = [CORNERS[0], CORNERS[2], CORNERS[3], CORNERS[1]];
  const startAngle = [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2];
  order.forEach(({ sx, sz, bit }, k) => {
    if (!(corners & bit) || round <= 0) {
      out.push({ x: sx * half, z: sz * half });
      return;
    }
    const cx = sx * (half - round);
    const cz = sz * (half - round);
    for (let j = 0; j <= steps; j++) {
      const a = startAngle[k] + (j / steps) * (Math.PI / 2);
      out.push({ x: cx + Math.cos(a) * round, z: cz + Math.sin(a) * round });
    }
  });
  return out;
}

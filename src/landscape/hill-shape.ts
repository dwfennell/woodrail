import { RISER_HEIGHT } from "../track";
import type { LandscapeGrid } from "./grid";

/**
 * The one description of the hills: which blocks there are, and how high the ground is at any point. Everything that
 * cares about hill shape (placement, supports, bridges' arches, trees, and in time rendering, shadows and physics)
 * asks here rather than reading block heights off the grid, so they can never disagree.
 *
 * See `docs/superpowers/specs/2026-10-12-hill-shapes-design.md`.
 */
export class HillShape {
  constructor(readonly grid: LandscapeGrid) {}

  /** Height of the ground at a plan point: the top of the hill there, or the felt (0); 0 off the mat. */
  groundAt(x: number, z: number): number {
    const i = this.grid.cellAtWorld(x, z);
    return i === -1 ? 0 : this.grid.height[i] * RISER_HEIGHT;
  }

  /** Is there a block at this level (0 = on the felt) in this square? */
  hasBlock(col: number, row: number, level: number): boolean {
    return this.grid.inBounds(col, row) && this.grid.height[this.grid.index(col, row)] > level;
  }
}

const shapes = new WeakMap<LandscapeGrid, HillShape>();

/** The hill shape of a map (one per grid, made on first use). */
export function hillsOf(grid: LandscapeGrid): HillShape {
  let h = shapes.get(grid);
  if (!h) shapes.set(grid, (h = new HillShape(grid)));
  return h;
}

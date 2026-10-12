import { TRACK_WIDTH, type Layout } from "../track";
import { reachable, type Landscape } from "./generate";
import { CELL, FEAT_NONE, FEAT_TREE, MAX_HEIGHT, PLOT_CELLS, SURF_GRASS } from "./grid";
import { BUCKET, bucketKey, trackPoints } from "./trees-aside";

/** Why a square's height can't change. */
export type LandBlock = "not-grass" | "in-use" | "station-way" | "top" | "bottom" | "steep" | "track" | "prop" | "cut-off";

export const LAND_MESSAGES: Record<LandBlock, string> = {
  "not-grass": "Only grass can be raised or lowered",
  "in-use": "Something stands there",
  "station-way": "Keep the way into the station level",
  top: "That's as high as the land goes",
  bottom: "That's as low as it goes",
  steep: "Too steep: raise or lower the squares around it first",
  track: "There's track on or beside it",
  prop: "Move what's standing there first",
  "cut-off": "That would cut a town or depot off",
};

/** Something standing on the land that a height change must not move: the props' footprints, as world rectangles. */
export interface LandOccupants {
  /** Does anything (a prop) stand within this world rectangle? */
  inRect(x0: number, z0: number, x1: number, z1: number): boolean;
}

const NONE: LandOccupants = { inRect: () => false };

/**
 * Checks and applies height edits (grass blocks) to a landscape. Keeps the generator's rules: only open grass (and
 * tree squares) change; heights stay within 0..MAX_HEIGHT and within one block of each square's four neighbours;
 * nothing standing on a square or beside it (track, props) is buried or left in the air; every town and depot stays
 * reachable. Build one per edit (or per stroke): it samples the track once.
 */
export class LandEditor {
  private readonly track: Map<number, number[]>;
  private readonly corridors: Set<number>;
  private readonly wasReachable: boolean;

  constructor(
    private readonly land: Landscape,
    layout: Layout | null,
    private readonly occupants: LandOccupants = NONE,
  ) {
    this.track = layout ? trackPoints(layout) : new Map();
    this.corridors = new Set(land.corridors);
    this.wasReachable = reachable(land);
  }

  /** Can square `i` go up (`+1`) or down (`-1`) a block? Null if so, else why not. */
  check(i: number, step: 1 | -1): LandBlock | null {
    const g = this.land.grid;
    if (g.surface[i] !== SURF_GRASS) return "not-grass";
    if (g.feature[i] !== FEAT_NONE && g.feature[i] !== FEAT_TREE) return "in-use";
    if (this.corridors.has(i)) return "station-way";
    const h = g.height[i] + step;
    if (h > MAX_HEIGHT) return "top";
    if (h < 0) return "bottom";
    const col = g.colOf(i);
    const row = g.rowOf(i);
    for (const [dc, dr] of DIRS) {
      const n = g.index(col + dc, row + dr);
      if (n !== -1 && Math.abs(g.height[n] - h) > 1) return "steep";
    }
    // Corners round off and ramp cuttings reach into the neighbours, so keep track a square clear all round.
    const x0 = g.centreX(col) - 1.5 * CELL;
    const z0 = g.centreZ(row) - 1.5 * CELL;
    if (this.trackIn(x0, z0, x0 + 3 * CELL, z0 + 3 * CELL)) return "track";
    if (this.occupants.inRect(x0 + CELL, z0 + CELL, x0 + 2 * CELL, z0 + 2 * CELL)) return "prop";
    if (this.wasReachable) {
      g.height[i] = h;
      const ok = reachable(this.land);
      g.height[i] = h - step;
      if (!ok) return "cut-off";
    }
    return null;
  }

  /** Raise or lower square `i` a block if allowed. Returns why not, or null when done. The caller redraws its plot. */
  apply(i: number, step: 1 | -1): LandBlock | null {
    const why = this.check(i, step);
    if (why) return why;
    this.land.grid.height[i] += step;
    this.land.grid.touch(plotSlotOf(i));
    return null;
  }

  private trackIn(x0: number, z0: number, x1: number, z1: number): boolean {
    const m = TRACK_WIDTH / 2;
    for (let bx = Math.floor((x0 - m) / BUCKET); bx <= Math.floor((x1 + m) / BUCKET); bx++) {
      for (let bz = Math.floor((z0 - m) / BUCKET); bz <= Math.floor((z1 + m) / BUCKET); bz++) {
        const list = this.track.get(bucketKey(bx, bz));
        if (!list) continue;
        for (let k = 0; k < list.length; k += 2) {
          const x = list[k];
          const z = list[k + 1];
          if (x > x0 - m && x < x1 + m && z > z0 - m && z < z1 + m) return true;
        }
      }
    }
    return false;
  }
}

const DIRS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
] as const;

/** The plot slot a square index is in (indices run plot by plot). */
export function plotSlotOf(i: number): number {
  return Math.floor(i / PLOT_CELLS);
}

/** Set squares' heights (undo and redo of an edit), touching their plots. Returns the plot slots changed. */
export function setHeights(land: Landscape, heights: ReadonlyMap<number, number>): number[] {
  const slots = new Set<number>();
  for (const [i, h] of heights) {
    land.grid.height[i] = h;
    slots.add(plotSlotOf(i));
  }
  for (const s of slots) land.grid.touch(s);
  return [...slots];
}

import { createSample, getPieceDef, pathLength, RISER_HEIGHT, samplePath, TRACK_WIDTH, type PieceTypeId, type Pose } from "../track";
import { CELL, MAT_DEPTH, MAT_WIDTH, type LandscapeGrid } from "./grid";

/** A cutting is this much wider than the track (mm), so the ramp sits in it with a little room each side. */
export const CUTTING_WIDTH = TRACK_WIDTH + 8;

/** A ramp let into a hill: the blocks it cuts a sloping channel through, and the ramp it's cut for. */
export interface Cutting {
  pose: Pose;
  /** Base height of the ramp (its low end). */
  y: number;
  length: number;
  rise: number;
  /** Blocks cut: square and level (0 = on the felt). */
  blocks: { col: number; row: number; level: number }[];
}

/** Can this piece cut its way into a hill? Plain ramps (not those up on arches) can. */
export function cutsHills(type: PieceTypeId): boolean {
  return type === "ramp";
}

const s = createSample();

/**
 * The blocks a ramp at this pose would cut through: those standing above its deck within its channel. Empty for pieces
 * that don't cut, and for a ramp that runs clear of the hills. Pure.
 */
export function rampCutting(grid: LandscapeGrid, type: PieceTypeId, flipped: boolean, pose: Pose, y: number): Cutting | null {
  if (!cutsHills(type)) return null;
  const def = getPieceDef(type, flipped);
  const geom = def.paths[0].geom;
  const length = pathLength(geom);
  const rise = geom.kind === "line" ? geom.rise : 0;
  const ch = Math.cos(pose.heading);
  const sh = Math.sin(pose.heading);
  const found = new Map<number, { col: number; row: number; level: number }>();
  const half = CUTTING_WIDTH / 2;
  const n = Math.ceil(length / 6);
  for (let k = 0; k <= n; k++) {
    samplePath(geom, (length * k) / n, s);
    const deck = y + s.y;
    for (const lat of [-half, -half / 2, 0, half / 2, half]) {
      const lx = s.x - Math.sin(s.heading) * lat;
      const lz = s.z + Math.cos(s.heading) * lat;
      const x = pose.x + lx * ch - lz * sh;
      const z = pose.z + lx * sh + lz * ch;
      const i = grid.cellAtWorld(x, z);
      if (i === -1) continue;
      const col = Math.floor((x + MAT_WIDTH / 2) / CELL);
      const row = Math.floor((z + MAT_DEPTH / 2) / CELL);
      // Every block here whose top stands above the deck (by more than a whisker) is cut.
      for (let level = 0; level < grid.height[i]; level++) {
        if ((level + 1) * RISER_HEIGHT <= deck + 0.5) continue;
        found.set((level * 64 + row) * 64 + col, { col, row, level });
      }
    }
  }
  if (found.size === 0) return null;
  return { pose: { ...pose }, y, length, rise, blocks: [...found.values()] };
}

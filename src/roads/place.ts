import { createSample, getPieceDef, pathLength, samplePath, TRACK_WIDTH, type Layout } from "../track";
import type { Landscape } from "../landscape/generate";
import { CELL, FEAT_NONE, FEAT_TREE, SURF_GRASS, SURF_LANE, SURF_RIVER, SURF_ROAD, SURF_TOWN, type LandscapeGrid } from "../landscape/grid";
import { bestTurn, encodeRoad, type RoadPieceId } from "./pieces";

/** Why a road piece can't go on a square. */
export type RoadBlock = "off-land" | "town" | "river" | "in-use" | "hill" | "station-way" | "track" | "prop";

export const ROAD_MESSAGES: Record<RoadBlock, string> = {
  "off-land": "Roads go on your own land",
  town: "Town streets are already laid",
  river: "Roads can't cross the river yet",
  "in-use": "Something stands there",
  hill: "Roads go on level ground",
  "station-way": "Keep the way into the station clear for track",
  track: "There's track in the way",
  prop: "Move what's standing there first",
};

/** Something standing on the land that a road can't go under: the props' footprints, as world rectangles. */
export interface RoadOccupants {
  inRect(x0: number, z0: number, x1: number, z1: number): boolean;
}

const NONE: RoadOccupants = { inRect: () => false };
/** Track is sampled every this many mm along its paths. */
const STEP = 8;
const sample = createSample();
/** Track higher than this above the ground (on a bridge or riser) passes over a road. */
const OVER = 4;

/**
 * The road bytes beside square `i`, by edge (0 off the grid or no road). An old save's town street (a street square
 * with no piece, drawn as felt) joins on every side, as a crossroads would.
 */
export function roadNeighbours(grid: LandscapeGrid, i: number, out: number[] = [0, 0, 0, 0]): number[] {
  const nb = grid.neighbours();
  for (let e = 0; e < 4; e++) {
    const j = nb[i * 4 + e];
    out[e] = j === -1 ? 0 : grid.road[j] !== 0 ? grid.road[j] : grid.surface[j] === SURF_ROAD && grid.feature[j] === FEAT_NONE ? encodeRoad("cross", 0) : 0;
  }
  return out;
}

/** Does any road piece lie within this world rectangle? (For props, and anything else that mustn't stand on a road.) */
export function roadsInRect(grid: LandscapeGrid, x0: number, z0: number, x1: number, z1: number): boolean {
  for (let row = Math.floor(z0 / CELL); row <= Math.floor((z1 - 1e-6) / CELL); row++) {
    for (let col = Math.floor(x0 / CELL); col <= Math.floor((x1 - 1e-6) / CELL); col++) {
      const i = grid.index(col, row);
      if (i !== -1 && grid.road[i] !== 0) return true;
    }
  }
  return false;
}

/**
 * Checks where a road piece may go: open, level grass (a tree there is cleared away with the edit), on the player's
 * land, off the station approaches, clear of ground-level track and props. Town streets and river squares are never
 * changed. Build one per drag: it samples the track once.
 */
export class RoadPlacer {
  /** Grid square → whether ground-level track runs over it. */
  private readonly trackSquares = new Set<number>();
  private readonly corridors: Set<number>;
  private readonly nbs = [0, 0, 0, 0];

  constructor(
    private readonly land: Landscape,
    layout: Layout | null,
    private readonly occupants: RoadOccupants = NONE,
  ) {
    this.corridors = new Set(land.corridors);
    if (layout) this.sampleTrack(layout);
  }

  /** Can a road piece go on square `i` (−1: off the land)? Null if so. A road already there may be replaced. */
  check(i: number): RoadBlock | null {
    const g = this.land.grid;
    if (i === -1) return "off-land";
    const s = g.surface[i];
    if (s === SURF_TOWN || s === SURF_ROAD) return "town";
    if (s === SURF_RIVER) return "river";
    if (s !== SURF_GRASS && s !== SURF_LANE) return "in-use";
    if (g.feature[i] !== FEAT_NONE && g.feature[i] !== FEAT_TREE) return "in-use";
    if (g.height[i] !== 0) return "hill";
    if (this.corridors.has(i)) return "station-way";
    if (this.trackSquares.has(i)) return "track";
    const x0 = g.colOf(i) * CELL;
    const z0 = g.rowOf(i) * CELL;
    if (this.occupants.inRect(x0, z0, x0 + CELL, z0 + CELL)) return "prop";
    return null;
  }

  /** The road byte for a piece dropped on square `i`: turned to join the roads beside it (else as `held`). */
  fit(id: RoadPieceId, i: number, held: number): number {
    return encodeRoad(id, bestTurn(id, roadNeighbours(this.land.grid, i, this.nbs), held));
  }

  private sampleTrack(layout: Layout): void {
    const g = this.land.grid;
    // A road square takes the track's full width: track running within half a board of the square touches it.
    const m = TRACK_WIDTH / 2;
    for (const id of layout.pieceIds()) {
      if (layout.isLifted(id)) continue;
      const p = layout.getPiece(id)!;
      const def = getPieceDef(p.type, p.flipped);
      const ch = Math.cos(p.pose.heading);
      const sh = Math.sin(p.pose.heading);
      for (const path of def.paths) {
        const len = pathLength(path.geom);
        const n = Math.max(1, Math.ceil(len / STEP));
        for (let k = 0; k <= n; k++) {
          samplePath(path.geom, (len * k) / n, sample);
          if (p.y + sample.y > OVER) continue;
          const x = p.pose.x + sample.x * ch - sample.z * sh;
          const z = p.pose.z + sample.x * sh + sample.z * ch;
          for (const [dx, dz] of [[-m, -m], [m, -m], [-m, m], [m, m]]) {
            const j = g.cellAtWorld(x + dx, z + dz);
            if (j !== -1) this.trackSquares.add(j);
          }
        }
      }
    }
  }
}

/**
 * Put a road piece on a square (0 takes it off), clearing a tree there. Returns how to put the square back as it was
 * (for undo). The caller redraws.
 */
export function setRoadSquare(grid: LandscapeGrid, i: number, road: number): () => void {
  const before = { road: grid.road[i], surface: grid.surface[i], feature: grid.feature[i] };
  grid.setRoad(i, road);
  if (road !== 0 && grid.feature[i] === FEAT_TREE) grid.feature[i] = FEAT_NONE;
  return () => {
    grid.road[i] = before.road;
    grid.surface[i] = before.surface;
    grid.feature[i] = before.feature;
  };
}

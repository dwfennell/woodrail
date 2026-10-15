import { createSample, getPieceDef, pathLength, samplePath, TRACK_WIDTH, type Layout } from "../track";
import type { Landscape } from "../landscape/generate";
import { CELL, FEAT_NONE, FEAT_TREE, SURF_GRASS, SURF_LANE, SURF_RIVER, SURF_ROAD, SURF_SAND, SURF_SEA, SURF_TOWN, type LandscapeGrid } from "../landscape/grid";
import { ALONG_ROAD, crossesRoad } from "../landscape/clearance";
import { bestTurn, edgesOf, encodeRoad, pieceOf, roadsJoin, turnOf, type Edge, type RoadPieceId } from "./pieces";

/** Why a road piece can't go on a square. */
export type RoadBlock = "off-land" | "town" | "river" | "sea" | "beach" | "dry" | "slope" | "in-use" | "station-way" | "track" | "prop";

export const ROAD_MESSAGES: Record<RoadBlock, string> = {
  "off-land": "Roads go on your own land",
  town: "Town streets are already laid",
  river: "Use a road bridge over the river",
  sea: "Roads can't go out over the sea",
  beach: "Roads keep off the beach",
  dry: "Bridges go over the river",
  slope: "A ramp climbs a block over two squares: lay it up to a step",
  "in-use": "Something stands there",
  "station-way": "On a station's way in, only a straight road across the line",
  track: "Track can only cross a plain straight road, straight over",
  prop: "Move what's standing there first",
};

/** Is this road a plain straight running across a line with this heading (as a station's way in takes)? */
function acrossLine(road: number, heading: number): boolean {
  if (road === 0 || pieceOf(road)?.id !== "straight") return false;
  // A straight at an even turn runs along x, at an odd one along z: across the line, not down it.
  const along = turnOf(road) & 1 ? Math.abs(Math.sin(heading)) : Math.abs(Math.cos(heading));
  return along < Math.SQRT1_2;
}

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
export function roadNeighbours(grid: LandscapeGrid, i: number, out: number[] = [0, 0, 0, 0], up?: number[]): number[] {
  const nb = grid.neighbours();
  for (let e = 0; e < 4; e++) {
    const j = nb[i * 4 + e];
    if (up) up[e] = j === -1 ? 0 : grid.height[j] - grid.height[i];
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
 * Checks where a road piece may go: open grass at any height (a tree there is cleared away with the edit), on the player's
 * land, off the station approaches, clear of ground-level track and props. Town streets and river squares are never
 * changed. Build one per drag: it samples the track once.
 */
export class RoadPlacer {
  /** Grid square → which ways ground-level track runs over it (bit 1: along x, bit 2: along z, by its nearer axis). */
  private readonly trackSquares = new Map<number, number>();
  /** The station's way-in squares, each with the heading of the line it keeps clear. */
  private readonly corridors: Map<number, number>;
  private readonly nbs = [0, 0, 0, 0];

  constructor(
    private readonly land: Landscape,
    layout: Layout | null,
    private readonly occupants: RoadOccupants = NONE,
  ) {
    // Each way-in square belongs to the nearest station or depot: the line runs along its heading.
    const lines = [...land.towns.map((t) => ({ c: t.centre, heading: t.station.heading })), ...land.depots.map((d) => ({ c: d.centre, heading: d.piece.heading }))];
    const g = land.grid;
    this.corridors = new Map();
    for (const i of land.corridors) {
      const x = g.centreX(g.colOf(i));
      const z = g.centreZ(g.rowOf(i));
      let best = 0;
      let bestD = Infinity;
      for (const l of lines) {
        const d = Math.hypot(l.c.x - x, l.c.z - z);
        if (d < bestD) {
          bestD = d;
          best = l.heading;
        }
      }
      this.corridors.set(i, best);
    }
    if (layout) this.sampleTrack(layout);
  }

  /**
   * Can a road piece go on square `i` (−1: off the land)? Null if so. A road already there may be replaced. With
   * `road` (the piece as it would be laid), track on the square is fine if it crosses the piece (a level crossing: see
   * `crossesRoad`).
   */
  check(i: number, road = 0): RoadBlock | null {
    this.road = road;
    return this.checkSquare(i);
  }

  private road = 0;

  /** Does the ground-level track on square `i` cross the piece being laid (at any angle, but not running down it)? */
  private crossable(i: number): boolean {
    const ways = this.trackSquares.get(i) ?? 0;
    if (!(ways & 4)) return false;
    // Each way the track runs here must be one that crosses the road (bits 1 and 2: along x or z; else at an angle).
    if (ways & 1 && !crossesRoad(this.road, 0)) return false;
    if (ways & 2 && !crossesRoad(this.road, Math.PI / 2)) return false;
    return crossesRoad(this.road, Math.PI / 4);
  }

  private checkSquare(i: number): RoadBlock | null {
    const g = this.land.grid;
    if (i === -1) return "off-land";
    const s = g.surface[i];
    if (s === SURF_TOWN || s === SURF_ROAD) return "town";
    // No road out over the sea (a road bridge spans a river), nor on the beach (its sand would be lost under a lane).
    if (s === SURF_SEA) return "sea";
    if (s === SURF_SAND) return "beach";
    const bridge = this.road !== 0 && pieceOf(this.road)?.overRiver === true;
    if (s === SURF_RIVER && !bridge) return "river";
    if (s !== SURF_RIVER && bridge) return "dry";
    if (s !== SURF_GRASS && s !== SURF_LANE && s !== SURF_RIVER) return "in-use";
    if (g.feature[i] !== FEAT_NONE && g.feature[i] !== FEAT_TREE) return "in-use";
    // A station's way in stays clear for track, but a plain straight road across the line may go there (track laid
    // later crosses it at a level crossing).
    const line = this.corridors.get(i);
    if (line !== undefined && !acrossLine(this.road, line)) return "station-way";
    const def = this.road === 0 ? null : pieceOf(this.road);
    if (def?.ramp) {
      // Its high end meets the ground a block up (the top half), or the top half on level ground (the bottom half).
      const j = g.neighbours()[i * 4 + turnOf(this.road)];
      if (j === -1 || g.height[j] - g.height[i] !== (def.id === "ramp-high" ? 1 : 0)) return "slope";
    }
    if (this.trackSquares.has(i) && !this.crossable(i)) return "track";
    const x0 = g.colOf(i) * CELL;
    const z0 = g.rowOf(i) * CELL;
    if (this.occupants.inRect(x0, z0, x0 + CELL, z0 + CELL)) return "prop";
    return null;
  }

  /**
   * The road byte for a piece dropped on square `i`: turned to join the roads beside it (else as `held`). A ramp takes
   * whichever half fits: the top half when the ground a block up, or a bottom half's road at half a block, is beside
   * it, turned to climb toward it; else the bottom half.
   */
  fit(id: RoadPieceId, i: number, held: number): number {
    const g = this.land.grid;
    roadNeighbours(g, i, this.nbs, this.steps);
    const def = pieceOf(encodeRoad(id, 0));
    if (def?.overRiver) return encodeRoad(id, this.bridgeTurn(i, held));
    if (!def?.ramp) return encodeRoad(id, bestTurn(id, this.nbs, held, this.steps));
    const nb = g.neighbours();
    let best = encodeRoad("ramp-low", bestTurn("ramp-low", this.nbs, held, this.steps));
    let bestScore = -Infinity;
    for (const half of ["ramp-low", "ramp-high"] as const) {
      for (let t = 0; t < 4; t++) {
        const road = encodeRoad(half, t);
        let score = -Math.min((t - held) & 3, (held - t) & 3);
        for (let e = 0; e < 4; e++) {
          if (!(edgesOf(road) & (1 << e))) continue;
          const n = this.nbs[e];
          if (n && roadsJoin(road, e as Edge, n, this.steps[e])) score += 16;
          else if (n) score -= 4;
        }
        // The top half climbs to the ground a block up: worth most facing it.
        const high = t;
        if (half === "ramp-high" && nb[i * 4 + high] !== -1 && this.steps[high] === 1) score += 24;
        if (score > bestScore) {
          bestScore = score;
          best = road;
        }
      }
    }
    return best;
  }

  private readonly steps = [0, 0, 0, 0];

  /**
   * A bridge's turn: across the river (both ends toward land) before anything else, then joining the roads beside it,
   * then as held.
   */
  private bridgeTurn(i: number, held: number): number {
    const g = this.land.grid;
    const nb = g.neighbours();
    const land = (e: number) => {
      const j = nb[i * 4 + e];
      return j !== -1 && g.surface[j] !== SURF_RIVER;
    };
    let best = held & 1;
    let bestScore = -Infinity;
    for (const t of [0, 1]) {
      const road = encodeRoad("bridge", t);
      let score = (land(t) ? 32 : 0) + (land(t + 2) ? 32 : 0) - (t === (held & 1) ? 0 : 1);
      for (let e = t; e < 4; e += 2) {
        const n = this.nbs[e];
        if (n && roadsJoin(road, e as Edge, n, this.steps[e])) score += 16;
      }
      if (score > bestScore) {
        bestScore = score;
        best = t;
      }
    }
    return best;
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
          const h = p.pose.heading + sample.heading;
          // Bit 4: track here; bit 1: running (near) along x; bit 2: along z (within 25°, see `crossesRoad`).
          const way = 4 | (Math.abs(Math.cos(h)) >= ALONG_ROAD ? 1 : 0) | (Math.abs(Math.sin(h)) >= ALONG_ROAD ? 2 : 0);
          const x = p.pose.x + sample.x * ch - sample.z * sh;
          const z = p.pose.z + sample.x * sh + sample.z * ch;
          for (const [dx, dz] of [[-m, -m], [m, -m], [-m, m], [m, m]]) {
            const j = g.cellAtWorld(x + dx, z + dz);
            // Track up on a bridge or riser above this square's ground passes over a road.
            if (j !== -1 && p.y + sample.y <= g.groundY(j) + OVER) this.trackSquares.set(j, (this.trackSquares.get(j) ?? 0) | way);
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

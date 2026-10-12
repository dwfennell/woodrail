import { createSample, getPieceDef, isBridge, pathLength, samplePath, TRACK_WIDTH, type PieceTypeId, type Pose } from "../track";
import { FEAT_BUILDING, FEAT_DEPOT, FEAT_FIELD, FEAT_SHED, FEAT_STATION, FEAT_TREE, SURF_RIVER, SURF_ROAD, SURF_TOWN } from "./grid";
import { STATION_LENGTH, type Landscape } from "./generate";

/** Why a piece can't go somewhere. "piece" comes from track overlap (see `findOverlap`); the rest from the landscape. */
export type BlockReason = "building" | "station" | "town" | "river" | "hill" | "tree" | "field" | "shed" | "depot" | "off-mat" | "piece" | "unsupported";
export type Clearance = { readonly kind: "clear" } | { readonly kind: "blocked"; readonly reason: BlockReason };

export const BLOCK_MESSAGES: Record<BlockReason, string> = {
  building: "That's a house — go around it",
  station: "The station is in the way",
  town: "Keep the track out of town",
  river: "Needs a bridge over the river",
  hill: "Too low — the hill is in the way",
  tree: "A tree is in the way",
  field: "That's a farm field — go around it",
  shed: "The engine shed is in the way",
  depot: "The depot is in the way",
  "off-mat": "That's past the edge of the map",
  piece: "Another piece is in the way",
  unsupported: "Needs something under that end",
};

const CLEAR: Clearance = { kind: "clear" };
const BLOCKED: Record<BlockReason, Clearance> = {
  building: { kind: "blocked", reason: "building" },
  station: { kind: "blocked", reason: "station" },
  town: { kind: "blocked", reason: "town" },
  river: { kind: "blocked", reason: "river" },
  hill: { kind: "blocked", reason: "hill" },
  tree: { kind: "blocked", reason: "tree" },
  field: { kind: "blocked", reason: "field" },
  shed: { kind: "blocked", reason: "shed" },
  depot: { kind: "blocked", reason: "depot" },
  "off-mat": { kind: "blocked", reason: "off-mat" },
  piece: { kind: "blocked", reason: "piece" },
  unsupported: { kind: "blocked", reason: "unsupported" },
};

const STEP = 16;
const END_INSET = 6;
const SIDE = 18;
const LATERALS = [0, SIDE, -SIDE];
const sample = createSample();

/**
 * Visit sample points of a piece: along each path (inset from the ends so seated neighbours don't collide),
 * at the centre line and both sides. Risers visit their footprint. `visit` returns false to stop early.
 */
function forEachSample(
  type: PieceTypeId,
  flipped: boolean,
  pose: Pose,
  visit: (x: number, z: number, trackY: number) => boolean,
): void {
  const def = getPieceDef(type, flipped);
  const ch = Math.cos(pose.heading);
  const sh = Math.sin(pose.heading);
  if (def.paths.length === 0) {
    for (const [lx, lz] of [[0, 0], [20, 20], [20, -20], [-20, 20], [-20, -20]]) {
      if (!visit(pose.x + lx * ch - lz * sh, pose.z + lx * sh + lz * ch, 0)) return;
    }
    return;
  }
  for (const path of def.paths) {
    const len = pathLength(path.geom);
    const span = Math.max(0, len - 2 * END_INSET);
    const n = Math.max(1, Math.ceil(span / STEP));
    for (let k = 0; k <= n; k++) {
      samplePath(path.geom, END_INSET + (span * k) / n, sample);
      const lx = -Math.sin(sample.heading);
      const lz = Math.cos(sample.heading);
      for (const lat of LATERALS) {
        const px = sample.x + lx * lat;
        const pz = sample.z + lz * lat;
        if (!visit(pose.x + px * ch - pz * sh, pose.z + px * sh + pz * ch, sample.y)) return;
      }
    }
  }
}

/** Is a plan point on a town's station track or platform (not just in one of its squares)? */
function inStationFootprint(land: Landscape, townId: number, x: number, z: number): boolean {
  const town = land.towns[townId];
  return town ? inFixedFootprint(town.centre, town.station.heading, x, z) : false;
}

/** Is a plan point on a depot's track or yard? */
function inDepotFootprint(land: Landscape, depotId: number, x: number, z: number): boolean {
  const depot = land.depots[depotId];
  return depot ? inFixedFootprint(depot.centre, depot.piece.heading, x, z) : false;
}

/** Track plus the 120 mm strip on its +lateral side, for a fixed 216 mm piece centred at `centre`. */
function inFixedFootprint(centre: { x: number; z: number }, heading: number, x: number, z: number): boolean {
  const dx = Math.cos(heading);
  const dz = Math.sin(heading);
  const px = x - centre.x;
  const pz = z - centre.z;
  const d = px * dx + pz * dz;
  const l = -px * dz + pz * dx;
  return Math.abs(d) < STATION_LENGTH / 2 && l > -TRACK_WIDTH / 2 - 2 && l < 120;
}

/**
 * How far into the river track may stray (mm): the felt is drawn with smoothed banks inside its squares, so a piece can
 * overlap its edge a little (and cut a bend) without being in the water.
 */
export const RIVER_GRACE = 16;

/** Is a point in the river and more than RIVER_GRACE from its bank? */
function deepInRiver(g: Landscape["grid"], x: number, z: number): boolean {
  for (const [dx, dz] of [[RIVER_GRACE, RIVER_GRACE], [RIVER_GRACE, -RIVER_GRACE], [-RIVER_GRACE, RIVER_GRACE], [-RIVER_GRACE, -RIVER_GRACE]]) {
    const i = g.cellAtWorld(x + dx, z + dz);
    if (i === -1 || g.surface[i] !== SURF_RIVER) return false;
  }
  return true;
}

/** Can a piece be placed here? Called on every pointer move while dragging. */
export function checkPlacement(land: Landscape, type: PieceTypeId, flipped: boolean, pose: Pose, y: number): Clearance {
  const g = land.grid;
  const overRiver = isBridge(type);
  let result = CLEAR;
  forEachSample(type, flipped, pose, (x, z, trackY) => {
    const i = g.cellAtWorld(x, z);
    if (i === -1) result = BLOCKED["off-mat"];
    else {
      const f = g.feature[i];
      const s = g.surface[i];
      if (f === FEAT_BUILDING) result = BLOCKED.building;
      else if (f === FEAT_TREE) result = BLOCKED.tree;
      else if (f === FEAT_FIELD) result = BLOCKED.field;
      else if (f === FEAT_DEPOT) {
        if (inDepotFootprint(land, g.owner[i], x, z)) result = BLOCKED.depot;
      }
      else if (f === FEAT_SHED) result = BLOCKED.shed;
      else if (f === FEAT_STATION) {
        // Station squares are marked by their centres; only the real footprint (track + platform) blocks,
        // so pieces seated on a station end can overlap the edge of its end squares.
        if (inStationFootprint(land, g.owner[i], x, z)) result = BLOCKED.station;
      } else if (s === SURF_TOWN || s === SURF_ROAD) result = BLOCKED.town;
      else if (s === SURF_RIVER && !overRiver && deepInRiver(g, x, z)) result = BLOCKED.river;
      else if (y + trackY < g.groundY(i) - 0.5) result = BLOCKED.hill;
    }
    return result === CLEAR;
  });
  return result;
}

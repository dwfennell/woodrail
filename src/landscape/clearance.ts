import { createSample, getPieceDef, isBridge, pathLength, RISER_HEIGHT, samplePath, TRACK_WIDTH, type PieceTypeId, type Pose } from "../track";
import { CELL, FEAT_BUILDING, FEAT_DEPOT, FEAT_FIELD, FEAT_RUIN, FEAT_SHED, FEAT_STATION, isWater, SURF_RIVER, SURF_ROAD, SURF_SEA, SURF_TOWN, type LandscapeGrid } from "./grid";
import { smoothLoop, traceRegions, type Loop } from "./outline";
import { STATION_LENGTH, type Landscape } from "./generate";
import { cutsHills, hillsOf } from "./hill-shape";
import { pieceOf, turnOf } from "../roads/pieces";

/** Why a piece can't go somewhere. "piece" comes from track overlap (see `findOverlap`); the rest from the landscape. */
export type BlockReason = "building" | "station" | "town" | "river" | "road" | "hill" | "field" | "shed" | "depot" | "ruin" | "off-mat" | "piece" | "unsupported" | "undercut" | "prop" | "headroom";
export type Clearance = { readonly kind: "clear" } | { readonly kind: "blocked"; readonly reason: BlockReason };

export const BLOCK_MESSAGES: Record<BlockReason, string> = {
  building: "That's a house — go around it",
  station: "The station is in the way",
  town: "Keep the track out of town",
  river: "Needs a bridge over the river",
  road: "Track can't run along a road, or cross a junction",
  hill: "Too low — the hill is in the way",
  undercut: "That would dig away the ground under other track",
  field: "That's a farm field — go around it",
  shed: "The engine shed is in the way",
  depot: "The depot is in the way",
  ruin: "An old yard is in the way: tap it to clear it",
  "off-mat": "That's past the edge of the map",
  piece: "Another piece is in the way",
  unsupported: "Needs something under that end",
  prop: "Something's in the way — move it first",
  headroom: "Trains won't fit under — go two levels up",
};

const CLEAR: Clearance = { kind: "clear" };
const BLOCKED: Record<BlockReason, Clearance> = {
  building: { kind: "blocked", reason: "building" },
  station: { kind: "blocked", reason: "station" },
  town: { kind: "blocked", reason: "town" },
  river: { kind: "blocked", reason: "river" },
  road: { kind: "blocked", reason: "road" },
  hill: { kind: "blocked", reason: "hill" },
  field: { kind: "blocked", reason: "field" },
  shed: { kind: "blocked", reason: "shed" },
  depot: { kind: "blocked", reason: "depot" },
  ruin: { kind: "blocked", reason: "ruin" },
  "off-mat": { kind: "blocked", reason: "off-mat" },
  piece: { kind: "blocked", reason: "piece" },
  unsupported: { kind: "blocked", reason: "unsupported" },
  undercut: { kind: "blocked", reason: "undercut" },
  headroom: { kind: "blocked", reason: "headroom" },
  prop: { kind: "blocked", reason: "prop" },
};

/** Track at most this high over a road meets it at a level crossing (higher, on a bridge or riser, it passes over). */
const LEVEL = 4;

/** Can ground-level track heading this way cross this road piece? Only a plain straight, and only across its run. */
export function crossesRoad(road: number, heading: number): boolean {
  const piece = pieceOf(road);
  if (!piece?.trackMayCross) return false;
  if (piece.id !== "straight") return true;
  // Across a straight road at any angle (a curve, a switch's branch), just not running down it: a straight at an even
  // turn runs along x, at an odd one along z.
  const along = turnOf(road) & 1 ? Math.abs(Math.sin(heading)) : Math.abs(Math.cos(heading));
  return along < ALONG_ROAD;
}

/** Track heading closer than this to a straight road's own line (cos 25°) would be running down it, not across. */
export const ALONG_ROAD = Math.cos((25 * Math.PI) / 180);

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
  visit: (x: number, z: number, trackY: number, heading: number) => boolean,
): void {
  const def = getPieceDef(type, flipped);
  const ch = Math.cos(pose.heading);
  const sh = Math.sin(pose.heading);
  if (def.paths.length === 0) {
    for (const [lx, lz] of [[0, 0], [20, 20], [20, -20], [-20, 20], [-20, -20]]) {
      if (!visit(pose.x + lx * ch - lz * sh, pose.z + lx * sh + lz * ch, 0, pose.heading)) return;
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
        if (!visit(pose.x + px * ch - pz * sh, pose.z + px * sh + pz * ch, sample.y, pose.heading + sample.heading)) return;
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

/** Is a plan point on an old industry's site (its stub and ruined yard: see `MapSite`)? */
export function inRuinFootprint(land: Landscape, siteId: number, x: number, z: number): boolean {
  const site = land.sites?.[siteId];
  return site && !site.cleared ? inFixedFootprint(site.centre, site.piece.heading, x, z) : false;
}

/**
 * Is a plan point on a town station or a map depot (track and the strip beside it) standing on square `i`? Their
 * squares are marked by their centres, so a point in one of their squares may still be clear of them.
 */
export function onFixedSite(land: Landscape, i: number, x: number, z: number): boolean {
  const f = land.grid.feature[i];
  if (f === FEAT_STATION) return inStationFootprint(land, land.grid.owner[i], x, z);
  if (f === FEAT_RUIN) return inRuinFootprint(land, land.grid.owner[i], x, z);
  return f === FEAT_DEPOT && inDepotFootprint(land, land.grid.owner[i], x, z);
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

/** How far over the river's drawn bank track may stray (mm). */
export const RIVER_GRACE = 12;

/** The river's outline as drawn (traced from its squares and smoothed, in square units), per map, as of a revision. */
interface Outline {
  loop: Loop;
  x0: number;
  z0: number;
  x1: number;
  z1: number;
}
const riverOutlines = new WeakMap<LandscapeGrid, { revision: number; outlines: Outline[] }>();

function riverOutline(g: LandscapeGrid): Outline[] {
  let cached = riverOutlines.get(g);
  if (!cached || cached.revision !== g.revision) {
    const outlines = surfaceOutlines(g, [SURF_RIVER, SURF_SEA]).map((loop) => {
      const xs = loop.map((p) => p.x);
      const zs = loop.map((p) => p.z);
      return { loop, x0: Math.min(...xs), z0: Math.min(...zs), x1: Math.max(...xs), z1: Math.max(...zs) };
    });
    cached = { revision: g.revision, outlines };
    riverOutlines.set(g, cached);
  }
  return cached.outlines;
}

/**
 * Outlines of every region of squares with this surface, over the whole grid, smoothed (in square units: x = column,
 * z = row). The felt is drawn from the same outlines, so it meets itself across plots' edges.
 */
export function surfaceOutlines(g: LandscapeGrid, surface: number | readonly number[]): Loop[] {
  const e = g.extent();
  const of = typeof surface === "number" ? [surface] : surface;
  const mask = (c: number, r: number) => {
    const i = g.index(e.col0 + c, e.row0 + r);
    return i !== -1 && of.includes(g.surface[i]);
  };
  return traceRegions(mask, e.col1 - e.col0, e.row1 - e.row0).map((l) => smoothLoop(l).map((p) => ({ x: p.x + e.col0, z: p.z + e.row0 })));
}

/**
 * The river's outline segments (square units, as x0, z0, x1, z1 in fours), bucketed for quick lookups: by row (each
 * segment in every row its z-span touches: a ray along x from a point meets only those of its row), and by square
 * (each in every square its box, padded by the grace, touches: any segment within the grace of a point is in its
 * square's list). Built once per map revision; `inRiver` is asked for every sample of every piece near water, on every
 * pointer move (it walked every point of every loop each time: a few tenths of a millisecond a call by a big river).
 */
interface RiverIndex {
  segs: Float64Array;
  rows: Map<number, number[]>;
  cells: Map<number, number[]>;
}
const riverIndexes = new WeakMap<LandscapeGrid, { revision: number; index: RiverIndex }>();
const cellKey = (c: number, r: number): number => c * 65536 + r;

function riverIndex(g: LandscapeGrid): RiverIndex {
  let cached = riverIndexes.get(g);
  if (!cached || cached.revision !== g.revision) {
    const loops = riverOutline(g).map((o) => o.loop);
    const n = loops.reduce((t, l) => t + l.length, 0);
    const segs = new Float64Array(4 * n);
    const rows = new Map<number, number[]>();
    const cells = new Map<number, number[]>();
    const pad = RIVER_GRACE / CELL;
    const add = (m: Map<number, number[]>, k: number, i: number) => {
      const list = m.get(k);
      if (list) list.push(i);
      else m.set(k, [i]);
    };
    let k = 0;
    for (const loop of loops) {
      for (let i = 0, j = loop.length - 1; i < loop.length; j = i++, k++) {
        const a = loop[i];
        const b = loop[j];
        segs[4 * k] = a.x;
        segs[4 * k + 1] = a.z;
        segs[4 * k + 2] = b.x;
        segs[4 * k + 3] = b.z;
        for (let r = Math.floor(Math.min(a.z, b.z)); r <= Math.floor(Math.max(a.z, b.z)); r++) add(rows, r, k);
        for (let c = Math.floor(Math.min(a.x, b.x) - pad); c <= Math.floor(Math.max(a.x, b.x) + pad); c++)
          for (let r = Math.floor(Math.min(a.z, b.z) - pad); r <= Math.floor(Math.max(a.z, b.z) + pad); r++) add(cells, cellKey(c, r), k);
      }
    }
    cached = { revision: g.revision, index: { segs, rows, cells } };
    riverIndexes.set(g, cached);
  }
  return cached.index;
}

/**
 * Is a point over the river as it's drawn (its felt has smoothed banks, inside or past its squares), more than
 * RIVER_GRACE in from the bank?
 */
export function inRiver(g: LandscapeGrid, x: number, z: number): boolean {
  // Only near river squares can the felt reach.
  const col = Math.floor(x / CELL);
  const row = Math.floor(z / CELL);
  let near = false;
  for (let dr = -1; dr <= 1 && !near; dr++) {
    for (let dc = -1; dc <= 1 && !near; dc++) {
      const i = g.index(col + dc, row + dr);
      near = i !== -1 && isWater(g.surface[i]);
    }
  }
  if (!near) return false;
  const u = x / CELL;
  const v = z / CELL;
  const { segs, rows, cells } = riverIndex(g);
  // Inside: a ray along +x crosses the outline an odd number of times (only segments of this row can cross it).
  let inside = false;
  for (const k of rows.get(Math.floor(v)) ?? []) {
    const ax = segs[4 * k];
    const az = segs[4 * k + 1];
    const bx = segs[4 * k + 2];
    const bz = segs[4 * k + 3];
    if (az > v !== bz > v && u < ((bx - ax) * (v - az)) / (bz - az) + ax) inside = !inside;
  }
  if (!inside) return false;
  // More than the grace in from the bank: no segment of the outline that near (only those listed for this square can be).
  const grace = RIVER_GRACE / CELL;
  for (const k of cells.get(cellKey(Math.floor(u), Math.floor(v))) ?? []) {
    const ax = segs[4 * k];
    const az = segs[4 * k + 1];
    const dx = segs[4 * k + 2] - ax;
    const dz = segs[4 * k + 3] - az;
    const t = Math.max(0, Math.min(1, ((u - ax) * dx + (v - az) * dz) / (dx * dx + dz * dz || 1)));
    if (Math.hypot(ax + dx * t - u, az + dz * t - v) <= grace) return false;
  }
  return true;
}


/** Can a piece be placed here? Called on every pointer move while dragging. */
/**
 * How many levels the ground under a piece rises above the track on it, at its highest (0 if it's nowhere higher): for
 * saying how to get up a hill the piece runs into.
 */
export function levelsAbove(land: Landscape, type: PieceTypeId, flipped: boolean, pose: Pose, y: number): number {
  const g = land.grid;
  let most = 0;
  forEachSample(type, flipped, pose, (x, z, trackY) => {
    const i = g.cellAtWorld(x, z);
    if (i !== -1) most = Math.max(most, Math.ceil((g.groundY(i) - (y + trackY)) / RISER_HEIGHT - 0.01));
    return true;
  });
  return most;
}

/** What to say when a hill is in the way: how far up it is, and how to climb it. */
export function hillMessage(levels: number): string {
  if (levels <= 1) return "The hill is a level up here: add a ramp before it";
  return `The hill is ${levels} levels up here: climb with ${levels === 2 ? "two" : levels} ramps in a row`;
}

export function checkPlacement(land: Landscape, type: PieceTypeId, flipped: boolean, pose: Pose, y: number): Clearance {
  const g = land.grid;
  const overRiver = isBridge(type);
  // A ramp may cut into hills up to the height of its top end (see `HillShape` cuttings).
  const cutTop = cutsHills(type) ? y + Math.max(...getPieceDef(type, flipped).connectors.map((c) => c.y)) : -Infinity;
  let result = CLEAR;
  forEachSample(type, flipped, pose, (x, z, trackY, heading) => {
    const i = g.cellAtWorld(x, z);
    if (i === -1) result = BLOCKED["off-mat"];
    else {
      const f = g.feature[i];
      const s = g.surface[i];
      if (f === FEAT_BUILDING) result = BLOCKED.building;
      else if (f === FEAT_FIELD) result = BLOCKED.field;
      else if (f === FEAT_DEPOT) {
        if (inDepotFootprint(land, g.owner[i], x, z)) result = BLOCKED.depot;
      } else if (f === FEAT_RUIN) {
        if (inRuinFootprint(land, g.owner[i], x, z)) result = BLOCKED.ruin;
      } else if (f === FEAT_SHED) result = BLOCKED.shed;
      else if (f === FEAT_STATION) {
        // Station squares are marked by their centres; only the real footprint (track + platform) blocks,
        // so pieces seated on a station end can overlap the edge of its end squares.
        if (inStationFootprint(land, g.owner[i], x, z)) result = BLOCKED.station;
      } else if (s === SURF_TOWN || s === SURF_ROAD) result = BLOCKED.town;
      else if (!overRiver && inRiver(g, x, z)) result = BLOCKED.river;
      else if (g.road[i] !== 0 && y + trackY <= g.groundY(i) + LEVEL && !crossesRoad(g.road[i], heading)) result = BLOCKED.road;
      else {
        // Below the ground here: a hill in the way, unless a ramp can cut its way in (no higher than its top end).
        const ground = hillsOf(g).groundAt(x, z);
        if (y + trackY < ground - 0.5 && ground > cutTop + 0.5) result = BLOCKED.hill;
      }
    }
    return result === CLEAR;
  });
  return result;
}

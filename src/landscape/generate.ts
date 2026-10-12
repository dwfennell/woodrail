import { rng } from "../lib/rng";
import type { Pose } from "../track";
import { BORDER_BAND, hashInts, regionStubs, STUB_DEPTH, type Region, type Stub } from "./edges";
import {
  CELL,
  FEAT_BUILDING,
  FEAT_DEPOT,
  FEAT_FIELD,
  FEAT_SHED,
  FEAT_NONE,
  FEAT_STATION,
  FEAT_TREE,
  gridWithPlots,
  LandscapeGrid,
  MAX_HEIGHT,
  PLOT_CELLS,
  PLOT_COLS,
  PLOT_ROWS,
  SURF_GRASS,
  SURF_LANE,
  SURF_RIVER,
  SURF_ROAD,
  SURF_TOWN,
  type PlotCoord,
} from "./grid";
import { valueNoise } from "./noise";

export type { Region } from "./edges";

export interface Building {
  id: number;
  cells: number[];
  floors: 1 | 2;
  kind: "house" | "shop";
  /** Roof colour palette index. */
  roof: number;
  /**
   * The way its front (door) faces, along a grid axis: toward the street its lot fronts. Without it the front faces the
   * town's centre.
   */
  front?: { x: -1 | 0 | 1; z: -1 | 0 | 1 };
}

export interface Town {
  id: number;
  name: string;
  centre: { x: number; z: number };
  /** Pose of the station piece's origin (its socket end). */
  station: Pose;
  /** Town area and station cells (flat, locked). */
  cells: number[];
  buildings: Building[];
}

export type DepotKind = "forest" | "sawmill";

/** A fixed goods depot: a 216 mm track piece through a yard, laid out like a station (yard on the +lateral side). */
export interface Depot {
  id: number;
  kind: DepotKind;
  /** Midpoint of the depot track (on a square centre). */
  centre: { x: number; z: number };
  /** Pose of the depot piece's origin (its socket end). */
  piece: Pose;
}

/** What a paddock holds: a kind of toy animal, or rows of crops with a scarecrow. */
export const FIELD_STOCK = ["cow", "sheep", "pig", "horse", "chicken", "crops"] as const;
export type FieldStock = (typeof FIELD_STOCK)[number];

/** A fenced 2 × 2-square paddock of toy animals (or crops). */
export interface Field {
  id: number;
  /** Its four squares, row-major from the top-left one. */
  cells: number[];
  animal: FieldStock;
}

/** The decorative engine shed: 2 × 2 squares near a town, its doors facing along `heading`. */
export interface Shed {
  cells: number[];
  x: number;
  z: number;
  heading: number;
}

/**
 * The land: its squares and what stands on them. Towns, depots and fields are listed by id (a town's id is its index
 * in `towns`, and so on); ids are world-wide, so they never change as the world grows.
 */
export interface Landscape {
  /** Seed for generating land not yet owned. */
  seed: number;
  starter: boolean;
  grid: LandscapeGrid;
  towns: Town[];
  /** Cells kept clear for track: station approaches (and the starter strip). */
  corridors: number[];
  fields: Field[];
  shed: Shed | null;
  depots: Depot[];
  /** The id the next building gets. */
  nextBuildingId: number;
}

export const STATION_LENGTH = 216;
const HALF_STATION = STATION_LENGTH / 2;
const MIN_TOWN_SPACING = 900;
/** Depots keep this far from towns and other depots (they have no town area of their own). */
const DEPOT_SPACING = 750;
const TOWN_RADIUS = 210;
const CORRIDOR_LENGTH = 6 * CELL;
const CORRIDOR_HALF_WIDTH = 2 * CELL;

/** Chance that a town has a country lane. */
const LANE_CHANCE = 0.8;
const NAMES = [
  "Applebury", "Millbrook", "Oakhollow", "Pinecrest", "Thimble Cross", "Larkfield", "Brambleton", "Copperdale",
  "Willowmere", "Fernhill", "Hazelwick", "Puddleby", "Kettle Green", "Foxley", "Tumbledown", "Ashcombe",
  "Buttercombe", "Clatterford", "Dimbleby", "Elderwick", "Gorsemoor", "Honeystead", "Inkpen", "Juniper Hey",
  "Marbleford", "Nettlecombe", "Otterbrook", "Quillsby", "Rookhurst", "Sorrelby", "Teasel End", "Wobbleton",
];
const NAME_PREFIXES = ["Little", "Upper", "Lower", "Great", "East", "West", "North", "South", "Old", "New"];

/** The plots a new game starts with: 2 × 2, centred on the world's origin. */
export const START_REGION: Region = { px0: -1, pz0: -1, w: 2, h: 2 };

/** The two outward ends of a town's station: socket end and peg end, each heading away from the station. */
export function stationEnds(town: Town): [Pose, Pose] {
  return pieceEnds(town.station);
}

/** The two outward ends of a fixed 216 mm piece (station or depot) at pose `s`. */
export function pieceEnds(s: Pose): [Pose, Pose] {
  return [
    { x: s.x, z: s.z, heading: s.heading + Math.PI },
    { x: s.x + Math.cos(s.heading) * STATION_LENGTH, z: s.z + Math.sin(s.heading) * STATION_LENGTH, heading: s.heading },
  ];
}

export function corridorCells(land: Landscape): number[] {
  return land.corridors;
}

/** The world a new game starts with: the start region, generated deterministically from a seed. */
export function generateLandscape(seed: number, options: { starter?: boolean } = {}): Landscape {
  return generateRegion(seed, START_REGION, { starter: options.starter ?? false, shed: true });
}

/** One plot of land, as it would be if added to a world with this seed (ids from 0: see `adoptRegion`). */
export function generatePlot(seed: number, px: number, pz: number): Landscape {
  return generateRegion(seed, { px0: px, pz0: pz, w: 1, h: 1 }, { starter: false, shed: false });
}

/**
 * A rectangle of plots, deterministically from the seed and where it is (retrying internally until every town and
 * depot is reachable from the others and from the region's edge). Its edges meet the land either side: see `edges.ts`.
 */
export function generateRegion(seed: number, region: Region, options: { starter: boolean; shed: boolean }): Landscape {
  let last: Landscape | null = null;
  for (let attempt = 0; attempt < 20; attempt++) {
    const land = attemptRegion(seed, region, options.starter, attempt);
    if (reachable(land)) {
      if (options.shed) addShed(land);
      addFields(land, region);
      return land;
    }
    last = land;
  }
  return last!;
}

/** Shared noise tables per seed (building one is slow-ish). */
const noiseCache = new Map<number, (x: number, y: number) => number>();
function noise(seed: number): (x: number, y: number) => number {
  let n = noiseCache.get(seed);
  if (!n) {
    if (noiseCache.size > 16) noiseCache.clear();
    noiseCache.set(seed, (n = valueNoise(seed)));
  }
  return n;
}

/** The hills as the noise has them, before anything flattens them (whole blocks). The same everywhere for a seed. */
function rawHeight(seed: number, col: number, row: number): number {
  const hill = noise(seed * 7 + 1);
  const n = hill(col / 8, row / 8) * 0.7 + hill(col / 3.5 + 17, row / 3.5 + 5) * 0.3;
  return Math.max(0, Math.min(MAX_HEIGHT, Math.floor((n - 0.42) * 7)));
}

/** Is a tree's noise high enough here for a clump (and a coin toss per square)? The same everywhere for a seed. */
function treeHere(seed: number, col: number, row: number): boolean {
  const tree = noise(seed * 13 + 5);
  return tree(col / 5, row / 5) > 0.62 && hashInts(seed, col, row, 0x7ee) / 4294967296 < 0.55;
}


function attemptRegion(seed: number, region: Region, starter: boolean, attempt: number): Landscape {
  const local = hashInts(seed, region.px0, region.pz0, region.w, region.h) + attempt * 1000;
  const random = rng(local);
  const grid = gridWithPlots(region.px0, region.pz0, region.w, region.h);
  const col0 = region.px0 * PLOT_COLS;
  const row0 = region.pz0 * PLOT_ROWS;
  const col1 = col0 + region.w * PLOT_COLS;
  const row1 = row0 + region.h * PLOT_ROWS;
  /** Squares far enough from the region's edge to hold anything that flattens hills. */
  const interior = (col: number, row: number) => col >= col0 + BORDER_BAND && col < col1 - BORDER_BAND && row >= row0 + BORDER_BAND && row < row1 - BORDER_BAND;
  /** Squares for towns and depots: clear of the crossings' stubs too, with a square to spare. */
  const SITE_BAND = STUB_DEPTH + 1;
  const siteRoom = (col: number, row: number) => col >= col0 + SITE_BAND && col < col1 - SITE_BAND && row >= row0 + SITE_BAND && row < row1 - SITE_BAND;
  const area = region.w * region.h;

  const towns = placeTowns(random, region, starter, siteRoom, area);
  const depots = placeDepots(local, seed, towns, region, starter, siteRoom, area);
  const protectedCells = new Set<number>();

  // Depots: track and yard squares, and their approach corridors, measured like stations.
  for (const depot of depots) {
    const fp = footprint(depot.centre, depot.piece.heading);
    for (const [col, row] of fp.station) {
      const i = grid.index(col, row);
      grid.feature[i] = FEAT_DEPOT;
      grid.owner[i] = depot.id;
    }
    for (const [col, row] of fp.corridor) protectedCells.add(grid.index(col, row));
  }

  // Stations, platforms, corridors and town areas, measured from each station line (works for any heading).
  for (const town of towns) {
    const fp = footprint(town.centre, town.station.heading);
    const cells = new Set<number>();
    for (const [col, row] of fp.station) {
      const i = grid.index(col, row);
      grid.feature[i] = FEAT_STATION;
      grid.owner[i] = town.id;
      grid.surface[i] = SURF_TOWN;
      cells.add(i);
    }
    for (const [col, row] of fp.corridor) {
      const i = grid.index(col, row);
      if (grid.feature[i] === FEAT_NONE) protectedCells.add(i);
    }
    for (const [col, row] of fp.area) {
      const i = grid.index(col, row);
      if (grid.feature[i] === FEAT_NONE && !protectedCells.has(i)) {
        grid.surface[i] = SURF_TOWN;
        cells.add(i);
      }
    }
    town.cells = [...cells];
  }
  // A town's area must not swallow another town's corridor.
  for (const i of protectedCells) {
    if (grid.feature[i] === FEAT_NONE) grid.surface[i] = SURF_GRASS;
  }
  for (const town of towns) town.cells = town.cells.filter((i) => !protectedCells.has(i) || grid.feature[i] === FEAT_STATION);

  if (starter) {
    const [a, b] = towns;
    grid.forEachCell((i, col, row) => {
      const x = grid.centreX(col);
      const z = grid.centreZ(row);
      if (x > a.centre.x + HALF_STATION - 32 && x < b.centre.x - HALF_STATION + 32 && Math.abs(z - a.centre.z) < CORRIDOR_HALF_WIDTH) {
        if (grid.feature[i] === FEAT_NONE) {
          protectedCells.add(i);
          grid.surface[i] = SURF_GRASS;
        }
      }
    });
  }

  const locked = (i: number) =>
    protectedCells.has(i) || grid.surface[i] === SURF_TOWN || grid.feature[i] === FEAT_STATION || grid.feature[i] === FEAT_DEPOT;

  // Rivers and lanes: crossing the region's edges where the edge contracts say, joined up inside.
  const stubs = regionStubs(seed, region);
  for (const stub of stubs.inside) {
    for (const [col, row] of stub.cells) {
      const i = grid.index(col, row);
      grid.surface[i] = stub.kind === "river" ? SURF_RIVER : SURF_LANE;
    }
  }
  const rivers = stubs.inside.filter((s) => s.kind === "river");
  joinRivers(grid, rivers, region, random, local, interior, locked);
  joinLanes(grid, stubs.inside.filter((s) => s.kind === "lane"), towns, random, region, interior, seed);

  // Hills: the noise's heights, flattened down to the felt by towns, depots, rivers and lanes (here and across the
  // region's edges) so no square is more than one block above a neighbour.
  settleHeights(grid, seed, region, stubs.outside, locked);

  // Buildings in each town; leftover town squares become road felt.
  let buildingId = 0;
  for (const town of towns) {
    const free = town.cells.filter((i) => grid.feature[i] === FEAT_NONE);
    const count = 4 + Math.floor(random() * 5);
    for (let k = 0; k < count && free.length > 0; k++) {
      const pickIndex = Math.floor(random() * free.length);
      const first = free[pickIndex];
      if (grid.feature[first] !== FEAT_NONE) continue;
      const cells = [first];
      if (random() < 0.4) {
        const neighbour = grid.index(grid.colOf(first) + 1, grid.rowOf(first));
        if (neighbour !== -1 && grid.surface[neighbour] === SURF_TOWN && grid.feature[neighbour] === FEAT_NONE) cells.push(neighbour);
      }
      const b: Building = {
        id: buildingId++,
        cells,
        floors: random() < 0.35 ? 2 : 1,
        kind: random() < 0.3 ? "shop" : "house",
        roof: Math.floor(random() * 4),
      };
      for (const c of cells) {
        grid.feature[c] = FEAT_BUILDING;
        grid.owner[c] = b.id;
      }
      town.buildings.push(b);
    }
    for (const i of town.cells) if (grid.feature[i] === FEAT_NONE) grid.surface[i] = SURF_ROAD;
  }

  // Trees in clumps on open grass (where the noise says, the same either side of a plot's edge).
  grid.forEachCell((i, col, row) => {
    if (locked(i) || grid.surface[i] !== SURF_GRASS || grid.feature[i] !== FEAT_NONE) return;
    if (treeHere(seed, col, row)) grid.feature[i] = FEAT_TREE;
  });

  return { seed, starter, grid, towns, corridors: [...protectedCells].filter((i) => grid.feature[i] === FEAT_NONE), fields: [], shed: null, depots, nextBuildingId: buildingId };
}

/** A station's or depot's squares (track and platform or yard), its approach corridors, and its town's area. */
function footprint(centre: { x: number; z: number }, heading: number): { station: [number, number][]; corridor: [number, number][]; area: [number, number][] } {
  const dx = Math.cos(heading);
  const dz = Math.sin(heading);
  const station: [number, number][] = [];
  const corridor: [number, number][] = [];
  const area: [number, number][] = [];
  const reach = Math.ceil((HALF_STATION + CORRIDOR_LENGTH) / CELL) + 1;
  const cc = Math.floor(centre.x / CELL);
  const cr = Math.floor(centre.z / CELL);
  for (let row = cr - reach; row <= cr + reach; row++) {
    for (let col = cc - reach; col <= cc + reach; col++) {
      const px = (col + 0.5) * CELL - centre.x;
      const pz = (row + 0.5) * CELL - centre.z;
      const d = px * dx + pz * dz;
      const l = -px * dz + pz * dx;
      const ad = Math.abs(d);
      if ((ad < HALF_STATION && Math.abs(l) < 26) || (ad < HALF_STATION - 8 && l >= 26 && l < 120)) station.push([col, row]);
      else if (ad >= HALF_STATION - 32 && ad < HALF_STATION + CORRIDOR_LENGTH && Math.abs(l) < CORRIDOR_HALF_WIDTH) corridor.push([col, row]);
      else if (Math.hypot(px, pz) < TOWN_RADIUS) area.push([col, row]);
    }
  }
  return { station, corridor, area };
}

/** Does a station or depot here fit in the region, clear of its edge band? */
function fits(centre: { x: number; z: number }, heading: number, interior: (col: number, row: number) => boolean, town: boolean): boolean {
  // Its corridors reach this far along the station; the town (or yard and corridors) this far across: a quick look at
  // the corners of that rectangle first.
  const along = HALF_STATION + CORRIDOR_LENGTH;
  const across = town ? TOWN_RADIUS : CORRIDOR_HALF_WIDTH;
  const ax = Math.abs(Math.cos(heading)) > 0.5;
  const hx = ax ? along : across;
  const hz = ax ? across : along;
  for (const [x, z] of [[centre.x - hx, centre.z - hz], [centre.x + hx, centre.z + hz]]) {
    if (!interior(Math.floor(x / CELL), Math.floor(z / CELL))) return false;
  }
  const fp = footprint(centre, heading);
  const cells = town ? [...fp.station, ...fp.corridor, ...fp.area] : [...fp.station, ...fp.corridor];
  return cells.every(([c, r]) => interior(c, r));
}

/** A station's or depot's midpoint lies on a square's centre: the track runs down the middle of a row or column. */
const snap = (v: number) => (Math.floor(v / CELL) + 0.5) * CELL;

function placeTowns(random: () => number, region: Region, starter: boolean, interior: (col: number, row: number) => boolean, area: number): Town[] {
  const pick = random();
  // A single plot is usually one town, sometimes two, sometimes none (it has a depot instead: see `placeDepots`).
  const count = starter ? 5 : area === 1 ? (pick < 0.32 ? 0 : pick < 0.9 ? 1 : 2) : Math.round(((5 + Math.floor(random() * 3)) * area) / 4);
  const names = [...NAMES];
  for (let i = names.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [names[i], names[j]] = [names[j], names[i]];
  }
  const towns: Town[] = [];
  const make = (x: number, z: number, heading: number): Town => ({
    id: towns.length,
    name: names[towns.length % names.length],
    centre: { x, z },
    station: { x: x - Math.cos(heading) * HALF_STATION, z: z - Math.sin(heading) * HALF_STATION, heading },
    cells: [],
    buildings: [],
  });
  if (starter) {
    const z = snap(-200 + random() * 300);
    towns.push(make(-540, z, 0));
    towns.push(make(540, z, 0));
  }
  const x0 = region.px0 * PLOT_COLS * CELL;
  const z0 = region.pz0 * PLOT_ROWS * CELL;
  const w = region.w * PLOT_COLS * CELL;
  const d = region.h * PLOT_ROWS * CELL;
  let guard = 0;
  while (towns.length < count && guard++ < 3000) {
    const x = snap(x0 + random() * w);
    const z = snap(z0 + random() * d);
    const heading = normaliseHeading(Math.floor(random() * 4) * (Math.PI / 2));
    if (towns.some((t) => Math.hypot(t.centre.x - x, t.centre.z - z) < MIN_TOWN_SPACING)) continue;
    if (!fits({ x, z }, heading, interior, true)) continue;
    towns.push(make(x, z, heading));
  }
  return towns;
}

/**
 * Forest yards and a sawmill (their own random stream, so towns are unchanged by them). Each sits at least
 * `DEPOT_SPACING` from every town and other depot, snapped like a station. Forests take the candidate deepest in
 * the trees (the tree noise); the sawmill the candidate nearest the middle of the towns. On the starter map the
 * sawmill goes near the first town and the forest near the second, so the first timber loop is close at hand. A
 * single plot without a town has one of either.
 */
function placeDepots(local: number, seed: number, towns: readonly Town[], region: Region, starter: boolean, interior: (col: number, row: number) => boolean, area: number): Depot[] {
  const random = rng(local * 47 + 5);
  const treeNoise = noise(seed * 13 + 5);
  const depots: Depot[] = [];
  const taken = () => [...towns.map((t) => t.centre), ...depots.map((d) => d.centre)];
  const x0 = region.px0 * PLOT_COLS * CELL;
  const z0 = region.pz0 * PLOT_ROWS * CELL;
  const w = region.w * PLOT_COLS * CELL;
  const d = region.h * PLOT_ROWS * CELL;
  const candidates = (): { x: number; z: number; heading: number }[] => {
    const out: { x: number; z: number; heading: number }[] = [];
    for (let guard = 0; guard < 2000 && out.length < 16; guard++) {
      const x = snap(x0 + random() * w);
      const z = snap(z0 + random() * d);
      const heading = normaliseHeading(Math.floor(random() * 4) * (Math.PI / 2));
      if (taken().some((c) => Math.hypot(c.x - x, c.z - z) < DEPOT_SPACING)) continue;
      if (!fits({ x, z }, heading, interior, false)) continue;
      out.push({ x, z, heading });
    }
    return out;
  };
  const add = (kind: DepotKind, score: (c: { x: number; z: number }) => number) => {
    const list = candidates();
    if (list.length === 0) return;
    let best = list[0];
    for (const c of list) if (score(c) < score(best)) best = c;
    const { x, z, heading } = best;
    depots.push({
      id: depots.length,
      kind,
      centre: { x, z },
      piece: { x: x - Math.cos(heading) * HALF_STATION, z: z - Math.sin(heading) * HALF_STATION, heading },
    });
  };
  const near = (p: { x: number; z: number }) => (c: { x: number; z: number }) => Math.hypot(c.x - p.x, c.z - p.z);
  const inTrees = (c: { x: number; z: number }) => -treeNoise(c.x / CELL / 5, c.z / CELL / 5);
  if (starter) {
    add("sawmill", near(towns[0].centre));
    add("forest", near(towns[1].centre));
    return depots;
  }
  const mid =
    towns.length > 0
      ? { x: towns.reduce((a, t) => a + t.centre.x, 0) / towns.length, z: towns.reduce((a, t) => a + t.centre.z, 0) / towns.length }
      : { x: x0 + w / 2, z: z0 + d / 2 };
  if (area === 1) {
    // A plot without a town always has a depot; one with a town sometimes squeezes a forest yard in.
    if (towns.length === 0) {
      if (random() < 0.62) add("forest", inTrees);
      else add("sawmill", near(mid));
    } else if (random() < 0.4) add("forest", inTrees);
    return depots;
  }
  add("sawmill", near(mid));
  const forests = random() < 0.5 ? 1 : 2;
  for (let k = 0; k < forests; k++) add("forest", inTrees);
  return depots;
}

/** Cheapest 4-connected path from any `from` square to any square `isGoal` accepts (indices), or null. */
function cheapestPath(
  grid: LandscapeGrid,
  from: readonly number[],
  isGoal: (i: number) => boolean,
  stepCost: (i: number, turned: boolean) => number,
): number[] | null {
  const n = grid.cellCount;
  const cost = new Float64Array(n * 4).fill(Infinity);
  const prev = new Int32Array(n * 4).fill(-1);
  const near = grid.neighbours();
  const heap = new MinHeap();
  for (const i of from) {
    for (let d = 0; d < 4; d++) {
      cost[i * 4 + d] = 0;
      heap.push(0, i * 4 + d);
    }
  }
  while (heap.size > 0) {
    const [c0, state] = heap.pop();
    if (c0 > cost[state]) continue;
    const cell = state >> 2;
    const dir = state & 3;
    if (isGoal(cell) && !from.includes(cell)) {
      const path: number[] = [];
      for (let st = state; st !== -1; st = prev[st]) path.push(st >> 2);
      return path.reverse();
    }
    for (let d = 0; d < 4; d++) {
      if (d === ((dir + 2) & 3)) continue;
      const ni = near[cell * 4 + d];
      if (ni === -1) continue;
      const step = stepCost(ni, d !== dir);
      if (!Number.isFinite(step)) continue;
      const next = ni * 4 + d;
      const total = c0 + step;
      if (total >= cost[next]) continue;
      cost[next] = total;
      prev[next] = state;
      heap.push(total, next);
    }
  }
  return null;
}

/** A binary min-heap of (cost, value) pairs. */
class MinHeap {
  private keys: number[] = [];
  private vals: number[] = [];
  get size(): number {
    return this.keys.length;
  }
  push(k: number, v: number): void {
    const { keys, vals } = this;
    let i = keys.length;
    keys.push(k);
    vals.push(v);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (keys[p] <= k) break;
      keys[i] = keys[p];
      vals[i] = vals[p];
      i = p;
    }
    keys[i] = k;
    vals[i] = v;
  }
  pop(): [number, number] {
    const { keys, vals } = this;
    const top: [number, number] = [keys[0], vals[0]];
    const k = keys.pop()!;
    const v = vals.pop()!;
    const n = keys.length;
    if (n > 0) {
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        if (l >= n) break;
        const r = l + 1;
        const c = r < n && keys[r] < keys[l] ? r : l;
        if (keys[c] >= k) break;
        keys[i] = keys[c];
        vals[i] = vals[c];
        i = c;
      }
      keys[i] = k;
      vals[i] = v;
    }
    return top;
  }
}

/** Extra cost for running a river or lane this near the region's edge (none from 8 squares in). */
function edgeCost(region: Region, col: number, row: number): number {
  const d = Math.min(
    col - region.px0 * PLOT_COLS,
    row - region.pz0 * PLOT_ROWS,
    (region.px0 + region.w) * PLOT_COLS - 1 - col,
    (region.pz0 + region.h) * PLOT_ROWS - 1 - row,
  );
  return d >= 8 ? 0 : (8 - d) * 1.5;
}

/** The square at the inner end of a stub. */
const innerEnd = (grid: LandscapeGrid, s: Stub): number => {
  const [col, row] = s.cells[s.cells.length - 1];
  return grid.index(col, row);
};

/**
 * Rivers inside the region: the crossings on its edges joined up, round towns and depots, meandering with the noise.
 * Two crossings make one river across; any more join it as tributaries; one alone ends in a pond.
 */
function joinRivers(
  grid: LandscapeGrid,
  stubs: readonly Stub[],
  region: Region,
  random: () => number,
  local: number,
  interior: (col: number, row: number) => boolean,
  locked: (i: number) => boolean,
): void {
  if (stubs.length === 0) return;
  const meander = noise(local * 3 + 11);
  // Around the region's middle, so pairs cross it.
  const mx = (region.px0 + region.w / 2) * PLOT_COLS;
  const mz = (region.pz0 + region.h / 2) * PLOT_ROWS;
  const ordered = [...stubs].sort((a, b) => Math.atan2(a.cells[0][1] - mz, a.cells[0][0] - mx) - Math.atan2(b.cells[0][1] - mz, b.cells[0][0] - mx));
  const river = (i: number) => grid.surface[i] === SURF_RIVER;
  // Each square's cost, worked out once: broad bends from the noise, a little jitter square by square so no run stays
  // dead straight, and dearer near the region's edge, so rivers keep to the middle rather than run along it.
  const base = new Float32Array(grid.cellCount);
  grid.forEachCell((i, col, row) => {
    base[i] = locked(i) || !interior(col, row) ? Infinity : 1 + 6 * meander(col / 5, row / 5) + 1.6 * (hashInts(local, col, row) / 4294967296) + edgeCost(region, col, row);
  });
  const cost = (i: number, turned: boolean) => {
    if (base[i] === Infinity) return Infinity;
    if (river(i)) return 0.6;
    return base[i] + (turned ? 0.2 : 0);
  };
  const lay = (path: number[] | null) => {
    if (!path) return false;
    for (const i of path) grid.surface[i] = SURF_RIVER;
    return true;
  };
  const pond = (s: Stub) => {
    // A little pond just in from the crossing.
    const [ca, ra] = s.cells[s.cells.length - 2];
    const [cb, rb] = s.cells[s.cells.length - 1];
    const dc = cb - ca;
    const dr = rb - ra;
    const cc = cb + dc * 2;
    const cr = rb + dr * 2;
    for (let r = cr - 1; r <= cr + 1; r++) {
      for (let c = cc - 1; c <= cc + 1; c++) {
        const i = grid.index(c, r);
        if (i !== -1 && interior(c, r) && !locked(i) && random() < 0.85) grid.surface[i] = SURF_RIVER;
      }
    }
    for (let k = 1; k <= 2; k++) {
      const i = grid.index(cb + dc * k, rb + dr * k);
      if (i !== -1 && interior(cb + dc * k, rb + dr * k) && !locked(i)) grid.surface[i] = SURF_RIVER;
    }
  };
  if (ordered.length === 1) {
    pond(ordered[0]);
    return;
  }
  const first = ordered[0];
  const second = ordered[Math.floor(ordered.length / 2)];
  const target = innerEnd(grid, second);
  // By way of somewhere near the middle, so the river crosses the region even between crossings on one edge.
  const col0 = region.px0 * PLOT_COLS;
  const row0 = region.pz0 * PLOT_ROWS;
  const cols = region.w * PLOT_COLS;
  const rows = region.h * PLOT_ROWS;
  let via = -1;
  for (let tries = 0; tries < 20 && via === -1; tries++) {
    const c = col0 + Math.floor(cols * (0.3 + 0.4 * random()));
    const r = row0 + Math.floor(rows * (0.3 + 0.4 * random()));
    const i = grid.index(c, r);
    if (Number.isFinite(base[i])) via = i;
  }
  const leg1 = via === -1 ? null : cheapestPath(grid, [innerEnd(grid, first)], (i) => i === via, cost);
  const leg2 = leg1 ? cheapestPath(grid, [via], (i) => i === target, cost) : null;
  const main = leg1 && leg2 ? [...leg1, ...leg2] : cheapestPath(grid, [innerEnd(grid, first)], (i) => i === target, cost);
  if (!lay(main)) {
    pond(first);
    pond(second);
  }
  for (const s of ordered) {
    if (s === first || s === second) continue;
    const start = innerEnd(grid, s);
    const ownCells = new Set(s.cells.map(([c, r]) => grid.index(c, r)));
    const joined = cheapestPath(grid, [start], (i) => river(i) && !ownCells.has(i), cost);
    if (!lay(joined)) pond(s);
  }
}

/**
 * Country lanes: from towns (most of them) and the lanes crossing the region's edges, joined up into a network over
 * open grass (never across a river or through a town). Each joins the nearest lane already laid; the first stands
 * alone. Cheapest routes: every square costs 1, a turn 4, and climbing (the lane flattens hills it crosses) 2 a block.
 */
function joinLanes(
  grid: LandscapeGrid,
  stubs: readonly Stub[],
  towns: readonly Town[],
  random: () => number,
  region: Region,
  interior: (col: number, row: number) => boolean,
  seed: number,
): void {
  const ends: { start: number; own: number[] }[] = [];
  for (const town of towns) {
    if (random() >= LANE_CHANCE) continue;
    // Leave the town straight out from its centre, on its platform side.
    const dx = Math.cos(town.station.heading);
    const dz = Math.sin(town.station.heading);
    const dc = Math.round(-dz);
    const dr = Math.round(dx);
    let col = Math.floor(town.centre.x / CELL);
    let row = Math.floor(town.centre.z / CELL);
    // (Through the town only: never on over a river beside it.)
    for (let k = 0; k < 12 && grid.inBounds(col, row) && grid.surface[grid.index(col, row)] === SURF_TOWN; k++) {
      col += dc;
      row += dr;
    }
    const i = grid.index(col, row);
    if (i === -1 || !interior(col, row) || grid.feature[i] !== FEAT_NONE || grid.surface[i] !== SURF_GRASS) continue;
    ends.push({ start: i, own: [i] });
  }
  for (const s of stubs) ends.push({ start: innerEnd(grid, s), own: s.cells.map(([c, r]) => grid.index(c, r)) });
  if (ends.length === 0) return;
  const lane = new Set<number>();
  const treeCost = 2.5 + random();
  // Each square's cost, worked out once (the lane network grows, but the ground doesn't change).
  const base = new Float32Array(grid.cellCount);
  grid.forEachCell((i, col, row) => {
    base[i] =
      !interior(col, row) || grid.surface[i] !== SURF_GRASS || grid.feature[i] !== FEAT_NONE
        ? Infinity
        : 1 + 2 * rawHeight(seed, col, row) + (treeHere(seed, col, row) ? treeCost : 0) + edgeCost(region, col, row);
  });
  const cost = (i: number, turned: boolean) => {
    if (lane.has(i)) return 1;
    return base[i] + (turned ? 4 : 0);
  };
  // A lone town has nowhere to go: lanes only from towns when something else has one.
  if (ends.length === 1 && stubs.length === 0) return;
  for (const end of ends) {
    if (lane.size > 0) {
      const own = new Set(end.own);
      const path = cheapestPath(grid, [end.start], (i) => lane.has(i) && !own.has(i), cost);
      if (path) for (const i of path) lane.add(i);
    }
    for (const i of end.own) lane.add(i);
  }
  for (const i of lane) {
    grid.surface[i] = SURF_LANE;
    grid.feature[i] = FEAT_NONE;
  }
}

/**
 * Final hill heights: each square as low as the noise's height there, and no more than one block above any square
 * within reach — towns, depots, rivers and lanes count as flat ground, here and in the neighbouring plots' crossings.
 * Worked out from the squares within `MAX_HEIGHT` alone, so plots either side of an edge agree on it.
 */
function settleHeights(grid: LandscapeGrid, seed: number, region: Region, outside: readonly Stub[], locked: (i: number) => boolean): void {
  const pad = MAX_HEIGHT;
  const col0 = region.px0 * PLOT_COLS - pad;
  const row0 = region.pz0 * PLOT_ROWS - pad;
  const w = region.w * PLOT_COLS + 2 * pad;
  const d = region.h * PLOT_ROWS + 2 * pad;
  const base = new Uint8Array(w * d);
  const flatOutside = new Set<number>();
  for (const s of outside) for (const [c, r] of s.cells) flatOutside.add((r - row0) * w + (c - col0));
  for (let r = 0; r < d; r++) {
    for (let c = 0; c < w; c++) {
      const col = col0 + c;
      const row = row0 + r;
      const k = r * w + c;
      const i = grid.index(col, row);
      let flat: boolean;
      if (i === -1) flat = flatOutside.has(k);
      else flat = locked(i) || grid.surface[i] !== SURF_GRASS;
      base[k] = flat ? 0 : rawHeight(seed, col, row);
    }
  }
  // MAX_HEIGHT passes of "no more than one above a neighbour": exactly the lowest of (height + distance) within reach.
  const next = new Uint8Array(base);
  for (let pass = 0; pass < pad; pass++) {
    for (let r = 0; r < d; r++) {
      for (let c = 0; c < w; c++) {
        const k = r * w + c;
        let m = base[k];
        if (c > 0) m = Math.min(m, base[k - 1] + 1);
        if (c + 1 < w) m = Math.min(m, base[k + 1] + 1);
        if (r > 0) m = Math.min(m, base[k - w] + 1);
        if (r + 1 < d) m = Math.min(m, base[k + w] + 1);
        next[k] = m;
      }
    }
    base.set(next);
  }
  grid.forEachCell((i, col, row) => {
    grid.height[i] = base[(row - row0) * w + (col - col0)];
  });
}

/**
 * The engine shed: a 2 × 2 block of open grass a few squares from the first town that has room (its own random
 * stream), its doors facing the same way as that town's station. Kept only if every town can still reach every other.
 */
function addShed(land: Landscape): void {
  const g = land.grid;
  const random = rng(land.seed * 43 + 9);
  const corridors = new Set(land.corridors);
  const open = (col: number, row: number, h: number) => {
    const i = g.index(col, row);
    return i !== -1 && g.height[i] === h && g.surface[i] === SURF_GRASS && g.feature[i] === FEAT_NONE && !corridors.has(i);
  };
  const clearAround = (col: number, row: number) => {
    const i = g.index(col, row);
    return i !== -1 && g.feature[i] !== FEAT_BUILDING && g.feature[i] !== FEAT_STATION && g.surface[i] !== SURF_RIVER;
  };
  for (const town of land.towns) {
    const tcol = Math.floor(town.centre.x / CELL);
    const trow = Math.floor(town.centre.z / CELL);
    for (let tries = 0; tries < 120; tries++) {
      const col = tcol + Math.round((random() * 2 - 1) * 7);
      const row = trow + Math.round((random() * 2 - 1) * 7);
      if (!g.inBounds(col, row)) continue;
      const h = g.height[g.index(col, row)];
      let ok = true;
      for (let r = -1; r <= 2 && ok; r++) {
        for (let c = -1; c <= 2 && ok; c++) {
          ok = r >= 0 && r <= 1 && c >= 0 && c <= 1 ? open(col + c, row + r, h) : clearAround(col + c, row + r);
        }
      }
      if (!ok) continue;
      const cells = [g.index(col, row), g.index(col + 1, row), g.index(col, row + 1), g.index(col + 1, row + 1)];
      for (const i of cells) g.feature[i] = FEAT_SHED;
      if (!reachable(land)) {
        for (const i of cells) g.feature[i] = FEAT_NONE;
        continue;
      }
      land.shed = { cells, x: g.centreX(col) + CELL / 2, z: g.centreZ(row) + CELL / 2, heading: town.station.heading };
      return;
    }
  }
}

/**
 * A few fenced paddocks of animals on open grass, away from towns, lanes, rivers and station approaches (their own
 * random stream), clear of the region's edge. Each is kept only if every town can still reach every other.
 */
function addFields(land: Landscape, region: Region): void {
  const g = land.grid;
  const random = rng(hashInts(land.seed, region.px0, region.pz0, 37));
  const corridors = new Set(land.corridors);
  const area = region.w * region.h;
  const count = area === 1 ? (random() < 0.45 ? 1 : 0) : 1 + Math.floor(random() * 3);
  const open = (col: number, row: number, h: number) => {
    const i = g.index(col, row);
    return i !== -1 && g.height[i] === h && g.surface[i] === SURF_GRASS && g.feature[i] === FEAT_NONE && !corridors.has(i);
  };
  // Anything but plain felt, trees and other open grass nearby keeps a paddock away.
  const quiet = (col: number, row: number) => {
    const i = g.index(col, row);
    return i !== -1 && g.surface[i] === SURF_GRASS && (g.feature[i] === FEAT_NONE || g.feature[i] === FEAT_TREE);
  };
  const cols = region.w * PLOT_COLS;
  const rows = region.h * PLOT_ROWS;
  for (let tries = 0; tries < 300 && land.fields.length < count; tries++) {
    const col = region.px0 * PLOT_COLS + STUB_DEPTH + Math.floor(random() * (cols - 2 * STUB_DEPTH - 1));
    const row = region.pz0 * PLOT_ROWS + STUB_DEPTH + Math.floor(random() * (rows - 2 * STUB_DEPTH - 1));
    const animal = FIELD_STOCK[Math.floor(random() * FIELD_STOCK.length)];
    const h = g.height[g.index(col, row)];
    let ok = true;
    for (let r = -1; r <= 2 && ok; r++) {
      for (let c = -1; c <= 2 && ok; c++) {
        const inside = r >= 0 && r <= 1 && c >= 0 && c <= 1;
        ok = inside ? open(col + c, row + r, h) : quiet(col + c, row + r);
      }
    }
    if (!ok) continue;
    const cells = [g.index(col, row), g.index(col + 1, row), g.index(col, row + 1), g.index(col + 1, row + 1)];
    const id = land.fields.length;
    for (const i of cells) {
      g.feature[i] = FEAT_FIELD;
      g.owner[i] = id;
    }
    if (!reachable(land)) {
      for (const i of cells) {
        g.feature[i] = FEAT_NONE;
        g.owner[i] = -1;
      }
      continue;
    }
    land.fields.push({ id, cells, animal });
  }
}

function normaliseHeading(h: number): number {
  const step = Math.PI / 4;
  const k = ((Math.round(h / step) % 8) + 8) % 8;
  return (k > 4 ? k - 8 : k) * step;
}

/**
 * Can track (in principle) be laid between every pair of towns and depots, and from them out to the edge of the land
 * (where it can go on into land added later)? BFS over open squares from each site's corridors.
 */
export function reachable(land: Landscape): boolean {
  const g = land.grid;
  const component = new Int32Array(g.cellCount).fill(-1);
  const passable = (i: number) => g.feature[i] === FEAT_NONE && (g.surface[i] === SURF_GRASS || g.surface[i] === SURF_RIVER || g.surface[i] === SURF_LANE);
  const atEdge: boolean[] = [];
  let next = 0;
  const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  for (let i = 0; i < component.length; i++) {
    if (component[i] !== -1 || !passable(i)) continue;
    const queue = [i];
    component[i] = next;
    let edge = false;
    while (queue.length) {
      const c = queue.pop()!;
      const col = g.colOf(c);
      const row = g.rowOf(c);
      for (const [dc, dr] of DIRS) {
        const n = g.index(col + dc, row + dr);
        if (n === -1) {
          edge = true;
          continue;
        }
        if (component[n] !== -1 || !passable(n) || Math.abs(g.height[n] - g.height[c]) > 1) continue;
        component[n] = next;
        queue.push(n);
      }
    }
    atEdge.push(edge);
    next++;
  }
  // Each town's and depot's reachable components: those touching its corridor squares next to its piece's ends.
  const sites = [...land.towns.map((t) => t.station), ...land.depots.map((d) => d.piece)];
  if (sites.length === 0) return true;
  const reach = sites.map((site) => {
    const set = new Set<number>();
    for (const end of pieceEnds(site)) {
      const ahead = { x: end.x + Math.cos(end.heading) * 40, z: end.z + Math.sin(end.heading) * 40 };
      const i = g.cellAtWorld(ahead.x, ahead.z);
      if (i !== -1 && component[i] !== -1) set.add(component[i]);
    }
    return set;
  });
  const first = reach[0];
  return reach.every((s) => [...s].some((c) => first.has(c))) && [...first].some((c) => atEdge[c]);
}

/**
 * Add generated land (`generatePlot` or `generateRegion`) to a world: its plots, squares and what stands on them,
 * with ids moved on past the world's own, and town names the world doesn't have yet. The region's plots must not be
 * in the world already. Returns the slots of the plots added.
 */
export function adoptRegion(world: Landscape, part: Landscape): number[] {
  const g = world.grid;
  const p = part.grid;
  const townBase = world.towns.length;
  const depotBase = world.depots.length;
  const fieldBase = world.fields.length;
  const buildingBase = world.nextBuildingId;
  const slotMap: number[] = [];
  p.plots.forEach((plot: PlotCoord, from) => {
    if (g.hasPlot(plot.px, plot.pz)) throw new Error(`plot ${plot.px},${plot.pz} is already in the world`);
    const to = g.addPlot(plot.px, plot.pz);
    slotMap[from] = to;
    const a = from * PLOT_CELLS;
    const b = to * PLOT_CELLS;
    g.height.set(p.height.subarray(a, a + PLOT_CELLS), b);
    g.surface.set(p.surface.subarray(a, a + PLOT_CELLS), b);
    g.feature.set(p.feature.subarray(a, a + PLOT_CELLS), b);
    for (let k = 0; k < PLOT_CELLS; k++) {
      const owner = p.owner[a + k];
      const f = p.feature[a + k];
      g.owner[b + k] =
        owner === -1
          ? -1
          : f === FEAT_STATION
            ? owner + townBase
            : f === FEAT_DEPOT
              ? owner + depotBase
              : f === FEAT_FIELD
                ? owner + fieldBase
                : f === FEAT_BUILDING
                  ? owner + buildingBase
                  : owner;
    }
  });
  const cell = (i: number) => slotMap[(i / PLOT_CELLS) | 0] * PLOT_CELLS + (i % PLOT_CELLS);
  const names = new Set(world.towns.map((t) => t.name));
  for (const t of part.towns) {
    let name = t.name;
    for (let k = 0; names.has(name); k++) name = k < NAME_PREFIXES.length ? `${NAME_PREFIXES[(k + t.id) % NAME_PREFIXES.length]} ${t.name}` : `${t.name} ${k}`;
    names.add(name);
    world.towns.push({
      ...t,
      id: t.id + townBase,
      name,
      cells: t.cells.map(cell),
      buildings: t.buildings.map((b) => ({ ...b, id: b.id + buildingBase, cells: b.cells.map(cell) })),
    });
  }
  for (const d of part.depots) world.depots.push({ ...d, id: d.id + depotBase });
  for (const f of part.fields) world.fields.push({ ...f, id: f.id + fieldBase, cells: f.cells.map(cell) });
  for (const i of part.corridors) world.corridors.push(cell(i));
  if (part.shed && !world.shed) world.shed = { ...part.shed, cells: part.shed.cells.map(cell) };
  world.nextBuildingId = buildingBase + part.nextBuildingId;
  return slotMap;
}

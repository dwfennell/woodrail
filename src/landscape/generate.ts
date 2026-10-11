import { rng } from "../lib/rng";
import type { Pose } from "../track";
import {
  CELL,
  COLS,
  FEAT_BUILDING,
  FEAT_FIELD,
  FEAT_SHED,
  FEAT_NONE,
  FEAT_STATION,
  FEAT_TREE,
  LandscapeGrid,
  MAT_DEPTH,
  MAT_WIDTH,
  MAX_HEIGHT,
  ROWS,
  SURF_GRASS,
  SURF_LANE,
  SURF_RIVER,
  SURF_ROAD,
  SURF_TOWN,
} from "./grid";
import { valueNoise } from "./noise";

export interface Building {
  id: number;
  cells: number[];
  floors: 1 | 2;
  kind: "house" | "shop";
  /** Roof colour palette index. */
  roof: number;
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

/** A fenced 2 × 2-square paddock of toy animals. */
export interface Field {
  id: number;
  /** Its four squares, row-major from the top-left one. */
  cells: number[];
  animal: "cow" | "sheep";
}

/** The decorative engine shed: 2 × 2 squares near a town, its doors facing along `heading`. */
export interface Shed {
  cells: number[];
  x: number;
  z: number;
  heading: number;
}

export interface Landscape {
  seed: number;
  starter: boolean;
  grid: LandscapeGrid;
  towns: Town[];
  /** Cells kept clear for track: station approaches (and the starter strip). */
  corridors: number[];
  fields: Field[];
  shed: Shed | null;
}

export const STATION_LENGTH = 216;
const HALF_STATION = STATION_LENGTH / 2;
const MIN_TOWN_SPACING = 900;
const EDGE_MARGIN = 4 * CELL;
const TOWN_RADIUS = 210;
const CORRIDOR_LENGTH = 6 * CELL;
const CORRIDOR_HALF_WIDTH = 2 * CELL;

/** Chance that a town has a country lane. */
const LANE_CHANCE = 0.8;
const NAMES = ["Applebury", "Millbrook", "Oakhollow", "Pinecrest", "Thimble Cross", "Larkfield", "Brambleton", "Copperdale", "Willowmere", "Fernhill", "Hazelwick", "Puddleby", "Kettle Green", "Foxley", "Tumbledown", "Ashcombe"];

/** The two outward ends of a town's station: socket end and peg end, each heading away from the station. */
export function stationEnds(town: Town): [Pose, Pose] {
  const s = town.station;
  return [
    { x: s.x, z: s.z, heading: s.heading + Math.PI },
    { x: s.x + Math.cos(s.heading) * STATION_LENGTH, z: s.z + Math.sin(s.heading) * STATION_LENGTH, heading: s.heading },
  ];
}

export function corridorCells(land: Landscape): number[] {
  return land.corridors;
}

/** Generate a landscape deterministically from a seed (retrying internally until every town is reachable). */
export function generateLandscape(seed: number, options: { starter?: boolean } = {}): Landscape {
  const starter = options.starter ?? false;
  let last: Landscape | null = null;
  for (let attempt = 0; attempt < 20; attempt++) {
    const land = attemptLandscape(seed + attempt * 1000, starter);
    land.seed = seed;
    if (reachable(land)) {
      addShed(land);
      addFields(land);
      return land;
    }
    last = land;
  }
  return last!;
}

function attemptLandscape(seed: number, starter: boolean): Landscape {
  const random = rng(seed);
  const grid = new LandscapeGrid();
  const towns = placeTowns(random, starter);
  const protectedCells = new Set<number>();

  // Stations, platforms, corridors and town areas, measured from each station line (works for any heading).
  for (const town of towns) {
    const dx = Math.cos(town.station.heading);
    const dz = Math.sin(town.station.heading);
    const cells = new Set<number>();
    for (let row = 0; row < ROWS; row++) {
      for (let col = 0; col < COLS; col++) {
        const i = grid.index(col, row);
        const px = grid.centreX(col) - town.centre.x;
        const pz = grid.centreZ(row) - town.centre.z;
        const d = px * dx + pz * dz;
        const l = -px * dz + pz * dx;
        const ad = Math.abs(d);
        const isTrack = ad < HALF_STATION && Math.abs(l) < 26;
        const isPlatform = ad < HALF_STATION - 8 && l >= 26 && l < 120;
        if (isTrack || isPlatform) {
          grid.feature[i] = FEAT_STATION;
          grid.owner[i] = town.id;
          grid.surface[i] = SURF_TOWN;
          cells.add(i);
          continue;
        }
        if (ad >= HALF_STATION - 32 && ad < HALF_STATION + CORRIDOR_LENGTH && Math.abs(l) < CORRIDOR_HALF_WIDTH) {
          protectedCells.add(i);
          continue;
        }
        if (Math.hypot(px, pz) < TOWN_RADIUS && grid.feature[i] === FEAT_NONE && !protectedCells.has(i)) {
          grid.surface[i] = SURF_TOWN;
          cells.add(i);
        }
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
    for (let row = 0; row < ROWS; row++) {
      for (let col = 0; col < COLS; col++) {
        const x = grid.centreX(col);
        const z = grid.centreZ(row);
        if (x > a.centre.x + HALF_STATION - 32 && x < b.centre.x - HALF_STATION + 32 && Math.abs(z - a.centre.z) < CORRIDOR_HALF_WIDTH) {
          const i = grid.index(col, row);
          if (grid.feature[i] === FEAT_NONE) {
            protectedCells.add(i);
            grid.surface[i] = SURF_GRASS;
          }
        }
      }
    }
  }

  const locked = (i: number) => protectedCells.has(i) || grid.surface[i] === SURF_TOWN || grid.feature[i] === FEAT_STATION;

  // Hills from smooth noise, in whole blocks.
  const hillNoise = valueNoise(seed * 7 + 1);
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      const i = grid.index(col, row);
      if (locked(i)) continue;
      const n = hillNoise(col / 8, row / 8) * 0.7 + hillNoise(col / 3.5 + 17, row / 3.5 + 5) * 0.3;
      grid.height[i] = Math.max(0, Math.min(MAX_HEIGHT, Math.floor((n - 0.42) * 7)));
    }
  }
  relaxHeights(grid);

  // Felt rivers: random walks from one edge to the opposite edge, avoiding towns and corridors.
  const pick = random();
  const riverCount = pick < 0.35 ? 1 : pick < 0.8 ? 2 : 3;
  for (let r = 0; r < riverCount; r++) {
    for (let tries = 0; tries < 8; tries++) {
      const path = riverWalk(grid, random, locked);
      if (!path) continue;
      for (const i of path) {
        grid.surface[i] = SURF_RIVER;
        grid.height[i] = 0;
      }
      break;
    }
  }
  relaxHeights(grid);

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
        const col = first % COLS;
        const neighbour = col + 1 < COLS ? first + 1 : -1;
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

  // Trees in clumps on open grass.
  const treeNoise = valueNoise(seed * 13 + 5);
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      const i = grid.index(col, row);
      if (locked(i) || grid.surface[i] !== SURF_GRASS || grid.feature[i] !== FEAT_NONE) continue;
      if (treeNoise(col / 5, row / 5) > 0.62 && random() < 0.55) grid.feature[i] = FEAT_TREE;
    }
  }

  // Country lanes from the towns out to the edge of the mat, crossing open grass (their own random stream, so the
  // rest of the map is unchanged by them).
  const laneRandom = rng(seed * 31 + 7);
  for (const town of towns) {
    if (laneRandom() >= LANE_CHANCE) continue;
    const path = laneWalk(grid, town, laneRandom);
    if (!path) continue;
    for (const i of path) {
      grid.surface[i] = SURF_LANE;
      grid.feature[i] = FEAT_NONE;
    }
  }

  return { seed, starter, grid, towns, corridors: [...protectedCells].filter((i) => grid.feature[i] === FEAT_NONE), fields: [], shed: null };
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
    if (!g.inBounds(col, row)) return false;
    const i = g.index(col, row);
    return g.height[i] === h && g.surface[i] === SURF_GRASS && g.feature[i] === FEAT_NONE && !corridors.has(i);
  };
  const clearAround = (col: number, row: number) => {
    if (!g.inBounds(col, row)) return false;
    const i = g.index(col, row);
    return g.feature[i] !== FEAT_BUILDING && g.feature[i] !== FEAT_STATION && g.surface[i] !== SURF_RIVER;
  };
  for (const town of land.towns) {
    const tc = g.cellAtWorld(town.centre.x, town.centre.z);
    const tcol = tc % COLS;
    const trow = (tc - tcol) / COLS;
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
 * random stream). Each is kept only if every town can still reach every other.
 */
function addFields(land: Landscape): void {
  const g = land.grid;
  const random = rng(land.seed * 37 + 3);
  const corridors = new Set(land.corridors);
  const count = 1 + Math.floor(random() * 3);
  const open = (col: number, row: number, h: number) => {
    if (!g.inBounds(col, row)) return false;
    const i = g.index(col, row);
    return g.height[i] === h && g.surface[i] === SURF_GRASS && g.feature[i] === FEAT_NONE && !corridors.has(i);
  };
  // Anything but plain felt, trees and other open grass nearby keeps a paddock away.
  const quiet = (col: number, row: number) => {
    if (!g.inBounds(col, row)) return false;
    const i = g.index(col, row);
    return g.surface[i] === SURF_GRASS && (g.feature[i] === FEAT_NONE || g.feature[i] === FEAT_TREE);
  };
  for (let tries = 0; tries < 300 && land.fields.length < count; tries++) {
    const col = 2 + Math.floor(random() * (COLS - 5));
    const row = 2 + Math.floor(random() * (ROWS - 5));
    const animal = random() < 0.5 ? "cow" : "sheep";
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
      for (const i of cells) g.feature[i] = FEAT_NONE;
      continue;
    }
    land.fields.push({ id, cells, animal });
  }
}

/**
 * A lane leaving a town on its platform side (away from the station track) and running to the edge of the mat over
 * flat grass: the cheapest route, where every square costs 1, a turn costs 4 and clearing a tree costs 3, so lanes
 * run in long straight stretches with a few bends. Null if no route exists.
 */
function laneWalk(grid: LandscapeGrid, town: Town, random: () => number): number[] | null {
  const dx = Math.cos(town.station.heading);
  const dz = Math.sin(town.station.heading);
  const dc = Math.round(-dz);
  const dr = Math.round(dx);
  const open = (i: number) =>
    grid.height[i] === 0 && (grid.surface[i] === SURF_GRASS || grid.surface[i] === SURF_LANE) && (grid.feature[i] === FEAT_NONE || grid.feature[i] === FEAT_TREE);
  // Leave the town straight out from its centre.
  const centre = grid.cellAtWorld(town.centre.x, town.centre.z);
  if (centre === -1) return null;
  let col = centre % COLS;
  let row = (centre - col) / COLS;
  for (let k = 0; k < 12 && grid.inBounds(col, row) && grid.surface[grid.index(col, row)] !== SURF_GRASS; k++) {
    col += dc;
    row += dr;
  }
  if (!grid.inBounds(col, row) || !open(grid.index(col, row))) return null;

  // Dijkstra over (square, direction) states. Directions: 0 +col, 1 +row, 2 −col, 3 −row.
  const DC = [1, 0, -1, 0];
  const DR = [0, 1, 0, -1];
  const n = COLS * ROWS;
  const cost = new Float64Array(n * 4).fill(Infinity);
  const from = new Int32Array(n * 4).fill(-1);
  // A little per-map jitter in the tree cost, so lanes from neighbouring towns don't all look alike.
  const treeCost = 2.5 + random();
  const startDir = DC.findIndex((c, d) => c === dc && DR[d] === dr);
  const start = grid.index(col, row) * 4 + startDir;
  cost[start] = 0;
  const queue: [number, number][] = [[0, start]];
  const edge = (c: number, r: number) => c === 0 || r === 0 || c === COLS - 1 || r === ROWS - 1;
  let goal = -1;
  while (queue.length) {
    // Small grid: a sorted insert keeps this simple and fast enough.
    const [c0, state] = queue.shift()!;
    if (c0 > cost[state]) continue;
    const cell = state >> 2;
    const dir = state & 3;
    const cc = cell % COLS;
    const cr = (cell - cc) / COLS;
    if (edge(cc, cr) || (grid.surface[cell] === SURF_LANE && cell !== grid.index(col, row))) {
      goal = state;
      break;
    }
    for (let d = 0; d < 4; d++) {
      if (d === ((dir + 2) & 3)) continue;
      const nc = cc + DC[d];
      const nr = cr + DR[d];
      if (!grid.inBounds(nc, nr)) continue;
      const ni = grid.index(nc, nr);
      if (!open(ni)) continue;
      const step = 1 + (d === dir ? 0 : 4) + (grid.feature[ni] === FEAT_TREE ? treeCost : 0);
      const next = ni * 4 + d;
      const total = c0 + step;
      if (total >= cost[next]) continue;
      cost[next] = total;
      from[next] = state;
      let lo = 0;
      let hi = queue.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (queue[mid][0] < total) lo = mid + 1;
        else hi = mid;
      }
      queue.splice(lo, 0, [total, next]);
    }
  }
  if (goal === -1) return null;
  const path: number[] = [];
  for (let st = goal; st !== -1; st = from[st]) path.push(st >> 2);
  return path.reverse();
}

function placeTowns(random: () => number, starter: boolean): Town[] {
  const count = starter ? 5 : 5 + Math.floor(random() * 3);
  const names = [...NAMES];
  for (let i = names.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [names[i], names[j]] = [names[j], names[i]];
  }
  const towns: Town[] = [];
  const make = (x: number, z: number, heading: number): Town => ({
    id: towns.length,
    name: names[towns.length],
    centre: { x, z },
    station: { x: x - Math.cos(heading) * HALF_STATION, z: z - Math.sin(heading) * HALF_STATION, heading },
    cells: [],
    buildings: [],
  });
  // Stations face a map direction with their midpoint on a square's centre: the track runs down the middle of a
  // row (or column) and both ends, 1½ squares away, fall on square edges, on the pieces' 18 mm lattice.
  const snap = (v: number, half: number) => (Math.floor((v + half) / CELL) + 0.5) * CELL - half;
  if (starter) {
    const z = snap(-200 + random() * 300, MAT_DEPTH / 2);
    towns.push(make(-540, z, 0));
    towns.push(make(540, z, 0));
  }
  let guard = 0;
  while (towns.length < count && guard++ < 5000) {
    const x = snap(-MAT_WIDTH / 2 + EDGE_MARGIN + random() * (MAT_WIDTH - 2 * EDGE_MARGIN), MAT_WIDTH / 2);
    const z = snap(-MAT_DEPTH / 2 + EDGE_MARGIN + random() * (MAT_DEPTH - 2 * EDGE_MARGIN), MAT_DEPTH / 2);
    const heading = Math.floor(random() * 4) * (Math.PI / 2);
    if (towns.some((t) => Math.hypot(t.centre.x - x, t.centre.z - z) < MIN_TOWN_SPACING)) continue;
    towns.push(make(x, z, normaliseHeading(heading)));
  }
  return towns;
}

function normaliseHeading(h: number): number {
  const step = Math.PI / 4;
  const k = ((Math.round(h / step) % 8) + 8) % 8;
  return (k > 4 ? k - 8 : k) * step;
}

/** Lower any square more than one block above a neighbour, until the whole map is rampable. */
function relaxHeights(grid: LandscapeGrid): void {
  let changed = true;
  while (changed) {
    changed = false;
    for (let row = 0; row < ROWS; row++) {
      for (let col = 0; col < COLS; col++) {
        const i = grid.index(col, row);
        let min = grid.height[i];
        if (col > 0) min = Math.min(min, grid.height[i - 1]);
        if (col + 1 < COLS) min = Math.min(min, grid.height[i + 1]);
        if (row > 0) min = Math.min(min, grid.height[i - COLS]);
        if (row + 1 < ROWS) min = Math.min(min, grid.height[i + COLS]);
        if (grid.height[i] > min + 1) {
          grid.height[i] = min + 1;
          changed = true;
        }
      }
    }
  }
}

/** A 4-connected wandering path from one edge to the opposite edge, or null if it gets stuck. */
function riverWalk(grid: LandscapeGrid, random: () => number, locked: (i: number) => boolean): number[] | null {
  const horizontal = random() < 0.5;
  const span = horizontal ? COLS : ROWS;
  const across = horizontal ? ROWS : COLS;
  let a = 0;
  let b = 2 + Math.floor(random() * (across - 4));
  const cellOf = (along: number, side: number) => (horizontal ? grid.index(along, side) : grid.index(side, along));
  const path: number[] = [];
  const seen = new Set<number>();
  if (locked(cellOf(a, b))) return null;
  path.push(cellOf(a, b));
  seen.add(cellOf(a, b));
  let drift = random() < 0.5 ? -1 : 1;
  for (let steps = 0; steps < span * 4 && a < span - 1; steps++) {
    if (random() < 0.15) drift = -drift;
    const options = random() < 0.6 ? [[1, 0], [0, drift], [0, -drift]] : [[0, drift], [1, 0], [0, -drift]];
    let moved = false;
    for (const [da, db] of options) {
      const na = a + da;
      const nb = b + db;
      if (nb < 1 || nb >= across - 1) continue;
      const i = cellOf(na, nb);
      if (seen.has(i) || locked(i)) continue;
      a = na;
      b = nb;
      path.push(i);
      seen.add(i);
      moved = true;
      break;
    }
    if (!moved) return null;
  }
  return a === span - 1 ? path : null;
}

/** Can track (in principle) be laid between every pair of towns? BFS over open squares from each town's corridors. */
export function reachable(land: Landscape): boolean {
  const g = land.grid;
  const component = new Int32Array(COLS * ROWS).fill(-1);
  const passable = (i: number) => g.feature[i] === FEAT_NONE && (g.surface[i] === SURF_GRASS || g.surface[i] === SURF_RIVER || g.surface[i] === SURF_LANE);
  let next = 0;
  for (let i = 0; i < component.length; i++) {
    if (component[i] !== -1 || !passable(i)) continue;
    const queue = [i];
    component[i] = next;
    while (queue.length) {
      const c = queue.pop()!;
      const col = c % COLS;
      const row = (c - col) / COLS;
      for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nc = col + dc;
        const nr = row + dr;
        if (!g.inBounds(nc, nr)) continue;
        const n = g.index(nc, nr);
        if (component[n] !== -1 || !passable(n) || Math.abs(g.height[n] - g.height[c]) > 1) continue;
        component[n] = next;
        queue.push(n);
      }
    }
    next++;
  }
  // Each town's reachable components: those touching its corridor squares next to the station ends.
  const reach = land.towns.map((town) => {
    const set = new Set<number>();
    for (const end of stationEnds(town)) {
      const ahead = { x: end.x + Math.cos(end.heading) * 40, z: end.z + Math.sin(end.heading) * 40 };
      const i = g.cellAtWorld(ahead.x, ahead.z);
      if (i !== -1 && component[i] !== -1) set.add(component[i]);
    }
    return set;
  });
  const first = reach[0];
  return reach.every((s) => [...s].some((c) => first.has(c)));
}

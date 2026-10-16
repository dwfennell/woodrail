import { rng } from "../lib/rng";
import type { Pose } from "../track";
import { growTown } from "../roads/grow-town";
import { coastNear, coastOf, SAND, shoreDistance, type Coast } from "./coast";
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
  SURF_SAND,
  SURF_SEA,
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
  /** The grid edge its front door faces (onto its street): +col, +row, −col, −row. Older saves: toward the centre. */
  front?: 0 | 1 | 2 | 3;
  /** On a street corner (a good spot for a shop). */
  corner?: boolean;
  /** A town landmark (Game mode: a school, a market, a library; see game/landmarks.ts). */
  landmark?: string;
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
  /** Where the sea is (see `coast.ts`); null on maps from before the coast. */
  coast?: Coast | null;
}

export const STATION_LENGTH = 216;
const HALF_STATION = STATION_LENGTH / 2;
const MIN_TOWN_SPACING = 900;
/** Depots keep this far from towns and other depots (they have no town area of their own). */
const DEPOT_SPACING = 750;
/**
 * A town's flat ground: five squares from its centre, kept clear of hills and trees for it to grow on (see
 * `growTown`). The town itself is only its station, streets and buildings; the rest stays grass.
 */
const TOWN_RADIUS = 360;
/** A new town is grown this many buildings, by where it is: from a hamlet to a small town. */
const TOWN_START_MIN = 6;
const TOWN_START_SPREAD = 9;
const CORRIDOR_LENGTH = 6 * CELL;
const CORRIDOR_HALF_WIDTH = 2 * CELL;
/** A town's station keeps only the track's own row clear (trains come in on one straight track), so houses can
 *  stand beside the line. */
const TRACK_ROW = CELL / 2;
/** On the starter map, from a first town's centre to its depot's (the sawmill beyond one, the forest beyond the other). */
const STARTER_DEPOT_GAP = 1080;
/**
 * The starter sawmill's way in: three long straights (648 mm) out from the first town's station, then a quarter turn
 * of two large curves (radius 180) into the sawmill, which stands across the line, toward the middle of the map.
 */
const STARTER_RUN = 648;
const STARTER_TURN = 180;
/** Rows either side of the first two towns' line kept free of hills between them (open ground to join them). */
const STARTER_OPEN_ROWS = 5;

/** Where the starter line's straight run ends and the turn to the sawmill begins, and which way it turns (+1: +z). */
function starterTurn(a: { centre: { x: number; z: number } }): { x: number; side: number } {
  return { x: a.centre.x - HALF_STATION - STARTER_RUN, side: a.centre.z > 0 ? -1 : 1 };
}

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

/**
 * Where a fixed piece (a station or a depot) was put by the generator: its track centred on `centre`, at the quarter
 * turn nearest `heading`. Stations and depots may give a little from here to take up joint play (see `Anchor`).
 */
export function fixedHome(centre: { x: number; z: number }, heading: number): Pose {
  const h = normaliseHeading(Math.round(heading / (Math.PI / 2)) * (Math.PI / 2));
  return { x: centre.x - Math.cos(h) * HALF_STATION, z: centre.z - Math.sin(h) * HALF_STATION, heading: h };
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
export function generateLandscape(seed: number, options: { starter?: boolean; coast?: boolean } = {}): Landscape {
  const starter = options.starter ?? false;
  const coast = options.coast === false ? null : coastOf(seed, starter);
  return generateRegion(seed, START_REGION, { starter, shed: true, coast });
}

/** One plot of land, as it would be if added to a world with this seed (ids from 0: see `adoptRegion`). */
export function generatePlot(seed: number, px: number, pz: number, coast: Coast | null = coastOf(seed)): Landscape {
  return generateRegion(seed, { px0: px, pz0: pz, w: 1, h: 1 }, { starter: false, shed: false, coast });
}

/**
 * A rectangle of plots, deterministically from the seed and where it is (retrying internally until every town and
 * depot is reachable from the others and from the region's edge). Its edges meet the land either side: see `edges.ts`.
 */
export function generateRegion(seed: number, region: Region, options: { starter: boolean; shed: boolean; coast?: Coast | null }): Landscape {
  let last: Landscape | null = null;
  for (let attempt = 0; attempt < 20; attempt++) {
    const land = attemptRegion(seed, region, options.starter, attempt, options.coast ?? null);
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

/**
 * The hills as the noise has them, before anything flattens them (whole blocks), sloping down to the beach (flat) by
 * the sea. The same everywhere for a seed.
 */
function rawHeight(seed: number, col: number, row: number, coast: Coast | null): number {
  const hill = noise(seed * 7 + 1);
  const n = hill(col / 8, row / 8) * 0.7 + hill(col / 3.5 + 17, row / 3.5 + 5) * 0.3;
  return Math.max(0, Math.min(MAX_HEIGHT, Math.floor((n - 0.42) * 7), shoreDistance(coast, col, row) - SAND));
}

/** Is a tree's noise high enough here for a clump (and a coin toss per square)? The same everywhere for a seed. */
function treeHere(seed: number, col: number, row: number): boolean {
  const tree = noise(seed * 13 + 5);
  return tree(col / 5, row / 5) > 0.62 && hashInts(seed, col, row, 0x7ee) / 4294967296 < 0.55;
}


function attemptRegion(seed: number, region: Region, starter: boolean, attempt: number, coastOfMap: Coast | null): Landscape {
  // A region well inland (the start region, mostly) skips the coast's sums square by square: none can reach it. (The
  // crossings on its edges still ask the map's coast, so they agree with the plots beside it.)
  // (Squares more than SAND + MAX_HEIGHT from the shore are neither sand, nor beach-bound hills, nor too near for a
  // town; the hills' settling looks MAX_HEIGHT squares round the region.)
  const coast = coastNear(coastOfMap, region, SAND + MAX_HEIGHT - 1, MAX_HEIGHT) ? coastOfMap : null;
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
  const siteRoom = (col: number, row: number) =>
    col >= col0 + SITE_BAND && col < col1 - SITE_BAND && row >= row0 + SITE_BAND && row < row1 - SITE_BAND && shoreDistance(coast, col, row) > SAND + 2;
  const area = region.w * region.h;

  // The sea past the shore, and a strip of sand along it.
  if (coast) {
    grid.forEachCell((i, col, row) => {
      const d = shoreDistance(coast, col, row);
      if (d <= 0) grid.surface[i] = SURF_SEA;
      else if (d <= SAND) grid.surface[i] = SURF_SAND;
    });
  }

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
  const townGround = new Set<number>();
  for (const town of towns) {
    const fp = footprint(town.centre, town.station.heading, TOWN_RADIUS);
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
      if (grid.feature[i] === FEAT_NONE && !protectedCells.has(i)) townGround.add(i);
    }
    town.cells = [...cells];
  }
  // A town's area must not swallow another town's corridor.
  for (const i of protectedCells) {
    if (grid.feature[i] === FEAT_NONE) grid.surface[i] = SURF_GRASS;
    townGround.delete(i);
  }
  for (const town of towns) town.cells = town.cells.filter((i) => !protectedCells.has(i) || grid.feature[i] === FEAT_STATION);

  /** Kept free of hills (but not of trees): open ground between the starter map's first two towns. */
  const open = new Set<number>();
  if (starter) {
    // The starter line: a clear strip along the first two towns' stations, from the turn to the sawmill to the forest
    // yard, and the turn itself (a quarter circle into the sawmill).
    const [a, b] = towns;
    const [, forest] = depots;
    const turn = starterTurn(a);
    const pivot = { x: turn.x, z: a.centre.z + turn.side * STARTER_TURN };
    grid.forEachCell((i, col, row) => {
      const x = grid.centreX(col);
      const z = grid.centreZ(row);
      const onLine = x > turn.x - 32 && x < forest.centre.x - HALF_STATION + 32 && Math.abs(z - a.centre.z) < TRACK_ROW;
      const r = Math.hypot(x - pivot.x, z - pivot.z);
      const onTurn = x <= turn.x + CELL / 2 && (z - a.centre.z) * turn.side >= -CELL / 2 && Math.abs(r - STARTER_TURN) < CELL;
      if ((onLine || onTurn) && grid.feature[i] === FEAT_NONE) {
        protectedCells.add(i);
        grid.surface[i] = SURF_GRASS;
      }
      if (x > a.centre.x && x < b.centre.x && Math.abs(z - a.centre.z) <= STARTER_OPEN_ROWS * CELL) open.add(i);
    });
  }

  const locked = (i: number) =>
    protectedCells.has(i) || open.has(i) || townGround.has(i) || grid.surface[i] === SURF_TOWN || grid.feature[i] === FEAT_STATION || grid.feature[i] === FEAT_DEPOT;

  // Rivers: crossing the region's edges where the edge contracts say, joined up inside. (The contracts still name
  // where country lanes used to cross; there are no generated roads between towns now, only town gates.)
  const stubs = regionStubs(seed, region, coastOfMap);
  const rivers = stubs.inside.filter((s) => s.kind === "river");
  for (const stub of rivers) for (const [col, row] of stub.cells) grid.surface[grid.index(col, row)] = SURF_RIVER;
  joinRivers(grid, rivers, region, random, local, interior, locked);

  // Hills: the noise's heights, flattened down to the felt by towns, depots and rivers (here and across the region's
  // edges) so no square is more than one block above a neighbour.
  settleHeights(grid, seed, region, stubs.outside.filter((s) => s.kind === "river"), locked, coast);

  // Each town grown from its station a building at a time (see `growTown`), on its own flat ground: a hamlet to a
  // small town, by where it is.
  let buildingId = 0;
  for (const town of towns) {
    const n = TOWN_START_MIN + (hashInts(Math.floor(town.centre.x / CELL), Math.floor(town.centre.z / CELL), 0x6a2) % TOWN_START_SPREAD);
    const canUse = (i: number) => townGround.has(i) && grid.surface[i] === SURF_GRASS && grid.feature[i] === FEAT_NONE && interior(grid.colOf(i), grid.rowOf(i));
    const steps = growTown(grid, { centre: town.centre, heading: town.station.heading, cells: town.cells, buildings: town.buildings }, n, {
      canUse,
      toward: towns.filter((t) => t !== town).map((t) => t.centre),
    });
    const ids: number[] = [];
    for (const step of steps) {
      for (const [i, road] of step.streets) {
        grid.surface[i] = SURF_ROAD;
        grid.road[i] = road;
        if (!town.cells.includes(i)) town.cells.push(i);
      }
      const b: Building = { id: buildingId++, cells: step.cells, floors: 1, kind: "house", roof: Math.floor(random() * 4), front: step.front, ...(step.corner ? { corner: true } : {}) };
      ids.push(b.id);
      for (const c of step.cells) {
        grid.feature[c] = FEAT_BUILDING;
        grid.surface[c] = SURF_TOWN;
        grid.owner[c] = b.id;
        town.cells.push(c);
      }
      town.buildings.push(b);
      for (const c of step.changes) {
        const changed = town.buildings.find((x) => x.id === (c.id < 0 ? ids[-1 - c.id] : c.id));
        if (!changed) continue;
        if (c.kind) changed.kind = c.kind;
        if (c.floors) changed.floors = c.floors;
      }
    }
  }

  // Trees in clumps on open grass (where the noise says, the same either side of a plot's edge).
  grid.forEachCell((i, col, row) => {
    if (locked(i) || grid.surface[i] !== SURF_GRASS || grid.feature[i] !== FEAT_NONE) return;
    if (treeHere(seed, col, row)) grid.feature[i] = FEAT_TREE;
  });

  return { seed, starter, grid, towns, corridors: [...protectedCells].filter((i) => grid.feature[i] === FEAT_NONE), fields: [], shed: null, depots, nextBuildingId: buildingId, coast: coastOfMap };
}

/** A station's or depot's squares (track and platform or yard), its approach corridors, and its town's area. */
function footprint(centre: { x: number; z: number }, heading: number, radius = 0): { station: [number, number][]; corridor: [number, number][]; area: [number, number][] } {
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
      else if (ad >= HALF_STATION - 32 && ad < HALF_STATION + CORRIDOR_LENGTH && Math.abs(l) < (radius > 0 ? TRACK_ROW : CORRIDOR_HALF_WIDTH)) corridor.push([col, row]);
      else if (Math.hypot(px, pz) < radius) area.push([col, row]);
    }
  }
  return { station, corridor, area };
}

/** Does a station or depot here fit in the region, clear of its edge band? */
function fits(centre: { x: number; z: number }, heading: number, interior: (col: number, row: number) => boolean, town: boolean): boolean {
  // Its corridors reach this far along the station; the town (or yard and corridors) this far across: a quick look at
  // the corners of that rectangle first.
  const along = HALF_STATION + CORRIDOR_LENGTH;
  const radius = town ? TOWN_RADIUS : 0;
  const across = town ? radius : CORRIDOR_HALF_WIDTH;
  const ax = Math.abs(Math.cos(heading)) > 0.5;
  const hx = ax ? along : across;
  const hz = ax ? across : along;
  for (const [x, z] of [[centre.x - hx, centre.z - hz], [centre.x + hx, centre.z + hz]]) {
    if (!interior(Math.floor(x / CELL), Math.floor(z / CELL))) return false;
  }
  const fp = footprint(centre, heading, radius);
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
  /** Keep other towns off the starter line (sawmill, the first two towns, forest yard) and clear of its depots. */
  let offLine = (_x: number, _z: number) => true;
  if (starter) {
    const z = snap(-200 + random() * 300);
    towns.push(make(-540, z, 0));
    towns.push(make(540, z, 0));
    const ends = [starterTurn({ centre: { x: -540, z } }).x - STARTER_TURN, 540 + STARTER_DEPOT_GAP];
    offLine = (x, tz) =>
      ends.every((ex) => Math.hypot(ex - x, z - tz) >= MIN_TOWN_SPACING) && !(Math.abs(tz - z) < 6 * CELL && x > ends[0] - 6 * CELL && x < ends[1] + 6 * CELL);
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
    if (!offLine(x, z)) continue;
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
    // On one line with the first two towns' stations: the sawmill beyond the first town, the forest yard beyond the
    // second, so the first timber line is one straight run (a clear strip joins them all: see `attemptRegion`).
    const [a, b] = towns;
    // The sawmill across the line after its quarter turn (so the way to it takes a curve), the forest yard on it.
    const turn = starterTurn(a);
    const sx = turn.x - STARTER_TURN;
    const sz = a.centre.z + turn.side * STARTER_TURN;
    // (Its piece runs toward the line, so its second end meets the turn, as the straight line's sawmill did.)
    depots.push({ id: depots.length, kind: "sawmill", centre: { x: sx, z: sz + turn.side * HALF_STATION }, piece: { x: sx, z: sz + turn.side * STATION_LENGTH, heading: normaliseHeading((-turn.side * Math.PI) / 2) } });
    const fx = b.centre.x + STARTER_DEPOT_GAP;
    depots.push({ id: depots.length, kind: "forest", centre: { x: fx, z: a.centre.z }, piece: { x: fx - HALF_STATION, z: a.centre.z, heading: 0 } });
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
  const river = (i: number) => grid.surface[i] === SURF_RIVER || grid.surface[i] === SURF_SEA;
  let sea = false;
  grid.forEachCell((i) => {
    if (grid.surface[i] === SURF_SEA) sea = true;
  });
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
    for (const i of path) if (grid.surface[i] !== SURF_SEA) grid.surface[i] = SURF_RIVER;
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
  // By the sea, every river runs down to it (the first two still meet on the way, if there are two).
  if (sea) {
    // The first to the sea itself; the others to the sea or a river already running there (not to another crossing's
    // stub, which may not reach it).
    const reaches = new Set<number>();
    grid.forEachCell((i) => {
      if (grid.surface[i] === SURF_SEA) reaches.add(i);
    });
    for (const s of ordered) {
      const path = cheapestPath(grid, [innerEnd(grid, s)], (i) => reaches.has(i), cost);
      if (!lay(path)) {
        pond(s);
        continue;
      }
      for (const i of path!) reaches.add(i);
      for (const [c, r] of s.cells) reaches.add(grid.index(c, r));
    }
    return;
  }
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
 * Final hill heights: each square as low as the noise's height there, and no more than one block above any square
 * within reach — towns, depots, rivers and lanes count as flat ground, here and in the neighbouring plots' crossings.
 * Worked out from the squares within `MAX_HEIGHT` alone, so plots either side of an edge agree on it.
 */
function settleHeights(grid: LandscapeGrid, seed: number, region: Region, outside: readonly Stub[], locked: (i: number) => boolean, coast: Coast | null): void {
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
      base[k] = flat ? 0 : rawHeight(seed, col, row, coast);
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
  const passable = (i: number) => g.feature[i] === FEAT_NONE && (g.surface[i] === SURF_GRASS || g.surface[i] === SURF_RIVER || g.surface[i] === SURF_LANE || g.surface[i] === SURF_SAND);
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
    g.road.set(p.road.subarray(a, a + PLOT_CELLS), b);
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

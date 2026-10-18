import { FEAT_BUILDING, FEAT_NONE, FEAT_STATION, SURF_GRASS, SURF_ROAD, SURF_TOWN, type Building, type Landscape, type Town } from "../landscape";
import { MAX_REACH } from "./town-growth";
import type { LandBlock } from "../landscape/edit";
import { findBuilding } from "../props/towns";

/**
 * Game mode: a town's houses can be moved about their own town. A house goes onto a free lot of its town (a town green
 * beside a street, or grass at the town's edge beside a street, within its reach: the squares town growth would build
 * on next), or swaps places with another of its town's buildings of its size. Its record moves with it (its squares on the grid, its front onto its street), so the town stays whole:
 * track still can't go through it, growth builds around it where it now stands, and it saves where it is. Landmarks and
 * stations stay put.
 */

/** Why a house can't go where it's held. */
export type TownMoveBlock = "landmark" | "other-town" | "not-town" | "no-street" | "size" | "station" | LandBlock;

/** Where a held house would go: its squares and the edge facing its street, or, swapping, the building it trades with. */
export interface TownLot {
  cells: number[];
  front: Building["front"];
  corner: boolean;
  /** The building it changes places with, or undefined for a free lot. */
  swap?: number;
}

/** The checks on a free lot's squares that the land editor makes for a town growing (track, props, height). */
export interface LotChecker {
  checkLot(cells: readonly number[], reach?: boolean): LandBlock | null;
}

const EDGES = [
  [1, 0],
  [0, 1],
  [-1, 0],
  [0, -1],
] as const;

/** Can this building be picked up and moved within its town? A town's house or shop: not a landmark. */
export function movableBuilding(land: Landscape, id: number | undefined): boolean {
  if (id === undefined) return false;
  const found = findBuilding(land, id);
  return !!found && !found.building.landmark && (found.building.cells.length === 1 || found.building.cells.length === 2);
}

/** The town squares a house may stand on: the town's own (its area, and every building's squares). */
function townSquares(town: Town): Set<number> {
  const own = new Set(town.cells);
  for (const b of town.buildings) for (const c of b.cells) own.add(c);
  return own;
}

/** The edge of square `i` with a street beside it, if any (the first, in `EDGES` order). */
function streetEdge(land: Landscape, i: number): Building["front"] {
  const g = land.grid;
  for (let e = 0; e < 4; e++) {
    const nb = g.index(g.colOf(i) + EDGES[e][0], g.rowOf(i) + EDGES[e][1]);
    if (nb !== -1 && g.surface[nb] === SURF_ROAD) return e as Building["front"];
  }
  return undefined;
}

/** How many of square `i`'s sides have a street (two or more: a corner, a good spot for a shop). */
function streetsBeside(land: Landscape, i: number): number {
  const g = land.grid;
  let n = 0;
  for (const [dc, dr] of EDGES) {
    const nb = g.index(g.colOf(i) + dc, g.rowOf(i) + dr);
    if (nb !== -1 && g.surface[nb] === SURF_ROAD) n++;
  }
  return n;
}

/**
 * Where building `id`, held over square `cell`, would go: swapping with the building standing there (one of its own
 * town's, its size, not a landmark), or onto the free lot there (a town green beside a street; a two-square house
 * takes that square and one beside it, the way it lies now first). Its own squares count as free to it, so it can
 * shift over by one. Cheap: a few squares looked at (it runs on every move of the finger).
 */
export function lotFor(land: Landscape, id: number, cell: number, checker: LotChecker): TownLot | TownMoveBlock {
  const found = findBuilding(land, id);
  if (!found || found.building.landmark) return "landmark";
  const { town, building } = found;
  const g = land.grid;
  if (cell < 0) return "off-land";
  const size = building.cells.length;
  if (building.cells.includes(cell) && size === 1) return { cells: [...building.cells], front: building.front, corner: !!building.corner };
  if (g.feature[cell] === FEAT_STATION) return "station";
  if (g.feature[cell] === FEAT_BUILDING && !building.cells.includes(cell)) {
    const other = findBuilding(land, g.owner[cell]);
    if (!other) return "taken";
    if (other.town !== town) return "other-town";
    if (other.building.landmark) return "landmark";
    if (other.building.cells.length !== size) return "size";
    return { cells: [...other.building.cells], front: other.building.front, corner: !!other.building.corner, swap: other.building.id };
  }
  const own = townSquares(town);
  /** Grass within growth's reach of the town's centre. */
  const near = (i: number): boolean => g.surface[i] === SURF_GRASS && Math.hypot(g.centreX(g.colOf(i)) - town.centre.x, g.centreZ(g.rowOf(i)) - town.centre.z) <= MAX_REACH;
  /** Grass at the town's edge (beside one of its squares or streets, within its reach): the town may spread there. */
  const edge = (i: number): boolean => {
    if (!near(i)) return false;
    if (streetEdge(land, i) !== undefined) return true;
    for (const [dc, dr] of EDGES) {
      const nb = g.index(g.colOf(i) + dc, g.rowOf(i) + dr);
      if (nb !== -1 && own.has(nb)) return true;
    }
    return false;
  };
  // (Grass the town reaches but with no street beside it: it's the street that's missing.)
  if (!own.has(cell) && !edge(cell)) return near(cell) ? "no-street" : "not-town";
  const mine = new Set(building.cells);
  /** A square this house may stand on: a town green, grass at the town's edge, or one of its own. */
  const free = (i: number): LandBlock | null => {
    if (mine.has(i)) return null;
    const green = own.has(i) && g.surface[i] === SURF_TOWN;
    if (!green && !edge(i)) return "not-grass";
    if (g.feature[i] !== FEAT_NONE) return "taken";
    // (Grass: as town growth checks it, every town and depot still reachable with a house there.)
    return checker.checkLot([i], !green);
  };
  const lot = (cells: number[]): TownLot | TownMoveBlock => {
    const front = cells.map((i) => streetEdge(land, i)).find((e) => e !== undefined);
    if (front === undefined) return "no-street";
    if (cells.some((i) => g.height[i] !== g.height[cells[0]])) return "uneven";
    return { cells, front, corner: cells.some((i) => streetsBeside(land, i) >= 2) };
  };
  const first = free(cell);
  if (first) return first;
  if (size === 1) return lot([cell]);
  // Two squares: this one and one beside it, lying the way it lies now first.
  const along = g.rowOf(building.cells[0]) === g.rowOf(building.cells[1]) ? 0 : 1;
  const sides = [...EDGES.keys()].sort((a, b) => (a % 2 === along ? 0 : 1) - (b % 2 === along ? 0 : 1));
  let why: TownLot | TownMoveBlock = "taken";
  for (const e of sides) {
    const nb = g.index(g.colOf(cell) + EDGES[e][0], g.rowOf(cell) + EDGES[e][1]);
    if (nb === -1 || !own.has(nb)) continue;
    const block = free(nb);
    if (block) {
      why = block;
      continue;
    }
    const r = lot([cell, nb].sort((a, b) => a - b));
    if (typeof r !== "string") return r;
    why = r;
  }
  return why;
}

/**
 * Move building `id` to `lot` (from `lotFor`): its record and its squares on the grid (and, swapping, the other's). Its
 * old squares, left free, become a town green. Returns what puts it all back (undo).
 */
export function moveBuilding(land: Landscape, id: number, lot: TownLot): () => void {
  const found = findBuilding(land, id);
  if (!found) return () => {};
  const { town, building } = found;
  const g = land.grid;
  const other = lot.swap === undefined ? null : findBuilding(land, lot.swap)?.building ?? null;
  const records = [building, ...(other ? [other] : [])].map((b) => ({ b, cells: b.cells, front: b.front, corner: b.corner }));
  const squares = [...new Set([...building.cells, ...lot.cells])];
  const before = squares.map((i) => [i, g.feature[i], g.owner[i], g.surface[i]] as const);
  const townCells = town.cells.length;
  const set = (b: Building, cells: number[], front: Building["front"], corner: boolean | undefined) => {
    b.cells = cells;
    if (front === undefined) delete b.front;
    else b.front = front;
    if (corner) b.corner = true;
    else delete b.corner;
  };
  if (other) {
    // Changing places: each takes the other's squares, front and corner.
    set(other, building.cells, building.front, building.corner);
    set(building, lot.cells, lot.front, lot.corner);
    for (const i of other.cells) g.owner[i] = other.id;
    for (const i of building.cells) g.owner[i] = building.id;
  } else {
    // Its old squares, left: a town green (still the town's).
    for (const i of building.cells) {
      g.feature[i] = FEAT_NONE;
      g.owner[i] = -1;
      g.surface[i] = SURF_TOWN;
      if (!town.cells.includes(i)) town.cells.push(i);
    }
    set(building, lot.cells, lot.front, lot.corner);
    for (const i of building.cells) {
      g.feature[i] = FEAT_BUILDING;
      g.owner[i] = building.id;
      // (Grass at the town's edge: the town's from now on, as when it grows.)
      g.surface[i] = SURF_TOWN;
      if (!town.cells.includes(i)) town.cells.push(i);
    }
  }
  return () => {
    for (const r of records) set(r.b, r.cells, r.front, r.corner);
    for (const [i, f, o, s] of before) {
      g.feature[i] = f;
      g.owner[i] = o;
      g.surface[i] = s;
    }
    town.cells.length = townCells;
  };
}

/** What a held house is told where it can't go. */
export function townMoveMessage(reason: TownMoveBlock): string {
  switch (reason) {
    case "landmark":
      return "The town's landmarks stay where they are";
    case "other-town":
      return "A house stays in its own town";
    case "size":
      return "Houses swap places only with ones their size";
    case "station":
      return "That's the station";
    case "no-street":
      return "A house needs a street beside it";
    case "track":
      return "There's track in the way";
    case "prop":
      return "Something's standing there";
    case "uneven":
      return "The ground isn't level there";
    case "station-way":
      return "That's the way into the station";
    case "taken":
      return "Something's already there";
    default:
      return "A house goes on one of its town's lots";
  }
}

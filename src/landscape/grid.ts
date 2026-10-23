import { RISER_HEIGHT } from "../track";

export const CELL = 72;
/** The world is made of plots (see `docs/superpowers/specs/2026-10-12-expandable-world-design.md`), each this many squares. */
export const PLOT_COLS = 31;
export const PLOT_ROWS = 23;
export const PLOT_CELLS = PLOT_COLS * PLOT_ROWS;
export const PLOT_WIDTH = PLOT_COLS * CELL;
export const PLOT_DEPTH = PLOT_ROWS * CELL;
export const MAX_HEIGHT = 3;

export const SURF_GRASS = 0;
export const SURF_RIVER = 1;
export const SURF_ROAD = 2;
export const SURF_TOWN = 3;
/** A country lane: felt road outside the towns that track may cross (a level crossing). */
export const SURF_LANE = 4;
/** The sea, past the shore (see `coast.ts`): water like a river's. */
export const SURF_SEA = 5;
/** The beach between the grass and the sea: open ground nothing is built on by the map. */
export const SURF_SAND = 6;

/** River or sea. */
export const isWater = (surface: number): boolean => surface === SURF_RIVER || surface === SURF_SEA;

export const FEAT_NONE = 0;
export const FEAT_TREE = 1;
export const FEAT_BUILDING = 2;
export const FEAT_STATION = 3;
/** A fenced paddock with toy animals in it (track goes around). */
export const FEAT_FIELD = 4;
/** The decorative engine shed. */
export const FEAT_SHED = 5;
/** A depot's track and yard (owner: depot id). */
export const FEAT_DEPOT = 6;
/** An old industry's ruined yard and its stub of track (owner: site id; see `MapSite`): cleared, or restored, to use. */
export const FEAT_RUIN = 7;

/** A plot's place in the world: plot (px, pz) covers squares px·PLOT_COLS… and pz·PLOT_ROWS…. */
export interface PlotCoord {
  px: number;
  pz: number;
}

/** One number per plot coordinate (for maps and sets). */
export const plotKey = (px: number, pz: number): number => (px + 32768) * 65536 + (pz + 32768);

/** The plot holding a square. */
export const plotOfCol = (col: number): number => Math.floor(col / PLOT_COLS);
export const plotOfRow = (row: number): number => Math.floor(row / PLOT_ROWS);

/** Squares and world extent of a set of plots (exclusive ends). */
export interface Extent {
  col0: number;
  row0: number;
  col1: number;
  row1: number;
  x0: number;
  z0: number;
  x1: number;
  z1: number;
}

/**
 * The land the player owns, in 72 mm squares (4 × 18, so track lengths fit); a block is a square wide and one riser
 * tall. Squares have global columns and rows (square (col, row) has its centre at ((col + ½)·CELL, (row + ½)·CELL),
 * either may be negative) and are stored plot by plot: a square's index is its plot's slot × PLOT_CELLS plus its
 * place in the plot, row-major. Indices never change once a plot is added, so lists of squares stay valid as the
 * world grows. Squares outside the plots aren't in the grid (`inBounds` is false, `cellAtWorld` gives −1).
 */
export class LandscapeGrid {
  height = new Uint8Array(0);
  surface = new Uint8Array(0);
  feature = new Uint8Array(0);
  /**
   * The road piece on each square (`src/roads`): 0 for none, else its code and quarter turns. A square with a road is
   * `SURF_LANE` (set both with `setRoad`).
   */
  road = new Uint8Array(0);
  /** Building, town, field or depot id for those features, else -1. */
  owner = new Int32Array(0);
  /** The plots, by slot. */
  readonly plots: PlotCoord[] = [];
  /**
   * Goes up whenever a plot is added or any square changes (call `touch`): caches of anything derived from the grid
   * key on it.
   */
  revision = 0;
  /** Per slot: goes up whenever a square in that plot changes (see `touch`). */
  private versions: number[] = [];
  private readonly slots = new Map<number, number>();
  private lastKey = NaN;
  private lastSlot = -1;

  /** Add an empty plot (grass, height 0); returns its slot. Adding one already there returns its slot. */
  addPlot(px: number, pz: number): number {
    const key = plotKey(px, pz);
    const have = this.slots.get(key);
    if (have !== undefined) return have;
    const slot = this.plots.length;
    const n = (slot + 1) * PLOT_CELLS;
    if (n > this.height.length) {
      const cap = Math.max(n, this.height.length * 2, 4 * PLOT_CELLS);
      const grow = <T extends Uint8Array | Int32Array>(a: T, make: (n: number) => T): T => {
        const b = make(cap);
        b.set(a);
        return b;
      };
      this.height = grow(this.height, (k) => new Uint8Array(k));
      this.surface = grow(this.surface, (k) => new Uint8Array(k));
      this.feature = grow(this.feature, (k) => new Uint8Array(k));
      this.road = grow(this.road, (k) => new Uint8Array(k));
      const owner = grow(this.owner, (k) => new Int32Array(k));
      owner.fill(-1, this.owner.length);
      this.owner = owner;
    }
    this.plots.push({ px, pz });
    this.versions.push(0);
    this.slots.set(key, slot);
    this.lastKey = NaN;
    this.revision++;
    return slot;
  }

  hasPlot(px: number, pz: number): boolean {
    return this.slots.has(plotKey(px, pz));
  }

  /** A plot's slot, or −1. */
  slotOf(px: number, pz: number): number {
    const key = plotKey(px, pz);
    if (key === this.lastKey) return this.lastSlot;
    const slot = this.slots.get(key) ?? -1;
    this.lastKey = key;
    this.lastSlot = slot;
    return slot;
  }

  /** Number of squares in the grid (all plots). */
  get cellCount(): number {
    return this.plots.length * PLOT_CELLS;
  }

  /** Index of a square, or −1 if it isn't on the grid. */
  index(col: number, row: number): number {
    const px = Math.floor(col / PLOT_COLS);
    const pz = Math.floor(row / PLOT_ROWS);
    const slot = this.slotOf(px, pz);
    if (slot === -1) return -1;
    return slot * PLOT_CELLS + (row - pz * PLOT_ROWS) * PLOT_COLS + (col - px * PLOT_COLS);
  }

  inBounds(col: number, row: number): boolean {
    return this.slotOf(Math.floor(col / PLOT_COLS), Math.floor(row / PLOT_ROWS)) !== -1;
  }

  /** Column of the square at an index. */
  colOf(i: number): number {
    const slot = (i / PLOT_CELLS) | 0;
    return this.plots[slot].px * PLOT_COLS + ((i - slot * PLOT_CELLS) % PLOT_COLS);
  }

  /** Row of the square at an index. */
  rowOf(i: number): number {
    const slot = (i / PLOT_CELLS) | 0;
    return this.plots[slot].pz * PLOT_ROWS + (((i - slot * PLOT_CELLS) / PLOT_COLS) | 0);
  }

  colAt(x: number): number {
    return Math.floor(x / CELL);
  }

  rowAt(z: number): number {
    return Math.floor(z / CELL);
  }

  /** Cell index under a plan point, or -1 off the grid. */
  cellAtWorld(x: number, z: number): number {
    return this.index(Math.floor(x / CELL), Math.floor(z / CELL));
  }

  centreX(col: number): number {
    return (col + 0.5) * CELL;
  }

  centreZ(row: number): number {
    return (row + 0.5) * CELL;
  }

  groundY(index: number): number {
    return this.height[index] * RISER_HEIGHT;
  }

  /**
   * Put a road piece on a square (or take it off, with 0), keeping its surface in step: road squares are lanes (a road
   * bridge leaves a river square a river), and a lane square left without a road goes back to its ground, `bare`
   * (grass, or the beach's sand: see `groundUnder`). Call `touch` after.
   */
  setRoad(i: number, road: number, bare = SURF_GRASS): void {
    this.road[i] = road;
    if (road !== 0) {
      if (this.surface[i] !== SURF_RIVER) this.surface[i] = SURF_LANE;
    }
    else if (this.surface[i] === SURF_LANE) this.surface[i] = bare;
  }

  /** Call after changing squares of the plot at this slot (or every plot, without one). */
  touch(slot?: number): void {
    this.revision++;
    if (slot === undefined) for (let s = 0; s < this.versions.length; s++) this.versions[s]++;
    else this.versions[slot]++;
  }

  /** How many times the plot at this slot has changed. */
  version(slot: number): number {
    return this.versions[slot];
  }

  /** The squares and world extent covering every plot. */
  extent(): Extent {
    return extentOf(this.plots);
  }

  private neighbourTable: { revision: number; table: Int32Array } | null = null;

  /**
   * Each square's four neighbours (+col, +row, −col, −row) at `i * 4 + d`, −1 off the grid. Built on first use after
   * plots are added (squares changing don't change it).
   */
  neighbours(): Int32Array {
    const plots = this.plots.length;
    if (this.neighbourTable?.revision === plots) return this.neighbourTable.table;
    const table = new Int32Array(this.cellCount * 4);
    this.forEachCell((i, col, row) => {
      table[i * 4] = this.index(col + 1, row);
      table[i * 4 + 1] = this.index(col, row + 1);
      table[i * 4 + 2] = this.index(col - 1, row);
      table[i * 4 + 3] = this.index(col, row - 1);
    });
    this.neighbourTable = { revision: plots, table };
    return table;
  }

  /** Visit every square: index, column, row. */
  forEachCell(visit: (i: number, col: number, row: number) => void): void {
    this.plots.forEach((p, slot) => forEachInPlot(slot, p, visit));
  }
}

/** Visit the squares of one plot (at `slot`): index, column, row. */
export function forEachInPlot(slot: number, p: PlotCoord, visit: (i: number, col: number, row: number) => void): void {
  const base = slot * PLOT_CELLS;
  const c0 = p.px * PLOT_COLS;
  const r0 = p.pz * PLOT_ROWS;
  for (let r = 0; r < PLOT_ROWS; r++) for (let c = 0; c < PLOT_COLS; c++) visit(base + r * PLOT_COLS + c, c0 + c, r0 + r);
}

/** The squares and world extent covering some plots (an empty extent for none). */
export function extentOf(plots: readonly PlotCoord[]): Extent {
  let px0 = Infinity;
  let pz0 = Infinity;
  let px1 = -Infinity;
  let pz1 = -Infinity;
  for (const p of plots) {
    px0 = Math.min(px0, p.px);
    pz0 = Math.min(pz0, p.pz);
    px1 = Math.max(px1, p.px + 1);
    pz1 = Math.max(pz1, p.pz + 1);
  }
  if (plots.length === 0) px0 = pz0 = px1 = pz1 = 0;
  const col0 = px0 * PLOT_COLS;
  const row0 = pz0 * PLOT_ROWS;
  const col1 = px1 * PLOT_COLS;
  const row1 = pz1 * PLOT_ROWS;
  return { col0, row0, col1, row1, x0: col0 * CELL, z0: row0 * CELL, x1: col1 * CELL, z1: row1 * CELL };
}

/** An empty grid (flat grass) of w × h plots from plot (px0, pz0). */
export function gridWithPlots(px0: number, pz0: number, w: number, h: number): LandscapeGrid {
  const grid = new LandscapeGrid();
  for (let pz = pz0; pz < pz0 + h; pz++) for (let px = px0; px < px0 + w; px++) grid.addPlot(px, pz);
  return grid;
}

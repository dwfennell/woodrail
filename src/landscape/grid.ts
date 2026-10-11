import { RISER_HEIGHT } from "../track";

export const CELL = 64;
export const COLS = 70;
export const ROWS = 52;
export const MAT_WIDTH = COLS * CELL;
export const MAT_DEPTH = ROWS * CELL;
export const MAX_HEIGHT = 3;

export const SURF_GRASS = 0;
export const SURF_RIVER = 1;
export const SURF_ROAD = 2;
export const SURF_TOWN = 3;

export const FEAT_NONE = 0;
export const FEAT_TREE = 1;
export const FEAT_BUILDING = 2;
export const FEAT_STATION = 3;

const X0 = -MAT_WIDTH / 2;
const Z0 = -MAT_DEPTH / 2;

/** The felt mat divided into 64 mm squares (one block = one riser height). Flat typed arrays, row-major. */
export class LandscapeGrid {
  readonly height = new Uint8Array(COLS * ROWS);
  readonly surface = new Uint8Array(COLS * ROWS);
  readonly feature = new Uint8Array(COLS * ROWS);
  /** Building or town id for building/station features, else -1. */
  readonly owner = new Int16Array(COLS * ROWS).fill(-1);

  index(col: number, row: number): number {
    return row * COLS + col;
  }

  inBounds(col: number, row: number): boolean {
    return col >= 0 && col < COLS && row >= 0 && row < ROWS;
  }

  colAt(x: number): number {
    return Math.floor((x - X0) / CELL);
  }

  rowAt(z: number): number {
    return Math.floor((z - Z0) / CELL);
  }

  /** Cell index under a plan point, or -1 off the mat. */
  cellAtWorld(x: number, z: number): number {
    const c = this.colAt(x);
    const r = this.rowAt(z);
    return this.inBounds(c, r) ? r * COLS + c : -1;
  }

  centreX(col: number): number {
    return X0 + (col + 0.5) * CELL;
  }

  centreZ(row: number): number {
    return Z0 + (row + 0.5) * CELL;
  }

  groundY(index: number): number {
    return this.height[index] * RISER_HEIGHT;
  }
}

import { rng } from "../lib/rng";
import { PLOT_COLS, PLOT_ROWS } from "./grid";

/**
 * What crosses the edge between two plots, square by square along it: the same for the plots on both sides, worked
 * out from the seed and the edge alone, so they agree whichever is generated first. Rivers and lanes cross straight,
 * running `STUB_DEPTH` squares into each plot (the "stub"), where each plot's own rivers and lanes take over.
 */
export interface EdgeContract {
  /** Positions along the edge (squares from its start) where a river crosses. */
  rivers: number[];
  /** Positions where a country lane crosses. */
  lanes: number[];
}

/** How far a crossing river or lane runs straight into each plot. */
export const STUB_DEPTH = 4;
/**
 * Squares this close to a plot's edge hold nothing that flattens the hills (towns, depots, rivers, lanes) but the
 * crossings: so the hill heights there depend only on the hill noise and the crossings, and match across the edge.
 * (A hill square is never more than `MAX_HEIGHT` above flat ground, so flat ground further in can't reach it.)
 */
export const BORDER_BAND = 3;
/** Crossings keep this far from the ends of an edge, so stubs from edges meeting at a corner stay apart. */
const CORNER_GAP = 5;
const RIVER_CHANCE = 0.38;
const LANE_CHANCE = 0.42;

/** A small integer hash of a few integers. */
export function hashInts(...v: number[]): number {
  let h = 0x811c9dc5;
  for (const x of v) {
    h = Math.imul(h ^ (x | 0), 0x01000193) >>> 0;
    h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d) >>> 0;
    h = (h ^ (h >>> 12)) >>> 0;
  }
  return h >>> 0;
}

const contracts = new Map<string, EdgeContract>();

/**
 * The contract of one edge. A vertical edge (`vertical`) is the west edge of plot (px, pz), running along z
 * (`PLOT_ROWS` long); otherwise it's the north edge of plot (px, pz), running along x (`PLOT_COLS` long).
 */
export function edgeContract(seed: number, vertical: boolean, px: number, pz: number): EdgeContract {
  const key = `${seed},${vertical ? 1 : 0},${px},${pz}`;
  const have = contracts.get(key);
  if (have) return have;
  const random = rng(hashInts(seed, vertical ? 1 : 2, px, pz, 0x5eed));
  const length = vertical ? PLOT_ROWS : PLOT_COLS;
  const span = length - 2 * CORNER_GAP;
  const at = () => CORNER_GAP + Math.floor(random() * span);
  const rivers: number[] = [];
  const lanes: number[] = [];
  if (random() < RIVER_CHANCE) rivers.push(at());
  if (random() < LANE_CHANCE) {
    const lane = at();
    if (rivers.every((r) => Math.abs(r - lane) >= 3)) lanes.push(lane);
  }
  const contract = { rivers, lanes };
  if (contracts.size > 4096) contracts.clear();
  contracts.set(key, contract);
  return contract;
}

/** A crossing's squares on one side of its edge, from the edge inward, and which kind it is. */
export interface Stub {
  kind: "river" | "lane";
  /** Squares (col, row), the first on the edge, the last `STUB_DEPTH − 1` in. */
  cells: [number, number][];
}

/** A rectangle of plots: (px0, pz0) and w × h plots. */
export interface Region {
  px0: number;
  pz0: number;
  w: number;
  h: number;
}

/**
 * The crossings on a region's outer edges: their stubs inside the region (`inside`) and inside the neighbouring plots
 * (`outside`, which flatten the hills on the far side the same way).
 */
export function regionStubs(seed: number, r: Region): { inside: Stub[]; outside: Stub[] } {
  const inside: Stub[] = [];
  const outside: Stub[] = [];
  const add = (kind: Stub["kind"], vertical: boolean, along: number, edge: number, inward: 1 | -1) => {
    const a: [number, number][] = [];
    const b: [number, number][] = [];
    for (let d = 0; d < STUB_DEPTH; d++) {
      const into = inward > 0 ? edge + d : edge - 1 - d;
      const out = inward > 0 ? edge - 1 - d : edge + d;
      a.push(vertical ? [into, along] : [along, into]);
      b.push(vertical ? [out, along] : [along, out]);
    }
    inside.push({ kind, cells: a });
    outside.push({ kind, cells: b });
  };
  const edge = (vertical: boolean, px: number, pz: number, inward: 1 | -1) => {
    const c = edgeContract(seed, vertical, px, pz);
    const start = vertical ? pz * PLOT_ROWS : px * PLOT_COLS;
    const line = vertical ? px * PLOT_COLS : pz * PLOT_ROWS;
    for (const k of c.rivers) add("river", vertical, start + k, line, inward);
    for (const k of c.lanes) add("lane", vertical, start + k, line, inward);
  };
  for (let px = r.px0; px < r.px0 + r.w; px++) {
    edge(false, px, r.pz0, 1);
    edge(false, px, r.pz0 + r.h, -1);
  }
  for (let pz = r.pz0; pz < r.pz0 + r.h; pz++) {
    edge(true, r.px0, pz, 1);
    edge(true, r.px0 + r.w, pz, -1);
  }
  return { inside, outside };
}

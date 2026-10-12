import { rng } from "../lib/rng";
import { RISER_HEIGHT } from "../track";
import { CELL } from "./grid";
import { valueNoise } from "./noise";
import { mergeSlabs, type Slab } from "./slabs";

/**
 * The scenery around the land: toy hills, trees and hamlets that run off toward the horizon, where the haze swallows
 * them. Decoration only — nothing outside the land can be built on. Deterministic per seed and rectangle.
 */

/** How far the scenery reaches beyond the mat's edge (mm): whole far-band squares, so they keep the mat's grid. */
export const RING_WIDTH = 21 * 2 * CELL;
/** A flat strip of felt just outside the mat's hem, so the edge of the buildable area reads. */
export const SCENERY_MARGIN = 2 * CELL;
/** The near band uses normal blocks; beyond it, double-size blocks build up into "mountains". */
const NEAR_WIDTH = 11 * 2 * CELL;
const BIG = 2 * CELL;
const NEAR_MAX = 3;
const FAR_MAX = 6;
const HOUSE_CLEARANCE = 24;

export interface OuterBlock {
  /** Centre of the block's square. */
  x: number;
  z: number;
  /** Bottom of the block. */
  y: number;
  /** Width and depth of the block's square. */
  size: number;
  /** Height of the block: the mat's proportions, a riser per square (so double in the far band). */
  height: number;
  /** Top block of its stack (painted green on top). */
  top: boolean;
  /** Arbitrary number for picking a colour tone. */
  tone: number;
}

export interface OuterTree {
  x: number;
  z: number;
  /** Ground height under the tree. */
  y: number;
  scale: number;
  /** Arbitrary number in [0, 1) for picking a shape and colour. */
  variant: number;
}

export interface OuterHouse {
  cx: number;
  cz: number;
  w: number;
  d: number;
  floors: 1 | 2;
  roof: number;
  /** Unit direction the front door faces. */
  front: { x: number; z: number };
}

export interface Surroundings {
  blocks: OuterBlock[];
  trees: OuterTree[];
  houses: OuterHouse[];
  hamlets: number;
  /** Merged rectangles of the near hills, for cheap shadow casting. */
  slabs: Slab[];
}

/** A rectangle in plan (world mm). */
export interface Rect {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
}

/** Distance (mm) from a plan point to a rectangle (the land's); 0 inside it. */
export function outsideDistance(x: number, z: number, land: Rect): number {
  return Math.hypot(Math.max(land.x0 - x, x - land.x1, 0), Math.max(land.z0 - z, z - land.z1, 0));
}

const overlaps = (a: Rect, b: Rect) => a.x0 < b.x1 && b.x0 < a.x1 && a.z0 < b.z1 && b.z0 < a.z1;

/** Distance from the land to the nearest point of a square centred at (x, z). */
function squareDistance(x: number, z: number, size: number, land: Rect): number {
  return outsideDistance(x, z, { x0: land.x0 - size / 2, z0: land.z0 - size / 2, x1: land.x1 + size / 2, z1: land.z1 + size / 2 });
}

/** A square lattice of block columns around the land. */
interface Lattice {
  size: number;
  cols: number;
  rows: number;
  x0: number;
  z0: number;
  height: Uint8Array;
  /** 1 where scenery may stand. */
  open: Uint8Array;
}

function lattice(size: number, land: Rect, reach: number): Lattice {
  const x0 = Math.floor((land.x0 - reach) / size) * size;
  const z0 = Math.floor((land.z0 - reach) / size) * size;
  const cols = Math.ceil((land.x1 + reach - x0) / size);
  const rows = Math.ceil((land.z1 + reach - z0) / size);
  return { size, cols, rows, x0, z0, height: new Uint8Array(cols * rows), open: new Uint8Array(cols * rows) };
}

const cx = (l: Lattice, c: number) => l.x0 + (c + 0.5) * l.size;
const cz = (l: Lattice, r: number) => l.z0 + (r + 0.5) * l.size;

/**
 * Lower any column more than one block above a neighbour. Closed cells inside the lattice count as flat ground when
 * `closedIsGround` (the margin beside the mat); otherwise they, like cells past the lattice's edge, belong to the
 * other band and don't hold the hills down.
 */
function relax(l: Lattice, closedIsGround: boolean): void {
  const at = (c: number, r: number) => {
    if (c < 0 || r < 0 || c >= l.cols || r >= l.rows) return Infinity;
    const i = r * l.cols + c;
    return l.open[i] ? l.height[i] : closedIsGround ? 0 : Infinity;
  };
  let changed = true;
  while (changed) {
    changed = false;
    for (let r = 0; r < l.rows; r++) {
      for (let c = 0; c < l.cols; c++) {
        const i = r * l.cols + c;
        if (!l.open[i]) continue;
        const min = Math.min(at(c + 1, r), at(c - 1, r), at(c, r + 1), at(c, r - 1));
        if (l.height[i] > min + 1) {
          l.height[i] = min + 1;
          changed = true;
        }
      }
    }
  }
}

function placeHamlets(random: () => number, land: Rect): { houses: OuterHouse[]; count: number } {
  const mx = (land.x0 + land.x1) / 2;
  const mz = (land.z0 + land.z1) / 2;
  const hw = (land.x1 - land.x0) / 2;
  const hd = (land.z1 - land.z0) / 2;
  const count = random() < 0.5 ? 3 : 4;
  const centres: { x: number; z: number; out: { x: number; z: number } }[] = [];
  let guard = 0;
  while (centres.length < count && guard++ < 200) {
    const side = Math.floor(random() * 4);
    const d = 450 + random() * 600;
    const along = (random() * 2 - 1) * 0.8;
    const out = [{ x: 1, z: 0 }, { x: -1, z: 0 }, { x: 0, z: 1 }, { x: 0, z: -1 }][side];
    const x = mx + (out.x !== 0 ? out.x * (hw + d) : along * hw);
    const z = mz + (out.z !== 0 ? out.z * (hd + d) : along * hd);
    if (centres.some((c) => Math.hypot(c.x - x, c.z - z) < 1100)) continue;
    centres.push({ x, z, out });
  }
  const houses: OuterHouse[] = [];
  const spots = [[0, 0], [-130, 0], [130, 0], [0, -130], [0, 130], [-130, -130], [130, 130], [130, -130], [-130, 130]];
  for (const h of centres) {
    const want = 2 + Math.floor(random() * 3);
    const mine: OuterHouse[] = [];
    for (const [ox, oz] of spots) {
      if (mine.length >= want) break;
      if (random() < 0.35 && !(ox === 0 && oz === 0)) continue;
      const wide = random() < 0.4;
      const alongX = random() < 0.5;
      const w = wide && alongX ? 116 : 52;
      const d = wide && !alongX ? 116 : 52;
      const house: OuterHouse = {
        cx: h.x + ox,
        cz: h.z + oz,
        w,
        d,
        floors: random() < 0.35 ? 2 : 1,
        roof: Math.floor(random() * 4),
        // The middle house faces the mat; the others face the middle of the hamlet.
        front: ox === 0 && oz === 0 ? { x: -h.out.x, z: -h.out.z } : Math.abs(ox) >= Math.abs(oz) ? { x: -Math.sign(ox), z: 0 } : { x: 0, z: -Math.sign(oz) },
      };
      const r = houseRect(house, 12);
      if (mine.some((m) => overlaps(r, houseRect(m, 12)))) continue;
      mine.push(house);
    }
    houses.push(...mine);
  }
  return { houses, count: centres.length };
}

function houseRect(h: OuterHouse, pad: number): Rect {
  return { x0: h.cx - h.w / 2 - pad, x1: h.cx + h.w / 2 + pad, z0: h.cz - h.d / 2 - pad, z1: h.cz + h.d / 2 + pad };
}

/** The scenery around a rectangle of land (`margin`: a flat strip of felt left just outside it). */
export function generateSurroundings(seed: number, land: Rect, margin = SCENERY_MARGIN): Surroundings {
  const random = rng(seed * 977 + 31);
  const { houses, count: hamlets } = placeHamlets(random, land);
  const clear = houses.map((h) => houseRect(h, HOUSE_CLEARANCE));
  const cleared = (x: number, z: number, half: number) => clear.some((r) => overlaps(r, { x0: x - half, x1: x + half, z0: z - half, z1: z + half }));

  const hill = valueNoise(seed * 29 + 3);
  const near = lattice(CELL, land, NEAR_WIDTH);
  const far = lattice(BIG, land, RING_WIDTH);
  const nearRect: Rect = { x0: near.x0, z0: near.z0, x1: near.x0 + near.cols * CELL, z1: near.z0 + near.rows * CELL };

  for (let r = 0; r < near.rows; r++) {
    for (let c = 0; c < near.cols; c++) {
      const x = cx(near, c);
      const z = cz(near, r);
      // Never on the land itself (whatever the margin), nor within the margin of it.
      if (outsideDistance(x, z, land) < CELL / 2 || squareDistance(x, z, CELL, land) < margin) continue;
      const i = r * near.cols + c;
      near.open[i] = 1;
      if (cleared(x, z, CELL / 2)) continue;
      const d = outsideDistance(x, z, land);
      const n = hill(x / 512, z / 512) * 0.7 + hill(x / 220 + 17, z / 220 + 5) * 0.3;
      const ramp = Math.min(1, Math.max(0, d - margin) / 1400);
      near.height[i] = Math.max(0, Math.min(NEAR_MAX, Math.floor((n - 0.5 + 0.35 * ramp) * 7)));
    }
  }
  relax(near, true);

  for (let r = 0; r < far.rows; r++) {
    for (let c = 0; c < far.cols; c++) {
      const x = cx(far, c);
      const z = cz(far, r);
      const half = BIG / 2;
      // The near band has this square; the round corners of the ring stop at its outer edge.
      if (overlaps({ x0: x - half, x1: x + half, z0: z - half, z1: z + half }, nearRect)) continue;
      const d = outsideDistance(x, z, land);
      if (d > RING_WIDTH) continue;
      const i = r * far.cols + c;
      far.open[i] = 1;
      const n = hill(x / 700 + 40, z / 700 + 40) * 0.65 + hill(x / 300 + 71, z / 300 + 13) * 0.35;
      const ramp = Math.min(1, Math.max(0, (d - NEAR_WIDTH) / 1536));
      far.height[i] = Math.max(0, Math.min(FAR_MAX, Math.floor((n - 0.38 + 0.45 * ramp) * 8)));
    }
  }
  relax(far, false);

  const blocks: OuterBlock[] = [];
  const trees: OuterTree[] = [];
  const treeNoise = valueNoise(seed * 31 + 11);
  for (const l of [near, far]) {
    const nearBand = l === near;
    const at = (c: number, r: number) => (c < 0 || r < 0 || c >= l.cols || r >= l.rows || !l.open[r * l.cols + c] ? 0 : l.height[r * l.cols + c]);
    for (let r = 0; r < l.rows; r++) {
      for (let c = 0; c < l.cols; c++) {
        const i = r * l.cols + c;
        if (!l.open[i]) continue;
        const x = cx(l, c);
        const z = cz(l, r);
        const h = l.height[i];
        const bh = l.size * (RISER_HEIGHT / CELL);
        // A block below the top shows only where a neighbouring column is lower than its own top.
        const lowest = Math.min(at(c + 1, r), at(c - 1, r), at(c, r + 1), at(c, r - 1));
        for (let level = 0; level < h; level++) {
          if (level < h - 1 && lowest > level) continue;
          blocks.push({ x, z, y: level * bh, size: l.size, height: bh, top: level === h - 1, tone: Math.floor(random() * 1024) });
        }
        const jitter = l.size / 4;
        if (cleared(x, z, l.size / 2 + 30)) continue;
        if (treeNoise(x / 320, z / 320) > 0.64 && random() < (nearBand ? 0.32 : 0.24)) {
          trees.push({
            x: x + (random() * 2 - 1) * jitter,
            z: z + (random() * 2 - 1) * jitter,
            y: h * bh,
            scale: nearBand ? 0.9 + random() * 0.4 : 1.4 + random() * 0.6,
            variant: random(),
          });
        }
      }
    }
  }

  const slabs = mergeSlabs((c, r) => near.height[r * near.cols + c], near.cols, near.rows, near.x0, near.z0, CELL, NEAR_MAX);
  return { blocks, trees, houses, hamlets, slabs };
}

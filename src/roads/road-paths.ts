import { CELL, SURF_ROAD, type Landscape } from "../landscape";
import { RISER_HEIGHT } from "../track";
import { roadAt } from "./graph";
import { pieceOf, roadsJoin, turnOf, type Edge } from "./pieces";
import type { PathHold, RoadPath } from "./vehicles";

/**
 * Road paths for vehicles (roads spec §3): a breadth-first search over the road graph (a node per road square, an edge
 * where two pieces meet: `roadsJoin`, heights and ramps included, as `townLinks` uses), and the polyline a vehicle
 * drives along it, keeping to the left. Worked out on a road edit, never per trip or per frame: `RoadPathCache` keys
 * them by the grid's revision (every road edit bumps it) and the crossings.
 */

/** How far a van reaches (roads spec D5): road squares outside towns (a town's own streets don't count). */
export const VAN_REACH = 8;
/** The top of a road's felt (mm above its square's ground). */
const ROAD_TOP = 4.3;
/**
 * How far from the road's middle a vehicle keeps, to the left (the other way passes on the other side): the middle of
 * its lane on a town street (felt 20 each side, `STREET_FELT_HALF`), near the kerb on a country lane (28). It keeps to it
 * all the way, ends included: it parks there, at the kerb (a turn round is joined on when it sets off: `joinFrom`).
 */
export const KEEP_LEFT = 12;
/** Half a block: each ramp half climbs this much over its square. */
const HALF_BLOCK = RISER_HEIGHT / 2;
/** A road bridge's hump at its middle (as drawn: `render/dressing/roads.ts`). */
const HUMP = 9;
/** Points per square (a bend's curve). */
const STEPS = 6;
/** A vehicle waiting for a crossing stops this far short of its first square's edge (the gates stand just outside it). */
const HOLD_BACK = 30;

const H = CELL / 2;
const EDGE_DX = [1, 0, -1, 0];
const EDGE_DZ = [0, 1, 0, -1];

/** Is square `i` a town's street (free to drive: it doesn't count toward a van's reach)? */
const isStreet = (land: Landscape, i: number) => land.grid.surface[i] === SURF_ROAD;

/**
 * The road squares from one of `from` to the nearest square `goal` says yes to, joined all the way (each step a pair of
 * pieces that meet), using at most `reach` squares that aren't town streets; null if there's none. A 0-1 search: town
 * streets cost nothing, other road squares one.
 */
export function findRoadSquares(land: Landscape, from: readonly number[], goal: (i: number) => boolean, reach = VAN_REACH): number[] | null {
  const g = land.grid;
  const nb = g.neighbours();
  const cost = new Map<number, number>();
  const prev = new Map<number, number>();
  const deque: number[] = [];
  let head = 0;
  for (const s of from) {
    if (roadAt(land, s) === 0 || cost.has(s)) continue;
    cost.set(s, 0);
    prev.set(s, -1);
    deque.push(s);
  }
  // A deque as an array with a head: 0-cost steps go in front (by putting them at the head), 1-cost at the back.
  while (head < deque.length) {
    const i = deque[head++];
    const c = cost.get(i)!;
    if (goal(i)) {
      const out: number[] = [];
      for (let k = i; k !== -1; k = prev.get(k)!) out.push(k);
      return out.reverse();
    }
    const a = roadAt(land, i);
    for (let e = 0; e < 4; e++) {
      const j = nb[i * 4 + e];
      if (j === -1) continue;
      const b = roadAt(land, j);
      if (b === 0 || !roadsJoin(a, e as Edge, b, g.height[j] - g.height[i])) continue;
      const step = isStreet(land, j) ? 0 : 1;
      const cj = c + step;
      if (cj > reach) continue;
      const had = cost.get(j);
      if (had !== undefined && had <= cj) continue;
      cost.set(j, cj);
      prev.set(j, i);
      if (step === 0) deque.splice(head, 0, j);
      else deque.push(j);
    }
  }
  return null;
}

/** The edge of square `i` facing its neighbour `j` (−1 if they aren't side by side). */
function edgeTo(land: Landscape, i: number, j: number): number {
  const nb = land.grid.neighbours();
  for (let e = 0; e < 4; e++) if (nb[i * 4 + e] === j) return e;
  return -1;
}

/** How high the road on square `i` is at local point (x, z) from its middle, above its ground: ramps climb, bridges hump. */
function roadRise(road: number, x: number, z: number): number {
  const def = pieceOf(road);
  if (!def) return 0;
  if (!def.ramp && !def.overRiver) return 0;
  // The piece's own +x, turned: along a ramp's climb, or across a bridge's river.
  const e = turnOf(road) & 3;
  const along = x * EDGE_DX[e] + z * EDGE_DZ[e];
  if (def.overRiver) {
    const c = Math.cos((Math.PI * along) / CELL);
    return HUMP * c * c;
  }
  const from = def.id === "ramp-low" ? 0 : HALF_BLOCK;
  return from + (HALF_BLOCK * (Math.max(-H, Math.min(H, along)) + H)) / CELL;
}

/**
 * The polyline along road squares `squares` (in order, each joined to the next): from the middle of the first to the
 * middle of the last, through the middles of the edges between, curving round bends; kept `KEEP_LEFT` to the left of
 * the road's middle all the way (it parks there, by the kerb). `crossing` says which squares are a level crossing's: a
 * vehicle holds short of each run of them while it's shut (`PathHold`).
 */
export function roadPath(land: Landscape, squares: readonly number[], crossing: (i: number) => boolean = () => false): RoadPath {
  const g = land.grid;
  const xs: number[] = [];
  const ys: number[] = [];
  const zs: number[] = [];
  /** The index of the first point in each square (where its entry edge is). */
  const firstPt: number[] = [];
  for (let k = 0; k < squares.length; k++) {
    const i = squares[k];
    const cx = g.centreX(g.colOf(i));
    const cz = g.centreZ(g.rowOf(i));
    const ein = k > 0 ? edgeTo(land, i, squares[k - 1]) : -1;
    const eout = k < squares.length - 1 ? edgeTo(land, i, squares[k + 1]) : -1;
    // A quadratic curve from the entry edge's middle (or the square's middle) to the exit edge's, about the middle.
    const p0x = ein === -1 ? 0 : EDGE_DX[ein] * H;
    const p0z = ein === -1 ? 0 : EDGE_DZ[ein] * H;
    const p2x = eout === -1 ? 0 : EDGE_DX[eout] * H;
    const p2z = eout === -1 ? 0 : EDGE_DZ[eout] * H;
    const road = roadAt(land, i);
    const ground = g.groundY(i) + ROAD_TOP;
    firstPt.push(xs.length);
    const steps = ein === -1 || eout === -1 ? STEPS / 2 : STEPS;
    for (let s = k === 0 ? 0 : 1; s <= steps; s++) {
      const u = s / steps;
      const a = (1 - u) * (1 - u);
      const c = u * u;
      // (Control point at the middle: 0.)
      const lx = a * p0x + c * p2x;
      const lz = a * p0z + c * p2z;
      xs.push(cx + lx);
      zs.push(cz + lz);
      ys.push(ground + roadRise(road, lx, lz));
    }
  }
  const n = xs.length;
  const pts = new Float32Array(n * 3);
  for (let k = 0; k < n; k++) {
    const a = Math.max(0, k - 1);
    const b = Math.min(n - 1, k + 1);
    let dx = xs[b] - xs[a];
    let dz = zs[b] - zs[a];
    const len = Math.hypot(dx, dz) || 1;
    dx /= len;
    dz /= len;
    // Left of the way it faces (y up): (dz, −dx).
    pts[k * 3] = xs[k] + dz * KEEP_LEFT;
    pts[k * 3 + 1] = ys[k];
    pts[k * 3 + 2] = zs[k] - dx * KEEP_LEFT;
  }
  const at = new Float32Array(n);
  for (let k = 1; k < n; k++) at[k] = at[k - 1] + Math.hypot(pts[k * 3] - pts[k * 3 - 3], pts[k * 3 + 1] - pts[k * 3 - 2], pts[k * 3 + 2] - pts[k * 3 - 1]);
  const holds: PathHold[] = [];
  for (let k = 1; k < squares.length; k++) {
    if (!crossing(squares[k]) || crossing(squares[k - 1])) continue;
    holds.push({ at: Math.max(0, at[firstPt[k]] - HOLD_BACK), square: squares[k] });
  }
  return { squares, pts, at, length: at[n - 1] ?? 0, holds };
}

/**
 * Paths cached by the grid's revision (a road edit bumps it) and a version of the crossings (track edits move them):
 * a key per trip (from, to), worked out once until either changes.
 */
export class RoadPathCache {
  private revision = -1;
  private crossings = -1;
  private readonly paths = new Map<string, RoadPath | null>();
  /** Searches run (for tests and measuring: a road edit should cost one search per trip, not one per frame). */
  searches = 0;

  /** The cached path for `key`, worked out by `make` if the land or crossings changed since (null: no way). */
  get(land: Landscape, crossings: number, key: string, make: () => RoadPath | null): RoadPath | null {
    if (land.grid.revision !== this.revision || crossings !== this.crossings) {
      this.paths.clear();
      this.revision = land.grid.revision;
      this.crossings = crossings;
    }
    if (this.paths.has(key)) return this.paths.get(key)!;
    this.searches++;
    const path = make();
    this.paths.set(key, path);
    return path;
  }

  /** Has the land or the crossings changed since the paths were worked out? */
  stale(land: Landscape, crossings: number): boolean {
    return land.grid.revision !== this.revision || crossings !== this.crossings;
  }
}

/** Points on the join `joinFrom` adds. */
const JOIN_STEPS = 10;

/**
 * `path` with a join onto its start from where a vehicle stands, facing `heading` (0 faces +x): a smooth curve (a cubic
 * whose ends follow the vehicle's way and the path's), so pulling out from the kerb, or turning round at the end of a
 * trip to come back on the other side, is a turn, not a jump. The same path if it already starts there. A new path
 * (the cached one is shared): worked out once a trip, never per frame.
 */
export function joinFrom(path: RoadPath, x: number, y: number, z: number, heading: number): RoadPath {
  const { pts } = path;
  const n = pts.length / 3;
  if (n < 2) return path;
  const bx = pts[0];
  const bz = pts[2];
  const dist = Math.hypot(bx - x, bz - z);
  if (dist < 0.5) return path;
  const ax = Math.cos(heading);
  const az = -Math.sin(heading);
  let tx = pts[3] - bx;
  let tz = pts[5] - bz;
  const tl = Math.hypot(tx, tz) || 1;
  tx /= tl;
  tz /= tl;
  // Handles: half the way across, longer for a turn round (it swings out ahead before coming back).
  const back = ax * tx + az * tz < -0.3;
  const h = back ? Math.max(18, dist * 0.6) : Math.min(24, Math.max(6, dist * 0.5));
  const p1x = x + ax * h;
  const p1z = z + az * h;
  const p2x = bx - tx * h;
  const p2z = bz - tz * h;
  const out = new Float32Array((JOIN_STEPS + n) * 3);
  for (let s = 0; s < JOIN_STEPS; s++) {
    const u = s / JOIN_STEPS;
    const a = (1 - u) ** 3;
    const b = 3 * (1 - u) ** 2 * u;
    const c = 3 * (1 - u) * u * u;
    const d = u ** 3;
    out[s * 3] = a * x + b * p1x + c * p2x + d * bx;
    out[s * 3 + 1] = y + (pts[1] - y) * u;
    out[s * 3 + 2] = a * z + b * p1z + c * p2z + d * bz;
  }
  out.set(pts, JOIN_STEPS * 3);
  const m = JOIN_STEPS + n;
  const at = new Float32Array(m);
  for (let k = 1; k < m; k++) at[k] = at[k - 1] + Math.hypot(out[k * 3] - out[k * 3 - 3], out[k * 3 + 1] - out[k * 3 - 2], out[k * 3 + 2] - out[k * 3 - 1]);
  const shift = at[JOIN_STEPS];
  return { squares: path.squares, pts: out, at, length: at[m - 1], holds: path.holds.map((hd) => ({ ...hd, at: hd.at + shift })), lead: (path.lead ?? 0) + shift };
}

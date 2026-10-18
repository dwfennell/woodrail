import { BoxGeometry, BufferAttribute, BufferGeometry, Color, CylinderGeometry, ExtrudeGeometry, Group, Mesh, MeshStandardMaterial, Shape, SphereGeometry, type Material } from "three";
import { CELL, type LandscapeGrid } from "../../landscape";
import { pieceOf, ROAD_PIECES, turnOf, type RoadPieceId } from "../../roads";
import { RISER_HEIGHT } from "../../track";
import { FELT_TILE, type Materials } from "../materials";
import { setCullRects, TILE_DEPTH, TILE_WIDTH, tileAt } from "./tiles";
import { nonIndexed } from "../non-indexed";

/**
 * Road pieces drawn on their squares: a beech board, grey felt on it and white paint, one merged mesh per material per
 * tile (2 × 2 plots) so the camera skips tiles out of view. A tile is built again only when its squares' road bytes
 * change (kept in the cache), so placing a piece rebuilds one tile. See
 * `docs/superpowers/specs/2026-10-12-road-system-design.md`.
 */

const H = CELL / 2;
/** Board and felt half-widths across the road, and their heights (mm). */
const BOARD_HALF = 32;
const FELT_HALF = 28;
const BOARD_TOP = 3;
const FELT_TOP = 4;
const PAINT_TOP = 4.3;
/** Zebra beacon pole height above the board. */
const POLE = 26;

/** The materials a road is drawn in, by slot. */
export interface RoadMaterials {
  board: Material;
  felt: Material;
  paint: Material;
  /** Black bands on the zebra beacons' poles. */
  dark: Material;
  /** The beacons' amber globes (they glow, and blink on frames drawn anyway: see `pulseBeacons`). */
  beacon: Material;
}
const SLOTS = ["board", "felt", "paint", "dark", "beacon"] as const;

const beacons = new WeakMap<Materials, MeshStandardMaterial>();
/** Beacon glow, off and on (a lit globe is never dark: the last frame drawn may hold either). */
const BEACON_OFF = 0.35;
const BEACON_ON = 1.4;
/** Blinks per second. */
const BEACON_RATE = 1.2;

/** The game's road materials: beech board, road felt, white paint. */
export function roadMaterials(mats: Materials): RoadMaterials {
  let beacon = beacons.get(mats);
  if (!beacon) {
    beacon = new MeshStandardMaterial({ color: new Color("#f2a530"), emissive: new Color("#ffad2e"), emissiveIntensity: BEACON_ON, roughness: 0.35 });
    beacons.set(mats, beacon);
  }
  return { board: mats.naturalWood, felt: mats.roadFelt, paint: mats.lacquer("#f6f1e6"), dark: mats.lacquer("#2b2b2b"), beacon };
}

/**
 * Blink the zebra beacons, for a frame about to be drawn at time `t` (seconds). Called only on frames drawn anyway (a
 * train running, the camera moving): it never asks for a frame, so a still scene costs nothing. One uniform.
 */
export function pulseBeacons(mats: Materials, t: number): void {
  const m = beacons.get(mats);
  if (m) m.emissiveIntensity = (t * BEACON_RATE) % 1 < 0.5 ? BEACON_ON : BEACON_OFF;
}

/**
 * One road piece (a road byte) as meshes centred on (0, 0), for a piece held in the hand. Its geometry belongs to the
 * group (dispose it with the group).
 */
export function roadPieceGroup(road: number, mats: RoadMaterials): Group {
  const group = new Group();
  const square: Square = { col: 0, row: 0, road, y: 0 };
  SLOTS.forEach((slot) => {
    const g = tileGeometry([square], slot);
    if (!g) return;
    g.translate(-CELL / 2, 0, -CELL / 2);
    const mesh = new Mesh(g, mats[slot]);
    mesh.castShadow = true;
    group.add(mesh);
  });
  return group;
}
type SlotName = (typeof SLOTS)[number];

/** One piece's geometry at turn 0, centred on its square: flat arrays of triangle vertices per slot. */
interface PieceMesh {
  position: Float32Array;
  normal: Float32Array;
  uv: Float32Array;
}

const box = (x0: number, x1: number, z0: number, z1: number, y0: number, y1: number): BufferGeometry =>
  new BoxGeometry(x1 - x0, y1 - y0, z1 - z0).translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);

/** A slab of a flat outline (plan points) from y0 to y1. */
function slab(points: readonly { x: number; z: number }[], y0: number, y1: number): BufferGeometry {
  // Shape space is (x, −z): extruded along +z, then turned −90° about x, it stands on the ground.
  const shape = new Shape();
  shape.moveTo(points[0].x, -points[0].z);
  for (let i = 1; i < points.length; i++) shape.lineTo(points[i].x, -points[i].z);
  const g = new ExtrudeGeometry(shape, { depth: y1 - y0, bevelEnabled: false });
  g.rotateX(-Math.PI / 2);
  g.translate(0, y0, 0);
  return g;
}

/** A quarter ring about the square's corner (−H, +H), from the west edge round to the south edge. */
function quarterRing(r0: number, r1: number, y0: number, y1: number): BufferGeometry {
  const steps = 12;
  const pts: { x: number; z: number }[] = [];
  for (let k = 0; k <= steps; k++) {
    const a = (k / steps) * (Math.PI / 2);
    pts.push({ x: -H + r1 * Math.sin(a), z: H - r1 * Math.cos(a) });
  }
  for (let k = steps; k >= 0; k--) {
    const a = (k / steps) * (Math.PI / 2);
    pts.push({ x: -H + r0 * Math.sin(a), z: H - r0 * Math.cos(a) });
  }
  return slab(pts, y0, y1);
}

/** A dash `len` long and 2 wide, centred at (x, z), running at `angle` from +x. */
const dash = (x: number, z: number, len: number, angle = 0, wide = 2): BufferGeometry =>
  new BoxGeometry(len, PAINT_TOP - FELT_TOP + 0.3, wide).rotateY(-angle).translate(x, (FELT_TOP + PAINT_TOP) / 2 - 0.15, z);

/** The road along x across the whole square, from x0 to x1. */
const run = (half: number, x0: number, x1: number, y0: number, y1: number) => box(x0, x1, -half, half, y0, y1);
/** The road from the side of a run along x to the square's south edge. */
const southArm = (half: number, y0: number, y1: number) => box(-half, half, half, H, y0, y1);

/** A run from the west edge ending in a half round at the square's middle (a dead end). */
function roundEnd(half: number, y0: number, y1: number): BufferGeometry {
  const pts: { x: number; z: number }[] = [{ x: -H, z: -half }];
  for (let k = 0; k <= 12; k++) {
    const a = -Math.PI / 2 + (k / 12) * Math.PI;
    pts.push({ x: half * Math.cos(a), z: half * Math.sin(a) });
  }
  pts.push({ x: -H, z: half });
  return slab(pts, y0, y1);
}

function pieceParts(id: RoadPieceId): Record<SlotName, BufferGeometry[]> {
  const board = (half: number, y0: number, y1: number): BufferGeometry[] => {
    switch (id) {
      case "straight":
      case "zebra":
        return [run(half, -H, H, y0, y1)];
      case "curve":
        return [quarterRing(H - half, H + half, y0, y1)];
      case "tee":
        return [run(half, -H, H, y0, y1), southArm(half, y0, y1)];
      case "cross":
        return [run(half, -H, H, y0, y1), box(-half, half, -H, -half, y0, y1), box(-half, half, half, H, y0, y1)];
      case "end":
        return [roundEnd(half, y0, y1)];
      case "bridge":
      case "ramp-low":
      case "ramp-high":
        // In segments along its run, so the hump or slope bends it smoothly.
        return [new BoxGeometry(CELL, y1 - y0, 2 * half, 12).translate(0, (y0 + y1) / 2, 0)];
    }
  };
  const paint: BufferGeometry[] = [];
  const centreDashes = (xs: number[]) => xs.forEach((x) => paint.push(dash(x, 0, 10)));
  switch (id) {
    case "straight":
    case "bridge":
    case "ramp-low":
    case "ramp-high":
      centreDashes([-24, 0, 24]);
      break;
    case "curve":
      for (const deg of [15, 45, 75]) {
        const a = (deg * Math.PI) / 180;
        // Along the arc: its tangent at angle a turns from +x (at the west edge) to +z (at the south edge).
        paint.push(dash(-H + H * Math.sin(a), H - H * Math.cos(a), 10, a));
      }
      break;
    case "tee":
      centreDashes([-24, 24]);
      // Give way: a broken line across the side road's mouth.
      for (let x = -20; x <= 20; x += 8) paint.push(dash(x, FELT_HALF + 2, 5));
      break;
    case "end":
      centreDashes([-24]);
      break;
    case "zebra":
      for (let z = -24; z <= 24; z += 8) paint.push(dash(0, z, 24, 0, 4));
      break;
    case "cross":
      break;
  }
  const dark: BufferGeometry[] = [];
  const beacon: BufferGeometry[] = [];
  if (id === "zebra") {
    // A beacon on each kerb at the crossing: a white pole with black bands and an amber globe on top.
    for (const z of [-30, 30]) {
      paint.push(new CylinderGeometry(1.3, 1.5, POLE, 10).translate(0, BOARD_TOP + POLE / 2, z));
      for (const y of [6, 13, 20]) dark.push(new CylinderGeometry(1.6, 1.6, 3, 10).translate(0, BOARD_TOP + y, z));
      beacon.push(new SphereGeometry(3.6, 14, 10).translate(0, BOARD_TOP + POLE + 2.5, z));
    }
  }
  const parts = { board: board(BOARD_HALF, 0, BOARD_TOP), felt: board(FELT_HALF, BOARD_TOP, FELT_TOP), paint, dark, beacon };
  if (id === "bridge") {
    // Low wooden parapets along both edges, then the whole deck humped over the river (level with the road at its ends).
    for (const z of [-(BOARD_HALF - 1.5), BOARD_HALF - 1.5]) parts.board.push(new BoxGeometry(CELL, 5, 3, 12).translate(0, BOARD_TOP + 2.5, z));
    for (const list of Object.values(parts)) for (const g of list) hump(g);
  }
  if (id === "ramp-low" || id === "ramp-high") {
    // Sloped up toward +x by half a block (the top half starting half a block up); the board stays on the ground
    // underneath, a solid wedge.
    const from = id === "ramp-low" ? 0 : HALF_BLOCK;
    for (const list of Object.values(parts)) for (const g of list) slope(g, from);
  }
  return parts;
}

/** Half a block: each ramp half climbs this much over its square. */
const HALF_BLOCK = RISER_HEIGHT / 2;

/** Raise a ramp part: by `from` plus a rise of half a block from the square's −x edge to its +x edge (not its base). */
function slope(g: BufferGeometry, from: number): void {
  const p = g.getAttribute("position");
  for (let k = 0; k < p.count; k++) {
    if (p.getY(k) < 0.01) continue;
    p.setY(k, p.getY(k) + from + (HALF_BLOCK * (p.getX(k) + H)) / CELL);
  }
  g.computeVertexNormals();
}

/** How high a road bridge's deck rises at its middle (mm). */
const HUMP = 9;

/** Raise a bridge part along a gentle hump: none at the square's edges, `HUMP` at its middle. */
function hump(g: BufferGeometry): void {
  const p = g.getAttribute("position");
  for (let k = 0; k < p.count; k++) {
    const c = Math.cos((Math.PI * p.getX(k)) / CELL);
    p.setY(k, p.getY(k) + HUMP * c * c);
  }
  g.computeVertexNormals();
}

function flatten(parts: BufferGeometry[]): PieceMesh {
  const flat = parts.map(nonIndexed);
  let n = 0;
  for (const g of flat) n += g.getAttribute("position").count;
  const out: PieceMesh = { position: new Float32Array(n * 3), normal: new Float32Array(n * 3), uv: new Float32Array(n * 2) };
  let o = 0;
  for (const g of flat) {
    const c = g.getAttribute("position").count;
    out.position.set(g.getAttribute("position").array as Float32Array, o * 3);
    out.normal.set(g.getAttribute("normal").array as Float32Array, o * 3);
    out.uv.set(g.getAttribute("uv").array as Float32Array, o * 2);
    o += c;
  }
  for (const g of new Set([...parts, ...flat])) g.dispose();
  return out;
}

let meshes: Record<SlotName, PieceMesh>[] | null = null;
/** Each piece's meshes, by code (built on first use). */
function pieceMeshes(): Record<SlotName, PieceMesh>[] {
  if (meshes) return meshes;
  meshes = [];
  for (const def of ROAD_PIECES) {
    const parts = pieceParts(def.id);
    meshes[def.code] = { board: flatten(parts.board), felt: flatten(parts.felt), paint: flatten(parts.paint), dark: flatten(parts.dark), beacon: flatten(parts.beacon) };
  }
  return meshes;
}

/** One tile's roads as built: what from (a hash of its squares' road bytes) and a geometry per slot. */
interface RoadTile {
  key: number;
  geometries: (BufferGeometry | null)[];
}
/** Road tiles kept between builds (see `buildRoadTiles`). */
export type RoadTiles = Map<number, RoadTile>;

/** The road squares of one tile: index into its grid, column, row, and road byte. */
interface Square {
  col: number;
  row: number;
  road: number;
  y: number;
}

/**
 * The road pieces on some grids (the land, and land shown around it), a mesh per material per tile. Tiles whose road
 * squares haven't changed keep their geometry (`cache`).
 */
export function buildRoadTiles(grids: readonly LandscapeGrid[], mats: RoadMaterials, cache: RoadTiles): Group {
  const group = new Group();
  const tileCols = TILE_WIDTH / CELL;
  const tileRows = TILE_DEPTH / CELL;
  const tiles = new Map<number, { tc: number; tr: number; squares: Square[] }>();
  for (const g of grids) {
    const n = g.cellCount;
    for (let i = 0; i < n; i++) {
      const road = g.road[i];
      if (road === 0 || !pieceOf(road)) continue;
      const col = g.colOf(i);
      const row = g.rowOf(i);
      const tc = Math.floor(col / tileCols);
      const tr = Math.floor(row / tileRows);
      const id = tileAt(tc * TILE_WIDTH, tr * TILE_DEPTH);
      let t = tiles.get(id);
      if (!t) tiles.set(id, (t = { tc, tr, squares: [] }));
      t.squares.push({ col, row, road, y: g.groundY(i) });
    }
  }
  for (const [id, t] of tiles) {
    t.squares.sort((a, b) => a.row - b.row || a.col - b.col);
    let key = 0x811c9dc5;
    for (const s of t.squares) {
      key = Math.imul(key ^ s.col, 0x01000193);
      key = Math.imul(key ^ s.row, 0x01000193);
      key = Math.imul(key ^ (s.road | (s.y << 8)), 0x01000193);
    }
    let tile = cache.get(id);
    if (!tile || tile.key !== key) {
      for (const g of tile?.geometries ?? []) g?.dispose();
      cache.set(id, (tile = { key, geometries: SLOTS.map((slot) => tileGeometry(t.squares, slot)) }));
    }
    tile.geometries.forEach((geometry, k) => {
      if (!geometry) return;
      const mesh = new Mesh(geometry, mats[SLOTS[k]]);
      mesh.receiveShadow = true;
      // The cache owns the geometry: the mesh mustn't free it.
      mesh.userData.sharedGeometry = true;
      setCullRects(mesh, [{ x0: t.tc * TILE_WIDTH, z0: t.tr * TILE_DEPTH, x1: (t.tc + 1) * TILE_WIDTH, z1: (t.tr + 1) * TILE_DEPTH }], 8);
      group.add(mesh);
    });
  }
  for (const [id, tile] of cache) {
    if (tiles.has(id)) continue;
    for (const g of tile.geometries) g?.dispose();
    cache.delete(id);
  }
  return group;
}

/** One slot of a tile's pieces, turned and moved onto their squares, as one geometry (null if empty). */
function tileGeometry(squares: readonly Square[], slot: SlotName): BufferGeometry | null {
  const all = pieceMeshes();
  let n = 0;
  for (const s of squares) n += all[s.road & 31][slot].position.length / 3;
  if (n === 0) return null;
  const position = new Float32Array(n * 3);
  const normal = new Float32Array(n * 3);
  const uv = new Float32Array(n * 2);
  let o = 0;
  for (const s of squares) {
    const m = all[s.road & 31][slot];
    // A quarter turn takes +x to +z: (x, z) → (−z, x).
    const t = turnOf(s.road);
    const cos = [1, 0, -1, 0][t];
    const sin = [0, 1, 0, -1][t];
    const cx = (s.col + 0.5) * CELL;
    const cz = (s.row + 0.5) * CELL;
    const count = m.position.length / 3;
    for (let k = 0; k < count; k++) {
      const x = m.position[k * 3];
      const z = m.position[k * 3 + 2];
      const wx = cx + x * cos - z * sin;
      const wz = cz + x * sin + z * cos;
      position[o * 3] = wx;
      position[o * 3 + 1] = s.y + m.position[k * 3 + 1];
      position[o * 3 + 2] = wz;
      const nx = m.normal[k * 3];
      const nz = m.normal[k * 3 + 2];
      normal[o * 3] = nx * cos - nz * sin;
      normal[o * 3 + 1] = m.normal[k * 3 + 1];
      normal[o * 3 + 2] = nx * sin + nz * cos;
      // Felt tiles in mm across the world, like the felt ribbons; wood and paint keep their own.
      if (slot === "felt") {
        uv[o * 2] = wx / FELT_TILE;
        uv[o * 2 + 1] = -wz / FELT_TILE;
      } else {
        uv[o * 2] = m.uv[k * 2];
        uv[o * 2 + 1] = m.uv[k * 2 + 1];
      }
      o++;
    }
  }
  const g = new BufferGeometry();
  g.setAttribute("position", new BufferAttribute(position, 3));
  g.setAttribute("normal", new BufferAttribute(normal, 3));
  g.setAttribute("uv", new BufferAttribute(uv, 2));
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}

import { BoxGeometry, Color, Group, InstancedMesh, Matrix4, Mesh, MeshBasicMaterial, type BufferGeometry, type Material } from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { CELL, CORNER_RADIUS, forEachInPlot, hillPieces, hillSlabs, hillsOf, type LandscapeGrid, type RoundBlock, type Slab } from "../../landscape";
import { RISER_HEIGHT } from "../../track";
import { BEECH_UV_SCALE, type Materials } from "../materials";
import { roundedChamferedBox } from "./chamfer";

/** Beech tones (multiplied over the wood texture) so a hill reads as a stack of separate blocks. */
export const BLOCK_TONES = ["#ffffff", "#f4e4cc", "#ead3b0", "#fbefdc", "#e2c7a0"];
const GRASS_TONES = ["#ffffff", "#f1f7ea", "#e6f0dc"];
const GAP = 0.8;
const PAINT = 4;

export interface BlockInstance {
  x: number;
  z: number;
  /** Bottom of the block. */
  y: number;
  tone: number;
  /** Whether this is the top block of its stack (painted green on top). */
  top: boolean;
  /** False for blocks buried inside a hill: a block on top and a neighbour against every side. */
  exposed: boolean;
  /** Corners rounded off where the hill's edge turns (see `HillShape.blockCorners`). */
  corners: number;
}

function hash(a: number, b: number, c: number, d: number): number {
  let h = (a * 374761393 + b * 668265263 + c * 2147483647 + d * 1274126177) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

/** One block per cell per level, bottom-up, in some plots (by slot; all of them by default). */
export function blockInstances(grid: LandscapeGrid, seed: number, plots: readonly number[] = grid.plots.map((_, slot) => slot)): BlockInstance[] {
  const out: BlockInstance[] = [];
  for (const slot of plots) {
    forEachInPlot(slot, grid.plots[slot], (i, col, row) => {
      const h = grid.height[i];
      const side = (dc: number, dr: number) => {
        const j = grid.index(col + dc, row + dr);
        return j === -1 ? 0 : grid.height[j];
      };
      // A side face is covered at this level when the neighbour's stack is taller than the level.
      const covered = Math.min(side(1, 0), side(-1, 0), side(0, 1), side(0, -1));
      for (let level = 0; level < h; level++) {
        out.push({
          x: grid.centreX(col),
          z: grid.centreZ(row),
          y: level * RISER_HEIGHT,
          tone: hash(col, row, level, seed) % BLOCK_TONES.length,
          top: level === h - 1,
          exposed: level === h - 1 || covered <= level,
          corners: hillsOf(grid).blockCorners(col, row, level),
        });
      }
    });
  }
  return out;
}

function scaleUv(g: BufferGeometry, u: number, v: number): BufferGeometry {
  const uv = g.getAttribute("uv");
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * u, uv.getY(i) * v);
  return g;
}

function instanced(geometry: BufferGeometry, material: Material, count: number): InstancedMesh {
  const mesh = new InstancedMesh(geometry, material, Math.max(1, count));
  mesh.count = count;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

/** Layer seen only by the sun's shadow camera: cheap stand-ins that cast shadows for detailed scenery. */
export const SHADOW_PROXY_LAYER = 1;

/** One instance of a block in an instanced mesh (its body or its painted top) and where it's drawn. */
export interface BlockInstanceRef {
  mesh: InstancedMesh;
  i: number;
  matrix: Matrix4;
}

/** Key for a block by its bottom centre. */
export const blockKey = (x: number, z: number, y: number): string => `${Math.round(x)},${Math.round(z)},${Math.round(y)}`;

/**
 * Hill shadows come from merged rectangles (a few dozen plain boxes) instead of hundreds of rounded blocks:
 * same silhouette from the sun, a fraction of the shadow-pass cost.
 */
export function shadowProxy(slabs: readonly Slab[], round: readonly RoundBlock[] = []): Mesh | null {
  const merged = shadowProxyGeometry(slabs, round);
  return merged ? shadowProxyMesh(merged) : null;
}

/** A shadow stand-in for some geometry (positions only): cast on the shadow layer alone. */
export function shadowProxyMesh(geometry: BufferGeometry): Mesh {
  const mesh = new Mesh(geometry, new MeshBasicMaterial());
  mesh.userData.ownsMaterial = true;
  mesh.castShadow = true;
  mesh.layers.set(SHADOW_PROXY_LAYER);
  return mesh;
}

/** The geometry of a shadow stand-in (positions only), or null for nothing. */
export function shadowProxyGeometry(slabs: readonly Slab[], round: readonly RoundBlock[] = []): BufferGeometry | null {
  const pieces: BufferGeometry[] = slabs.map((s) => {
    const g = new BoxGeometry(s.x1 - s.x0 - GAP, RISER_HEIGHT - GAP, s.z1 - s.z0 - GAP).toNonIndexed();
    g.translate((s.x0 + s.x1) / 2, (s.level - 1) * RISER_HEIGHT + RISER_HEIGHT / 2, (s.z0 + s.z1) / 2);
    return g;
  });
  // Blocks with rounded corners cast rounded shadows.
  for (const b of round) {
    const g = roundedChamferedBox(CELL - GAP, RISER_HEIGHT - GAP, CELL - GAP, 0.5, b.corners, CORNER_RADIUS - GAP / 2);
    g.translate(b.x, (b.level - 1) * RISER_HEIGHT + RISER_HEIGHT / 2, b.z);
    pieces.push(g);
  }
  if (pieces.length === 0) return null;
  for (const g of pieces) for (const name of Object.keys(g.attributes)) if (name !== "position") g.deleteAttribute(name);
  const merged = mergeGeometries(pieces);
  for (const b of pieces) b.dispose();
  return merged;
}

/** Where a block sits (bottom centre), whether it is the top of its stack, and its tone (any integer). */
export interface BlockSpot {
  x: number;
  z: number;
  y: number;
  top: boolean;
  tone: number;
  /** A block of a different size than the batch's: drawn as a scaled copy. */
  size?: number;
  /** Corners rounded off (see `HillShape.blockCorners`). */
  corners?: number;
}

/**
 * Blocks (`size` square, `height` tall) as two instanced draws: the beech bodies and the green paint on top of each stack.
 * `rounded` blocks have bevelled edges (for close up); plain boxes are for distant scenery. Neither casts shadows.
 * `roundedPaint` does the same for the thin green tops (whose bevel only shows very close).
 */
export function blockMeshes(
  blocks: readonly BlockSpot[],
  size: number,
  height: number,
  materials: { wood: Material; top: Material },
  rounded: boolean,
  roundedPaint = rounded,
  /** Filled with where each block's instances are (by `blockKey`), so cut blocks can be hidden and shown again. */
  index?: Map<string, BlockInstanceRef[]>,
): Group {
  const group = new Group();
  const k = size / CELL;
  const w = size - GAP * k;
  const h = height - GAP * k;
  const paintH = PAINT * k;
  // Rounded corners (see `HillShape.blockCorners`) follow the same circle with the gap taken off.
  const round = (CORNER_RADIUS - GAP / 2) * k;
  const uv = (g: BufferGeometry, v: number) => scaleUv(g, w * BEECH_UV_SCALE.x, v * BEECH_UV_SCALE.y);
  const m = new Matrix4();
  const c = new Color();
  const scale = new Matrix4();
  const foot = (GAP * k) / 2;
  // One pair of instanced draws per corner pattern in use.
  const byCorners = new Map<number, BlockSpot[]>();
  for (const b of blocks) {
    const key = rounded ? (b.corners ?? 0) : 0;
    let list = byCorners.get(key);
    if (!list) byCorners.set(key, (list = []));
    list.push(b);
  }
  for (const [corners, list] of byCorners) {
    const tops = list.filter((b) => b.top);
    const body = uv(rounded ? roundedChamferedBox(w, h, w, 2.5 * k, corners, round) : new BoxGeometry(w, h, w), h);
    // The green paint is a layer of its own on top of a shorter block (same width, nothing overlapping), so no faces
    // lie close enough together to flicker.
    const paint = uv(roundedPaint ? roundedChamferedBox(w, paintH, w, 1.6 * k, corners, round) : new BoxGeometry(w, paintH, w), w);
    const wood = instanced(body, materials.wood, list.length);
    const grass = instanced(paint, materials.top, tops.length);
    wood.castShadow = false;
    grass.castShadow = false;
    list.forEach((b, i) => {
      const s = (b.size ?? size) / size;
      const bodyH = b.top ? h - paintH : h;
      // Turn alternate square blocks a quarter so the grain doesn't line up across the whole hill.
      m.makeRotationY(corners === 0 ? ((b.tone + Math.round(b.x / size)) % 2) * (Math.PI / 2) : 0);
      m.multiply(scale.makeScale(s, (s * bodyH) / h, s));
      m.setPosition(b.x, b.y + s * (foot + bodyH / 2), b.z);
      wood.setMatrixAt(i, m);
      wood.setColorAt(i, c.set(BLOCK_TONES[b.tone % BLOCK_TONES.length]));
      index?.set(blockKey(b.x, b.z, b.y), [{ mesh: wood, i, matrix: m.clone() }]);
    });
    tops.forEach((b, i) => {
      const s = (b.size ?? size) / size;
      m.makeScale(s, s, s);
      m.setPosition(b.x, b.y + s * (foot + h - paintH / 2), b.z);
      grass.setMatrixAt(i, m);
      grass.setColorAt(i, c.set(GRASS_TONES[b.tone % GRASS_TONES.length]));
      index?.get(blockKey(b.x, b.z, b.y))?.push({ mesh: grass, i, matrix: m.clone() });
    });
    group.add(wood, grass);
  }
  return group;
}

/** How far inside a hill's outer faces its dark core stands (mm): behind the blocks, seen only down the seams. */
export const CORE_INSET = 13; // clear of rounded corners too (they cut in about 11 mm at the diagonal)

/**
 * The inside of a hill: one dark box per slab, just inside the blocks, so looking down a seam between blocks shows
 * shadowy wood rather than straight through to the felt (or the empty middle of the hill).
 */
export function hillCore(slabs: readonly Slab[]): Mesh | null {
  const boxes = slabs.map((s) => {
    const g = new BoxGeometry(s.x1 - s.x0 - 2 * CORE_INSET, RISER_HEIGHT, s.z1 - s.z0 - 2 * CORE_INSET);
    // Its top a little under the top of the blocks of this level.
    g.translate((s.x0 + s.x1) / 2, (s.level - 0.5) * RISER_HEIGHT - CORE_INSET, (s.z0 + s.z1) / 2);
    return g;
  });
  if (boxes.length === 0) return null;
  const merged = mergeGeometries(boxes);
  for (const b of boxes) b.dispose();
  const mesh = new Mesh(merged, new MeshBasicMaterial({ color: CORE_COLOUR }));
  mesh.userData.ownsMaterial = true;
  return mesh;
}
export const CORE_COLOUR = new Color("#3a2716");

/**
 * Hills as individual rounded beech blocks, the top of each stack painted grass green, around a dark core. Without
 * `solids`, leaves out the core and the shadow (for `HillCutsView`, which shapes them round cuttings). `plots` limits
 * them to some plots (by slot).
 */
export function buildBlocks(
  grid: LandscapeGrid,
  seed: number,
  mats: Materials,
  index?: Map<string, BlockInstanceRef[]>,
  solids = true,
  plots: readonly number[] = grid.plots.map((_, slot) => slot),
): Group {
  const group = blockMeshes(blockInstances(grid, seed, plots).filter((b) => b.exposed), CELL, RISER_HEIGHT, { wood: mats.blockWood, top: mats.blockTop }, true, true, index);
  if (!solids) return group;
  const core = hillCore(hillSlabs(grid, plots));
  if (core) group.add(core);
  const pieces = hillPieces(grid, undefined, plots);
  const proxy = shadowProxy(pieces.slabs, pieces.round);
  if (proxy) group.add(proxy);
  return group;
}

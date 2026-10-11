import { BoxGeometry, Color, Group, InstancedMesh, Matrix4, Mesh, MeshBasicMaterial, type BufferGeometry, type Material } from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { CELL, COLS, hillSlabs, ROWS, type LandscapeGrid, type Slab } from "../../landscape";
import { RISER_HEIGHT } from "../../track";
import { BEECH_UV_SCALE, type Materials } from "../materials";

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
}

function hash(a: number, b: number, c: number, d: number): number {
  let h = (a * 374761393 + b * 668265263 + c * 2147483647 + d * 1274126177) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

/** One block per cell per level, bottom-up. */
export function blockInstances(grid: LandscapeGrid, seed: number): BlockInstance[] {
  const out: BlockInstance[] = [];
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      const h = grid.height[grid.index(col, row)];
      const side = (dc: number, dr: number) => (grid.inBounds(col + dc, row + dr) ? grid.height[grid.index(col + dc, row + dr)] : 0);
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
        });
      }
    }
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

/**
 * Hill shadows come from merged rectangles (a few dozen plain boxes) instead of hundreds of rounded blocks:
 * same silhouette from the sun, a fraction of the shadow-pass cost.
 */
export function shadowProxy(slabs: readonly Slab[]): Mesh | null {
  const boxes = slabs.map((s) => {
    const g = new BoxGeometry(s.x1 - s.x0 - GAP, RISER_HEIGHT - GAP, s.z1 - s.z0 - GAP);
    g.translate((s.x0 + s.x1) / 2, (s.level - 1) * RISER_HEIGHT + RISER_HEIGHT / 2, (s.z0 + s.z1) / 2);
    return g;
  });
  if (boxes.length === 0) return null;
  const merged = mergeGeometries(boxes);
  for (const b of boxes) b.dispose();
  const mesh = new Mesh(merged, new MeshBasicMaterial());
  mesh.userData.ownsMaterial = true;
  mesh.castShadow = true;
  mesh.layers.set(SHADOW_PROXY_LAYER);
  return mesh;
}

/** Where a block sits (bottom centre), whether it is the top of its stack, and its tone (any integer). */
export interface BlockSpot {
  x: number;
  z: number;
  y: number;
  top: boolean;
  tone: number;
}

/**
 * Cube blocks of one size as two instanced draws: the beech bodies and the green paint on top of each stack.
 * `rounded` blocks have softened edges (for close up); plain boxes are for distant scenery. Neither casts shadows.
 */
export function blockMeshes(blocks: readonly BlockSpot[], size: number, mats: Materials, rounded: boolean): Group {
  const group = new Group();
  const tops = blocks.filter((b) => b.top);
  const k = size / CELL;
  const w = size - GAP * k;
  const h = size - GAP * k;
  const uv = (g: BufferGeometry, v: number) => scaleUv(g, w * BEECH_UV_SCALE.x, v * BEECH_UV_SCALE.y);
  const body = uv(rounded ? new RoundedBoxGeometry(w, h, w, 1, 2.5 * k) : new BoxGeometry(w, h, w), h);
  const paintH = PAINT * k;
  const paint = uv(rounded ? new RoundedBoxGeometry(w + 0.6, paintH, w + 0.6, 1, 1.6 * k) : new BoxGeometry(w + 0.6 * k, paintH, w + 0.6 * k), w);
  const wood = instanced(body, mats.blockWood, blocks.length);
  const grass = instanced(paint, mats.blockTop, tops.length);
  wood.castShadow = false;
  grass.castShadow = false;
  const m = new Matrix4();
  const c = new Color();
  blocks.forEach((b, i) => {
    // Turn alternate blocks a quarter so the grain doesn't line up across the whole hill.
    m.makeRotationY(((b.tone + Math.round(b.x / size)) % 2) * (Math.PI / 2));
    m.setPosition(b.x, b.y + size / 2, b.z);
    wood.setMatrixAt(i, m);
    wood.setColorAt(i, c.set(BLOCK_TONES[b.tone % BLOCK_TONES.length]));
  });
  tops.forEach((b, i) => {
    m.makeTranslation(b.x, b.y + size - paintH / 2 + 0.3 * k, b.z);
    grass.setMatrixAt(i, m);
    grass.setColorAt(i, c.set(GRASS_TONES[b.tone % GRASS_TONES.length]));
  });
  group.add(wood, grass);
  return group;
}

/** Hills as individual rounded beech blocks, the top of each stack painted grass green. Two draw calls. */
export function buildBlocks(grid: LandscapeGrid, seed: number, mats: Materials): Group {
  const group = blockMeshes(blockInstances(grid, seed).filter((b) => b.exposed), CELL, mats, true);
  const proxy = shadowProxy(hillSlabs(grid));
  if (proxy) group.add(proxy);
  return group;
}

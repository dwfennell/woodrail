import { Color, Group, InstancedMesh, Matrix4, type BufferGeometry, type Material } from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { CELL, COLS, ROWS, type LandscapeGrid } from "../../landscape";
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
      for (let level = 0; level < h; level++) {
        out.push({
          x: grid.centreX(col),
          z: grid.centreZ(row),
          y: level * RISER_HEIGHT,
          tone: hash(col, row, level, seed) % BLOCK_TONES.length,
          top: level === h - 1,
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

/** Hills as individual rounded beech blocks, the top of each stack painted grass green. Two draw calls. */
export function buildBlocks(grid: LandscapeGrid, seed: number, mats: Materials): Group {
  const group = new Group();
  const blocks = blockInstances(grid, seed);
  const tops = blocks.filter((b) => b.top);
  const size = CELL - GAP;
  const body = scaleUv(new RoundedBoxGeometry(size, RISER_HEIGHT - GAP, size, 2, 3), size * BEECH_UV_SCALE.x, (RISER_HEIGHT - GAP) * BEECH_UV_SCALE.y);
  const paint = scaleUv(new RoundedBoxGeometry(size + 0.6, PAINT, size + 0.6, 1, 1.6), size * BEECH_UV_SCALE.x, size * BEECH_UV_SCALE.y);
  const wood = instanced(body, mats.blockWood, blocks.length);
  const grass = instanced(paint, mats.blockTop, tops.length);
  const m = new Matrix4();
  const c = new Color();
  blocks.forEach((b, i) => {
    // Turn alternate blocks a quarter so the grain doesn't line up across the whole hill.
    m.makeRotationY(((b.tone + Math.round(b.x / CELL)) % 2) * (Math.PI / 2));
    m.setPosition(b.x, b.y + RISER_HEIGHT / 2, b.z);
    wood.setMatrixAt(i, m);
    wood.setColorAt(i, c.set(BLOCK_TONES[b.tone]));
  });
  tops.forEach((b, i) => {
    m.makeTranslation(b.x, b.y + RISER_HEIGHT - PAINT / 2 + 0.3, b.z);
    grass.setMatrixAt(i, m);
    grass.setColorAt(i, c.set(GRASS_TONES[b.tone % GRASS_TONES.length]));
  });
  group.add(wood, grass);
  return group;
}

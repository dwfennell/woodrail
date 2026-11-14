import { Box3, type Mesh, type Object3D } from "three";
import { describe, expect, it } from "vitest";
import { loadModelSet } from "../render/blender-models";
import { ROW_ASSETS, rowAssetIds } from "./rows";

/** The row models as built (public/models/rows.glb, tools/blender/bldg_rows.py): all there, on their lots, cheap to draw. */
const MODELS = await loadModelSet("rows", true);
const SLOTS = ["lacquer #ff00a0", "lacquer #ffa000", "lacquer #00ffa0", "lacquer #a000ff"];

function measure(root: Object3D): { box: Box3; triangles: number; materials: Set<string> } {
  root.updateMatrixWorld(true);
  const box = new Box3().setFromObject(root);
  let triangles = 0;
  const materials = new Set<string>();
  root.traverse((o) => {
    const m = o as Mesh;
    if (!m.isMesh) return;
    triangles += (m.geometry.index ? m.geometry.index.count : m.geometry.getAttribute("position").count) / 3;
    for (const mat of Array.isArray(m.material) ? m.material : [m.material]) materials.add(mat.name);
  });
  return { box, triangles, materials };
}

describe("the row models", () => {
  const two = new Set<string>(Object.values(ROW_ASSETS.two));
  const four = new Set<string>(Object.values(ROW_ASSETS.four));
  it.each(rowAssetIds())("%s is there four ways, on its lot, within its triangles", (id) => {
    for (const suffix of ["", "-ground", "-floor", "-upper"]) expect(MODELS.has(id + suffix), id + suffix).toBe(true);
    const squares = two.has(id) || four.has(id) ? 2 : 1;
    const deep = four.has(id) ? 2 : 1;
    const whole = measure(MODELS.get(id)!);
    // (The game's frame: the street on +x, along it z; the lot's middle at the origin, its back edge `deep` squares in.)
    expect(whole.box.max.x).toBeLessThanOrEqual(36.05);
    expect(whole.box.min.x).toBeGreaterThanOrEqual(36 - 72 * deep - 0.05);
    expect(whole.box.max.z - whole.box.min.z).toBeGreaterThan(72 * squares - 1.5);
    expect(whole.box.max.z - whole.box.min.z).toBeLessThanOrEqual(72 * squares + 0.05);
    expect(whole.box.min.y).toBeCloseTo(0, 1);
    for (const name of whole.materials) expect(SLOTS.includes(name) || name.startsWith("lacquer fixed #") || name === "wood", name).toBe(true);
    expect(whole.materials.has("lacquer #ff00a0")).toBe(true);
    expect(whole.materials.has("lacquer #00ffa0")).toBe(true);
    expect(whole.triangles).toBeLessThanOrEqual(four.has(id) || squares === 2 ? 4000 : 2100);
    expect(measure(MODELS.get(`${id}-floor`)!).triangles).toBeLessThanOrEqual(600);
    // A floor and an upper sit where a ground's storey does: over the pavement, so the game lifts them by whole storeys.
    expect(measure(MODELS.get(`${id}-floor`)!).box.min.y).toBeGreaterThan(2);
    // (A ground has no roof: lower than the whole model by a roof's rise.)
    expect(measure(MODELS.get(`${id}-ground`)!).box.max.y).toBeLessThan(whole.box.max.y - 5);
  });
});

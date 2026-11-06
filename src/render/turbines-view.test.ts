import { Color, Matrix4, MeshStandardMaterial, Quaternion, Vector3, type InstancedMesh } from "three";
import { describe, expect, it } from "vitest";
import { loadFile } from "../catalogue/registry";
import { stubMaterials } from "../props/footprints-testing";
import { PropStore } from "../props/store";
import type { AmbientEye } from "./ambient";
import { PropLibrary } from "./props/library";
import { TurbinesView, WHEEL_SPEED } from "./turbines-view";

/** An eye that sees everything (or nothing), big enough. */
const eye = (sees: boolean): AmbientEye => ({ sees: () => sees }) as unknown as AmbientEye;

const matrixOf = (mesh: InstancedMesh, i: number) => {
  const m = new Matrix4();
  mesh.getMatrixAt(i, m);
  const p = new Vector3();
  const q = new Quaternion();
  m.decompose(p, q, new Vector3());
  return { p, q };
};

describe("the World's Fair wheel turning (ambient motion)", () => {
  it("turns slowly while seen, its gondolas riding round upright; still while paused or unseen", async () => {
    await loadFile("grand");
    // (The game's paint is vertex-coloured, every lacquer folded into it: so here, for the gondolas' tints.)
    const stub = stubMaterials();
    const paint = new MeshStandardMaterial({ vertexColors: true });
    const lacquer = (c: string) => Object.assign(new MeshStandardMaterial(), { userData: { paintColor: c } });
    const lib = new PropLibrary(new Proxy(stub, { get: (t, k) => (k === "paint" ? paint : k === "lacquer" ? lacquer : t[k as keyof typeof t]) }));
    await lib.load("grand-ferris-wheel-3");
    const props = new PropStore();
    props.add("grand-ferris-wheel-3", { x: 100, z: 50, heading: 0, y: 0 });
    const view = new TurbinesView(lib);
    view.calm = false;
    expect(view.sync(props)).toBe(true);
    expect(view.count).toBe(1);
    const meshes = view.group.children as InstancedMesh[];
    // The wheel's parts, then its twelve gondolas' (one instance each).
    const gondola = meshes.find((m) => m.count === 12 && (m.material as MeshStandardMaterial).vertexColors)!;
    expect(gondola).toBeTruthy();
    const before = matrixOf(gondola, 0);
    // Unseen, or paused: nothing turns, no frame asked for.
    expect(view.update(1, false, eye(false))).toBe(false);
    expect(view.update(1, true, eye(true))).toBe(false);
    expect(matrixOf(gondola, 0).p.distanceTo(before.p)).toBe(0);
    // Seen: it turns (a frame asked for), the gondola moves round the rim and stays upright.
    expect(view.update(2, false, eye(true))).toBe(true);
    const after = matrixOf(gondola, 0);
    expect(after.p.distanceTo(before.p)).toBeGreaterThan(5);
    expect(after.q.angleTo(new Quaternion())).toBeLessThan(1e-6);
    // Each gondola in its own colour, from one model: the painted part tinted per instance (no more draws).
    const tints = new Set<string>();
    const c = new Color();
    for (let i = 0; i < 12; i++) {
      gondola.getColorAt(i, c);
      tints.add(c.getHexString());
    }
    expect(gondola.instanceColor).toBeTruthy();
    expect(tints.size).toBe(6);
    // Slowly: a turn takes over half a minute of game time.
    expect((2 * Math.PI) / WHEEL_SPEED).toBeGreaterThan(30);
  }, 60_000);
});

import { Color, MeshStandardMaterial, Vector3, type Mesh, type Object3D } from "three";
import { describe, expect, it } from "vitest";
import { Kit } from "../catalogue/kit";
import { loadAsset } from "../catalogue/registry";
import { KIT_TYPES, KITS } from "../track";
import { KIT_MOTIONS } from "./kit-motions";
import type { Materials } from "./materials";
import { bake, bakeMovers, partsOf } from "./props/library";

/** Plain stand-ins for the game's materials (theirs need a canvas for textures). */
function stubMaterials(): Materials {
  const m = (c = "#ffffff") => new MeshStandardMaterial({ color: new Color(c) });
  const lacquer = (c: string) => m(c);
  return new Proxy({ lacquer } as unknown as Materials, { get: (t, k) => (k in t ? t[k as keyof Materials] : m()) });
}

const vertices = (b: ReturnType<typeof bake>) => b.parts.reduce((n, p) => n + p.geometry.getAttribute("position").count, 0);
const meshVertices = (root: Object3D) => {
  let n = 0;
  root.traverse((o) => {
    if ((o as Mesh).isMesh) n += (o as Mesh).geometry.getAttribute("position").count;
  });
  return n;
};

describe("kit motions", () => {
  const mats = stubMaterials();
  const kit = new Kit(mats);

  it("every kit that moves has a motion for its asset", () => {
    for (const type of KIT_TYPES) if (KITS[type].moves) expect(KIT_MOTIONS[KITS[type].asset], type).toBeDefined();
  });

  it("every motion's rest pose holds still: pose(on 0) is the same whatever the time", async () => {
    for (const [asset, motion] of Object.entries(KIT_MOTIONS)) {
      const a = await loadAsset(asset);
      expect(a, asset).toBeDefined();
      const root = a!.build(kit);
      const parts = partsOf(root);
      for (const name of motion.parts) expect(parts.get(name).length, `${asset} has a part ${name}`).toBeGreaterThan(0);
      motion.pose(parts, 0, 0);
      root.updateMatrixWorld(true);
      const rest = motion.parts.flatMap((n) => parts.get(n).map((o) => o.matrixWorld.clone()));
      motion.pose(parts, 0, motion.period ? motion.period * 3 : 7.3);
      root.updateMatrixWorld(true);
      const later = motion.parts.flatMap((n) => parts.get(n).map((o) => o.matrixWorld.clone()));
      for (let i = 0; i < rest.length; i++) for (let k = 0; k < 16; k++) expect(later[i].elements[k], asset).toBeCloseTo(rest[i].elements[k], 6);
    }
  });

  it("a model's moving parts come out of the bake into a live tree of their own, standing where they stood", async () => {
    const a = (await loadAsset("mech-gantry-crane"))!;
    const root = a.build(kit);
    const motion = KIT_MOTIONS["mech-gantry-crane"];
    const parts = partsOf(root);
    motion.pose(parts, 0, 0);
    const names = new Set(motion.parts);
    const whole = bake(root, mats, { slabs: false });
    const bare = bake(root, mats, { slabs: false, without: names });
    const movers = bakeMovers(root, names, mats)!;
    expect(movers).not.toBeNull();
    // What's taken out of the bake is what the live parts draw.
    expect(vertices(bare) + meshVertices(movers)).toBe(vertices(whole));
    // Nested parts are kept nested (the hook hangs from the trolley), each where its node is.
    const live = partsOf(movers);
    root.updateMatrixWorld(true);
    movers.updateMatrixWorld(true);
    for (const name of motion.parts) {
      const was = new Vector3().setFromMatrixPosition(parts.get(name)[0].matrixWorld);
      const now = new Vector3().setFromMatrixPosition(live.get(name)[0].matrixWorld);
      expect(now.distanceTo(was), name).toBeLessThan(1e-6);
    }
    // Posed live, they move as the model's own would.
    motion.pose(parts, 1, 2);
    motion.pose(live, 1, 2);
    root.updateMatrixWorld(true);
    movers.updateMatrixWorld(true);
    const hook = new Vector3().setFromMatrixPosition(parts.get("hook")[0].matrixWorld);
    const liveHook = new Vector3().setFromMatrixPosition(live.get("hook")[0].matrixWorld);
    expect(liveHook.distanceTo(hook)).toBeLessThan(1e-6);
  });

  it("works on a Blender model's pivots too (the engine shed's door leaves)", async () => {
    const a = (await loadAsset("bldg-engine-shed"))!;
    const root = a.build(kit);
    const motion = KIT_MOTIONS["bldg-engine-shed"];
    const parts = partsOf(root);
    motion.pose(parts, 0, 0);
    const movers = bakeMovers(root, new Set(motion.parts), mats)!;
    const live = partsOf(movers);
    expect(live.get("leafL").length).toBe(parts.get("leafL").length);
    motion.pose(parts, 0.7, 0);
    motion.pose(live, 0.7, 0);
    root.updateMatrixWorld(true);
    movers.updateMatrixWorld(true);
    for (const name of motion.parts)
      for (let i = 0; i < parts.get(name).length; i++) expect(live.get(name)[i].matrixWorld.equals(parts.get(name)[i].matrixWorld) || live.get(name)[i].matrixWorld.elements.every((e, k) => Math.abs(e - parts.get(name)[i].matrixWorld.elements[k]) < 1e-6)).toBe(true);
  });
});

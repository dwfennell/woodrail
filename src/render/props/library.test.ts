import { Color, MeshStandardMaterial, type Object3D } from "three";
import { describe, expect, it } from "vitest";
import { Kit } from "../../catalogue/kit";
import { catalogueModel, loadModelSet, modelOf } from "../blender-models";
import type { Materials } from "../materials";
import { bake, isSlab, kitModelKey, PropLibrary } from "./library";

/** Plain stand-ins for the game's materials (theirs need a canvas for textures). */
function stubMaterials(): Materials {
  const m = (c = "#ffffff") => new MeshStandardMaterial({ color: new Color(c) });
  const lacquer = (c: string) => m(c);
  return new Proxy({ lacquer } as unknown as Materials, { get: (t, k) => (k in t ? t[k as keyof Materials] : m()) });
}

const vertices = (b: ReturnType<typeof bake>) => b.parts.reduce((n, p) => n + p.geometry.getAttribute("position").count, 0);

describe("slabs of track in models", () => {
  const mats = stubMaterials();
  const kit = new Kit(mats);

  it("kit.trackSlab is marked a slab (userData.slab, named \"slab\"), and so is everything in it", () => {
    const slab = kit.trackSlab(100);
    expect(slab.userData.slab).toBe(true);
    expect(slab.name).toBe("slab");
    slab.traverse((o) => expect(isSlab(o)).toBe(true));
    expect(isSlab(kit.box(kit.wood, 10, 10, 10))).toBe(false);
  });

  it("are left out of a bake without slabs (a kit piece's model), kept otherwise", () => {
    const root = kit.group(kit.trackSlab(160), kit.box(kit.paint("#c8442f"), 20, 30, 20, 1, 0, 12, 40));
    const all = bake(root, mats);
    const bare = bake(root, mats, { slabs: false });
    expect(vertices(bare)).toBeLessThan(vertices(all));
    // Just the building: no 160 mm of track along x any more.
    expect(bare.footprint.hw).toBeCloseTo(10, 0);
    expect(all.footprint.hw).toBeCloseTo(80, 0);
  });

  it("in a Blender model, are nodes named \"slab\" (tools/blender/kit.py's trackSlab), left out the same way", async () => {
    const models = await loadModelSet("buildings", true);
    const model: Object3D = catalogueModel(modelOf(models, "bldg-two-platform-station"), kit);
    let slabs = 0;
    model.traverse((o) => {
      if (o.name === "slab") slabs++;
    });
    expect(slabs).toBe(2);
    expect(vertices(bake(model, mats, { slabs: false }))).toBeLessThan(vertices(bake(model, mats)));
  });
});

describe("a kit piece's model in the library", () => {
  it("is baked in its piece's frame: the furnished platform 216 long, beside the track on the +l side", async () => {
    const lib = new PropLibrary(stubMaterials());
    const model = await lib.load(kitModelKey("kit-platform-furnished"));
    expect(model).not.toBeNull();
    const fp = model!.footprint;
    // Along the track, t 0 to 216; across, its 26 mm platform from just off the track's edge (l 21) out.
    expect(fp.cx).toBeCloseTo(108, 0);
    expect(fp.hw).toBeCloseTo(108, 0);
    expect(fp.cz - fp.hd).toBeGreaterThan(20);
    expect(fp.cz + fp.hd).toBeLessThan(50);
    // Kept as the kit's, not as the asset's prop footprint (a prop of it keeps its own).
    expect(lib.footprint("bldg-platform-furnished")).toBeUndefined();
    expect(lib.model(kitModelKey("kit-platform-furnished"))).toBe(model);
  });
});

describe("a model let go of (its props drawn from a batch)", () => {
  it("frees its geometry, and bakes the same again when it's asked for", async () => {
    const lib = new PropLibrary(stubMaterials());
    const model = (await lib.load("bldg-red-barn"))!;
    expect(model).not.toBeNull();
    const before = model.parts.map((p) => ({ material: p.material, count: p.geometry.getAttribute("position").count, normal: p.geometry.getAttribute("normal").array.constructor }));
    const old = model.parts[0].geometry;
    let disposed = false;
    old.addEventListener("dispose", () => (disposed = true));
    lib.release("bldg-red-barn");
    expect(disposed).toBe(true);
    // The same model object, its parts the same materials; their geometry baked again on first use, alike.
    expect(lib.model("bldg-red-barn")).toBe(model);
    const after = model.parts.map((p) => ({ material: p.material, count: p.geometry.getAttribute("position").count, normal: p.geometry.getAttribute("normal").array.constructor }));
    expect(after).toEqual(before);
    expect(model.parts[0].geometry).not.toBe(old);
    expect(model.parts[0].geometry).toBe(model.parts[0].geometry);
  });
});

import { Color, MeshStandardMaterial, Vector3, type BatchedMesh } from "three";
import { describe, expect, it } from "vitest";
import type { Prop } from "../../props/store";
import { FAR_ASK_FRAMES, FAR_PX_PER_MM, loadSimplifier } from "../far-detail";
import type { Materials } from "../materials";
import { PropLibrary } from "./library";
import { PropsView } from "./props-view";

function stubMaterials(): Materials {
  const m = (c = "#ffffff") => new MeshStandardMaterial({ color: new Color(c) });
  const lacquer = (c: string) => m(c);
  return new Proxy({ lacquer } as unknown as Materials, { get: (t, k) => (k in t ? t[k as keyof Materials] : m()) });
}

const idle = () => new Promise((r) => setTimeout(r, 200));

describe("props far off", () => {
  it("are drawn in their models' far versions under half a pixel a millimetre, back 10% nearer", async () => {
    await loadSimplifier();
    const lib = new PropLibrary(stubMaterials());
    await lib.load("bldg-bakery");
    const view = new PropsView(lib);
    const prop: Prop = { id: 1, asset: "bldg-bakery", x: 0, z: 0, heading: 0, y: 0 };
    const store = { version: 1, get: (id: number) => (id === 1 ? prop : undefined), all: () => [prop] };
    view.sync(store);
    const batches = view.group.children as BatchedMesh[];
    const ids = () => batches.map((b) => b.getGeometryIdAt(0));
    const near = ids();
    // (Far enough that its model's reach, a couple of hundred millimetres, hardly counts.)
    const pxScale = 1e6;
    // Straight up from it, as far as gives that many pixels a millimetre.
    const at = (pxPerMm: number) => new Vector3(0, pxScale / pxPerMm, 0);
    expect(view.setDetail(at(FAR_PX_PER_MM * 2), pxScale)).toBe(false);
    // Far for long enough (a camera moving out): its far versions asked for, drawn near until they're made.
    for (let i = 0; i < FAR_ASK_FRAMES; i++) expect(view.setDetail(at(FAR_PX_PER_MM * 0.5), pxScale)).toBe(false);
    await idle();
    expect(view.setDetail(at(FAR_PX_PER_MM * 0.5), pxScale)).toBe(true);
    const far = ids();
    expect(far).not.toEqual(near);
    // Fewer triangles than the model itself, in each batch it's in.
    for (const b of batches) {
      const id = b.getGeometryIdAt(0);
      const range = b.getGeometryRangeAt(id);
      const nearRange = b.getGeometryRangeAt(near[batches.indexOf(b)]);
      if (id !== near[batches.indexOf(b)]) expect(range!.count).toBeLessThan(nearRange!.count * 0.75);
    }
    // Near again only 10% nearer than the line.
    expect(view.setDetail(at(FAR_PX_PER_MM * 1.05), pxScale)).toBe(false);
    expect(view.setDetail(at(FAR_PX_PER_MM * 1.15), pxScale)).toBe(true);
    expect(ids()).toEqual(near);
  });
});

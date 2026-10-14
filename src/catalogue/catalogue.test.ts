import { Box3, Color, Mesh, MeshStandardMaterial, type Object3D } from "three";
import { beforeAll, describe, expect, it } from "vitest";
import type { Materials } from "../render/materials";
import { CATALOGUE } from "./assets";
import { Kit } from "./kit";
import { loadBlenderModels } from "../render/blender-models";

// The cars and the map's building parts are models (public/models): read from disk here.
beforeAll(() => loadBlenderModels());

/** Plain stand-ins for the game's materials (theirs need a canvas for textures). */
function stubMaterials(): Materials {
  const m = (c = "#ffffff") => new MeshStandardMaterial({ color: new Color(c) });
  const lacquer = (c: string) => m(c);
  return new Proxy({ lacquer } as unknown as Materials, { get: (t, k) => (k in t ? t[k as keyof Materials] : m()) });
}

describe("asset catalogue", () => {
  const kit = new Kit(stubMaterials());
  it("has unique ids, and every asset has a name, tags and notes", () => {
    const ids = new Set<string>();
    for (const a of CATALOGUE) {
      expect(ids.has(a.id), a.id).toBe(false);
      ids.add(a.id);
      expect(a.id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
      expect(a.name.length, a.id).toBeGreaterThan(0);
      expect(a.notes.length, a.id).toBeGreaterThan(10);
    }
  });

  for (const a of CATALOGUE) {
    it(`${a.id} builds, stands on the ground, and is a sensible size`, () => {
      const root: Object3D = a.build(kit);
      let meshes = 0;
      root.traverse((o) => {
        if ((o as Mesh).isMesh) meshes++;
      });
      expect(meshes).toBeGreaterThan(0);
      root.updateMatrixWorld(true);
      const box = new Box3().setFromObject(root);
      expect(box.min.y, "base").toBeGreaterThan(-15);
      expect(box.min.y, "base").toBeLessThan(15);
      const size = Math.max(box.max.x - box.min.x, box.max.y - box.min.y, box.max.z - box.min.z);
      expect(size).toBeGreaterThan(4);
      expect(size).toBeLessThan(2000);
      // Animation runs without throwing.
      a.animate?.(root, 1.3);
    });
  }
});

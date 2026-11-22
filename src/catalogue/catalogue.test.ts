import { Box3, Color, Mesh, MeshStandardMaterial, Raycaster, Vector3, type Object3D } from "three";
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

  it("routes both wheel channels through the end of the concept straight", () => {
    const piece = CATALOGUE.find(a => a.id === "track-long-straight")!.build(kit);
    piece.updateMatrixWorld(true);
    for (const z of [-13, 13]) {
      const above = new Raycaster(new Vector3(5, 20, z), new Vector3(0, -1, 0));
      const floor = above.intersectObject(piece)[0];
      expect(floor.point.y).toBeCloseTo(9.1);
      expect(floor.face?.materialIndex).toBe(1);
      const fromEnd = new Raycaster(new Vector3(150, 11, z), new Vector3(-1, 0, 0));
      expect(fromEnd.intersectObject(piece)).toHaveLength(0);
    }
  });

  it("seats the darker inlays below the surface on a kit deck", () => {
    const slab = kit.trackSlab(100);
    slab.updateMatrixWorld(true);
    for (const z of [-13, 13]) {
      const ray = new Raycaster(new Vector3(5, 20, z), new Vector3(0, -1, 0));
      const [inlay, wood] = ray.intersectObject(slab);
      expect(inlay.point.y).toBeCloseTo(9.4);
      expect(wood.point.y).toBeCloseTo(9.1);
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

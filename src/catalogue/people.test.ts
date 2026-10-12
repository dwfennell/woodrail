import { Box3, Matrix4, Mesh, MeshBasicMaterial, type Object3D } from "three";
import { MeshBVH } from "three-mesh-bvh";
import { describe, expect, it } from "vitest";
import { ASSETS as LIFE } from "./assets/life";
import { Kit } from "./kit";
import type { Materials } from "../render/materials";

/** Stand-in materials: the shapes are what's tested. */
const mats = new Proxy({} as Materials, { get: (_, key) => (key === "lacquer" ? () => new MeshBasicMaterial() : new MeshBasicMaterial()) });

const meshes = (o: Object3D): Mesh[] => {
  const out: Mesh[] = [];
  o.traverse((c) => {
    if ((c as Mesh).isMesh) out.push(c as Mesh);
  });
  return out;
};

const inArm = (o: Object3D, person: Object3D): boolean => {
  for (let p: Object3D | null = o; p && p !== person; p = p.parent) if (p.userData.arm || p.userData.held) return true;
  return false;
};

/** Pairs (arm or held part, hat part) that pass through each other, for a built model. */
function clashes(root: Object3D): string[] {
  root.updateMatrixWorld(true);
  const out: string[] = [];
  // Every peg person: the parent of an arm.
  const people = new Set<Object3D>();
  root.traverse((o) => {
    if (o.userData.arm && o.parent) people.add(o.parent);
  });
  for (const person of people) {
    const toLocal = new Matrix4().copy(person.matrixWorld).invert();
    const box = new Box3();
    // Hats (and anything else) above the head's middle, not part of an arm or a held thing.
    const hats = meshes(person).filter((m) => {
      if (inArm(m, person)) return false;
      box.setFromObject(m).applyMatrix4(toLocal);
      return box.min.y >= 14.6;
    });
    const handled = meshes(person).filter((m) => inArm(m, person));
    for (const hat of hats) {
      hat.geometry.computeBoundingBox();
      const bvh = new MeshBVH(hat.geometry);
      const hatInv = new Matrix4().copy(hat.matrixWorld).invert();
      for (const h of handled) {
        const toHat = new Matrix4().multiplyMatrices(hatInv, h.matrixWorld);
        if (bvh.intersectsGeometry(h.geometry, toHat)) out.push(`${h.geometry.type} × ${hat.geometry.type}`);
      }
    }
  }
  return out;
}

describe("peg people", () => {
  const kit = new Kit(mats);
  for (const asset of LIFE) {
    it(`${asset.id}: nothing held passes through a hat`, () => {
      expect(clashes(asset.build(kit))).toEqual([]);
    });
  }
});

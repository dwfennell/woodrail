import { Box3, Color, Group, MeshStandardMaterial, type Mesh, type Object3D } from "three";
import { describe, expect, it } from "vitest";
import { CAR_SPECS } from "../sim";
import type { Materials } from "./materials";
import { CRANE_HOOK, CRANE_ROPE, CRANE_TURRET } from "../catalogue/assets/breakdown-crane";
import { AXLE_HEIGHT, buildCarModel, disposeObject, WHEEL_RADIUS } from "./train-models";

/** Plain stand-ins for the game's materials (theirs need a canvas for textures). */
function stubMaterials(): Materials {
  const m = (c = "#ffffff") => new MeshStandardMaterial({ color: new Color(c) });
  const lacquer = (c: string) => m(c);
  return new Proxy({ lacquer } as unknown as Materials, { get: (t, k) => (k in t ? t[k as keyof Materials] : m()) });
}

describe("the track cleaner car", () => {
  it("is the catalogue's wagon on the rails: its brushes turn with its wheels, and it's its own length", () => {
    const model = buildCarModel("cleaner", stubMaterials());
    // (Its two axles, each a pair of wheels merged, and its brushes.)
    expect(model.wheels).toHaveLength(4);
    expect(model.wheels.filter((w) => w.name.startsWith("brush")).map((w) => w.name).sort()).toEqual(["brushA", "brushB"]);
    const box = new Box3().setFromObject(model.root);
    // Wheels' feet about on the groove floor, where the other cars' run.
    expect(Math.abs(box.min.y - (AXLE_HEIGHT - WHEEL_RADIUS))).toBeLessThan(1);
    // About its length along x (couplers poking out a little).
    expect(box.max.x - box.min.x).toBeGreaterThan(CAR_SPECS.cleaner.length - 2);
    expect(box.max.x - box.min.x).toBeLessThan(CAR_SPECS.cleaner.length + 10);
    model.root.traverse((o) => expect(o.userData.carKind).toBe("cleaner"));
  });
});

describe("the Kit-built cars", () => {
  const meshes = (o: Object3D) => {
    let n = 0;
    o.traverse((x) => (n += (x as Mesh).isMesh ? 1 : 0));
    return n;
  };

  /** The stand-ins, each the same material every time it's read (as the game's are), lacquer marked as paint. */
  function stableMaterials(): Materials {
    const made = new Map<string, MeshStandardMaterial>();
    const m = (key: string) => {
      let x = made.get(key);
      if (!x) made.set(key, (x = new MeshStandardMaterial()));
      return x;
    };
    const lacquer = (c: string) => {
      const x = m(`lacquer ${c}`);
      x.userData.paintColor = c;
      return x;
    };
    return new Proxy({ lacquer } as unknown as Materials, { get: (t, k) => (k in t ? t[k as keyof Materials] : m(String(k))) });
  }

  it("are merged by material: a few meshes each, their wheels turning by axle, the copies sharing one geometry", () => {
    const mats = stableMaterials();
    for (const kind of ["tanker", "reefer", "oiltank", "crane", "carrier", "mailvan", "sortvan", "cage"] as const) {
      const model = buildCarModel(kind, mats);
      expect(meshes(model.root), kind).toBeLessThanOrEqual(13);
      expect(model.wheels, kind).toHaveLength(2);
      const box = new Box3().setFromObject(model.root);
      expect(Math.abs(box.min.y - (AXLE_HEIGHT - WHEEL_RADIUS)), kind).toBeLessThan(1);
      const again = buildCarModel(kind, mats);
      const geos = (m: typeof model) => {
        const out: unknown[] = [];
        m.root.traverse((x) => (x as Mesh).isMesh && out.push((x as Mesh).geometry));
        return out;
      };
      expect(geos(again), kind).toEqual(geos(model));
      again.root.traverse((x) => (x as Mesh).isMesh && expect(x.userData.sharedGeometry).toBe(true));
    }
  });

  it("free their shared geometry with the last copy (a tray picture's car doesn't keep it), and build it again after", () => {
    const mats = stableMaterials();
    const a = buildCarModel("tanker", mats);
    const b = buildCarModel("tanker", mats);
    let freed = 0;
    a.root.traverse((x) => (x as Mesh).isMesh && (x as Mesh).geometry.addEventListener("dispose", () => freed++));
    // (One inside a group, as a tray picture's train or a dragged ghost holds them.)
    const train = new Group();
    train.add(b.root);
    disposeObject(a.root);
    expect(freed).toBe(0);
    disposeObject(train);
    expect(freed).toBeGreaterThan(0);
    const old = new Set<unknown>();
    a.root.traverse((x) => (x as Mesh).isMesh && old.add((x as Mesh).geometry));
    const c = buildCarModel("tanker", mats);
    c.root.traverse((x) => (x as Mesh).isMesh && expect(old.has((x as Mesh).geometry)).toBe(false));
    expect(meshes(c.root)).toBe(meshes(a.root));
  });

  it("keep their moving parts as nodes: the crane's turret, rope and hook", () => {
    const model = buildCarModel("crane", stableMaterials());
    for (const name of [CRANE_TURRET, CRANE_ROPE, CRANE_HOOK]) expect(model.root.getObjectByName(name), name).toBeTruthy();
    // The rope and hook turn with the turret.
    const turret = model.root.getObjectByName(CRANE_TURRET)!;
    expect(turret.getObjectByName(CRANE_HOOK)).toBeTruthy();
  });
});

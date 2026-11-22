import { Box3, Color, Group, MeshStandardMaterial, Vector3, type Mesh, type Object3D } from "three";
import { SHADOW_PROXY_LAYER } from "./dressing/blocks";
import { describe, expect, it } from "vitest";
import { CAR_SPECS, COUPLER_GAP } from "../sim";
import { loadBlenderModels } from "./blender-models";
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

  it("the Kit tanker and Blender coach run at the same rail height and their magnet faces meet", async () => {
    await loadBlenderModels();
    const mats = stableMaterials();
    const point = new Vector3();
    for (const kind of ["passenger", "oiltank"] as const) {
      const model = buildCarModel(kind, mats);
      model.root.updateMatrixWorld(true);
      for (const wheel of model.wheels) {
        expect(new Box3().setFromObject(wheel, true).min.y).toBeCloseTo(AXLE_HEIGHT - WHEEL_RADIUS, 1);
      }
      for (const end of [-1, 1]) {
        const face = new Box3();
        const contactX = end * (CAR_SPECS[kind].length + COUPLER_GAP) / 2;
        model.root.traverse((o) => {
          const mesh = o as Mesh;
          if (!mesh.isMesh || mesh.material !== mats.nickel) return;
          const pos = mesh.geometry.getAttribute("position");
          for (let i = 0; i < pos.count; i++) {
            point.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
            if (Math.abs(point.x - contactX) < 0.02) face.expandByPoint(point);
          }
        });
        expect(face.isEmpty()).toBe(false);
        expect(face.getCenter(point).y).toBeCloseTo(19, 1);
        expect(point.z).toBeCloseTo(0, 1);
        expect(face.getSize(point).y).toBeGreaterThan(8);
      }
      disposeObject(model.root);
    }
  });

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

describe("the Blender-built cars", () => {
  /** The stand-ins, lacquer marked as paint (as the game's are), each the same every time it's read. */
  function stableMaterials(): Materials {
    const made = new Map<string, MeshStandardMaterial>();
    const m = (key: string) => {
      let x = made.get(key);
      if (!x) made.set(key, (x = new MeshStandardMaterial({ vertexColors: key === "paint" })));
      return x;
    };
    const lacquer = (c: string) => {
      const x = m(`lacquer ${c}`);
      x.color.set(c);
      x.userData.paintColor = c;
      return x;
    };
    return new Proxy({ lacquer } as unknown as Materials, { get: (t, k) => (k in t ? t[k as keyof Materials] : m(String(k))) });
  }
  const casting = (o: Object3D) => {
    const out: Mesh[] = [];
    o.traverse((x) => (x as Mesh).isMesh && (x as Mesh).castShadow && out.push(x as Mesh));
    return out;
  };

  it("draw their body's lacquer colours as one paint mesh, in the same place, and cast one shadow stand-in", async () => {
    await loadBlenderModels();
    const mats = stableMaterials();
    for (const look of ["electric", "classic", "express"] as const) {
      const model = buildCarModel("engine", mats, 0, look);
      const paint = model.root.getObjectByName("paint") as Mesh;
      expect(paint.material, look).toBe(mats.paint);
      // (Every lacquer colour of the body in it, none left apart but the wheels'.)
      model.root.traverse((x) => {
        const mesh = x as Mesh;
        if (!mesh.isMesh || mesh === paint || !(mesh.material as MeshStandardMaterial).userData?.paintColor) return;
        expect(model.wheels.some((w) => w === mesh || w.getObjectById(mesh.id)), `${look} ${mesh.name}`).toBe(true);
      });
      // Where the parts were: the car's own size, centred on its axles (not its quantized model's numbers).
      paint.geometry.computeBoundingBox();
      const box = paint.geometry.boundingBox!;
      expect(box.max.x - box.min.x, look).toBeLessThan(CAR_SPECS.engine.length + 20);
      expect(Math.abs(box.min.x + box.max.x) / 2, look).toBeLessThan(15);
      // One stand-in casts the car's shadow, on the shadow-only layer; nothing else does.
      const casters = casting(model.root);
      expect(casters.map((c) => c.name), look).toEqual(["shadow"]);
      expect(casters[0].layers.mask, look).toBe(1 << SHADOW_PROXY_LAYER);
      // The selection's rims are still made a colour at a time.
      expect((paint.userData.shellParts as unknown[]).length, look).toBeGreaterThan(2);
      disposeObject(model.root);
    }
  });

  it("share the merged geometry between cars of the same colours, and free it with the last", async () => {
    await loadBlenderModels();
    const mats = stableMaterials();
    const a = buildCarModel("passenger", mats);
    const b = buildCarModel("passenger", mats);
    const painted = buildCarModel("passenger", mats, 0, "classic", false, { body: "#123456", trim: "#abcdef" });
    const paintOf = (m: typeof a) => (m.root.getObjectByName("paint") as Mesh).geometry;
    expect(paintOf(b)).toBe(paintOf(a));
    expect(paintOf(painted)).not.toBe(paintOf(a));
    let freed = 0;
    paintOf(a).addEventListener("dispose", () => freed++);
    disposeObject(a.root);
    expect(freed).toBe(0);
    disposeObject(b.root);
    expect(freed).toBe(1);
    disposeObject(painted.root);
  });
});

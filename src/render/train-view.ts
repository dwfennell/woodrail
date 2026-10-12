import { Color, Group, MeshStandardMaterial, Quaternion, Vector3, type Object3D } from "three";
import type { CarPose } from "../physics/derail-physics";
import { CAR_KINDS, type SimSnapshot } from "../sim";
import type { Materials } from "./materials";
import { buildCarModel, carVariant, disposeObject, WHEEL_RADIUS, type CarModel } from "./train-models";

interface CarEntry {
  model: CarModel;
  lastX: number;
  lastZ: number;
  spin: number;
  tip: number;
}

const LAMP_COLORS: Record<number, [Color, number]> = {
  1: [new Color("#7dff8a"), 2.5],
  0: [new Color("#ffaa33"), 0.25],
  [-1]: [new Color("#ff5a4a"), 2.5],
};

/** Draws cars from a SimSnapshot. Picking: `carAt(object)` returns the car id of a hit, or -1. */
export class TrainView {
  readonly group = new Group();
  private readonly cars = new Map<number, CarEntry>();

  constructor(private readonly mats: Materials) {}

  private readonly pose: CarPose = { position: new Vector3(), quaternion: new Quaternion() };
  /** Cars seen this frame (kept between frames to avoid garbage). */
  private readonly seen = new Set<number>();

  update(snap: SimSnapshot, dt: number, physicsPose?: (carId: number, out: CarPose) => CarPose | null): void {
    const seen = this.seen;
    seen.clear();
    for (let i = 0; i < snap.count; i++) {
      const id = snap.ids[i];
      seen.add(id);
      let entry = this.cars.get(id);
      const o = i * 6;
      const x = snap.transforms[o];
      const y = snap.transforms[o + 1];
      const z = snap.transforms[o + 2];
      if (!entry) {
        const kind = CAR_KINDS[snap.kinds[i]];
        // The colour scheme follows the car (its id survives being picked up and put down), not the order models were built.
        const model = buildCarModel(kind, this.mats, carVariant(kind, id));
        model.root.traverse((obj) => (obj.userData.carId = id));
        if (model.lamp) model.lamp.userData.ownsMaterial = true;
        this.group.add(model.root);
        entry = { model, lastX: x, lastZ: z, spin: 0, tip: 0 };
        this.cars.set(id, entry);
      }
      const heading = snap.transforms[o + 3];
      const pitch = snap.transforms[o + 4];
      const root = entry.model.root;
      root.position.set(x, y, z);
      root.rotation.order = "YZX";
      root.rotation.y = -heading;
      root.rotation.z = pitch;

      // Wheels turn with distance travelled along the car's heading.
      const dx = x - entry.lastX;
      const dz = z - entry.lastZ;
      const along = dx * Math.cos(heading) + dz * Math.sin(heading);
      entry.spin -= along / WHEEL_RADIUS;
      for (const w of entry.model.wheels) w.rotation.z = entry.spin;
      entry.lastX = x;
      entry.lastZ = z;

      if (snap.derailed[i] && physicsPose?.(id, this.pose)) {
        root.position.copy(this.pose.position);
        root.quaternion.copy(this.pose.quaternion);
        entry.lastX = root.position.x;
        entry.lastZ = root.position.z;
        entry.tip = 0;
        continue;
      }

      // Without physics (still loading, or unavailable) a derailed car simply topples onto its side.
      const targetTip = snap.derailed[i] ? 1 : 0;
      entry.tip += (targetTip - entry.tip) * Math.min(1, dt * 6);
      root.rotation.x = entry.tip * (Math.PI / 2) * (id % 2 ? 1 : -1);
      root.position.y = y + entry.tip * 12;

      if (entry.model.lamp) {
        const [color, intensity] = LAMP_COLORS[snap.levers[i]] ?? LAMP_COLORS[0];
        const m = entry.model.lamp.material as MeshStandardMaterial;
        m.emissive.copy(color);
        m.emissiveIntensity = intensity;
      }
    }
    for (const [id, entry] of this.cars) {
      if (!seen.has(id)) {
        this.group.remove(entry.model.root);
        disposeObject(entry.model.root);
        this.cars.delete(id);
      }
    }
  }

  carAt(object: Object3D): number {
    const id = object.userData.carId;
    return typeof id === "number" ? id : -1;
  }

  carObject(carId: number): Object3D | undefined {
    return this.cars.get(carId)?.model.root;
  }
}

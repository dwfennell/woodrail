import { BackSide, Box3, Color, Group, Matrix4, Mesh, MeshBasicMaterial, MeshStandardMaterial, Vector3, type Object3D } from "three";
import { CAR_KINDS, type CarLook, type SimSnapshot } from "../sim";
import type { Materials } from "./materials";
import { OUTLINE_TONES } from "./track-view";
import { buildCarModel, carVariant, disposeObject, WHEEL_RADIUS, type CarModel } from "./train-models";

interface CarEntry {
  model: CarModel;
  lastX: number;
  lastZ: number;
  spin: number;
  tip: number;
  /**
   * Its selection shells (made the first time it's selected), and how strongly they show: 0 off, 1 its train, 2 it, 3
   * its train flashed (in another train's way, shown from that one's card: see `setFlash`).
   */
  shells: Mesh[] | null;
  shown: 0 | 1 | 2 | 3;
}

/** How far a selection shell stands proud of a car's parts (mm). */
const SHELL_GROW = 1.8;
/** The faint dark ring just inside it (mm): the light rim alone is lost against pale wood (a timber wagon's deck). */
const SHELL_INNER = 0.8;
/**
 * The car whose card is open: its rim wider, and its dark ring with it (QA: at 1.8 mm, as the rest of its train, it
 * hardly told it apart, and on a pale timber wagon hardly showed at all).
 */
const SHELL_GROW_CAR = 2.6;
const SHELL_INNER_CAR = 1.1;
/** A part gets a shell if it's at least this share of the car's longest part. */
const SHELL_PART = 0.4;

const LAMP_COLORS: Record<number, [Color, number]> = {
  1: [new Color("#7dff8a"), 2.5],
  0: [new Color("#ffaa33"), 0.25],
  [-1]: [new Color("#ff5a4a"), 2.5],
};

/** Draws cars from a SimSnapshot. Picking: `carAt(object)` returns the car id of a hit, or -1. */
export class TrainView {
  /** Each car's look (see `Sim.lookOf`). */
  lookOf: (carId: number) => CarLook = () => "classic";
  readonly group = new Group();
  private readonly cars = new Map<number, CarEntry>();

  /** The car whose card is open (its whole train is outlined, it a little more), or −1. */
  private selected = -1;
  // The selection look of track pieces (track-view): each part drawn again, back faces only, a little larger, so a
  // soft warm rim shows round the edges. Static: a selected train standing still draws nothing more.
  private readonly shellTrain = new MeshBasicMaterial({ color: new Color(OUTLINE_TONES.select), side: BackSide, transparent: true, opacity: 0.32, depthWrite: false });
  // The car whose card is open: the same rim, solid and wider (see SHELL_GROW_CAR), its dark ring a clear edge (so it
  // reads on a pale body too); the rest of its train keeps the soft look.
  private readonly shellCar = new MeshBasicMaterial({ color: new Color(OUTLINE_TONES.select), side: BackSide, transparent: true, opacity: 1, depthWrite: false });
  // A faint dark ring inside the rim, drawn over its inside edge.
  private readonly ringTrain = new MeshBasicMaterial({ color: new Color("#4a3214"), side: BackSide, transparent: true, opacity: 0.18, depthWrite: false });
  private readonly ringCar = new MeshBasicMaterial({ color: new Color("#3a2410"), side: BackSide, transparent: true, opacity: 0.85, depthWrite: false });

  /** The car whose train flashes (in the way of the open card's train: Show), or −1; see `setFlash`. */
  private flashed = -1;
  // Its rim: the selected car's shell, in a warm coral, its strength eased by `setFlash` (no shell is touched for that,
  // only this material's opacity).
  private readonly shellFlash = new MeshBasicMaterial({ color: new Color(OUTLINE_TONES.blocked), side: BackSide, transparent: true, opacity: 0, depthWrite: false });
  private readonly ringFlash = new MeshBasicMaterial({ color: new Color("#5a1a08"), side: BackSide, transparent: true, opacity: 0, depthWrite: false });

  constructor(private readonly mats: Materials) {}

  /**
   * Flash the train of this car (−1: none) at this strength (0 to 1). Its shells show from the next `update`; the
   * caller (a flourish, for a moment) keeps frames coming while it pulses, and ends it with −1.
   */
  setFlash(carId: number, strength: number): void {
    this.flashed = carId;
    this.shellFlash.opacity = 0.95 * strength;
    this.ringFlash.opacity = 0.8 * strength;
  }

  /** Outline the train of this car, and it a little more (−1: none). Draws at the next frame (the caller invalidates). */
  setSelected(carId: number): void {
    this.selected = carId;
  }

  /** Cars seen this frame (kept between frames to avoid garbage). */
  private readonly seen = new Set<number>();

  /** Draw the cars where the sim has them. True while a derailed car is still toppling over. */
  update(snap: SimSnapshot, dt: number): boolean {
    let tipping = false;
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
        const model = buildCarModel(kind, this.mats, carVariant(kind, id), this.lookOf(id));
        model.root.traverse((obj) => (obj.userData.carId = id));
        if (model.lamp) model.lamp.userData.ownsMaterial = true;
        this.group.add(model.root);
        entry = { model, lastX: x, lastZ: z, spin: 0, tip: 0, shells: null, shown: 0 };
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

      // A derailed car topples onto its side where it is.
      const targetTip = snap.derailed[i] ? 1 : 0;
      entry.tip += (targetTip - entry.tip) * Math.min(1, dt * 6);
      if (Math.abs(targetTip - entry.tip) < 0.002) entry.tip = targetTip;
      else tipping = true;
      root.rotation.x = entry.tip * (Math.PI / 2) * (id % 2 ? 1 : -1);
      root.position.y = y + entry.tip * 12;

      if (entry.model.lamp) {
        const [color, intensity] = LAMP_COLORS[snap.levers[i]] ?? LAMP_COLORS[0];
        const m = entry.model.lamp.material as MeshStandardMaterial;
        m.emissive.copy(color);
        m.emissiveIntensity = intensity;
      }
    }
    this.syncSelection(snap);
    for (const [id, entry] of this.cars) {
      if (!seen.has(id)) {
        this.group.remove(entry.model.root);
        disposeObject(entry.model.root);
        this.cars.delete(id);
      }
    }
    return tipping;
  }

  /** Each car's shells as its selection asks (only those that change are touched; trains coupling or parting follow). */
  private syncSelection(snap: SimSnapshot): void {
    let train = -1;
    let flashed = -1;
    if (this.selected !== -1 || this.flashed !== -1) {
      for (let i = 0; i < snap.count; i++) {
        if (snap.ids[i] === this.selected) train = snap.trainIds[i];
        if (snap.ids[i] === this.flashed) flashed = snap.trainIds[i];
      }
    }
    for (let i = 0; i < snap.count; i++) {
      const entry = this.cars.get(snap.ids[i]);
      if (!entry) continue;
      const tid = snap.trainIds[i];
      const want = tid === flashed && tid !== train ? 3 : train === -1 ? 0 : snap.ids[i] === this.selected ? 2 : tid === train ? 1 : 0;
      if (want !== entry.shown) this.showShells(entry, want);
    }
  }

  private showShells(entry: CarEntry, level: 0 | 1 | 2 | 3): void {
    entry.shown = level;
    if (level === 0 && !entry.shells) return;
    entry.shells ??= this.makeShells(entry.model.root);
    for (const shell of entry.shells) {
      shell.visible = level !== 0;
      const ring = shell.userData.ring as boolean;
      shell.material = level === 3 ? (ring ? this.ringFlash : this.shellFlash) : ring ? (level === 2 ? this.ringCar : this.ringTrain) : level === 2 ? this.shellCar : this.shellTrain;
      // (Its size for the level: the selected car's stands a little prouder (and a flashed train's). Set only when the
      // selection changes.)
      const m = (level >= 2 ? shell.userData.carMatrix : shell.userData.trainMatrix) as Matrix4;
      if (!shell.matrix.equals(m)) {
        shell.matrix.copy(m);
        shell.matrixWorldNeedsUpdate = true;
      }
    }
  }

  /**
   * A shell on each big part of a car (body, chassis, cab, boiler: what makes its outline): its own geometry, scaled
   * about its centre to stand SHELL_GROW proud all round. Small parts (wheels, stanchions, lamps) and
   * a hopper's coal get none: their rims would lie over the body beside them.
   */
  private makeShells(root: Object3D): Mesh[] {
    const parts: { part: Mesh; size: Vector3; centre: Vector3; scale: Vector3 }[] = [];
    root.traverse((o) => {
      const part = o as Mesh;
      if (!part.isMesh) return;
      // A hopper's modelled coal is a load, not the car's shape (and its lumps' rims would only speckle it).
      for (let p: Object3D | null = part; p && p !== root; p = p.parent) if (p.name.startsWith("coal")) return;
      const g = part.geometry;
      if (!g.boundingBox) g.computeBoundingBox();
      const box = g.boundingBox ?? new Box3();
      // The part's own scale (up to the car), so its size is in mm and the rim is as wide on a stretched part.
      const scale = new Vector3(1, 1, 1);
      for (let p: Object3D | null = part; p && p !== root; p = p.parent) scale.multiply(p.scale);
      parts.push({ part, size: box.getSize(new Vector3()), centre: box.getCenter(new Vector3()), scale });
    });
    const span = (q: (typeof parts)[number]) => Math.max(q.size.x * Math.abs(q.scale.x), q.size.y * Math.abs(q.scale.y), q.size.z * Math.abs(q.scale.z));
    const longest = Math.max(0, ...parts.map(span));
    return parts
      .filter((q) => span(q) >= SHELL_PART * longest)
      .flatMap(({ part, size, centre, scale }) =>
        // The light rim, and the faint dark ring inside it (drawn after, over the rim's inside edge): each sized for
        // the rest of a selected train, and for the selected car (see `showShells`).
        [
          [SHELL_GROW, SHELL_GROW_CAR],
          [SHELL_INNER, SHELL_INNER_CAR],
        ].map(([by, byCar], i) => {
          const sized = (by: number) => {
            const grow = (n: number, s: number) => (n > 1e-6 ? (n + (2 * by) / Math.abs(s || 1)) / n : 1);
            return new Matrix4()
              .makeTranslation(centre.x, centre.y, centre.z)
              .multiply(new Matrix4().makeScale(grow(size.x, scale.x), grow(size.y, scale.y), grow(size.z, scale.z)))
              .multiply(new Matrix4().makeTranslation(-centre.x, -centre.y, -centre.z));
          };
          const shell = new Mesh(part.geometry, this.shellTrain);
          shell.matrixAutoUpdate = false;
          shell.userData.trainMatrix = sized(by);
          shell.userData.carMatrix = sized(byCar);
          shell.matrix.copy(shell.userData.trainMatrix);
          shell.renderOrder = 2 + i;
          shell.userData.ring = i === 1;
          shell.castShadow = false;
          shell.receiveShadow = false;
          shell.raycast = () => {};
          // The part owns the geometry (disposeObject frees it once); the materials are this view's.
          shell.userData.sharedGeometry = true;
          part.add(shell);
          return shell;
        }),
      );
  }

  carAt(object: Object3D): number {
    const id = object.userData.carId;
    return typeof id === "number" ? id : -1;
  }

  carObject(carId: number): Object3D | undefined {
    return this.cars.get(carId)?.model.root;
  }
}

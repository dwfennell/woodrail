import { BatchedMesh, Group, Matrix4, Quaternion, Vector3, type Material, type Object3D } from "three";
import type { Prop, PropStore } from "../../props/store";
import { drawnKey, type PropLibrary } from "./library";
import { compacted, makeRoom, type BatchRoom } from "../compact";
import { FAR_ASK_FRAMES, farGeometryOf, farIndexLater, FAR_HYSTERESIS, FAR_PX_PER_MM } from "../far-detail";

/** What the view draws: the store, or anything shaped like it (the kit pieces, see `KitView`). */
export type PropSource = Pick<PropStore, "version" | "get"> & { all(): Iterable<Prop> };

/** Every prop part in one material: each model's geometry stored once, each prop an instance of it. */
interface Batch {
  mesh: BatchedMesh;
  /** Geometry id of each model's part in this batch. */
  geometryOf: Map<string, number>;
  /** Prop id of each instance. */
  propOf: Map<number, number>;
  /** Geometry id of each model's part's far version (`farGeometry`) in this batch; null if it has none. */
  farOf: Map<string, number | null>;
  /** Room for this many vertices and indices of geometry (see `makeRoom`). */
  room: BatchRoom;
}

/** A prop as drawn: its instances, and the pose and visibility they were last set for. */
interface Drawn {
  asset: string;
  instances: { batch: Batch; id: number }[];
  key: string;
  visible: boolean;
  /** Where it stands (world) and how far from there its model reaches, for its distance from the eye. */
  at: Vector3;
  radius: number;
  /** Drawn in its far version (see `setDetail`). */
  isFar: boolean;
  /** Frames the camera moved in that it's wanted its far version before it's made (see `FAR_ASK_FRAMES`). */
  wanted: number;
}

const m = new Matrix4();
const q = new Quaternion();
const up = new Vector3(0, 1, 0);
const pos = new Vector3();
const one = new Vector3(1, 1, 1);
const sized = new Vector3();

const START_INSTANCES = 64;
const START_VERTICES = 1 << 15;
/** (Welded: about six indices a vertex.) */
const START_INDICES = 1 << 17;

/**
 * Draws the props: one `BatchedMesh` per material (a handful in all), holding every model's part in that material once
 * and an instance per prop. Draw calls stay the same however many props and models there are; each instance is
 * frustum-culled on its own. `sync` updates only the props that changed (keyed by the store's version); nothing runs
 * per frame.
 */
export class PropsView {
  readonly group = new Group();
  private readonly batches = new Map<Material, Batch>();
  private readonly drawn = new Map<number, Drawn>();
  private syncedFor = "";
  /** Models asked for and not yet loaded. */
  private readonly waiting = new Set<string>();

  constructor(private readonly library: PropLibrary) {
    this.group.name = "props";
  }

  /**
   * Bring the instances up to date with the store. `hidden` is a prop being moved (drawn by the hand instead). `force`
   * after a model has loaded, to draw the props that were waiting for it. Returns true if anything changed.
   */
  sync(store: PropSource, hidden = -1, force = false): boolean {
    const key = `${store.version}|${hidden}`;
    if (key === this.syncedFor && !force) return false;
    this.syncedFor = key;
    const touched = new Set<Batch>();
    for (const [id, d] of this.drawn) {
      const p = store.get(id);
      if (p && drawnKey(p.asset, p.variant, p.storeys) === d.asset) continue;
      for (const inst of d.instances) {
        inst.batch.mesh.deleteInstance(inst.id);
        inst.batch.propOf.delete(inst.id);
        touched.add(inst.batch);
      }
      this.drawn.delete(id);
    }
    for (const p of store.all()) {
      let d = this.drawn.get(p.id);
      if (!d) {
        const key = drawnKey(p.asset, p.variant, p.storeys);
        const model = this.library.model(key);
        if (model === undefined) {
          if (!this.waiting.has(key)) {
            this.waiting.add(key);
            // If it can't be fetched, stop waiting: the next sync asks again.
            this.library.load(key).then(
              () => this.waiting.delete(key),
              (e: unknown) => {
                console.warn(`Woodrail: couldn't load the model ${key}`, e);
                this.waiting.delete(key);
              },
            );
          }
          continue;
        }
        if (model === null) continue;
        const box = model.footprint;
        d = { asset: key, instances: [], key: "", visible: true, at: new Vector3(), radius: Math.hypot(Math.abs(box.cx) + box.hw, Math.abs(box.cz) + box.hd, model.height), isFar: false, wanted: 0 };
        for (const part of model.parts) {
          const batch = this.batchFor(part.material);
          let gid = batch.geometryOf.get(key);
          if (gid === undefined) {
            const g = compacted(part.geometry);
            makeRoom(batch.mesh, batch.room, g);
            gid = batch.mesh.addGeometry(g);
            batch.geometryOf.set(key, gid);
          }
          if (batch.mesh.instanceCount >= batch.mesh.maxInstanceCount) batch.mesh.setInstanceCount(batch.mesh.maxInstanceCount * 2);
          const id = batch.mesh.addInstance(gid);
          batch.propOf.set(id, p.id);
          d.instances.push({ batch, id });
          touched.add(batch);
        }
        this.drawn.set(p.id, d);
      }
      const poseKey = `${p.x}|${p.z}|${p.heading}|${p.y}|${p.scale ?? 1}`;
      if (poseKey !== d.key) {
        d.key = poseKey;
        d.at.set(p.x, p.y, p.z);
        q.setFromAxisAngle(up, -p.heading);
        m.compose(pos.set(p.x, p.y, p.z), q, p.scale ? sized.setScalar(p.scale) : one);
        for (const inst of d.instances) {
          inst.batch.mesh.setMatrixAt(inst.id, m);
          touched.add(inst.batch);
        }
      }
      const visible = p.id !== hidden;
      if (visible !== d.visible) {
        d.visible = visible;
        for (const inst of d.instances) inst.batch.mesh.setVisibleAt(inst.id, visible);
      }
    }
    for (const b of touched) b.mesh.computeBoundingSphere();
    return true;
  }

  /**
   * On a drawn frame: each prop drawn in its model's far version (the same within `FAR_ERROR` mm, a fifth of the
   * triangles or fewer) where a millimetre at its nearest is under `FAR_PX_PER_MM` pixels, back 10% nearer. Far versions
   * are made once wanted on `FAR_ASK_FRAMES` frames drawn while the camera moved (`moving`), when the page is idle (until
   * then the model is drawn). `pxScale`: see `updateFarDetail`. Returns true if any prop changed version.
   */
  setDetail(eye: Vector3, pxScale: number, moving = true): boolean {
    let changed = false;
    for (const d of this.drawn.values()) {
      const dist = Math.max(1, eye.distanceTo(d.at) - d.radius * this.scaleOf(d));
      const wantFar = pxScale / dist < FAR_PX_PER_MM * (d.isFar ? FAR_HYSTERESIS : 1);
      if (!wantFar) d.wanted = 0;
      if (wantFar === d.isFar) continue;
      if (wantFar && !this.farReady(d, moving && ++d.wanted >= FAR_ASK_FRAMES)) continue;
      d.isFar = wantFar;
      for (const inst of d.instances) {
        const near = inst.batch.geometryOf.get(d.asset)!;
        const far = inst.batch.farOf.get(d.asset);
        inst.batch.mesh.setGeometryIdAt(inst.id, wantFar && far != null ? far : near);
      }
      changed = true;
    }
    return changed;
  }

  /** A prop's scale (its model's size drawn bigger or smaller), from its pose key. */
  private scaleOf(d: Drawn): number {
    const s = Number(d.key.slice(d.key.lastIndexOf("|") + 1));
    return s > 0 ? s : 1;
  }

  /** Are a prop's model's far versions made (in each batch it's in)? If not, they're asked for (if `ask`). */
  private farReady(d: Drawn, ask: boolean): boolean {
    let ready = true;
    for (const inst of d.instances) {
      if (inst.batch.farOf.has(d.asset)) continue;
      ready = false;
      if (ask) this.askFar(d.asset);
    }
    return ready;
  }

  private readonly farAsked = new Set<string>();

  /** Make a model's parts' far versions (off the main thread: `farIndexLater`) and put them in their batches (once). */
  private askFar(key: string): void {
    if (this.farAsked.has(key)) return;
    this.farAsked.add(key);
    const model = this.library.model(key);
    const asked: Promise<void>[] = [];
    for (const part of model?.parts ?? []) {
      const batch = this.batches.get(part.material);
      if (!batch || !batch.geometryOf.has(key)) continue;
      const g = compacted(part.geometry);
      asked.push(
        farIndexLater(g).then((index) => {
          // (The view put away meanwhile: nothing to add to.)
          if (this.batches.get(part.material) !== batch) return;
          if (!index) {
            batch.farOf.set(key, null);
            return;
          }
          const far = farGeometryOf(g, index);
          makeRoom(batch.mesh, batch.room, far);
          batch.farOf.set(key, batch.mesh.addGeometry(far));
          far.dispose();
        }),
      );
    }
    // (A part in no batch yet, or none: nothing far for it.)
    void Promise.all(asked).then(() => {
      for (const b of this.batches.values()) if (b.geometryOf.has(key) && !b.farOf.has(key)) b.farOf.set(key, null);
    });
  }

  /** The prop id an intersected batch instance stands for (or −1). */
  propAt(object: Object3D, batchId: number | undefined): number {
    if (batchId === undefined) return -1;
    for (const b of this.batches.values()) if (b.mesh === object) return b.propOf.get(batchId) ?? -1;
    return -1;
  }

  private batchFor(material: Material): Batch {
    let batch = this.batches.get(material);
    if (!batch) {
      const mesh = new BatchedMesh(START_INSTANCES, START_VERTICES, START_INDICES, material);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.sortObjects = material.transparent;
      mesh.name = "props";
      this.group.add(mesh);
      batch = { mesh, geometryOf: new Map(), propOf: new Map(), farOf: new Map(), room: { vertices: START_VERTICES, indices: START_INDICES } };
      this.batches.set(material, batch);
    }
    return batch;
  }

  /** Draw calls (one per material in use), for the performance readout. */
  get drawCalls(): number {
    let n = 0;
    for (const b of this.batches.values()) if (b.propOf.size > 0) n++;
    return n;
  }

  dispose(): void {
    for (const b of this.batches.values()) b.mesh.dispose();
    this.batches.clear();
    this.drawn.clear();
    this.group.clear();
  }
}

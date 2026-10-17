import { BatchedMesh, Group, Matrix4, Quaternion, Vector3, type Material, type Object3D } from "three";
import type { PropStore } from "../../props/store";
import { modelKey, type PropLibrary } from "./library";

/** Every prop part in one material: each model's geometry stored once, each prop an instance of it. */
interface Batch {
  mesh: BatchedMesh;
  /** Geometry id of each model's part in this batch. */
  geometryOf: Map<string, number>;
  /** Prop id of each instance. */
  propOf: Map<number, number>;
  /** Room for this many vertices of geometry (grown by doubling). */
  vertices: number;
}

/** A prop as drawn: its instances, and the pose and visibility they were last set for. */
interface Drawn {
  asset: string;
  instances: { batch: Batch; id: number }[];
  key: string;
  visible: boolean;
}

const m = new Matrix4();
const q = new Quaternion();
const up = new Vector3(0, 1, 0);
const pos = new Vector3();

const START_INSTANCES = 64;
const START_VERTICES = 1 << 16;

/**
 * Draws the props: one `BatchedMesh` per material (a handful in all), holding every model's part in that material once
 * and an instance per prop. Draw calls stay the same however many props and models there are; each instance is
 * frustum-culled on its own. `sync` updates only the props that changed (keyed by the store's version); nothing runs
 * per frame.
 */
/** Scale study (scratch): models drawn at this scale, by asset id. */
export const ASSET_SCALE = new Map<string, number>();
const scaled = new Vector3();

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
  sync(store: PropStore, hidden = -1, force = false): boolean {
    const key = `${store.version}|${hidden}`;
    if (key === this.syncedFor && !force) return false;
    this.syncedFor = key;
    const touched = new Set<Batch>();
    for (const [id, d] of this.drawn) {
      const p = store.get(id);
      if (p && modelKey(p.asset, p.variant) === d.asset) continue;
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
        const key = modelKey(p.asset, p.variant);
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
        d = { asset: key, instances: [], key: "", visible: true };
        for (const part of model.parts) {
          const batch = this.batchFor(part.material);
          let gid = batch.geometryOf.get(key);
          if (gid === undefined) {
            const need = part.geometry.getAttribute("position").count;
            const mesh = batch.mesh;
            if (mesh.unusedVertexCount < need) {
              batch.vertices = Math.max(batch.vertices * 2, batch.vertices + need);
              mesh.setGeometrySize(batch.vertices, batch.vertices * 2);
            }
            gid = mesh.addGeometry(part.geometry);
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
      const k = ASSET_SCALE.get(p.asset) ?? 1;
      const poseKey = `${p.x}|${p.z}|${p.heading}|${p.y}|${k}`;
      if (poseKey !== d.key) {
        d.key = poseKey;
        q.setFromAxisAngle(up, -p.heading);
        m.compose(pos.set(p.x, p.y, p.z), q, scaled.set(k, k, k));
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

  /** The prop id an intersected batch instance stands for (or −1). */
  propAt(object: Object3D, batchId: number | undefined): number {
    if (batchId === undefined) return -1;
    for (const b of this.batches.values()) if (b.mesh === object) return b.propOf.get(batchId) ?? -1;
    return -1;
  }

  private batchFor(material: Material): Batch {
    let batch = this.batches.get(material);
    if (!batch) {
      const mesh = new BatchedMesh(START_INSTANCES, START_VERTICES, START_VERTICES * 2, material);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.sortObjects = material.transparent;
      mesh.name = "props";
      this.group.add(mesh);
      batch = { mesh, geometryOf: new Map(), propOf: new Map(), vertices: START_VERTICES };
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

import { Group, InstancedMesh, Matrix4, Quaternion, Vector3 } from "three";
import type { Prop, PropStore } from "../../props/store";
import type { PropLibrary, PropModel } from "./library";

/** Instances of one model: a mesh per part, sharing the instance list. */
interface Batch {
  meshes: InstancedMesh[];
  capacity: number;
  /** Prop id of each instance, in order. */
  ids: number[];
}

const m = new Matrix4();
const q = new Quaternion();
const up = new Vector3(0, 1, 0);
const pos = new Vector3();
const one = new Vector3(1, 1, 1);
const zero = new Vector3(0, 0, 0);

/**
 * Draws the props: one instanced mesh per (model, part), so draw calls grow with the number of different models
 * placed, not with copies. `sync` rewrites the instance matrices when the props change (keyed by the store's version);
 * nothing runs per frame.
 */
export class PropsView {
  readonly group = new Group();
  private readonly batches = new Map<string, Batch>();
  /** What the instances were last written for: the store's version and the hidden prop. */
  private syncedFor = "";
  /** Models asked for and not yet loaded. */
  private readonly waiting = new Set<string>();

  constructor(private readonly library: PropLibrary) {
    this.group.name = "props";
  }

  /**
   * Bring the instances up to date with the store. `hidden` is a prop being moved (drawn by the hand instead): its
   * instance shrinks to nothing where it stands, so the batch's bounds don't stretch. Returns true if anything changed.
   */
  sync(store: PropStore, hidden = -1, force = false): boolean {
    const key = `${store.version}|${hidden}`;
    if (key === this.syncedFor && !force) return false;
    this.syncedFor = key;
    const byAsset = new Map<string, Prop[]>();
    for (const p of store.all()) {
      let list = byAsset.get(p.asset);
      if (!list) byAsset.set(p.asset, (list = []));
      list.push(p);
    }
    for (const [asset, batch] of this.batches) {
      if (!byAsset.has(asset)) {
        for (const mesh of batch.meshes) mesh.count = 0;
        batch.ids.length = 0;
      }
    }
    for (const [asset, props] of byAsset) {
      const model = this.library.model(asset);
      if (model === undefined) {
        if (!this.waiting.has(asset)) {
          this.waiting.add(asset);
          void this.library.load(asset).then(() => this.waiting.delete(asset));
        }
        continue;
      }
      if (model === null) continue;
      const batch = this.batchFor(asset, model, props.length);
      batch.ids.length = 0;
      props.forEach((p, i) => {
        batch.ids.push(p.id);
        q.setFromAxisAngle(up, -p.heading);
        m.compose(pos.set(p.x, p.y, p.z), q, p.id === hidden ? zero : one);
        for (const mesh of batch.meshes) mesh.setMatrixAt(i, m);
      });
      for (const mesh of batch.meshes) {
        mesh.count = props.length;
        mesh.instanceMatrix.needsUpdate = true;
        mesh.computeBoundingSphere();
      }
    }
    return true;
  }

  /** The prop id an intersected instance stands for (or −1). */
  propAt(mesh: InstancedMesh, instanceId: number | undefined): number {
    if (instanceId === undefined) return -1;
    for (const batch of this.batches.values()) if (batch.meshes.includes(mesh)) return batch.ids[instanceId] ?? -1;
    return -1;
  }

  /** The batch for a model, with room for `n` instances (grown by doubling, rebuilt only then). */
  private batchFor(asset: string, model: PropModel, n: number): Batch {
    let batch = this.batches.get(asset);
    if (batch && batch.capacity >= n) return batch;
    const capacity = Math.max(4, batch ? batch.capacity * 2 : 4, n);
    if (batch) for (const mesh of batch.meshes) {
      this.group.remove(mesh);
      mesh.dispose();
    }
    const meshes = model.parts.map((part) => {
      const mesh = new InstancedMesh(part.geometry, part.material, capacity);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.count = 0;
      mesh.name = asset;
      this.group.add(mesh);
      return mesh;
    });
    batch = { meshes, capacity, ids: batch?.ids ?? [] };
    this.batches.set(asset, batch);
    return batch;
  }

  /** Draw call count (for the performance readout). */
  get drawCalls(): number {
    let n = 0;
    for (const b of this.batches.values()) if (b.ids.length > 0) n += b.meshes.length;
    return n;
  }

  dispose(): void {
    for (const b of this.batches.values()) for (const mesh of b.meshes) mesh.dispose();
    this.batches.clear();
    this.group.clear();
  }
}

import { Box3, BufferAttribute, type BufferGeometry, type Material, type Mesh, type Object3D } from "three";
import { Kit } from "../../catalogue/kit";
import { loadAsset } from "../../catalogue/registry";
import type { Footprint } from "../../props/placement";
import { Batcher } from "../dressing/batcher";
import type { Materials } from "../materials";

/** A catalogue model baked for drawing many copies: a few merged parts, and its size on the ground. */
export interface PropModel {
  name: string;
  /** One geometry per material (every lacquer colour folded into the vertex-coloured paint). */
  parts: { geometry: BufferGeometry; material: Material }[];
  footprint: Footprint;
  height: number;
}

/**
 * Builds catalogue models on first use and keeps them: the asset's code is fetched (its catalogue file's chunk), its
 * `build` run once, and the result baked into a handful of merged parts. Nothing is built for models never used.
 */
export class PropLibrary {
  private readonly kit: Kit;
  private readonly models = new Map<string, PropModel | null>();
  private readonly pending = new Map<string, Promise<PropModel | null>>();
  /** Called when a model finishes loading (to draw props that were waiting for it). */
  onLoaded: ((assetId: string) => void) | null = null;

  constructor(private readonly mats: Materials) {
    // Fewer segments than the catalogue viewer's: props are small on screen, and many.
    this.kit = new Kit(mats, PROP_DETAIL);
  }

  /** The model if it's built (null if the asset doesn't exist; undefined if not loaded yet). */
  model(assetId: string): PropModel | null | undefined {
    return this.models.get(assetId);
  }

  footprint = (assetId: string): Footprint | undefined => this.models.get(assetId)?.footprint;

  /** Fetch and build a model (once). */
  load(assetId: string): Promise<PropModel | null> {
    const done = this.models.get(assetId);
    if (done !== undefined) return Promise.resolve(done);
    let p = this.pending.get(assetId);
    if (!p) {
      p = loadAsset(assetId).then((asset) => {
        const model = asset ? { name: asset.name, ...bake(asset.build(this.kit), this.mats) } : null;
        this.models.set(assetId, model);
        this.pending.delete(assetId);
        this.onLoaded?.(assetId);
        return model;
      });
      this.pending.set(assetId, p);
    }
    return p;
  }
}

/** Kit detail for props (see `Kit`). */
const PROP_DETAIL = 0.5;

const box = new Box3();

/** Part of a showcase underlay (see `Asset.build`), or inside one. */
function isUnderlay(o: Object3D): boolean {
  for (let p: Object3D | null = o; p; p = p.parent) if (p.userData.underlay) return true;
  return false;
}

/** Merge a built model's meshes by material (transforms applied), and measure it. */
export function bake(root: Object3D, mats: Materials): Omit<PropModel, "name"> {
  root.updateMatrixWorld(true);
  const b = new Batcher(mats.paint);
  root.traverse((o) => {
    const mesh = o as Mesh;
    if (!mesh.isMesh || !mesh.visible || isUnderlay(mesh)) return;
    const material = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
    b.add(material, mesh.geometry.clone().applyMatrix4(mesh.matrixWorld));
  });
  const parts = [...b.merged()].map(([material, geometry]) => {
    // Every part in a material is drawn from one batch, which needs the same attributes throughout.
    if (!geometry.getAttribute("uv")) geometry.setAttribute("uv", new BufferAttribute(new Float32Array(geometry.getAttribute("position").count * 2), 2));
    return { material, geometry };
  });
  box.makeEmpty();
  for (const p of parts) {
    p.geometry.computeBoundingBox();
    box.union(p.geometry.boundingBox!);
  }
  const footprint: Footprint = box.isEmpty()
    ? { cx: 0, cz: 0, hw: 4, hd: 4 }
    : { cx: (box.min.x + box.max.x) / 2, cz: (box.min.z + box.max.z) / 2, hw: Math.max(2, (box.max.x - box.min.x) / 2), hd: Math.max(2, (box.max.z - box.min.z) / 2) };
  return { parts, footprint, height: box.isEmpty() ? 0 : box.max.y };
}

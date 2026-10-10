import { Group, Mesh, type BufferGeometry, type Material } from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

/** Collects geometries per material, then merges each bucket into one mesh (few draw calls, static scenery). */
export class Batcher {
  private buckets = new Map<Material, BufferGeometry[]>();

  add(material: Material, geometry: BufferGeometry): void {
    let list = this.buckets.get(material);
    if (!list) this.buckets.set(material, (list = []));
    const g = geometry.index ? geometry.toNonIndexed() : geometry;
    for (const name of Object.keys(g.attributes)) if (!["position", "normal", "uv"].includes(name)) g.deleteAttribute(name);
    list.push(g);
  }

  build(group: Group, castShadow = true): void {
    for (const [material, list] of this.buckets) {
      const merged = mergeGeometries(list);
      if (!merged) continue;
      const mesh = new Mesh(merged, material);
      mesh.castShadow = castShadow;
      mesh.receiveShadow = true;
      group.add(mesh);
      for (const g of list) g.dispose();
    }
    this.buckets.clear();
  }
}

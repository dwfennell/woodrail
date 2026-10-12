import { BufferAttribute, Color, Group, Mesh, type BufferGeometry, type Material } from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

/**
 * Collects geometries per material, then merges each bucket into one mesh (few draw calls, static scenery).
 * Lacquer of any colour goes into a single `paint` bucket, its colour baked into vertex colours.
 */
export class Batcher {
  private buckets = new Map<Material, BufferGeometry[]>();
  private readonly color = new Color();

  constructor(private readonly paint: Material | null = null) {}

  add(material: Material, geometry: BufferGeometry): void {
    const paintColor = this.paint ? (material.userData.paintColor as string | undefined) : undefined;
    const bucket = paintColor ? this.paint! : material;
    let list = this.buckets.get(bucket);
    if (!list) this.buckets.set(bucket, (list = []));
    const g = geometry.index ? geometry.toNonIndexed() : geometry;
    for (const name of Object.keys(g.attributes)) if (!["position", "normal", "uv"].includes(name)) g.deleteAttribute(name);
    if (paintColor) {
      const c = this.color.set(paintColor);
      const n = g.getAttribute("position").count;
      const colors = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) colors.set([c.r, c.g, c.b], i * 3);
      g.setAttribute("color", new BufferAttribute(colors, 3));
    }
    list.push(g);
  }

  /** Each material's geometry merged into one (the collected pieces are freed); for merging again later. */
  merged(): Map<Material, BufferGeometry> {
    const out = new Map<Material, BufferGeometry>();
    for (const [material, list] of this.buckets) {
      const merged = mergeGeometries(list);
      for (const g of list) g.dispose();
      if (merged) out.set(material, merged);
    }
    this.buckets.clear();
    return out;
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

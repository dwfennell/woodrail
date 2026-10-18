import { BufferAttribute, BufferGeometry, Color, Group, Mesh, type Material } from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { shadowProxyMesh } from "./blocks";
import { nonIndexed } from "../non-indexed";

/** Parts smaller than this every way (mm) cast no shadow of their own: window frames, sills, signs' letters. */
const STAND_IN_MIN = 8;

/**
 * A part's shadow stand-in (world space, as the part is): its box from the bottom up, narrowing at the top to where
 * its top fifth reaches (a roof's gable to its ridge, a cone to near a point). Twelve triangles; null for a small part.
 */
export function partStandIn(g: BufferGeometry): BufferGeometry | null {
  const pos = g.getAttribute("position");
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
    if (z < z0) z0 = z;
    if (z > z1) z1 = z;
  }
  if (Math.max(x1 - x0, y1 - y0, z1 - z0) < STAND_IN_MIN) return null;
  // The top fifth's reach.
  const cut = y1 - (y1 - y0) / 5;
  let tx0 = Infinity, tx1 = -Infinity, tz0 = Infinity, tz1 = -Infinity;
  for (let i = 0; i < pos.count; i++) {
    if (pos.getY(i) < cut) continue;
    const x = pos.getX(i), z = pos.getZ(i);
    if (x < tx0) tx0 = x;
    if (x > tx1) tx1 = x;
    if (z < tz0) tz0 = z;
    if (z > tz1) tz1 = z;
  }
  // prettier-ignore
  const v = new Float32Array([
    x0, y0, z0, x1, y0, z0, x1, y0, z1, x0, y0, z1,
    tx0, y1, tz0, tx1, y1, tz0, tx1, y1, tz1, tx0, y1, tz1,
  ]);
  const out = new BufferGeometry();
  out.setAttribute("position", new BufferAttribute(v, 3));
  // Bottom, top, then the four sides (outward, counter-clockwise).
  out.setIndex([0, 1, 2, 0, 2, 3, 4, 7, 6, 4, 6, 5, 0, 4, 5, 0, 5, 1, 1, 5, 6, 1, 6, 2, 2, 6, 7, 2, 7, 3, 3, 7, 4, 3, 4, 0]);
  return out;
}

/**
 * Collects geometries per material, then merges each bucket into one mesh (few draw calls, static scenery).
 * Lacquer of any colour goes into a single `paint` bucket, its colour baked into vertex colours.
 */
export class Batcher {
  private buckets = new Map<Material, BufferGeometry[]>();
  private readonly color = new Color();
  /** With `standIns`: each part's shadow stand-in (see `partStandIn`), cast in its place. */
  private standIns: BufferGeometry[] = [];

  /**
   * `standIns`: the merged meshes cast no shadow; a stand-in for each part does, a box or a tapered one, all of them
   * merged into one mesh on the shadow-only layer (a town's thousands of triangles a house cast as a dozen).
   */
  constructor(
    private readonly paint: Material | null = null,
    private readonly withStandIns = false,
  ) {}

  add(material: Material, geometry: BufferGeometry): void {
    const paintColor = this.paint ? (material.userData.paintColor as string | undefined) : undefined;
    const bucket = paintColor ? this.paint! : material;
    let list = this.buckets.get(bucket);
    if (!list) this.buckets.set(bucket, (list = []));
    const g = nonIndexed(geometry);
    if (this.withStandIns) {
      const stand = partStandIn(g);
      if (stand) this.standIns.push(stand);
    }
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

  /**
   * Vertices collected so far, per material bucket (as `build` will key its meshes). Marked between additions, they
   * let a `drawRange` show only what came before the mark (see the waiting passengers on a platform).
   */
  vertexCounts(): Map<Material, number> {
    const out = new Map<Material, number>();
    for (const [material, list] of this.buckets) out.set(material, list.reduce((n, g) => n + g.getAttribute("position").count, 0));
    return out;
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
    const standIns = castShadow && this.withStandIns && this.standIns.length > 0;
    for (const [material, list] of this.buckets) {
      const merged = mergeGeometries(list);
      if (!merged) continue;
      const mesh = new Mesh(merged, material);
      mesh.castShadow = castShadow && !standIns;
      mesh.receiveShadow = true;
      group.add(mesh);
      for (const g of list) g.dispose();
    }
    this.buckets.clear();
    if (standIns) {
      const merged = mergeGeometries(this.standIns);
      if (merged) group.add(shadowProxyMesh(merged));
    }
    for (const g of this.standIns) g.dispose();
    this.standIns = [];
  }
}

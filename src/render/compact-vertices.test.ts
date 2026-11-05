import { BufferAttribute, SphereGeometry } from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { describe, expect, it } from "vitest";
import { compactVertices, floatVertices } from "./compact-vertices";
import { Batcher } from "./dressing/batcher";
import { MeshBasicMaterial } from "three";

function painted() {
  const g = new SphereGeometry(10, 8, 6).toNonIndexed();
  const n = g.getAttribute("position").count;
  const c = new Float32Array(n * 3);
  for (let i = 0; i < c.length; i++) c[i] = [0.0052, 0.5, 1][i % 3];
  g.setAttribute("color", new BufferAttribute(c, 3));
  return g;
}

describe("compactVertices", () => {
  it("keeps normals within half a degree and colours within 16 bits, in fewer bytes", () => {
    const g = painted();
    const n0 = (g.getAttribute("normal").array as Float32Array).slice();
    const c0 = (g.getAttribute("color").array as Float32Array).slice();
    compactVertices(g);
    const n = g.getAttribute("normal");
    const c = g.getAttribute("color");
    expect(n.array).toBeInstanceOf(Int8Array);
    expect(c.array).toBeInstanceOf(Uint16Array);
    for (let i = 0; i < n.count; i++) {
      const dot = n.getX(i) * n0[i * 3] + n.getY(i) * n0[i * 3 + 1] + n.getZ(i) * n0[i * 3 + 2];
      expect(Math.acos(Math.min(1, dot / Math.hypot(n.getX(i), n.getY(i), n.getZ(i))))).toBeLessThan((0.6 * Math.PI) / 180);
      for (let k = 0; k < 3; k++) expect(Math.abs(c.getComponent(i, k) - c0[i * 3 + k])).toBeLessThan(1e-5);
    }
  });

  it("merges with plain geometry once floats again (as the Batcher does)", () => {
    const compact = compactVertices(painted());
    expect(mergeGeometries([floatVertices(compact.clone()), painted()])).not.toBeNull();
    const paint = new MeshBasicMaterial();
    const b = new Batcher(paint);
    b.add(paint, compact.clone());
    b.add(paint, painted());
    const merged = b.merged().get(paint)!;
    expect(merged.getAttribute("normal").array).toBeInstanceOf(Float32Array);
    expect(merged.getAttribute("position").count).toBe(2 * compact.getAttribute("position").count);
  });
});

import { Box3 } from "three";
import { describe, expect, it } from "vitest";
import { chamferedBox } from "./chamfer";

describe("chamferedBox", () => {
  const g = chamferedBox(60, 64, 60, 2.5);

  it("is a box with bevelled edges and corners in 44 triangles", () => {
    expect(g.getAttribute("position").count / 3).toBe(44);
    const box = new Box3().setFromBufferAttribute(g.getAttribute("position") as never);
    expect(box.min.toArray()).toEqual([-30, -32, -30]);
    expect(box.max.toArray()).toEqual([30, 32, 30]);
  });

  it("maps each face's texture across 0..1 like a plain box", () => {
    const uv = g.getAttribute("uv");
    for (let i = 0; i < uv.count; i++) {
      expect(uv.getX(i)).toBeGreaterThanOrEqual(0);
      expect(uv.getX(i)).toBeLessThanOrEqual(1);
      expect(uv.getY(i)).toBeGreaterThanOrEqual(0);
      expect(uv.getY(i)).toBeLessThanOrEqual(1);
    }
  });

  it("faces outward", () => {
    const pos = g.getAttribute("position");
    const nrm = g.getAttribute("normal");
    for (let i = 0; i < pos.count; i++) {
      const dot = pos.getX(i) * nrm.getX(i) + pos.getY(i) * nrm.getY(i) + pos.getZ(i) * nrm.getZ(i);
      expect(dot).toBeGreaterThan(0);
    }
  });
});

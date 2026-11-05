import { describe, expect, it } from "vitest";
import { BoxGeometry, Mesh, MeshBasicMaterial, Raycaster, Vector3 } from "three";
import { CELL, CORNER_RADIUS, CORNERS, insideBlock } from "../../landscape";
import { RISER_HEIGHT } from "../../track";
import { roundedChamferedBox } from "./chamfer";
import { withoutUnderside } from "./blocks";

const GAP = 0.8;

describe("rounded hill blocks as drawn", () => {
  it("are solid from above exactly where the hill model says (bar the gap and bevels)", () => {
    for (const corners of [0, 1, 6, 9, 15]) {
      const g = roundedChamferedBox(CELL - GAP, RISER_HEIGHT - GAP, CELL - GAP, 2.5, corners, CORNER_RADIUS - GAP / 2);
      const mesh = new Mesh(g, new MeshBasicMaterial());
      const ray = new Raycaster();
      for (let x = -34; x <= 34; x += 2) {
        for (let z = -34; z <= 34; z += 2) {
          // Distance from the model's edge: skip a margin for the gap, the bevel and the arc's facets.
          let margin = Math.min(CELL / 2 - Math.abs(x), CELL / 2 - Math.abs(z));
          for (const { sx, sz, bit } of CORNERS) {
            if (!(corners & bit)) continue;
            const d = Math.hypot(x - sx * (CELL / 2 - CORNER_RADIUS), z - sz * (CELL / 2 - CORNER_RADIUS));
            if ((x - sx * (CELL / 2 - CORNER_RADIUS)) * sx > 0 && (z - sz * (CELL / 2 - CORNER_RADIUS)) * sz > 0) margin = Math.min(margin, Math.abs(CORNER_RADIUS - d));
          }
          if (margin < 4) continue;
          ray.set(new Vector3(x, 100, z), new Vector3(0, -1, 0));
          const hit = ray.intersectObject(mesh).length > 0;
          expect(hit, `corners ${corners} @ ${x},${z}`).toBe(insideBlock(corners, x, z));
        }
      }
    }
  });
});

describe("block shapes drawn without their undersides", () => {
  const ray = new Raycaster();
  const hits = (g: ReturnType<typeof withoutUnderside>, from: Vector3, dir: Vector3) => {
    ray.set(from, dir);
    return ray.intersectObject(new Mesh(g, new MeshBasicMaterial())).length;
  };
  it("a box loses its bottom's two triangles and nothing else", () => {
    const g = withoutUnderside(new BoxGeometry(10, 4, 10));
    expect(g.getAttribute("position").count).toBe(30);
    // Seen from above and the side as before (single-sided: one face each way).
    expect(hits(g, new Vector3(1.3, 10, 2.7), new Vector3(0, -1, 0))).toBe(1);
    expect(hits(g, new Vector3(20, 0.7, 1.9), new Vector3(-1, 0, 0))).toBe(1);
  });
  it("a rounded block loses its flat bottom only: its bevels and rounded corners stay", () => {
    for (const corners of [0, 1, 6, 15]) {
      const whole = roundedChamferedBox(CELL - GAP, RISER_HEIGHT - GAP, CELL - GAP, 2.5, corners, CORNER_RADIUS - GAP / 2);
      const n = whole.getAttribute("position").count;
      const g = withoutUnderside(whole.clone());
      const left = g.getAttribute("position").count;
      expect(left).toBeLessThan(n);
      // Only triangles facing straight down went.
      const pos = whole.getAttribute("position");
      let down = 0;
      for (let t = 0; t < n; t += 3) {
        const a = new Vector3().fromBufferAttribute(pos, t);
        const e1 = new Vector3().fromBufferAttribute(pos, t + 1).sub(a);
        const e2 = new Vector3().fromBufferAttribute(pos, t + 2).sub(a);
        const nrm = e1.cross(e2).normalize();
        if (nrm.y < -0.9998) down++;
      }
      expect(down).toBeGreaterThan(0);
      expect((n - left) / 3).toBe(down);
      expect(hits(g, new Vector3(3.1, 100, 7.3), new Vector3(0, -1, 0))).toBe(1);
    }
  });
});

import { describe, expect, it } from "vitest";
import { Mesh, MeshBasicMaterial, Raycaster, Vector3 } from "three";
import { CELL, CORNER_RADIUS, CORNERS, insideBlock } from "../../landscape";
import { RISER_HEIGHT } from "../../track";
import { roundedChamferedBox } from "./chamfer";

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

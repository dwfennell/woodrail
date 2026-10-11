import { ShaderChunk } from "three";
import { describe, expect, it } from "vitest";
import { MAT_DEPTH, MAT_WIDTH } from "../landscape";
import { cutawayAt, HAZE_FAR, HAZE_NEAR, hazeAt, installHaze } from "./haze";

describe("haze", () => {
  it("measures fog from the mat's edge, not from the camera", () => {
    installHaze();
    const chunk = ShaderChunk.fog_fragment;
    expect(chunk).toContain(`${MAT_WIDTH / 2}.0`);
    expect(chunk).toContain(`${MAT_DEPTH / 2}.0`);
    // Measured per pixel from the interpolated plan position, not per vertex.
    expect(ShaderChunk.fog_vertex).toContain("vHaze");
    expect(ShaderChunk.fog_vertex).not.toContain("hazeOut");
  });

  it("installs once", () => {
    installHaze();
    const once = ShaderChunk.fog_fragment;
    installHaze();
    expect(ShaderChunk.fog_fragment).toBe(once);
  });

  it("leaves the mat clear even from the farthest camera and hides the ring's outer edge", () => {
    expect(HAZE_NEAR).toBeLessThan(HAZE_FAR);
    expect(hazeAt(MAT_WIDTH / 2, MAT_DEPTH / 2, 14000)).toBe(0);
    expect(hazeAt(MAT_WIDTH / 2 + 3000, 0, 1000)).toBe(1);
    const mid = hazeAt(MAT_WIDTH / 2 + 1500, 0, 3000);
    expect(mid).toBeGreaterThan(0.2);
    expect(mid).toBeLessThan(0.9);
  });

  describe("cutaway", () => {
    // Camera out beyond the +x edge of the mat, looking back at a point 600 mm inside it.
    const edge = MAT_WIDTH / 2;
    const camera = { x: edge + 1200, z: 0 };
    const target = { x: edge - 600, z: 0 };
    const targetPlan = Math.hypot(target.x - camera.x, target.z - camera.z);

    it("cuts away a scenery hill between the camera and the mat", () => {
      expect(cutawayAt({ x: edge + 300, y: 400, z: 0 }, camera, targetPlan)).toBe(1);
    });

    it("never cuts the mat, the felt ground, or scenery beyond the target", () => {
      expect(cutawayAt({ x: edge - 100, y: 40, z: 0 }, camera, targetPlan)).toBe(0);
      expect(cutawayAt({ x: edge + 300, y: 1, z: 0 }, camera, targetPlan)).toBe(0);
      expect(cutawayAt({ x: -edge - 300, y: 400, z: 0 }, camera, targetPlan)).toBe(0);
    });

    it("keeps tall scenery when looking straight down from above the mat", () => {
      // From overhead the target is (almost) under the camera: nothing outside the mat is nearer in plan.
      const over = { x: edge - 400, z: 0 };
      expect(cutawayAt({ x: edge + 200, y: 900, z: 0 }, over, 5)).toBe(0);
    });

    it("the shader reads the same thresholds", () => {
      installHaze();
      expect(ShaderChunk.fog_fragment).toContain("discard");
      expect(ShaderChunk.fog_fragment).toContain("smoothstep(0.80, 0.95");
    });
  });
});

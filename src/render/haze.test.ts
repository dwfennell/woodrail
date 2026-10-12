import { Fog, ShaderChunk } from "three";
import { describe, expect, it } from "vitest";
import { PLOT_DEPTH, PLOT_WIDTH } from "../landscape";
import { beyondAround, cutawayAt, HAZE_FAR, HAZE_NEAR, hazeAt, hazeFog, installHaze, setHazeLand } from "./haze";

const MAT_WIDTH = 2 * PLOT_WIDTH;
const MAT_DEPTH = 2 * PLOT_DEPTH;
/** The start region, as the land. */
const MAT = { x0: -PLOT_WIDTH, z0: -PLOT_DEPTH, x1: PLOT_WIDTH, z1: PLOT_DEPTH };

describe("haze", () => {
  it("measures fog from the land's edge, which it reads from the fog's uniforms, not from the camera", () => {
    installHaze();
    const chunk = ShaderChunk.fog_fragment;
    expect(chunk).toContain("vec2(fogNear, fogColor.r)");
    expect(chunk).toContain("vec2(fogFar, fogColor.g)");
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
    expect(hazeAt(MAT_WIDTH / 2, MAT_DEPTH / 2, 14000, MAT)).toBe(0);
    expect(hazeAt(MAT_WIDTH / 2 + 3000, 0, 1000, MAT)).toBe(1);
    const mid = hazeAt(MAT_WIDTH / 2 + 1500, 0, 3000, MAT);
    expect(mid).toBeGreaterThan(0.2);
    expect(mid).toBeLessThan(0.9);
  });

  it("carries the land's rectangle in the fog, and moves it when the land grows", () => {
    const fog = hazeFog(MAT);
    expect(fog).toBeInstanceOf(Fog);
    expect([fog.near, fog.far, fog.color.r, fog.color.g]).toEqual([MAT.x0, MAT.x1, MAT.z0, MAT.z1]);
    setHazeLand(fog, { x0: -5000, z0: -10, x1: 7, z1: 9000 });
    expect([fog.near, fog.far, fog.color.r, fog.color.g]).toEqual([-5000, 7, -10, 9000]);
  });

  describe("cutaway", () => {
    // Camera out beyond the +x edge of the land around (a plot past the land's), looking back at a point 600 mm
    // inside it.
    const edge = MAT_WIDTH / 2 + PLOT_WIDTH;
    const camera = { x: edge + 1200, z: 0 };
    const target = { x: edge - 600, z: 0 };
    const targetPlan = Math.hypot(target.x - camera.x, target.z - camera.z);

    it("cuts away a scenery hill between the camera and the mat", () => {
      expect(cutawayAt({ x: edge + 300, y: 400, z: 0 }, camera, targetPlan, MAT)).toBe(1);
    });

    it("never cuts the mat, the felt ground, or scenery beyond the target", () => {
      expect(cutawayAt({ x: edge - 100, y: 40, z: 0 }, camera, targetPlan, MAT)).toBe(0);
      expect(cutawayAt({ x: edge + 300, y: 1, z: 0 }, camera, targetPlan, MAT)).toBe(0);
      // …but the foot of a block's side (not facing up) does go, so no outline of the blocks is left behind.
      expect(cutawayAt({ x: edge + 300, y: 1, z: 0 }, camera, targetPlan, MAT, false)).toBe(1);
      expect(cutawayAt({ x: -edge - 300, y: 400, z: 0 }, camera, targetPlan, MAT)).toBe(0);
    });

    it("never cuts the land around: it's no taller than the land", () => {
      const land = MAT_WIDTH / 2;
      const near = { x: land + 1200, z: 0 };
      const look = Math.hypot(1800, 0);
      expect(cutawayAt({ x: land + 300, y: 150, z: 0 }, near, look, MAT)).toBe(0);
      expect(cutawayAt({ x: 0, y: 150, z: MAT_DEPTH / 2 + PLOT_DEPTH - 10 }, { x: 0, z: MAT_DEPTH / 2 + PLOT_DEPTH + 900 }, 1500, MAT)).toBe(0);
      expect(beyondAround(land + PLOT_WIDTH + 1, 0, MAT)).toBe(true);
      expect(beyondAround(land + PLOT_WIDTH - 1, 0, MAT)).toBe(false);
    });

    it("keeps tall scenery when looking straight down from above the mat", () => {
      // From overhead the target is (almost) under the camera: nothing outside the mat is nearer in plan.
      const over = { x: edge - 400, z: 0 };
      expect(cutawayAt({ x: edge + 200, y: 900, z: 0 }, over, 5, MAT)).toBe(0);
    });

    it("the shader reads the same thresholds", () => {
      installHaze();
      expect(ShaderChunk.fog_fragment).toContain("discard");
      expect(ShaderChunk.fog_fragment).toContain("smoothstep(0.80, 0.95");
    });
  });
});

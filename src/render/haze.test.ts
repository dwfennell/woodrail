import { ShaderChunk } from "three";
import { describe, expect, it } from "vitest";
import { MAT_DEPTH, MAT_WIDTH } from "../landscape";
import { HAZE_FAR, HAZE_NEAR, hazeAt, installHaze } from "./haze";

describe("haze", () => {
  it("measures fog from the mat's edge, not from the camera", () => {
    installHaze();
    const chunk = ShaderChunk.fog_vertex;
    expect(chunk).toContain(`${MAT_WIDTH / 2}.0`);
    expect(chunk).toContain(`${MAT_DEPTH / 2}.0`);
    expect(chunk).toContain("vFogDepth");
  });

  it("installs once", () => {
    installHaze();
    const once = ShaderChunk.fog_vertex;
    installHaze();
    expect(ShaderChunk.fog_vertex).toBe(once);
  });

  it("leaves the mat clear even from the farthest camera and hides the ring's outer edge", () => {
    expect(HAZE_NEAR).toBeLessThan(HAZE_FAR);
    expect(hazeAt(MAT_WIDTH / 2, MAT_DEPTH / 2, 12000)).toBe(0);
    expect(hazeAt(MAT_WIDTH / 2 + 3000, 0, 1000)).toBe(1);
    const mid = hazeAt(MAT_WIDTH / 2 + 1500, 0, 3000);
    expect(mid).toBeGreaterThan(0.2);
    expect(mid).toBeLessThan(0.9);
  });
});

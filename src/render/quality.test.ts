import { describe, expect, it } from "vitest";
import { LEAN_MEMORY_GB, leanOf, qualityFor, shouldBeLean } from "./quality";

describe("lean quality (phones short of memory)", () => {
  it("is for a phone with little memory, or whose drawing was lost lately", () => {
    expect(shouldBeLean(LEAN_MEMORY_GB, false)).toBe(true);
    expect(shouldBeLean(2, false)).toBe(true);
    expect(shouldBeLean(8, false)).toBe(false);
    // (Not every browser says: then only a lost drawing makes it lean.)
    expect(shouldBeLean(undefined, false)).toBe(false);
    expect(shouldBeLean(8, true)).toBe(true);
  });

  it("draws at a lower resolution, with a smaller shadow map and less multisampling", () => {
    const m = qualityFor("mobile");
    const lean = leanOf(m);
    expect(lean.lean).toBe(true);
    expect(lean.maxPixelRatio).toBe(1.5);
    expect(lean.shadowMapSize).toBe(1024);
    expect(lean.sceneSamples).toBe(2);
    expect(lean.tier).toBe("mobile");
    expect(m.lean).toBe(false);
  });

  it("leaves the tiers' own look alone", () => {
    expect(qualityFor("high")).toMatchObject({ shadowMapSize: 4096, maxPixelRatio: 2, sceneSamples: 4, lean: false });
    expect(qualityFor("mobile")).toMatchObject({ shadowMapSize: 2048, maxPixelRatio: 2, sceneSamples: 4, lean: false });
  });
});

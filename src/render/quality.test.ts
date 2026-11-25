import { describe, expect, it } from "vitest";
import { isIPad, LEAN_MEMORY_GB, leanFor, leanOf, leanestOf, qualityFor, shouldBeLean } from "./quality";

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

describe("leanest quality (lost even while lean)", () => {
  it("draws at the screen's own pixels, with a 512 shadow map and no multisampling", () => {
    const q = leanestOf(qualityFor("mobile"));
    expect(q).toMatchObject({ tier: "mobile", lean: true, leanest: true, maxPixelRatio: 1, minPixelRatio: 1, shadowMapSize: 512, sceneSamples: 0 });
    expect(leanOf(qualityFor("mobile")).leanest).toBe(false);
  });

  it("follows a loss while lean; a loss while not lean is lean", () => {
    const m = qualityFor("mobile");
    expect(leanFor(m, 8, "lost-lean", false).leanest).toBe(true);
    expect(leanFor(m, 8, "lost", false)).toMatchObject({ lean: true, leanest: false });
    expect(leanFor(m, 8, "no", false).lean).toBe(false);
  });
});

describe("iPads", () => {
  const ipadSafari = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.14 Safari/605.1.15";
  it("are known by touch, though Safari says Mac", () => {
    expect(isIPad(ipadSafari, 5)).toBe(true);
    expect(isIPad(ipadSafari, 0)).toBe(false); // a real Mac
    expect(isIPad("Mozilla/5.0 (iPad; CPU OS 12_5 like Mac OS X)", 5)).toBe(true);
    expect(isIPad("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)", 5)).toBe(false);
  });

  it("start lean", () => {
    expect(leanFor(qualityFor("mobile"), undefined, "no", true)).toMatchObject({ lean: true, leanest: false });
  });
});

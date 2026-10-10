import { describe, expect, it } from "vitest";
import { shadowRadiusFor, shouldRefit } from "./shadow-fit";

describe("shadowRadiusFor", () => {
  it("clamps between close-up and whole-mat sizes", () => {
    expect(shadowRadiusFor(100)).toBe(500);
    expect(shadowRadiusFor(1e6)).toBe(2200);
  });

  it("grows with camera distance", () => {
    let last = 0;
    for (let d = 100; d < 5000; d += 100) {
      const r = shadowRadiusFor(d);
      expect(r).toBeGreaterThanOrEqual(last);
      last = r;
    }
  });
});

describe("shouldRefit", () => {
  const fit = { x: 0, z: 0, radius: 1000 };
  it("ignores small moves", () => expect(shouldRefit(fit, 30, 0, 1020)).toBe(false));
  it("refits after a pan of a tenth of the radius", () => expect(shouldRefit(fit, 120, 0, 1000)).toBe(true));
  it("refits after a zoom of 10%", () => expect(shouldRefit(fit, 0, 0, 1120)).toBe(true));
});

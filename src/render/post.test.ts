import { describe, expect, it } from "vitest";
import { aoFor, AO_FADE_END, AO_FADE_START, apertureFor } from "./post";

describe("apertureFor", () => {
  it("keeps the close-up miniature blur", () => {
    expect(apertureFor(800)).toBe(apertureFor(1500));
  });

  it("narrows as the camera pulls back so the depth spread of a wide view isn't all blurred", () => {
    // Blur = depth offset × aperture: a point a fifth of the focus distance off focus blurs the same at any zoom.
    expect(apertureFor(13000) * 13000 * 0.2).toBeCloseTo(apertureFor(1500) * 1500 * 0.2, 9);
  });
});

describe("aoFor", () => {
  it("is full up close and off from far out, fading between", () => {
    expect(aoFor(800)).toBe(1);
    expect(aoFor(AO_FADE_START)).toBe(1);
    const mid = aoFor((AO_FADE_START + AO_FADE_END) / 2);
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(1);
    expect(aoFor(AO_FADE_END)).toBe(0);
    expect(aoFor(14000)).toBe(0);
  });
});

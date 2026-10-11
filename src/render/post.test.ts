import { describe, expect, it } from "vitest";
import { apertureFor } from "./post";

describe("apertureFor", () => {
  it("keeps the close-up miniature blur", () => {
    expect(apertureFor(800)).toBe(apertureFor(1500));
  });

  it("narrows as the camera pulls back so the depth spread of a wide view isn't all blurred", () => {
    // Blur = depth offset × aperture: a point a fifth of the focus distance off focus blurs the same at any zoom.
    expect(apertureFor(13000) * 13000 * 0.2).toBeCloseTo(apertureFor(1500) * 1500 * 0.2, 9);
  });
});

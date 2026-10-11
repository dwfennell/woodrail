import { describe, expect, it } from "vitest";
import { shouldRefit } from "./shadow-fit";

describe("shouldRefit", () => {
  const fit = { x: 0, z: 0, radius: 1000 };
  it("ignores small moves", () => expect(shouldRefit(fit, 30, 0, 1020)).toBe(false));
  it("refits after a pan of a tenth of the radius", () => expect(shouldRefit(fit, 120, 0, 1000)).toBe(true));
  it("refits after a zoom of 10%", () => expect(shouldRefit(fit, 0, 0, 1120)).toBe(true));
});

import { PerspectiveCamera, Vector3 } from "three";
import { shadowRadiusForView } from "./shadow-fit";

describe("shadowRadiusForView", () => {
  const view = (distance: number, polar: number, aspect = 16 / 9) => {
    const cam = new PerspectiveCamera(30, aspect, 5, 40000);
    const target = new Vector3(0, 0, 0);
    cam.position.set(0, Math.cos(polar) * distance, Math.sin(polar) * distance);
    cam.lookAt(target);
    cam.updateMatrixWorld();
    return shadowRadiusForView(cam, target);
  };

  it("covers the whole visible ground in a low, close follow view", () => {
    // Follow view: distance 420 at polar 1.08 sees ground ~640 mm from the target.
    expect(view(420, 1.08)).toBeGreaterThanOrEqual(640);
  });

  it("stays tight looking straight down up close", () => {
    expect(view(400, 0.1)).toBeLessThan(700);
  });

  it("covers the whole mat when the view reaches the horizon", () => {
    expect(view(600, 1.42)).toBe(3200);
  });

  it("covers the whole bigger mat from the farthest view", () => {
    expect(view(12000, 0.6)).toBeGreaterThanOrEqual(Math.hypot(2240, 1664));
  });
});

import { describe, expect, it } from "vitest";
import { CameraSteps, stepAmounts, viewOf, type ViewState } from "./controls-tutorial";

const at = (v: Partial<ViewState> = {}): ViewState => ({ tx: 0, tz: 0, distance: 1000, azimuth: 0, polar: 0.8, ...v });

describe("the camera tutorial's steps", () => {
  it("a pan moves where it looks, and only that counts as moving", () => {
    expect(stepAmounts(at(), at({ tx: 300 })).move).toBeCloseTo(0.3);
    // Zooming toward the pointer moves where it looks too: that's a zoom, not a move.
    const z = stepAmounts(at(), at({ tx: 300, distance: 800 }));
    expect(z.move).toBe(0);
    expect(z.zoom).toBeCloseTo(Math.log(1000 / 800));
  });

  it("panning over a hill (the view's height following the ground a little) is still a move", () => {
    expect(stepAmounts(at(), at({ tx: 50, distance: 1003, polar: 0.802 })).move).toBeCloseTo(0.05);
  });

  it("a turn is measured the short way round", () => {
    expect(stepAmounts(at({ azimuth: 3.1 }), at({ azimuth: -3.1 })).turn).toBeCloseTo(2 * Math.PI - 6.2);
  });

  it("each step is done once its moves add up, in any order, the next one being the first not done", () => {
    const s = new CameraSteps();
    expect(s.next()).toBe("move");
    expect(s.feed(at(), at({ polar: 0.9 }))).toEqual([]);
    expect(s.feed(at({ polar: 0.9 }), at({ polar: 0.95 }))).toEqual(["tilt"]);
    expect(s.feed(at(), at({ tx: 250 }))).toEqual([]);
    expect(s.feed(at({ tx: 250 }), at({ tx: 520 }))).toEqual(["move"]);
    expect(s.next()).toBe("zoom");
    expect(s.feed(at(), at({ distance: 700, azimuth: 0.6 }))).toEqual(["zoom", "turn"]);
    expect(s.next()).toBeNull();
  });

  it("reads a camera's view: how far, from which way", () => {
    const v = viewOf({ x: 0, y: 1000, z: 1000 }, { x: 0, y: 0, z: 0 });
    expect(v.distance).toBeCloseTo(Math.SQRT2 * 1000);
    expect(v.polar).toBeCloseTo(Math.PI / 4);
    expect(v.azimuth).toBeCloseTo(0);
  });
});

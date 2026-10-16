import { Scene } from "three";
import { afterEach, describe, expect, it, vi } from "vitest";
import { goalMarks } from "./goal-marks";

describe("goal marks", () => {
  afterEach(() => vi.restoreAllMocks());

  it("end on the clock, not after so many frames: a slow page's capped frame steps don't keep them (and frames) going", () => {
    let now = 1000;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    const scene = new Scene();
    const marks = goalMarks(scene, [{ x: 0, y: 0, z: 0 }])!;
    // Two frames a few seconds apart, each step capped at 0.1 s: still the rings end once their time is up.
    expect(marks.update(0.1)).toBe(true);
    now += 30_000;
    expect(marks.update(0.1)).toBe(false);
    marks.dispose();
    expect(scene.children).toHaveLength(0);
  });
});

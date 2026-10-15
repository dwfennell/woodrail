import { describe, expect, it } from "vitest";
import { ResolutionGovernor, SAMPLE_FRAMES } from "./resolution";

const run = (g: ResolutionGovernor, start: number, ms: number, frames: number) => {
  const changes: number[] = [];
  for (let i = 0; i < frames; i++) {
    const r = g.frameDrawn(start + i * ms, i > 0);
    if (r !== null) changes.push(r);
  }
  return changes;
};

describe("ResolutionGovernor", () => {
  it("starts at the device's density, within the limits", () => {
    expect(new ResolutionGovernor(3, 3, 1.5).current).toBe(3);
    expect(new ResolutionGovernor(2, 3, 1.5).current).toBe(2);
    expect(new ResolutionGovernor(1, 3, 1.5).current).toBe(1);
    expect(new ResolutionGovernor(3, 1.5, 1.5).current).toBe(1.5);
  });

  it("keeps full density while frames keep up", () => {
    const g = new ResolutionGovernor(3, 3, 1.5);
    expect(run(g, 0, 34, SAMPLE_FRAMES * 4)).toEqual([]);
    expect(g.current).toBe(3);
  });

  it("steps down while frames are slow, never below the minimum", () => {
    const g = new ResolutionGovernor(3, 3, 1.5);
    expect(run(g, 0, 60, SAMPLE_FRAMES * 5)).toEqual([2.25, 1.5]);
    expect(g.current).toBe(1.5);
  });

  it("steps down however slow the frames are", () => {
    const g = new ResolutionGovernor(3, 3, 1.5);
    expect(run(g, 0, 600, SAMPLE_FRAMES + 1)).toEqual([2.25]);
  });

  it("doesn't count pauses between bursts of drawing as slow frames", () => {
    const g = new ResolutionGovernor(3, 3, 1.5);
    let t = 0;
    for (let burst = 0; burst < 20; burst++) {
      expect(run(g, t, 34, 5)).toEqual([]);
      t += 5 * 34 + 2000;
    }
  });

  it("while resting (the map just built or shown), slow frames don't step it down; after, they do", () => {
    const g = new ResolutionGovernor(3, 3, 1.5);
    g.rest(SAMPLE_FRAMES * 5 * 60);
    expect(run(g, 0, 60, SAMPLE_FRAMES * 5)).toEqual([]);
    expect(g.current).toBe(3);
    expect(run(g, SAMPLE_FRAMES * 5 * 60, 60, SAMPLE_FRAMES + 2)).toEqual([2.25]);
  });
});

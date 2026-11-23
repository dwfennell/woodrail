import { describe, expect, it } from "vitest";
import { Layout } from "../track";
import { gridWithPlots } from "./grid";
import { TREE_CLEARANCE, TreeClearance } from "./trees-aside";

// A grand project's plot (spec 2026-11-22-grand-placement.md): trees keep off it as they do a yard.
describe("TreeClearance.setAreas", () => {
  const plot = { pose: { x: 0, z: 400, heading: 0 }, rects: [{ cx: 0, cz: 0, hw: 120, hd: 80 }] };
  const inside = (t: { x: number; z: number }) => Math.abs(t.x) < 120 + 4 && Math.abs(t.z - 400) < 80 + 4;

  it("steps trees off a plot, or takes them away when there's no room near, and back when it goes", () => {
    const trees = [
      { x: 110, z: 400, y: 0 },
      { x: 0, z: 400, y: 0 },
      { x: 400, z: 400, y: 0 },
    ];
    const c = new TreeClearance(gridWithPlots(-1, -1, 2, 2), trees);
    c.setLayout(new Layout());
    expect(c.spots()).toEqual(trees);
    c.setAreas([plot]);
    const out = c.spots();
    // By its edge: stepped out, clear of the fence.
    expect(out[0]).not.toBeNull();
    expect(inside(out[0]!)).toBe(false);
    expect(Math.abs(out[0]!.x)).toBeGreaterThanOrEqual(120 - TREE_CLEARANCE / 2);
    // In its middle, too far to step out: taken away (not standing inside the fence).
    expect(out[1] === null || !inside(out[1])).toBe(true);
    // Far off: where it grew.
    expect(out[2]).toEqual(trees[2]);
    c.setAreas([]);
    expect(c.spots()).toEqual(trees);
  });

  it("keeps the plots when the layout changes", () => {
    const c = new TreeClearance(gridWithPlots(-1, -1, 2, 2), [{ x: 110, z: 400, y: 0 }]);
    c.setAreas([plot]);
    c.setLayout(new Layout());
    expect(c.spots()[0] && inside(c.spots()[0]!)).toBeFalsy();
  });
});

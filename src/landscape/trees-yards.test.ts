import { describe, expect, it } from "vitest";
import { yardParts } from "../game/depot-footprint";
import { inFootprint } from "../props/placement";
import { Layout } from "../track";
import { gridWithPlots } from "./grid";
import { TreeClearance, treesAside, type TreeSpot } from "./trees-aside";

// QA 2026-11-04 (2): trees stood on a new harbour's yard and quay, because they stepped aside only for track.
describe("trees step aside for a depot's yard, not only its track", () => {
  const pose = { x: 200, z: 100, heading: 0.4 };
  const parts = yardParts("depot-harbour")!;
  /** Trees on a grid over the harbour's yard (its own frame, then placed). */
  const onYard = (): TreeSpot[] => {
    const out: TreeSpot[] = [];
    for (const r of parts)
      for (let i = -1; i <= 1; i++)
        for (let k = -1; k <= 1; k++) {
          const lx = r.cx + (i * r.hw) / 2;
          const lz = r.cz + (k * r.hd) / 2;
          out.push({ x: pose.x + lx * Math.cos(pose.heading) - lz * Math.sin(pose.heading), z: pose.z + lx * Math.sin(pose.heading) + lz * Math.cos(pose.heading), y: 0 });
        }
    return out;
  };
  const onAnyYard = (t: TreeSpot | null) => !!t && parts.some((r) => inFootprint(r, pose, t.x, t.z, 8));

  it("a placed harbour: none left standing on its yard or quay (and without the yards given, some would be)", () => {
    const layout = new Layout();
    layout.addPiece("depot-harbour", pose);
    const trees = onYard();
    const grid = gridWithPlots(-2, -2, 4, 4);
    expect(trees.filter((t) => onAnyYard(t)).length).toBeGreaterThan(5);
    expect(treesAside(grid, layout, trees).some(onAnyYard)).toBe(true);
    expect(treesAside(grid, layout, trees, undefined, yardParts).some(onAnyYard)).toBe(false);
  });

  it("a harbour held over them: they step aside for its yard too, and back when it's moved on", () => {
    const layout = new Layout();
    const trees = onYard();
    const c = new TreeClearance(gridWithPlots(-2, -2, 4, 4), trees, yardParts);
    c.setLayout(layout);
    expect(c.spots({ type: "depot-harbour", flipped: false, pose, y: 0 }).some(onAnyYard)).toBe(false);
    expect(c.spots()).toEqual(trees);
  });
});

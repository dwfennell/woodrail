import { describe, expect, it } from "vitest";
import { Layout } from "../track";
import { FEAT_BUILDING, LandscapeGrid, SURF_RIVER } from "./grid";
import { TREE_CLEARANCE, TreeClearance, treesAside } from "./trees-aside";

const P = (x: number, z: number, heading = 0) => ({ x, z, heading });
/** Distance (plan) from a point to the line z = 0 between x = 0 and x = 216: a straight laid along x. */
const offStraight = (t: { x: number; z: number }) => (t.x < 0 ? Math.hypot(t.x, t.z) : t.x > 216 ? Math.hypot(t.x - 216, t.z) : Math.abs(t.z));

describe("treesAside", () => {
  it("leaves trees where they grew while no track comes near", () => {
    const layout = new Layout();
    layout.addPiece("straight-216", P(0, 0));
    const trees = [{ x: 100, z: 200, y: 0 }];
    expect(treesAside(new LandscapeGrid(), layout, trees)).toEqual(trees);
  });

  it("steps a tree out from under track, away from it and clear of it", () => {
    const layout = new Layout();
    layout.addPiece("straight-216", P(0, 0));
    const [moved] = treesAside(new LandscapeGrid(), layout, [{ x: 100, z: 8, y: 0 }]);
    expect(moved).not.toBeNull();
    expect(offStraight(moved!)).toBeGreaterThanOrEqual(TREE_CLEARANCE);
    // Out the side it was nearer, not across the track.
    expect(moved!.z).toBeGreaterThan(0);
    expect(Math.hypot(moved!.x - 100, moved!.z - 8)).toBeLessThan(100);
  });

  it("keeps trees that step aside apart from each other", () => {
    const layout = new Layout();
    layout.addPiece("straight-216", P(0, 0));
    const out = treesAside(new LandscapeGrid(), layout, [{ x: 100, z: 5, y: 0 }, { x: 104, z: 6, y: 0 }]);
    expect(out[0]).not.toBeNull();
    expect(out[1]).not.toBeNull();
    expect(Math.hypot(out[0]!.x - out[1]!.x, out[0]!.z - out[1]!.z)).toBeGreaterThanOrEqual(34);
  });

  it("won't step into a river or a building, and with nowhere to go the tree is taken away", () => {
    const grid = new LandscapeGrid();
    // Everything around the track is river or buildings: no grass to stand on.
    for (let i = 0; i < grid.surface.length; i++) {
      grid.surface[i] = SURF_RIVER;
      grid.feature[i] = FEAT_BUILDING;
    }
    const layout = new Layout();
    layout.addPiece("straight-216", P(0, 0));
    expect(treesAside(grid, layout, [{ x: 100, z: 0, y: 0 }])).toEqual([null]);
  });

  it("brings trees back when the track is taken up", () => {
    const layout = new Layout();
    const id = layout.addPiece("straight-216", P(0, 0));
    const trees = [{ x: 100, z: 0, y: 0 }];
    expect(treesAside(new LandscapeGrid(), layout, trees)[0]).not.toEqual(trees[0]);
    layout.removePiece(id);
    expect(treesAside(new LandscapeGrid(), layout, trees)).toEqual(trees);
  });

  it("steps trees aside for a piece held over them, and back when it's moved on", () => {
    const layout = new Layout();
    const trees = [{ x: 100, z: 8, y: 0 }];
    const c = new TreeClearance(new LandscapeGrid(), trees);
    c.setLayout(layout);
    const [aside] = c.spots({ type: "straight-216", flipped: false, pose: P(0, 0) });
    expect(aside).not.toBeNull();
    expect(offStraight(aside!)).toBeGreaterThanOrEqual(TREE_CLEARANCE);
    expect(c.spots({ type: "straight-216", flipped: false, pose: P(0, 600) })).toEqual(trees);
    expect(c.spots()).toEqual(trees);
  });
});

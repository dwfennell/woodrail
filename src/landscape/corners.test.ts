import { describe, expect, it } from "vitest";
import { RISER_HEIGHT } from "../track";
import { blockCorners, CORNER_RADIUS, groundAt } from "./corners";
import { CELL, LandscapeGrid } from "./grid";

/** A grid with a 3 × 2 hill (one block high) at columns 10–12, rows 10–11, and a lone block on top of (11, 10). */
function hill(): LandscapeGrid {
  const g = new LandscapeGrid();
  for (let c = 10; c <= 12; c++) for (let r = 10; r <= 11; r++) g.height[g.index(c, r)] = 1;
  g.height[g.index(11, 10)] = 2;
  return g;
}

describe("rounded hill corners", () => {
  it("rounds the outer corners of a hill, and only those", () => {
    const g = hill();
    // (10, 10) is the hill's −x −z corner square: only that corner turns.
    expect(blockCorners(g, 10, 10, 0)).toBe(8);
    expect(blockCorners(g, 12, 11, 0)).toBe(1);
    // A middle edge square has no corner where the edge turns.
    expect(blockCorners(g, 11, 10, 0)).toBe(0);
    // The lone block on top has all four corners rounded.
    expect(blockCorners(g, 11, 10, 1)).toBe(15);
  });

  it("reports the felt where a corner is cut away, and the block top just inside", () => {
    const g = hill();
    const x0 = g.centreX(10) - CELL / 2;
    const z0 = g.centreZ(10) - CELL / 2;
    // The very corner point is off the block; a step in along the diagonal past the rounding is on it.
    expect(groundAt(g, x0 + 1, z0 + 1)).toBe(0);
    expect(groundAt(g, x0 + CORNER_RADIUS, z0 + CORNER_RADIUS)).toBe(RISER_HEIGHT);
    expect(groundAt(g, g.centreX(10), g.centreZ(10))).toBe(RISER_HEIGHT);
    // On the lone block's rounded corner: down to the hill below, not the felt.
    const x1 = g.centreX(11) - CELL / 2;
    const z1 = g.centreZ(10) - CELL / 2;
    expect(groundAt(g, x1 + 1, z1 + 1)).toBe(RISER_HEIGHT);
    expect(groundAt(g, g.centreX(11), g.centreZ(10))).toBe(2 * RISER_HEIGHT);
  });
});

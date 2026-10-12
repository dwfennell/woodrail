import { describe, expect, it } from "vitest";
import { RISER_HEIGHT } from "../track";
import { checkPlacement } from "./clearance";
import { rampCutting } from "./cuttings";
import { LandscapeGrid } from "./grid";
import type { Landscape } from "./generate";

const P = (x: number, z: number, heading = 0) => ({ x, z, heading });
/** Flat felt with a one-block hill from x = 144 eastward (squares are 72 mm; x = 0 is a square edge). */
function land(): Landscape {
  const grid = new LandscapeGrid();
  for (let x = 144 + 36; x < 1000; x += 72) for (let z = -300; z < 300; z += 72) {
    const i = grid.cellAtWorld(x, z);
    if (i !== -1) grid.height[i] = 1;
  }
  return { seed: 0, starter: false, grid, towns: [], corridors: [], fields: [], shed: null, depots: [] };
}
// z = 36 is a square's centre, well inside the hill's long straight edge.
const Z = 36;

describe("ramp cuttings", () => {
  it("lets a ramp run into a hill, cutting the blocks above its deck", () => {
    const l = land();
    // Starting on the felt at x = 0, rising onto the hill top 216 mm on: its upper third runs into the hill.
    expect(checkPlacement(l, "ramp", false, P(0, Z), 0)).toEqual({ kind: "clear" });
    const cut = rampCutting(l.grid, "ramp", false, P(0, Z), 0);
    expect(cut).not.toBeNull();
    expect(cut!.blocks.length).toBeGreaterThan(0);
    expect(cut!.blocks.every((b) => b.level === 0)).toBe(true);
  });

  it("cuts nothing when the ramp clears the hills", () => {
    const l = land();
    expect(rampCutting(l.grid, "ramp", false, P(-216, Z), 0)).toBeNull();
  });

  it("won't tunnel: a hill higher than the ramp's top end still blocks", () => {
    const l = land();
    for (let x = 144 + 36; x < 1000; x += 72) {
      const i = l.grid.cellAtWorld(x, Z);
      l.grid.height[i] = 2;
    }
    expect(checkPlacement(l, "ramp", false, P(0, Z), 0)).toEqual({ kind: "blocked", reason: "hill" });
    // Other track still can't dig in.
    expect(checkPlacement(land(), "straight-216", false, P(100, Z), 0)).toEqual({ kind: "blocked", reason: "hill" });
    void RISER_HEIGHT;
  });
});

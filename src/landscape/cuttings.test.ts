import { describe, expect, it } from "vitest";
import { Layout, RISER_HEIGHT } from "../track";
import { checkPlacement } from "./clearance";
import { cutUndermines, syncCuttings } from "./cuttings";
import type { Landscape } from "./generate";
import { gridWithPlots } from "./grid";
import { CUT_BANK_ANGLE, CUT_BED_HALF, hillsOf } from "./hill-shape";

const P = (x: number, z: number, heading = 0) => ({ x, z, heading });
/** Felt, with a one-block hill from x = 144 eastward over a band of rows (x = 0 is a square edge; squares are 72 mm). */
function land(height = 1): Landscape {
  const grid = gridWithPlots(-1, -1, 2, 2);
  for (let x = 144 + 36; x < 1200; x += 72) for (let z = -300; z < 300; z += 72) {
    const i = grid.cellAtWorld(x, z);
    if (i !== -1) grid.height[i] = height;
  }
  return { seed: 0, starter: false, grid, towns: [], corridors: [], fields: [], shed: null, depots: [], nextBuildingId: 0 };
}
const Z = 36; // a square's centre, inside the hill's long straight edge
/** A ramp from the felt at x = 0 rising onto the hill: its last third (from x = 144) runs into the hill. */
const RAMP = P(0, Z);

describe("ramp cuttings", () => {
  it("let a ramp run into a hill no higher than its top end, but not a higher one, and not other track", () => {
    expect(checkPlacement(land(), "ramp", false, RAMP, 0)).toEqual({ kind: "clear" });
    expect(checkPlacement(land(2), "ramp", false, RAMP, 0)).toEqual({ kind: "blocked", reason: "hill" });
    expect(checkPlacement(land(), "straight-216", false, P(100, Z), 0)).toEqual({ kind: "blocked", reason: "hill" });
  });

  it("cut the ground to the ramp's underside along its bed, with 60° banks beside it", () => {
    const l = land();
    const layout = new Layout();
    layout.addPiece("ramp", RAMP, 0);
    syncCuttings(l, layout);
    const hills = hillsOf(l.grid);
    // Just inside the hill (x = 150), the bed is at the ramp's underside there.
    const t = 150 / 216;
    const deck = RISER_HEIGHT * t * t * (3 - 2 * t);
    expect(hills.groundAt(150, Z)).toBeCloseTo(deck, 6);
    // Beside the bed, the bank rises at 60°; far enough out it's back to the hilltop.
    expect(hills.groundAt(150, Z + CUT_BED_HALF + 5)).toBeCloseTo(deck + 5 * Math.tan(CUT_BANK_ANGLE), 6);
    expect(hills.groundAt(150, Z + CUT_BED_HALF + 40)).toBe(RISER_HEIGHT);
    // Past the top end the hilltop is untouched (the ramp meets it flush); off the hill it's the felt.
    expect(hills.groundAt(216 + 30, Z)).toBe(RISER_HEIGHT);
    expect(hills.groundAt(60, Z)).toBe(0);
    // Taking the ramp up fills the cutting in again.
    syncCuttings(l, new Layout());
    expect(hills.groundAt(180, Z)).toBe(RISER_HEIGHT);
  });

  it("won't dig away the ground under track resting on the hill beside the cutting", () => {
    const l = land();
    const layout = new Layout();
    // A straight on the hilltop running alongside, its near edge 4 mm from where the ramp's bed would be: inside the
    // bank (a cutting a third of a level deep at the hill's edge reaches about 10 mm past its bed).
    const beside = layout.addPiece("straight-216", P(144, Z + CUT_BED_HALF + 4 + 20), RISER_HEIGHT);
    syncCuttings(l, layout);
    expect(cutUndermines(l, layout, "ramp", false, RAMP, 0, -1)).toBe(beside);
    // Further off, clear of the banks: fine. And track carrying on from the ramp's top end is untouched.
    const far = new Layout();
    far.addPiece("straight-216", P(144, Z + 200), RISER_HEIGHT);
    far.addPiece("straight-216", P(216, Z), RISER_HEIGHT);
    syncCuttings(l, far);
    expect(cutUndermines(l, far, "ramp", false, RAMP, 0, -1)).toBe(-1);
  });

  it("only plain ramps cut: not ones up on arches, and not other track", () => {
    const l = land();
    const layout = new Layout();
    // A ramp a level up on arches, over the felt beside the hill's west edge, rising to two levels.
    layout.addPiece("ramp", P(-216, Z), RISER_HEIGHT);
    layout.addPiece("straight-216", P(144, Z + 100), RISER_HEIGHT);
    syncCuttings(l, layout);
    expect(hillsOf(l.grid).groundAt(150, Z)).toBe(RISER_HEIGHT);
  });
});

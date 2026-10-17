import { describe, expect, it } from "vitest";
import { Layout, RAMP_LENGTH, RISER_HEIGHT } from "../track";
import { checkPlacement } from "./clearance";
import { cutUndermines, heldCut, syncCuttings } from "./cuttings";
import { bridgeLevels } from "./support";
import type { Landscape } from "./generate";
import { gridWithPlots } from "./grid";
import { CUT_BANK_ANGLE, CUT_BED_HALF, hillsOf } from "./hill-shape";

const P = (x: number, z: number, heading = 0) => ({ x, z, heading });
/** Where the hill starts: a square short of the ramp's top end, so the ramp's last square runs into it. */
const HILL = RAMP_LENGTH - 72;
/** Felt, with a one-block hill from x = HILL eastward over a band of rows (x = 0 is a square edge; squares are 72 mm). */
function land(height = 1): Landscape {
  const grid = gridWithPlots(-1, -1, 2, 2);
  for (let x = HILL + 36; x < 1200; x += 72) for (let z = -300; z < 300; z += 72) {
    const i = grid.cellAtWorld(x, z);
    if (i !== -1) grid.height[i] = height;
  }
  return { seed: 0, starter: false, grid, towns: [], corridors: [], fields: [], shed: null, depots: [], nextBuildingId: 0 };
}
const Z = 36; // a square's centre, inside the hill's long straight edge
/** A ramp from the felt at x = 0 rising onto the hill: its last square (from x = HILL) runs into the hill. */
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
    // Just inside the hill, the bed is at the ramp's underside there.
    const x = HILL + 6;
    const t = x / RAMP_LENGTH;
    const deck = RISER_HEIGHT * t * t * (3 - 2 * t);
    expect(hills.groundAt(x, Z)).toBeCloseTo(deck, 6);
    // Beside the bed, the bank rises at 60°; far enough out it's back to the hilltop.
    expect(hills.groundAt(x, Z + CUT_BED_HALF + 5)).toBeCloseTo(deck + 5 * Math.tan(CUT_BANK_ANGLE), 6);
    expect(hills.groundAt(x, Z + CUT_BED_HALF + 40)).toBe(RISER_HEIGHT);
    // Past the top end the hilltop is untouched (the ramp meets it flush); off the hill it's the felt.
    expect(hills.groundAt(RAMP_LENGTH + 30, Z)).toBe(RISER_HEIGHT);
    expect(hills.groundAt(HILL / 2, Z)).toBe(0);
    // Taking the ramp up fills the cutting in again.
    syncCuttings(l, new Layout());
    expect(hills.groundAt(HILL + 36, Z)).toBe(RISER_HEIGHT);
  });

  it("won't dig away the ground under track resting on the hill beside the cutting", () => {
    const l = land();
    const layout = new Layout();
    // A straight on the hilltop running alongside, its near edge 4 mm from where the ramp's bed would be: inside the
    // bank (a cutting at the hill's edge reaches past its bed).
    const beside = layout.addPiece("straight-216", P(HILL, Z + CUT_BED_HALF + 4 + 20), RISER_HEIGHT);
    syncCuttings(l, layout);
    expect(cutUndermines(l, layout, "ramp", false, RAMP, 0, -1)).toBe(beside);
    // Further off, clear of the banks: fine. And track carrying on from the ramp's top end is untouched.
    const far = new Layout();
    far.addPiece("straight-216", P(HILL, Z + 200), RISER_HEIGHT);
    far.addPiece("straight-216", P(RAMP_LENGTH, Z), RISER_HEIGHT);
    syncCuttings(l, far);
    expect(cutUndermines(l, far, "ramp", false, RAMP, 0, -1)).toBe(-1);
  });

  it("a ramp out on the felt beside a hill leaves the hill whole: its banks don't scoop the blocks beside it", () => {
    const l = land();
    const layout = new Layout();
    // Along the hill's north edge (its last row ends at z = 288), on the felt: the bed's edge 12 mm short of the hill.
    layout.addPiece("ramp", P(200, 288 + CUT_BED_HALF + 12), 0);
    syncCuttings(l, layout);
    const hills = hillsOf(l.grid);
    expect(hills.cutBlocks()).toEqual([]);
    expect(hills.groundAt(230, 284)).toBe(RISER_HEIGHT);
    // Run into the hill, the same ramp cuts its bed and banks as ever.
    const into = new Layout();
    into.addPiece("ramp", P(200, 288 - CUT_BED_HALF), 0);
    syncCuttings(l, into);
    expect(hills.cutBlocks().length).toBeGreaterThan(0);
  });

  it("a ramp up on arches whose top runs into a higher block cuts it, as placement let it (the hill not over the train)", () => {
    // Felt to x = HILL, then a hill two levels high: a ramp a level up on arches (its low end over the felt) rising to
    // two levels, its last square run into the higher hill. Placement lets it (up to its top end, a ramp cuts its way
    // in), so the hill must be cut back to its bed there, not left standing through the ramp and a train on it.
    const l = land(2);
    const pose = P(0, Z);
    expect(bridgeLevels(l, "ramp", false, pose, RISER_HEIGHT)).toBe(1);
    expect(checkPlacement(l, "ramp", false, pose, RISER_HEIGHT)).toEqual({ kind: "clear" });
    const layout = new Layout();
    layout.addPiece("ramp", pose, RISER_HEIGHT);
    syncCuttings(l, layout);
    const hills = hillsOf(l.grid);
    // Inside the hill, under the ramp: down to its bed (well under the hilltop), and a cut block to draw.
    expect(hills.groundAt(HILL + 6, Z)).toBeLessThan(2 * RISER_HEIGHT - 16);
    expect(hills.groundAt(HILL + 6, Z)).toBeGreaterThan(RISER_HEIGHT);
    expect(hills.cutBlocks().length).toBeGreaterThan(0);
    // The same while it's held there, before it's put down.
    syncCuttings(l, new Layout());
    const held = heldCut(l, { type: "ramp", flipped: false, pose, y: RISER_HEIGHT });
    expect(held).toBeDefined();
    expect(hills.groundWithCut(held!, HILL + 6, Z)).toBeLessThan(2 * RISER_HEIGHT - 16);
  });

  it("only ramps cut where let into the hill: not ones up on arches above it, and not other track", () => {
    const l = land();
    const layout = new Layout();
    // A ramp a level up on arches, over the felt beside the hill's west edge, rising to two levels.
    layout.addPiece("ramp", P(-RAMP_LENGTH, Z), RISER_HEIGHT);
    layout.addPiece("straight-216", P(HILL, Z + 100), RISER_HEIGHT);
    syncCuttings(l, layout);
    expect(hillsOf(l.grid).groundAt(HILL + 6, Z)).toBe(RISER_HEIGHT);
  });
});

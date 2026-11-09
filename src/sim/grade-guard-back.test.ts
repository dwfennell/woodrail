import { describe, expect, it } from "vitest";
import { GRADE_PIECES, sweep } from "./grade-guard-testing";
// The cases are in grade-guard-testing.ts: this file is direction 1 (each piece entered by its connector 1); the
// other direction is grade-guard.test.ts, so the two run in workers of their own.
describe("a loaded train gets over every grade-changing piece, entered the other way", { timeout: 120_000 }, () => {
  it("ramps, curved ramps and bridges, entered from straights, curves, up and down, pulling and pushing", () => {
    expect(GRADE_PIECES).toEqual(expect.arrayContaining(["ramp", "ramp-curve", "bridge", "bridge-curve"]));
    const r = sweep(1);
    console.log(`grade guard, direction 1: ${r.checked} runs over ${r.layouts} candidate layouts (${r.sims} sim runs)`);
    expect(r.failures).toEqual([]);
    expect(r.checked).toBeGreaterThan(500);
  });
});

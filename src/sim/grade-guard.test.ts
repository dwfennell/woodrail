import { describe, expect, it } from "vitest";
import { GRADE_PIECES, sweep, build, runTo, straight, type Step } from "./grade-guard-testing";
import type { PieceTypeId } from "../track";
// The cases are in grade-guard-testing.ts: this file is direction 0 (each piece entered by its connector 0); the
// other direction is grade-guard-back.test.ts, so the two run in workers of their own.
describe("a loaded train gets over every grade-changing piece", { timeout: 120_000 }, () => {
  it("ramps, curved ramps and bridges, entered from straights, curves and switches, up and down, pulling and pushing", () => {
    expect(GRADE_PIECES).toEqual(expect.arrayContaining(["ramp", "ramp-curve", "bridge", "bridge-curve"]));
    const r = sweep(0);
    console.log(`grade guard, direction 0: ${r.checked} runs over ${r.layouts} candidate layouts (${r.sims} sim runs)`);
    expect(r.failures).toEqual([]);
    expect(r.checked).toBeGreaterThan(500);
  });
});

describe("the reported scene: off a curve, up a ramp, onto a bridge", () => {
  it("an engine with three full timber wagons climbs on, whether the wagons are still on the curve or already on the ramp", () => {
    const up = (type: PieceTypeId): Step => ({ type, flipped: false, enter: 0, exit: 1 });
    const { layout, ids } = build([straight(0), straight(0), up("curve-large"), up("ramp"), up("bridge"), up("bridge"), straight(0), straight(0)])!;
    for (const from of [{ pieceId: ids[1], s: 200 }, { pieceId: ids[2], s: 60 }, { pieceId: ids[3], s: 40 }, { pieceId: ids[3], s: 90 }, { pieceId: ids[4], s: 20 }]) {
      expect(runTo(layout, { ...from, reversed: false }, ids[7], false, 40), `from piece ${ids.indexOf(from.pieceId)} at ${from.s}`).toBeLessThan(40);
    }
  });
});

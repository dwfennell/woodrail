import { describe, expect, it } from "vitest";
import { Layout } from "../track";
import { HarnessRun, INVARIANTS } from "./harness";
import { fuzz } from "./scenarios";

/**
 * Stalls the long fuzz (`npm run fuzz:long`) had that the game walked into (docs/agents/stalls-verify-2026-11-10.md),
 * each kept fixed by its seed.
 */
describe("the long fuzz's avoidable stalls, by seed", () => {
  // Seed 161: a routed train (B ⇄ A) and a hand-run one. The hand-run one runs into the siding, turns at its buffer and
  // comes back out; it became the line's only once its front was on the siding's points, and was held there, the routed
  // train's only way east: a stall at 32 s, 2 stops in 30 min. Now it asks for the way short of the points (`comesInto`)
  // and waits in the siding, the way the points lie as it'll run. (The report's patch looked every way through the
  // points: there the two met head on again at about 24.7 min, and stood for good. As they lie, none in 30 min.)
  it("161: a hand-run train coming out of a siding waits short of the points, and the routed train keeps delivering", () => {
    const seconds = 1800;
    const r = new HarnessRun(new Layout(), fuzz(161, seconds)).run(seconds);
    expect(INVARIANTS.filter((i) => r.broke[i].count > 0)).toEqual([]);
    expect(r.stalls.begun).toBe(0);
    const routed = r.arrivals.filter((_, k) => r.routed[k]);
    expect(routed.length).toBe(1);
    expect(routed[0]).toBeGreaterThan(80);
  }, 120_000);
});

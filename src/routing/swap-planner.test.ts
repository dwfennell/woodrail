import { describe, expect, it } from "vitest";
import { Layout } from "../track";
import { allCases, scenarioOf } from "./cases/cases";
import { oTrains } from "./cases/train-view";
import { HarnessRun } from "./harness";
import { nextFrom, planSwap, stateOf } from "./swap-planner";

/**
 * The swap planner on the routing cases it's for: each stalled as the game leaves it (60 s in), the plan's moves alone,
 * taken one at a time with the train waited longest served first, keep every train coming to its stops.
 */
const IDS = ["siding-spare 3×one same", "terminus-spare 3×one same", "terminus-spare 3×one opposed", "wye-spare 3×one same", "fuzz seed 19"];

describe("swap planner: from a stall, the plan's moves keep every train coming to its stops", () => {
  for (const id of IDS)
    it(id, () => {
      const c = allCases().find((x) => x.id === id)!;
      const layout = new Layout();
      const h = new HarnessRun(layout, scenarioOf(c).scenario);
      h.run(60);
      const trains = oTrains(h);
      const plan = planSwap(layout, trains);
      expect(plan, "a plan").not.toBeNull();
      let at = stateOf(plan!, trains.map((t) => ({ e: t.elems, fs: 0 })));
      expect(at).toBeGreaterThanOrEqual(0);
      // (Each train's stops in turn, from the one it's bound for now; who has waited longest goes first.)
      const stops = trains.map((t) => t.stops ?? []);
      const next = trains.map(() => 0);
      const since = trains.map(() => 0);
      const came = trains.map(() => 0);
      for (let step = 1; step <= 200; step++) {
        const targets = stops.map((s, k) => (s.length > 0 ? s[next[k] % s.length] : -1));
        const order = trains.map((_, k) => k).sort((a, b) => since[a] - since[b] || a - b);
        const m = nextFrom(plan!, at, targets, order);
        expect(m, `a move at step ${step}`).not.toBeNull();
        at = plan!.edges[at].find((s) => plan!.states[s][m!.k] === m!.to) ?? -1;
        expect(at).toBeGreaterThanOrEqual(0);
        for (let k = 0; k < trains.length; k++) {
          if (targets[k] >= 0 && plan!.states[at][k].e.some((x) => x.p === targets[k])) {
            came[k]++;
            next[k]++;
            since[k] = step;
          }
        }
      }
      expect(Math.min(...came), `stops: ${came.join("/")}`).toBeGreaterThanOrEqual(3);
    }, 60_000);
});

describe("swap planner: a plan whose trains change goes", () => {
  it("one train left on the line (the others taken off) goes to its stops, not where the plan was moving it (the goals play-through)", () => {
    // (The goals play-through, 2026-11-16: a line of two trains taken by the plan; the harness picked one up, the line was
    // no longer managed, and the plan stayed, steering the other to where it was moving it then. It ran round at full
    // speed for 137 minutes and never came to its next stop.)
    for (const id of ["terminus-spare 3×one same", "siding-spare 3×one same"]) {
      const c = allCases().find((x) => x.id === id)!;
      const layout = new Layout();
      const h = new HarnessRun(layout, scenarioOf(c).scenario);
      let taken = false;
      for (let s = 0; s < 240 && !taken; s++) {
        h.run(1);
        taken = h.engines.some((e) => h.sections.swapping(e) && h.sections.steerHint(e) !== undefined);
      }
      expect(taken, `${id}: the plan has the line`).toBe(true);
      // (Every train but one taken off: the one left is the line's only train.)
      const left = h.engines.findIndex((e) => h.sections.steerHint(e) !== undefined);
      for (let k = 0; k < h.engines.length; k++) if (k !== left) h.putAway(k);
      const before = h.run(0).arrivals[left];
      expect(h.sections.swapping(h.engines[left]), `${id}: no plan left`).toBe(false);
      const after = h.run(180).arrivals[left];
      expect(after - before, `${id}: stops in 3 min after`).toBeGreaterThanOrEqual(3);
    }
  }, 120_000);
});

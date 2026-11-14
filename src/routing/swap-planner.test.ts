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

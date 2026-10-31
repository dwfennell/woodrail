import { describe, expect, it } from "vitest";
import { Layout } from "../track";
import { HarnessRun, INVARIANTS, type Invariant, type Report } from "./harness";
import { fuzz } from "./scenarios";

/**
 * Seeded fuzz over the loop fixtures (spec §12): random lines (0–2 passing loops, stops on loop roads, a dead-end
 * siding), 1–3 trains on one line or each on its own, switches left either way, lever taps. Every invariant is
 * checked; any today's router doesn't meet would be an expected failure naming the step expected to fix it (none since
 * step 4's restore).
 *
 *   npx vitest run src/routing/harness-fuzz.test.ts                         (8 seeds × 5 min: a few seconds)
 *   ROUTING_FUZZ=200 ROUTING_FUZZ_SECONDS=1800 npx vitest run --silent=false src/routing/harness-fuzz.test.ts
 *                                                                           (long: prints a line per seed that broke one,
 *                                                                           and one per seed where a stall began)
 */

const ENV: Record<string, string | undefined> = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};
const SEEDS = Number(ENV.ROUTING_FUZZ ?? 8);
const SECONDS = Number(ENV.ROUTING_FUZZ_SECONDS ?? 300);
const LONG = ENV.ROUTING_FUZZ !== undefined;

/** Expected to fail today, and the step expected to fix each (spec §13). */
const FAILS: Partial<Record<Invariant, string>> = {};

describe(`routing fuzz: ${SEEDS} seeds × ${SECONDS} s`, () => {
  let reports: Report[] | undefined;
  const run = () =>
    (reports ??= Array.from({ length: SEEDS }, (_, k) => {
      const h = new HarnessRun(new Layout(), fuzz(k + 1, SECONDS));
      const r = h.run(SECONDS);
      const broke = INVARIANTS.filter((i) => r.broke[i].count > 0);
      if (LONG && broke.length > 0) console.log(`seed ${k + 1}: ${broke.map((i) => `${i} ×${r.broke[i].count} (${r.broke[i].first[0]})`).join("; ")}`);
      // (Stalls: waits that can't end now nothing turns a train back (§16 Q3), each seed where one began.)
      if (LONG && r.stalls.begun > 0) console.log(`seed ${k + 1} stalls: ${r.stalls.begun} begun, stuck ${r.stalls.stuck.map((s) => (s / 120).toFixed(0)).join("/")} s (${r.stalls.why.map((w) => w ?? "-").join("/")}); stops ${r.arrivals.join("/")}; waits ${r.waits}`);
      return r;
    }));
  for (const inv of INVARIANTS) {
    const check = () => {
      const broke = run().filter((r) => r.broke[inv].count > 0);
      expect(broke.map((r) => `${r.name}: ${r.broke[inv].first[0]}`)).toEqual([]);
    };
    const step = FAILS[inv];
    const timeout = LONG ? 24 * 3600_000 : 60_000;
    if (step) it.fails(`${inv} (expected to fail until ${step})`, check, timeout);
    else it(inv, check, timeout);
  }
  // (A layout the fuzz deals that jams from the start (a train too many for the line, two lines head on) delivers
  // nothing now nothing turns a train back (§16 Q3): its trains must then be said to be stuck, on their cards.)
  it("trains deliver: at least one stop come to in each run, or its trains are said to be stuck", () => {
    expect(run().filter((r) => r.arrivals.every((a) => a === 0) && r.stalls.begun === 0).map((r) => r.name)).toEqual([]);
  });
});

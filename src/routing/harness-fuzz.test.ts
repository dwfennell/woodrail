import { describe, expect, it } from "vitest";
import { Layout } from "../track";
import { INVARIANTS, runScenario, type Invariant, type Report } from "./harness";
import { fuzz } from "./scenarios";

/**
 * Seeded fuzz over the loop fixtures (spec §12): random lines (0–2 passing loops, stops on loop roads, a dead-end
 * siding), 1–3 trains on one line or each on its own, switches left either way, lever taps. Every invariant is
 * checked; those today's router doesn't meet are expected failures naming the step expected to fix them.
 *
 *   npx vitest run src/routing/harness-fuzz.test.ts                         (8 seeds × 5 min: a few seconds)
 *   ROUTING_FUZZ=200 ROUTING_FUZZ_SECONDS=1800 npx vitest run --silent=false src/routing/harness-fuzz.test.ts
 *                                                                           (long: prints a line per seed that broke one)
 */

const ENV: Record<string, string | undefined> = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};
const SEEDS = Number(ENV.ROUTING_FUZZ ?? 8);
const SECONDS = Number(ENV.ROUTING_FUZZ_SECONDS ?? 300);
const LONG = ENV.ROUTING_FUZZ !== undefined;

/** Expected to fail today, and the step expected to fix each (spec §13). */
const FAILS: Partial<Record<Invariant, string>> = { restore: "step 4 (locks, setting and restore)" };

describe(`routing fuzz: ${SEEDS} seeds × ${SECONDS} s`, () => {
  let reports: Report[] | undefined;
  const run = () =>
    (reports ??= Array.from({ length: SEEDS }, (_, k) => {
      const r = runScenario(new Layout(), fuzz(k + 1, SECONDS));
      const broke = INVARIANTS.filter((i) => r.broke[i].count > 0);
      if (LONG && broke.length > 0) console.log(`seed ${k + 1}: ${broke.map((i) => `${i} ×${r.broke[i].count} (${r.broke[i].first[0]})`).join("; ")}`);
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
  it("trains deliver: at least one stop come to in each run", () => {
    expect(run().filter((r) => r.arrivals.every((a) => a === 0)).map((r) => r.name)).toEqual([]);
  });
});

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
 *   npm run fuzz:long                                                       (the long one, sharded over the cores:
 *                                                                           scripts/fuzz-long.mjs; for release points)
 *
 * ROUTING_FUZZ_FIRST: the first seed (default 1), so a shard runs seeds FIRST .. FIRST + ROUTING_FUZZ − 1.
 */

const ENV: Record<string, string | undefined> = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};
const SEEDS = Number(ENV.ROUTING_FUZZ ?? 8);
const FIRST = Number(ENV.ROUTING_FUZZ_FIRST ?? 1);
const SECONDS = Number(ENV.ROUTING_FUZZ_SECONDS ?? 300);
const LONG = ENV.ROUTING_FUZZ !== undefined;

/** Expected to fail today, and the step expected to fix each (spec §13). */
const FAILS: Partial<Record<Invariant, string>> = {};

describe(`routing fuzz: ${SEEDS} seeds${FIRST !== 1 ? ` from ${FIRST}` : ""} × ${SECONDS} s`, () => {
  let reports: Report[] | undefined;
  const run = () =>
    (reports ??= Array.from({ length: SEEDS }, (_, k) => {
      const seed = FIRST + k;
      const h = new HarnessRun(new Layout(), fuzz(seed, SECONDS));
      const r = h.run(SECONDS);
      const broke = INVARIANTS.filter((i) => r.broke[i].count > 0);
      if (LONG && broke.length > 0) console.log(`seed ${seed}: ${broke.map((i) => `${i} ×${r.broke[i].count} (${r.broke[i].first[0]})`).join("; ")}`);
      // (Stalls: waits that can't end now nothing turns a train back (§16 Q3), each seed where one began.)
      if (LONG && r.stalls.begun > 0) console.log(`seed ${seed} stalls: ${r.stalls.begun} begun, stuck ${r.stalls.stuck.map((s) => (s / 120).toFixed(0)).join("/")} s (${r.stalls.why.map((w) => w ?? "-").join("/")}); stops ${r.arrivals.join("/")}; waits ${r.waits}`);
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
  // A hand-run train (no stops: the fuzz deals one a fifth of the time when lines aren't shared) comes to no stop by
  // design; a run of only such trains delivers by running end to end, so it counts once one has turned at an end. (Seeds 9, 41,
  // 106 and 140 are a lone hand-run train shuttling 57–150 times in 30 min: they failed this check for want of a stop.)
  it("trains deliver: at least one stop come to (or end run to, hand-run) in each run, or its trains are said to be stuck", () => {
    // (With any routed train in the run, as before: a stop come to. Only hand-run trains: an end run to.)
    const delivers = (r: Report) =>
      r.routed.some(Boolean) ? r.arrivals.some((a, k) => r.routed[k] && a > 0) : r.turns.some((t) => t.buffer + t["open-end"] > 0);
    expect(run().filter((r) => !delivers(r) && r.stalls.begun === 0).map((r) => r.name)).toEqual([]);
  });
});

/**
 * The same seeds with 0 to 6 signal marks on random joints (signals spec §10.1): every invariant holds (`redRun` and
 * `blockOne` too), and a stall the seed doesn't have without them is a ring of signals (kind "signals").
 */
describe(`routing fuzz with signals: ${SEEDS} seeds × ${SECONDS} s`, () => {
  let reports: { plain: Report; marked: Report }[] | undefined;
  const run = () =>
    (reports ??= Array.from({ length: SEEDS }, (_, k) => {
      const marked = new HarnessRun(new Layout(), fuzz(k + 1, SECONDS, true)).run(SECONDS);
      const plain = new HarnessRun(new Layout(), fuzz(k + 1, SECONDS)).run(SECONDS);
      if (LONG) {
        const broke = INVARIANTS.filter((i) => marked.broke[i].count > 0);
        if (broke.length > 0) console.log(`seed ${k + 1} with signals: ${broke.map((i) => `${i} ×${marked.broke[i].count} (${marked.broke[i].first[0]})`).join("; ")}`);
      }
      return { plain, marked };
    }));
  const timeout = LONG ? 24 * 3600_000 : 120_000;
  for (const inv of INVARIANTS)
    it(inv, () => {
      expect(
        run()
          .filter((r) => r.marked.broke[inv].count > 0)
          .map((r) => `${r.marked.name}: ${r.marked.broke[inv].first[0]}`),
      ).toEqual([]);
    }, timeout);
  it("a stall only with a signal ring (or where the seed stalls without signals)", () => {
    const odd = run().filter((r) => r.marked.stalls.begun > 0 && r.plain.stalls.begun === 0 && r.marked.stalls.why.some((w) => w !== null && w !== "signals"));
    expect(odd.map((r) => `${r.marked.name}: ${r.marked.stalls.why.join("/")}`)).toEqual([]);
  }, timeout);
});

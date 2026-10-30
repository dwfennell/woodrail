import { describe, expect, it } from "vitest";
import { Layout } from "../track";
import { INVARIANTS, runScenario, type Report, type Scenario } from "./harness";
import * as S from "./scenarios";

/**
 * The routing harness (spec §12): each scenario runs once, then each invariant is its own test, as is each scenario's
 * payoff. Today's router (step 1) doesn't meet them all: those are expected failures (`it.fails`) naming the step
 * that should fix them, so that step flips them to passing (an expected failure that passes fails the run).
 *
 *   npx vitest run src/routing/harness.test.ts          (SHOW=1 prints each scenario's report)
 */

const ENV: Record<string, string | undefined> = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};

/** The steps (spec §13) expected to fix today's failures. */
const LOCKS = "step 4 (locks, setting and restore)";
const WAITS = "step 5 (waits at points)";

interface Case {
  scenario: Scenario;
  /** Checks beyond the invariants, by name: what the scenario is for. */
  checks?: Record<string, (r: Report) => void>;
  /** Invariants and checks expected to fail today, and the step expected to fix each. */
  fails?: Record<string, string>;
}

/** Turn-backs only where the track ends (§16 Q3): never one for a train in the way, nor short of a held line end. */
const endsOnly = (r: Report) => expect(r.turns.map((t) => t.train + t.short + t["open-end"])).toEqual(r.turns.map(() => 0));
/** Each train came to its stops at least `n` times. */
const arrivals = (n: number) => (r: Report) => r.arrivals.forEach((a) => expect(a).toBeGreaterThanOrEqual(n));

/** §8: deliver for 30 game minutes with no wait over 20 s (`maxStill`), turning back only at the ends of the line. */
const KID: Case[] = [
  { scenario: S.shuttle, checks: { "payoff: 100+ stops in 30 min": arrivals(100), "turns back only at the buffers": endsOnly } },
  {
    scenario: S.roundAndRound,
    checks: { "payoff: 100+ stops in 30 min": arrivals(100), "never turns back": (r) => expect(r.turns[0]).toEqual({ buffer: 0, "open-end": 0, train: 0, short: 0 }) },
  },
  { scenario: S.branchDelivery, checks: { "payoff: 100+ stops in 30 min": arrivals(100), "turns back only at the buffers": endsOnly }, fails: { restore: LOCKS } },
  { scenario: S.twoTrainsOneLoop, checks: { "payoff: 80+ stops each in 30 min": arrivals(80), "turns back only at the buffers": endsOnly }, fails: { restore: LOCKS } },
  {
    scenario: S.balloon,
    checks: { "payoff: 100+ stops in 30 min": arrivals(100), "turns back only at the buffers": endsOnly, "engine first at every stop": (r) => expect(r.pushed).toEqual([0]) },
  },
];

/**
 * Hashes of the lone trains' runs (every train and switch once a second), recorded at step 1 (eb62e64). Until step 5 a
 * lone train must run exactly as it did; step 5's waits may change a routed one (then record it again, and say why).
 */
const LONE_UNROUTED = "0534b5b8";
const LONE_ROUTED = "654196e5";

const OTHERS: Case[] = [
  { scenario: S.loneUnrouted, checks: { "trajectory as at step 1": (r) => expect(r.trajectory).toBe(LONE_UNROUTED) } },
  { scenario: S.loneRouted, checks: { "trajectory as at step 1": (r) => expect(r.trajectory).toBe(LONE_ROUTED) }, fails: { restore: LOCKS } },
  { scenario: S.followerSameRoad, checks: { "payoff: both at their stops": arrivals(1) } },
  ...[S.followerOtherRoad, S.wyeFromBranch, S.crossoverAt3].map((scenario) => ({
    scenario,
    checks: { "payoff: both at their stops": arrivals(1) },
    fails: { wrongRoad: WAITS, "payoff: both at their stops": WAITS },
  })),
  {
    scenario: S.pinnedOnRoute,
    checks: {
      "never there, and the pin holds": (r) => expect(r.arrivals).toEqual([0]),
      // (§7: it stands at its last good place, its card saying to unpin; today it runs to and fro.)
      "stands rather than shuttles": (r) => expect(r.turns[0].buffer).toBeLessThanOrEqual(1),
    },
    fails: { "stands rather than shuttles": WAITS },
  },
  {
    scenario: S.deadEndSiding,
    checks: { "payoff: 20+ stops": arrivals(20), "never onto the siding": (r) => expect(r.onWatched).toBe(0) },
    fails: { restore: LOCKS },
  },
  {
    scenario: S.crossoverRing,
    checks: { "payoff: 10+ stops each": arrivals(10), "turns back only at the buffers": endsOnly },
    fails: { restore: LOCKS, "payoff: 10+ stops each": WAITS, "turns back only at the buffers": WAITS },
  },
  {
    scenario: S.threeTrainsOneLoop,
    // (One train has no room (loops + 1): held, by design. The other two carry on.)
    checks: { "payoff: the line delivers (30+ stops)": (r) => expect(r.arrivals.reduce((a, b) => a + b)).toBeGreaterThanOrEqual(30) },
    fails: { restore: LOCKS },
  },
  { scenario: S.leverDuringLock, checks: { "payoff: 15+ stops": arrivals(15) }, fails: { restore: LOCKS } },
  { scenario: S.saveDuringLock, checks: { "payoff: 15+ stops": arrivals(15) }, fails: { restore: LOCKS } },
  { scenario: S.removedUnderLock, checks: { "payoff: on to Town (10+ stops)": arrivals(10) }, fails: { restore: LOCKS } },
];

/** The router's cost: mean µs per tick over the §8 runs (10 µs a steer every 8 ticks, today: about 1–2 µs a tick). */
const ROUTER_US = 25;

function describeCase(c: Case): void {
  describe(c.scenario.name, () => {
    let report: Report | undefined;
    const run = () => {
      if (!report) {
        report = runScenario(new Layout(), c.scenario);
        if (ENV.SHOW) show(report);
      }
      return report;
    };
    const named: [string, (r: Report) => void][] = [
      ...INVARIANTS.map((k): [string, (r: Report) => void] => [k, (r) => expect(r.broke[k].first, `${k} broke ${r.broke[k].count} times`).toEqual([])]),
      ...Object.entries(c.checks ?? {}),
    ];
    for (const [name, check] of named) {
      const step = c.fails?.[name];
      if (step) it.fails(`${name} (expected to fail until ${step})`, () => check(run()), 60_000);
      else it(name, () => check(run()), 60_000);
    }
  });
}

function show(r: Report): void {
  console.log(`${r.name}: ${(r.ticks / 120).toFixed(0)} s in ${r.ms.toFixed(0)} ms, router ${r.routerUs.toFixed(2)} µs/tick; stops ${r.arrivals.join("/")}; turns ${r.turns.map((t) => `${t.buffer}b ${t.train}t ${t.short}s ${t["open-end"]}e`).join(", ")}; longest still ${r.longestStill.map((s) => (s / 120).toFixed(1)).join("/")} s; facing ${r.facing}, throws ${r.throws}; trajectory ${r.trajectory}`);
  for (const k of INVARIANTS) if (r.broke[k].count) console.log(`  ${k} ×${r.broke[k].count}: ${r.broke[k].first.join(" | ")}`);
}

describe("§8 kid automations: 30 game minutes, no wait over 20 s", () => KID.forEach(describeCase));
describe("§12 scenarios", () => OTHERS.forEach(describeCase));

describe("the checks catch what they're for (controls)", () => {
  it("points thrown under a train: a split, and a throw under a train", () => {
    const r = runScenario(new Layout(), S.thrownUnder(false));
    expect(r.broke.underTrain.count).toBe(1);
    expect(r.broke.split.count).toBeGreaterThan(0);
    expect(r.broke.pinned.count).toBe(0);
  });
  it("pinned points thrown: the pin's check too", () => {
    const r = runScenario(new Layout(), S.thrownUnder(true));
    expect(r.broke.pinned.count).toBeGreaterThan(0);
  });
  it("a train still for longer than allowed: stuck (the shuttle stands 2 s at each buffer)", () => {
    const r = runScenario(new Layout(), { ...S.shuttle, seconds: 60, maxStill: 1 });
    expect(r.broke.deadlock.count).toBeGreaterThan(0);
  });
});

describe("every expected failure names a step", () => {
  it("and names a check the case has", () => {
    for (const c of [...KID, ...OTHERS]) {
      const names = new Set<string>([...INVARIANTS, ...Object.keys(c.checks ?? {})]);
      for (const [name, step] of Object.entries(c.fails ?? {})) {
        expect(names.has(name), `${c.scenario.name}: ${name}`).toBe(true);
        expect(step).toMatch(/^step \d/);
      }
    }
  });
});

describe("routing's cost", () => {
  it(`the router takes under ${ROUTER_US} µs a tick on the §8 runs (best of 3 short runs each)`, () => {
    for (const s of S.KID) {
      // (A warm-up, then the best of three 2-minute runs: load can slow one, not all three.)
      runScenario(new Layout(), { ...s, seconds: 30 });
      const best = Math.min(...[0, 1, 2].map(() => runScenario(new Layout(), { ...s, seconds: 120 }).routerUs));
      expect(best, s.name).toBeLessThan(ROUTER_US);
    }
  }, 60_000);
});

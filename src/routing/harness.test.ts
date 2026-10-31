import { describe, expect, it } from "vitest";
import { Layout } from "../track";
import { SIM_HZ } from "../sim";
import { STAND_SHORT } from "../economy/sections";
import { HarnessRun, INVARIANTS, runScenario, type Report, type Scenario } from "./harness";
import { OVERLAP } from "./router";
import { planStats } from "./plan";
import * as S from "./scenarios";

/**
 * The routing harness (spec §12): each scenario runs once, then each invariant is its own test, as is each scenario's
 * payoff. Where today's router (step 5: locks, setting and restore, and waits at points) doesn't meet them, they're
 * expected failures (`it.fails`) naming the step that should fix them, so that step flips them to passing (an expected
 * failure that passes fails the run). None are left after step 5.
 *
 *   npx vitest run src/routing/harness.test.ts          (SHOW=1 prints each scenario's report)
 */

const ENV: Record<string, string | undefined> = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};

interface Case {
  scenario: Scenario;
  /** Checks beyond the invariants, by name: what the scenario is for. */
  checks?: Record<string, (r: Report) => void>;
  /** Invariants and checks expected to fail today, and the step expected to fix each. */
  fails?: Record<string, string>;
}

/** Turn-backs only at buffers (§16 Q3: a train turns only at the end of the track; the sim has no other turn now). */
const endsOnly = (r: Report) => expect(r.turns.map((t) => t["open-end"])).toEqual(r.turns.map(() => 0));
/** Never stuck (stalls.ts): no wait that can't end, now that nothing turns a train back to end one (§16 Q3). */
const noStall = (r: Report) => expect({ begun: r.stalls.begun, stuck: r.stalls.stuck }).toEqual({ begun: 0, stuck: r.stalls.stuck.map(() => 0) });
/** Each train came to its stops at least `n` times. */
const arrivals = (n: number) => (r: Report) => r.arrivals.forEach((a) => expect(a).toBeGreaterThanOrEqual(n));

/** §8: deliver for 30 game minutes with no wait over 20 s (`maxStill`), turning back only at the ends of the line. */
const KID: Case[] = [
  { scenario: S.shuttle, checks: { "payoff: 100+ stops in 30 min": arrivals(100), "turns back only at the buffers": endsOnly, "never stuck": noStall } },
  {
    scenario: S.roundAndRound,
    checks: { "payoff: 100+ stops in 30 min": arrivals(100), "never turns back": (r) => expect(r.turns[0]).toEqual({ buffer: 0, "open-end": 0 }), "never stuck": noStall },
  },
  {
    scenario: S.branchDelivery,
    checks: {
      "payoff: 100+ stops in 30 min": arrivals(100),
      "turns back only at the buffers": endsOnly,
      "never stuck": noStall,
      // (§8.3: set for the siding, then put back, so the loop is as the player left it: twice a visit to the mine.)
      "the wye set for the mine and put back each time": (r) => {
        expect(r.restored).toBeGreaterThanOrEqual(50);
        // (Set and put back, each time; set once more if the run ends on its way to the mine.)
        expect(r.throws - 2 * r.restored).toBeGreaterThanOrEqual(0);
        expect(r.throws - 2 * r.restored).toBeLessThanOrEqual(1);
      },
    },
  },
  { scenario: S.twoTrainsOneLoop, checks: { "payoff: 80+ stops each in 30 min": arrivals(80), "turns back only at the buffers": endsOnly, "never stuck": noStall } },
  {
    scenario: S.balloon,
    checks: { "payoff: 100+ stops in 30 min": arrivals(100), "turns back only at the buffers": endsOnly, "engine first at every stop": (r) => expect(r.pushed).toEqual([0]), "never stuck": noStall },
  },
];

/**
 * Hashes of the lone trains' runs (every train once a second), recorded at step 1 (eb62e64). Through step 5 a lone
 * train runs exactly as it did: a lone train is never refused its points, so it never waits.
 */
const LONE_UNROUTED = "0534b5b8";
const LONE_ROUTED = "654196e5";

const OTHERS: Case[] = [
  { scenario: S.loneUnrouted, checks: { "trajectory as at step 1": (r) => expect(r.trajectory).toBe(LONE_UNROUTED) } },
  // (Routed, its points now go back after it: the same moves, as the hash (trains only) shows.)
  { scenario: S.loneRouted, checks: { "trajectory as at step 1": (r) => expect(r.trajectory).toBe(LONE_ROUTED) } },
  { scenario: S.followerSameRoad, checks: { "payoff: both at their stops": arrivals(1) } },
  // (Step 5: the follower stops short of the points set for the first train's road, and waits for them.)
  ...[S.followerOtherRoad, S.wyeFromBranch, S.crossoverAt3].map((scenario) => ({
    scenario,
    checks: { "payoff: both at their stops": arrivals(1), "the follower waited at the points": (r: Report) => expect(r.waited[1]).toBeGreaterThan(0), "never stuck": noStall },
  })),
  // (Single-line working across lines, as in the game: the one behind is held by sections at its slot's end, short of
  // the points, while the first holds the junction; the router never needs to stop it.)
  {
    scenario: S.followerOtherRoadShared,
    checks: {
      "payoff: both at their stops": arrivals(1),
      "the follower waited at its slot's end, held by sections": (r: Report) => expect(r.held[1]).toBeGreaterThan(0),
      "never stuck": noStall,
    },
  },
  {
    scenario: S.followerSameRoadShared,
    // (X's siding is a line end: it holds one train. The follower waits for it to be clear, not running in behind the
    // first, which would have no way back out.)
    checks: {
      "the first at its stop; the follower waits for X's siding": (r) => expect(r.arrivals).toEqual([1, 0]),
      "the follower waited at its slot's end, held by sections": (r: Report) => expect(r.held[1]).toBeGreaterThan(0),
    },
  },
  {
    scenario: S.twoRoadsOneSwitch,
    checks: {
      "payoff: both at their stops": arrivals(1),
      "the first never waits": (r) => expect(r.waited[0]).toBe(0),
      // (Visibly: it stood a quarter of a second or more, its nose a little short of the points, never on them. Keeping
      // its follow gap (#6) it comes up to them later, so it waits less than it did running nose to tail.)
      "the second stops short of the points and waits": (r) => {
        expect(r.waited[1]).toBeGreaterThanOrEqual(SIM_HZ / 4);
        expect(r.stoodFrom[1].near).toBeGreaterThanOrEqual(STAND_SHORT + OVERLAP - 2);
        expect(r.stoodFrom[1].far).toBeLessThanOrEqual(STAND_SHORT + OVERLAP + 2);
      },
      // (Laid set for X, the first's road: they move once, for the second once the first is by, and once back.)
      "the points move once for the second, and once back": (r) => {
        expect(r.throws).toBe(2);
        expect(r.restored).toBe(1);
      },
      "never stuck": noStall,
    },
  },
  {
    scenario: S.pinnedOnRoute,
    checks: {
      "never there, and the pin holds": (r) => expect(r.arrivals).toEqual([0]),
      // (§7: it stands short of the red switch, its card saying to unpin; before step 5 it ran to and fro.)
      "stands rather than shuttles": (r) => expect(r.turns[0].buffer).toBeLessThanOrEqual(1),
    },
  },
  {
    scenario: S.deadEndSiding,
    checks: { "payoff: 20+ stops": arrivals(20), "never onto the siding": (r) => expect(r.onWatched).toBe(0) },
  },
  {
    scenario: S.balloonBehindOpenRoad,
    // (Both ways reach the stop. Step 3's finding: `distanceTo` overcounted the balloon, so the train took the siding
    // and reversed; the plan, deciding from step 4, takes the balloon.)
    checks: { "payoff: 5+ stops": arrivals(5), "round the balloon, never into the siding (the plan's way)": (r) => expect(r.onWatched).toBe(0) },
  },
  {
    scenario: S.crossoverRing,
    // (Each locks both crossovers to its clear point; the other, refused, waits short of them till it's by. At step 4 it
    // ran over them as they lay and took the wrong road; before locks they met head on in the middle.)
    checks: { "payoff: 10+ stops each": arrivals(10), "turns back only at the buffers": endsOnly, "never stuck": noStall },
  },
  {
    scenario: S.threeTrainsOneLoop,
    // (One train has no room (loops + 1): held, by design, where it stands in the others' way. Nothing turns back short
    // of it any more (§16 Q3, `deadEndCap` is gone): the two it has room for stand, stuck, "too many trains".)
    checks: {
      "turns back only at the buffers": endsOnly,
      "the two it has room for stand stuck: too many trains": (r) => {
        // (Room handed to the held one now and then (`unring`'s hand-over) changes which one is held: any may be.)
        expect(r.stalls.why.filter((w) => w === "too-many").length).toBeGreaterThanOrEqual(2);
        expect(Math.min(...r.stalls.stuck.filter((n) => n > 0))).toBeGreaterThan(60 * SIM_HZ);
      },
    },
  },
  {
    scenario: S.threeTrainsPutAway,
    // (The player's fix: the held one put away at 2 minutes. The other two pass at the loop and deliver.)
    checks: { "turns back only at the buffers": endsOnly, "payoff: the two deliver once it's put away (30+ stops)": (r) => expect(r.arrivals.reduce((a, b) => a + b)).toBeGreaterThanOrEqual(30) },
  },
  {
    scenario: S.headOnTwoLines,
    // (Two single-train lines, unmanaged: they meet nose to nose and stand there, each stuck in the other's way.)
    checks: {
      "turns back only at the buffers": endsOnly,
      "neither turns back: both stand nose to nose, stuck in each other's way": (r) => {
        expect(r.turns).toEqual([
          { buffer: 0, "open-end": 0 },
          { buffer: 0, "open-end": 0 },
        ]);
        expect(r.stalls.why).toEqual(["in-way", "in-way"]);
        expect(r.stalls.begun).toBe(1);
        r.stalls.stuck.forEach((n) => expect(n).toBeGreaterThan(60 * SIM_HZ));
      },
    },
  },
  {
    scenario: S.facingInLineEnd,
    // (A ring of sections' waits: each of the line's two trains waits on the other, face to face in the line end.)
    checks: {
      "turns back only at the buffers": endsOnly,
      "both stand, stuck in each other's way": (r) => {
        expect(r.stalls.why).toEqual(["in-way", "in-way"]);
        expect(r.stalls.begun).toBe(1);
      },
    },
  },
  {
    scenario: S.leverDuringLock,
    checks: {
      "payoff: 15+ stops": arrivals(15),
      // (§16 Q1, as changed at step 5: the tap leaves the points set for the train, which keeps its route to the mine;
      // they go to the tap's way once it has passed (the restore check), never moved under it.)
      "the tap waits for the train: its points stay set for it": (r) => expect(r.tapKept).toBe(true),
    },
  },
  { scenario: S.saveDuringLock, checks: { "payoff: 15+ stops": arrivals(15) } },
  { scenario: S.removedUnderLock, checks: { "payoff: on to Town (10+ stops)": arrivals(10) } },
];

/**
 * Single-line working across lines (sections shared by every line on a network, and trains on no line going the way
 * the points lie): one train in each stretch of single track, and trains meet at the loops, taking different roads.
 */
const SHARED: Case[] = [
  {
    scenario: S.twoLinesOneLoop,
    checks: { "payoff: 80+ stops each in 30 min": arrivals(80), "they pass at the loop: never stuck": noStall, "turns back only at the buffers": endsOnly },
  },
  {
    scenario: S.threeLinesTwoLoops,
    checks: { "payoff: 50+ stops each in 30 min": arrivals(50), "they pass at the loops: never stuck": noStall, "turns back only at the buffers": endsOnly },
  },
  {
    scenario: S.twoLinesThreeTrains,
    checks: { "payoff: 50+ stops each in 30 min": arrivals(50), "they pass at the loops: never stuck": noStall, "turns back only at the buffers": endsOnly },
  },
  {
    scenario: S.linelessWithLine,
    checks: {
      "payoff: the line's train 80+ stops in 30 min": (r) => expect(r.arrivals[0]).toBeGreaterThanOrEqual(80),
      "the hand-run one keeps going: 80+ turns at the buffers": (r) => expect(r.turns[1].buffer).toBeGreaterThanOrEqual(80),
      "they pass at the loop: never stuck": noStall,
      "turns back only at the buffers": endsOnly,
    },
  },
  {
    scenario: S.twoLinesNoLoop,
    // (No passing place: each stands where it is, waiting for the other's end of the line, stuck in its way; the card
    // says to add a passing loop, engine-status.ts.)
    checks: {
      "turns back only at the buffers": endsOnly,
      "both stand, stuck in each other's way": (r) => {
        expect(r.stalls.why).toEqual(["in-way", "in-way"]);
        expect(r.stalls.begun).toBe(1);
      },
    },
  },
];

/**
 * Step 6, forward costs (#7, §16 Q4): a route goes round a balloon, a wye's loop or an oval rather than reverse at a
 * dead end (by piece counts it took the spur: plan.test.ts), and turns only where it must, at the line's own end (T's
 * buffers), by the end-of-line flip, so engine first at every stop. A train the player set up engine-last keeps pushing.
 */
const noSpur = (r: Report) => expect(r.onWatched).toBe(0);
const engineFirst = (r: Report) => expect(r.pushed).toEqual([0]);
/** Turns only at T's buffers: once a visit to T (every other stop), one more if the run ends on its way back. */
const turnsAtT = (r: Report) => expect(r.turns[0].buffer).toBeLessThanOrEqual(Math.ceil(r.arrivals[0] / 2) + 1);
const FORWARD: Case[] = [
  ...[S.balloonOverSpur, S.wyeOverSpur].map((scenario) => ({
    scenario,
    checks: { "payoff: 20+ stops in 10 min": arrivals(20), "round, never into the spur": noSpur, "turns only at the end of the line": turnsAtT, "engine first at every stop": engineFirst, "never stuck": noStall },
  })),
  {
    scenario: S.loopOverSpur,
    checks: {
      "payoff: 30+ stops in 10 min": arrivals(30),
      "round the oval, never into the spur": noSpur,
      "never turns": (r) => expect(r.turns[0]).toEqual({ buffer: 0, "open-end": 0 }),
      "engine first at every stop": engineFirst,
      "never stuck": noStall,
    },
  },
  {
    scenario: S.pushingShuttle,
    checks: {
      "payoff: 30+ stops in 10 min": arrivals(30),
      "turns back only at the buffers, by the flip": endsOnly,
      "keeps pushing, as the player set it up": (r) => expect(r.pushed).toEqual(r.arrivals),
    },
  },
];

/** The router's cost: mean µs per tick over the §8 runs (10 µs a steer every 8 ticks, today: about 1–2 µs a tick). */
const ROUTER_US = 25;

/** Each case's run, once. */
const runs = new Map<Case, Report>();
function runCase(c: Case): Report {
  let r = runs.get(c);
  if (!r) {
    r = new HarnessRun(new Layout(), c.scenario).run(c.scenario.seconds);
    runs.set(c, r);
    if (ENV.SHOW) show(r);
  }
  return r;
}

function describeCase(c: Case): void {
  describe(c.scenario.name, () => {
    const run = () => runCase(c);
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
  console.log(`${r.name}: ${(r.ticks / 120).toFixed(0)} s in ${r.ms.toFixed(0)} ms, router ${r.routerUs.toFixed(2)} µs/tick; stops ${r.arrivals.join("/")}; turns ${r.turns.map((t) => `${t.buffer}b ${t["open-end"]}e`).join(", ")}; longest still ${r.longestStill.map((s) => (s / 120).toFixed(1)).join("/")} s; facing ${r.facing}, throws ${r.throws}; locks ${r.locks}, refused ${r.refused}, put back ${r.restored}; waits ${r.waits}, stood waiting ${r.waited.map((w) => (w / 120).toFixed(1)).join("/")} s; stalls ${r.stalls.begun}, stuck ${r.stalls.stuck.map((s) => (s / 120).toFixed(1)).join("/")} s (${r.stalls.why.map((w) => w ?? "-").join("/")}); ${r.looks} looks, ${r.lookUs.toFixed(1)} µs each, ${r.pieceUs.toFixed(1)} µs a piece; trajectory ${r.trajectory}`);
  for (const k of INVARIANTS) if (r.broke[k].count) console.log(`  ${k} ×${r.broke[k].count}: ${r.broke[k].first.join(" | ")}`);
}

describe("§8 kid automations: 30 game minutes, no wait over 20 s", () => KID.forEach(describeCase));
describe("§12 scenarios", () => OTHERS.forEach(describeCase));
describe("single-line working across lines: 30 game minutes, no wait over 20 s", () => SHARED.forEach(describeCase));
describe("step 6, forward costs: round rather than reverse", () => FORWARD.forEach(describeCase));

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
    for (const c of [...KID, ...OTHERS, ...SHARED, ...FORWARD]) {
      const names = new Set<string>([...INVARIANTS, ...Object.keys(c.checks ?? {})]);
      for (const [name, step] of Object.entries(c.fails ?? {})) {
        expect(names.has(name), `${c.scenario.name}: ${name}`).toBe(true);
        expect(step).toMatch(/^step \d/);
      }
    }
  });
});

describe("routing's cost", () => {
  it("a look ahead (asking for the points, locks included) takes well under 0.1 ms, mean over every case", () => {
    const all = [...KID, ...OTHERS].map(runCase);
    const looks = all.reduce((t, r) => t + r.looks, 0);
    const us = all.reduce((t, r) => t + r.lookUs * r.looks, 0) / Math.max(1, looks);
    const pieces = all.reduce((t, r) => t + r.pieces, 0);
    const perPiece = all.reduce((t, r) => t + r.pieceUs * r.pieces, 0) / Math.max(1, pieces);
    if (ENV.SHOW) console.log(`looks: ${looks}, mean ${us.toFixed(2)} µs; ${pieces} pieces come onto, ${perPiece.toFixed(1)} µs of router time each; plan choices ${planStats.choices} worked out, ${planStats.hits} cached`);
    expect(looks).toBeGreaterThan(1000);
    expect(us).toBeLessThan(100);
    // (The plan's choices at points are cached by the track and the pins: most come from the cache.)
    expect(planStats.hits).toBeGreaterThan(planStats.choices);
  }, 120_000);
  it(`the router takes under ${ROUTER_US} µs a tick on the §8 runs (best of 3 short runs each)`, () => {
    for (const s of S.KID) {
      // (A warm-up, then the best of three 2-minute runs: load can slow one, not all three.)
      runScenario(new Layout(), { ...s, seconds: 30 });
      const best = Math.min(...[0, 1, 2].map(() => runScenario(new Layout(), { ...s, seconds: 120 }).routerUs));
      expect(best, s.name).toBeLessThan(ROUTER_US);
    }
  }, 60_000);
});

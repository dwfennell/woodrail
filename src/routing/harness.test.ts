import { describe, expect, it } from "vitest";
import { Layout } from "../track";
import { SIM_HZ, advanceCursor, flipCursor } from "../sim";
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
  // (Route keep: the user's follower through points set for the train ahead, with a stop right before them, as a loop
  // laid at the end of a line puts them. At a stop, a train is heading for the one after: it asks for the points as it
  // leaves, and waits for them while they're set for the train ahead. Before: wrong road, alone or following.)
  { scenario: S.stopBeforePoints(false), checks: { "payoff: at both its stops": arrivals(1) } },
  { scenario: S.stopBeforePoints(true), checks: { "payoff: both at their stops": arrivals(1) } },
  { scenario: S.stopBeforePoints(true, true), checks: { "payoff: the routed one at its stops": (r) => expect(r.arrivals[1]).toBeGreaterThanOrEqual(1) } },
  // (A train still at a stop, its tail on it, its front past the next stop and onto points: it heads for the stop after
  // that, the one it's at as soon as its tail is off. Before (the goals play-through from minute 223): it headed for the
  // stop under it, asked for nothing, and took the points as they lay: into the spur, or toward C by a wrong road.)
  ...[true, false].map((spur) => ({
    scenario: S.ranThroughStop(spur),
    checks: {
      "payoff: round its four stops, laps on": arrivals(8),
      "never onto the spur": (r: Report) => expect(r.onWatched).toBe(0),
    },
  })),
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
    // (Room for all three: the loop and the line's two ends. Before, the room rule (loops + 1) held one, where it stood
    // in the others' way, and the line stood still, "too many trains" (stalls-verify 2026-11-10).)
    checks: { "turns back only at the buffers": endsOnly, "payoff: each train 15+ stops": arrivals(15), "never stuck": noStall },
  },
  {
    scenario: S.fourTrainsOneLoop,
    // (One train has no room (the loop and the line's two ends hold three): held, by design, where it stands in the
    // others' way. Nothing turns back short of it (§16 Q3): those it has room for stand, stuck, "too many trains".)
    checks: {
      "turns back only at the buffers": endsOnly,
      "those it has room for stand stuck: too many trains": (r) => {
        // (Room handed to the held one now and then (`unring`'s hand-over) changes which one is held: any may be.)
        expect(r.stalls.why.filter((w) => w === "too-many").length).toBeGreaterThanOrEqual(2);
        expect(Math.min(...r.stalls.stuck.filter((n) => n > 0))).toBeGreaterThan(60 * SIM_HZ);
      },
    },
  },
  {
    scenario: S.fourTrainsPutAway,
    // (The player's fix: the held one put away at 2 minutes. The other three pass at the loop and deliver.)
    checks: { "turns back only at the buffers": endsOnly, "payoff: the three deliver once it's put away (30+ stops)": (r) => expect(r.arrivals.reduce((a, b) => a + b)).toBeGreaterThanOrEqual(30) },
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
      // (Giving way: a single line, neither has a way round to its stop, so neither turns.)
      "nobody gives way: no road out ahead": (r) => expect(r.gaveWay).toEqual({ any: 0 }),
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
    // (Play-test 2026-11-01: all three stood, stuck, from the start, till a train could follow one on no line.)
    scenario: S.ringRoutedAmongHandRun,
    checks: {
      "payoff: the routed train 60+ stops in 30 min": (r) => expect(r.arrivals[0]).toBeGreaterThanOrEqual(60),
      "they follow each other round: never stuck": noStall,
      "nobody turns back (a ring has no end)": (r) => expect(r.turns).toEqual(r.turns.map(() => ({ buffer: 0, "open-end": 0 }))),
    },
  },
  {
    // (The user, 2026-11-02: held "too many" before, though they could just follow round.)
    scenario: S.ringLineOfThree,
    checks: {
      "payoff: each train 40+ stops in 30 min": arrivals(40),
      "they follow each other round, none held for room: never stuck": noStall,
      "nobody turns back (a ring has no end)": (r) => expect(r.turns).toEqual(r.turns.map(() => ({ buffer: 0, "open-end": 0 }))),
    },
  },
  {
    // (One going the other way could meet the others head on: single-line working stays, they pass at the loop.)
    scenario: S.ringLineBothWays(false),
    checks: { "payoff: each train 40+ stops in 30 min": arrivals(40), "they pass at the loop: never stuck": noStall },
  },
  {
    // (Two lines round a ring with two loops, Red's two one way, Blue's the other: first come, first served at the loops,
    // and a loop takes Red's second beside its first when they wait on each other. Red's two stood for good before.)
    scenario: S.ringLinesBothWays,
    checks: { "payoff: each train 40+ stops in 30 min": arrivals(40), "nobody kept waiting: never stuck": noStall },
  },
  {
    // (Three, one going the other way, one loop: a train too many, as before; said stuck, the fix a loop.)
    scenario: S.ringLineBothWays(true),
    checks: {
      "the room rule stays: one held, said stuck too-many": (r) => expect(r.stalls.why.filter((w) => w === "too-many").length).toBeGreaterThan(0),
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
 
      "nobody gives way: no road out ahead": (r) => expect(r.gaveWay).toEqual({ any: 0 }),
    },
  },
];

/**
 * Giving way (economy/stalls.ts, the user 2026-11-05: "everything stops even though it could easily keep going"): a ring
 * of waits is broken where the track ahead allows, by a hand-run train taking another road, going forwards. Nothing
 * turns a train round to give way (the user, firm, 2026-11-07: "trains should not turn around except at the end of
 * lines"; every case checks `midTurn`): a ring with no road out ahead is said stuck, steadily, on each train's card.
 */
/** Stuck for good, each "in the way" of another, from one stall on: no turning, no ping-pong. */
const stuckSteadily = (n: number, s: number) => (r: Report) => {
  expect(r.stalls.why).toEqual(r.stalls.why.map(() => "in-way"));
  expect(r.stalls.begun).toBeLessThanOrEqual(n);
  r.stalls.stuck.forEach((t) => expect(t).toBeGreaterThan(s * SIM_HZ));
};
const nobodyGaveWay = (r: Report) => expect(r.gaveWay).toEqual({ any: 0 });
const GIVE_WAY: Case[] = [
  {
    // (They met head on with nothing between them but the points the hand-run one stood on, held there by sections,
    // and stood for good. Now the hand-run one asks for the way short of the points (`comesInto`), and waits clear of
    // them while the routed one goes by: both keep working, turning only at the buffers.)
    scenario: S.routedMeetsHandRun,
    checks: {
      "payoff: the routed train 10+ stops, the hand-run one 10+ runs to its end": (r) => {
        expect(r.arrivals[0]).toBeGreaterThanOrEqual(10);
        expect(r.turns[1].buffer).toBeGreaterThanOrEqual(10);
      },
      "never stuck": noStall,
      "nobody gives way: no need": nobodyGaveWay,
      "turns back only at the buffers": endsOnly,
    },
  },
  {
    // (Nose to nose round an oval: the way round is behind each. Before 2026-11-07 one turned round to take it.)
    scenario: S.routedHeadOnRing,
    checks: {
      "both stand, stuck in each other's way": stuckSteadily(1, 200),
      "nobody gives way": nobodyGaveWay,
      "nobody turns back at an end (an oval has none)": (r) => expect(r.turns).toEqual(r.turns.map(() => ({ buffer: 0, "open-end": 0 }))),
    },
  },
  {
    scenario: S.handRunBoxedIn,
    checks: {
      "nobody gives way: boxed in, no road out ahead": nobodyGaveWay,
      "both said stuck in each other's way, steadily (one stall)": stuckSteadily(1, 80),
    },
  },
  {
    // (Points thrown for a road given way that didn't take go back to the player's way: `restore` holds, as every case's.
    // And a standing hand-run train isn't handed a lock it can't use (`Router.release`): two standing in the ring passed
    // the loop's points to and fro, each waiting on the other, so the free road could never be given. Before 2026-11-07
    // the one that gave way turned round instead.)
    scenario: S.handRunRoadHeld,
    checks: {
      // (Before: 3 stops, then all three said stuck for good.)
      "payoff: the routed train 8+ stops in 5 min": (r) => expect(r.arrivals[0]).toBeGreaterThanOrEqual(8),
      "never stuck": noStall,
      "the hand-run ones keep going: 5+ turns at the buffers each": (r) => r.turns.slice(1).forEach((t) => expect(t.buffer).toBeGreaterThanOrEqual(5)),
    },
  },
  {
    // (Points a standing train's look threw at its dead end's mouth go back: `restore` holds, as every case's. Before:
    // "131.4 s: points 5 left at 1 (default 0), no train on them". The routed train comes in behind the hand-run one in
    // the line's end, where they meet head on: no road out ahead, so they stand, and the third waits behind them. Before
    // 2026-11-07 the hand-run one turned round.)
    scenario: S.deadEndMouthThrown,
    checks: {
      "all stand, said stuck in the way": stuckSteadily(2, 100),
      "nobody gives way": nobodyGaveWay,
    },
  },
  {
    // (Fuzz seed 68: the points thrown for the boxed-in train's road by the loop are kept for it while it runs on to them,
    // so it passes the routed one there. Before: put back before it got to them, 1 stop, then all three stuck.)
    scenario: S.boxedOnLoopLine,
    checks: {
      "payoff: the routed train 5+ stops in 5 min": (r) => expect(r.arrivals[0]).toBeGreaterThanOrEqual(5),
      "never stuck": noStall,
      "the hand-run ones keep going: 5+ turns at the buffers each": (r) => r.turns.slice(1).forEach((t) => expect(t.buffer).toBeGreaterThanOrEqual(5)),
    },
  },
  {
    // (Fuzz seed 125: the routed train past the last loop, a hand-run one boxed in by B on the routed one's stop, facing
    // it. The loop is behind the routed train: no road out ahead for either, so they stand, and the third waits behind.
    // Before 2026-11-07 the routed one turned back to the loop to let it out.)
    scenario: S.boxedPastLoop,
    checks: {
      "all stand, said stuck in the way": stuckSteadily(2, 200),
      "nobody gives way": nobodyGaveWay,
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
// (Nothing turns a train round mid-line now (routing redesign step 1): `midTurn` holds in every case.)
describe("giving way: a ring of waits broken where the track allows", () => GIVE_WAY.forEach(describeCase));

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

describe("stalls", () => {
  it("a train put away: stalls drop it at once, so no card names it as in the way (they look every 30 ticks)", () => {
    // (Two single-train lines nose to nose, each said stuck in the other's way; one put away mid-look.)
    let before: string | undefined;
    let after: unknown = "not run";
    const scenario: Scenario = {
      ...S.headOnTwoLines,
      seconds: 70,
      build: (layout) => ({
        ...S.headOnTwoLines.build(layout),
        events: [
          {
            when: (run) => run.sim.ticks >= 60 * SIM_HZ && run.sim.ticks % 30 === 7,
            do: (run) => {
              before = run.stalls.stuckOf(run.engines[1])?.kind;
              run.putAway(0);
              after = run.stalls.stuckOf(run.engines[1]);
            },
          },
        ],
      }),
    };
    runScenario(new Layout(), scenario);
    expect(before).toBe("in-way");
    expect(after).toBeNull();
  });
});

/**
 * Kept waiting by a train going round non-stop (`ringLinesBothWays` with `Sections.fair` off: no first-come order, and a
 * wait names whichever train it last looked at, as before 2026-11-02). Red's two stand from the start, each wanting the
 * road Blue's takes every time it comes by; their waits name Blue's, under way, so no ring is seen. Now said stuck all
 * the same once they've stood `STARVED_S` (stalls.ts), on their cards.
 */
describe("a train kept waiting by one going round non-stop is said stuck (fair off, as before)", () => {
  it("Red's two stand while Blue's runs, and are said stuck in its way after 2 minutes", () => {
    const scenario: Scenario = {
      ...S.ringLinesBothWays,
      seconds: 300,
      build: (layout) => {
        const b = S.ringLinesBothWays.build(layout);
        return { ...b, events: [...(b.events ?? []), { at: 0, do: (run) => void (run.sections.fair = false) }] };
      },
    };
    const r = runScenario(new Layout(), scenario);
    expect(r.arrivals.slice(0, 2)).toEqual([0, 0]);
    expect(r.arrivals[2]).toBeGreaterThan(10);
    expect(r.stalls.why.slice(0, 2)).toEqual(["in-way", "in-way"]);
    expect(r.stalls.stuck[0] / 120).toBeGreaterThan(100);
  }, 60_000);
});

describe("every expected failure names a step", () => {
  it("and names a check the case has", () => {
    for (const c of [...KID, ...OTHERS, ...SHARED, ...FORWARD, ...GIVE_WAY]) {
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

/**
 * Step 7 (spec §13, §16 Q5, Q6): hand-run trains respect locks. Each case is driven in steps, looking at the trains
 * between them; the invariants (`lockRun` among them: never onto points locked for others only) are checked as ever.
 */
describe("step 7: hand-run trains respect locks", () => {
  const noBreaks = (r: Report) => INVARIANTS.forEach((k) => expect(r.broke[k].first, k).toEqual([]));
  /** The hand-run train's front on the trunk (past the points the routed one had set for P). */
  const onTrunk = (run: HarnessRun, trunk: number[]) => trunk.includes(run.sim.findCar(run.engines[1])!.train.bogies[0].pieceId);

  it("waits short of points set for a routed train's road, never over them, then goes as they lie; nothing is set for it", () => {
    const h = S.handAtLock();
    const run = new HarnessRun(new Layout(), h.scenario);
    const j = h.j();
    const [routed, hand] = run.engines;
    let waitedS = 0;
    let near = Infinity;
    let wentAt = -1;
    for (let k = 0; k < 15 * SIM_HZ; k++) {
      run.step();
      const H = run.sim.findCar(hand)!.train;
      const w = run.router.waitOf(hand);
      if (w && H.speed === 0) {
        expect(w).toEqual({ kind: "points", pieceId: j.sw, by: routed });
        waitedS += 1 / SIM_HZ;
        near = Math.min(near, run.router.gapTo(H));
      }
      // (Never on the points while they're set for P.)
      if (H.bogies.some((b) => b.pieceId === j.sw)) expect(run.layout.switchState(j.sw)).toBe(run.defaultOf(j.sw));
      if (wentAt < 0 && onTrunk(run, j.trunk)) wentAt = run.tick / SIM_HZ;
    }
    const r = run.run(0);
    noBreaks(r);
    // (It stood a few seconds, clear of the points. Coming onto the routed train's way, it works its single track from
    // short of the points (`comesInto`): sections hold it STAND_SHORT short of them, as they hold a line's train.)
    expect(waitedS).toBeGreaterThan(3);
    expect(near).toBeGreaterThanOrEqual(STAND_SHORT - 1);
    // (And went on, the way the points lie, once the routed one was by: down the trunk.)
    expect(wentAt).toBeGreaterThan(0);
    expect(r.arrivals[0]).toBeGreaterThanOrEqual(1);
    // (§16 Q6: the points moved for the routed train and back, never for the hand-run one.)
    expect(r.throws).toBe(2);
    expect(r.turns[1]).toEqual({ buffer: 0, "open-end": 0 });
  });

  it("a hand-run train close behind a routed one never follows it over points set for it: it goes the player's way", () => {
    const h = S.handFollower();
    const run = new HarnessRun(new Layout(), h.scenario);
    const j = h.j();
    const hand = run.engines[1];
    let onX = false;
    for (let k = 0; k < 30 * SIM_HZ; k++) {
      run.run(1 / SIM_HZ);
      const H = run.sim.findCar(hand)!.train;
      // (Never on the points while they're set for P, the routed one's road.)
      if (H.bogies.some((b) => b.pieceId === j.sw)) expect(run.layout.switchState(j.sw)).toBe(run.defaultOf(j.sw));
      if (H.bogies.some((b) => b.pieceId === j.p)) throw new Error("the hand-run train followed onto P's road");
      onX ||= H.bogies[0].pieceId === j.x;
    }
    expect(onX).toBe(true);
    noBreaks(run.run(0));
  });

  it("§16 Q5: waits as long as the train holding the points does (40 s), never turning back; said stuck while it's parked", () => {
    const h = S.handAtLock();
    const run = new HarnessRun(new Layout(), h.scenario);
    const j = h.j();
    const [routed, hand] = run.engines;
    // (The routed train stands on the points, lever off, for 40 s: they stay locked for it.)
    for (let k = 0; k < 20 * SIM_HZ && !run.sim.findCar(routed)!.train.bogies.some((b) => b.pieceId === j.sw); k++) run.step();
    run.run(1);
    run.sim.setLever(routed, 0);
    let stuck: string | null = null;
    for (let k = 0; k < 40 * SIM_HZ; k++) {
      run.step();
      stuck ??= run.stalls.stuckOf(hand)?.kind ?? null;
    }
    const H = run.sim.findCar(hand)!.train;
    expect(run.router.waitOf(hand)).toEqual({ kind: "points", pieceId: j.sw, by: routed });
    expect(H.speed).toBe(0);
    expect(stuck).toBe("parked");
    run.sim.setLever(routed, 1);
    let went = false;
    for (let k = 0; k < 20 * SIM_HZ && !went; k++) {
      run.step();
      went = onTrunk(run, j.trunk);
    }
    const r = run.run(0);
    expect(went).toBe(true);
    // (Never turned back: no turn at all for it.)
    expect(r.turns[1]).toEqual({ buffer: 0, "open-end": 0 });
    noBreaks(r);
  });

  it("no room to turn round at the end of the line: waits there, held by the train in the way (said stuck), never pushes; turns once it has room", () => {
    const h = S.noRoomToTurn();
    const run = new HarnessRun(new Layout(), h.scenario);
    const A = () => run.sim.findCar(run.engines[0])!.train;
    for (let k = 0; k < 20 * SIM_HZ && A().turnback < 0; k++) run.step();
    // (A second train put down close behind it: 29 mm between axles, so turned round it would overlap the engine.)
    const c = { ...A().bogies[A().bogies.length - 1] };
    flipCursor(run.layout, c);
    advanceCursor(run.layout, c, 29, null, { moved: 0, status: 0 });
    flipCursor(run.layout, c);
    const placed = run.sim.addTrain(["engine", "timber", "timber"], c);
    expect(placed.kind).toBe("placed");
    const b = run.sim.getTrain((placed as { trainId: number }).trainId)!;
    let turned = 0;
    run.sim.onTurnedRound(() => turned++);
    run.run(10);
    // (Still there, not turned, its engine leading and its lever as the player set it: not pushing back.)
    expect(turned).toBe(0);
    expect(A().cars[0].kind).toBe("engine");
    expect(A().cars[0].lever).toBe(1);
    expect(run.sim.heldHow(A().id)).toBe("turn");
    expect(run.sim.heldBy(A().id)).toBe(b.id);
    expect(run.stalls.stuckOf(run.engines[0])?.kind).toBe("parked");
    // (The player drives the other one away: it turns round and goes, engine first.)
    run.sim.setLever(b.cars[0].id, -1);
    run.run(6);
    // (Turned: its id is kept through a turn now, routing redesign step 3.)
    expect(turned).toBe(1);
    expect(A().cars[0].kind).toBe("engine");
    expect(A().speed).toBeGreaterThan(0);
    expect(run.stalls.stuckOf(run.engines[0])).toBeNull();
  });

  /** The shuttle line with train 0 standing (lever off) on piece `at` of it, and a hand-run train coming up behind it. */
  function behindStanding(at: (ids: number[]) => number, s: number) {
    const h = S.noRoomToTurn();
    const run = new HarnessRun(new Layout(), h.scenario);
    const ids = h.ids();
    const first = run.engines[0];
    // (Moved, as the player would, to where it stands: put down there, lever off.)
    run.sim.removeTrain(run.sim.findCar(first)!.train.id);
    const a = run.sim.addTrain(["engine", "timber", "timber"], { pieceId: at(ids), pathIndex: 0, reversed: false, s });
    const b = run.sim.addTrain(["engine", "timber", "timber"], { pieceId: ids[1], pathIndex: 0, reversed: false, s: 180 });
    if (a.kind !== "placed" || b.kind !== "placed") throw new Error("no room");
    const engine = run.sim.getTrain(b.trainId)!.cars[0].id;
    run.sim.setLever(engine, 1);
    return { run, engine, standing: run.sim.getTrain(a.trainId)!.cars[0].id };
  }

  it("the user's decision (§16 Q9): a train standing at the end of the line is the end of it: one behind pulls up, turns round there and heads back engine first", () => {
    const { run, engine } = behindStanding((ids) => ids[5], 160);
    let turned = -1;
    let pushed = 0;
    for (let k = 0; k < 30 * SIM_HZ; k++) {
      run.step();
      const t = run.sim.findCar(engine)!.train;
      if (turned < 0 && t.lastTurn) turned = run.tick / SIM_HZ;
      let net = 0;
      for (const c of t.cars) if (c.kind === "engine") net += c.lever * c.facing;
      if (t.speed > 0 && t.cars[net > 0 ? 0 : t.cars.length - 1].kind !== "engine") pushed++;
    }
    const t = run.sim.findCar(engine)!.train;
    expect(turned).toBeGreaterThan(0);
    expect(t.lastTurn!.cause).toBe("buffer");
    expect(pushed).toBe(0);
    // (On its way back down the line, or at the other end by now: not standing stuck behind it.)
    expect(run.stalls.stuckOf(engine)).toBeNull();
    noBreaks(run.run(0));
  });

  it("mid-line, behind a train standing there, it waits (said stuck, parked) and never turns back (§16 Q3)", () => {
    const { run, engine } = behindStanding((ids) => ids[3], 160);
    run.run(30);
    const t = run.sim.findCar(engine)!.train;
    expect(t.lastTurn).toBeUndefined();
    expect(t.speed).toBe(0);
    expect(run.stalls.stuckOf(engine)?.kind).toBe("parked");
  });
});

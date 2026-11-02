import { describe, expect, it } from "vitest";
import { appendPiece, connectorRef, Layout } from "../track";
import { HarnessRun, type Report, type Scenario } from "./harness";
import { planWay, WayMemory } from "./plan";
import { next, waysFrom } from "./graph";
import { racetrack, ringTwoLoops } from "./scenarios";

/**
 * Track edits with a route running (the user, 2026-11-02: "more predictable if it tries to follow the route. But we
 * probably adjust the route as rails change automatically too, so it should also try to stay predictable across those
 * kinds of changes"): a routed train keeps its way, the same road at each points, as far as the new track allows. Only a
 * leg the edit broke is planned again, and a new shortcut is taken only where a stop needs it (`WayMemory`, `planWay`).
 *
 * Each case logs the pieces the train's front comes onto (with the time), and checks which roads it ran before and after
 * the edit, the stops it came to, and every train invariant (the harness checks them every tick).
 */

const CARS = ["engine", "timber", "timber"] as const;

/** The pieces the front of train 0 came onto, in order, with the tick. */
type FrontLog = { tick: number; piece: number }[];

function logFronts(run: HarnessRun, log: FrontLog): false {
  const t = run.sim.findCar(run.engines[0])?.train;
  if (!t) return false;
  const net = t.cars.reduce((n, c) => n + (c.kind === "engine" ? c.lever * c.facing : 0), 0);
  const front = (net >= 0 ? t.bogies[0] : t.bogies[t.bogies.length - 1]).pieceId;
  if (log.length === 0 || log[log.length - 1].piece !== front) log.push({ tick: run.tick, piece: front });
  return false;
}

/** Times (s) the front came onto any of `pieces` between `from` and `to` (s). */
function onto(log: FrontLog, pieces: readonly number[], from = 0, to = Infinity): number {
  const set = new Set(pieces);
  return log.filter((e) => e.tick >= from * 120 && e.tick < to * 120 && set.has(e.piece)).length;
}

/** Every invariant held. */
function clean(r: Report): void {
  const broke = Object.entries(r.broke).filter(([, v]) => v.count > 0).map(([k, v]) => `${k}: ${v.first[0]}`);
  expect(broke).toEqual([]);
}

describe("a far edit changes nothing", () => {
  const SECONDS = 600;
  const run = (edit: boolean) => {
    const log: FrontLog = [];
    let far = -1;
    const scenario: Scenario = {
      name: `racetrack, A ⇄ B${edit ? ", a piece laid and taken up away from it" : ""}`,
      seconds: SECONDS,
      build: (layout) => {
        const r = racetrack(layout);
        return {
          trains: [{ pieceId: r.top[1], stops: [r.a, r.b], next: 1, cars: [...CARS] }],
          events: [
            { when: (h) => logFronts(h, log), do: () => {} },
            ...(edit
              ? [
                  { at: 100, do: (h: HarnessRun) => h.edit((l) => void (far = l.addPiece("straight-216", { x: 3000, z: 3000, heading: 0 }))) },
                  { at: 250, do: (h: HarnessRun) => h.edit((l) => void l.removePiece(far)) },
                ]
              : []),
          ],
        };
      },
    };
    const h = new HarnessRun(new Layout(), scenario);
    return { report: h.run(SECONDS), log };
  };
  const plain = run(false);
  const edited = run(true);
  it("the train runs exactly as without the edit (the same trajectory, piece by piece)", () => {
    expect(edited.log).toEqual(plain.log);
    expect(edited.report.trajectory).toBe(plain.report.trajectory);
    expect(edited.report.arrivals[0]).toBeGreaterThanOrEqual(20);
  });
  it("every invariant holds", () => clean(edited.report));
});

describe("a shortcut laid across the racetrack: the route keeps its way unless a stop needs the shortcut", () => {
  const SECONDS = 900;
  const LAID = 120;
  /** `then`: what else the player does once the shortcut is laid (at 400 s): a via on it, or the old way cut. */
  const run = (then: "nothing" | "via" | "cut") => {
    const log: FrontLog = [];
    let chord: number[] = [];
    let top: number[] = [];
    let far: number[] = [];
    let atB = -1;
    const scenario: Scenario = {
      name: `racetrack, A ⇄ B, a shortcut laid${then === "via" ? ", then a via point on it" : then === "cut" ? ", then the long way cut" : ""}`,
      seconds: SECONDS,
      build: (layout) => {
        const r = racetrack(layout);
        top = r.top;
        far = r.far;
        atB = r.b;
        // (Laid while the train is on its way back to A round the near end, past B, clear of X1 and X2.)
        let laid = false;
        const lay = {
          when: (h: HarnessRun) => !laid && h.tick >= LAID * 120 && onto(log.slice(-1), [r.near[2]]) === 1,
          do: (h: HarnessRun) => {
            laid = true;
            h.edit(() => void (chord = r.shortcut().chord));
          },
        };
        const after = {
          // (Once the train has gone round past B again: on its way to A round the near end.)
          when: (h: HarnessRun) => laid && h.tick >= 400 * 120 && onto(log.slice(-1), [r.near[2]]) === 1,
          do: (h: HarnessRun) => {
            done.add(h);
            if (then === "via") h.routes.get(h.engines[0])!.vias = [[chord[0]], []];
            if (then === "cut") h.edit((l) => void l.removePiece(r.top[1]));
          },
        };
        return {
          trains: [{ pieceId: r.top[0], stops: [r.a, r.b], next: 1, cars: [...CARS] }],
          events: [{ when: (h) => logFronts(h, log), do: () => {} }, lay, ...(then === "nothing" ? [] : [{ ...after, when: (h: HarnessRun) => after.when(h) && !done.has(h) }])],
        };
      },
    };
    const done = new Set<HarnessRun>();
    const h = new HarnessRun(new Layout(), scenario);
    const report = h.run(SECONDS);
    const bAt = log.filter((e) => e.piece === atB).map((e) => e.tick / 120);
    return { report, log, chord, top, far, bAt };
  };

  const kept = run("nothing");
  it("it was going the long way round before (the far end, the top)", () => {
    expect(onto(kept.log, kept.far, 0, LAID)).toBeGreaterThan(0);
  });
  it("after the shortcut is laid, it never takes it: the same way round, lap after lap", () => {
    expect(kept.chord.length).toBe(2);
    expect(onto(kept.log, kept.chord)).toBe(0);
    // (Round the far end every lap after it was laid as before: once for each time it came to B.)
    const lapsAfter = kept.bAt.filter((t) => t > LAID + 30).length;
    expect(lapsAfter).toBeGreaterThanOrEqual(8);
    expect(onto(kept.log, [kept.far[0]], LAID + 30)).toBeGreaterThanOrEqual(lapsAfter);
  });
  it("and keeps coming to its stops (20+ in 15 min)", () => expect(kept.report.arrivals[0]).toBeGreaterThanOrEqual(20));
  it("every invariant holds", () => clean(kept.report));

  const via = run("via");
  it("a via point put on the shortcut: it goes by it from then on (the stop needs it)", () => {
    expect(onto(via.log, via.chord, 0, 400)).toBe(0);
    expect(onto(via.log, [via.chord[0]], 400)).toBeGreaterThanOrEqual(5);
    // (No longer round the far end on its way to B.)
    expect(onto(via.log, [via.far[0]], 500)).toBe(0);
    expect(via.report.arrivals[0]).toBeGreaterThanOrEqual(20);
  });
  it("every invariant holds (with the via)", () => clean(via.report));

  const cut = run("cut");
  it("the long way cut: only then it takes the shortcut, and still comes to its stops", () => {
    expect(onto(cut.log, cut.chord, 0, 400)).toBe(0);
    expect(onto(cut.log, [cut.chord[0]], 400)).toBeGreaterThanOrEqual(5);
    expect(cut.report.arrivals[0]).toBeGreaterThanOrEqual(20);
  });
  it("every invariant holds (with the cut)", () => clean(cut.report));
});

describe("a ring with two loops, a leg each: a road cut re-plans only its leg", () => {
  const SECONDS = 1200;
  const log: FrontLog = [];
  let ring: ReturnType<typeof ringTwoLoops> | null = null;
  let northMain: number[] = [];
  let laidAt = -1;
  let cutAt = -1;
  let farAt = -1;
  const scenario: Scenario = {
    name: "ring with two loops, A ⇄ B: the north loop's straight road laid, a far piece, the south loop's straight road cut",
    seconds: SECONDS,
    build: (layout) => {
      const r = ringTwoLoops(layout);
      ring = r;
      // (The north loop's straight road not laid yet: A to B goes by its curved road.)
      for (const p of r.north.main) layout.removePiece(p);
      const onSouth = (h: HarnessRun) => [...r.south.main, ...r.south.side].includes(log[log.length - 1]?.piece ?? -1) && h.tick > 0;
      const onNorth = () => [...r.north.side].includes(log[log.length - 1]?.piece ?? -1);
      let step = 0;
      return {
        trains: [{ pieceId: r.b, stops: [r.a, r.b], next: 0, cars: [...CARS] }],
        events: [
          { when: (h) => logFronts(h, log), do: () => {} },
          // (Laid while the train's on the south loop, away from the north one: the straight road, shorter.)
          {
            when: (h) => step === 0 && h.tick >= 150 * 120 && onSouth(h),
            do: (h) => {
              step = 1;
              laidAt = h.tick / 120;
              h.edit((l) => void (northMain = (() => {
                const ids: number[] = [];
                let from = r.north.s1;
                let c = 1;
                for (let k = 0; k < 2; k++) {
                  const placed = appendStraight(l, from, c);
                  ids.push(placed);
                  from = placed;
                  c = 1;
                }
                return ids;
              })()));
            },
          },
          // (A piece laid off on its own, far from the ring.)
          { when: (h) => step === 1 && h.tick >= 400 * 120, do: (h) => { step = 2; farAt = h.tick / 120; h.edit((l) => void l.addPiece("straight-216", { x: 4000, z: -4000, heading: 0 })); } },
          // (Cut while the train's on the north loop: the south loop's straight road, which the way back to A takes.)
          { when: (h) => step === 2 && h.tick >= 600 * 120 && onNorth(), do: (h) => { step = 3; cutAt = h.tick / 120; h.edit((l) => void l.removePiece(r.south.main[0])); } },
        ],
      };
    },
  };
  const h = new HarnessRun(new Layout(), scenario);
  const report = h.run(SECONDS);
  const r = ring!;

  it("before: A to B by the north loop's curved road (the only one), B to A by the south loop's straight road (shorter)", () => {
    expect(laidAt).toBeGreaterThan(0);
    expect(onto(log, r.north.side, 0, laidAt)).toBeGreaterThan(0);
    expect(onto(log, r.south.main, 0, laidAt)).toBeGreaterThan(0);
    expect(onto(log, r.south.side, 0, laidAt)).toBe(0);
  });
  it("the north loop's straight road laid (shorter): A to B keeps its curved road, every lap, through the far edit and the cut", () => {
    expect(northMain.length).toBe(2);
    expect(onto(log, northMain)).toBe(0);
    expect(onto(log, [r.north.side[1]], laidAt)).toBeGreaterThanOrEqual(10);
  });
  it("the far piece changes nothing: B to A still by the south straight road till it's cut", () => {
    expect(farAt).toBeGreaterThan(0);
    expect(onto(log, r.south.main, farAt, cutAt)).toBeGreaterThan(0);
    expect(onto(log, r.south.side, 0, cutAt)).toBe(0);
  });
  it("the south straight road cut: B to A re-plans by the south loop's curved road; A to B unchanged", () => {
    expect(cutAt).toBeGreaterThan(0);
    expect(onto(log, r.south.side, cutAt)).toBeGreaterThanOrEqual(3);
    expect(onto(log, [r.north.side[1]], cutAt)).toBeGreaterThanOrEqual(3);
    expect(onto(log, northMain, cutAt)).toBe(0);
  });
  it("and keeps coming to its stops (30+ in 20 min)", () => expect(report.arrivals[0]).toBeGreaterThanOrEqual(30));
  it("every invariant holds", () => clean(report));
});

describe("planWay keeps a way still there after an edit, not only one costing nearly the best", () => {
  it("the racetrack's long way, kept with what it cost, against the shortcut laid since", () => {
    const layout = new Layout();
    const r = racetrack(layout);
    const { s1 } = r.shortcut();
    const ways = waysFrom(layout, s1, 0);
    const best = planWay(layout, s1, 0, ways, r.b);
    const long = ways.find((w) => w.option !== best)!.option;
    const longCost = { cost: 0 };
    planWay(layout, s1, 0, ways, r.b, undefined, { way: { option: long, cost: Infinity } }, longCost);
    expect(longCost.cost).toBeGreaterThan(1000);
    // (Kept with no cost known, as before: only while it costs nearly the best; the long way doesn't.)
    expect(planWay(layout, s1, 0, ways, r.b, undefined, long)).toBe(best);
    // (Kept with what it cost when taken, and it costs that still: kept.)
    expect(planWay(layout, s1, 0, ways, r.b, undefined, { way: { option: long, cost: longCost.cost } })).toBe(long);
    // (Dearer now than when taken (its way was cut and goes round): not kept.)
    expect(planWay(layout, s1, 0, ways, r.b, undefined, { way: { option: long, cost: longCost.cost - 100 } })).toBe(best);
    const m = new WayMemory();
    m.set(1, s1, 0, r.b, long, longCost.cost);
    expect(planWay(layout, s1, 0, ways, r.b, undefined, m.get(1, s1, 0, r.b))).toBe(long);
  });
  it("new points with no way kept: the option back onto the line's trail", () => {
    const layout = new Layout();
    const r = racetrack(layout);
    const m = new WayMemory();
    // (The long way's pieces, as the router's walk ran them toward B before the shortcut: X1's neighbour on.)
    const after = next(layout, r.x1, 1)!;
    m.ran(1, after.pieceId, after.entry, r.b);
    m.ran(1, r.x1, 0, r.b);
    const { s1 } = r.shortcut();
    const ways = waysFrom(layout, s1, 0);
    const best = planWay(layout, s1, 0, ways, r.b);
    const trail = planWay(layout, s1, 0, ways, r.b, undefined, m.get(1, s1, 0, r.b));
    expect(trail).not.toBe(best);
    expect(next(layout, s1, ways.find((w) => w.option === trail)!.exit)).toEqual(after);
  });
});

/** A straight laid on at `from`'s connector `c` (the player's next piece). */
function appendStraight(layout: Layout, from: number, c: number): number {
  return appendPiece(layout, "straight-216", false, connectorRef(from, c));
}

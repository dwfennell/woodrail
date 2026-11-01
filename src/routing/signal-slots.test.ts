/**
 * Signals step 3 (docs/superpowers/specs/2026-10-31-signals.md §3.2, §10.1): sections' waiting points. A signal with
 * room in front of it for the longest train, clear of points, is a one-way slot: a line's train going its way may stop
 * there, so a follower leaves as soon as the leader is past it; one going against it takes the whole stretch. Its
 * aspect follows sections' grant. On the routing harness, every invariant checked every tick.
 */
import { describe, expect, it } from "vitest";
import { SIM_HZ, type CarKind } from "../sim";
import { appendPiece, connectorRef, Layout, type PieceTypeId } from "../track";
import { chain, loopOn } from "../economy/loop-fixtures";
import { topologyOf, trainLength } from "../economy/sections";
import { HarnessRun, INVARIANTS, signal, type Report, type Scenario } from "./harness";

const S: PieceTypeId = "straight-216";
const STOP: PieceTypeId = "depot-forest";
const BUFFER: PieceTypeId = "buffer-turnback";
const CARS: CarKind[] = ["engine", "timber", "timber"];

const noBreaks = (r: Report) => INVARIANTS.forEach((k) => expect(r.broke[k].first, k).toEqual([]));

/**
 * `⊐ A ══ ══ (loop) ══ × `long` ══ (loop) ══ ══ B ⊏`, or with `loops` 1: `⊐ A ══ ══ (loop) ══ × long ══ B ⊏`. The long
 * stretch's straights are `mid`.
 */
function longLine(layout: Layout, long: number, loops: 1 | 2) {
  const [a, w1, w2] = chain(layout, [STOP, S, S]);
  appendPiece(layout, BUFFER, false, connectorRef(a, 0));
  const l1 = loopOn(layout, connectorRef(w2, 1), [S, S], [S]);
  const mid = chain(layout, Array<PieceTypeId>(long).fill(S), connectorRef(l1.s2, 0));
  let from = connectorRef(mid[mid.length - 1], 1);
  let l2: ReturnType<typeof loopOn> | null = null;
  if (loops === 2) {
    l2 = loopOn(layout, from, [S, S], [S]);
    from = connectorRef(l2.s2, 0);
  }
  const [e1, e2, b] = chain(layout, [S, S, STOP], from);
  appendPiece(layout, BUFFER, false, connectorRef(b, 1));
  return { a, b, w1, w2, l1, l2, mid, e1, e2 };
}

/** The waiting points (signal slots) of the layout's topology for these trains. */
function waitingPoints(run: HarnessRun): number {
  let len = 0;
  for (const e of run.engines) len = Math.max(len, trainLength(run.sim.findCar(e)!.train));
  return topologyOf(run.layout, len).slots.filter((s) => s.kind === "signal").length;
}

describe("signals: sections' waiting points (step 3)", { timeout: 120_000 }, () => {
  /** Two trains of one line, both heading for B, the follower on the first loop: with or without a signal mid-way. */
  let stretch: number[] = [];
  const followers = (withSignal: boolean): Scenario => ({
    name: `lineFollowers${withSignal ? "" : " (no signal)"}`,
    seconds: 1800,
    build: (layout) => {
      const l = longLine(layout, 10, 2);
      stretch = l.mid;
      // (Mid-way along the long stretch, facing B: trains from A wait there.)
      if (withSignal) signal(layout, l.mid[4], 1);
      return {
        trains: [
          { pieceId: l.mid[1], stops: [l.a, l.b], next: 1, line: 1, cars: CARS },
          { pieceId: l.l1.main[0], stops: [l.a, l.b], next: 1, line: 1, cars: CARS },
        ],
      };
    },
  });

  /** Ticks both trains ran in the long stretch at once (only a follower behind the leader can: no passing place there). */
  const together = (run: HarnessRun, seconds: number): number => {
    let n = 0;
    const on = (k: number) => {
      const t = run.sim.findCar(run.engines[k])!.train;
      return t.speed > 1 && t.bogies.some((b) => stretch.includes(b.pieceId));
    };
    for (let i = 0; i < seconds * SIM_HZ; i++) {
      run.step();
      if (on(0) && on(1)) n++;
    }
    return n;
  };

  it("lineFollowers: the follower leaves its loop while the leader is still in the stretch, and more arrive", () => {
    const run = new HarnessRun(new Layout(), followers(true));
    expect(waitingPoints(run)).toBe(1);
    const both = together(run, 1800);
    const r = run.run(0);
    noBreaks(r);
    expect(r.stalls.begun).toBe(0);
    const base = new HarnessRun(new Layout(), followers(false));
    const bothBase = together(base, 1800);
    const without = base.run(0);
    noBreaks(without);
    // (Without the signal, never both at once in the stretch: the follower waits for the whole of it.)
    expect(bothBase).toBe(0);
    expect(both).toBeGreaterThan(10 * SIM_HZ);
    const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
    if (process.env.SHOW) console.log(`lineFollowers: arrivals ${r.arrivals} with the signal (both in the stretch ${(both / SIM_HZ).toFixed(1)} s), ${without.arrivals} without`);
    expect(sum(r.arrivals)).toBeGreaterThan(sum(without.arrivals));
  });

  it("againstSignal: a train going against a waiting point takes the whole stretch and never stops at it; one the other way waits at its loop", () => {
    let sig: number[] = [];
    const scenario: Scenario = {
      name: "againstSignal",
      seconds: 600,
      build: (layout) => {
        const l = longLine(layout, 10, 2);
        signal(layout, l.mid[4], 1);
        sig = [l.mid[3], l.mid[4]];
        return {
          trains: [
            // (Heading for A from the far loop: against the signal.)
            { pieceId: l.l2!.main[1], reversed: true, stops: [l.a, l.b], next: 0, line: 1, cars: CARS },
            { pieceId: l.w1, reversed: true, stops: [l.a, l.b], next: 1, line: 1, cars: CARS },
          ],
        };
      },
    };
    const run = new HarnessRun(new Layout(), scenario);
    expect(waitingPoints(run)).toBe(1);
    let stoodAtSignalAgainst = 0;
    for (let i = 0; i < 600 * SIM_HZ; i++) {
      run.step();
      for (let k = 0; k < 2; k++) {
        const t = run.sim.findCar(run.engines[k])!.train;
        // (Going against it: toward A, its front leaving mid[3] by its end 0.)
        if (t.speed < 1 && run.sim.atRedSignal(t.id)) stoodAtSignalAgainst += t.bogies.some((b) => sig.includes(b.pieceId)) && run.sim.redSignalKeyAhead(t.id) !== -1 && t.bogies[0].reversed ? 1 : 0;
      }
    }
    const r = run.run(0);
    noBreaks(r);
    expect(stoodAtSignalAgainst).toBe(0);
    expect(r.stalls.begun).toBe(0);
    for (const t of r.turns) expect(t["open-end"]).toBe(0);
    for (const a of r.arrivals) expect(a).toBeGreaterThan(4);
  });

  it("shortWaitingPoint: a signal with too little room in front of it makes no slot; sections run as without it", () => {
    const short = (withSignal: boolean): Scenario => ({
      name: `shortWaitingPoint${withSignal ? "" : " (none)"}`,
      seconds: 900,
      build: (layout) => {
        const l = longLine(layout, 6, 2);
        // (One straight past the first loop's points: 216 mm, short of a three-car train.)
        if (withSignal) signal(layout, l.mid[0], 1);
        return {
          trains: [
            { pieceId: l.w1, reversed: true, stops: [l.a, l.b], next: 1, line: 1, cars: CARS },
            { pieceId: l.e1, stops: [l.a, l.b], next: 0, line: 1, cars: CARS },
          ],
        };
      },
    });
    const run = new HarnessRun(new Layout(), short(true));
    expect(waitingPoints(run)).toBe(0);
    const r = run.run(900);
    noBreaks(r);
    const without = new HarnessRun(new Layout(), short(false)).run(900);
    expect(r.stalls.begun).toBe(0);
    for (let k = 0; k < 2; k++) expect(Math.abs(r.arrivals[k] - without.arrivals[k])).toBeLessThanOrEqual(1);
    expect(r.held).toEqual(without.held.map((h, k) => (Math.abs(h - r.held[k]) <= 2 * SIM_HZ ? r.held[k] : h)));
  });

  it("a line end runs back to the first points: a signal on it is no waiting point (a line end holds one train)", () => {
    const run = new HarnessRun(new Layout(), {
      name: "signal in a line end",
      seconds: 1,
      build: (layout) => {
        const l = longLine(layout, 10, 1);
        signal(layout, l.mid[4], 1);
        return { trains: [{ pieceId: l.mid[1], stops: [l.a, l.b], line: 1, cars: CARS }, { pieceId: l.w1, stops: [l.a, l.b], line: 1, cars: CARS }] };
      },
    });
    expect(waitingPoints(run)).toBe(0);
  });

  it("convoyToLineEnd: a follower doesn't stop at a waiting point while the train ahead heads for the line end it'll come back from", () => {
    const scenario: Scenario = {
      name: "convoyToLineEnd",
      seconds: 900,
      build: (layout) => {
        // ⊐ A ══ ══ (loop) ══ × 10 ══ points ══ ══ B ⊏, the points' other road a siding ══ C ⊏.
        const [a, w1, w2] = chain(layout, [STOP, S, S]);
        appendPiece(layout, BUFFER, false, connectorRef(a, 0));
        const l1 = loopOn(layout, connectorRef(w2, 1), [S, S], [S]);
        const mid = chain(layout, Array<PieceTypeId>(10).fill(S), connectorRef(l1.s2, 0));
        const sw = appendPiece(layout, "switch", false, connectorRef(mid[9], 1));
        const [, , b] = chain(layout, [S, S, STOP], connectorRef(sw, 1));
        appendPiece(layout, BUFFER, false, connectorRef(b, 1));
        const side = chain(layout, ["curve-large", S, STOP], connectorRef(sw, 2), [true]);
        appendPiece(layout, BUFFER, false, connectorRef(side[2], 1));
        signal(layout, mid[4], 1);
        void w1;
        return {
          trains: [
            { pieceId: mid[1], stops: [a, b], next: 1, line: 1, cars: CARS },
            { pieceId: l1.main[0], stops: [a, b], next: 1, line: 1, cars: CARS },
          ],
        };
      },
    };
    const run = new HarnessRun(new Layout(), scenario);
    expect(waitingPoints(run)).toBe(1);
    const r = run.run(900);
    noBreaks(r);
    expect(r.stalls.begun).toBe(0);
    for (const a of r.arrivals) expect(a).toBeGreaterThan(4);
  });

  it("no signals: the topology has no waiting points", () => {
    const run = new HarnessRun(new Layout(), followers(false));
    expect(waitingPoints(run)).toBe(0);
  });
});

/**
 * Signals the player places on joints (docs/superpowers/specs/2026-10-31-signals.md §10.1), on the routing harness.
 * Step 1: marks in the data, read by the sim's block working (blocks as before: ending at points), with the `redRun`
 * and `blockOne` invariants checked every tick.
 */
import { describe, expect, it } from "vitest";
import { CAR_SPECS, SIM_HZ, type CarKind } from "../sim";
import { connectorRef, getPieceDef, Layout, pathLength, pieceOfRef } from "../track";
import { chain } from "../economy/loop-fixtures";
import { HarnessRun, INVARIANTS, signal, type Report, type Scenario } from "./harness";
import { junction, oval, shuttleLine } from "./scenarios";

/** `legacyPiece`'s trajectory on step 1 (blocks ending at points, as before step 2). */
const LEGACY_OVAL_HASH = "94e009e0";

const noBreaks = (r: Report) => INVARIANTS.forEach((k) => expect(r.broke[k].first, k).toEqual([]));

/** How far (mm) a train's nose stands short of the end of the piece its front axle is on. */
function noseShort(run: HarnessRun, k: number): number {
  const t = run.sim.findCar(run.engines[k])!.train;
  const b = t.bogies[0];
  const p = run.layout.getPiece(b.pieceId)!;
  return pathLength(getPieceDef(p.type, p.flipped).paths[b.pathIndex].geom) - b.s - CAR_SPECS[t.cars[0].kind].bogieInset;
}

describe("signal marks: block working (step 1)", { timeout: 60_000 }, () => {
  it("an oval, two hand-run trains, three marks: they keep a block apart and never run a red", () => {
    let marks: number[] = [];
    const scenario: Scenario = {
      name: "oval, 2 trains, 3 marks",
      seconds: 300,
      build: (layout) => {
        const o = oval(layout);
        marks = [signal(layout, o.ids[2], 1), signal(layout, o.ids[6], 1), signal(layout, o.ids[10], 1)];
        return { trains: [{ pieceId: o.ids[1] }, { pieceId: o.ids[8] }] };
      },
    };
    const run = new HarnessRun(new Layout(), scenario);
    const r = run.run(scenario.seconds);
    noBreaks(r);
    expect(marks).toHaveLength(3);
    // They ran round, through the signals, many times.
    expect(r.signalPasses).toBeGreaterThan(20);
    expect(r.redLate).toBe(0);
  });

  it("a mark held at red: the train stands with its nose just short of the joint, and goes once let go", () => {
    let mark = -1;
    let ids: number[] = [];
    const scenario: Scenario = {
      name: "held mark",
      seconds: 20,
      build: (layout) => {
        ids = shuttleLine(layout, 6);
        mark = signal(layout, ids[4], 1, { held: true });
        return { trains: [{ pieceId: ids[1] }] };
      },
    };
    const run = new HarnessRun(new Layout(), scenario);
    run.run(20);
    const t = run.sim.findCar(run.engines[0])!.train;
    expect(t.speed).toBe(0);
    expect(t.bogies[0].pieceId).toBe(ids[4]);
    expect(noseShort(run, 0)).toBeGreaterThan(5);
    expect(noseShort(run, 0)).toBeLessThan(8);
    expect(run.sim.atRedSignal(t.id)).toBe(true);
    expect(run.sim.redSignalAhead(t.id)).toBe(ids[4]);
    run.holdSignal(mark, false);
    const r = run.run(4);
    expect(run.sim.findCar(run.engines[0])!.train.bogies[0].pieceId).not.toBe(ids[4]);
    noBreaks(r);
    expect(r.signalPasses).toBe(1);
  });

  it("a mark guards one way only: turned round, the train passes it at red", () => {
    let ids: number[] = [];
    const scenario: Scenario = {
      name: "turned mark",
      seconds: 10,
      build: (layout) => {
        ids = shuttleLine(layout, 6);
        const m = signal(layout, ids[4], 1, { held: true });
        layout.turnSignal(m);
        return { trains: [{ pieceId: ids[1] }] };
      },
    };
    const run = new HarnessRun(new Layout(), scenario);
    const r = run.run(10);
    expect(run.sim.findCar(run.engines[0])!.train.bogies[0].pieceId).not.toBe(ids[4]);
    noBreaks(r);
  });

  it("held when the train is past braking for it: a late pass (counted), not a red run", () => {
    let mark = -1;
    let ids: number[] = [];
    const scenario: Scenario = {
      name: "late hold",
      seconds: 20,
      build: (layout) => {
        ids = shuttleLine(layout, 6);
        mark = signal(layout, ids[4], 1);
        return {
          trains: [{ pieceId: ids[1] }],
          // (Its nose within a couple of mm of the joint: too late to stand short.)
          events: [{ when: (run) => run.sim.findCar(run.engines[0])!.train.bogies[0].pieceId === ids[4] && noseShort(run, 0) < 2, do: (run) => run.holdSignal(mark, true) }],
        };
      },
    };
    const r = new HarnessRun(new Layout(), scenario).run(20);
    noBreaks(r);
    expect(r.redLate).toBe(1);
  });

  it("Always green: shown clear whatever is on its block, two trains share it, and they still keep their distance", () => {
    let marks: number[] = [];
    const scenario: Scenario = {
      name: "oval, 2 trains, 3 marks, one Always green",
      seconds: 0,
      // (Both stand for a while behind the one held Always red, as the player asked: not a deadlock.)
      maxStill: 200,
      build: (layout) => {
        const o = oval(layout);
        // (The next one Always red, so a train stands on the green one's block: the other comes up behind it.)
        marks = [signal(layout, o.ids[2], 1, { mode: "green" }), signal(layout, o.ids[6], 1, { mode: "red" }), signal(layout, o.ids[10], 1)];
        return { trains: [{ pieceId: o.ids[1] }, { pieceId: o.ids[8] }] };
      },
    };
    const run = new HarnessRun(new Layout(), scenario);
    expect(run.layout.getSignal(marks[0])).toMatchObject({ mode: "green", forced: true, held: false });
    const key = run.sim.signalList().find((g) => g.forced)!.key;
    const block = new Set(run.sim.signalBlock(key));
    let shared = 0;
    let red = 0;
    let reports: Report[] = [];
    for (let s = 0; s < 120; s++) {
      reports.push(run.run(1));
      if (!run.sim.markClear(marks[0])) red++;
      const inBlock = run.engines.filter((e) => run.sim.findCar(e)!.train.bogies.some((b) => block.has(b.pieceId)));
      if (inBlock.length === 2) shared++;
    }
    expect(red).toBe(0);
    // (Two trains on its block at once: what Auto never lets happen. The second stood behind the first, short of it.)
    expect(shared).toBeGreaterThan(10);
    const [a, b] = run.engines.map((e) => run.sim.findCar(e)!.train);
    expect(a.speed + b.speed).toBe(0);
    run.sim.setMarkMode(marks[1], "auto");
    // No derailment, no train run into another (`underTrain`), no red run at the other marks; `blockOne` excuses it.
    for (const r of reports) noBreaks(r);
    for (const e of run.engines) expect(run.sim.findCar(e)!.train.derailed).toBe(false);
    // Back to Auto: red again while a train is on its block, and only one comes in at a time.
    run.sim.setMarkMode(marks[0], "auto");
    reports = [];
    for (let s = 0; s < 120; s++) reports.push(run.run(1));
    for (const r of reports) noBreaks(r);
    // Always red (as a tap's hold): the first train to reach it stands there.
    run.sim.setMarkMode(marks[0], "red");
    expect(run.layout.getSignal(marks[0])!.held).toBe(true);
    expect(run.sim.markClear(marks[0])).toBe(false);
  });

  it("the block ends at a mark facing either way, and at points (as an old signal piece's)", () => {
    const layout = new Layout();
    const ids = shuttleLine(layout, 6);
    const run = new HarnessRun(layout, { name: "blocks", seconds: 0, build: () => ({ trains: [] }) });
    const a = signal(layout, ids[1], 1);
    const b = signal(layout, ids[4], 0);
    const key = (id: number) => run.sim.signalList().find((g) => g.pieceId === pieceOfRef(layout.getSignal(id)!.at))!.key;
    expect(run.sim.signalBlock(key(a))).toEqual([ids[2], ids[3]]);
    // (b faces back: its block runs back from ids[4] over ids[3] … to a's joint, which ends it.)
    expect(run.sim.signalBlock(key(b))).toEqual([ids[3], ids[2]]);
  });
});

// ── Step 2: blocks through points (path signals), aspects on events ─────────────────────────────────────────────────

const CARS: CarKind[] = ["engine", "timber", "timber"];

/** An oval with three routed trains, each a line of its own, and signals at `at` (oval pieces, connector 1). */
function ovalConvoy(at: number[]): Scenario {
  return {
    name: `ovalConvoy, ${at.length} signals`,
    seconds: 600,
    build: (layout) => {
      const o = oval(layout);
      for (const p of at) signal(layout, o.ids[p], 1);
      const stops = [o.a, o.b];
      return { trains: [{ pieceId: o.ids[1], stops, cars: CARS }, { pieceId: o.ids[5], stops, s: 50, cars: CARS }, { pieceId: o.ids[9], stops, cars: CARS }] };
    },
  };
}

/** The legacy-piece oval: a `signal` piece (and a straight-72 to close it) where a straight was, two marks, two hand-run trains. */
const legacyOval: Scenario = {
  name: "legacyPiece",
  seconds: 600,
  build: (layout) => {
    const ids = chain(layout, ["depot-forest", "straight-216", "signal", "straight-72", "curve-large", "curve-large", "curve-large", "curve-large", "depot-forest", "straight-216", "straight-216", "curve-large", "curve-large", "curve-large", "curve-large"]);
    if (layout.joinedConnector(connectorRef(ids[0], 0)) === -1) throw new Error("the oval doesn't close");
    signal(layout, ids[7], 1);
    signal(layout, ids[11], 1);
    return { trains: [{ pieceId: ids[1], cars: CARS, s: 200 }, { pieceId: ids[9], cars: CARS }] };
  },
};

describe("signals: blocks through points, aspects on events (step 2)", { timeout: 60_000 }, () => {
  it("ovalConvoy: 3 trains, 4 signals on an oval: gaps kept, all deliver", () => {
    const r = new HarnessRun(new Layout(), ovalConvoy([2, 6, 9, 13])).run(600);
    noBreaks(r);
    for (const a of r.arrivals) expect(a).toBeGreaterThan(20);
    expect(r.stalls.begun).toBe(0);
    expect(r.signalPasses).toBeGreaterThan(100);
  });

  it("ovalConvoy: with 3 signals, stuck (a ring of signals, said after STUCK_S), and nobody turns", () => {
    const r = new HarnessRun(new Layout(), ovalConvoy([2, 6, 9])).run(120);
    noBreaks(r);
    expect(r.stalls.begun).toBeGreaterThan(0);
    expect(r.stalls.why).toEqual(["signals", "signals", "signals"]);
    for (const s of r.stalls.stuck) expect(s).toBeGreaterThan(100 * SIM_HZ);
    for (const t of r.turns) expect(t).toEqual({ buffer: 0, "open-end": 0 });
  });

  it("pathAtJunction: a routed train stands at a signal 216 mm before points another holds; red then, green once its locks are granted", () => {
    let mark = -1;
    let j!: ReturnType<typeof junction>;
    const scenario: Scenario = {
      name: "pathAtJunction",
      seconds: 40,
      ownLines: true,
      build: (layout) => {
        j = junction(layout, "switch", 0, [1, 2], 4);
        mark = signal(layout, j.t2, 1);
        const t3 = j.trunk[j.trunk.length - 3];
        return { trains: [{ pieceId: j.t1, stops: [j.x, j.y], cars: CARS, s: 150 }, { pieceId: t3, stops: [j.p, j.y], cars: CARS, s: 120 }] };
      },
    };
    const run = new HarnessRun(new Layout(), scenario);
    const key = -1 - mark;
    let stoodRed = false;
    let nose = Infinity;
    let greenFor = false;
    for (let i = 0; i < 30 * SIM_HZ; i++) {
      run.step();
      const t = run.sim.findCar(run.engines[1])!.train;
      const clear = run.sim.markClear(mark);
      if (t.speed === 0 && t.bogies[0].pieceId === j.t2) {
        stoodRed ||= !clear && run.sim.redSignalKeyAhead(t.id) === key && run.router.holders(j.sw) > 0 && !run.router.holdersOf(j.sw).has(run.engines[1]);
        nose = Math.min(nose, noseShort(run, 1));
      }
      if (clear && run.router.holdersOf(j.sw).has(run.engines[1])) greenFor = true;
    }
    const r = run.run(10);
    noBreaks(r);
    expect(stoodRed).toBe(true);
    expect(nose).toBeGreaterThan(5);
    expect(nose).toBeLessThan(8);
    expect(greenFor).toBe(true);
    expect(r.arrivals[1]).toBeGreaterThan(0);
  });

  it("heldByHand: held 40 s, the train waits all of it with no stall; let go, it goes", () => {
    let mark = -1;
    const scenario: Scenario = {
      name: "heldByHand",
      seconds: 120,
      build: (layout) => {
        const o = oval(layout);
        mark = signal(layout, o.ids[2], 1, { held: true });
        signal(layout, o.ids[6], 1);
        signal(layout, o.ids[9], 1);
        const stops = [o.a, o.b];
        return {
          trains: [{ pieceId: o.ids[1], stops, cars: CARS }, { pieceId: o.ids[8], stops, cars: CARS }],
          events: [{ at: 40, do: (run) => run.holdSignal(mark, false) }],
        };
      },
    };
    const run = new HarnessRun(new Layout(), scenario);
    let r = run.run(39);
    const t = run.sim.findCar(run.engines[0])!.train;
    expect(t.speed).toBe(0);
    expect(run.sim.atRedSignal(t.id)).toBe(true);
    expect(run.sim.heldBy(t.id)).toBe(null);
    expect(r.stalls.begun).toBe(0);
    const before = r.arrivals[0];
    r = run.run(81);
    noBreaks(r);
    expect(r.stalls.begun).toBe(0);
    expect(r.arrivals[0]).toBeGreaterThan(before);
  });

  it("legacyPiece: an old signal piece on plain track holds trains as before (the same trajectory as at step 1)", () => {
    const r = new HarnessRun(new Layout(), legacyOval).run(600);
    noBreaks(r);
    expect(r.signalPasses).toBeGreaterThan(50);
    expect(r.trajectory).toBe(LEGACY_OVAL_HASH);
  });
});

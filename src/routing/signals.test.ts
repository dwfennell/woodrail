/**
 * Signals the player places on joints (docs/superpowers/specs/2026-10-31-signals.md §10.1), on the routing harness.
 * Step 1: marks in the data, read by the sim's block working (blocks as before: ending at points), with the `redRun`
 * and `blockOne` invariants checked every tick.
 */
import { describe, expect, it } from "vitest";
import { CAR_SPECS } from "../sim";
import { getPieceDef, Layout, pathLength, pieceOfRef } from "../track";
import { HarnessRun, INVARIANTS, signal, type Report, type Scenario } from "./harness";
import { oval, shuttleLine } from "./scenarios";

const noBreaks = (r: Report) => INVARIANTS.forEach((k) => expect(r.broke[k].first, k).toEqual([]));

/** How far (mm) a train's nose stands short of the end of the piece its front axle is on. */
function noseShort(run: HarnessRun, k: number): number {
  const t = run.sim.findCar(run.engines[k])!.train;
  const b = t.bogies[0];
  const p = run.layout.getPiece(b.pieceId)!;
  return pathLength(getPieceDef(p.type, p.flipped).paths[b.pathIndex].geom) - b.s - CAR_SPECS[t.cars[0].kind].bogieInset;
}

describe("signal marks: block working (step 1)", () => {
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

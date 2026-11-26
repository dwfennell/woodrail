/**
 * A train gone from the dispatcher's care (the user, 2026-11-26: "I removed the train from the pink line entirely
 * though!"): taken off the track, off its line, derailed, split, turned: nothing it held stays held. Two trains of one
 * line on a line with one passing loop, the dispatcher on; one granted and the other waiting on it, the first is dealt
 * with, and the dispatcher holds nothing for it within a look (and the other goes on delivering where it can).
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Layout } from "../track";
import { HarnessRun } from "./harness";
import { allCases, scenarioOf } from "./cases/cases";

describe("the dispatcher lets go of a train that's gone", { timeout: 120_000 }, () => {
  let was = false;
  beforeEach(() => {
    was = HarnessRun.dispatch;
    HarnessRun.dispatch = true;
  });
  afterEach(() => {
    HarnessRun.dispatch = was;
  });

  /** The run, at a moment one train (`a`) holds a grant ahead and the other (`b`) waits on it. */
  const met = () => {
    const scenario = scenarioOf(allCases().find((c) => c.id === "line1 2×one opposed")!).scenario;
    const run = new HarnessRun(new Layout(), scenario);
    const d = run.dispatcher!;
    for (let s = 0; s < 120; s++) {
      run.run(0.5);
      for (const [i, b] of run.engines.entries()) {
        const a = run.engines[1 - i];
        if (d.waitingOn(b)?.engine === a && d.grantedWay(a)) return { run, d, a, b };
      }
    }
    throw new Error("no wait on a granted train");
  };
  const trainOf = (run: HarnessRun, engine: number) => run.sim.findCar(engine)!.train;
  const delivered = (run: HarnessRun, engine: number) => run.run(0).arrivals[run.engines.indexOf(engine)];

  it("taken off the track: its grant goes, and the other delivers", () => {
    const { run, d, a, b } = met();
    run.sim.removeTrain(trainOf(run, a).id);
    run.routes.delete(a);
    run.run(1);
    expect(d.grantedWay(a)).toBeNull();
    expect(d.waitingOn(b)?.engine).not.toBe(a);
    const before = delivered(run, b);
    run.run(120);
    expect(delivered(run, b)).toBeGreaterThan(before);
  });

  it("taken off its line (no route, its lever on): its grant goes at once", () => {
    const { run, d, a } = met();
    run.routes.delete(a);
    run.run(1);
    expect(d.grantedWay(a)).toBeNull();
    expect(run.run(5).broke.staleHold.count).toBe(0);
  });

  it("derailed: its grant goes", () => {
    const { run, d, a } = met();
    trainOf(run, a).derailed = true;
    run.run(1);
    expect(d.grantedWay(a)).toBeNull();
  });

  it("its wagons decoupled: the engine's grant is built again, the wagons' train holds nothing", () => {
    const { run, d, a, b } = met();
    const t = trainOf(run, a);
    const wagon = t.cars.find((c) => c.kind !== "engine");
    if (wagon) run.sim.decouple(wagon.id);
    run.run(1);
    for (const o of run.sim.trains()) if (!o.cars.some((c) => c.kind === "engine")) expect(d.holds(o)).toBe(false);
    run.run(120);
    expect(delivered(run, b)).toBeGreaterThan(0);
  });
});

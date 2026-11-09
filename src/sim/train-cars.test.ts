import { describe, expect, it } from "vitest";
import { appendPiece, connectorRef, Layout } from "../track";
import { CAR_SPECS, COUPLER_GAP, type CarKind } from "./cars";
import { Sim, type Train } from "./sim";
import { driveOf, engineOf, hasEngine, trainLength } from "./train-cars";

// The one copy of each of these (sim, sections, router and economy all ask them), tested on its own: before, none was,
// and a mutation run found every change to them passed (docs/agents/audit-2026-11-09.md §7).

/** A train of these cars on a long straight line, standing. */
function trainOf(kinds: CarKind[]): { sim: Sim; t: Train } {
  const layout = new Layout();
  let id = layout.addPiece("straight-216", { x: 0, z: 0, heading: 0 });
  for (let i = 0; i < 6; i++) id = appendPiece(layout, "straight-216", false, connectorRef(id, 1));
  const sim = new Sim(layout);
  const r = sim.addTrain(kinds, { pieceId: id, pathIndex: 0, reversed: false, s: 200 });
  if (r.kind !== "placed") throw new Error(`not placed: ${r.kind}`);
  return { sim, t: sim.getTrain(r.trainId)! };
}

describe("train cars", () => {
  it("driveOf: the engines' levers, each as it faces; 0 with no engine or levers that cancel", () => {
    const one = trainOf(["engine", "timber"]);
    const engine = one.t.cars[0].id;
    expect(driveOf(one.t)).toBe(0);
    one.sim.setLever(engine, 1);
    expect(driveOf(one.t)).toBe(1);
    one.sim.setLever(engine, -1);
    expect(driveOf(one.t)).toBe(-1);
    one.sim.flipCar(engine);
    expect(one.t.cars.find((c) => c.id === engine)!.facing).toBe(-1);
    expect(driveOf(one.t), "lever back, engine turned round: it drives to the front").toBe(1);

    const two = trainOf(["engine", "timber", "engine"]);
    const [a, , b] = two.t.cars.map((c) => c.id);
    two.sim.setLever(a, 1);
    two.sim.setLever(b, 1);
    expect(driveOf(two.t)).toBe(2);
    two.sim.setLever(b, -1);
    expect(driveOf(two.t), "two engines pulling against each other").toBe(0);

    expect(driveOf(trainOf(["timber", "timber"]).t)).toBe(0);
  });

  it("trainLength: its cars end to end, and a coupling between each two", () => {
    expect(trainLength(trainOf(["engine"]).t)).toBe(CAR_SPECS.engine.length);
    expect(trainLength(trainOf(["engine", "timber", "hopper"]).t)).toBe(CAR_SPECS.engine.length + CAR_SPECS.timber.length + CAR_SPECS.hopper.length + 2 * COUPLER_GAP);
  });

  it("engineOf: its first engine wherever it stands in the train, else its first car", () => {
    const { t } = trainOf(["timber", "engine", "engine"]);
    expect(engineOf(t)).toBe(t.cars[1].id);
    const none = trainOf(["hopper", "timber"]).t;
    expect(engineOf(none)).toBe(none.cars[0].id);
  });

  it("hasEngine: any car an engine", () => {
    expect(hasEngine(trainOf(["timber", "engine"]).t)).toBe(true);
    expect(hasEngine(trainOf(["timber", "hopper"]).t)).toBe(false);
  });
});

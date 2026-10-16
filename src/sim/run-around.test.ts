import { describe, expect, it } from "vitest";
import { appendPiece, connectorRef, Layout, type PieceTypeId } from "../track";
import type { CarKind } from "./cars";
import { Sim, SIM_DT } from "./sim";

function chain(types: PieceTypeId[]): { layout: Layout; ids: number[] } {
  const layout = new Layout();
  const ids = [layout.addPiece(types[0], { x: 0, z: 0, heading: 0 }, 0, false)];
  for (let i = 1; i < types.length; i++) ids.push(appendPiece(layout, types[i], false, connectorRef(ids[i - 1], 1)));
  return { layout, ids };
}

const line = () => chain(["straight-216", "straight-216", "straight-216", "straight-216", "straight-216", "straight-216"]);

/** A train of these cars, its front at `s` on piece `at` of the line, heading toward connector 1 (+x). */
function trainOn(sim: Sim, pieceId: number, s: number, kinds: CarKind[]) {
  const r = sim.addTrain(kinds, { pieceId, pathIndex: 0, reversed: false, s });
  if (r.kind !== "placed") throw new Error(r.kind);
  return sim.getTrain(r.trainId)!;
}

/** Where each car's middle is (x), by car id. */
const middles = (sim: Sim, trainId: number) => {
  const t = sim.getTrain(trainId)!;
  return new Map(t.cars.map((c, i) => [c.id, Math.round((t.world[2 * i].x + t.world[2 * i + 1].x) / 2)]));
};

describe("swap ends: the engine runs round its train", () => {
  it("the engine goes to the other end and faces out; the wagons stay just where they were, in order", () => {
    const { layout, ids } = line();
    const sim = new Sim(layout);
    const t = trainOn(sim, ids[3], 150, ["engine", "hopper", "timber"]);
    const [engine, a, b] = t.cars.map((c) => c.id);
    const before = middles(sim, t.id);
    expect(sim.runAround(engine)).toBe("ran-round");
    const after = middles(sim, t.id);
    expect(sim.getTrain(t.id)!.cars.map((c) => c.id)).toEqual([a, b, engine]);
    expect(after.get(a)).toBe(before.get(a));
    expect(after.get(b)).toBe(before.get(b));
    // The engine now behind the last wagon, its own front pointing away from the train (toward −x).
    expect(after.get(engine)!).toBeLessThan(after.get(b)!);
    expect(sim.getTrain(t.id)!.cars[2].facing).toBe(-1);
    // Go: it leads the train the other way.
    sim.setLever(engine, 1);
    for (let k = 0; k < 120; k++) sim.tick();
    const moved = middles(sim, t.id);
    expect(moved.get(engine)!).toBeLessThan(after.get(engine)!);
    expect(moved.get(a)!).toBeLessThan(after.get(a)!);
  });

  it("and back again: a second swap puts it at the front, facing the first way", () => {
    const { layout, ids } = line();
    const sim = new Sim(layout);
    const t = trainOn(sim, ids[3], 150, ["engine", "hopper", "timber"]);
    const [engine, a, b] = t.cars.map((c) => c.id);
    const before = middles(sim, t.id);
    sim.runAround(engine);
    expect(sim.runAround(engine)).toBe("ran-round");
    expect(sim.getTrain(t.id)!.cars.map((c) => c.id)).toEqual([engine, a, b]);
    expect(sim.getTrain(t.id)!.cars[0].facing).toBe(1);
    const back = middles(sim, t.id);
    for (const id of [engine, a, b]) expect(Math.abs(back.get(id)! - before.get(id)!)).toBeLessThanOrEqual(1);
  });

  it("only while stopped", () => {
    const { layout, ids } = line();
    const sim = new Sim(layout);
    const t = trainOn(sim, ids[2], 150, ["engine", "hopper"]);
    sim.setLever(t.cars[0].id, 1);
    for (let k = 0; k < 30; k++) sim.tick();
    expect(sim.runAround(t.cars[0].id)).toBe("moving");
  });

  it("an engine on its own turns even while moving (as it always could)", () => {
    const { layout, ids } = line();
    const sim = new Sim(layout);
    const solo = trainOn(sim, ids[2], 150, ["engine"]);
    sim.setLever(solo.cars[0].id, 1);
    for (let k = 0; k < 30; k++) sim.tick();
    expect(sim.getTrain(solo.id)!.speed).toBeGreaterThan(0);
    expect(sim.runAround(solo.cars[0].id)).toBe("turned");
  });

  it("an engine on its own, or a train with an engine at each end, just turns", () => {
    const { layout, ids } = line();
    const sim = new Sim(layout);
    const solo = trainOn(sim, ids[1], 150, ["engine"]);
    expect(sim.runAround(solo.cars[0].id)).toBe("turned");
    expect(sim.getTrain(solo.id)!.cars[0].facing).toBe(-1);
    const both = trainOn(sim, ids[4], 200, ["engine", "hopper", "engine"]);
    const order = both.cars.map((c) => c.id);
    expect(sim.runAround(order[0])).toBe("turned");
    expect(sim.getTrain(both.id)!.cars.map((c) => c.id)).toEqual(order);
  });

  it("no room for the engine at the other end (the track ends there): refused, the train untouched", () => {
    const { layout, ids } = line();
    const sim = new Sim(layout);
    // The last wagon's rear axle close to the start of the line.
    const t = trainOn(sim, ids[0], 200, ["engine", "hopper"]);
    const before = middles(sim, t.id);
    expect(sim.runAround(t.cars[0].id)).toBe("no-room");
    expect(middles(sim, t.id)).toEqual(before);
    expect(sim.getTrain(t.id)!.cars[0].kind).toBe("engine");
  });

  it("keeps the train's id (a depot working it carries on) and its cars' ids (their loads)", () => {
    const { layout, ids } = line();
    const sim = new Sim(layout);
    const t = trainOn(sim, ids[3], 150, ["engine", "timber"]);
    const carIds = t.cars.map((c) => c.id);
    sim.runAround(carIds[0]);
    expect(sim.getTrain(t.id)).toBeDefined();
    expect(new Set(sim.getTrain(t.id)!.cars.map((c) => c.id))).toEqual(new Set(carIds));
    void SIM_DT;
  });
});

import { describe, expect, it } from "vitest";
import { Layout } from "../track";
import { Sim, SIM_HZ, TURNBACK_TICKS, type Train } from "./sim";

/** Two straights and a buffer along +x; an engine pulling a timber wagon toward the buffer. */
function line(end: "buffer" | "buffer-turnback") {
  const layout = new Layout();
  const a = layout.addPiece("straight-216", { x: 0, z: 0, heading: 0 });
  layout.addPiece("straight-216", { x: 216, z: 0, heading: 0 });
  layout.addPiece(end, { x: 432, z: 0, heading: 0 });
  const sim = new Sim(layout);
  const placed = sim.addTrain(["engine", "timber"], { pieceId: a, pathIndex: 0, reversed: false, s: 200 });
  if (placed.kind !== "placed") throw new Error("no room");
  const train = sim.getTrain(placed.trainId)!;
  sim.setLever(train.cars[0].id, 1);
  return { sim, train, engineId: train.cars[0].id, wagonId: train.cars[1].id };
}

/** The (only) train now, and the x of a car's middle. */
const only = (sim: Sim): Train => sim.getTrain(sim.trainIds()[0])!;
const carX = (t: Train, carId: number) => {
  const i = t.cars.findIndex((c) => c.id === carId);
  return (t.world[2 * i].x + t.world[2 * i + 1].x) / 2;
};

describe("turnback buffer", () => {
  it("a train resting on it waits two seconds, then is turned round and drives back out, engine leading", () => {
    const { sim, train, engineId, wagonId } = line("buffer-turnback");
    let arrived = -1;
    let turnedAt = -1;
    for (let i = 0; i < 20 * SIM_HZ && turnedAt === -1; i++) {
      sim.tick();
      if (arrived === -1 && train.turnback > 0) arrived = i;
      if (sim.drainEvents().some((e) => e.kind === "turned")) turnedAt = i;
    }
    expect(arrived).not.toBe(-1);
    expect(turnedAt - arrived).toBeGreaterThanOrEqual(TURNBACK_TICKS - 2);
    expect(turnedAt - arrived).toBeLessThanOrEqual(TURNBACK_TICKS + 2);
    // Turned end for end: the engine is now the car furthest from the buffer, still leading, lever unchanged.
    const t = only(sim);
    expect(t.cars.map((c) => c.id)).toEqual([engineId, wagonId]);
    expect(t.cars[0].lever).toBe(1);
    expect(carX(t, engineId)).toBeLessThan(carX(t, wagonId));
    const x0 = carX(t, engineId);
    for (let i = 0; i < 3 * SIM_HZ; i++) sim.tick();
    // Heading away from the buffer, engine first.
    expect(carX(only(sim), engineId)).toBeLessThan(x0 - 100);
    expect(carX(only(sim), engineId)).toBeLessThan(carX(only(sim), wagonId));
  });

  it("the turned train's axles span the same stretch of track", () => {
    const { sim, train } = line("buffer-turnback");
    const span = (t: Train) => [Math.min(...t.world.map((w) => w.x)), Math.max(...t.world.map((w) => w.x))];
    let before: number[] = [];
    for (let i = 0; i < 20 * SIM_HZ; i++) {
      if (train.turnback === 1) before = span(train);
      sim.tick();
      if (sim.drainEvents().some((e) => e.kind === "turned")) break;
    }
    const after = span(only(sim));
    expect(Math.abs(after[0] - before[0])).toBeLessThan(0.2);
    expect(Math.abs(after[1] - before[1])).toBeLessThan(0.2);
  });

  it("an ordinary buffer just stops the train", () => {
    const { sim, train } = line("buffer");
    for (let i = 0; i < 20 * SIM_HZ; i++) sim.tick();
    expect(train.speed).toBe(0);
    expect(train.cars[0].lever).toBe(1);
  });

  it("a lever change during the wait cancels the turnback", () => {
    const { sim, train, engineId } = line("buffer-turnback");
    let i = 0;
    while (train.turnback < 0 && i++ < 20 * SIM_HZ) sim.tick();
    expect(train.turnback).toBeGreaterThan(0);
    for (let k = 0; k < SIM_HZ / 2; k++) sim.tick();
    sim.setLever(engineId, -1);
    let turned = false;
    for (let k = 0; k < 3 * SIM_HZ; k++) {
      sim.tick();
      if (sim.drainEvents().some((e) => e.kind === "turned")) turned = true;
    }
    expect(turned).toBe(false);
    const engine = only(sim).cars.find((c) => c.id === engineId)!;
    expect(engine.lever).toBe(-1);
    expect(Math.max(...only(sim).world.map((w) => w.x))).toBeLessThan(330);
  });
});

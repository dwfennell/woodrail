import { describe, expect, it } from "vitest";
import { Economy } from "../economy";
import { Sim, SIM_DT } from "../sim";
import { appendPiece, connectorRef, Layout, type PieceTypeId } from "../track";
import { engineStatus, trainState, trainsForReport } from "./engine-status";

function chain(types: PieceTypeId[]): { layout: Layout; ids: number[] } {
  const layout = new Layout();
  const ids = [layout.addPiece(types[0], { x: 0, z: 0, heading: 0 }, 0, false)];
  for (let i = 1; i < types.length; i++) ids.push(appendPiece(layout, types[i], false, connectorRef(ids[i - 1], 1)));
  return { layout, ids };
}

const run = (sim: Sim, seconds: number) => {
  for (let i = Math.round(seconds / SIM_DT); i > 0; i--) sim.tick();
};

describe("the engine card's status line", () => {
  it("says what the train's doing: stopped, running, at a red signal, turning back at the end of the line", () => {
    const { layout, ids } = chain(["straight-216", "straight-216", "signal", "straight-216", "straight-216", "buffer"]);
    const sim = new Sim(layout);
    const economy = new Economy(layout, sim);
    const status = (car: number) => engineStatus(sim, economy, car, () => "Oakhollow");
    const r = sim.addTrain(["engine"], { pieceId: ids[0], pathIndex: 0, reversed: false, s: 120 });
    if (r.kind !== "placed") throw new Error();
    const engine = sim.getTrain(r.trainId)!.cars[0].id;
    expect(status(engine)).toBe("Stopped");
    sim.setLever(engine, 1);
    run(sim, 0.5);
    expect(status(engine)).toBe("Running");
    // Held at red: it waits at the signal.
    sim.toggleSwitch(ids[2]);
    run(sim, 5);
    expect(status(engine)).toBe("Waiting at a red signal");
    // Let go: it runs on to the buffer and turns back there.
    sim.toggleSwitch(ids[2]);
    let turning = false;
    for (let k = 0; k < 120 * 8 && !turning; k++) {
      sim.tick();
      const t = sim.findCar(engine)?.train;
      if (t && t.turnback >= 0) turning = status(engine) === "Turning back at the end of the line";
    }
    expect(turning).toBe(true);
  });

  it("names the next stop of the train's route", () => {
    const { layout, ids } = chain(["straight-216", "straight-216", "straight-216"]);
    const sim = new Sim(layout);
    const economy = new Economy(layout, sim);
    const r = sim.addTrain(["engine"], { pieceId: ids[1], pathIndex: 0, reversed: false, s: 120 });
    if (r.kind !== "placed") throw new Error();
    const engine = sim.getTrain(r.trainId)!.cars[0].id;
    const d = economy.addDepot("sawmill", ids[2]);
    economy.setRoute(engine, { stops: [{ depotId: d.id, action: "both" }], next: 0 });
    sim.setLever(engine, 1);
    run(sim, 0.3);
    expect(engineStatus(sim, economy, engine, (id) => (id === d.id ? "the sawmill" : "?"))).toBe("On its way to the sawmill");
  });

  it("says what a depot's crane does there: a forest yard only loads", () => {
    const layout = new Layout();
    const ids = (["straight-216", "straight-216", "depot-forest", "straight-216", "straight-216"] as const).map((t, i) => layout.addPiece(t, { x: i * 216, z: 0, heading: 0 }));
    const sim = new Sim(layout);
    const economy = new Economy(layout, sim);
    const d = economy.addDepot("forest", ids[2], 0);
    const r = sim.addTrain(["engine", "timber", "timber"], { pieceId: ids[1], pathIndex: 0, reversed: false, s: 150 });
    if (r.kind !== "placed") throw new Error();
    const engine = sim.getTrain(r.trainId)!.cars[0].id;
    sim.setLever(engine, 1);
    const seen = new Set<string>();
    for (let k = 0; k < 120 * 20; k++) {
      sim.tick();
      economy.tick();
      seen.add(engineStatus(sim, economy, engine, (id) => (id === d.id ? "the forest yard" : "?")));
    }
    expect(seen).toContain("Loading at the forest yard");
    expect([...seen].some((st) => st.startsWith("Loading and unloading"))).toBe(false);
  });
});

describe("which way a stopped engine can go", () => {
  it("knows when its front, or its back, is up against a buffer", () => {
    const { layout, ids } = chain(["straight-216", "straight-216", "straight-216", "buffer"]);
    const sim = new Sim(layout);
    const r = sim.addTrain(["engine"], { pieceId: ids[1], pathIndex: 0, reversed: false, s: 120 });
    if (r.kind !== "placed") throw new Error();
    const engine = sim.getTrain(r.trainId)!.cars[0].id;
    expect(sim.engineBlocked(engine, 1)).toBe(false);
    sim.setLever(engine, 1);
    for (let k = 0; k < 120 * 8 && sim.findCar(engine)!.train.turnback < 0; k++) sim.tick();
    sim.setLever(engine, 0);
    // At the buffer: its front is blocked, its back is open.
    expect(sim.engineBlocked(engine, 1)).toBe(true);
    expect(sim.engineBlocked(engine, -1)).toBe(false);
    // Swapped end for end, the same holds for the other way round.
    sim.flipCar(engine);
    expect(sim.engineBlocked(engine, -1)).toBe(true);
    expect(sim.engineBlocked(engine, 1)).toBe(false);
  });
});

describe("why a train with its lever on isn't moving", () => {
  const line = () => {
    const { layout, ids } = chain(["straight-216", "straight-216", "signal", "straight-216", "straight-216", "straight-216"]);
    const sim = new Sim(layout);
    const economy = new Economy(layout, sim);
    const r = sim.addTrain(["engine", "hopper"], { pieceId: ids[1], pathIndex: 0, reversed: false, s: 200 });
    if (r.kind !== "placed") throw new Error();
    const train = sim.getTrain(r.trainId)!;
    return { layout, ids, sim, economy, train, engine: train.cars[0].id };
  };

  it("too heavy for its engine, or no power: says so, not just that something's in the way", () => {
    const { sim, economy, engine } = line();
    sim.setLever(engine, 1);
    // Game mode's engine rules: this one can't move at all.
    sim.topSpeed = () => 0;
    run(sim, 0.5);
    expect(engineStatus(sim, economy, engine, () => "?", () => "too-heavy")).toBe("Too heavy for its engine: take a car off, or add an engine");
    expect(engineStatus(sim, economy, engine, () => "?", () => "no-power")).toBe("No power: a power station needs coal");
    // Without the rules to ask (Sandbox), the plain reason.
    expect(engineStatus(sim, economy, engine, () => "?")).toBe("Waiting: something's in the way");
    // Lever off: just stopped, heavy or not.
    sim.setLever(engine, 0);
    expect(engineStatus(sim, economy, engine, () => "?", () => "too-heavy")).toBe("Stopped");
  });

  it("names the red signal it's held at", () => {
    const { ids, sim, economy, train, engine } = line();
    sim.toggleSwitch(ids[2]);
    sim.setLever(engine, 1);
    run(sim, 5);
    expect(trainState(sim, economy, train, 1)).toEqual({ kind: "red-signal", signalId: ids[2] });
    expect(sim.redSignalAhead(train.id)).toBe(ids[2]);
    sim.toggleSwitch(ids[2]);
    run(sim, 1);
    expect(trainState(sim, economy, train, 1).kind).toBe("running");
    expect(sim.redSignalAhead(train.id)).toBe(-1);
  });

  it("a report has each train: cars, levers, speed, top speed, the piece its front is on, and why it stands", () => {
    const { layout, ids, sim, economy, train, engine } = line();
    sim.toggleSwitch(ids[2]);
    sim.setLever(engine, 1);
    run(sim, 5);
    const [t] = trainsForReport(sim, economy, layout);
    expect(t).toMatchObject({ id: train.id, levers: [1], speed: 0, topSpeed: null, state: { kind: "red-signal", signalId: ids[2] } });
    expect(t.cars).toEqual([`${engine}:engine`, `${train.cars[1].id}:hopper`]);
    expect(t.piece).toMatchObject({ id: train.bogies[0].pieceId, type: layout.getPiece(train.bogies[0].pieceId)!.type });
    // JSON-able, as the report stores it.
    expect(JSON.parse(JSON.stringify(t))).toEqual(t);
  });
});

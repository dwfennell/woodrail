import { describe, expect, it } from "vitest";
import { Economy } from "../economy";
import { Sim, SIM_DT } from "../sim";
import { appendPiece, connectorRef, Layout, type PieceTypeId } from "../track";
import { engineStatus } from "./engine-status";

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
});

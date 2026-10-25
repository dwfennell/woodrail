import { describe, expect, it } from "vitest";
import { Economy } from "../economy";
import { Sim, SIM_HZ, type CarKind, type Train } from "../sim";
import { Layout, type PieceTypeId } from "../track";
import { canContinue, continueOn } from "./continue-on";
import { engineStatus } from "./engine-status";

/**
 * A sawmill, six straights, and a forest where the track just stops (no buffer). A train stands on the straights
 * heading for the forest; its route is the forest, then the sawmill. The forest is set to wait till full, with no logs:
 * left alone, its crane would hold the train there for good.
 */
function setup(cars: CarKind[], waitFull = true) {
  const layout = new Layout();
  const types: PieceTypeId[] = ["depot-sawmill", ...Array<PieceTypeId>(6).fill("straight-216"), "depot-forest"];
  const ids = types.map((t, i) => layout.addPiece(t, { x: i * 216, z: 0, heading: 0 }));
  const sim = new Sim(layout);
  // Engine first along +x, or (pushing) the engine at the back: the lead axle is the wagons'.
  const placed = sim.addTrain(cars, { pieceId: ids[5], pathIndex: 0, reversed: false, s: 150 });
  if (placed.kind !== "placed") throw new Error("no room");
  const economy = new Economy(layout, sim);
  const sawmill = economy.addDepot("sawmill", ids[0], 0);
  const forest = economy.addDepot("forest", ids[7], 0);
  const engineId = sim.getTrain(placed.trainId)!.cars.find((c) => c.kind === "engine")!.id;
  economy.setRoute(engineId, { stops: [{ depotId: forest.id, action: "both", waitFill: waitFull }, { depotId: sawmill.id, action: "both" }], next: 0 });
  // Toward the forest (+x): an engine at the back faces the same way, and pushes.
  sim.setLever(engineId, 1);
  const train = () => sim.findCar(engineId)!.train;
  const step = () => {
    sim.tick();
    economy.tick();
  };
  const status = () => engineStatus(sim, economy, engineId, () => "?");
  return { sim, economy, ids, engineId, train, step, status, forest, sawmill };
}

/** +1: moving along +x (toward the forest), −1 back toward the sawmill. */
const heading = (t: Train) => Math.sign(t.world[0].x - t.world[t.world.length - 1].x);

describe("Continue at the end of the track", () => {
  it("held at a station where the track ends: turns round, engine first, and runs on to the next stop", () => {
    const w = setup(["engine", "timber", "timber"]);
    // Up to the forest and its open end, where it waits (the crane, waiting to fill it, holds it there).
    let waiting = 0;
    for (let i = 0; i < 60 * SIM_HZ; i++) {
      w.step();
      if (w.status() === "Turning back: the track ends here") waiting++;
    }
    expect(waiting / SIM_HZ).toBeGreaterThan(30);
    expect(w.status()).toBe("Turning back: the track ends here");
    expect(canContinue(w.sim, w.economy, w.engineId)).toBe(true);
    const order = w.train().cars.map((c) => c.id);
    expect(continueOn(w.sim, w.economy, w.engineId)).toBe("continued");
    // Turned round: the same cars, mirrored, the engine leading back toward the sawmill.
    const t = w.train();
    expect(t.turnback).toBe(-1);
    expect(t.cars.map((c) => c.id)).toEqual(order);
    expect(t.cars[0].kind).toBe("engine");
    expect(canContinue(w.sim, w.economy, w.engineId)).toBe(false);
    // Off it goes (the crane lets it go), heading for the sawmill, its next stop.
    let left = false;
    for (let i = 0; i < 30 * SIM_HZ && !left; i++) {
      w.step();
      left = !w.train().bogies.some((b) => b.pieceId === w.ids[7]);
    }
    expect(left).toBe(true);
    expect(heading(w.train())).toBe(-1);
    expect(w.train().cars[0].kind).toBe("engine");
    expect(w.economy.routeOf(w.engineId)!.next).toBe(1);
    let reached = false;
    for (let i = 0; i < 60 * SIM_HZ && !reached; i++) {
      w.step();
      reached = w.train().bogies.some((b) => b.pieceId === w.ids[0]);
    }
    expect(reached).toBe(true);
  });

  it("pushing its wagons into the end: the engine runs round, so it leads going back", () => {
    const w = setup(["timber", "timber", "engine"], false);
    let ok = false;
    for (let i = 0; i < 60 * SIM_HZ && !ok; i++) {
      w.step();
      ok = canContinue(w.sim, w.economy, w.engineId);
    }
    expect(ok).toBe(true);
    expect(continueOn(w.sim, w.economy, w.engineId)).toBe("continued");
    for (let i = 0; i < 3 * SIM_HZ; i++) w.step();
    const t = w.train();
    expect(t.speed).toBeGreaterThan(1);
    expect(heading(t)).toBe(-1);
    expect(t.cars[0].kind).toBe("engine");
  });

  it("is offered only waiting where the track ends, with a stop to go on to", () => {
    // A route of one stop: nowhere else to go.
    const w = setup(["engine", "timber"]);
    w.economy.setRoute(w.engineId, { stops: [{ depotId: w.forest.id, action: "both", waitFill: true }], next: 0 });
    expect(canContinue(w.sim, w.economy, w.engineId)).toBe(false);
    for (let i = 0; i < 40 * SIM_HZ && w.status() !== "Turning back: the track ends here"; i++) w.step();
    expect(w.status()).toBe("Turning back: the track ends here");
    expect(canContinue(w.sim, w.economy, w.engineId)).toBe(false);
    expect(continueOn(w.sim, w.economy, w.engineId)).toBe("none");
    // No route at all: the same.
    w.economy.setRoute(w.engineId, null);
    expect(canContinue(w.sim, w.economy, w.engineId)).toBe(false);
  });
});

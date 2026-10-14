import { describe, expect, it } from "vitest";
import { Sim, SIM_HZ } from "../sim";
import { Layout } from "../track";
import { CARGO } from "./cargo";
import { PILE_CAP } from "./constants";
import { Economy, pilesOf, RECIPES, type DepotRole, type Recipe } from "./economy";

/** Three long straights in a row along +x, and a train of the given cars led from the far end. */
function world(cars: Parameters<Sim["addTrain"]>[0] = ["engine", "timber", "timber"]) {
  const layout = new Layout();
  const ids = [0, 216, 432].map((x) => layout.addPiece("straight-216", { x, z: 0, heading: 0 }));
  const sim = new Sim(layout);
  const placed = sim.addTrain(cars, { pieceId: ids[2], pathIndex: 0, reversed: false, s: 200 });
  if (placed.kind !== "placed") throw new Error("no room");
  const train = sim.getTrain(placed.trainId)!;
  return { layout, sim, train, economy: new Economy(layout, sim) };
}

const run = (e: Economy, seconds: number) => {
  for (let i = 0; i < seconds * SIM_HZ; i++) e.tick();
};

describe("production", () => {
  it("a forest grows a log every 15 s up to its cap, then stops", () => {
    const { economy } = world();
    const f = economy.addDepot("forest", 999);
    run(economy, 14.9);
    expect(f.piles[CARGO.log.index]).toBe(0);
    run(economy, 0.2);
    expect(f.piles[CARGO.log.index]).toBe(1);
    run(economy, 15 * 20);
    expect(f.piles[CARGO.log.index]).toBe(PILE_CAP);
  });

  it("a sawmill turns a log into planks every 8 s, only with a log and room", () => {
    const { economy } = world();
    const s = economy.addDepot("sawmill", 999);
    run(economy, 20);
    expect(s.piles[CARGO.planks.index]).toBe(0);
    s.piles[CARGO.log.index] = 3;
    run(economy, 8.05);
    expect([s.piles[CARGO.log.index], s.piles[CARGO.planks.index]]).toEqual([2, 1]);
    s.piles[CARGO.planks.index] = PILE_CAP;
    run(economy, 30);
    expect(s.piles[CARGO.log.index]).toBe(2);
  });

  it("a town uses a bundle every 30 s", () => {
    const { economy } = world();
    const t = economy.addDepot("town", 999, 4);
    t.piles[CARGO.planks.index] = 2;
    run(economy, 30.05);
    expect(t.piles[CARGO.planks.index]).toBe(1);
    run(economy, 60);
    expect(t.piles[CARGO.planks.index]).toBe(0);
  });
});

describe("moving cargo by hand", () => {
  it("moves one unit from a pile to a wagon and back, keeping each wagon to one kind", () => {
    const { economy, train } = world();
    const [engine, w1] = train.cars;
    const f = economy.addDepot("forest", 999);
    const s = economy.addDepot("sawmill", 998);
    f.piles[CARGO.log.index] = 2;
    s.piles[CARGO.planks.index] = 1;
    expect(economy.moveCargo({ kind: "pile", depotId: f.id, cargo: "log" }, { kind: "car", carId: w1.id })).toBe(true);
    expect(economy.cargoOf(w1.id)).toEqual({ kind: "log", count: 1 });
    expect(f.piles[CARGO.log.index]).toBe(1);
    // No planks onto a wagon of logs, and no cargo on an engine.
    expect(economy.moveCargo({ kind: "pile", depotId: s.id, cargo: "planks" }, { kind: "car", carId: w1.id })).toBe(false);
    expect(economy.moveCargo({ kind: "pile", depotId: f.id, cargo: "log" }, { kind: "car", carId: engine.id })).toBe(false);
    // Logs go onto the sawmill's input pile, not a town's.
    const t = economy.addDepot("town", 997, 0);
    expect(economy.moveCargo({ kind: "car", carId: w1.id }, { kind: "pile", depotId: t.id, cargo: "log" })).toBe(false);
    expect(economy.moveCargo({ kind: "car", carId: w1.id }, { kind: "pile", depotId: s.id, cargo: "log" })).toBe(true);
    expect(economy.cargoOf(w1.id)).toEqual({ kind: null, count: 0 });
    expect(s.piles[CARGO.log.index]).toBe(1);
  });

  it("refuses a full wagon, a full pile and an empty source", () => {
    const { economy, train } = world();
    const w1 = train.cars[1];
    const f = economy.addDepot("forest", 999);
    f.piles[CARGO.log.index] = PILE_CAP;
    economy.setCargo(w1.id, "log", 3);
    expect(economy.moveCargo({ kind: "pile", depotId: f.id, cargo: "log" }, { kind: "car", carId: w1.id })).toBe(false);
    expect(economy.moveCargo({ kind: "car", carId: w1.id }, { kind: "pile", depotId: f.id, cargo: "log" })).toBe(false);
    const empty = economy.addDepot("sawmill", 998);
    expect(economy.moveCargo({ kind: "pile", depotId: empty.id, cargo: "planks" }, { kind: "car", carId: train.cars[2].id })).toBe(false);
  });

  it("counts planks put on a town's pile as delivered", () => {
    const { economy, train } = world();
    const t = economy.addDepot("town", 997, 3);
    economy.setCargo(train.cars[1].id, "planks", 2);
    economy.moveCargo({ kind: "car", carId: train.cars[1].id }, { kind: "pile", depotId: t.id, cargo: "planks" });
    expect(economy.delivered.get(3)).toBe(1);
  });
});

describe("cargo stays with its wagon", () => {
  it("survives a re-rail (cars keep their ids)", () => {
    const { economy, sim, train } = world();
    const w1 = train.cars[1].id;
    economy.setCargo(w1, "planks", 3);
    (sim as unknown as { derail(t: unknown): void }).derail(train);
    const back = sim.rerail(train.id);
    expect(back).not.toBe(-1);
    expect(sim.getTrain(back)!.cars.map((c) => c.id)).toContain(w1);
    expect(economy.cargoOf(w1)).toEqual({ kind: "planks", count: 3 });
  });
});

describe("delivering to one depot", () => {
  it("a train set to deliver somewhere unloads only there; with none, at any depot that takes its goods", () => {
    const { layout, train, economy } = world();
    const [a, b] = [...layout.pieceIds()];
    const town = economy.addDepot("town", a, 0);
    const shop = economy.addDepot("workshop", b);
    const [engine, wagon] = train.cars;
    economy.setCargo(wagon.id, "planks", 3);
    expect(economy.needsService(town, wagon.id)).toBe(true);
    expect(economy.needsService(shop, wagon.id)).toBe(true);
    economy.setDeliverTo(engine.id, shop.id);
    expect(economy.destinationOf(wagon.id)).toBe(shop.id);
    expect(economy.needsService(town, wagon.id)).toBe(false);
    expect(economy.needsService(shop, wagon.id)).toBe(true);
    // Goods the destination doesn't take still go where they can: logs to a sawmill on the way to a workshop.
    const saw = economy.addDepot("sawmill", [...layout.pieceIds()][2]);
    economy.setCargo(wagon.id, "log", 3);
    expect(economy.needsService(saw, wagon.id)).toBe(true);
    economy.setCargo(wagon.id, "planks", 3);
    // The destination's piece taken up: anywhere again.
    layout.removePiece(b);
    expect(economy.needsService(town, wagon.id)).toBe(true);
    economy.setDeliverTo(engine.id, -1);
    expect(economy.deliverToOf(engine.id)).toBe(-1);
  });
});

describe("recipes", () => {
  it("each kind of depot uses and makes only goods it keeps piles of", () => {
    for (const [role, r] of Object.entries(RECIPES) as [DepotRole, Recipe][]) {
      const piles = pilesOf(role);
      for (const k of Object.keys(r.cycle?.uses ?? {})) expect(piles, `${role} uses ${k}`).toContain(k);
      for (const k of Object.keys(r.cycle?.makes ?? {})) expect(piles, `${role} makes ${k}`).toContain(k);
    }
  });

  it("an industry's rate sets how fast it makes things: half the trees, half the logs", () => {
    const { economy } = world();
    const full = economy.addDepot("forest", 998);
    const half = economy.addDepot("forest", 997);
    half.rate = 0.5;
    run(economy, 61);
    expect(full.piles[CARGO.log.index]).toBe(4);
    expect(half.piles[CARGO.log.index]).toBe(2);
  });
});

import { describe, expect, it } from "vitest";
import { Sim, SIM_HZ } from "../sim";
import { Layout } from "../track";
import { CARGO } from "./cargo";
import { capAt, Economy, LIFT_STACK } from "./economy";
import { Progress } from "../game/progress";
import { applyCranes, machinesFor } from "../game/upgrades";
import { BLUEPRINTS } from "../game/blueprints";

/** Straights along +x, a warehouse and a forest; a train of an engine and two flatbeds, routed warehouse → forest. */
function line() {
  const layout = new Layout();
  const ids = Array.from({ length: 10 }, (_, i) => layout.addPiece("straight-216", { x: i * 216, z: 0, heading: 0 }));
  const sim = new Sim(layout);
  const placed = sim.addTrain(["engine", "timber", "timber"], { pieceId: ids[1], pathIndex: 0, reversed: false, s: 200 });
  if (placed.kind !== "placed") throw new Error("no room");
  const economy = new Economy(layout, sim);
  const store = economy.addDepot("warehouse", ids[4], -1);
  const forest = economy.addDepot("forest", ids[7], -1);
  for (const d of [store, forest]) d.rate = 0;
  const train = () => sim.getTrain(sim.trainIds()[0])!;
  const [engine, w1, w2] = train().cars.map((c) => c.id);
  economy.setRoute(engine, { stops: [{ depotId: store.id, action: "auto" }, { depotId: forest.id, action: "auto" }], next: 0 });
  economy.setCargo(w1, "planks", 3);
  economy.setCargo(w2, "planks", 3);
  sim.setLever(engine, 1);
  /** Seconds till both wagons' planks are in the warehouse. */
  const unload = () => {
    for (let i = 0; i < 60 * SIM_HZ; i++) {
      sim.tick();
      economy.tick();
      if (store.piles[CARGO.planks.index] === 6) return i / SIM_HZ;
    }
    return Infinity;
  };
  return { economy, store, unload };
}

describe("Lift and load", () => {
  it("is researched (tier 3, after Warehouses and Quicker cranes II), mostly coins", () => {
    const row = BLUEPRINTS.find((b) => b.id === "lift-load")!;
    expect(row).toBeDefined();
    expect(row.needs).toEqual(["warehouses", "cranes2"]);
  });

  it("learned, every warehouse holds three times as much, a new one too, and shows its goods lift", () => {
    const { economy, store } = line();
    const before = capAt(store);
    const p = Progress.fresh();
    p.learned.add("lift-load");
    applyCranes(economy, p);
    expect(capAt(store)).toBe(before * LIFT_STACK);
    const later = economy.addDepot("warehouse", store.pieceId + 100, -1);
    expect(capAt(later)).toBe(before * LIFT_STACK);
    expect(machinesFor(p, "warehouse")).toContain("upgrade-goods-lift");
    expect(machinesFor(Progress.fresh(), "warehouse")).toEqual([]);
    // Forgotten (a cloud merge, a new game): back to one high.
    applyCranes(economy, Progress.fresh());
    expect(capAt(store)).toBe(before);
  });

  it("a train's wagons are unloaded into the warehouse in about half the time", () => {
    const plain = line().unload();
    const lifted = line();
    const p = Progress.fresh();
    p.learned.add("lift-load");
    applyCranes(lifted.economy, p);
    const fast = lifted.unload();
    expect(plain).toBeLessThan(Infinity);
    expect(fast).toBeLessThan(plain - 1);
  });
});

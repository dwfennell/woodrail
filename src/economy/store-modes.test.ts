import { describe, expect, it } from "vitest";
import { Sim, SIM_HZ, type CarKind, type Train } from "../sim";
import { Layout } from "../track";
import { CARGO } from "./cargo";
import { Economy, givesChoice, storeLetsIn, storeLetsOut, storeModeOf, type DepotRole, type DepotState, type RouteStopDef, type StoreMode } from "./economy";

/**
 * A warehouse's own say per good (`StoreMode`: Takes and gives, Takes only, Gives only, Closed), and for any good it
 * doesn't list. It applies to every train beside a route stop's Only drop / Only pick up: the stricter wins.
 */

/** A row of straights along +x with a depot on every other one; a train (engine and a wagon) on the first two. */
function line(roles: DepotRole[], cars: CarKind[] = ["engine", "timber"]) {
  const layout = new Layout();
  const n = 2 + roles.length * 2 + 2;
  const ids = Array.from({ length: n }, (_, i) => layout.addPiece("straight-216", { x: i * 216, z: 0, heading: 0 }));
  const sim = new Sim(layout);
  const placed = sim.addTrain(cars, { pieceId: ids[1], pathIndex: 0, reversed: false, s: 200 });
  if (placed.kind !== "placed") throw new Error("no room");
  const economy = new Economy(layout, sim);
  const depots = roles.map((role, k) => economy.addDepot(role, ids[2 + 2 * k], role === "town" ? k : -1));
  for (const d of depots) d.rate = 0;
  const train = () => sim.getTrain(sim.trainIds()[0])! as Train;
  const engine = train().cars[0].id;
  const wagon = train().cars[1].id;
  const route = (stops: RouteStopDef[], next = 0) => economy.setRoute(engine, { stops, next });
  const plan = () => economy.routePlan(economy.routeOf(engine)!.stops);
  return { layout, sim, economy, depots, train, engine, wagon, route, plan };
}

const pile = (d: DepotState, kind: keyof typeof CARGO) => d.piles[CARGO[kind].index];
const MODES: StoreMode[] = ["both", "in", "out", "off"];

describe("a warehouse's mode for a good", () => {
  it("is Takes and gives for every good to start (and for an old save's: nothing listed)", () => {
    const w = line(["warehouse"]);
    const [store] = w.depots;
    expect(store.others).toBe("both");
    expect(store.modes.every((m) => m === null)).toBe(true);
    expect(storeModeOf(store, "planks")).toBe("both");
  });

  it("a listed good has its own; any other follows \"Any other goods\"", () => {
    const w = line(["warehouse"]);
    const [store] = w.depots;
    w.economy.setStoreMode(store.id, "planks", "in");
    w.economy.setStoreMode(store.id, null, "off");
    expect([storeModeOf(store, "planks"), storeModeOf(store, "log")]).toEqual(["in", "off"]);
    expect([storeLetsIn(store, "planks"), storeLetsOut(store, "planks"), storeLetsIn(store, "log"), storeLetsOut(store, "log")]).toEqual([true, false, false, false]);
    // Taken off the list, planks follow the rest again.
    w.economy.unlistStore(store.id, "planks");
    expect(storeModeOf(store, "planks")).toBe("off");
  });

  it("only a warehouse takes one (a town has no such setting)", () => {
    const w = line(["town"]);
    w.economy.setStoreMode(w.depots[0].id, "planks", "off");
    expect(storeModeOf(w.depots[0], "planks")).toBe("both");
  });
});

describe("each mode, dropping and picking up (an Automatic stop)", () => {
  // Warehouse → Forest: the forest uses no planks, so planks on board are left at the warehouse.
  for (const mode of MODES)
    it(`drop, set to ${mode}: planks left ${mode === "both" || mode === "in" ? "there" : "on the train"}`, () => {
      const w = line(["warehouse", "forest"]);
      const [store, forest] = w.depots;
      w.economy.setStoreMode(store.id, "planks", mode);
      w.route([{ depotId: store.id, action: "auto" }, { depotId: forest.id, action: "auto" }]);
      w.economy.setCargo(w.wagon, "planks", 3);
      const drops = mode === "both" || mode === "in";
      expect(w.economy.needsService(store, w.wagon)).toBe(drops);
    });

  // Warehouse → Town: the town wants planks, so they're picked up at the warehouse.
  for (const mode of MODES)
    it(`pick up, set to ${mode}: planks ${mode === "both" || mode === "out" ? "taken" : "left in the warehouse"}`, () => {
      const w = line(["warehouse", "town"]);
      const [store, town] = w.depots;
      store.piles[CARGO.planks.index] = 6;
      w.economy.setStoreMode(store.id, "planks", mode);
      w.route([{ depotId: store.id, action: "auto" }, { depotId: town.id, action: "auto" }]);
      const picks = mode === "both" || mode === "out";
      expect(w.economy.needsService(store, w.wagon)).toBe(picks);
      expect(w.plan()[0].picks).toEqual(picks ? ["planks"] : []);
      // Held back by the warehouse alone: said on the route card.
      expect(w.plan()[0].notPicks).toEqual(picks ? [] : ["planks"]);
    });

  it("run: planks set to Takes only go in at the warehouse and never come out", () => {
    const w = line(["sawmill", "warehouse"], ["engine", "timber", "timber"]);
    const [saw, store] = w.depots;
    w.economy.setStoreMode(store.id, "planks", "in");
    saw.piles[CARGO.planks.index] = 6;
    w.route([{ depotId: saw.id, action: "auto" }, { depotId: store.id, action: "auto" }]);
    w.sim.setLever(w.engine, 1);
    for (let i = 0; i < 120 * SIM_HZ && pile(store, "planks") < 6; i++) (w.sim.tick(), w.economy.tick());
    expect(pile(store, "planks")).toBe(6);
    // A second line, Warehouse → Town: it takes none of them.
    const w2 = line(["warehouse", "town"]);
    const [store2, town2] = w2.depots;
    store2.piles[CARGO.planks.index] = 6;
    w2.economy.setStoreMode(store2.id, "planks", "in");
    w2.route([{ depotId: store2.id, action: "auto" }, { depotId: town2.id, action: "auto" }]);
    w2.sim.setLever(w2.engine, 1);
    for (let i = 0; i < 90 * SIM_HZ; i++) (w2.sim.tick(), w2.economy.tick());
    expect(pile(store2, "planks")).toBe(6);
    expect(w2.economy.delivered.get(town2.townId) ?? 0).toBe(0);
    // Set back to Takes and gives: they go to the town.
    w2.economy.setStoreMode(store2.id, "planks", "both");
    for (let i = 0; i < 120 * SIM_HZ && (w2.economy.delivered.get(town2.townId) ?? 0) < 2; i++) (w2.sim.tick(), w2.economy.tick());
    expect(pile(store2, "planks")).toBeLessThan(6);
    expect(w2.economy.delivered.get(town2.townId) ?? 0).toBeGreaterThan(0);
  });

  it("Any other goods Closed: only the listed goods are kept", () => {
    const w = line(["warehouse", "forest"]);
    const [store, forest] = w.depots;
    w.economy.setStoreMode(store.id, null, "off");
    w.economy.setStoreMode(store.id, "planks", "both");
    w.route([{ depotId: store.id, action: "auto" }, { depotId: forest.id, action: "auto" }]);
    w.economy.setCargo(w.wagon, "planks", 3);
    expect(w.economy.needsService(store, w.wagon)).toBe(true);
    w.economy.setCargo(w.wagon, "iron", 3);
    expect(w.economy.needsService(store, w.wagon)).toBe(false);
  });

  it("a warehouse that won't take a good isn't a reason to pick it up before it (Forest → Warehouse set Gives only)", () => {
    const w = line(["forest", "warehouse"]);
    const [forest, store] = w.depots;
    forest.piles[CARGO.log.index] = 6;
    w.route([{ depotId: forest.id, action: "auto" }, { depotId: store.id, action: "auto" }]);
    expect(w.economy.needsService(forest, w.wagon)).toBe(true);
    w.economy.setStoreMode(store.id, "log", "out");
    expect(w.economy.needsService(forest, w.wagon)).toBe(false);
    expect(w.plan().map((p) => p.picks)).toEqual([[], []]);
  });

  it("wait for a full load doesn't hold a train for goods the warehouse won't give", () => {
    const w = line(["warehouse", "town"]);
    const [store, town] = w.depots;
    store.piles[CARGO.planks.index] = 2;
    w.economy.setStoreMode(store.id, "planks", "in");
    w.route([{ depotId: store.id, action: "auto", waitFill: true }, { depotId: town.id, action: "auto" }]);
    expect(w.economy.needsService(store, w.wagon)).toBe(false);
  });
});

describe("with a route stop's Only drop / Only pick up: the stricter wins", () => {
  it("Only drop and Gives only: nothing moves, and the plan says why", () => {
    const w = line(["sawmill", "warehouse", "town"]);
    const [saw, store, town] = w.depots;
    w.economy.setStoreMode(store.id, "planks", "out");
    w.route([{ depotId: saw.id, action: "auto" }, { depotId: store.id, action: "drop" }, { depotId: town.id, action: "auto" }], 1);
    w.economy.setCargo(w.wagon, "planks", 3);
    expect(w.economy.needsService(store, w.wagon)).toBe(false);
    expect(w.plan()[1]).toMatchObject({ drops: [], notDrops: ["planks"], picks: [] });
  });

  it("Only drop and Takes only: dropped", () => {
    const w = line(["warehouse", "town"]);
    const [store, town] = w.depots;
    w.economy.setStoreMode(store.id, "planks", "in");
    w.route([{ depotId: store.id, action: "drop" }, { depotId: town.id, action: "auto" }]);
    w.economy.setCargo(w.wagon, "planks", 3);
    expect(w.economy.needsService(store, w.wagon)).toBe(true);
    expect(w.economy.workFor(w.train().id, store)).toEqual({ load: false, unload: true });
  });

  it("Only pick up and Takes only (or Closed): nothing taken, said even before any arrive (a listed good)", () => {
    const w = line(["warehouse", "town"]);
    const [store, town] = w.depots;
    w.economy.setStoreMode(store.id, "planks", "in");
    w.route([{ depotId: store.id, action: "pick" }, { depotId: town.id, action: "auto" }]);
    expect(w.plan()[0]).toMatchObject({ picks: [], notPicks: ["planks"] });
    store.piles[CARGO.planks.index] = 6;
    expect(w.economy.needsService(store, w.wagon)).toBe(false);
    w.economy.setStoreMode(store.id, "planks", "off");
    expect(w.economy.needsService(store, w.wagon)).toBe(false);
    w.economy.setStoreMode(store.id, "planks", "out");
    expect(w.economy.needsService(store, w.wagon)).toBe(true);
    expect(w.plan()[0]).toMatchObject({ picks: ["planks"], notPicks: [] });
  });

  it("the plan's version changes when a mode does (the route card is drawn again)", () => {
    const w = line(["warehouse", "town"]);
    const was = w.economy.plansVersion;
    w.economy.setStoreMode(w.depots[0].id, "planks", "in");
    expect(w.economy.plansVersion).not.toBe(was);
  });
});

describe("hand-run trains", () => {
  it("still trade nothing at a warehouse, whatever its modes", () => {
    const w = line(["warehouse"]);
    const [store] = w.depots;
    store.piles[CARGO.planks.index] = 6;
    w.economy.setCargo(w.wagon, "log", 2);
    expect(w.economy.needsService(store, w.wagon)).toBe(false);
  });
});

describe("an industry that gives several goods (the mine): Gives / Doesn't give per good", () => {
  it("only such an industry, only its own goods, only Gives or Doesn't give", () => {
    expect([givesChoice("mine"), givesChoice("forest"), givesChoice("foundry"), givesChoice("warehouse")]).toEqual([true, false, false, false]);
    const w = line(["mine", "forest"], ["engine", "hopper"]);
    const [mine, forest] = w.depots;
    w.economy.setStoreMode(mine.id, "ore", "in");
    w.economy.setStoreMode(mine.id, "grain", "off");
    w.economy.setStoreMode(mine.id, null, "off");
    w.economy.setStoreMode(forest.id, "log", "off");
    expect([storeModeOf(mine, "ore"), storeModeOf(mine, "grain"), mine.others, storeModeOf(forest, "log")]).toEqual(["both", "both", "both", "both"]);
    w.economy.setStoreMode(mine.id, "ore", "off");
    expect(storeModeOf(mine, "ore")).toBe("off");
  });

  for (const routed of [false, true])
    it(`set to coal only, a hopper train ${routed ? "on a route" : "run by hand"} leaves with coal only (and production keeps on)`, () => {
      const w = line(["mine", "foundry"], ["engine", "hopper", "hopper"]);
      const [mine, foundry] = w.depots;
      mine.rate = 1;
      mine.piles[CARGO.coal.index] = 6;
      mine.piles[CARGO.ore.index] = 6;
      w.economy.setStoreMode(mine.id, "ore", "off");
      if (routed) w.route([{ depotId: mine.id, action: "auto" }, { depotId: foundry.id, action: "auto" }]);
      w.sim.setLever(w.engine, 1);
      const loaded = new Set<string>();
      for (let i = 0; i < 60 * SIM_HZ; i++) {
        w.sim.tick();
        w.economy.tick();
        for (const ev of w.economy.drainEvents()) if (ev.kind === "loaded" && ev.depotId === mine.id) loaded.add(ev.cargo);
      }
      expect([...loaded]).toEqual(["coal"]);
      // Ore piles up as the mine works (to its cap, as before).
      expect(pile(mine, "ore")).toBeGreaterThan(6);
      if (routed) expect(w.plan()[0]).toMatchObject({ picks: ["coal"], notPicks: ["ore"] });
    });

  it("set to give nothing: no loading there at all", () => {
    const w = line(["mine", "foundry"], ["engine", "hopper"]);
    const [mine, foundry] = w.depots;
    mine.piles[CARGO.coal.index] = 6;
    mine.piles[CARGO.ore.index] = 6;
    w.economy.setStoreMode(mine.id, "coal", "off");
    w.economy.setStoreMode(mine.id, "ore", "off");
    w.route([{ depotId: mine.id, action: "pick" }, { depotId: foundry.id, action: "auto" }]);
    expect(w.economy.needsService(mine, w.wagon)).toBe(false);
    expect(w.plan()[0]).toMatchObject({ picks: [], notPicks: ["coal", "ore"] });
  });
});

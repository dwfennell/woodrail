import { describe, expect, it } from "vitest";
import { CARGO } from "../economy/cargo";
import { Economy, type DepotState } from "../economy/economy";
import { Sim, SIM_HZ, type CarKind, type Train } from "../sim";
import { Layout, type PieceTypeId } from "../track";
import { Progress } from "./progress";
import { attachResearch, lacking, pick } from "./research";
import { TownLife, type TownLifeHost } from "./town-life";
import { buildStarterWorld } from "./world";

/**
 * A line along +x of the given pieces, with a train of an engine and three flatbeds of 3 planks each on the first two
 * straights, heading along it; a depot on each depot piece (a "station" piece: a town's). Goods into the school go
 * into `p`'s research, and a school takes only what it lacks (as Game mode's TownLife has it; a town wants anything).
 */
function line(types: readonly (PieceTypeId | "station")[], p: Progress) {
  const layout = new Layout();
  const ids = ["straight-216", "straight-216", ...types, "straight-216", "straight-216"].map((t, i) => layout.addPiece(t === "station" ? "straight-216" : (t as PieceTypeId), { x: i * 216, z: 0, heading: 0 }));
  const sim = new Sim(layout);
  const cars: CarKind[] = ["engine", "timber", "timber", "timber"];
  const placed = sim.addTrain(cars, { pieceId: ids[1], pathIndex: 0, reversed: false, s: 150 });
  if (placed.kind !== "placed") throw new Error("no room");
  const economy = new Economy(layout, sim);
  const depots: DepotState[] = types.map((t, k) => economy.addDepot(t === "station" ? "town" : t === "depot-school" ? "school" : "workshop", ids[k + 2], t === "station" ? 0 : -1));
  economy.accepts = (d, kind) => (d.role === "school" ? lacking(p, kind) > 0 : true);
  attachResearch(economy, () => p);
  const train = () => sim.getTrain([...sim.trainIds()][0]) as Train;
  for (const c of train().cars) if (c.kind === "timber") economy.setCargo(c.id, "planks", 3);
  sim.setLever(train().cars[0].id, 1);
  const run = (seconds: number) => {
    for (let i = 0; i < seconds * SIM_HZ; i++) {
      sim.tick();
      economy.tick();
    }
  };
  const onTrain = () => train().cars.reduce((n, c) => n + economy.cargoOf(c.id).count, 0);
  return { layout, sim, economy, depots, train, run, onTrain, ids };
}

const researching = (id: string, coins = 0) => {
  const p = Progress.fresh();
  p.coins = coins;
  pick(p, id);
  return p;
};

describe("goods into a school", () => {
  it("an unrouted plank train passing a school, then the workshop, then a town drops exactly the remainder at the school", () => {
    const p = researching("switches");
    const w = line(["depot-school", "depot-workshop", "station"], p);
    w.run(90);
    const [school, shop] = w.depots;
    expect(p.research.got).toEqual({ planks: 4 });
    // Used up into the research: nothing on the school's piles. Nothing lost: the rest went on (the workshop no longer
    // keeps planks for blueprints, so it took them all).
    expect(school.piles[CARGO.planks.index]).toBe(0);
    expect(shop.piles[CARGO.planks.index] + (w.economy.delivered.get(0) ?? 0) + w.onTrain()).toBe(5);
  });

  it("the town after the school gets the rest", () => {
    const p = researching("switches");
    const w = line(["depot-school", "station"], p);
    // (End to end: the station just past the school, where the engine already is, doesn't take the school's turn.)
    w.run(90);
    expect(p.research.got).toEqual({ planks: 4 });
    expect(w.economy.delivered.get(0)).toBe(5);
  });

  it("a school past a station gets what the research lacks: the town before it leaves those for it (QA)", () => {
    const p = researching("switches");
    const w = line(["station", "depot-school"], p);
    w.run(90);
    expect(p.research.got).toEqual({ planks: 4 });
    // The town took the rest, and only the rest (before, it took all 9 and the school none).
    expect(w.economy.delivered.get(0)).toBe(5);
  });

  it("a routed train's Automatic stop at a town leaves for a later school what its research lacks", () => {
    const p = researching("switches");
    const w = line(["station", "depot-school"], p);
    const engine = w.train().cars[0].id;
    w.economy.setRoute(engine, { stops: [{ depotId: w.depots[0].id, action: "auto" }, { depotId: w.depots[1].id, action: "auto" }], next: 0 });
    w.run(90);
    expect(p.research.got).toEqual({ planks: 4 });
    expect(w.economy.delivered.get(0)).toBe(5);
  });

  it("a school on other track (not joined to the train's) keeps nothing from the town", () => {
    const p = researching("switches");
    const w = line(["station"], p);
    w.economy.addDepot("school", w.layout.addPiece("depot-school", { x: 5000, z: 5000, heading: 0 }));
    w.run(90);
    expect(w.economy.delivered.get(0)).toBe(9);
  });

  it("a routed line that comes to a town and the workshop before the school: both leave the research's planks for it (P5)", () => {
    const p = researching("switches");
    const w = line(["station", "depot-workshop", "depot-school"], p);
    const engine = w.train().cars[0].id;
    w.economy.setRoute(engine, { stops: w.depots.map((d) => ({ depotId: d.id, action: "auto" as const })), next: 0 });
    w.run(90);
    const shop = w.depots[1];
    expect(p.research.got).toEqual({ planks: 4 });
    expect(w.economy.delivered.get(0)).toBe(5);
    expect(shop.piles[CARGO.planks.index]).toBe(0);
  });

  it("an unrouted train passing the workshop before a school leaves it the research's planks; the yard takes the rest (P5)", () => {
    const p = researching("switches");
    const w = line(["depot-workshop", "depot-school"], p);
    w.run(90);
    expect(p.research.got).toEqual({ planks: 4 });
    expect(w.depots[0].piles[CARGO.planks.index] + w.onTrain()).toBe(5);
  });

  it("the workshop still gets the planks it keeps for its waiting tray order, before a school past it", () => {
    const p = researching("switches");
    const w = line(["depot-workshop", "depot-school"], p);
    w.economy.reserved = (kind) => kind === "planks";
    w.run(90);
    expect(w.depots[0].piles[CARGO.planks.index]).toBe(9);
    expect(p.research.got).toEqual({});
  });

  it("once the research has all it lacks, the town before the school takes planks again", () => {
    const p = researching("switches");
    p.research.got.planks = 4;
    const w = line(["station", "depot-school"], p);
    w.run(90);
    expect(w.economy.delivered.get(0)).toBe(9);
  });

  it("with nothing picked, a school takes nothing (the town gets it all)", () => {
    const p = Progress.fresh();
    const w = line(["depot-school", "station"], p);
    w.run(90);
    expect(p.research.got).toEqual({});
    expect(w.economy.delivered.get(0)).toBe(9);
  });

  it("a good the research doesn't need rides on", () => {
    const p = Progress.fresh();
    p.learned.add("farming");
    p.coins = 100;
    pick(p, "mills");
    const w = line(["depot-school", "station"], p);
    for (const c of w.train().cars) if (c.kind === "timber") w.economy.setCargo(c.id, "log", 3);
    w.run(90);
    expect(p.research.got).toEqual({});
    expect(w.onTrain()).toBe(9);
  });

  it("a routed train's drop is capped the same way: a Drop stop at the school leaves only the remainder", () => {
    const p = researching("switches");
    const w = line(["depot-school", "station"], p);
    const engine = w.train().cars[0].id;
    w.economy.setRoute(engine, { stops: [{ depotId: w.depots[0].id, action: "drop" }, { depotId: w.depots[1].id, action: "auto" }], next: 0 });
    w.run(120);
    expect(p.research.got).toEqual({ planks: 4 });
    expect(w.economy.delivered.get(0)).toBe(5);
  });

  it("by hand too: a unit goes onto a school only while the research lacks it", () => {
    const p = researching("switches");
    const w = line(["depot-school"], p);
    const wagon = w.train().cars[1].id;
    const to = { kind: "pile", depotId: w.depots[0].id, cargo: "planks" } as const;
    for (let k = 0; k < 3; k++) expect(w.economy.moveCargo({ kind: "car", carId: wagon }, to)).toBe(true);
    const next = w.train().cars[2].id;
    expect(w.economy.moveCargo({ kind: "car", carId: next }, to)).toBe(true);
    expect(w.economy.moveCargo({ kind: "car", carId: next }, to)).toBe(false);
    expect(p.research.got).toEqual({ planks: 4 });
  });
});

describe("Game mode's say in what a school takes", () => {
  it("TownLife's accepts asks the research, a lookup per good", () => {
    const w = buildStarterWorld();
    const p = researching("switches");
    const host: TownLifeHost = Object.assign(w, { footprintOf: () => undefined, editLand: () => {}, propsChanged: () => {}, setSignBadge: () => {} });
    new TownLife(host, { grew: () => {}, received: () => {}, school: (kind) => lacking(p, kind) > 0 }).reset();
    const school = w.economy.addDepot("school", w.layout.addPiece("depot-school", { x: 5000, z: 5000, heading: 0 }));
    expect(w.economy.accepts!(school, "planks")).toBe(true);
    expect(w.economy.accepts!(school, "grain")).toBe(false);
    p.research.got.planks = 4;
    expect(w.economy.accepts!(school, "planks")).toBe(false);
  });
});

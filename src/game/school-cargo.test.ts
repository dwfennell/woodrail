import { beforeAll, describe, expect, it } from "vitest";
import { CARGO } from "../economy/cargo";
import { Economy, SCHOOL_SHARE, WORKSHOP_CAP, type DepotState } from "../economy/economy";
import { loadFootprints } from "../props/footprints-testing";
import type { Footprint } from "../props/placement";
import { Sim, SIM_HZ, type CarKind, type Train } from "../sim";
import { Layout, type PieceTypeId } from "../track";
import { Progress } from "./progress";
import { keepsForOrder, orderPlanks, shopSpare, WORKSHOP_SPARE, yardKeeps } from "./crafting";
import { attachResearch, lacking, pick } from "./research";
import { TownLife, type TownLifeHost } from "./town-life";
import { buildStarterWorld } from "./world";

/** The game's own prop footprints (`Game.footprintOf`), so towns grow around their props as in the game. (Its props are towns' buildings.) */
let footprintOf: (asset: string) => Footprint | undefined = () => {
  throw new Error("footprints not loaded yet (see beforeAll)");
};
beforeAll(async () => {
  footprintOf = await loadFootprints(["bldg"]);
}, 60_000);

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
    expect(p.research.got).toEqual({ planks: 3 });
    // Used up into the research: nothing on the school's piles. Nothing lost: the rest went on (the workshop no longer
    // keeps planks for blueprints, so it took them all).
    expect(school.piles[CARGO.planks.index]).toBe(0);
    expect(shop.piles[CARGO.planks.index] + (w.economy.delivered.get(0) ?? 0) + w.onTrain()).toBe(6);
  });

  it("the town after the school gets the rest", () => {
    const p = researching("switches");
    const w = line(["depot-school", "station"], p);
    // (End to end: the station just past the school, where the engine already is, doesn't take the school's turn.)
    w.run(90);
    expect(p.research.got).toEqual({ planks: 3 });
    expect(w.economy.delivered.get(0)).toBe(6);
  });

  it("a school past a station gets what the research lacks: the town before it leaves those for it (QA)", () => {
    const p = researching("switches");
    const w = line(["station", "depot-school"], p);
    w.run(90);
    expect(p.research.got).toEqual({ planks: 3 });
    // The town took the rest, and only the rest (before, it took all 9 and the school none).
    expect(w.economy.delivered.get(0)).toBe(6);
  });

  it("a routed train's Automatic stop at a town leaves for a later school what its research lacks", () => {
    const p = researching("switches");
    const w = line(["station", "depot-school"], p);
    const engine = w.train().cars[0].id;
    w.economy.setRoute(engine, { stops: [{ depotId: w.depots[0].id, action: "auto" }, { depotId: w.depots[1].id, action: "auto" }], next: 0 });
    w.run(90);
    expect(p.research.got).toEqual({ planks: 3 });
    expect(w.economy.delivered.get(0)).toBe(6);
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
    expect(p.research.got).toEqual({ planks: 3 });
    expect(w.economy.delivered.get(0)).toBe(6);
    expect(shop.piles[CARGO.planks.index]).toBe(0);
  });

  it("an unrouted train passing the workshop before a school leaves it the research's planks; the yard takes the rest (P5)", () => {
    const p = researching("switches");
    const w = line(["depot-workshop", "depot-school"], p);
    w.run(90);
    expect(p.research.got).toEqual({ planks: 3 });
    expect(w.depots[0].piles[CARGO.planks.index] + w.onTrain()).toBe(6);
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
    p.research.got.planks = 3;
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
    expect(p.research.got).toEqual({ planks: 3 });
    expect(w.economy.delivered.get(0)).toBe(6);
  });

  it("by hand too: a unit goes onto a school only while the research lacks it", () => {
    const p = researching("switches");
    const w = line(["depot-school"], p);
    const wagon = w.train().cars[1].id;
    const to = { kind: "pile", depotId: w.depots[0].id, cargo: "planks" } as const;
    for (let k = 0; k < 3; k++) expect(w.economy.moveCargo({ kind: "car", carId: wagon }, to)).toBe(true);
    const next = w.train().cars[2].id;
    expect(w.economy.moveCargo({ kind: "car", carId: next }, to)).toBe(false);
    expect(p.research.got).toEqual({ planks: 3 });
  });
});

describe("the school and the towns share a pass's planks (QA P4: the school took every plank while research ran)", () => {
  // Bridges lack 10 planks, more than the train's 9: before, the school had all 9 and a town on the way none.
  it("school, then a town that wants planks: the school takes its share of the load, the town the rest", () => {
    const p = researching("bridges");
    const w = line(["depot-school", "station"], p);
    w.run(90);
    expect(p.research.got).toEqual({ planks: Math.ceil(9 * SCHOOL_SHARE) });
    expect(w.economy.delivered.get(0)).toBe(9 - Math.ceil(9 * SCHOOL_SHARE));
  });

  it("a town, then the school: the town leaves the school only its share", () => {
    const p = researching("bridges");
    const w = line(["station", "depot-school"], p);
    w.run(90);
    expect(p.research.got).toEqual({ planks: Math.ceil(9 * SCHOOL_SHARE) });
    expect(w.economy.delivered.get(0)).toBe(9 - Math.ceil(9 * SCHOOL_SHARE));
  });

  it("a routed line the same way: a later town that wants planks caps the school's take", () => {
    const p = researching("bridges");
    const w = line(["depot-school", "station"], p);
    w.economy.setRoute(w.train().cars[0].id, { stops: w.depots.map((d) => ({ depotId: d.id, action: "auto" as const })), next: 0 });
    w.run(90);
    expect(p.research.got).toEqual({ planks: Math.ceil(9 * SCHOOL_SHARE) });
    expect(w.economy.delivered.get(0)).toBe(9 - Math.ceil(9 * SCHOOL_SHARE));
  });

  it("with no town on the way wanting planks, the school takes all it lacks", () => {
    const p = researching("bridges");
    const w = line(["depot-school", "station"], p);
    w.economy.accepts = (d, kind) => (d.role === "school" ? lacking(p, kind) > 0 : false);
    w.run(90);
    expect(p.research.got).toEqual({ planks: 9 });
  });

  it("a research short of less than the share still gets all it lacks (Switches, 3 of 9)", () => {
    const p = researching("switches");
    const w = line(["station", "depot-school"], p);
    w.run(90);
    expect(p.research.got).toEqual({ planks: 3 });
  });
});

describe("the workshop's yard while a town on the line wants planks (QA P5: it filled 1 → 16 with no order)", () => {
  const keeps = (w: ReturnType<typeof line>, p: Progress) => {
    w.economy.shopKeeps = (kind) => (kind === "planks" ? yardKeeps(p) : null);
  };

  it("with no order and research idle, an unrouted train leaves the yard a few and takes the rest on to the town", () => {
    const p = Progress.fresh();
    const w = line(["depot-workshop", "station"], p);
    keeps(w, p);
    w.run(90);
    expect(w.depots[0].piles[CARGO.planks.index]).toBe(WORKSHOP_SPARE);
    expect(w.economy.delivered.get(0)).toBe(9 - WORKSHOP_SPARE);
  });

  it("a routed train's Automatic stop at the workshop does the same for a later town", () => {
    const p = Progress.fresh();
    const w = line(["depot-workshop", "station"], p);
    keeps(w, p);
    w.economy.setRoute(w.train().cars[0].id, { stops: w.depots.map((d) => ({ depotId: d.id, action: "auto" as const })), next: 0 });
    w.run(90);
    expect(w.depots[0].piles[CARGO.planks.index]).toBe(WORKSHOP_SPARE);
    expect(w.economy.delivered.get(0)).toBe(9 - WORKSHOP_SPARE);
  });

  it("a waiting tray order gets all its planks (a mill's 8, more than the few), the town the rest", () => {
    const p = Progress.fresh();
    p.orders.push("piece:depot-mill");
    expect(yardKeeps(p)).toBe(8);
    const w = line(["depot-workshop", "station"], p);
    keeps(w, p);
    w.run(90);
    expect(w.depots[0].piles[CARGO.planks.index]).toBe(8);
    expect(w.economy.delivered.get(0)).toBe(1);
  });

  it("with no town ahead wanting planks, the yard takes all it has room for", () => {
    const p = Progress.fresh();
    const w = line(["depot-workshop", "station"], p);
    keeps(w, p);
    w.economy.accepts = (d) => d.role !== "town";
    w.run(90);
    expect(w.depots[0].piles[CARGO.planks.index]).toBe(9);
  });

  it("a town before the workshop takes what it wants first; the yard is past it, with no town ahead: it fills", () => {
    const p = Progress.fresh();
    const w = line(["station", "depot-workshop"], p);
    keeps(w, p);
    w.economy.accepts = (d, kind) => d.role !== "town" || (w.economy.delivered.get(0) ?? 0) < 4 || kind !== "planks";
    w.run(90);
    expect(w.economy.delivered.get(0)).toBe(4);
    expect(w.depots[1].piles[CARGO.planks.index]).toBe(5);
  });
});

describe("the yard's spare covers the next thing to build (`shopSpare`; QA: one plank short of the mill for an hour)", () => {
  /** As main.ts has it: the spare worked out (once a second there; here once, nothing changes on the way). */
  const spares = (w: ReturnType<typeof line>, p: Progress) => {
    const world = { layout: w.layout, depots: new Map<number, number>() };
    w.economy.shopKeeps = (kind) => (kind === "planks" ? yardKeeps(p, shopSpare(p, world).planks) : null);
    return world;
  };
  const knowing = (...techs: string[]) => {
    const p = Progress.fresh();
    for (const t of techs) p.learned.add(t);
    return p;
  };
  /** A piece of `type` built out of the line's way. */
  const build = (w: ReturnType<typeof line>, type: PieceTypeId) => w.layout.addPiece(type, { x: 0, z: 5000, heading: 0 });

  it("Mills learned, no order: the yard keeps the mill's 8 (the cheapest past the 7 it keeps anyway), the town the rest", () => {
    // (Sawmills too: its 10 is dearer, so the mill is what the yard saves for first.)
    const p = knowing("mills", "sawmills");
    const w = line(["depot-workshop", "station"], p);
    const world = spares(w, p);
    expect(shopSpare(p, world)).toEqual({ planks: 8, for: "piece:depot-mill" });
    w.run(90);
    expect(w.depots[0].piles[CARGO.planks.index]).toBe(8);
    expect(w.economy.delivered.get(0)).toBe(1);
  });

  it("nothing known past the 7 (a fresh player: the cars and switches cost less): it keeps 7", () => {
    const p = knowing("switches", "passengers", "farming");
    const w = line(["depot-workshop", "station"], p);
    expect(shopSpare(p, spares(w, p))).toEqual({ planks: WORKSHOP_SPARE, for: null });
    w.run(90);
    expect(w.depots[0].piles[CARGO.planks.index]).toBe(WORKSHOP_SPARE);
    expect(w.economy.delivered.get(0)).toBe(9 - WORKSHOP_SPARE);
  });

  it("the mill built, nothing else past the 7 unbuilt: back to 7; one in the toy box isn't built yet", () => {
    const p = knowing("mills");
    const w = line(["depot-workshop", "station"], p);
    const world = spares(w, p);
    p.owned.set("piece:depot-mill", 1);
    expect(shopSpare(p, world).planks).toBe(8);
    build(w, "depot-mill");
    expect(shopSpare(p, world)).toEqual({ planks: WORKSHOP_SPARE, for: null });
    w.run(90);
    expect(w.depots[0].piles[CARGO.planks.index]).toBe(WORKSHOP_SPARE);
    expect(w.economy.delivered.get(0)).toBe(9 - WORKSHOP_SPARE);
  });

  it("the mill built with the sawmill known: it moves on to the sawmill's 10 (the yard takes the train's 9)", () => {
    const p = knowing("mills", "sawmills");
    const w = line(["depot-workshop", "station"], p);
    const world = spares(w, p);
    build(w, "depot-mill");
    expect(shopSpare(p, world)).toEqual({ planks: 10, for: "piece:depot-sawmill" });
    w.run(90);
    expect(w.depots[0].piles[CARGO.planks.index]).toBe(9);
    expect(w.economy.delivered.get(0) ?? 0).toBe(0);
  });

  it("no more than the yard holds (`WORKSHOP_CAP`, or the cap asked for)", () => {
    const p = knowing("mills", "sawmills");
    const world = { layout: new Layout(), depots: new Map<number, number>() };
    world.layout.addPiece("depot-mill", { x: 0, z: 0, heading: 0 });
    expect(shopSpare(p, world, WORKSHOP_SPARE, 9).planks).toBe(9);
    expect(shopSpare(p, world, WORKSHOP_CAP + 5).planks).toBe(WORKSHOP_CAP);
  });

  it("a queued order works as before: its planks kept for it, the spare the same with it or without", () => {
    const p = knowing("mills", "sawmills");
    const w = line(["depot-workshop", "station"], p);
    const world = spares(w, p);
    const before = shopSpare(p, world);
    // The sawmill ordered: its 10 kept (more than the spare), the train's 9 all into the yard, kept from the town.
    p.orders.push("piece:depot-sawmill");
    expect(shopSpare(p, world)).toEqual(before);
    expect(orderPlanks(p)).toBe(10);
    expect(keepsForOrder(p, 9)).toBe(true);
    expect(yardKeeps(p, before.planks)).toBe(10);
    w.run(90);
    expect(w.depots[0].piles[CARGO.planks.index]).toBe(9);
    // A switch ordered: kept for until its 3 are there; the yard still keeps the mill's 8.
    p.orders.length = 0;
    p.orders.push("piece:switch");
    expect(keepsForOrder(p, 3)).toBe(false);
    expect(yardKeeps(p, shopSpare(p, world).planks)).toBe(8);
  });

  it("Takes all planks still fills the yard", () => {
    const p = knowing("mills");
    const w = line(["depot-workshop", "station"], p);
    spares(w, p);
    w.economy.setTakesAll(w.depots[0].id, true);
    w.run(90);
    expect(w.depots[0].piles[CARGO.planks.index]).toBe(9);
  });

  it("a school further on still gets what its research lacks (`keptForSchool`)", () => {
    const p = researching("switches");
    p.learned.add("mills");
    const w = line(["depot-workshop", "depot-school", "station"], p);
    spares(w, p);
    w.run(90);
    expect(p.research.got).toEqual({ planks: 3 });
    expect(w.depots[0].piles[CARGO.planks.index]).toBe(6);
  });
});

describe("a workshop set to Takes all planks (`takesAll`): it fills its yard, a town ahead or not", () => {
  const keeps = (w: ReturnType<typeof line>, p: Progress) => {
    w.economy.shopKeeps = (kind) => (kind === "planks" ? yardKeeps(p) : null);
  };

  it("an unrouted train leaves all its planks in the yard, though the town ahead wants them", () => {
    const p = Progress.fresh();
    const w = line(["depot-workshop", "station"], p);
    keeps(w, p);
    w.economy.setTakesAll(w.depots[0].id, true);
    w.run(90);
    expect(w.depots[0].piles[CARGO.planks.index]).toBe(9);
    expect(w.economy.delivered.get(0) ?? 0).toBe(0);
  });

  it("a routed train's Automatic stop the same", () => {
    const p = Progress.fresh();
    const w = line(["depot-workshop", "station"], p);
    keeps(w, p);
    w.economy.setTakesAll(w.depots[0].id, true);
    w.economy.setRoute(w.train().cars[0].id, { stops: w.depots.map((d) => ({ depotId: d.id, action: "auto" as const })), next: 0 });
    w.run(90);
    expect(w.depots[0].piles[CARGO.planks.index]).toBe(9);
    expect(w.economy.delivered.get(0) ?? 0).toBe(0);
  });

  it("with no town ahead wanting planks, it fills as one that shares does", () => {
    const p = Progress.fresh();
    const w = line(["depot-workshop", "station"], p);
    keeps(w, p);
    w.economy.setTakesAll(w.depots[0].id, true);
    w.economy.accepts = (d) => d.role !== "town";
    w.run(90);
    expect(w.depots[0].piles[CARGO.planks.index]).toBe(9);
  });

  it("an Only drop stop at a workshop that shares drops all its planks there, as it says (QA N3: it still shared)", () => {
    const p = Progress.fresh();
    const w = line(["depot-workshop", "station"], p);
    keeps(w, p);
    w.economy.setRoute(w.train().cars[0].id, { stops: [{ depotId: w.depots[0].id, action: "drop" as const }, { depotId: w.depots[1].id, action: "auto" as const }], next: 0 });
    w.run(90);
    expect(w.depots[0].piles[CARGO.planks.index]).toBe(9);
    expect(w.economy.delivered.get(0) ?? 0).toBe(0);
    // Its Automatic stop still shares: the yard keeps the few, the town gets the rest.
    const a = line(["depot-workshop", "station"], p);
    keeps(a, p);
    a.economy.setRoute(a.train().cars[0].id, { stops: a.depots.map((d) => ({ depotId: d.id, action: "auto" as const })), next: 0 });
    a.run(90);
    expect(a.depots[0].piles[CARGO.planks.index]).toBe(WORKSHOP_SPARE);
  });

  it("an Only drop stop at a workshop still leaves a school further on what its research lacks", () => {
    const p = researching("bridges");
    const w = line(["depot-workshop", "depot-school"], p);
    keeps(w, p);
    w.economy.setRoute(w.train().cars[0].id, { stops: [{ depotId: w.depots[0].id, action: "drop" as const }, { depotId: w.depots[1].id, action: "auto" as const }], next: 0 });
    w.run(90);
    expect(p.research.got.planks ?? 0).toBeGreaterThan(0);
  });

  it("the school's hold-back stays: what a school further on lacks rides past it", () => {
    const p = researching("bridges");
    const shares = line(["depot-workshop", "depot-school"], p);
    keeps(shares, p);
    shares.run(90);
    const p2 = researching("bridges");
    const all = line(["depot-workshop", "depot-school"], p2);
    keeps(all, p2);
    all.economy.setTakesAll(all.depots[0].id, true);
    all.run(90);
    expect(p2.research.got).toEqual(p.research.got);
    expect(p2.research.got.planks ?? 0).toBeGreaterThan(0);
  });
});

describe("Game mode's say in what a school takes", () => {
  it("TownLife's accepts asks the research, a lookup per good", () => {
    const w = buildStarterWorld();
    const p = researching("switches");
    const host: TownLifeHost = Object.assign(w, { footprintOf: (asset: string) => footprintOf(asset), editLand: () => {}, propsChanged: () => {}, setSignBadge: () => {} });
    new TownLife(host, { grew: () => {}, received: () => {}, school: (kind) => lacking(p, kind) > 0 }).reset();
    const school = w.economy.addDepot("school", w.layout.addPiece("depot-school", { x: 5000, z: 5000, heading: 0 }));
    expect(w.economy.accepts!(school, "planks")).toBe(true);
    expect(w.economy.accepts!(school, "grain")).toBe(false);
    p.research.got.planks = 3;
    expect(w.economy.accepts!(school, "planks")).toBe(false);
  });
});

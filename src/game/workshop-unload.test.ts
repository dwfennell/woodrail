/**
 * When a train drops planks at the workshop (the user's report: "a train just passed this with planks on it but they
 * were not unloaded", Takes all planks, Automatic on, a school on the map). The rules:
 * - the workshop is its own stop: a train on its piece is served there, no station needed;
 * - a hand-run train drops there as it passes; a train on a route only where its route has a stop there (`dropsAt`);
 * - what a school's research lacks rides on for the school, but only for a school the train comes to (the bug: a
 *   hand-run train kept its planks for a school on joined track it never came to, points set away from it).
 */
import { describe, expect, it } from "vitest";
import { CARGO } from "../economy/cargo";
import { Economy, SCHOOL_SHARE, type DepotState } from "../economy/economy";
import { Sim, SIM_HZ, type CarKind, type Train } from "../sim";
import { getPieceDef, Layout, type PieceTypeId } from "../track";
import { Progress } from "./progress";
import { yardKeeps } from "./crafting";
import { attachResearch, lacking, pick } from "./research";
import { shopSkipText } from "./workshop-text";
import { engineView } from "./engine-status";

/**
 * Along +x: [a school behind], two straights (the train: an engine and three timber wagons of 3 planks each, heading
 * +x), the workshop, a straight, a town's station, a straight; then, with `branch`, a switch whose curve leads to a
 * school (set straight on: the train never goes there). Game mode's rules: a school takes what its research lacks, the
 * yard keeps `yardKeeps` while a town ahead wants planks.
 */
function world(p: Progress, opts: { behind?: boolean; branch?: boolean } = {}) {
  const layout = new Layout();
  const types: PieceTypeId[] = [...(opts.behind ? ["depot-school" as const] : []), "straight-216", "straight-216", "depot-workshop", "straight-216", "straight-216", "straight-216"];
  const ids = types.map((t, i) => layout.addPiece(t, { x: i * 216, z: 0, heading: 0 }));
  const o = opts.behind ? 1 : 0;
  let sw = -1;
  let branchSchool = -1;
  if (opts.branch) {
    sw = layout.addPiece("switch", { x: types.length * 216, z: 0, heading: 0 });
    const c = getPieceDef("switch", false).connectors[2].pose;
    branchSchool = layout.addPiece("depot-school", { x: types.length * 216 + c.x, z: c.z, heading: c.heading });
  }
  const sim = new Sim(layout);
  const cars: CarKind[] = ["engine", "timber", "timber", "timber"];
  const placed = sim.addTrain(cars, { pieceId: ids[o + 1], pathIndex: 0, reversed: false, s: 150 });
  if (placed.kind !== "placed") throw new Error("no room");
  const economy = new Economy(layout, sim);
  const shop: DepotState = economy.addDepot("workshop", ids[o + 2], -1);
  const town: DepotState = economy.addDepot("town", ids[o + 4], 0);
  if (opts.behind) economy.addDepot("school", ids[0]);
  if (opts.branch) economy.addDepot("school", branchSchool);
  economy.accepts = (d, kind) => (d.role === "school" ? lacking(p, kind) > 0 : true);
  economy.shopKeeps = (kind) => (kind === "planks" ? yardKeeps(p) : null);
  attachResearch(economy, () => p);
  economy.setTakesAll(shop.id, true);
  const train = () => sim.getTrain([...sim.trainIds()][0]) as Train;
  for (const c of train().cars) if (c.kind === "timber") economy.setCargo(c.id, "planks", 3);
  sim.setLever(train().cars[0].id, 1);
  /** Told, while running, that it keeps its planks past the workshop (`shopItSkips`, and the engine card's line). */
  const told = new Set<string>();
  const run = (seconds: number) => {
    for (let i = 0; i < seconds * SIM_HZ; i++) {
      sim.tick();
      economy.tick();
      if (economy.shopItSkips(train().id)) told.add(engineView(sim, economy, train().cars[0].id, () => "").status);
    }
  };
  const yard = () => shop.piles[CARGO.planks.index];
  return { layout, economy, shop, town, train, run, yard, told, sw };
}

/** Research picked that lacks more planks than the train carries (Bridges: 10). */
const lackingPlanks = () => {
  const p = Progress.fresh();
  pick(p, "bridges");
  expect(lacking(p, "planks")).toBeGreaterThan(9);
  return p;
};

describe("a hand-run train at a workshop set to Takes all planks", () => {
  it("drops all its planks in the yard", () => {
    const w = world(Progress.fresh());
    w.run(90);
    expect(w.yard()).toBe(9);
  });

  it("drops them though a school on joined track lacks planks, when the points send the train away from it (the bug)", () => {
    const p = lackingPlanks();
    const w = world(p, { branch: true });
    w.run(90);
    expect(w.yard()).toBe(9);
    expect(p.research.got).toEqual({});
  });

  it("keeps them for that school with the points set its way: the school gets what it needs", () => {
    const p = lackingPlanks();
    const w = world(p, { branch: true });
    w.layout.setSwitchState(w.sw, 1);
    w.run(90);
    expect(w.yard()).toBe(0);
    // (The town on the way takes what's beyond the school's share of the load: `SCHOOL_SHARE`.)
    expect(p.research.got.planks).toBe(Math.ceil(9 * SCHOOL_SHARE));
  });

  it("keeps them for a school behind it on a line it turns back along", () => {
    const p = lackingPlanks();
    const w = world(p, { behind: true });
    w.run(30);
    expect(w.yard()).toBe(0);
  });
});

describe("a routed train and the workshop", () => {
  it("drops all its planks where its route has a stop at the workshop", () => {
    const w = world(Progress.fresh());
    w.economy.setRoute(w.train().cars[0].id, { stops: [{ depotId: w.shop.id, action: "auto" }, { depotId: w.town.id, action: "auto" }], next: 0 });
    w.run(90);
    expect(w.yard()).toBe(9);
    expect(w.told.size).toBe(0);
  });

  it("keeps them passing a workshop its route has no stop at, and its card says why", () => {
    const w = world(Progress.fresh());
    w.economy.setRoute(w.train().cars[0].id, { stops: [{ depotId: w.town.id, action: "auto" }], next: 0 });
    w.run(90);
    expect(w.yard()).toBe(0);
    // (Said while it passes; at the town just past it, it says it's unloading there.)
    expect(w.told.has(shopSkipText("planks"))).toBe(true);
    expect(shopSkipText("planks")).toBe("Not dropping planks: the workshop isn't on this route. Edit the route to add a stop here");
  });

  it("keeps them for the stop it's heading for, the workshop a later stop: it isn't told it has none there", () => {
    const w = world(Progress.fresh());
    w.economy.setRoute(w.train().cars[0].id, { stops: [{ depotId: w.shop.id, action: "auto" }, { depotId: w.town.id, action: "auto" }], next: 1 });
    w.run(8);
    expect(w.yard()).toBe(0);
    expect(w.told.size).toBe(0);
  });
});

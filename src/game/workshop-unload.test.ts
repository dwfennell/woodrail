/**
 * When a train drops goods at the workshop and the school (the user's report: "a train just passed this with planks
 * on it but they were not unloaded", Takes all planks, Automatic on; the planks went on to the school past it). The
 * rules now: each stop takes goods in the order the train comes to it, by its own setting, and nothing is held back
 * for a school further on:
 * - the workshop is its own stop: a train on its piece is served there, no station needed;
 * - a hand-run train drops as it passes; a train on a route only where its route has a stop there (`dropsAt`);
 * - a workshop on Takes all planks fills its yard; on Shares with towns it keeps a few while a town ahead wants them;
 * - a school takes what its research lacks when the train gets there: on Shares with towns (its default) its share of
 *   the load while a town ahead wants it too; set to Research first (its card), trains keep what its research lacks
 *   for it past towns and the workshop, and it takes all of it (but only a school the train comes to);
 * - a train passing a stop keeping goods it takes says why on its engine card (`Economy.keptAt`, `keptText`).
 */
import { describe, expect, it } from "vitest";
import { CARGO } from "../economy/cargo";
import { Economy, SCHOOL_SHARE, type DepotState } from "../economy/economy";
import { Sim, SIM_HZ, type CarKind, type Train } from "../sim";
import { getPieceDef, Layout, type PieceTypeId } from "../track";
import { Progress } from "./progress";
import { yardKeeps } from "./crafting";
import { attachResearch, lacking, pick } from "./research";
import { keptText } from "./workshop-text";
import { engineView } from "./engine-status";

type Stop = "workshop" | "school" | "town" | "forest" | "sawmill";
const PIECE: Record<Stop, PieceTypeId> = { workshop: "depot-workshop", school: "depot-school", town: "straight-216", forest: "depot-forest", sawmill: "depot-sawmill" };

/**
 * Along +x: two straights (the train: an engine and three timber wagons of 3 planks each, heading +x), then the stops
 * with a straight after each, then two straights; with `branch`, a switch at the end whose curve leads to another
 * school (`branch: "school"`, the points set its way with `toBranch`). Game mode's rules: a school takes what its
 * research lacks, a town wants planks, the yard keeps `yardKeeps` while a town ahead wants them.
 */
function line(p: Progress, stops: readonly Stop[], opts: { branchSchool?: boolean; toBranch?: boolean } = {}) {
  const layout = new Layout();
  const types: PieceTypeId[] = ["straight-216", "straight-216", ...stops.flatMap((s) => [PIECE[s], "straight-216" as const]), "straight-216"];
  const ids = types.map((t, i) => layout.addPiece(t, { x: i * 216, z: 0, heading: 0 }));
  let branch = -1;
  if (opts.branchSchool) {
    const sw = layout.addPiece("switch", { x: types.length * 216, z: 0, heading: 0 });
    const c = getPieceDef("switch", false).connectors[2].pose;
    branch = layout.addPiece("depot-school", { x: types.length * 216 + c.x, z: c.z, heading: c.heading });
    if (opts.toBranch) layout.setSwitchState(sw, 1);
  }
  const sim = new Sim(layout);
  const cars: CarKind[] = ["engine", "timber", "timber", "timber"];
  const placed = sim.addTrain(cars, { pieceId: ids[1], pathIndex: 0, reversed: false, s: 150 });
  if (placed.kind !== "placed") throw new Error("no room");
  const economy = new Economy(layout, sim);
  const depots: DepotState[] = stops.map((s, k) => economy.addDepot(s, ids[2 + 2 * k], s === "town" ? 0 : -1));
  const branchSchool = opts.branchSchool ? economy.addDepot("school", branch) : null;
  economy.accepts = (d, kind) => (d.role === "school" ? lacking(p, kind) > 0 : true);
  economy.shopKeeps = (kind) => (kind === "planks" ? yardKeeps(p) : null);
  attachResearch(economy, () => p);
  const train = () => sim.getTrain([...sim.trainIds()][0]) as Train;
  for (const c of train().cars) if (c.kind === "timber") economy.setCargo(c.id, "planks", 3);
  sim.setLever(train().cars[0].id, 1);
  /** What its engine card said while passing a stop that takes planks and keeping them (`keptAt`). */
  const told = new Set<string>();
  /** The places the card offered to add ("Add …": `engineView`'s `addStop`). */
  const offered = new Set<number>();
  const names: Record<string, string> = { workshop: "the workshop", school: "the school", town: "Ashby", forest: "the forest", sawmill: "the sawmill" };
  const run = (seconds: number) => {
    for (let i = 0; i < seconds * SIM_HZ; i++) {
      sim.tick();
      economy.tick();
      if (economy.keptAt(train().id)) {
        const v = engineView(sim, economy, train().cars[0].id, (id) => names[economy.depot(id)!.role]);
        told.add(v.status);
        if (v.addStop !== undefined) offered.add(v.addStop);
      }
    }
  };
  const at = (s: Stop) => depots[stops.indexOf(s)];
  const planks = (d: DepotState) => d.piles[CARGO.planks.index];
  const delivered = () => economy.delivered.get(0) ?? 0;
  const route = (stops: { stop: DepotState; action?: "auto" | "drop" | "pick" }[], next = 0) =>
    economy.setRoute(train().cars[0].id, { stops: stops.map((s) => ({ depotId: s.stop.id, action: s.action ?? "auto" })), next });
  /** What each timber wagon carries, front to back ("planks 3", "logs 2", "empty"). */
  const loads = () =>
    train()
      .cars.filter((c) => c.kind === "timber")
      .map((c) => {
        const g = economy.cargoOf(c.id);
        return g.kind && g.count > 0 ? `${g.kind} ${g.count}` : "empty";
      });
  return { layout, economy, sim, train, run, at, planks, delivered, route, told, offered, branchSchool, loads };
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
    const w = line(Progress.fresh(), ["workshop", "town"]);
    w.economy.setTakesAll(w.at("workshop").id, true);
    w.run(90);
    expect(w.planks(w.at("workshop"))).toBe(9);
    expect(w.delivered()).toBe(0);
  });

  it("drops them though the school it goes on to lacks planks: nothing is held back for the school (the report)", () => {
    const p = lackingPlanks();
    const w = line(p, ["workshop"], { branchSchool: true, toBranch: true });
    w.economy.setTakesAll(w.at("workshop").id, true);
    w.run(90);
    expect(w.planks(w.at("workshop"))).toBe(9);
    expect(p.research.got).toEqual({});
  });

  it("set to share, keeps a few and takes the rest on to the town ahead, school or none", () => {
    const p = lackingPlanks();
    const w = line(p, ["workshop", "town"], { branchSchool: true, toBranch: true });
    w.run(20);
    expect(w.planks(w.at("workshop"))).toBe(yardKeeps(p));
    expect(w.told.has("Not dropping planks: the workshop shares with towns and has its planks")).toBe(true);
  });
});

describe("a workshop set to share shares with a school left sharing too (Dustin's playthrough, 2026-11-04)", () => {
  it("hand-run, a sharing school after it whose research lacks planks: the yard keeps its part, the school gets the rest", () => {
    const p = lackingPlanks();
    const w = line(p, ["workshop", "school"]);
    w.run(90);
    expect(w.planks(w.at("workshop"))).toBe(yardKeeps(p));
    expect(p.research.got.planks).toBe(9 - yardKeeps(p));
  });

  it("on a route too", () => {
    const p = lackingPlanks();
    const w = line(p, ["workshop", "school"]);
    w.route([{ stop: w.at("workshop") }, { stop: w.at("school") }]);
    w.run(90);
    expect(w.planks(w.at("workshop"))).toBe(yardKeeps(p));
    expect(p.research.got.planks).toBe(9 - yardKeeps(p));
  });

  it("not for a school whose research lacks no planks: the yard takes them all", () => {
    const p = Progress.fresh();
    const w = line(p, ["workshop", "school"]);
    w.run(90);
    expect(w.planks(w.at("workshop"))).toBe(9);
  });

  it("not with the workshop set to Takes all planks", () => {
    const p = lackingPlanks();
    const w = line(p, ["workshop", "school"]);
    w.economy.setTakesAll(w.at("workshop").id, true);
    w.run(90);
    expect(w.planks(w.at("workshop"))).toBe(9);
    expect(p.research.got).toEqual({});
  });
});

describe("a school takes what its research lacks when the train gets there", () => {
  it("after a town that wants planks: the town takes what it wants first (here all), the school gets what's left", () => {
    const p = lackingPlanks();
    const w = line(p, ["town", "school"]);
    w.run(90);
    expect(w.delivered()).toBe(9);
    expect(p.research.got).toEqual({});
  });

  it("Shares with towns (its default), before a town that wants planks: its share of the load, the town the rest", () => {
    const p = lackingPlanks();
    const w = line(p, ["school", "town"]);
    w.run(90);
    expect(p.research.got.planks).toBe(Math.ceil(9 * SCHOOL_SHARE));
    expect(w.delivered()).toBe(9 - Math.ceil(9 * SCHOOL_SHARE));
    expect(w.told.has("Not dropping planks: the school shares with towns and has had its part")).toBe(true);
  });

  it("Research first: all its research lacks, the town the rest", () => {
    const p = lackingPlanks();
    const w = line(p, ["school", "town"]);
    w.economy.setTakesAll(w.at("school").id, true);
    w.run(90);
    expect(p.research.got.planks).toBe(9);
    expect(w.delivered()).toBe(0);
  });

  it("a routed Only drop stop at the school drops all its research lacks, as it says", () => {
    const p = lackingPlanks();
    const w = line(p, ["school", "town"]);
    w.route([{ stop: w.at("school"), action: "drop" }, { stop: w.at("town") }]);
    w.run(90);
    expect(p.research.got.planks).toBe(9);
  });

  it("with no research lacking planks, it takes none, and the engine card says so passing it", () => {
    const p = Progress.fresh();
    const w = line(p, ["school"]);
    w.run(20);
    expect(p.research.got).toEqual({});
    expect(w.told.has("Not dropping planks: the research doesn't need any")).toBe(true);
  });
});

describe("a school set to Research first (its card's choice): trains keep what its research lacks for it", () => {
  it("past a town and a workshop on Takes all planks, and the engine card says why", () => {
    const p = lackingPlanks();
    const w = line(p, ["town", "workshop", "school"]);
    w.economy.setTakesAll(w.at("workshop").id, true);
    w.economy.setTakesAll(w.at("school").id, true);
    w.run(90);
    expect(w.delivered()).toBe(0);
    expect(w.planks(w.at("workshop"))).toBe(0);
    expect(p.research.got).toEqual({ planks: 9 });
    expect(w.told.has("Keeping 9 planks for the school (Research first)")).toBe(true);
  });

  it("a routed line: one wagon's worth, the rest dropped at the town", () => {
    const p = lackingPlanks();
    const w = line(p, ["town", "workshop", "school"]);
    w.economy.setTakesAll(w.at("school").id, true);
    w.route([{ stop: w.at("town") }, { stop: w.at("workshop") }, { stop: w.at("school") }]);
    w.run(90);
    expect(w.delivered()).toBe(6);
    expect(p.research.got).toEqual({ planks: 3 });
    expect(w.told.has("Keeping 3 planks for the school (Research first)")).toBe(true);
  });

  it("only for a school the train comes to: one on joined track, the points set away from it, gets nothing kept", () => {
    const p = lackingPlanks();
    const w = line(p, ["workshop"], { branchSchool: true });
    w.economy.setTakesAll(w.at("workshop").id, true);
    w.economy.setTakesAll(w.branchSchool!.id, true);
    w.run(90);
    expect(w.planks(w.at("workshop"))).toBe(9);
    // The points set its way: kept for it.
    const q = lackingPlanks();
    const v = line(q, ["workshop"], { branchSchool: true, toBranch: true });
    v.economy.setTakesAll(v.at("workshop").id, true);
    v.economy.setTakesAll(v.branchSchool!.id, true);
    v.run(90);
    expect(v.planks(v.at("workshop"))).toBe(0);
    expect(q.research.got).toEqual({ planks: 9 });
  });
});

describe("a routed train holds at most one wagon's worth for a Research-first school (issue #20)", () => {
  // (The 2026-11-01 release QA, balance seed 5: planks held for the school filled both timber wagons of a routed
  // train, so at the forest they took no logs, nothing was sawn and a city went 70 minutes without planks.)
  const routed = (p: Progress, stops: Stop[]) => {
    const w = line(p, stops);
    w.economy.setTakesAll(w.at("school").id, true);
    w.route(stops.map((s) => ({ stop: w.at(s) })));
    return w;
  };

  it("never more than the research lacks: lacking 2, it keeps 2 and drops the other 7 at the town", () => {
    const p = lackingPlanks();
    const need = lacking(p, "planks");
    p.research.got = { planks: need - 2 }; // (setup: research part done, not the thing under test)
    expect(lacking(p, "planks")).toBe(2);
    const w = routed(p, ["town", "school"]);
    w.run(90);
    expect(w.delivered()).toBe(7);
    expect(p.research.got.planks).toBe(need);
    expect(w.told.has("Keeping 2 planks for the school (Research first)")).toBe(true);
  });

  it("the held planks stay in one wagon: the others drop theirs at the town and load logs at the forest", () => {
    const p = lackingPlanks();
    const w = routed(p, ["town", "forest", "school", "sawmill"]);
    w.at("forest").piles[CARGO.log.index] = 6;
    // Till the back two wagons have taken logs at the forest: the front one still holds the school's 3.
    for (let t = 0; t < 60 && !w.loads().slice(1).every((l) => l.startsWith("log ")); t++) w.run(1);
    expect(w.delivered()).toBe(6);
    const loads = w.loads();
    expect(loads[0]).toBe("planks 3");
    expect(loads.slice(1).every((l) => l.startsWith("log "))).toBe(true);
    w.run(60);
    expect(p.research.got).toEqual({ planks: 3 });
  });

  it("a hand-run train on the same line keeps all the research lacks, as before (no cap)", () => {
    const p = lackingPlanks();
    const w = line(p, ["town", "school"]);
    w.economy.setTakesAll(w.at("school").id, true);
    w.run(90);
    expect(w.delivered()).toBe(0);
    expect(p.research.got).toEqual({ planks: 9 });
  });

  it("the cap is one wagon's worth: more with heavy wagons", () => {
    const p = lackingPlanks();
    const w = line(p, ["town", "school"]);
    expect(w.economy.schoolHoldCap).toBe(3);
    w.economy.wagonCapacity = 5;
    for (const c of w.train().cars) if (c.kind === "timber") w.economy.setCargo(c.id, "planks", 5);
    w.economy.setTakesAll(w.at("school").id, true);
    w.route([{ stop: w.at("town") }, { stop: w.at("school") }]);
    w.run(90);
    expect(w.delivered()).toBe(10);
    expect(p.research.got).toEqual({ planks: 5 });
  });
});

describe("a routed train and the workshop", () => {
  it("drops all its planks where its route has a stop at the workshop", () => {
    const w = line(Progress.fresh(), ["workshop", "town"]);
    w.economy.setTakesAll(w.at("workshop").id, true);
    w.route([{ stop: w.at("workshop") }, { stop: w.at("town") }]);
    w.run(90);
    expect(w.planks(w.at("workshop"))).toBe(9);
  });

  it("keeps them passing a workshop its route has no stop at, and its card says why", () => {
    const w = line(Progress.fresh(), ["workshop", "town"]);
    w.economy.setTakesAll(w.at("workshop").id, true);
    w.route([{ stop: w.at("town") }]);
    w.run(90);
    expect(w.planks(w.at("workshop"))).toBe(0);
    expect(w.told.has("Not dropping planks: the workshop isn't on this line. Edit the line to add a stop here")).toBe(true);
    expect(keptText("not-stop", "planks", "workshop", "the workshop")).toBe("Not dropping planks: the workshop isn't on this line. Edit the line to add a stop here");
    // The card offers to add the workshop (one tap: audit F15), and only that place.
    expect([...w.offered]).toEqual([w.at("workshop").id]);
  });

  it("keeps them for the stop it's heading for, the workshop a later stop: nothing said", () => {
    const w = line(Progress.fresh(), ["workshop", "town"]);
    w.economy.setTakesAll(w.at("workshop").id, true);
    w.route([{ stop: w.at("workshop") }, { stop: w.at("town") }], 1);
    w.run(8);
    expect(w.planks(w.at("workshop"))).toBe(0);
    expect(w.told.size).toBe(0);
  });
});

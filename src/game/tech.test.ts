import { describe, expect, it } from "vitest";
import { CARGO } from "../economy/cargo";
import { capOf } from "../economy/economy";
import { appendPiece, connectorRef } from "../track";
import { GOALS } from "./goals";
import { Progress } from "./progress";
import { built, choose, keepsPlanks, learnWithGoods, offerFor, planksWanted, priceOf, ready, techOf, TECHS } from "./tech";
import { THING_RULES } from "./things";
import { buildStarterWorld, syncIndustries } from "./world";

describe("blueprints", () => {
  it("start with switches, bridges, farming and mills on the board; junctions wait for switches, mills for farming", () => {
    const p = Progress.fresh();
    expect([...p.board].sort()).toEqual(["bridges", "farming", "mills", "switches"]);
    expect(ready(p, "mills")).toBe(false);
    expect(ready(p, "junctions")).toBe(false);
    p.learned.add("switches");
    expect(ready(p, "junctions")).toBe(true);
  });

  it("one workshop's yard holds the planks for any blueprint or building (it once held 12: a mill could never be paid)", () => {
    const most = Math.max(...TECHS.filter(built).map((t) => t.price.planks ?? 0), ...Object.values(THING_RULES).map((r) => r!.cost.planks ?? 0));
    expect(capOf("workshop")).toBeGreaterThanOrEqual(most);
  });

  it("a growing town offers two ready blueprints, new ones first; choosing one learns it and boards the other", () => {
    const p = Progress.fresh();
    const offer = offerFor(p, () => 0);
    expect(offer).toHaveLength(2);
    for (const o of offer) expect(p.board.has(o)).toBe(false);
    expect(choose(p, offer[0], offer)).toBe(true);
    expect(p.learned.has(offer[0])).toBe(true);
    expect(p.board.has(offer[1])).toBe(true);
    expect(choose(p, offer[0], offer)).toBe(false);
  });

  it("learn from the board with planks from the workshop's yard", () => {
    const w = buildStarterWorld();
    const station = w.stations.get(w.landscape.towns[0].id)!;
    const piece = appendPiece(w.layout, "depot-workshop", false, connectorRef(station, 0));
    syncIndustries(w);
    const d = w.economy.depotAtPiece(piece)!;
    const p = Progress.fresh();
    d.piles[CARGO.planks.index] = 3;
    expect(learnWithGoods(w, p, "switches")).toBe(false);
    d.piles[CARGO.planks.index] = 5;
    expect(learnWithGoods(w, p, "switches")).toBe(true);
    expect(d.piles[CARGO.planks.index]).toBe(1);
    expect(p.knows("piece:switch")).toBe(true);
    // A town-tier blueprint costs coins too: none taken until there are enough of both.
    p.board.add("sawmills");
    d.piles[CARGO.planks.index] = 20;
    p.coins = 10;
    expect(learnWithGoods(w, p, "sawmills")).toBe(false);
    expect(d.piles[CARGO.planks.index]).toBe(20);
    p.coins = 25;
    expect(learnWithGoods(w, p, "sawmills")).toBe(true);
    expect([d.piles[CARGO.planks.index], p.coins]).toEqual([5, 5]);
    // Not on the board: can't be bought.
    d.piles[CARGO.planks.index] = 12;
    expect(learnWithGoods(w, p, "passengers")).toBe(false);
  });
});

describe("planks kept for the workshop (no route needed)", () => {
  it("fills to the current goal's blueprint: Bridges (10) for \"Build a bridge\" isn't left waiting at 9", () => {
    const p = Progress.fresh();
    p.learned.add("switches");
    p.board.clear();
    for (const id of ["bridges", "signals", "junctions"]) p.board.add(id);
    expect(ready(p, "signals") && ready(p, "bridges") && ready(p, "junctions")).toBe(true);
    expect(priceOf(p, techOf("signals")!).planks).toBe(8);
    const aim = GOALS.find((g) => g.id === "build-bridge")!.blueprint!;
    expect(aim).toBe("bridges");
    expect(planksWanted(p, aim)).toBe(10);
    expect(keepsPlanks(p, 9, aim)).toBe(true);
    expect(keepsPlanks(p, 10, aim)).toBe(false);
  });

  it("with no goal after one, the cheapest ready blueprint (never the dearest: the towns would go short)", () => {
    const p = Progress.fresh();
    p.learned.add("switches");
    p.board.clear();
    for (const id of ["bridges", "signals", "junctions"]) p.board.add(id);
    expect(planksWanted(p)).toBe(8);
    expect(keepsPlanks(p, 9)).toBe(false);
    // A goal's blueprint not ready, or learned: the cheapest.
    p.learned.add("bridges");
    expect(planksWanted(p, "bridges")).toBe(8);
  });

  it("never more than the yard holds, and nothing kept with nothing ready", () => {
    const p = Progress.fresh();
    p.board.clear();
    expect(planksWanted(p)).toBe(0);
    expect(keepsPlanks(p, 0)).toBe(false);
    p.board.add("bridges");
    expect(planksWanted(p, null, 6)).toBe(6);
  });
});

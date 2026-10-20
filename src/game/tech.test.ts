import { describe, expect, it } from "vitest";
import { CARGO } from "../economy/cargo";
import { capOf } from "../economy/economy";
import { appendPiece, connectorRef } from "../track";
import { GOALS } from "./goals";
import { Progress } from "./progress";
import { built, choose, keepsPlanks, learnWithGoods, offerFor, planksWanted, ready, TECHS } from "./tech";
import { THING_RULES } from "./things";
import { buildStarterWorld, syncIndustries } from "./world";

describe("blueprints", () => {
  it("start with nothing on the board (anything ready can be researched); junctions wait for switches, mills for farming", () => {
    const p = Progress.fresh();
    expect([...p.board]).toEqual([]);
    expect(ready(p, "switches") && ready(p, "farming")).toBe(true);
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
    // (No longer the game's way, research is: the old path stays till P4 takes it out.)
    p.board.add("switches");
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
  it("never for blueprints (a school researches them): not for the board's, nor the goal's", () => {
    const p = Progress.fresh();
    p.learned.add("switches");
    for (const id of ["bridges", "signals", "junctions"]) p.board.add(id);
    expect(ready(p, "signals") && ready(p, "bridges") && ready(p, "junctions")).toBe(true);
    expect(GOALS.find((g) => g.id === "build-bridge")!.blueprint).toBe("bridges");
    expect(planksWanted(p)).toBe(0);
    expect(keepsPlanks(p, 0)).toBe(false);
  });

  it("only for the tray order waiting to be made, no more than the yard holds", () => {
    const p = Progress.fresh();
    p.orders.push("piece:depot-workshop");
    expect(planksWanted(p)).toBe(THING_RULES["piece:depot-workshop"]!.cost.planks);
    expect(keepsPlanks(p, 11)).toBe(true);
    expect(keepsPlanks(p, 12)).toBe(false);
    expect(planksWanted(p, 6)).toBe(6);
    // Once it's being made (its planks taken), nothing is kept for it.
    p.making = true;
    expect(planksWanted(p)).toBe(0);
  });
});

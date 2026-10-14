import { describe, expect, it } from "vitest";
import { CARGO } from "../economy/cargo";
import { appendPiece, connectorRef } from "../track";
import { Progress } from "./progress";
import { choose, learnWithGoods, offerFor, ready, TECHS, unlocksOf } from "./tech";
import { THING_RULES } from "./things";
import { buildStarterWorld, syncIndustries } from "./world";

describe("blueprints", () => {
  it("every blueprint a thing needs exists, and every blueprint unlocks something, needing only real blueprints", () => {
    const ids = new Set(TECHS.map((t) => t.id));
    for (const rule of Object.values(THING_RULES)) if (rule!.tech) expect(ids.has(rule!.tech), rule!.label).toBe(true);
    for (const t of TECHS) {
      expect(unlocksOf(t.id).length, t.id).toBeGreaterThan(0);
      for (const n of t.needs) expect(ids.has(n)).toBe(true);
    }
  });

  it("an advanced blueprint waits for a town's landmark: quarries for a library", () => {
    const p = Progress.fresh();
    for (const t of ["harvesters", "farming", "mills"]) p.learned.add(t);
    expect(ready(p, "quarries")).toBe(false);
    p.landmarks.add("library");
    expect(ready(p, "quarries")).toBe(true);
  });

  it("start with switches and bridges on the board; junctions wait for switches", () => {
    const p = Progress.fresh();
    expect([...p.board].sort()).toEqual(["bridges", "switches"]);
    expect(ready(p, "junctions")).toBe(false);
    p.learned.add("switches");
    expect(ready(p, "junctions")).toBe(true);
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
    d.piles[CARGO.planks.index] = 5;
    expect(learnWithGoods(w, p, "switches")).toBe(false);
    d.piles[CARGO.planks.index] = 7;
    expect(learnWithGoods(w, p, "switches")).toBe(true);
    expect(d.piles[CARGO.planks.index]).toBe(1);
    expect(p.knows("piece:switch")).toBe(true);
    // Not on the board: can't be bought.
    d.piles[CARGO.planks.index] = 12;
    expect(learnWithGoods(w, p, "passengers")).toBe(false);
  });
});

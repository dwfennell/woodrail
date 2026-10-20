import { describe, expect, it } from "vitest";
import { Progress } from "./progress";
import { crateFor, firstTimeGift, offerOnGrowth, refreshOffers, takeBlueprint, takeCrate } from "./rewards";
import { techOf } from "./tech";
import { rng } from "../lib/rng";

describe("town rewards", () => {
  it("a growing town offers blueprints for its new size: track for a village, industries for a town", () => {
    for (let seed = 1; seed < 30; seed++) {
      const village = Progress.fresh();
      village.board.clear();
      for (const id of offerOnGrowth(village, "Larkfield", rng(seed), 1)) expect(techOf(id)!.tier ?? 1, id).toBe(1);
      const town = Progress.fresh();
      town.board.clear();
      town.learned.add("switches");
      town.learned.add("farming");
      for (const id of offerOnGrowth(town, "Larkfield", rng(seed), 2)) expect(techOf(id)!.tier, id).toBe(2);
    }
  });

  it("offers a crate instead: things you know, no buildings; taking it puts the blueprints on the board", () => {
    const p = Progress.fresh();
    p.board.clear();
    const ids = offerOnGrowth(p, "Larkfield", rng(7), 1);
    const crate = p.offers[0].crate!;
    expect(crate.length).toBe(2);
    for (const [id] of crate) {
      expect(p.knows(id), id).toBe(true);
      expect(id.startsWith("piece:depot-"), id).toBe(false);
    }
    const before = crate.map(([id]) => p.owned.get(id) ?? 0);
    expect(takeCrate(p, 0)).toBe(true);
    crate.forEach(([id, n], k) => expect(p.owned.get(id)).toBe(before[k] + n));
    for (const id of ids) expect(p.board.has(id)).toBe(true);
    expect(p.offers).toEqual([]);
  });

  it("or a blueprint, learned free (the other on the board)", () => {
    const p = Progress.fresh();
    p.board.clear();
    const [a, b] = offerOnGrowth(p, "Larkfield", rng(3), 1);
    expect(takeBlueprint(p, 0, a)).toBe(true);
    expect(p.learned.has(a)).toBe(true);
    expect(p.board.has(b)).toBe(true);
    expect(p.offers).toEqual([]);
  });

  it("a city's crate is bigger; a crate needs something known", () => {
    const p = Progress.fresh();
    p.learned.add("switches");
    expect(crateFor(p, 3, rng(1)).length).toBe(4);
    expect(crateFor(p, 1, rng(1)).length).toBe(2);
    const bare = new Progress();
    expect(crateFor(bare, 1, rng(1)).length).toBeGreaterThan(0); // engines, timber wagons, turnbacks need no blueprint
  });

  it("first village, town and city each bring a present, once", () => {
    const p = Progress.fresh();
    const engines = p.owned.get("car:engine") ?? 0;
    // The first village: a second train, and a school to research blueprints at.
    expect(firstTimeGift(p, 1)).toEqual([["car:engine", 1], ["car:timber", 1], ["piece:depot-school", 1]]);
    expect(p.owned.get("car:engine")).toBe(engines + 1);
    expect(p.owned.get("piece:depot-school")).toBe(1);
    expect(firstTimeGift(p, 1)).toEqual([]);
    p.learned.add("farming");
    p.learned.add("harvesters");
    // A town: the cheapest industry you know (a farm yard, 90 coins; a harvester is 150; never the 40-coin school).
    expect(firstTimeGift(p, 2)[0]).toEqual(["piece:depot-farm", 1]);
    // Straight to a city from a village: the town's present too.
    const q = Progress.fresh();
    q.learned.add("farming");
    expect(firstTimeGift(q, 3).map(([id]) => id)).toEqual(["car:engine", "car:timber", "piece:depot-school", "piece:depot-farm", "piece:buffer-turnback", "car:engine", "piece:depot-farm"]);
    expect(q.bestLevel).toBe(3);
  });

  it("offers with crates are saved", () => {
    const p = Progress.fresh();
    offerOnGrowth(p, "Larkfield", rng(5), 2);
    p.bestLevel = 2;
    const back = Progress.fromJSON(JSON.parse(JSON.stringify(p.toJSON())));
    expect(back.offers).toEqual(p.offers);
    expect(back.bestLevel).toBe(2);
  });
});

describe("stale offers", () => {
  const stale = () => {
    const p = Progress.fresh();
    p.board.clear();
    p.offers.push({ from: "Larkfield", ids: ["farming", "switches"] }, { from: "Elderwick", ids: ["farming", "switches"] });
    return p;
  };

  it("choosing a blueprint swaps it out of other pending offers", () => {
    const p = stale();
    expect(takeBlueprint(p, 0, "farming", rng(1))).toBe(true);
    expect(p.learned.has("farming")).toBe(true);
    for (const o of p.offers) expect(o.ids).not.toContain("farming");
  });

  it("re-rolls a replacement that is neither learned nor a repeat", () => {
    const p = stale();
    p.learned.add("farming");
    expect(refreshOffers(p, rng(2))).toBe(true);
    for (const o of p.offers) {
      expect(new Set(o.ids).size).toBe(o.ids.length);
      for (const id of o.ids) expect(p.learned.has(id), id).toBe(false);
    }
  });

  it("drops the choice when nothing is left, keeping a crate", () => {
    const p = Progress.fresh();
    p.offers.push({ from: "A", ids: ["farming"] }, { from: "B", ids: ["farming"], crate: [["piece:buffer-turnback", 2]] });
    p.learned.add("farming");
    refreshOffers(p, () => 0);
    for (const o of p.offers) expect(o.ids).not.toContain("farming");
    expect(p.offers.some((o) => o.from === "B" && o.crate)).toBe(true);
  });

  it("tapping a learned blueprint fails and leaves no stale card behind", () => {
    const p = stale();
    p.learned.add("farming");
    expect(takeBlueprint(p, 1, "farming", rng(3))).toBe(false);
    for (const o of p.offers) expect(o.ids).not.toContain("farming");
  });

  it("changes nothing when no offer is stale", () => {
    expect(refreshOffers(stale(), rng(4))).toBe(false);
  });
});

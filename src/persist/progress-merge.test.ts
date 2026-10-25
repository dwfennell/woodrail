import { describe, expect, it } from "vitest";
import { Progress, type ProgressData } from "../game/progress";
import { costOf } from "../game/research";
import { mergeGoals, mergeOffers, mergeProgress, mergeResearch } from "./progress-merge";

const p = (over: Partial<ProgressData>): ProgressData => ({ owned: [], learned: [], coins: 0, ...over });

describe("merging two devices' Game progress (cloud saves)", () => {
  it("coins: the base plus what each earned or spent", () => {
    expect(mergeProgress(p({ coins: 1000 }), p({ coins: 1120 }), p({ coins: 1050 }), "local").coins).toBe(1170);
    // One spent, one earned.
    expect(mergeProgress(p({ coins: 1000 }), p({ coins: 700 }), p({ coins: 1200 }), "local").coins).toBe(900);
    // Never below nothing.
    expect(mergeProgress(p({ coins: 100 }), p({ coins: 0 }), p({ coins: 0 }), "local").coins).toBe(0);
    // No base known: the remote's is it (so the local's change on it counts once).
    expect(mergeProgress(undefined, p({ coins: 1300 }), p({ coins: 1000 }), "remote").coins).toBe(1300);
  });

  it("counters (riders, counts): the base plus each side's", () => {
    const m = mergeProgress(
      p({ riders: 10, counts: [["delivered:planks", 50], ["loadsMoved", 5]] }),
      p({ riders: 14, counts: [["delivered:planks", 60], ["loadsMoved", 5]] }),
      p({ riders: 12, counts: [["delivered:planks", 55], ["delivered:flour", 3], ["loadsMoved", 8]] }),
      "local",
    );
    expect(m.riders).toBe(16);
    expect(new Map(m.counts)).toEqual(new Map([["delivered:planks", 65], ["loadsMoved", 8], ["delivered:flour", 3]]));
  });

  it("the toy box: the base plus what each made or was given", () => {
    const m = mergeProgress(p({ owned: [["piece:straight-216", 4]] }), p({ owned: [["piece:straight-216", 6]] }), p({ owned: [["piece:straight-216", 5], ["car:engine", 1]] }), "remote");
    expect(new Map(m.owned)).toEqual(new Map([["piece:straight-216", 7], ["car:engine", 1]]));
  });

  it("the furthest reached: bestLevel, firstFlour, blueprints learned", () => {
    const m = mergeProgress(p({ bestLevel: 1 }), p({ bestLevel: 2, learned: ["switches"] }), p({ bestLevel: 1, firstFlour: true, learned: ["bridges"] }), "local");
    expect(m.bestLevel).toBe(2);
    expect(m.firstFlour).toBe(true);
    expect(new Set(m.learned)).toEqual(new Set(["switches", "bridges"]));
  });

  it("goals done on either", () => {
    expect(new Set(mergeGoals(["join-towns", "first-delivery"], ["join-towns", "second-train"]))).toEqual(new Set(["join-towns", "first-delivery", "second-train"]));
  });

  it("reward offers: one per town and level (the same growth seen on both: one offer, not two)", () => {
    const larkfield = { from: "Larkfield", level: 2, cards: [{ kind: "coins", n: 50 }] };
    // The same growth on the other device drew other cards.
    const larkfieldThere = { from: "Larkfield", level: 2, cards: [{ kind: "planks", n: 20 }] };
    const ashby = { from: "Ashby", level: 1, cards: [{ kind: "planks", n: 10 }] };
    const m = mergeProgress(p({}), p({ offers: [larkfield] }), p({ offers: [larkfieldThere, ashby] }), "local");
    expect(m.offers).toEqual([larkfield, ashby]);
    // (Larkfield growing again, to a city, is another offer.)
    expect(mergeOffers([], [larkfield], [{ ...larkfield, level: 3 }])).toHaveLength(2);
  });

  it("an offer taken on either side stays taken", () => {
    const larkfield = { from: "Larkfield", level: 2, cards: [{ kind: "coins", n: 50 }] };
    const ashby = { from: "Ashby", level: 1, cards: [{ kind: "planks", n: 10 }] };
    // Both had both; one took Larkfield's, the other Ashby's.
    expect(mergeOffers([larkfield, ashby], [ashby], [larkfield])).toEqual([]);
    // One took Larkfield's; the other still has both, and a new one.
    const brook = { from: "Brook", level: 1, cards: [{ kind: "coins", n: 20 }] };
    expect(mergeOffers([larkfield, ashby], [ashby], [larkfield, ashby, brook])).toEqual([ashby, brook]);
  });

  it("a reward taken on both pays once (QA: the city's 200 coins, taken on both, paid 400)", () => {
    const city = { from: "Larkfield", level: 3, cards: [{ kind: "coins", n: 200 }, { kind: "crate", things: [["piece:switch", 2]] }] };
    const coins = { from: "Larkfield", level: 3, coins: 200 };
    const base = p({ coins: 0, offers: [city] });
    expect(mergeProgress(base, p({ coins: 200, taken: [coins] }), p({ coins: 200, taken: [coins] }), "local").coins).toBe(200);
    // What else each earned still adds up.
    expect(mergeProgress(base, p({ coins: 230, taken: [coins] }), p({ coins: 250, taken: [coins] }), "remote").coins).toBe(280);
    // Different cards of it: the remote's is the one undone (one reward, as if the local's was taken).
    const crate = { from: "Larkfield", level: 3, owned: [["piece:switch", 2]] as [string, number][] };
    const m = mergeProgress(p({ coins: 0, offers: [city], owned: [["piece:switch", 1]] }), p({ coins: 200, taken: [coins], owned: [["piece:switch", 1]] }), p({ coins: 0, taken: [crate], owned: [["piece:switch", 3]] }), "local");
    expect(m.coins).toBe(200);
    expect(m.owned).toEqual([["piece:switch", 1]]);
    expect(m.taken).toEqual([coins]);
    // Taken on one side only: paid, once.
    expect(mergeProgress(base, p({ coins: 200, taken: [coins] }), p({ coins: 0, offers: [city] }), "local").coins).toBe(200);
    // Not in the base (each had its own growth of it before they matched): each side's take stands.
    expect(mergeProgress(p({}), p({ coins: 200, taken: [coins] }), p({ coins: 200, taken: [coins] }), "local").coins).toBe(400);
  });

  it("goods from a reward taken on both go into the research once", () => {
    const need = costOf("bridges").goods;
    const g = Object.keys(need)[0];
    const n = Math.min(3, need[g]! - 1);
    const offer = { from: "Ashby", level: 2, cards: [{ kind: "rare", good: g, n }] };
    const took = { from: "Ashby", level: 2, goods: [[g, n]] as [string, number][], to: "bridges" };
    const research = (k: number) => ({ current: "bridges", next: null, got: k > 0 ? ([[g, k]] as [string, number][]) : [], study: 0 });
    const m = mergeProgress(p({ offers: [offer], research: research(0) }), p({ taken: [took], research: research(n) }), p({ taken: [took], research: research(n) }), "local");
    expect(m.research!.got).toEqual([[g, n]]);
  });

  it("rewards taken are kept through a merge, from both, and read back", () => {
    const a = { from: "Ashby", level: 1, coins: 20 };
    const b = { from: "Brook", level: 2, owned: [["car:engine", 1]] as [string, number][] };
    const m = mergeProgress(p({}), p({ taken: [a] }), p({ taken: [a, b, { from: 7 } as never] }), "local");
    expect(m.taken).toEqual([a, b]);
    expect(Progress.fromJSON(JSON.parse(JSON.stringify(m))).taken).toEqual([a, b]);
  });

  it("the player's queue and fields go with the world kept (the later copy)", () => {
    const local = p({ orders: ["piece:switch"], making: true, fieldsPlanted: 2 });
    const remote = p({ orders: ["car:engine", "piece:switch"], making: false, fieldsPlanted: 1 });
    expect(mergeProgress(p({}), local, remote, "local")).toMatchObject({ orders: ["piece:switch"], making: true, fieldsPlanted: 2 });
    expect(mergeProgress(p({}), local, remote, "remote")).toMatchObject({ orders: ["car:engine", "piece:switch"], making: false, fieldsPlanted: 1 });
  });

  describe("research", () => {
    it("the same one on both: the base plus the goods each brought (CoS: not the most), and the most study", () => {
      const need = costOf("bridges").goods;
      const goods = Object.keys(need);
      expect(goods.length).toBeGreaterThan(0);
      const g = goods[0];
      // Base 2; one side brought 4 more (6), the other 2 more (4): 8, no more than it needs.
      const r = mergeResearch(
        { current: "bridges", next: null, got: [[g, 6]], study: 0 },
        { current: "bridges", next: "signals", got: [[g, 4]], study: 12 },
        new Set(),
        { current: "bridges", next: null, got: [[g, 2]], study: 0 },
      );
      expect(r).toEqual({ current: "bridges", next: "signals", got: [[g, Math.min(need[g], 8)]], study: 12 });
      // Both brought it all: never more than it needs.
      const full = mergeResearch({ current: "bridges", next: null, got: [[g, need[g]]], study: 0 }, { current: "bridges", next: null, got: [[g, need[g]]], study: 0 }, new Set(), { current: null, next: null, got: [], study: 0 });
      expect(full!.got).toEqual([[g, need[g]]]);
      // Kept aside in the base (swapped out), then current on both: counted from what was kept.
      const held = mergeResearch(
        { current: "bridges", next: null, got: [[g, 3]], study: 0 },
        { current: "bridges", next: null, got: [[g, 4]], study: 0 },
        new Set(),
        { current: "signals", next: null, got: [], study: 0, held: [["bridges", { got: [[g, 2]], study: 0 }]] },
      );
      expect(held!.got).toEqual([[g, Math.min(need[g], 5)]]);
    });

    it("learned on either: done (no longer studied, nor waiting)", () => {
      const r = mergeResearch({ current: "bridges", next: "signals", got: [["planks", 6]], study: 0 }, { current: "signals", next: null, got: [], study: 0 }, new Set(["bridges"]));
      expect(r).toMatchObject({ current: "signals", next: null });
    });

    it("two different ones: the one further along stays, the other waits next with its goods kept aside", () => {
      const r = mergeResearch({ current: "bridges", next: null, got: [["planks", 2]], study: 0 }, { current: "signals", next: null, got: [["planks", 8]], study: 0 }, new Set());
      expect(r).toEqual({ current: "signals", next: "bridges", got: [["planks", 8]], study: 0, held: [["bridges", { got: [["planks", 2]], study: 0 }]] });
      // (Its goods come back when it starts: research.ts `promote`.)
      const r2 = mergeResearch({ current: "bridges", next: null, got: [["planks", 9]], study: 0 }, { current: "signals", next: null, got: [["planks", 8]], study: 0 }, new Set());
      expect(r2).toMatchObject({ current: "bridges", next: "signals", held: [["signals", { got: [["planks", 8]], study: 0 }]] });
    });

    it("reads back into the game as it was merged", () => {
      const merged = mergeProgress(
        p({ coins: 100 }),
        p({ coins: 150, learned: ["switches"], research: { current: "bridges", next: null, got: [["planks", 3]], study: 0 } }),
        p({ coins: 130, learned: ["junctions"], research: { current: "bridges", next: null, got: [["planks", 5]], study: 4 } }),
        "local",
      );
      const back = Progress.fromJSON(JSON.parse(JSON.stringify(merged)));
      expect(back.coins).toBe(180);
      expect(back.learned.has("switches") && back.learned.has("junctions")).toBe(true);
      expect(back.research.current).toBe("bridges");
      // (No research in the base: both brought theirs from nothing.)
      expect(back.research.got).toEqual({ planks: Math.min(costOf("bridges").goods.planks ?? Infinity, 8) });
      expect(back.research.study).toBe(4);
    });
  });
});

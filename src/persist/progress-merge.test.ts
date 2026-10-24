import { describe, expect, it } from "vitest";
import { Progress, type ProgressData } from "../game/progress";
import { mergeGoals, mergeProgress, mergeResearch } from "./progress-merge";

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

  it("reward cards waiting: both sides', once each", () => {
    const larkfield = { from: "Larkfield", level: 2, cards: [{ kind: "coins", n: 50 }] };
    const ashby = { from: "Ashby", level: 1, cards: [{ kind: "planks", n: 10 }] };
    const m = mergeProgress(p({}), p({ offers: [larkfield] }), p({ offers: [larkfield, ashby] }), "local");
    expect(m.offers).toEqual([larkfield, ashby]);
  });

  it("the player's queue and fields go with the world kept (the later copy)", () => {
    const local = p({ orders: ["piece:switch"], making: true, fieldsPlanted: 2 });
    const remote = p({ orders: ["car:engine", "piece:switch"], making: false, fieldsPlanted: 1 });
    expect(mergeProgress(p({}), local, remote, "local")).toMatchObject({ orders: ["piece:switch"], making: true, fieldsPlanted: 2 });
    expect(mergeProgress(p({}), local, remote, "remote")).toMatchObject({ orders: ["car:engine", "piece:switch"], making: false, fieldsPlanted: 1 });
  });

  describe("research", () => {
    it("the same one on both: the most of each good, and of the study", () => {
      expect(
        mergeResearch(
          { current: "bridges", next: null, got: [["planks", 6], ["stone", 1]], study: 0 },
          { current: "bridges", next: "signals", got: [["planks", 4], ["stone", 3]], study: 12 },
          new Set(),
        ),
      ).toEqual({ current: "bridges", next: "signals", got: [["planks", 6], ["stone", 3]], study: 12 });
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
      expect(back.research.got).toEqual({ planks: 5 });
      expect(back.research.study).toBe(4);
    });
  });
});

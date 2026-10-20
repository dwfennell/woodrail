import { describe, expect, it } from "vitest";
import { techOf, TECHS, built } from "./tech";
import { Progress } from "./progress";
import { canResearch, coinsShort, costOf, deliver, lacking, lacks, pick, simElapsed, type StudyClock, STUDY_SECONDS, studyLeft, studying, studyTime, tick } from "./research";

/** A player who knows switches (so tier-2 Routes, 10🪵 20🪙, can be researched too). */
function player(coins = 0): Progress {
  const p = Progress.fresh();
  p.learned.add("switches");
  p.coins = coins;
  return p;
}

describe("research costs", () => {
  it("are the blueprints' prices: tier 1 goods only, coins from tier 2, and a chain good where the spec asks", () => {
    expect(costOf("switches")).toEqual({ goods: { planks: 4 } });
    // Halts is tier 1: its 20 coins go.
    expect(costOf("halts")).toEqual({ goods: { planks: 12 } });
    expect(costOf("routes")).toEqual({ goods: { planks: 10 }, coins: 20 });
    expect(costOf("mills")).toEqual({ goods: { planks: 12, grain: 6 }, coins: 20 });
    expect(costOf("goods-engine")).toEqual({ goods: { planks: 12, flour: 6 }, coins: 40 });
    expect(costOf("electricity")).toEqual({ goods: { iron: 10, coal: 10 }, coins: 120 });
    // Every built blueprint has goods to research it with.
    for (const t of TECHS.filter((x) => built(x))) expect(Object.keys(t.research.goods).length, t.id).toBeGreaterThan(0);
  });

  it("study takes 20, 45 or 90 s by tier", () => {
    expect(STUDY_SECONDS).toEqual({ 1: 20, 2: 45, 3: 90 });
    expect(studyTime("switches")).toBe(20);
    expect(studyTime("routes")).toBe(45);
    expect(studyTime("quarries")).toBe(90);
  });
});

describe("picking research", () => {
  it("the first pick is current, the second is next up; picking next again swaps them (nothing lost)", () => {
    const p = player(100);
    expect(pick(p, "signals")).toBe("current");
    expect(pick(p, "bridges")).toBe("next");
    expect([p.research.current, p.research.next]).toEqual(["signals", "bridges"]);
    deliver(p, "planks", 3);
    // Picking current again changes nothing.
    expect(pick(p, "signals")).toBe("current");
    expect(pick(p, "bridges")).toBe("current");
    expect([p.research.current, p.research.next]).toEqual(["bridges", "signals"]);
    expect(p.research.got).toEqual({});
    // Swapped back: signals has its 3 planks again.
    expect(pick(p, "signals")).toBe("current");
    expect(p.research.got).toEqual({ planks: 3 });
    // A third pick takes the next-up slot.
    expect(pick(p, "farming")).toBe("next");
    expect([p.research.current, p.research.next]).toEqual(["signals", "farming"]);
  });

  it("only what can be researched: not learned, not waiting on another blueprint, not coming by itself", () => {
    const p = player();
    expect(pick(p, "switches")).toBeNull();
    expect(pick(p, "mills")).toBeNull();
    expect(pick(p, "dining")).toBeNull();
    expect(pick(p, "tunnels")).toBeNull();
    expect(canResearch(p, "junctions")).toBe(true);
    expect(p.research.current).toBeNull();
  });

  it("tier 2 and up pay their coins when the research starts", () => {
    const p = player(30);
    expect(pick(p, "routes")).toBe("current");
    expect(p.coins).toBe(10);
  });

  it("a pick whose coins are short waits in Next up, saying how many are short, and starts once they're in", () => {
    const p = player(5);
    expect(pick(p, "routes")).toBe("next");
    expect(p.research.current).toBeNull();
    expect(coinsShort(p)).toBe(15);
    expect(p.coins).toBe(5);
    // A school with nothing current takes nothing meanwhile.
    expect(lacking(p, "planks")).toBe(0);
    tick(p, 1);
    expect(p.research.current).toBeNull();
    p.coins = 25;
    tick(p, 1);
    expect([p.research.current, p.research.next, p.coins]).toEqual(["routes", null, 5]);
    expect(coinsShort(p)).toBe(0);
  });

  it("a swap to a next-up pick whose coins are short waits: the current one carries on", () => {
    const p = player(0);
    pick(p, "signals");
    pick(p, "routes");
    expect(pick(p, "routes")).toBe("next");
    expect([p.research.current, p.research.next]).toEqual(["signals", "routes"]);
    expect(coinsShort(p)).toBe(20);
  });
});

describe("goods into the research", () => {
  it("takes only what it still lacks: never more, never a good it doesn't need", () => {
    const p = player();
    pick(p, "signals");
    expect(lacks(p)).toEqual({ planks: 8 });
    expect(lacking(p, "grain")).toBe(0);
    expect(deliver(p, "grain", 3)).toBe(0);
    expect(deliver(p, "planks", 5)).toBe(5);
    expect(deliver(p, "planks", 5)).toBe(3);
    expect(lacking(p, "planks")).toBe(0);
    expect(p.research.got).toEqual({ planks: 8 });
  });

  it("is studied once its goods are in, then learned, and next up starts at once", () => {
    const p = player(100);
    pick(p, "signals");
    pick(p, "bridges");
    deliver(p, "planks", 7);
    expect(studying(p)).toBe(false);
    // No study without all the goods.
    expect(tick(p, 60)).toBeNull();
    expect(p.research.study).toBe(0);
    deliver(p, "planks", 1);
    expect(studying(p)).toBe(true);
    expect(studyLeft(p)).toBe(20);
    expect(tick(p, 19)).toBeNull();
    expect(studyLeft(p)).toBeCloseTo(1);
    expect(tick(p, 1)).toBe("signals");
    expect(p.learned.has("signals")).toBe(true);
    expect([p.research.current, p.research.next]).toEqual(["bridges", null]);
    expect(lacks(p)).toEqual({ planks: 10 });
  });

  it("a faster school studies faster", () => {
    const p = player();
    pick(p, "signals");
    deliver(p, "planks", 8);
    expect(tick(p, 10, 2)).toBe("signals");
  });

  it("nothing decays while goods stop coming", () => {
    const p = player();
    pick(p, "signals");
    deliver(p, "planks", 2);
    for (let k = 0; k < 1000; k++) tick(p, 60);
    expect(p.research.got).toEqual({ planks: 2 });
    expect(p.research.current).toBe("signals");
  });

  it("a research learned some other way (a town's offer) is set aside, and next up starts", () => {
    const p = player();
    pick(p, "signals");
    pick(p, "bridges");
    p.learned.add("signals");
    tick(p, 1);
    expect([p.research.current, p.research.next]).toEqual(["bridges", null]);
  });

  it("changes its version on every change a card shows, and not while nothing happens", () => {
    const p = player();
    pick(p, "signals");
    const v = p.research.version;
    tick(p, 1);
    expect(p.research.version).toBe(v);
    deliver(p, "planks", 8);
    expect(p.research.version).toBe(v + 1);
    tick(p, 0.25);
    tick(p, 0.25);
    // (The seconds left go 20 → 19.75 → 19.5: shown as 20 s, so no change yet.)
    expect(p.research.version).toBe(v + 1);
    tick(p, 0.5);
    expect(p.research.version).toBe(v + 2);
  });
});

describe("study on game time", () => {
  /** The game's workshop clock: every 250 ms of wall time it reads the world's clock and ticks the research by it. */
  function step(p: Progress, clock: StudyClock, simSeconds: number): string | null {
    return tick(p, simElapsed(clock, simSeconds));
  }

  it("stands still while the sim is paused, however long the wall clock runs", () => {
    const p = player();
    pick(p, "signals");
    deliver(p, "planks", 8);
    const clock: StudyClock = { at: null };
    // 10 minutes of 250 ms steps with the world's clock stopped at 42 s.
    for (let k = 0; k < 2400; k++) step(p, clock, 42);
    expect(p.research.study).toBe(0);
    expect(studyLeft(p)).toBe(20);
  });

  it("N seconds of sim are N seconds of study, whatever the wall clock did", () => {
    const p = player();
    pick(p, "signals");
    deliver(p, "planks", 8);
    const clock: StudyClock = { at: null };
    let sim = 100;
    step(p, clock, sim);
    // Under load: 250 ms steps in which the sim gets only 1/16 s, for 160 steps (40 s of wall time, 10 s of play).
    for (let k = 0; k < 160; k++) step(p, clock, (sim += 1 / 16));
    expect(p.research.study).toBeCloseTo(10, 6);
    expect(p.research.current).toBe("signals");
    // A stall: one step after the sim ran 9.5 s; then the last half second.
    expect(step(p, clock, (sim += 9.5))).toBeNull();
    expect(studyLeft(p)).toBeCloseTo(0.5, 6);
    expect(step(p, clock, (sim += 0.5))).toBe("signals");
  });

  it("counts nothing on the first read or when the clock goes back (another session loaded)", () => {
    const clock: StudyClock = { at: null };
    expect(simElapsed(clock, 500)).toBe(0);
    expect(simElapsed(clock, 501.5)).toBe(1.5);
    expect(simElapsed(clock, 3)).toBe(0);
    expect(simElapsed(clock, 4)).toBe(1);
  });
});

describe("saving research (progress, beside the v12 save)", () => {
  it("round-trips current, next, the goods delivered, the study clock and swapped-out researches exactly", () => {
    const p = player(100);
    pick(p, "bridges");
    deliver(p, "planks", 4);
    pick(p, "signals");
    pick(p, "signals");
    deliver(p, "planks", 8);
    tick(p, 7.5);
    const back = Progress.fromJSON(JSON.parse(JSON.stringify(p.toJSON())));
    expect(back.research.current).toBe("signals");
    expect(back.research.next).toBe("bridges");
    expect(back.research.got).toEqual({ planks: 8 });
    expect(back.research.study).toBe(7.5);
    expect([...back.research.held]).toEqual([["bridges", { got: { planks: 4 }, study: 0 }]]);
    // And carries on where it was.
    expect(tick(back, 12.5)).toBe("signals");
    expect(back.research.got).toEqual({ planks: 4 });
  });

  it("drops what it can't use: unknown or learned blueprints, unknown goods, bad numbers", () => {
    const p = Progress.fromJSON({ owned: [], learned: ["switches"], research: { current: "switches", next: "no-such", got: [["planks", 2]], study: 3 } });
    expect([p.research.current, p.research.next, p.research.got, p.research.study]).toEqual([null, null, {}, 0]);
    const q = Progress.fromJSON({ owned: [], learned: [], research: { current: "bridges", next: "bridges", got: [["planks", -1], ["gold", 4], ["planks", 3]], study: "x" } });
    expect([q.research.current, q.research.next, q.research.got, q.research.study]).toEqual(["bridges", null, { planks: 3 }, 0]);
    expect(Progress.fromJSON({ owned: [], learned: [] }).research.current).toBeNull();
    expect(techOf("bridges")).toBeDefined();
  });
});

import { describe, expect, it } from "vitest";
import { techOf, TECHS, built } from "./tech";
import { Progress } from "./progress";
import { canResearch, coinsShort, costOf, deliver, lacking, lacks, pick, QUEUE_MAX, queueOf, queuePlace, simElapsed, startNow, type StudyClock, STUDY_SECONDS, studyLeft, studying, studyTime, tick, toggleQueue } from "./research";

/** A player who knows switches (so tier-2 Routes, with its coins, can be researched too). */
function player(coins = 0): Progress {
  const p = Progress.fresh();
  p.learned.add("switches");
  p.coins = coins;
  return p;
}

describe("research costs", () => {
  it("are the blueprints' prices: tier 1 goods only, coins from tier 2, and a chain good where the spec asks", () => {
    expect(costOf("switches")).toEqual({ goods: { planks: 3 } });
    // The passenger line: light on planks, and from tier 2 mostly coins (P5).
    expect(costOf("halts")).toEqual({ goods: { planks: 6 } });
    expect(costOf("express")).toEqual({ goods: { planks: 10 }, coins: 240 });
    expect(costOf("routes")).toEqual({ goods: { planks: 5 }, coins: 40 });
    expect(costOf("mills")).toEqual({ goods: { planks: 6, grain: 6 }, coins: 40 });
    expect(costOf("goods-engine")).toEqual({ goods: { planks: 6, flour: 6 }, coins: 80 });
    expect(costOf("electricity")).toEqual({ goods: { iron: 10, coal: 10 }, coins: 240 });
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
    const coins = costOf("routes").coins!;
    const p = player(coins + 10);
    expect(pick(p, "routes")).toBe("current");
    expect(p.coins).toBe(10);
  });

  it("a pick whose coins are short waits in Next up, saying how many are short, and starts once they're in", () => {
    const coins = costOf("routes").coins!;
    const p = player(5);
    expect(pick(p, "routes")).toBe("next");
    expect(p.research.current).toBeNull();
    expect(coinsShort(p)).toBe(coins - 5);
    expect(p.coins).toBe(5);
    // A school with nothing current takes nothing meanwhile.
    expect(lacking(p, "planks")).toBe(0);
    tick(p, 1);
    expect(p.research.current).toBeNull();
    p.coins = coins + 5;
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
    expect(coinsShort(p)).toBe(costOf("routes").coins);
  });
});

describe("goods into the research", () => {
  it("takes only what it still lacks: never more, never a good it doesn't need", () => {
    const p = player();
    pick(p, "signals");
    const need = costOf("signals").goods.planks!;
    expect(lacks(p)).toEqual({ planks: need });
    expect(lacking(p, "grain")).toBe(0);
    expect(deliver(p, "grain", 3)).toBe(0);
    expect(deliver(p, "planks", need - 1)).toBe(need - 1);
    expect(deliver(p, "planks", 5)).toBe(1);
    expect(lacking(p, "planks")).toBe(0);
    expect(p.research.got).toEqual({ planks: need });
  });

  it("is studied once its goods are in, then learned, and next up starts at once", () => {
    const p = player(100);
    pick(p, "signals");
    pick(p, "bridges");
    deliver(p, "planks", costOf("signals").goods.planks! - 1);
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
    expect(lacks(p)).toEqual(costOf("bridges").goods);
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
    expect(back.research.got).toEqual({ planks: costOf("signals").goods.planks });
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

describe("the research queue (#14)", () => {
  it("a tap adds to the end, a tap again takes it out; the one under way stays", () => {
    const p = player(100);
    expect(toggleQueue(p, "bridges")).toBe("current");
    expect(toggleQueue(p, "signals")).toBe("queued");
    expect(toggleQueue(p, "junctions")).toBe("queued");
    expect(toggleQueue(p, "farming")).toBe("queued");
    expect([p.research.current, ...queueOf(p.research)]).toEqual(["bridges", "signals", "junctions", "farming"]);
    expect([queuePlace(p.research, "signals"), queuePlace(p.research, "farming"), queuePlace(p.research, "bridges")]).toEqual([1, 3, 0]);
    // Taking out the one up next moves the rest up; taking one from the middle closes the gap.
    expect(toggleQueue(p, "signals")).toBe("removed");
    expect([p.research.next, p.research.later]).toEqual(["junctions", ["farming"]]);
    expect(toggleQueue(p, "farming")).toBe("removed");
    expect([p.research.next, p.research.later]).toEqual(["junctions", []]);
    // The one under way: nothing.
    expect(toggleQueue(p, "bridges")).toBe("current");
    expect(p.research.current).toBe("bridges");
    // Not researchable: nothing.
    expect(toggleQueue(p, "tunnels")).toBeNull();
  });

  it("holds at most QUEUE_MAX waiting", () => {
    const p = player(1000);
    const ready = TECHS.filter((t) => canResearch(p, t.id)).map((t) => t.id);
    expect(ready.length).toBeGreaterThan(QUEUE_MAX + 1);
    for (const id of ready.slice(0, QUEUE_MAX + 1)) expect(toggleQueue(p, id)).not.toBeNull();
    expect(queueOf(p.research)).toHaveLength(QUEUE_MAX);
    expect(toggleQueue(p, ready[QUEUE_MAX + 1])).toBeNull();
    expect(queueOf(p.research)).toHaveLength(QUEUE_MAX);
  });

  it("when one finishes the next starts by itself, paying its coins as it starts; then the one after moves up", () => {
    const p = player(0);
    toggleQueue(p, "bridges");
    toggleQueue(p, "routes"); // 40 coins
    toggleQueue(p, "signals");
    deliver(p, "planks", 10);
    // Learned with the coins short: Routes waits up next, Signals behind it (the queue keeps its order).
    expect(tick(p, 20)).toBe("bridges");
    expect([p.research.current, p.research.next, p.research.later]).toEqual([null, "routes", ["signals"]]);
    expect(coinsShort(p)).toBe(40);
    tick(p, 1);
    expect(p.research.current).toBeNull();
    // The coins come in: it starts on the next tick, paid, and Signals moves up.
    p.coins = 50;
    tick(p, 1);
    expect([p.research.current, p.research.next, p.research.later, p.coins]).toEqual(["routes", "signals", [], 10]);
    // Finished: Signals starts (free of coins).
    deliver(p, "planks", 5);
    expect(tick(p, 45)).toBe("routes");
    expect([p.research.current, p.research.next]).toEqual(["signals", null]);
  });

  it("one learned meanwhile (a town's offer) is skipped", () => {
    const p = player(100);
    toggleQueue(p, "bridges");
    toggleQueue(p, "signals");
    toggleQueue(p, "junctions");
    p.learned.add("signals");
    deliver(p, "planks", 10);
    expect(tick(p, 20)).toBe("bridges");
    expect([p.research.current, p.research.next]).toEqual(["junctions", null]);
  });

  it("Research now: one from the queue swaps in for the one under way, which waits up next keeping its goods", () => {
    const p = player(100);
    toggleQueue(p, "bridges");
    deliver(p, "planks", 4);
    toggleQueue(p, "signals");
    toggleQueue(p, "junctions");
    expect(startNow(p, "junctions")).toBe("current");
    expect([p.research.current, p.research.next, p.research.later]).toEqual(["junctions", "bridges", ["signals"]]);
    expect(p.research.held.get("bridges")).toEqual({ got: { planks: 4 }, study: 0 });
    // Held back while its coins are short (and nothing changes).
    p.coins = 0;
    toggleQueue(p, "routes");
    expect(startNow(p, "routes")).toBe("next");
    expect([p.research.current, ...queueOf(p.research)]).toEqual(["junctions", "bridges", "signals", "routes"]);
    // Not queued: nothing.
    expect(startNow(p, "farming")).toBeNull();
  });

  it("pick (the balance player's) swaps with the one up next and keeps the queue behind it", () => {
    const p = player(100);
    toggleQueue(p, "bridges");
    toggleQueue(p, "signals");
    toggleQueue(p, "junctions");
    expect(pick(p, "signals")).toBe("current");
    expect([p.research.current, p.research.next, p.research.later]).toEqual(["signals", "bridges", ["junctions"]]);
  });

  it("is saved and loaded, in order; a save from before it loads with no queue", () => {
    const p = player(100);
    toggleQueue(p, "bridges");
    toggleQueue(p, "signals");
    toggleQueue(p, "junctions");
    toggleQueue(p, "farming");
    const data = JSON.parse(JSON.stringify(p.toJSON()));
    expect(data.research.later).toEqual(["junctions", "farming"]);
    const back = Progress.fromJSON(data);
    expect([back.research.current, back.research.next, back.research.later]).toEqual(["bridges", "signals", ["junctions", "farming"]]);
    // Bad entries dropped: unknown, learned, repeats, the one under way or up next; and none without a next.
    const q = Progress.fromJSON({ owned: [], learned: ["switches"], research: { current: "bridges", next: "signals", later: ["no-such", "switches", "junctions", "junctions", "bridges", "signals", 7], got: [], study: 0 } });
    expect(q.research.later).toEqual(["junctions"]);
    const r = Progress.fromJSON({ owned: [], learned: [], research: { current: "bridges", next: null, later: ["junctions"], got: [], study: 0 } });
    expect([r.research.next, r.research.later]).toEqual([null, []]);
    // An old save (no `later`), and an empty queue isn't written.
    const old = Progress.fromJSON({ owned: [], learned: [], research: { current: "bridges", next: "signals", got: [], study: 0 } });
    expect(old.research.later).toEqual([]);
    expect("later" in old.toJSON().research!).toBe(false);
  });
});

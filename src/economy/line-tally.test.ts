import { describe, expect, it } from "vitest";
import { LineTally } from "./line-tally";

describe("LineTally", () => {
  it("counts each line's loads over the window, and forgets older ones", () => {
    const t = new LineTally(600, 6);
    t.add(1, 0);
    t.add(1, 50, 2);
    t.add(2, 120);
    expect(t.count(1, 150)).toBe(3);
    expect(t.count(2, 150)).toBe(1);
    expect(t.count(3, 150)).toBe(0);
    // Later: the first loads drop out once they're past the window (a bucket at a time).
    t.add(1, 650);
    expect(t.count(1, 650)).toBe(1);
    expect(t.count(2, 650)).toBe(1);
    expect(t.count(2, 800)).toBe(0);
  });

  it("a long quiet spell empties it; a line pruned is forgotten", () => {
    const t = new LineTally(600, 6);
    t.add(1, 10);
    t.add(1, 10_000);
    expect(t.count(1, 10_000)).toBe(1);
    t.prune(new Set([2]));
    expect(t.count(1, 10_000)).toBe(0);
  });

  it("keeps no more buckets than it counts", () => {
    const t = new LineTally(600, 6);
    for (let tick = 0; tick < 5000; tick += 37) t.add(1, tick);
    const counts = (t as unknown as { lines: Map<number, { counts: number[] }> }).lines.get(1)!.counts;
    expect(counts.length).toBeLessThanOrEqual(6);
    // About 600/37 loads in the window (its current bucket part done).
    expect(t.count(1, 4995)).toBeGreaterThanOrEqual(13);
    expect(t.count(1, 4995)).toBeLessThanOrEqual(17);
  });
});

describe("the economy's line tally", () => {
  it("spans a game month", async () => {
    const { LINE_TALLY_TICKS } = await import("./economy");
    const { MONTH_S } = await import("../game/calendar");
    const { SIM_HZ } = await import("../sim");
    expect(LINE_TALLY_TICKS).toBe(MONTH_S * SIM_HZ);
  });
});

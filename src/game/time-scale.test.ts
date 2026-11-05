import { describe, expect, it } from "vitest";
import { BLUEPRINTS } from "./blueprints";
import { Progress } from "./progress";
import { nextSpeed, slower, SLOW_FRAMES, SLOW_WINDOW, SlowWatch, SIM_BUDGET_MS, speedsOpen } from "./time-scale";

describe("time control", () => {
  it("1× always; Clockmaker opens 2×, Clock tower 3×", () => {
    const p = Progress.fresh();
    expect(speedsOpen(p)).toEqual([1]);
    p.learned.add("clockmaker");
    expect(speedsOpen(p)).toEqual([1, 2]);
    p.learned.add("clock-tower");
    expect(speedsOpen(p)).toEqual([1, 2, 3]);
  });

  it("a tap goes to the next speed open, and round to 1×", () => {
    expect(nextSpeed(1, [1, 2])).toBe(2);
    expect(nextSpeed(2, [1, 2])).toBe(1);
    expect(nextSpeed(2, [1, 2, 3])).toBe(3);
    expect(nextSpeed(3, [1, 2, 3])).toBe(1);
    // (A speed no longer open: from the start.)
    expect(nextSpeed(3, [1, 2])).toBe(1);
  });

  it("a slow phone goes a speed slower: 3× to 2×, 2× to 1×", () => {
    expect(slower(3)).toBe(2);
    expect(slower(2)).toBe(1);
  });

  it("sees the sim falling behind over a window of frames, not a frame or two", () => {
    const w = new SlowWatch();
    let slow = false;
    for (let i = 0; i < SLOW_WINDOW; i++) slow ||= w.record(i < 10, 2);
    expect(slow).toBe(false);
    for (let i = 0; i < SLOW_WINDOW; i++) slow ||= w.record(false, i < SLOW_FRAMES ? SIM_BUDGET_MS + 1 : 1);
    expect(slow).toBe(true);
  });

  it("the blueprints: Clockmaker after the smithy and a college; Clock tower after it, in a city", () => {
    const c = BLUEPRINTS.find((b) => b.id === "clockmaker")!;
    const t = BLUEPRINTS.find((b) => b.id === "clock-tower")!;
    expect([c.plan, t.plan]).toEqual([undefined, undefined]);
    expect(c.needs).toEqual(["smithy", "college"]);
    expect(t.needs).toEqual(["clockmaker"]);
    expect(t.requires.some((n) => n.kind === "level" && n.level === 3)).toBe(true);
  });
});

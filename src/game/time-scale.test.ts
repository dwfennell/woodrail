import { describe, expect, it } from "vitest";
import { BLUEPRINTS } from "./blueprints";
import { Progress } from "./progress";
import { buildStarterWorld } from "./world";
import { nextSpeed, slower, SLOW_FRAMES, SLOW_WINDOW, SlowWatch, SIM_BUDGET_MS, speedsOpen } from "./time-scale";

describe("time control", () => {
  it("1× always; Clockmaker opens 2×, a clock tower standing in a town 3×", () => {
    const p = Progress.fresh();
    const w = buildStarterWorld();
    const towns = w.landscape.towns;
    expect(speedsOpen(p, towns)).toEqual([1]);
    p.learned.add("clockmaker");
    expect(speedsOpen(p, towns)).toEqual([1, 2]);
    // A clock tower standing in a town: a building of it that's the place (how game/places.ts's `townPlaces` knows it;
    // building one by the town's card is tested there, places.test.ts).
    towns[0].buildings[0].landmark = "clock-tower";
    expect(speedsOpen(p, towns)).toEqual([1, 2, 3]);
    // (Without the Clockmaker's clock, a clock tower is only a clock tower.)
    expect(speedsOpen(Progress.fresh(), towns)).toEqual([1]);
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

  it("the blueprints: Clockmaker after the smithy and a college; the Clock tower a town's place, after its town hall", () => {
    const c = BLUEPRINTS.find((b) => b.id === "clockmaker")!;
    const t = BLUEPRINTS.find((b) => b.id === "clock-tower")!;
    expect([c, t]).toEqual([expect.anything(), expect.anything()]);
    expect(c.needs).toEqual(["smithy", "college"]);
    expect(t.needs).toContain("town-hall");
    expect(t.blurb).toMatch(/3×/);
  });
});

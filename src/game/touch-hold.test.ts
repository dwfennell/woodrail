import { describe, expect, it } from "vitest";
import { HOLD_MS, HOLD_SLOP, holdOutcome, holdPicksUp } from "./touch-hold";

describe("long-press to pick up", () => {
  it("a finger that rests long enough picks it up", () => {
    expect(holdOutcome(HOLD_MS - 1, 0, 1)).toBe("wait");
    expect(holdOutcome(HOLD_MS, 0, 1)).toBe("hold");
    expect(holdOutcome(HOLD_MS + 500, 0, 1)).toBe("hold");
  });

  it("a little wobble while resting doesn't spoil it", () => {
    expect(holdOutcome(HOLD_MS, HOLD_SLOP - 1, 1)).toBe("hold");
  });

  it("a finger that moves past the slop pans, even if it then rests", () => {
    expect(holdOutcome(50, HOLD_SLOP, 1)).toBe("pan");
    expect(holdOutcome(HOLD_MS + 500, HOLD_SLOP + 20, 1)).toBe("pan");
  });

  it("a second finger cancels it (two fingers move the view)", () => {
    expect(holdOutcome(100, 0, 2)).toBe("cancel");
    expect(holdOutcome(HOLD_MS, 0, 2)).toBe("cancel");
  });

  it("the timing feels deliberate, not sluggish: past a tap, short of the phone's own long-press", () => {
    expect(HOLD_MS).toBeGreaterThanOrEqual(350);
    expect(HOLD_MS).toBeLessThanOrEqual(400);
    expect(HOLD_SLOP).toBeGreaterThanOrEqual(8);
    expect(HOLD_SLOP).toBeLessThanOrEqual(12);
  });

  it("on touch (and a pen) track, trains and industries can be held; props and roads still want selecting; a mouse never holds", () => {
    for (const pointer of ["touch", "pen"]) {
      for (const target of ["piece", "car", "depot"] as const) expect(holdPicksUp(target, pointer), `${pointer} ${target}`).toBe(true);
      for (const target of ["prop", "road"] as const) expect(holdPicksUp(target, pointer), `${pointer} ${target}`).toBe(false);
    }
    for (const target of ["piece", "car", "depot", "prop", "road"] as const) expect(holdPicksUp(target, "mouse"), target).toBe(false);
  });
});

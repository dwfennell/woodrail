import { describe, expect, it } from "vitest";
import { decideHold, HOLD_MS, HOLD_SLOP, holdPicksUp, undoesHold } from "./touch-hold";

describe("long-press to pick up", () => {
  it("a finger that rests long enough picks it up", () => {
    expect(decideHold(null, HOLD_MS - 1, 1)).toBe("wait");
    expect(decideHold(null, HOLD_MS, 1)).toBe("hold");
    expect(decideHold(null, HOLD_MS + 500, 1)).toBe("hold");
  });

  it("a finger that strays before the hold is up pans, even if it then rests", () => {
    expect(decideHold(50, 60, 1)).toBe("pan");
    expect(decideHold(HOLD_MS - 1, HOLD_MS + 500, 1)).toBe("pan");
  });

  it("rested, then moved: a hold (picked up, then dragged)", () => {
    expect(decideHold(HOLD_MS, HOLD_MS, 1)).toBe("hold");
    expect(decideHold(HOLD_MS + 70, HOLD_MS + 70, 1)).toBe("hold");
  });

  it("decided by the events' times, not by which arrives first: a pan's moves delivered after the timer", () => {
    // The timer fires at 400 ms with no move seen yet: still waiting is wrong only if nothing moved; it waits a frame
    // for queued moves (see Interaction.holdFired). Those moves, stamped 120 ms, then make it a pan.
    expect(decideHold(120, 420, 1)).toBe("pan");
  });

  it("…and a real hold whose timer fires late: the first move, stamped after the hold was up, picks it up", () => {
    // Rested 450 ms, then dragged; the timer ran 200 ms late, so the drag's first move is the first thing seen.
    expect(decideHold(450, 450, 1)).toBe("hold");
  });

  it("a second finger cancels it (two fingers move the view)", () => {
    expect(decideHold(null, 100, 2)).toBe("cancel");
    expect(decideHold(null, HOLD_MS, 2)).toBe("cancel");
    expect(decideHold(500, 500, 2)).toBe("cancel");
  });

  it("the timing feels deliberate, not sluggish: past a tap, short of the phone's own long-press", () => {
    expect(HOLD_MS).toBeGreaterThanOrEqual(350);
    expect(HOLD_MS).toBeLessThanOrEqual(400);
    expect(HOLD_SLOP).toBeGreaterThanOrEqual(8);
    expect(HOLD_SLOP).toBeLessThanOrEqual(12);
  });

  it("on touch (and a pen) track, trains, industries and cargo can be held; props and roads still want selecting; a mouse never holds", () => {
    for (const pointer of ["touch", "pen"]) {
      for (const target of ["piece", "car", "depot", "cargo"] as const) expect(holdPicksUp(target, pointer), `${pointer} ${target}`).toBe(true);
      for (const target of ["prop", "road"] as const) expect(holdPicksUp(target, pointer), `${pointer} ${target}`).toBe(false);
    }
    for (const target of ["piece", "car", "depot", "prop", "road", "cargo"] as const) expect(holdPicksUp(target, "mouse"), target).toBe(false);
  });

  it("a pickup by the timer is undone by late events that happened in time: a stray (a pan) or a lift (a tap)", () => {
    expect(undoesHold(40, HOLD_SLOP + 5, false)).toBe(true);
    expect(undoesHold(200, 0, true)).toBe(true);
    // A wobble in time, or anything after the hold's time, leaves it held.
    expect(undoesHold(40, HOLD_SLOP - 1, false)).toBe(false);
    expect(undoesHold(HOLD_MS, HOLD_SLOP + 5, false)).toBe(false);
    expect(undoesHold(HOLD_MS + 100, 0, true)).toBe(false);
  });
});

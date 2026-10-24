import { afterEach, describe, expect, it, vi } from "vitest";
import { LIFT_TIP, liftHeldMessage, liftTipSeen, markLiftTipSeen, TOO_LONG_AGAIN_MS, TOO_LONG_MESSAGE, TooLongNotice } from "./lift-notice";

describe("a train too long for a lift is told once, not on every approach", () => {
  it("once per train (by its cars: turned back, it comes again as a new train with the same cars)", () => {
    const n = new TooLongNotice();
    expect(n.shouldTell([1, 2, 3, 4], 0)).toBe(true);
    // Back again, and again (a new train id each time it's turned round; its cars the same).
    expect(n.shouldTell([1, 2, 3, 4], 10_000)).toBe(false);
    expect(n.shouldTell([4, 3, 2, 1], 60_000)).toBe(false);
    // A car taken off and the rest coming back: still the train told.
    expect(n.shouldTell([1, 2, 3], 90_000)).toBe(false);
    // Another train is told too.
    expect(n.shouldTell([7, 8, 9, 10], 100_000)).toBe(true);
    expect(n.shouldTell([7, 8, 9, 10], 100_500)).toBe(false);
  });

  it("again after a few minutes", () => {
    const n = new TooLongNotice();
    expect(n.shouldTell([1, 2, 3, 4], 0)).toBe(true);
    expect(n.shouldTell([1, 2, 3, 4], TOO_LONG_AGAIN_MS - 1)).toBe(false);
    expect(n.shouldTell([1, 2, 3, 4], TOO_LONG_AGAIN_MS)).toBe(true);
    expect(n.shouldTell([1, 2, 3, 4], TOO_LONG_AGAIN_MS + 1000)).toBe(false);
  });

  it("no car ids (missing or empty): told once by the train's id, not on every approach", () => {
    const n = new TooLongNotice();
    expect(n.shouldTell([], 0, 5)).toBe(true);
    expect(n.shouldTell([], 1000, 5)).toBe(false);
    expect(n.shouldTell(undefined, 2000, 5)).toBe(false);
    // Another train, also without cars: told.
    expect(n.shouldTell(undefined, 3000, 6)).toBe(true);
    // A train's id doesn't clash with a car of the same number.
    expect(n.shouldTell([5], 4000, 9)).toBe(true);
    // Again after a few minutes.
    expect(n.shouldTell([], TOO_LONG_AGAIN_MS, 5)).toBe(true);
    // Nothing to key on: never told (rather than told on every approach).
    expect(n.shouldTell([], 0)).toBe(false);
    expect(n.shouldTell(undefined, 0)).toBe(false);
  });

  it("names the train lift", () => {
    expect(TOO_LONG_MESSAGE).toBe("That train's too long for the train lift: an engine and two cars fit");
    expect(LIFT_TIP).toBe("Tap the train lift to send it");
    expect(liftHeldMessage(true)).toBe("A train is on that track");
    expect(liftHeldMessage(false)).toBe("The train lift is still moving");
  });
});

describe("the lift's first-time tip", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("is remembered on the device, as the passing-loop tip is", () => {
    const store = new Map<string, string>();
    vi.stubGlobal("localStorage", { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v) });
    expect(liftTipSeen()).toBe(false);
    markLiftTipSeen();
    expect(store.get("woodrail.liftTip")).toBe("1");
    expect(liftTipSeen()).toBe(true);
  });

  it("storage unavailable: not seen, and marking it doesn't throw", () => {
    const fail = () => {
      throw new Error("blocked");
    };
    vi.stubGlobal("localStorage", { getItem: fail, setItem: fail });
    expect(liftTipSeen()).toBe(false);
    expect(() => markLiftTipSeen()).not.toThrow();
  });
});

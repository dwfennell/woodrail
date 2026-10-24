import { afterEach, describe, expect, it, vi } from "vitest";
import { Sim } from "../sim";
import { Layout } from "../track";
import { PIN_HINT, PIN_HOW_HINT, PinHint, UNPINNED } from "./switch-pin";
import { decideHold, HOLD_MS, HOLD_SLOP, PIN_HOLD_MS, undoesHold } from "./touch-hold";

function fakeStorage(): Storage {
  const m = new Map<string, string>();
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, v),
    removeItem: (k) => void m.delete(k),
    clear: () => m.clear(),
    key: () => null,
    get length() {
      return m.size;
    },
  };
}

describe("pinning a switch with a long press on its lever", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("a press resting about 450 ms pins; a tap, or a slower tap, flips (it's let go first)", () => {
    expect(PIN_HOLD_MS).toBeGreaterThan(HOLD_MS);
    expect(PIN_HOLD_MS).toBeLessThan(500);
    expect(decideHold(null, 300, 1, PIN_HOLD_MS)).toBe("wait");
    expect(decideHold(null, HOLD_MS + 10, 1, PIN_HOLD_MS)).toBe("wait");
    expect(decideHold(null, PIN_HOLD_MS, 1, PIN_HOLD_MS)).toBe("hold");
    // A finger that strays first is a pan (or a tap where it's let go), not a pin; a second finger is the camera's.
    expect(decideHold(200, PIN_HOLD_MS + 50, 1, PIN_HOLD_MS)).toBe("pan");
    expect(decideHold(null, PIN_HOLD_MS, 2, PIN_HOLD_MS)).toBe("cancel");
    // Pinned by a late timer: a lift, or a stray, that happened before the time undoes it.
    expect(undoesHold(300, 0, true, PIN_HOLD_MS)).toBe(true);
    expect(undoesHold(420, HOLD_SLOP, false, PIN_HOLD_MS)).toBe(true);
    expect(undoesHold(PIN_HOLD_MS + 5, 0, true, PIN_HOLD_MS)).toBe(false);
  });

  it("what a pin does is said the first time a switch is pinned, never again (nor on this device later)", () => {
    vi.stubGlobal("localStorage", fakeStorage());
    const hint = new PinHint();
    expect(hint.next(true)).toBe(PIN_HINT);
    expect(hint.next(true)).toBeNull();
    // Another visit on this device: seen.
    expect(new PinHint().next(true)).toBeNull();
  });

  it("an unpin says so, every time (QA N3: it was only a buzz)", () => {
    vi.stubGlobal("localStorage", fakeStorage());
    const hint = new PinHint();
    expect(hint.next(false)).toBe(UNPINNED);
    hint.next(true);
    expect(hint.next(false)).toBe(UNPINNED);
    expect(hint.next(false)).toBe(UNPINNED);
  });

  it("how to pin is said once before the first pin (a lever tapped, or a train's throw in view), never after a pin", () => {
    vi.stubGlobal("localStorage", fakeStorage());
    const hint = new PinHint();
    expect(hint.how()).toBe(PIN_HOW_HINT);
    expect(hint.how()).toBeNull();
    expect(new PinHint().how()).toBeNull();
    // A player who pins before ever being told: not told afterwards.
    vi.stubGlobal("localStorage", fakeStorage());
    const pinner = new PinHint();
    pinner.next(true);
    expect(pinner.how()).toBeNull();
    expect(new PinHint().how()).toBeNull();
  });

  it("a pin undone (a slow phone's late lift: it was a tap) takes back what it said: the tap says how to pin", () => {
    vi.stubGlobal("localStorage", fakeStorage());
    const hint = new PinHint();
    const was = hint.state();
    // The pin's timer pinned it: what a pin does is said, and how to pin goes without saying...
    expect(hint.next(true)).toBe(PIN_HINT);
    expect(hint.how()).toBeNull();
    // ...but the lift came late, before the pin's time: undone, as if it never was, here and on the device.
    hint.restore(was);
    expect(hint.how()).toBe(PIN_HOW_HINT);
    expect(new PinHint().next(true)).toBe(PIN_HINT);
    // And a real pin after says what a pin does, once.
    expect(hint.next(true)).toBe(PIN_HINT);
    expect(hint.next(true)).toBeNull();
  });

  it("a pin undone after the hints were said before leaves them said", () => {
    vi.stubGlobal("localStorage", fakeStorage());
    const hint = new PinHint();
    expect(hint.how()).toBe(PIN_HOW_HINT);
    expect(hint.next(true)).toBe(PIN_HINT);
    const was = hint.state();
    expect(hint.next(true)).toBeNull();
    hint.restore(was);
    expect(hint.how()).toBeNull();
    expect(hint.next(true)).toBeNull();
    expect(new PinHint().how()).toBeNull();
    expect(new PinHint().next(true)).toBeNull();
  });

  it("a tap still flips a pinned switch by hand, and it stays pinned", () => {
    const layout = new Layout();
    const id = layout.addPiece("switch", { x: 0, z: 0, heading: 0 });
    const sim = new Sim(layout);
    layout.setPinned(id, true);
    const v = layout.switchesVersion;
    expect(sim.toggleSwitch(id)).toBe(true);
    expect(layout.switchState(id)).toBe(1);
    expect(layout.isPinned(id)).toBe(true);
    expect(layout.switchesVersion).toBeGreaterThan(v);
    sim.toggleSwitch(id);
    expect(layout.switchState(id)).toBe(0);
  });

  it("pinning and unpinning bumps the switches' version (they're redrawn), a plain piece can't be pinned", () => {
    const layout = new Layout();
    const id = layout.addPiece("switch-3way", { x: 0, z: 0, heading: 0 });
    const plain = layout.addPiece("straight-144", { x: 400, z: 0, heading: 0 });
    const v = layout.switchesVersion;
    layout.setPinned(id, !layout.isPinned(id));
    expect(layout.isPinned(id)).toBe(true);
    layout.setPinned(id, !layout.isPinned(id));
    expect(layout.isPinned(id)).toBe(false);
    expect(layout.switchesVersion).toBe(v + 2);
    layout.setPinned(plain, true);
    expect(layout.isPinned(plain)).toBe(false);
  });
});

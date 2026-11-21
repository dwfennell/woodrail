import { describe, expect, it } from "vitest";
import { PAUSE_GRACE_S, PAUSED_BUILDING_S, PausedTip, type PausedLook } from "./paused-tip";

const look = (now: number, o: Partial<PausedLook> = {}): PausedLook => ({ now, paused: false, card: -1, track: 0, quiet: false, ...o });

describe("situation tips: the game is paused", () => {
  it("a train's card opened while paused says it, toasted once; running again, it goes", () => {
    const t = new PausedTip();
    t.update(look(0));
    t.update(look(5, { paused: true }));
    expect(t.update(look(30, { paused: true })).first).toBe(false);
    const r = t.update(look(31, { paused: true, card: 7 }));
    expect(r.first).toBe(true);
    expect(t.current()?.title).toBe("The game is paused");
    expect(t.update(look(32, { paused: true, card: 7 })).first).toBe(false);
    expect(t.update(look(40, { card: 7 })).changed).toBe(true);
    expect(t.current()).toBeNull();
  });

  it("not in the first seconds after the player pressed Pause", () => {
    const t = new PausedTip();
    t.update(look(0));
    t.update(look(1, { paused: true }));
    expect(t.update(look(1 + PAUSE_GRACE_S - 1, { paused: true, card: 3 })).first).toBe(false);
    // (The card was open already: only a card opened after counts.)
    expect(t.update(look(1 + PAUSE_GRACE_S + 5, { paused: true, card: 3 })).first).toBe(false);
    expect(t.update(look(1 + PAUSE_GRACE_S + 6, { paused: true, card: 4 })).first).toBe(true);
  });

  it("a save read back paused: a tap on a train says it at once", () => {
    const t = new PausedTip();
    t.update(look(0, { paused: true }));
    expect(t.update(look(1, { paused: true, card: 2 })).first).toBe(true);
  });

  it("laying track two minutes into a pause says it; laying none doesn't", () => {
    const t = new PausedTip();
    t.update(look(0));
    t.update(look(1, { paused: true, track: 10 }));
    expect(t.update(look(60, { paused: true, track: 14 })).first).toBe(false);
    expect(t.update(look(1 + PAUSED_BUILDING_S, { paused: true, track: 15 })).first).toBe(true);
    const idle = new PausedTip();
    idle.update(look(0));
    idle.update(look(1, { paused: true, track: 10 }));
    expect(idle.update(look(1000, { paused: true, track: 10 })).first).toBe(false);
  });

  it("once a session, even dismissed", () => {
    const t = new PausedTip();
    t.update(look(0, { paused: true }));
    t.update(look(1, { paused: true, card: 2 }));
    t.dismiss();
    expect(t.current()).toBeNull();
    t.update(look(2));
    t.update(look(100, { paused: true }));
    expect(t.update(look(200, { paused: true, card: 5 })).first).toBe(false);
    expect(t.current()).toBeNull();
  });

  it("quiet (the tutorial, ☰ Tips off): nothing said, and a tip showing goes", () => {
    const t = new PausedTip();
    t.update(look(0, { paused: true }));
    expect(t.update(look(1, { paused: true, card: 2, quiet: true })).first).toBe(false);
    expect(t.update(look(2, { paused: true, card: 3 })).first).toBe(true);
    expect(t.update(look(3, { paused: true, card: 3, quiet: true })).changed).toBe(true);
    expect(t.current()).toBeNull();
  });
});

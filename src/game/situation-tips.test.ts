import { describe, expect, it } from "vitest";
import { FIRST_AFTER_S, FIX_WINDOW_S, GAP_S, MAX_SHOWS, SNOOZE_S, SituationTracker, type Detector, type Situation, type SituationContext } from "./situation-tips";
import type { World } from "./world";

/** A detector that finds what `state.on` says (no world needed). */
function fake(id: string, state: { on: boolean; key?: string }, every = 5, hold = 5): Detector {
  return {
    id,
    every,
    hold,
    look: (): Situation | null =>
      state.on ? { id, key: state.key ?? "k", title: `${id} title`, short: id, text: `${id} text`, toast: `${id} toast`, fixed: `✓ ${id}` } : null,
  };
}

const w = {} as World;
const ctx: SituationContext = { learned: null, nameOf: () => "" };
const open = (now: number) => ({ now, quiet: false });

/** Run the tracker from `from` to `to` game s, a check a second; returns what was toasted and fixed. */
function run(t: SituationTracker, from: number, to: number, quiet = false) {
  const firsts: string[] = [];
  const fixed: string[] = [];
  for (let now = from; now <= to; now++) {
    const r = t.update(w, ctx, { now, quiet });
    if (r.first) firsts.push(r.first.id);
    if (r.fixed) fixed.push(r.fixed.id);
  }
  return { firsts, fixed };
}

describe("situation tips: the tracker", () => {
  it("says nothing in a game's first minutes, then shows once held, and toasts it once", () => {
    const s = { on: true };
    const t = new SituationTracker(null, [fake("jam", s)]);
    run(t, 0, FIRST_AFTER_S - 1);
    expect(t.current()).toBeNull();
    const { firsts } = run(t, FIRST_AFTER_S, FIRST_AFTER_S + 10);
    expect(t.current()?.id).toBe("jam");
    expect(firsts).toEqual(["jam"]);
  });

  it("waits while quiet (the tutorial, ☰ Tips off)", () => {
    const t = new SituationTracker(null, [fake("jam", { on: true })]);
    run(t, 0, 400, true);
    expect(t.current()).toBeNull();
    run(t, 401, 410);
    expect(t.current()?.id).toBe("jam");
  });

  it("needs the situation held: found once and gone isn't said", () => {
    const s = { on: true };
    const t = new SituationTracker(null, [fake("jam", s, 5, 10)]);
    // (Found at 200, gone by its next look at 205: never held 10 s.)
    t.update(w, ctx, open(200));
    s.on = false;
    run(t, 201, 260);
    expect(t.current()).toBeNull();
  });

  it("one at a time, the first detector first", () => {
    const t = new SituationTracker(null, [fake("a", { on: true }), fake("b", { on: true })]);
    run(t, 200, 220);
    expect(t.current()?.id).toBe("a");
  });

  it("cleared soon after the player looked: fixed, done, with its ✓", () => {
    const s = { on: true };
    const t = new SituationTracker(null, [fake("jam", s)]);
    run(t, 200, 210);
    t.looked(211);
    s.on = false;
    const { fixed } = run(t, 212, 230);
    expect(fixed).toEqual(["jam"]);
    expect(t.isDone("jam")).toBe(true);
    s.on = true;
    run(t, 231, 2000);
    expect(t.current()).toBeNull();
  });

  it("cleared by itself: snoozed, back later without a second toast", () => {
    const s = { on: true };
    const t = new SituationTracker(null, [fake("jam", s)]);
    run(t, 200, 210);
    s.on = false;
    const gone = run(t, 211, 220);
    expect(gone.fixed).toEqual([]);
    expect(t.current()).toBeNull();
    s.on = true;
    // (Not before the snooze is over, nor the gap after a tip.)
    run(t, 221, 215 + SNOOZE_S - 10);
    expect(t.current()).toBeNull();
    const back = run(t, 215 + SNOOZE_S - 9, 230 + SNOOZE_S + GAP_S);
    expect(t.current()?.id).toBe("jam");
    expect(back.firsts).toEqual([]);
  });

  it("looked at long before it cleared isn't the player's fix", () => {
    const s = { on: true };
    const t = new SituationTracker(null, [fake("jam", s)]);
    run(t, 200, 210);
    t.looked(210);
    run(t, 211, 210 + FIX_WINDOW_S + 10);
    s.on = false;
    const { fixed } = run(t, 211 + FIX_WINDOW_S + 10, 300 + FIX_WINDOW_S);
    expect(fixed).toEqual([]);
    expect(t.isDone("jam")).toBe(false);
  });

  it(`shown ${MAX_SHOWS} times in a game, it doesn't come back`, () => {
    const s = { on: true };
    const t = new SituationTracker(null, [fake("jam", s)]);
    let now = 200;
    for (let k = 0; k < MAX_SHOWS; k++) {
      s.on = true;
      while (!t.current() && now < 20000) t.update(w, ctx, open(now++));
      expect(t.current()?.id).toBe("jam");
      s.on = false;
      while (t.current()) t.update(w, ctx, open(now++));
    }
    expect(t.isDone("jam")).toBe(true);
  });

  it("Got it: that kind is done for this game; ☰ Tips back on shows it again", () => {
    const s = { on: true };
    const t = new SituationTracker(null, [fake("jam", s)]);
    run(t, 200, 210);
    t.dismiss("jam", 210);
    expect(t.current()).toBeNull();
    run(t, 211, 2000);
    expect(t.current()).toBeNull();
    t.showAgain();
    run(t, 2001, 2010);
    expect(t.current()?.id).toBe("jam");
  });

  it("the same kind about something else: the row follows it", () => {
    const s = { on: true, key: "line:1" };
    const t = new SituationTracker(null, [fake("jam", s)]);
    run(t, 200, 210);
    s.key = "line:2";
    run(t, 211, 220);
    expect(t.current()?.key).toBe("line:2");
  });

  it("saved and read back (per game), unknown kinds dropped", () => {
    const s = { on: true };
    const t = new SituationTracker(null, [fake("jam", s)]);
    run(t, 200, 210);
    t.dismiss("jam", 211);
    const back = new SituationTracker({ ...t.toJSON(), done: [...t.toJSON().done, "gone-kind"] }, [fake("jam", s)]);
    expect(back.isDone("jam")).toBe(true);
    expect(back.toJSON().done).toEqual(["jam"]);
    expect(back.toJSON().toasted).toEqual(["jam"]);
  });

  it("looks no more often than its interval (cheap: a game second's check skips it)", () => {
    let looks = 0;
    const d: Detector = { id: "jam", every: 5, hold: 0, look: () => (looks++, null) };
    const t = new SituationTracker(null, [d]);
    run(t, 0, 99);
    expect(looks).toBe(20);
    // (Paused: the clock stands still, no looks.)
    for (let k = 0; k < 50; k++) t.update(w, ctx, open(100));
    expect(looks).toBe(21);
  });
});

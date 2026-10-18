import { describe, expect, it } from "vitest";
import { GoalTicks, goalsDoneText, joins } from "./goal-ticks";

describe("goal ticks merged into one toast and News line", () => {
  const up = () => true;

  it("one goal is a tick, several a count", () => {
    expect(goalsDoneText(["A"])).toBe("✓ A");
    expect(goalsDoneText(["A", "B"])).toBe("2 goals done: A · B");
    expect(goalsDoneText(["A", "B", "C", "D"], 2)).toBe("4 goals done: A · B · …");
    expect(goalsDoneText(["A", "B"], 2)).toBe("2 goals done: A · B");
  });

  it("goals a moment apart in game time join, the toast says the last one's in place of the first's", () => {
    const t = new GoalTicks();
    expect(t.tick(["A"], 10, 0, up)).toEqual({ kind: "new", toast: "✓ A", news: "✓ A" });
    expect(t.tick(["B"], 11, 1000, up)).toEqual({ kind: "merge", oldToast: "✓ A", toast: "2 goals done: A · B", news: "2 goals done: A · B" });
  });

  it("a long chain's toast is capped; its News line names them all", () => {
    const t = new GoalTicks();
    t.tick(["A"], 0, 0, up);
    t.tick(["B"], 1, 1000, up);
    const third = t.tick(["C"], 2, 2000, up);
    expect(third).toMatchObject({ oldToast: "2 goals done: A · B", toast: "3 goals done: A · B · …" });
    const fourth = t.tick(["D"], 3, 3000, up);
    expect(fourth).toEqual({ kind: "merge", oldToast: "3 goals done: A · B · …", toast: "4 goals done: A · B · …", news: "4 goals done: A · B · C · D" });
  });

  it("a goal whose toast has gone isn't said again in a later one", () => {
    const t = new GoalTicks();
    t.tick(["A"], 5, 0, up);
    // Paused: no game time passed, and "✓ A" has been shown and gone.
    const said = t.tick(["B"], 5, 3500, (toast) => toast !== "✓ A");
    expect(said).toEqual({ kind: "new", toast: "✓ B", news: "✓ B" });
  });

  it("after a long pause (no game time, but a while by the clock), a goal is news of its own", () => {
    const t = new GoalTicks();
    t.tick(["A"], 5, 0, up);
    expect(t.tick(["B"], 5, 60_000, up)).toEqual({ kind: "new", toast: "✓ B", news: "✓ B" });
    // Still paused, a moment later: joins the new one, not the old.
    expect(t.tick(["C"], 5, 61_000, up)).toMatchObject({ kind: "merge", oldToast: "✓ B", news: "2 goals done: B · C" });
  });

  it("goals far apart in game time don't join, however soon by the clock (fast-forward)", () => {
    const t = new GoalTicks();
    t.tick(["A"], 0, 0, up);
    expect(t.tick(["B"], 3, 1000, up).kind).toBe("new");
  });

  it("a dropped line (no News entry written) has nothing to join", () => {
    const t = new GoalTicks();
    t.tick(["A"], 0, 0, up);
    t.drop();
    expect(t.tick(["B"], 0.5, 500, up).kind).toBe("new");
  });

  it("joins: within the game-time window and the clock's clamp", () => {
    const m = { at: 10, wallAt: 1000 };
    expect(joins(m, 11, 2000, 1.5)).toBe(true);
    expect(joins(m, 11.5, 2000, 1.5)).toBe(false);
    expect(joins(m, 10, 1000 + 10_000, 1.5)).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import { buildStarterWorld } from "../game/world";
import { GOALS, GoalTracker } from "../game/goals";
import { goalsCountText } from "./goals-panel";

const LOCKED = GOALS.find((g) => g.needs)!;

describe("the goals panel's count", () => {
  it("counts a goal waiting for blueprints: every other goal done is not all done", () => {
    const t = new GoalTracker(GOALS.filter((g) => g !== LOCKED).map((g) => g.id));
    t.update(buildStarterWorld(), { learned: new Set() });
    expect(t.lockedCount).toBe(1);
    expect(goalsCountText(t.doneCount, t.total, t.lockedCount)).toBe(`${GOALS.length - 1} / ${GOALS.length}`);
    expect(goalsCountText(16, 16, 1)).toBe("16 / 17");
  });

  it("once learned it's open, not locked: the same count", () => {
    const t = new GoalTracker(GOALS.filter((g) => g !== LOCKED).map((g) => g.id));
    t.update(buildStarterWorld(), { learned: new Set(LOCKED.needs) });
    expect(t.lockedCount).toBe(0);
    expect(goalsCountText(t.doneCount, t.total, t.lockedCount)).toBe(`${GOALS.length - 1} / ${GOALS.length}`);
  });

  it("all done: n / n", () => {
    const t = new GoalTracker(GOALS.map((g) => g.id));
    expect(goalsCountText(t.doneCount, t.total, t.lockedCount)).toBe(`${GOALS.length} / ${GOALS.length}`);
  });
});

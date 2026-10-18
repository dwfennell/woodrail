import { describe, expect, it } from "vitest";
import { pressDraws } from "./draw-press";

describe("pressDraws (the planning guard)", () => {
  it("draws only with Draw on and no route being planned", () => {
    expect(pressDraws(true, false)).toBe(true);
    expect(pressDraws(true, true)).toBe(false);
    expect(pressDraws(false, false)).toBe(false);
    expect(pressDraws(false, true)).toBe(false);
  });
});

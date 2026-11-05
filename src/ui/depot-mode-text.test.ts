import { describe, expect, it } from "vitest";
import { depotModeText } from "./hud";

describe("depotModeText", () => {
  it("says what the crane's toggles do now", () => {
    expect(depotModeText(true, true)).toMatch(/wait.*full/i);
    expect(depotModeText(true, false)).toMatch(/what's ready/);
    expect(depotModeText(false, true)).toMatch(/by hand/);
  });
  it("says nothing where there's no wait toggle", () => {
    expect(depotModeText(true, null)).toBe("");
  });
});

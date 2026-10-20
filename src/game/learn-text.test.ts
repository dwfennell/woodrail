import { describe, expect, it } from "vitest";
import { unlocksOf } from "./tech";
import { ruleOf } from "./things";
import { makesLine, plural } from "./learn-text";

describe("what a learned blueprint lets you make", () => {
  it("reads as a natural list", () => {
    expect(makesLine(["Switch", "Y switch"])).toBe("Make a switch or a Y switch at the workshop");
    expect(makesLine(["Ramp", "Curved ramp", "Riser", "Bridge"])).toBe("Make ramps and more at the workshop");
    expect(makesLine(["Signal"])).toBe("Make a signal at the workshop");
    expect(makesLine(["Engine shed", "Water tower"])).toBe("Make an engine shed or a water tower at the workshop");
    expect(plural("switch")).toBe("switches");
  });

  it("for the real blueprints, never 'x and y and more'", () => {
    for (const id of ["switches", "bridges", "junctions"]) {
      const line = makesLine(unlocksOf(id).map((t) => ruleOf(t)!.label));
      expect(line).not.toMatch(/ and .* and /);
      expect(line).toMatch(/^Make /);
    }
  });
});

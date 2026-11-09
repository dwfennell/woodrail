import { describe, expect, it } from "vitest";
import { b4Sweep, invariantsHold } from "./sections-qa-testing";

// QA's B4 sweep, loop 0's roads (the sweep is `b4Sweep` in sections-qa-testing.ts; the other loop's roads are
// sections-qa-b4-l1.test.ts).
describe("sections: QA's B2/B3 park cases", { timeout: 600_000 }, () => {
  it("B4: a train put down on any loop road at any time (loop 0's roads): no head-ons; where it doesn't run on, every train says what to do", () => {
    expect(b4Sweep(["l0.side", "l0.main"])).toEqual([]);
  });
});

invariantsHold();

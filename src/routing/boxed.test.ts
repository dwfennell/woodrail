import { describe, expect, it } from "vitest";
import { Layout } from "../track";
import { boxedConvoy } from "./boxed";
import { HarnessRun, type Scenario } from "./harness";
import * as S from "./scenarios";

/**
 * The boxed-in convoy (boxed.ts, the user's decision (4)): "a route never makes it worse" (harness-fuzz.test.ts) excuses
 * a routed run's stalls only when each, as it began, was this shape. Narrow: a routed stall of any other kind is not
 * excused, so that check still fails on it.
 */

/** Run `sc` till its first stall begins: whether the trains then said stuck are a boxed-in convoy (null: no stall). */
function atFirstStall(sc: Scenario): boolean | null {
  const run = new HarnessRun(new Layout(), sc);
  for (let i = 0; i < sc.seconds * 120; i++) {
    run.step();
    if (run.stalls.begun > 0) return boxedConvoy(run);
  }
  return null;
}

describe("the boxed-in convoy (decision 4) is recognised by its shape, and only it", () => {
  it("a hand-run train boxed in between a buffer and a routed train, the routed stop behind it: boxed in", () => {
    expect(atFirstStall(S.handRunBoxedIn)).toBe(true);
  });
  it("the same, the hand-run train put down at the other end (the routed one heading the other way): boxed in", () => {
    const flipped: Scenario = {
      ...S.handRunBoxedIn,
      name: "boxed in, mirrored",
      build: (layout) => {
        const ids = S.shuttleLine(layout, 6);
        return {
          trains: [
            { pieceId: ids[ids.length - 2], reversed: true, cars: ["engine", "timber", "timber", "timber"] },
            { pieceId: ids[1], stops: [ids[ids.length - 1], ids[0]], cars: ["engine", "timber", "timber"] },
          ],
        };
      },
    };
    expect(atFirstStall(flipped)).toBe(true);
  });
  // (Other kinds of routed stall: the never-worse check still fails on each.)
  it("two routed trains head on along one line (no hand-run train): not", () => {
    expect(atFirstStall(S.headOnTwoLines)).toBe(false);
  });
  it("two trains of a line face to face in a line end, a passing loop on the line: not", () => {
    expect(atFirstStall(S.facingInLineEnd)).toBe(false);
  });
  it("the same shape, the hand-run train parked there (lever off): not", () => {
    // (Stuck behind a parked train: moving it is the player's fix, not a loop. Said "parked", not "in the way".)
    const sc: Scenario = {
      ...S.handRunBoxedIn,
      name: "boxed in, parked",
      build: (layout) => {
        const b = S.handRunBoxedIn.build(layout);
        return { ...b, trains: b.trains.map((t, k) => (k === 0 ? { ...t, lever: 0 } : t)) };
      },
    };
    expect(atFirstStall(sc)).toBe(false);
  });
});

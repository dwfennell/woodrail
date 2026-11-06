import { describe, expect, it } from "vitest";
import { chain, loopOn } from "../economy/loop-fixtures";
import { appendPiece, connectorRef, Layout } from "../track";
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
  it("the same shape on a line with a passing loop (the card's fix isn't a loop): not", () => {
    // (Fuzz seed 68's layout by hand: `⊐ A ══ ══ (loop, its side road stop M) ══ ══ (siding points) ══ ══ B ⊐`, the
    // routed train M ⇄ B, two hand-run ones. It stands in the loop, a hand-run train boxed in at each end, the one by B
    // on its stop: the boxed shape, but a loop is on the line, so the card doesn't say to lay one.)
    const sc: Scenario = {
      name: "boxed in, a loop on the line",
      seconds: 120,
      build: (layout) => {
        const [a, , w2] = chain(layout, ["depot-forest", "straight-216", "straight-216"]);
        appendPiece(layout, "buffer-turnback", false, connectorRef(a, 0));
        const l = loopOn(layout, connectorRef(w2, 1), ["straight-216", "straight-216"], ["depot-forest"]);
        const m = chain(layout, ["straight-216", "straight-216"], connectorRef(l.s2, 0));
        const sw = appendPiece(layout, "switch", false, connectorRef(m[1], 1));
        const siding = chain(layout, ["curve-large", "straight-216", "straight-216"], connectorRef(sw, 2), [true]);
        appendPiece(layout, "buffer-turnback", false, connectorRef(siding[2], 1));
        const [, e2, b] = chain(layout, ["straight-216", "straight-216", "depot-forest"], connectorRef(sw, 1));
        appendPiece(layout, "buffer-turnback", false, connectorRef(b, 1));
        layout.setSwitchState(l.s1, 1);
        return {
          trains: [
            { pieceId: m[1], reversed: true, stops: [l.side[1], b], cars: ["engine", "timber", "timber"] },
            { pieceId: w2, reversed: true, cars: ["engine", "timber", "timber"] },
            { pieceId: e2, reversed: true, cars: ["engine", "timber", "timber"] },
          ],
        };
      },
    };
    expect(atFirstStall(sc)).toBe(false);
  });
});

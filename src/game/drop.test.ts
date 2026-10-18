import { describe, expect, it } from "vitest";
import { getPieceDef } from "../track";
import { dropOutcome, heldReason, onwardEnds } from "./drop";

describe("dropOutcome", () => {
  it.each([
    [{ blocked: false, overTray: false, isNew: true }, "place"],
    [{ blocked: false, overTray: false, isNew: false }, "place"],
    [{ blocked: true, overTray: false, isNew: true }, "to-tray"],
    [{ blocked: true, overTray: false, isNew: false }, "return"],
    [{ blocked: false, overTray: true, isNew: true }, "to-tray"],
    [{ blocked: false, overTray: true, isNew: false }, "delete"],
    [{ blocked: true, overTray: true, isNew: false }, "delete"],
  ] as const)("%o → %s", (input, expected) => {
    expect(dropOutcome(input)).toBe(expected);
  });
});

describe("heldReason (a depot held over a line)", () => {
  it("over other track, says what would work on the line; a train on the straight wins over anything else in the way", () => {
    expect(heldReason("piece", "splice-onto")).toBe("splice-onto");
    expect(heldReason("piece", "splice-fit")).toBe("splice-fit");
    // Held slanting across the line, over a house too: the train on the straight is what's said.
    expect(heldReason("building", "splice-busy")).toBe("splice-busy");
    expect(heldReason("yard-ground", "splice-busy")).toBe("splice-busy");
    // Other refusals stand when the line's reason isn't a train.
    expect(heldReason("building", "splice-onto")).toBe("building");
    expect(heldReason("hill", "splice-fit")).toBe("hill");
    // It can go (or isn't over a line): as the placement check says.
    expect(heldReason(null, "splice-busy")).toBeNull();
    expect(heldReason("building", null)).toBe("building");
  });
});

describe("onwardEnds: where the next piece waits after one's put down", () => {
  const joinedAt = (n: number, ...at: number[]) => Array.from({ length: n }, (_, i) => at.includes(i));
  it("a straight: its far end; on its own, either end", () => {
    const s = getPieceDef("straight-216", false);
    expect(onwardEnds(s, joinedAt(2, 0))).toEqual([1]);
    expect(onwardEnds(s, joinedAt(2, 1))).toEqual([0]);
    expect(onwardEnds(s, joinedAt(2))).toEqual([0, 1]);
    expect(onwardEnds(s, joinedAt(2, 0, 1))).toEqual([]);
  });
  it("a switch from its toe: both its roads", () => {
    const sw = getPieceDef("switch", false);
    expect(onwardEnds(sw, joinedAt(sw.connectors.length, 0))).toEqual([1, 2]);
  });
  it("a terminus (roads ending at buffers) and a buffer stop: none, joined or not (QA: the hint said one waited)", () => {
    const t = getPieceDef("kit-grand-terminus", false);
    expect(t.connectors.length).toBeGreaterThan(1);
    expect(onwardEnds(t, joinedAt(t.connectors.length, 0))).toEqual([]);
    expect(onwardEnds(t, joinedAt(t.connectors.length))).toEqual([]);
    const b = getPieceDef("buffer", false);
    expect(onwardEnds(b, joinedAt(b.connectors.length))).toEqual([]);
  });
  it("a turntable: none (its roads lead to stalls and lines, not on to another turntable)", () => {
    const tt = getPieceDef("kit-turntable", false);
    expect(onwardEnds(tt, joinedAt(8, 0))).toEqual([]);
    expect(onwardEnds(tt, joinedAt(8))).toEqual([]);
  });
});

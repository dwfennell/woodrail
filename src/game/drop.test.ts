import { describe, expect, it } from "vitest";
import { dropOutcome, heldReason } from "./drop";

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

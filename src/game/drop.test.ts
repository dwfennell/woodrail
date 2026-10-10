import { describe, expect, it } from "vitest";
import { dropOutcome } from "./drop";

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

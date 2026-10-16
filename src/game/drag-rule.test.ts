import { describe, expect, it } from "vitest";
import { dragMoves } from "./drag-rule";

describe("what a drag moves", () => {
  it("on touch or a pen, only what's selected: a drag on anything else pans", () => {
    for (const pointer of ["touch", "pen"])
      for (const target of ["piece", "car", "depot", "prop", "road"] as const) {
        expect(dragMoves(target, false, pointer), `${pointer} ${target}`).toBe(false);
        expect(dragMoves(target, true, pointer), `${pointer} ${target} selected`).toBe(true);
      }
  });

  it("with a mouse, track, trains and industries move straight away; props and roads still want selecting first", () => {
    for (const target of ["piece", "car", "depot"] as const) expect(dragMoves(target, false, "mouse"), target).toBe(true);
    for (const target of ["prop", "road"] as const) {
      expect(dragMoves(target, false, "mouse"), target).toBe(false);
      expect(dragMoves(target, true, "mouse"), target).toBe(true);
    }
  });
});

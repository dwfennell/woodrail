import { describe, expect, it } from "vitest";
import { dragMoves, dragSlop } from "./drag-rule";

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

  it("cargo (never selected): a mouse drags it off its pile at once; a finger or pen pans (QA: a pan from the sawmill's goods pile carried planks off)", () => {
    expect(dragMoves("cargo", false, "mouse")).toBe(true);
    expect(dragMoves("cargo", false, "touch")).toBe(false);
    expect(dragMoves("cargo", false, "pen")).toBe(false);
  });
});

describe("how far a press moves before it's a drag", () => {
  it("a finger (or pen) may wobble as far as a tap allows (10 px) before a selected thing is dragged; a mouse 6 px", () => {
    // QA: a 62 ms finger tap wobbling 6–8 px on a selected turntable's deck picked the turntable up.
    expect(dragSlop("touch")).toBe(10);
    expect(dragSlop("pen")).toBe(10);
    expect(dragSlop("mouse")).toBe(6);
    expect(Math.hypot(6, 5)).toBeLessThan(dragSlop("touch"));
  });
});

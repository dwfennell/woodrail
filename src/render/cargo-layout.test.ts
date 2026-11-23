import { describe, expect, it } from "vitest";
import { pileSlot, unitSize, wagonSlot, type Slot } from "./cargo-layout";

const apart = (a: Slot, b: Slot, s: { x: number; y: number; z: number }) =>
  Math.abs(a.y - b.y) >= s.y - 1e-6 || Math.abs(a.z - b.z) >= s.z - 1e-6 || Math.abs(a.x - b.x) >= s.x - 1e-6;

describe("cargo layout", () => {
  it("a pile two rows long lies lower and wider: twelve sacks, none overlapping, all over the pile's footprint", () => {
    const size = unitSize("grain");
    const slots = Array.from({ length: 12 }, (_, k) => pileSlot("grain", k, 3, 2));
    for (let i = 0; i < slots.length; i++) {
      expect(Math.abs(slots[i].x)).toBeLessThanOrEqual((size.x + 0.6) / 2 + 1e-9);
      for (let j = 0; j < i; j++) expect(apart(slots[i], slots[j], size)).toBe(true);
    }
    // Two layers, not four.
    expect(Math.max(...slots.map((s) => s.y))).toBeCloseTo(size.y * 1.5);
  });
  for (const kind of ["log", "planks"] as const) {
    for (const across of [2, 3, 4]) {
      it(`a pile of ${kind} ${across} across: twelve units, none overlapping, all on or above the ground`, () => {
        const slots = Array.from({ length: 12 }, (_, k) => pileSlot(kind, k, across));
        const size = unitSize(kind);
        for (let i = 0; i < slots.length; i++) {
          expect(slots[i].y - size.y / 2).toBeGreaterThanOrEqual(-1e-9);
          expect(Math.abs(slots[i].z)).toBeLessThanOrEqual(((across - 1) / 2) * (size.z + 0.6) + 1e-9);
          for (let j = 0; j < i; j++) expect(apart(slots[i], slots[j], size)).toBe(true);
        }
      });
    }
    it(`three ${kind} fit on a wagon without overlapping, within its stakes`, () => {
      const slots = [0, 1, 2].map((k) => wagonSlot(kind, k));
      const size = unitSize(kind);
      for (const s of slots) expect(Math.abs(s.z) + size.z / 2).toBeLessThanOrEqual(13.5);
      for (let i = 0; i < 3; i++) for (let j = 0; j < i; j++) expect(apart(slots[i], slots[j], { ...size, y: size.y * 0.85 })).toBe(true);
    });
  }

  // A heavy wagon (Smithy: 5): every count from 1 to 5 within the stakes, over the deck, none overlapping (the user,
  // 2026-11-23: the 4th and 5th logs rode along the top hanging off the ends; five bundles stood in a column).
  for (const kind of ["log", "planks", "iron"] as const)
    for (const count of [1, 2, 3, 4, 5])
      it(`${count} ${kind} on a heavy wagon: within its stakes and over its deck, none overlapping`, () => {
        const slots = Array.from({ length: count }, (_, k) => wagonSlot(kind, k, count));
        const size = unitSize(kind);
        for (const s of slots) {
          expect(Math.abs(s.z) + size.z / 2).toBeLessThanOrEqual(13.5);
          expect(s.x).toBe(0);
          expect(s.y - size.y / 2).toBeGreaterThanOrEqual(-1e-9);
        }
        for (let i = 0; i < count; i++) for (let j = 0; j < i; j++) expect(apart(slots[i], slots[j], { ...size, y: size.y * 0.85 })).toBe(true);
        // No taller than three high: five logs two pairs and one, five bundles two, two and one.
        expect(Math.max(...slots.map((s) => s.y + size.y / 2))).toBeLessThanOrEqual(size.y * 3 + 1e-9);
      });
  it("a crane's unit goes where it'll lie: the top one of a load (count k + 1)", () => {
    for (const kind of ["log", "planks"] as const) for (let k = 0; k < 5; k++) expect(wagonSlot(kind, k)).toEqual(wagonSlot(kind, k, k + 1));
  });
});

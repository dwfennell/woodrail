import { describe, expect, it } from "vitest";
import { declutterLabels, type LabelBox } from "./label-declutter";

const box = (x: number, y: number, priority = 0, w = 100, h = 40): LabelBox => ({ x, y, w, h, priority });

describe("declutterLabels", () => {
  it("leaves separate labels alone", () => {
    expect(declutterLabels([box(0, 0), box(200, 0), box(0, 100)])).toEqual([
      { dy: 0, hidden: false },
      { dy: 0, hidden: false },
      { dy: 0, hidden: false },
    ]);
  });
  it("nudges the lower-priority label off the higher one", () => {
    const b = [box(10, 10, 0), box(20, 20, 1)];
    const r = declutterLabels(b);
    expect(r[1]).toEqual({ dy: 0, hidden: false });
    expect(r[0].hidden).toBe(false);
    expect(r[0].dy).not.toBe(0);
    expect(Math.abs(b[0].y + r[0].dy - b[1].y)).toBeGreaterThanOrEqual(40);
  });
  it("hides labels that cannot be cleared, lowest priority first", () => {
    const stack = Array.from({ length: 12 }, (_, i) => box(0, 0, 12 - i));
    const r = declutterLabels(stack);
    expect(r.filter((s) => !s.hidden)).toHaveLength(7);
    expect(r[0].hidden).toBe(false);
    expect(r[11].hidden).toBe(true);
  });
  it("never leaves two visible labels overlapping", () => {
    const b = [box(0, 0, 1), box(30, 10, 0), box(60, 5, 2), box(10, 30, 0), box(500, 500, 0)];
    const r = declutterLabels(b);
    for (let i = 0; i < b.length; i++)
      for (let j = i + 1; j < b.length; j++) {
        if (r[i].hidden || r[j].hidden) continue;
        const yi = b[i].y + r[i].dy;
        const yj = b[j].y + r[j].dy;
        const overlap = b[i].x < b[j].x + b[j].w && b[j].x < b[i].x + b[i].w && yi < yj + b[j].h && yj < yi + b[i].h;
        expect(overlap).toBe(false);
      }
  });
  it("handles none", () => expect(declutterLabels([])).toEqual([]));
});

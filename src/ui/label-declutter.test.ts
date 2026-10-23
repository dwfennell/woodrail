import { describe, expect, it } from "vitest";
import { declutterLabels, edgeNudge, rangeNudge, type LabelBox } from "./label-declutter";

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
  it("with a range, a nudge that would leave it is slid back in, and the spot it's tested at is the one returned", () => {
    // Two labels near the bottom bar (hi 100): the lower one can't go down, so it goes up, clear of the other.
    const b = [box(0, 50, 1), box(0, 55, 0)];
    const r = declutterLabels(b, { lo: 0, hi: 100 });
    expect(r[0]).toEqual({ dy: 0, hidden: false });
    const y1 = b[1].y + r[1].dy;
    expect(r[1].hidden).toBe(false);
    expect(y1 + 40).toBeLessThanOrEqual(100);
    expect(y1 >= 50 + 40 || y1 + 40 <= 50).toBe(true);
    // No room either way: hidden, not left over it.
    expect(declutterLabels([box(0, 10, 1), box(0, 12, 0)], { lo: 0, hi: 60 })[1].hidden).toBe(true);
  });
});

describe("edgeNudge", () => {
  it("leaves a label on screen alone", () => expect(edgeNudge(100, 80, 390)).toBe(0));
  it("slides one off the right edge back in", () => expect(edgeNudge(350, 80, 390)).toBe(-48));
  it("slides one off the left edge back in", () => expect(edgeNudge(-20, 80, 390)).toBe(28));
  it("keeps the left edge when it's wider than the screen", () => expect(edgeNudge(0, 400, 390)).toBe(8));
});

describe("rangeNudge", () => {
  it("lifts a label above a bar at the bottom", () => expect(rangeNudge(760, 40, 60, 770)).toBe(-30));
  it("drops one below the top bar", () => expect(rangeNudge(20, 40, 60, 770)).toBe(40));
  it("leaves one in between alone", () => expect(rangeNudge(300, 40, 60, 770)).toBe(0));
});

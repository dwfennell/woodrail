import { describe, expect, it } from "vitest";
import { clearSpot, leastCovered, type Label } from "./toast-room";

const box = (left: number, top: number, w: number, h: number, badge = false): Label => ({ left, top, right: left + w, bottom: top + h, badge });
const hits = (q: Label, x: number, top: number, w: number, h: number) => q.right > x - w / 2 && q.left < x + w / 2 && q.bottom > top && q.top < top + h;

describe("a toast on the map view", () => {
  const phone = { left: 0, right: 360, top: 72, bottom: 640 };

  it("goes as high as it's clear: under the top bar when nothing's there", () => {
    expect(clearSpot([box(20, 300, 200, 50)], 300, 60, phone)).toEqual({ x: 180, top: 72 });
  });

  it("goes down past labels in its way, to the first gap tall enough", () => {
    const labels = [box(60, 80, 200, 50), box(100, 140, 200, 50), box(80, 300, 200, 50)];
    const s = clearSpot(labels, 300, 60, phone)!;
    expect(s.top).toBe(194);
    for (const q of labels) expect(hits(q, s.x, s.top, 300, 60)).toBe(false);
  });

  it("moves to a side when the middle is taken all the way down (QA, 360x740: the forest yard's label above the bar)", () => {
    // A column of labels down the middle; room down the left.
    const labels = [80, 180, 280, 380, 480, 580].map((top) => box(150, top, 200, 50));
    const s = clearSpot(labels, 130, 60, phone)!;
    expect(s.x).toBe(8 + 65);
    for (const q of labels) expect(hits(q, s.x, s.top, 130, 60)).toBe(false);
  });

  it("finds nothing clear when every place is taken, nor when it's wider than the screen", () => {
    const rows = [80, 150, 220, 290, 360, 430, 500, 570].map((top) => box(0, top, 360, 40));
    expect(clearSpot(rows, 300, 60, phone)).toBeNull();
    expect(clearSpot([], 350, 60, phone)).toBeNull();
  });

  it("with nothing clear, covers a label's edge rather than a badge (QA, 844x390: the ruin's badge at the top right)", () => {
    const wide = { left: 0, right: 844, top: 72, bottom: 290 };
    // Labels across most of the room; a badge at the top right, under the top bar.
    const labels = [box(0, 90, 700, 60), box(100, 160, 744, 60), box(0, 230, 744, 60), box(780, 72, 28, 28, true)];
    expect(clearSpot(labels, 560, 50, wide)).toBeNull();
    const s = leastCovered(labels, 560, 50, wide);
    expect(hits(labels[3], s.x, s.top, 560, 50)).toBe(false);
    expect(s.cost).toBeLessThan(1e6);
  });
});

describe("a toast on the map view, in a strip with a badge in it", () => {
  it("goes beside the badge, as high as it can (QA, 844x390: the ruin's badge in the strip under the top bar)", () => {
    const wide = { left: 0, right: 844, top: 72, bottom: 290 };
    const badge = box(420, 72, 36, 36, true);
    const labels = [badge, box(200, 120, 220, 50), box(500, 120, 280, 50), box(0, 175, 844, 50), box(0, 235, 844, 50)];
    const s = clearSpot(labels, 360, 40, wide)!;
    expect(s.top).toBe(72);
    for (const q of labels) expect(hits(q, s.x, s.top, 360, 40)).toBe(false);
  });
});

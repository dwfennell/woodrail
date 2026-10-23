import { describe, expect, it } from "vitest";
import { eraseRefusal, sweepLooks, type EraseRefusal } from "./erase";

describe("what a clearing sweep says of what stays (once, on lift)", () => {
  it("nothing, when everything it passed over went", () => {
    expect(eraseRefusal(new Map())).toBeNull();
  });

  it("the reason, when one kind of thing stayed (a depot's track and its building are one kind)", () => {
    expect(eraseRefusal(new Map<EraseRefusal, string>([["station", "Forest yard stays"]]))).toBe("Forest yard stays");
  });

  it("the kinds together, when several stayed", () => {
    const told = new Map<EraseRefusal, string>([
      ["station", "Larkfield station stays"],
      ["train", "Trains stay: take one off from its card"],
      ["house", "The town's houses stay"],
    ]);
    expect(eraseRefusal(told)).toBe("Some things stay: trains and their track, stations and depots, the town's houses");
  });

  it("roads and the map's trees are among them", () => {
    const told = new Map<EraseRefusal, string>([
      ["road", "Roads stay: tap one with Clear off to take it up"],
      ["tree", "Trees stay: the Land tab moves them"],
    ]);
    expect(eraseRefusal(told)).toBe("Some things stay: roads, trees");
  });

  it("names them in one order however the sweep met them, three at most", () => {
    const a = new Map<EraseRefusal, string>([["tree", "t"], ["station", "s"]]);
    const b = new Map<EraseRefusal, string>([["station", "s"], ["tree", "t"]]);
    expect(eraseRefusal(a)).toBe(eraseRefusal(b));
    const all = new Map<EraseRefusal, string>([["tree", "t"], ["road", "r"], ["house", "h"], ["station", "s"], ["train", "x"]]);
    expect(eraseRefusal(all)).toBe("Some things stay: trains and their track, stations and depots, the town's houses, and 2 more");
    expect(eraseRefusal(new Map<EraseRefusal, string>([["tree", "Trees stay: the Land tab moves them"]]))).toBe("Trees stay: the Land tab moves them");
  });
});

describe("where a sweep looks along the way the pointer came", () => {
  /** A straight way along x from 0, in `n` points `gap` px apart (as a slow frame's coalesced moves). */
  const way = (n: number, gap: number) => Array.from({ length: n + 1 }, (_, i) => ({ x: i * gap, y: 0 }));

  it("looks every step along a short way", () => {
    expect(sweepLooks(way(1, 40), 8, 16).map((p) => p.x)).toEqual([8, 16, 24, 32, 40]);
  });

  it("spreads its looks over the whole of a long way, however many points it came in, its far end included", () => {
    // QA's repros: 40 points 6 px apart (240 px), 12 points 21 px apart, 24 points 10 px apart.
    for (const [n, gap] of [[40, 6], [12, 21], [24, 10]]) {
      const looks = sweepLooks(way(n, gap), 8, 16);
      const end = n * gap;
      expect(looks.length).toBe(Math.min(16, Math.ceil(end / 8)));
      expect(looks[looks.length - 1].x).toBeCloseTo(end);
      // Evenly: no two looks further apart than the way's length over the looks (a 36 mm piece is never jumped).
      const xs = [0, ...looks.map((p) => p.x)];
      for (let i = 1; i < xs.length; i++) expect(xs[i] - xs[i - 1]).toBeCloseTo(end / looks.length);
    }
  });

  it("follows a bent way (round its corner, not across it)", () => {
    const looks = sweepLooks([{ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 40 }], 8, 16);
    expect(looks).toHaveLength(10);
    expect(looks.every((p) => (p.y === 0 && p.x <= 40) || Math.abs(p.x - 40) < 1e-9)).toBe(true);
  });

  it("doesn't look when the pointer hasn't moved", () => {
    expect(sweepLooks([{ x: 5, y: 5 }, { x: 5, y: 5 }], 8, 16)).toEqual([]);
  });
});

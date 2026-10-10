import { describe, expect, it } from "vitest";
import { CELL, LandscapeGrid } from "./grid";
import { hillSlabs } from "./slabs";

const area = (s: { x0: number; z0: number; x1: number; z1: number }) => (s.x1 - s.x0) * (s.z1 - s.z0);

describe("hillSlabs", () => {
  it("merges a 2×2 square of one block into one slab", () => {
    const g = new LandscapeGrid();
    for (const [c, r] of [[5, 5], [6, 5], [5, 6], [6, 6]]) g.height[g.index(c, r)] = 1;
    const slabs = hillSlabs(g);
    expect(slabs).toHaveLength(1);
    expect(slabs[0].level).toBe(1);
    expect(area(slabs[0])).toBe(4 * CELL * CELL);
  });

  it("covers exactly the cells at or above each level", () => {
    const g = new LandscapeGrid();
    const cells: [number, number, number][] = [[3, 3, 2], [4, 3, 2], [4, 4, 1], [5, 4, 1], [5, 5, 1], [10, 10, 3]];
    for (const [c, r, h] of cells) g.height[g.index(c, r)] = h;
    const slabs = hillSlabs(g);
    for (const level of [1, 2, 3]) {
      const expected = cells.filter(([, , h]) => h >= level).length * CELL * CELL;
      expect(slabs.filter((s) => s.level === level).reduce((a, s) => a + area(s), 0)).toBe(expected);
    }
  });

  it("is empty for a flat mat", () => {
    expect(hillSlabs(new LandscapeGrid())).toEqual([]);
  });
});

import { describe, expect, it } from "vitest";
import { CELL, COLS, LandscapeGrid, MAT_DEPTH, MAT_WIDTH, ROWS } from "./grid";

describe("LandscapeGrid", () => {
  it("covers the mat with 64 mm cells", () => {
    expect(COLS * CELL).toBe(MAT_WIDTH);
    expect(ROWS * CELL).toBe(MAT_DEPTH);
  });

  it("maps mat corners to the first and last cells", () => {
    const g = new LandscapeGrid();
    expect(g.cellAtWorld(-MAT_WIDTH / 2 + 1, -MAT_DEPTH / 2 + 1)).toBe(0);
    expect(g.cellAtWorld(MAT_WIDTH / 2 - 1, MAT_DEPTH / 2 - 1)).toBe(COLS * ROWS - 1);
  });

  it("returns -1 off the mat", () => {
    const g = new LandscapeGrid();
    expect(g.cellAtWorld(MAT_WIDTH / 2 + 1, 0)).toBe(-1);
    expect(g.cellAtWorld(0, -MAT_DEPTH / 2 - 1)).toBe(-1);
  });

  it("cell centres round-trip", () => {
    const g = new LandscapeGrid();
    for (const x of [-1500, -3, 0, 777, 1599]) expect(Math.abs(g.centreX(g.colAt(x)) - x)).toBeLessThanOrEqual(32);
    for (const z of [-1180, 0, 1000]) expect(Math.abs(g.centreZ(g.rowAt(z)) - z)).toBeLessThanOrEqual(32);
  });

  it("ground height is blocks × 64 mm", () => {
    const g = new LandscapeGrid();
    const i = g.index(10, 10);
    g.height[i] = 2;
    expect(g.groundY(i)).toBe(128);
  });
});

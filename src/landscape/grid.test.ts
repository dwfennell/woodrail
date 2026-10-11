import { describe, expect, it } from "vitest";
import { STRAIGHT_LENGTHS } from "../track";
import { CELL, COLS, LandscapeGrid, MAT_DEPTH, MAT_WIDTH, ROWS } from "./grid";

describe("LandscapeGrid", () => {
  it("uses 72 mm squares, a whole number of 18 mm track steps, on a mat about as big as before", () => {
    expect(CELL).toBe(72);
    for (const l of STRAIGHT_LENGTHS) expect(l % 18).toBe(0);
    expect(CELL % 18).toBe(0);
    expect([COLS, ROWS]).toEqual([62, 46]);
    expect((MAT_WIDTH / 2) % 18).toBe(0);
    expect((MAT_DEPTH / 2) % 18).toBe(0);
  });

  it("covers the mat with its cells", () => {
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
    for (const x of [-1500, -3, 0, 777, 1599]) expect(Math.abs(g.centreX(g.colAt(x)) - x)).toBeLessThanOrEqual(CELL / 2);
    for (const z of [-1180, 0, 1000]) expect(Math.abs(g.centreZ(g.rowAt(z)) - z)).toBeLessThanOrEqual(CELL / 2);
  });

  it("ground height is blocks × 64 mm", () => {
    const g = new LandscapeGrid();
    const i = g.index(10, 10);
    g.height[i] = 2;
    expect(g.groundY(i)).toBe(128);
  });
});

import { describe, expect, it } from "vitest";
import { RISER_HEIGHT } from "../track";
import { STRAIGHT_LENGTHS } from "../track";
import { CELL, gridWithPlots, LandscapeGrid, PLOT_CELLS, PLOT_COLS, PLOT_DEPTH, PLOT_ROWS, PLOT_WIDTH } from "./grid";

describe("LandscapeGrid", () => {
  it("uses 72 mm squares, a whole number of 18 mm track steps, in plots a quarter of the old mat", () => {
    expect(CELL).toBe(72);
    for (const l of STRAIGHT_LENGTHS) expect(l % 18).toBe(0);
    expect(CELL % 18).toBe(0);
    expect([PLOT_COLS, PLOT_ROWS]).toEqual([31, 23]);
    expect([PLOT_WIDTH, PLOT_DEPTH]).toEqual([31 * CELL, 23 * CELL]);
  });

  it("maps the start region's corners to the first and last squares of its corner plots", () => {
    const g = gridWithPlots(-1, -1, 2, 2);
    expect(g.cellAtWorld(-PLOT_WIDTH + 1, -PLOT_DEPTH + 1)).toBe(0);
    expect(g.cellAtWorld(PLOT_WIDTH - 1, PLOT_DEPTH - 1)).toBe(4 * PLOT_CELLS - 1);
  });

  it("returns -1 off the land, and only its plots are in bounds", () => {
    const g = gridWithPlots(-1, -1, 2, 2);
    expect(g.cellAtWorld(PLOT_WIDTH + 1, 0)).toBe(-1);
    expect(g.cellAtWorld(0, -PLOT_DEPTH - 1)).toBe(-1);
    expect(g.inBounds(-31, -23)).toBe(true);
    expect(g.inBounds(-32, 0)).toBe(false);
    expect(g.inBounds(30, 22)).toBe(true);
    expect(g.inBounds(31, 22)).toBe(false);
    expect(g.index(31, 0)).toBe(-1);
  });

  it("cell centres round-trip", () => {
    const g = gridWithPlots(-1, -1, 2, 2);
    for (const x of [-1500, -3, 0, 777, 1599]) expect(Math.abs(g.centreX(g.colAt(x)) - x)).toBeLessThanOrEqual(CELL / 2);
    for (const z of [-1180, 0, 1000]) expect(Math.abs(g.centreZ(g.rowAt(z)) - z)).toBeLessThanOrEqual(CELL / 2);
  });

  it("squares round-trip through their index, negative columns and rows included", () => {
    const g = gridWithPlots(-2, -1, 3, 2);
    g.addPlot(5, 7);
    g.forEachCell((i, col, row) => {
      expect(g.index(col, row)).toBe(i);
      expect([g.colOf(i), g.rowOf(i)]).toEqual([col, row]);
    });
    expect(g.cellCount).toBe(7 * PLOT_CELLS);
  });

  it("keeps squares' indices and contents as plots are added", () => {
    const g = new LandscapeGrid();
    g.addPlot(0, 0);
    const i = g.index(3, 4);
    g.height[i] = 2;
    g.owner[i] = 9;
    for (let k = 1; k <= 12; k++) g.addPlot(k, 0);
    expect(g.index(3, 4)).toBe(i);
    expect([g.height[i], g.owner[i]]).toEqual([2, 9]);
    // New plots start empty: grass, nothing on it, no owner.
    const j = g.index(12 * PLOT_COLS + 1, 1);
    expect([g.height[j], g.surface[j], g.feature[j], g.owner[j]]).toEqual([0, 0, 0, -1]);
    expect(g.addPlot(3, 0)).toBe(3);
  });

  it("counts changes per plot", () => {
    const g = gridWithPlots(0, 0, 2, 1);
    const r = g.revision;
    g.touch(1);
    expect([g.version(0), g.version(1)]).toEqual([0, 1]);
    expect(g.revision).toBeGreaterThan(r);
  });

  it("knows each square's neighbours, across plots, and none off the land", () => {
    const g = gridWithPlots(0, 0, 2, 1);
    const near = g.neighbours();
    const i = g.index(PLOT_COLS - 1, 5);
    expect(near[i * 4]).toBe(g.index(PLOT_COLS, 5));
    expect(near[i * 4 + 3]).toBe(g.index(PLOT_COLS - 1, 4));
    expect(near[g.index(0, 0) * 4 + 2]).toBe(-1);
    g.addPlot(-1, 0);
    expect(g.neighbours()[g.index(0, 0) * 4 + 2]).toBe(g.index(-1, 0));
  });

  it("ground height is blocks × a level (RISER_HEIGHT)", () => {
    const g = gridWithPlots(-1, -1, 2, 2);
    const i = g.index(10, 10);
    g.height[i] = 2;
    expect(g.groundY(i)).toBe(2 * RISER_HEIGHT);
  });
});

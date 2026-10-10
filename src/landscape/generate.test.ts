import { describe, expect, it } from "vitest";
import { CELL, COLS, FEAT_BUILDING, FEAT_NONE, FEAT_TREE, ROWS, SURF_RIVER } from "./grid";
import { corridorCells, generateLandscape, reachable } from "./generate";

const SEEDS = Array.from({ length: 200 }, (_, i) => i + 1);

describe("generateLandscape", () => {
  it("is deterministic per seed and varies between seeds", () => {
    const a = generateLandscape(42);
    const b = generateLandscape(42);
    const c = generateLandscape(43);
    expect(Array.from(a.grid.height)).toEqual(Array.from(b.grid.height));
    expect(Array.from(a.grid.feature)).toEqual(Array.from(b.grid.feature));
    expect(a.towns).toEqual(b.towns);
    expect(Array.from(a.grid.height)).not.toEqual(Array.from(c.grid.height));
  });

  it.each(SEEDS)("seed %i: valid towns, flat protected areas, gentle hills, all towns reachable", (seed) => {
    const land = generateLandscape(seed);
    const g = land.grid;
    expect(land.towns.length).toBeGreaterThanOrEqual(3);
    expect(land.towns.length).toBeLessThanOrEqual(4);
    for (let i = 0; i < land.towns.length; i++) {
      const t = land.towns[i];
      expect(Math.abs(Math.round(t.station.heading / (Math.PI / 4)) * (Math.PI / 4) - t.station.heading)).toBeLessThan(1e-9);
      for (let j = i + 1; j < land.towns.length; j++) {
        const u = land.towns[j];
        expect(Math.hypot(t.centre.x - u.centre.x, t.centre.z - u.centre.z)).toBeGreaterThanOrEqual(900);
      }
      for (const cell of t.cells) expect(g.height[cell]).toBe(0);
    }
    for (const cell of corridorCells(land)) {
      expect(g.height[cell]).toBe(0);
      expect(g.feature[cell]).toBe(FEAT_NONE);
      expect(g.surface[cell]).not.toBe(SURF_RIVER);
    }
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const h = g.height[g.index(c, r)];
        if (c + 1 < COLS) expect(Math.abs(h - g.height[g.index(c + 1, r)])).toBeLessThanOrEqual(1);
        if (r + 1 < ROWS) expect(Math.abs(h - g.height[g.index(c, r + 1)])).toBeLessThanOrEqual(1);
      }
    }
    expect(reachable(land)).toBe(true);
  });

  it("produces hills, trees, buildings and usually a river across seeds", () => {
    let hills = 0;
    let trees = 0;
    let buildings = 0;
    let rivers = 0;
    for (const seed of SEEDS.slice(0, 40)) {
      const g = generateLandscape(seed).grid;
      if (g.height.some((h) => h > 0)) hills++;
      if (g.feature.some((f) => f === FEAT_TREE)) trees++;
      if (g.feature.some((f) => f === FEAT_BUILDING)) buildings++;
      if (g.surface.some((s) => s === SURF_RIVER)) rivers++;
    }
    expect(hills).toBe(40);
    expect(trees).toBe(40);
    expect(buildings).toBe(40);
    expect(rivers).toBeGreaterThan(25);
  });

  it("starter maps line up towns 0 and 1 with a clear strip between them", () => {
    const land = generateLandscape(7, { starter: true });
    const [a, b] = land.towns;
    expect(a.station.heading).toBe(0);
    expect(b.station.heading).toBe(0);
    expect(b.station.z).toBeCloseTo(a.station.z);
    expect(b.centre.x - a.centre.x).toBeCloseTo(1080);
    const g = land.grid;
    for (let x = a.centre.x + 108; x < b.centre.x - 108; x += CELL / 2) {
      const cell = g.cellAtWorld(x, a.centre.z);
      expect(g.height[cell]).toBe(0);
      expect(g.feature[cell]).toBe(FEAT_NONE);
      expect(g.surface[cell]).not.toBe(SURF_RIVER);
    }
  });
});

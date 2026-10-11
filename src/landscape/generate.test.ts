import { describe, expect, it } from "vitest";
import { CELL, COLS, FEAT_BUILDING, FEAT_NONE, FEAT_TREE, MAT_DEPTH, MAT_WIDTH, ROWS, SURF_RIVER } from "./grid";
import { corridorCells, generateLandscape, reachable, stationEnds } from "./generate";

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
    expect(land.towns.length).toBeGreaterThanOrEqual(5);
    expect(land.towns.length).toBeLessThanOrEqual(7);
    expect(new Set(land.towns.map((t) => t.name)).size).toBe(land.towns.length);
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

  it("lays out a 62 × 46 square mat with five to seven towns", () => {
    expect(COLS).toBe(62);
    expect(ROWS).toBe(46);
    const counts = new Set(SEEDS.slice(0, 60).map((seed) => generateLandscape(seed).towns.length));
    expect(counts).toEqual(new Set([5, 6, 7]));
  });

  it("puts every station on the grid: facing a map direction, midpoint on a square centre, ends on the 18 mm lattice", () => {
    const whole = (v: number) => Math.abs(v - Math.round(v)) < 1e-9;
    for (let seed = 1; seed <= 200; seed++) {
      for (const town of [...generateLandscape(seed).towns, ...generateLandscape(seed, { starter: true }).towns]) {
        expect(whole(town.station.heading / (Math.PI / 2)), `seed ${seed} ${town.name} heading`).toBe(true);
        expect(whole((town.centre.x + MAT_WIDTH / 2) / CELL - 0.5), `seed ${seed} ${town.name} x`).toBe(true);
        expect(whole((town.centre.z + MAT_DEPTH / 2) / CELL - 0.5), `seed ${seed} ${town.name} z`).toBe(true);
        for (const end of stationEnds(town)) {
          expect(whole((end.x + MAT_WIDTH / 2) / 18)).toBe(true);
          expect(whole((end.z + MAT_DEPTH / 2) / 18)).toBe(true);
          expect(Math.abs(end.x)).toBeLessThan(MAT_WIDTH / 2);
          expect(Math.abs(end.z)).toBeLessThan(MAT_DEPTH / 2);
        }
      }
    }
  });

  it("starter maps have five towns", () => {
    expect(generateLandscape(7, { starter: true }).towns).toHaveLength(5);
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

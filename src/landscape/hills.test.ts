import { describe, expect, it } from "vitest";
import { buildStarterWorld, createWorld, landForSale, plotLand, plotsForSale, STARTER_SEED, unlockPlot } from "../game/world";
import { deserializeWorld, serializeWorld } from "../persist/save";
import { coastOf } from "./coast";
import { generateLandscape, generatePlot, hillsOfLand } from "./generate";
import { PLOT_COLS, PLOT_ROWS } from "./grid";
import { DEFAULT_HILLS, HILLINESS, hillLevel, LEGACY_HILLS, startNearness, type Hilliness } from "./hills";

/** Raised squares in a land, and those within `r` half-regions of the start's middle (where the first track goes). */
function hills(land: { grid: { cellCount: number; height: Uint8Array; colOf(i: number): number; rowOf(i: number): number } }, r = Infinity): number {
  const g = land.grid;
  let n = 0;
  for (let i = 0; i < g.cellCount; i++) {
    if (g.height[i] === 0) continue;
    if (Math.hypot((g.colOf(i) + 0.5) / PLOT_COLS, (g.rowOf(i) + 0.5) / PLOT_ROWS) <= r) n++;
  }
  return n;
}

/** A plot's heights, square by square, from any grid that has it. */
function plotHeights(g: { height: Uint8Array; index(col: number, row: number): number }, px: number, pz: number): number[] {
  const out: number[] = [];
  for (let row = pz * PLOT_ROWS; row < (pz + 1) * PLOT_ROWS; row++) for (let col = px * PLOT_COLS; col < (px + 1) * PLOT_COLS; col++) out.push(g.height[g.index(col, row)]);
  return out;
}

/** The hills on the plots round the start (ring 1), as they'd be bought. */
function ringHills(seed: number, starter: boolean, h: Hilliness): number {
  let n = 0;
  for (const [px, pz] of [[-2, 0], [1, 0], [0, -2], [0, 1], [-2, -1], [1, -1], [-1, 1], [-1, -2]]) n += hills(generatePlot(seed, px, pz, coastOf(seed, starter), h));
  return n;
}

describe("how hilly a map is", () => {
  it("Hilly is the land as it was made before the choice (an older map's): the same sum, square by square", () => {
    for (let k = 0; k < 2000; k++) {
      const n = (k * 0.6180339) % 1;
      const col = (k * 37) % 120 - 60;
      const row = (k * 53) % 90 - 45;
      expect(hillLevel(n, col, row, "hilly")).toBe(Math.max(0, Math.min(3, Math.floor((n - 0.42) * 7))));
    }
    expect(LEGACY_HILLS).toBe("hilly");
    // (A map made without saying is made as before, and says nothing: an old save's land, made again, matches it.)
    const old = generateLandscape(STARTER_SEED, { starter: true });
    expect(old.hills).toBeUndefined();
    expect(hillsOfLand(old)).toBe("hilly");
    expect([...generateLandscape(STARTER_SEED, { starter: true, hills: "hilly" }).grid.height]).toEqual([...old.grid.height]);
  });

  it("the new default, Gentle, has fewer hills than before near the start, and fewest by the first towns (fixed seed)", () => {
    expect(DEFAULT_HILLS).toBe("gentle");
    for (const seed of [STARTER_SEED, 24, 1234]) {
      const starter = seed === STARTER_SEED;
      const before = generateLandscape(seed, { starter, hills: "hilly" });
      const now = generateLandscape(seed, { starter, hills: DEFAULT_HILLS });
      // The start region: under two thirds of the hills it had.
      expect(hills(now)).toBeLessThan(hills(before) * 0.66);
      // About its middle (half a region round it): next to none.
      expect(hills(now, 0.5)).toBeLessThanOrEqual(Math.max(4, hills(before, 0.5) * 0.15));
      // Further out there are still hills, a good part of what there was.
      expect(ringHills(seed, starter, DEFAULT_HILLS)).toBeGreaterThan(ringHills(seed, starter, "hilly") * 0.5);
    }
    // The starter map (the first game's) as a player gets it.
    const w = buildStarterWorld();
    expect(w.landscape.hills).toBe("gentle");
    expect(hills(w.landscape)).toBeLessThan(hills(buildStarterWorld(true, "hilly").landscape) * 0.66);
  });

  it("each step, flattest to highest, has more hills than the one before, at the start and beyond it", () => {
    for (const seed of [STARTER_SEED, 24, 1234, 98765]) {
      const starter = seed === STARTER_SEED;
      const start = HILLINESS.map((h) => hills(generateLandscape(seed, { starter, hills: h })));
      const ring = HILLINESS.map((h) => ringHills(seed, starter, h));
      for (let k = 1; k < HILLINESS.length; k++) {
        expect(start[k]).toBeGreaterThan(start[k - 1]);
        expect(ring[k]).toBeGreaterThan(ring[k - 1]);
      }
    }
  });

  it("Flat: the start has (next to) no hills, and the land beyond it still has some, high enough for a lookout", () => {
    for (const seed of [STARTER_SEED, 24, 1234, 98765]) {
      const starter = seed === STARTER_SEED;
      const land = generateLandscape(seed, { starter, hills: "flat" });
      expect(hills(land, 1)).toBe(0);
      // (A quarry or a mine wants 12 raised squares about it; there are plots of them a plot or two out.)
      let raised = 0;
      let high = 0;
      for (let px = -3; px <= 2; px++) {
        for (let pz = -3; pz <= 2; pz++) {
          if (px >= -1 && px <= 0 && pz >= -1 && pz <= 0) continue;
          const g = generatePlot(seed, px, pz, coastOf(seed, starter), "flat").grid;
          for (let i = 0; i < g.cellCount; i++) {
            if (g.height[i] > 0) raised++;
            if (g.height[i] >= 2) high++;
          }
        }
      }
      expect(raised).toBeGreaterThan(200);
      expect(high).toBeGreaterThan(0);
    }
  });

  it("is the same for a seed every time, and the same either side of a plot's edge (the start and the plot beside it agree)", () => {
    for (const h of HILLINESS) {
      const a = generateLandscape(24, { hills: h });
      const b = generateLandscape(24, { hills: h });
      expect([...a.grid.height]).toEqual([...b.grid.height]);
    }
    // The fade toward the start is smooth (no step in it), and whole by its middle.
    expect(startNearness(0, 0)).toBe(1);
    expect(startNearness(PLOT_COLS * 2, 0)).toBe(0);
    for (let col = 0; col < PLOT_COLS * 2; col++) expect(Math.abs(startNearness(col + 1, 0) - startNearness(col, 0))).toBeLessThan(0.08);
  });

  it("is saved with the map: a reload keeps its hills, and the land it buys later is made with them", () => {
    for (const h of HILLINESS) {
      const world = createWorld(24, true, true, true, h);
      const back = deserializeWorld(JSON.parse(JSON.stringify(serializeWorld(world))));
      if (!back.ok) throw new Error(back.error);
      expect(hillsOfLand(back.value.landscape)).toBe(h);
      expect([...back.value.landscape.grid.height]).toEqual([...world.landscape.grid.height]);
      // Land bought after the reload: as it would have been before it.
      const [p] = plotsForSale(world.landscape);
      const want = plotHeights(landForSale(world.landscape, p.px, p.pz).grid, p.px, p.pz);
      expect(unlockPlot(back.value, p.px, p.pz)).not.toBeNull();
      expect(plotHeights(back.value.landscape.grid, p.px, p.pz)).toEqual(want);
      // (And it is that step's land: not the same as the next step's, where they differ at all.)
      if (h !== "flat") expect(want).not.toEqual(plotHeights(plotLand(24, p.px, p.pz, world.landscape.coast, "flat").grid, p.px, p.pz));
    }
  });

  it("an old save (no hills in it) loads unchanged, and its land beyond is made as before", () => {
    const world = createWorld(24, true, true, true, "hilly");
    const data = serializeWorld(world);
    // (A map made as Hilly says nothing in its save: it's saved as an older map was.)
    expect("hills" in (data as { landscape: object }).landscape).toBe(false);
    const back = deserializeWorld(JSON.parse(JSON.stringify(data)));
    if (!back.ok) throw new Error(back.error);
    expect(back.value.landscape.hills).toBeUndefined();
    const [p] = plotsForSale(back.value.landscape);
    // (As a plot was made before the choice: `plotLand` without hills, the same sum as before: see the first test.)
    expect(plotHeights(landForSale(back.value.landscape, p.px, p.pz).grid, p.px, p.pz)).toEqual(plotHeights(plotLand(24, p.px, p.pz, back.value.landscape.coast).grid, p.px, p.pz));
    expect(plotHeights(landForSale(back.value.landscape, p.px, p.pz).grid, p.px, p.pz)).not.toEqual(plotHeights(plotLand(24, p.px, p.pz, back.value.landscape.coast, "gentle").grid, p.px, p.pz));
  });
});

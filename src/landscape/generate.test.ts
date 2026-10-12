import { describe, expect, it } from "vitest";
import { CELL, FEAT_BUILDING, FEAT_DEPOT, FEAT_FIELD, FEAT_NONE, FEAT_STATION, FEAT_TREE, PLOT_COLS, PLOT_DEPTH, PLOT_ROWS, PLOT_WIDTH, SURF_GRASS, SURF_LANE, SURF_RIVER, type LandscapeGrid } from "./grid";
import { adoptRegion, corridorCells, generateLandscape, generatePlot, generateRegion, reachable, stationEnds, type Landscape } from "./generate";
import { BORDER_BAND, edgeContract, STUB_DEPTH } from "./edges";

const SEEDS = Array.from({ length: 200 }, (_, i) => i + 1);

/** Every pair of side-by-side squares in the grid differs by at most one block. */
function gentle(g: LandscapeGrid): boolean {
  let ok = true;
  g.forEachCell((i, col, row) => {
    for (const [dc, dr] of [[1, 0], [0, 1]]) {
      const j = g.index(col + dc, row + dr);
      if (j !== -1 && Math.abs(g.height[i] - g.height[j]) > 1) ok = false;
    }
  });
  return ok;
}

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

  it("starts with the 2 × 2 plots round the origin: 62 × 46 squares", () => {
    const g = generateLandscape(1).grid;
    expect(g.plots).toEqual([{ px: -1, pz: -1 }, { px: 0, pz: -1 }, { px: -1, pz: 0 }, { px: 0, pz: 0 }]);
    const e = g.extent();
    expect([e.col1 - e.col0, e.row1 - e.row0]).toEqual([62, 46]);
    expect([e.x0, e.z0, e.x1, e.z1]).toEqual([-PLOT_WIDTH, -PLOT_DEPTH, PLOT_WIDTH, PLOT_DEPTH]);
  });

  it.each(SEEDS)("seed %i: valid towns, flat protected areas, gentle hills, all towns reachable", (seed) => {
    const land = generateLandscape(seed);
    const g = land.grid;
    expect(land.towns.length).toBeGreaterThanOrEqual(5);
    expect(land.towns.length).toBeLessThanOrEqual(7);
    expect(new Set(land.towns.map((t) => t.name)).size).toBe(land.towns.length);
    for (let i = 0; i < land.towns.length; i++) {
      const t = land.towns[i];
      expect(t.id).toBe(i);
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
    expect(gentle(g)).toBe(true);
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
    expect(rivers).toBeGreaterThan(30);
  });

  it("has five to seven towns", () => {
    const counts = new Set(SEEDS.slice(0, 60).map((seed) => generateLandscape(seed).towns.length));
    expect(counts).toEqual(new Set([5, 6, 7]));
  });

  it("puts every station on the grid: facing a map direction, midpoint on a square centre, ends on the 18 mm lattice", () => {
    const whole = (v: number) => Math.abs(v - Math.round(v)) < 1e-9;
    for (let seed = 1; seed <= 120; seed++) {
      for (const town of [...generateLandscape(seed).towns, ...generateLandscape(seed, { starter: true }).towns, ...generatePlot(seed, 1, 0).towns]) {
        expect(whole(town.station.heading / (Math.PI / 2)), `seed ${seed} ${town.name} heading`).toBe(true);
        expect(whole(town.centre.x / CELL - 0.5), `seed ${seed} ${town.name} x`).toBe(true);
        expect(whole(town.centre.z / CELL - 0.5), `seed ${seed} ${town.name} z`).toBe(true);
        for (const end of stationEnds(town)) {
          expect(whole(end.x / 18)).toBe(true);
          expect(whole(end.z / 18)).toBe(true);
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

describe("edge contracts", () => {
  it("are the same however often they're asked, keep clear of the corners and keep crossings apart", () => {
    for (const seed of SEEDS.slice(0, 50)) {
      for (const vertical of [true, false]) {
        const c = edgeContract(seed, vertical, 3, -2);
        expect(edgeContract(seed, vertical, 3, -2)).toEqual(c);
        const length = vertical ? PLOT_ROWS : PLOT_COLS;
        for (const k of [...c.rivers, ...c.lanes]) {
          expect(k).toBeGreaterThanOrEqual(5);
          expect(k).toBeLessThan(length - 5);
        }
        for (const r of c.rivers) for (const l of c.lanes) expect(Math.abs(r - l)).toBeGreaterThanOrEqual(3);
      }
    }
  });
});

/** A world from the start region, with plots bought one by one in this order. */
function grow(seed: number, order: readonly [number, number][]): Landscape {
  const land = generateLandscape(seed);
  for (const [px, pz] of order) adoptRegion(land, generatePlot(seed, px, pz));
  return land;
}

/** The squares of plot (px, pz) of a world, as one string per channel. */
function plotSquares(land: Landscape, px: number, pz: number): string {
  const g = land.grid;
  const out: number[] = [];
  for (let r = 0; r < PLOT_ROWS; r++) {
    for (let c = 0; c < PLOT_COLS; c++) {
      const i = g.index(px * PLOT_COLS + c, pz * PLOT_ROWS + r);
      out.push(g.height[i], g.surface[i], g.feature[i]);
    }
  }
  return out.join("");
}

describe("generated plots", () => {
  const RING: [number, number][] = [[1, -1], [1, 0], [-2, 0], [-1, 1], [0, 1], [1, 1], [-2, -1], [0, -2], [-1, -2]];

  it.each(SEEDS.slice(0, 60))("seed %i: a ring of plots round the start meets it with no seams", (seed) => {
    const land = grow(seed, RING);
    const g = land.grid;
    // Hills never step more than a block, across any edge.
    expect(gentle(g)).toBe(true);
    // Rivers and lanes run on across edges: a river or lane square on a plot's edge has the same beside it over the
    // edge (where there's land).
    g.forEachCell((i, col, row) => {
      const s = g.surface[i];
      if (s !== SURF_RIVER && s !== SURF_LANE) return;
      const c = ((col % PLOT_COLS) + PLOT_COLS) % PLOT_COLS;
      const r = ((row % PLOT_ROWS) + PLOT_ROWS) % PLOT_ROWS;
      const across: [number, number][] = [];
      if (c === 0) across.push([col - 1, row]);
      if (c === PLOT_COLS - 1) across.push([col + 1, row]);
      if (r === 0) across.push([col, row - 1]);
      if (r === PLOT_ROWS - 1) across.push([col, row + 1]);
      // (The start region's own inner edges aren't plot edges to the generator: anything goes there.)
      const start = (c2: number, r2: number) => c2 >= -PLOT_COLS && c2 < PLOT_COLS && r2 >= -PLOT_ROWS && r2 < PLOT_ROWS;
      for (const [ac, ar] of across) {
        if (start(col, row) && start(ac, ar)) continue;
        const j = g.index(ac, ar);
        if (j !== -1) expect(g.surface[j], `seed ${seed} ${col},${row}`).toBe(s);
      }
    });
    // Ids are places in their lists, and squares point at them.
    land.towns.forEach((t, k) => expect(t.id).toBe(k));
    land.depots.forEach((d, k) => expect(d.id).toBe(k));
    land.fields.forEach((f, k) => expect(f.id).toBe(k));
    for (const t of land.towns) for (const c of t.cells) if (g.feature[c] === FEAT_STATION) expect(g.owner[c]).toBe(t.id);
    for (const d of land.depots) expect(g.owner[g.cellAtWorld(d.centre.x, d.centre.z)]).toBe(d.id);
    for (const f of land.fields) for (const c of f.cells) expect([g.feature[c], g.owner[c]]).toEqual([FEAT_FIELD, f.id]);
    expect(new Set(land.towns.map((t) => t.name)).size).toBe(land.towns.length);
    expect(reachable(land)).toBe(true);
  });

  it("are the same whatever order they're bought in", () => {
    for (const seed of [3, 17, 99]) {
      const a = grow(seed, RING);
      const b = grow(seed, [...RING].reverse());
      for (const [px, pz] of RING) expect(plotSquares(a, px, pz)).toBe(plotSquares(b, px, pz));
    }
  });

  it("keep towns, depots, fields and anything that flattens hills off the band along their edges", () => {
    for (const seed of SEEDS.slice(0, 80)) {
      const part = generatePlot(seed, 2, -1);
      const g = part.grid;
      const stubs = new Set<number>();
      g.forEachCell((i, col, row) => {
        const c = col - 2 * PLOT_COLS;
        const r = row + PLOT_ROWS;
        const edge = Math.min(c, r, PLOT_COLS - 1 - c, PLOT_ROWS - 1 - r);
        if (edge >= BORDER_BAND) return;
        expect([FEAT_STATION, FEAT_DEPOT, FEAT_FIELD, FEAT_BUILDING]).not.toContain(g.feature[i]);
        if (g.surface[i] !== SURF_GRASS) stubs.add(i);
      });
      // Only crossings: straight in from the edge.
      for (const i of stubs) expect([SURF_RIVER, SURF_LANE]).toContain(g.surface[i]);
      expect(stubs.size % 1).toBe(0);
      expect(STUB_DEPTH).toBeGreaterThan(BORDER_BAND);
    }
  });

  it("bring towns, depots and fields often enough, and reachable from their edges", () => {
    let towns = 0;
    let depots = 0;
    for (const seed of SEEDS.slice(0, 100)) {
      const part = generatePlot(seed, -2, 0);
      towns += part.towns.length;
      depots += part.depots.length;
      expect(reachable(part)).toBe(true);
    }
    expect(towns).toBeGreaterThan(60);
    expect(depots).toBeGreaterThan(20);
  });

  it("joining a plot keeps the world's squares, ids and names, and moves the new ones on past them", () => {
    const land = generateLandscape(5);
    const before = Array.from(land.grid.height.subarray(0, land.grid.cellCount));
    const towns = land.towns.length;
    const part = generatePlot(5, 1, 0);
    const slots = adoptRegion(land, part);
    expect(slots).toEqual([4]);
    expect(Array.from(land.grid.height.subarray(0, before.length))).toEqual(before);
    expect(land.towns.length).toBe(towns + part.towns.length);
    land.towns.slice(towns).forEach((t, k) => {
      expect(t.id).toBe(towns + k);
      for (const c of t.cells) expect((c / (PLOT_COLS * PLOT_ROWS)) | 0).toBe(4);
    });
    expect(() => adoptRegion(land, generatePlot(5, 1, 0))).toThrow();
  });

  it("generates any rectangle of plots", () => {
    const land = generateRegion(11, { px0: 4, pz0: 4, w: 2, h: 1 }, { starter: false, shed: false });
    expect(land.grid.plots).toEqual([{ px: 4, pz: 4 }, { px: 5, pz: 4 }]);
    expect(gentle(land.grid)).toBe(true);
  });
});

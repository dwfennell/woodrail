import { describe, expect, it } from "vitest";
import { buildStarterWorld, landForSale, plotsForSale, unlockPlot } from "../game/world";
import { deserializeLandscape, serializeLandscape } from "../persist/landscape-data";
import { coastNear, coastOf, SAND, seaPlot, shoreDistance } from "./coast";
import { adoptRegion, generateLandscape, generatePlot } from "./generate";
import { PLOT_COLS, PLOT_ROWS, SURF_RIVER, SURF_SAND, SURF_SEA } from "./grid";

const SEEDS = Array.from({ length: 60 }, (_, i) => i + 1);

/** The coast plots one and two out from the start region on the sea's side, as (px, pz) for an index along it. */
function coastPlot(seed: number, k: number): [number, number] {
  const c = coastOf(seed);
  return c.side === "n" || c.side === "s" ? [k, c.plot] : [c.plot, k];
}

describe("the coast", () => {
  it("is one or two plots out from the start, on every map; the starter map's is the next plot out", () => {
    for (const seed of SEEDS) {
      const c = coastOf(seed);
      const out = c.side === "s" ? c.plot : c.side === "n" ? -1 - c.plot : c.side === "e" ? c.plot : -1 - c.plot;
      expect([1, 2]).toContain(out);
      const s = coastOf(seed, true);
      expect(s.side).toBe(c.side);
      expect(s.side === "s" || s.side === "e" ? s.plot : -1 - s.plot).toBe(1);
    }
    expect(generateLandscape(5).coast).toEqual(coastOf(5));
    expect(generateLandscape(5, { coast: false }).coast).toBeNull();
  });

  it("a coast plot has land, sand and sea; past it is all sea; the start region has none", () => {
    for (const seed of SEEDS.slice(0, 20)) {
      const start = generateLandscape(seed).grid;
      expect(start.surface.includes(SURF_SEA)).toBe(false);
      const [px, pz] = coastPlot(seed, 0);
      const g = generatePlot(seed, px, pz).grid;
      const count = (s: number) => {
        let n = 0;
        g.forEachCell((i) => {
          if (g.surface[i] === s) n++;
        });
        return n;
      };
      expect(count(SURF_SEA), `seed ${seed}`).toBeGreaterThan(PLOT_COLS * 3);
      expect(count(SURF_SAND)).toBeGreaterThan(10);
      expect(g.cellCount - count(SURF_SEA) - count(SURF_SAND)).toBeGreaterThan(PLOT_COLS * 5);
      // The beach and the sea are flat; the land rises no more than a block a square from the sand.
      g.forEachCell((i) => {
        if (g.surface[i] === SURF_SEA || g.surface[i] === SURF_SAND) expect(g.height[i]).toBe(0);
      });
      const c = coastOf(seed);
      const beyond = c.side === "n" || c.side === "s" ? [0, c.plot + (c.side === "s" ? 1 : -1)] : [c.plot + (c.side === "e" ? 1 : -1), 0];
      expect(seaPlot(c, beyond[0], beyond[1])).toBe(true);
      const sea = generatePlot(seed, beyond[0], beyond[1]).grid;
      sea.forEachCell((i) => expect(sea.surface[i]).toBe(SURF_SEA));
    }
  });

  it("meets itself across the edge between two coast plots", () => {
    for (const seed of SEEDS.slice(0, 20)) {
      const land = generateLandscape(seed);
      const c = coastOf(seed);
      const along = c.side === "n" || c.side === "s";
      // A run of coast plots, bought in an order that leaves each beside land the world has.
      const path: [number, number][] = [];
      if (along) {
        const step = c.side === "s" ? 1 : -1;
        for (let p = step > 0 ? 1 : -2; p !== c.plot + step; p += step) path.push([0, p]);
        path.push([1, c.plot], [-1, c.plot]);
      } else {
        const step = c.side === "e" ? 1 : -1;
        for (let p = step > 0 ? 1 : -2; p !== c.plot + step; p += step) path.push([p, 0]);
        path.push([c.plot, 1], [c.plot, -1]);
      }
      for (const [px, pz] of path) adoptRegion(land, generatePlot(seed, px, pz));
      const g = land.grid;
      // Sea and sand where the shore says, in every plot, so they meet across edges.
      g.forEachCell((i, col, row) => {
        const d = shoreDistance(c, col, row);
        if (d <= 0) expect(g.surface[i], `seed ${seed} ${col},${row}`).toBe(SURF_SEA);
        else if (d <= SAND) expect([SURF_SAND, SURF_RIVER]).toContain(g.surface[i]);
      });
    }
  });

  it("rivers on the coast plots run into the sea (no ponds)", () => {
    let rivers = 0;
    for (const seed of SEEDS) {
      for (const k of [-1, 0, 1]) {
        const [px, pz] = coastPlot(seed, k);
        const g = generatePlot(seed, px, pz).grid;
        const river: number[] = [];
        g.forEachCell((i) => {
          if (g.surface[i] === SURF_RIVER) river.push(i);
        });
        if (river.length === 0) continue;
        rivers++;
        // Every river square is joined, river square by river square, to the sea.
        const seen = new Set<number>();
        const queue = river.filter((i) => g.neighbours().slice(i * 4, i * 4 + 4).some((j) => j !== -1 && g.surface[j] === SURF_SEA));
        for (const i of queue) seen.add(i);
        while (queue.length) {
          const i = queue.pop()!;
          for (const j of g.neighbours().slice(i * 4, i * 4 + 4)) {
            if (j !== -1 && g.surface[j] === SURF_RIVER && !seen.has(j)) {
              seen.add(j);
              queue.push(j);
            }
          }
        }
        // (Crossings on a plot's edge come straight in first: those squares join it too.)
        expect(seen.size, `seed ${seed} plot ${px},${pz}`).toBe(river.length);
      }
    }
    expect(rivers).toBeGreaterThan(10);
  });

  it("the starter map: the coast is the next plot out (for sale), the open sea past it isn't", () => {
    const w = buildStarterWorld();
    const c = w.landscape.coast!;
    expect(c).toEqual(coastOf(w.landscape.seed, true));
    const forSale = plotsForSale(w.landscape);
    const coastal = forSale.filter((p) => landForSale(w.landscape, p.px, p.pz).grid.surface.includes(SURF_SEA));
    expect(coastal.length).toBeGreaterThan(0);
    const p = coastal[0];
    expect(unlockPlot(w, p.px, p.pz)).not.toBeNull();
    for (const q of plotsForSale(w.landscape)) expect(seaPlot(c, q.px, q.pz)).toBe(false);
    // Saved and loaded, it keeps its coast.
    const back = deserializeLandscape(JSON.parse(JSON.stringify(serializeLandscape(w.landscape))));
    expect(back.ok && back.value.coast).toEqual(c);
  });

  it("maps from before the coast keep none", () => {
    const land = generateLandscape(3, { coast: false });
    const data = serializeLandscape(land);
    expect("coast" in data).toBe(false);
    const back = deserializeLandscape(JSON.parse(JSON.stringify(data)));
    expect(back.ok && back.value.coast).toBeNull();
    expect(PLOT_ROWS).toBeGreaterThan(0);
  });

  it("a region said to be far from the shore is: no square of it (or round it) is within reach", () => {
    for (const seed of SEEDS.slice(0, 20)) {
      for (const c of [coastOf(seed), coastOf(seed, true)]) {
        for (const [px, pz] of [[-1, -1], [0, 0], [1, 0], [0, 1], [-1, 1], [-2, 0], [0, -2], [2, 2], [-3, -3]]) {
          const r = { px0: px, pz0: pz, w: 1, h: 1 };
          if (coastNear(c, r, 4, 3)) continue;
          let nearest = Infinity;
          for (let row = pz * PLOT_ROWS - 3; row < (pz + 1) * PLOT_ROWS + 3; row++) {
            for (let col = px * PLOT_COLS - 3; col < (px + 1) * PLOT_COLS + 3; col++) nearest = Math.min(nearest, shoreDistance(c, col, row));
          }
          expect(nearest, `seed ${seed} plot ${px},${pz}`).toBeGreaterThan(4);
        }
      }
      // The start region is far from every coast; a coast plot isn't.
      expect(coastNear(coastOf(seed, true), { px0: -1, pz0: -1, w: 2, h: 2 }, 4, 3)).toBe(false);
      const c = coastOf(seed);
      const [px, pz] = c.side === "n" || c.side === "s" ? [0, c.plot] : [c.plot, 0];
      expect(coastNear(c, { px0: px, pz0: pz, w: 1, h: 1 }, 4, 3)).toBe(true);
    }
  });
});

import { describe, expect, it } from "vitest";
import { GOALS, GoalTracker } from "../game/goals";
import { buildStarterWorld, createWorld, GAMES_KEY, landForSale, newMapSeed, plotsForSale, STARTER_SEED, unlockPlot } from "../game/world";
import { deserializeWorld, serializeWorld } from "../persist/save";
import { coastOf } from "./coast";
import { edgeContract } from "./edges";
import { generateLandscape, generatePlot, mapSettingsOf, waterOfLand } from "./generate";
import { PLOT_COLS, PLOT_ROWS, SURF_RIVER, SURF_SEA } from "./grid";
import { DEFAULT_WATER, LEGACY_WATER, mapCode, parseMapCode, WATER } from "./water";

const rivers = (g: { cellCount: number; surface: Uint8Array }) => {
  let n = 0;
  for (let i = 0; i < g.cellCount; i++) if (g.surface[i] === SURF_RIVER) n++;
  return n;
};

/** River squares on the start's plots and the ring of plots round it, as they'd be bought. */
function wetAround(seed: number, starter: boolean, water: (typeof WATER)[number]): { start: number; ring: number } {
  const start = rivers(generateLandscape(seed, { starter, water }).grid);
  let ring = 0;
  for (let px = -2; px <= 1; px++) for (let pz = -2; pz <= 1; pz++) if (px < -1 || px > 0 || pz < -1 || pz > 0) ring += rivers(generatePlot(seed, px, pz, coastOf(seed, starter), "hilly", water).grid);
  return { start, ring };
}

describe("how much water a map has", () => {
  it("Some (the default) is the rivers as they always were: the same crossings, edge by edge, and the same land", () => {
    expect(DEFAULT_WATER).toBe("some");
    expect(LEGACY_WATER).toBe("some");
    for (let px = -4; px <= 4; px++)
      for (let pz = -4; pz <= 4; pz++)
        for (const v of [true, false]) expect(edgeContract(24, v, px, pz, null, "some")).toEqual(edgeContract(24, v, px, pz));
    const old = generateLandscape(STARTER_SEED, { starter: true });
    const now = generateLandscape(STARTER_SEED, { starter: true, water: "some" });
    expect(now.water).toBeUndefined();
    expect(waterOfLand(now)).toBe("some");
    expect([...now.grid.surface]).toEqual([...old.grid.surface]);
  });

  it("None has no river or lake on the start, a few further out; Lots has more than Some (fixed seeds)", () => {
    let ringNone = 0;
    for (const seed of [STARTER_SEED, 24, 1234, 98765, 5]) {
      const starter = seed === STARTER_SEED;
      const none = wetAround(seed, starter, "none");
      const some = wetAround(seed, starter, "some");
      const lots = wetAround(seed, starter, "lots");
      expect(none.start).toBe(0);
      expect(none.ring).toBeLessThan(some.ring + 1);
      expect(lots.start + lots.ring).toBeGreaterThan(some.start + some.ring);
      ringNone += none.ring;
    }
    expect(ringNone).toBeGreaterThan(0);
  });

  it("is the same for a seed and setting every time", () => {
    for (const w of WATER) {
      const a = createWorld(31337, true, true, true, { water: w, coast: w !== "lots" });
      const b = createWorld(31337, true, true, true, { water: w, coast: w !== "lots" });
      expect([...a.landscape.grid.surface]).toEqual([...b.landscape.grid.surface]);
      expect([...a.landscape.grid.height]).toEqual([...b.landscape.grid.height]);
    }
  });

  it("no sea: a map with no coast at all, its land beyond with none either", () => {
    const w = createWorld(24, true, true, true, { coast: false });
    expect(w.landscape.coast ?? null).toBeNull();
    for (const p of plotsForSale(w.landscape)) {
      const g = landForSale(w.landscape, p.px, p.pz).grid;
      for (let i = 0; i < g.cellCount; i++) expect(g.surface[i]).not.toBe(SURF_SEA);
    }
  });

  it("is saved with the map: a reload keeps its water and sea, and land bought later is made with them", () => {
    for (const [water, coast] of [["none", false], ["lots", true], ["some", true]] as const) {
      const world = createWorld(24, true, true, true, { water, coast });
      const back = deserializeWorld(JSON.parse(JSON.stringify(serializeWorld(world))));
      if (!back.ok) throw new Error(back.error);
      expect(waterOfLand(back.value.landscape)).toBe(water);
      expect(!!back.value.landscape.coast).toBe(coast);
      expect([...back.value.landscape.grid.surface]).toEqual([...world.landscape.grid.surface]);
      const [p] = plotsForSale(world.landscape);
      const want = landForSale(world.landscape, p.px, p.pz).grid;
      expect(unlockPlot(back.value, p.px, p.pz)).not.toBeNull();
      const g = back.value.landscape.grid;
      for (let row = p.pz * PLOT_ROWS; row < (p.pz + 1) * PLOT_ROWS; row++)
        for (let col = p.px * PLOT_COLS; col < (p.px + 1) * PLOT_COLS; col++) expect(g.surface[g.index(col, row)]).toBe(want.surface[want.index(col, row)]);
    }
    // (An old save: no water in it, and none written back for Some.)
    const data = serializeWorld(createWorld(24, true)) as { landscape: object };
    expect("water" in data.landscape).toBe(false);
  });
});

describe("a map's code (its seed, to share)", () => {
  it("is the seed and what isn't as an older map: the words a #seed- link takes", () => {
    expect(mapCode({ seed: 12345, hills: "hilly", water: "some", coast: true })).toBe("12345");
    expect(mapCode({ seed: 7, hills: "gentle", water: "some", coast: true })).toBe("7-gentle");
    expect(mapCode({ seed: 4242, hills: "gentle", water: "none", coast: false })).toBe("4242-gentle-water-none-nocoast");
    for (const code of ["12345", "7-gentle", "4242-gentle-water-none-nocoast", "99-flat-water-lots", "5-nocoast"]) expect(mapCode(parseMapCode(code)!)).toBe(code);
    expect(parseMapCode(" 12345 ")).toEqual({ seed: 12345, hills: "hilly", water: "some", coast: true });
    for (const bad of ["", "abc", "12x", "1234567890", "5-alps", "5-water", "5-water-wet"]) expect(parseMapCode(bad)).toBeNull();
  });

  it("names a new game's map: the same code, the same world", () => {
    const w = buildStarterWorld();
    const code = mapCode(mapSettingsOf(w.landscape));
    expect(code).toBe("7-gentle");
    const again = parseMapCode(code)!;
    const w2 = createWorld(again.seed, true, true, true, again);
    expect([...w2.landscape.grid.height]).toEqual([...w.landscape.grid.height]);
    expect([...w2.landscape.grid.surface]).toEqual([...w.landscape.grid.surface]);
  });

  it("a new map's seed: the starter map's for a first game, a fresh one after it and in Sandbox", () => {
    const store = new Map<string, string>();
    const was = (globalThis as { localStorage?: Storage }).localStorage;
    (globalThis as { localStorage?: unknown }).localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) };
    try {
      expect(newMapSeed(true, () => 0.5)).toBe(STARTER_SEED);
      expect(newMapSeed(false, () => 0.5)).toBe(500000);
      store.set(GAMES_KEY, "1");
      expect(newMapSeed(true, () => 0.25)).toBe(250000);
    } finally {
      (globalThis as { localStorage?: unknown }).localStorage = was;
    }
  });
});

describe("the goals a map can't have", () => {
  it("no sea: no harbour or ship goals; no water: no barges; counted on neither, and a normal map has them all", () => {
    const counted = (w: ReturnType<typeof createWorld>) => {
      const t = new GoalTracker();
      t.update(w);
      return t.total + t.lockedCount;
    };
    const all = counted(createWorld(24, true));
    expect(all).toBe(GOALS.length);
    expect(counted(createWorld(24, true, true, true, { coast: false }))).toBe(GOALS.length - 2);
    expect(counted(createWorld(24, true, true, true, { water: "none" }))).toBe(GOALS.length - 1);
    expect(counted(createWorld(24, true, true, true, { water: "none", coast: false }))).toBe(GOALS.length - 3);
  });
});

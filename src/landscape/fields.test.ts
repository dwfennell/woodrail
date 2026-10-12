import { describe, expect, it } from "vitest";
import { checkPlacement } from "./clearance";
import { generateLandscape, reachable } from "./generate";
import { FEAT_FIELD, FEAT_SHED, SURF_GRASS } from "./grid";

const SEEDS = Array.from({ length: 200 }, (_, i) => i + 1);
// Generating a map is the slow part: make each one once for the whole file.
const cache = new Map<number, ReturnType<typeof generateLandscape>>();
const mapFor = (seed: number) => {
  let l = cache.get(seed);
  if (!l) cache.set(seed, (l = generateLandscape(seed)));
  return l;
};

describe("animal paddocks", () => {
  it.each(SEEDS)("seed %i: paddocks are flat 2 × 2 grass squares off the corridors, and towns stay reachable", (seed) => {
    const land = mapFor(seed);
    const g = land.grid;
    const corridors = new Set(land.corridors);
    expect(land.fields.length).toBeLessThanOrEqual(3);
    for (const f of land.fields) {
      expect(f.cells).toHaveLength(4);
      const [a] = f.cells;
      expect(f.cells.map((i) => [g.colOf(i) - g.colOf(a), g.rowOf(i) - g.rowOf(a)])).toEqual([[0, 0], [1, 0], [0, 1], [1, 1]]);
      for (const i of f.cells) {
        expect(g.feature[i]).toBe(FEAT_FIELD);
        expect(g.owner[i]).toBe(f.id);
        expect(g.surface[i]).toBe(SURF_GRASS);
        expect(g.height[i]).toBe(g.height[a]);
        expect(corridors.has(i)).toBe(false);
      }
    }
    expect(reachable(land)).toBe(true);
  });

  it("most maps have a paddock, and track can't be laid in one", () => {
    const lands = SEEDS.map((s) => mapFor(s));
    expect(lands.filter((l) => l.fields.length > 0).length).toBeGreaterThan(SEEDS.length * 0.8);
    const land = lands.find((l) => l.fields.length > 0)!;
    const i = land.fields[0].cells[0];
    const x = land.grid.centreX(land.grid.colOf(i));
    const z = land.grid.centreZ(land.grid.rowOf(i));
    const y = land.grid.groundY(i);
    expect(checkPlacement(land, "straight-54", false, { x: x - 27, z: z + 36, heading: 0 }, y)).toEqual({ kind: "blocked", reason: "field" });
  });
});

describe("engine shed", () => {
  it.each(SEEDS)("seed %i: the shed is a flat 2 × 2 block off the corridors, and towns stay reachable", (seed) => {
    const land = mapFor(seed);
    const g = land.grid;
    if (!land.shed) return;
    const corridors = new Set(land.corridors);
    const [a] = land.shed.cells;
    expect(land.shed.cells.map((i) => [g.colOf(i) - g.colOf(a), g.rowOf(i) - g.rowOf(a)])).toEqual([[0, 0], [1, 0], [0, 1], [1, 1]]);
    for (const i of land.shed.cells) {
      expect(g.feature[i]).toBe(FEAT_SHED);
      expect(g.height[i]).toBe(g.height[a]);
      expect(corridors.has(i)).toBe(false);
    }
    expect(Math.abs(Math.round(land.shed.heading / (Math.PI / 2)) * (Math.PI / 2) - land.shed.heading)).toBeLessThan(1e-9);
    expect(reachable(land)).toBe(true);
  });

  it("nearly every map, and the starter map, has a shed", () => {
    expect(SEEDS.filter((s) => mapFor(s).shed).length).toBeGreaterThan(SEEDS.length * 0.95);
    expect(generateLandscape(7, { starter: true }).shed).not.toBeNull();
  });
});

import { describe, expect, it } from "vitest";
import { checkPlacement } from "./clearance";
import { generateLandscape, pieceEnds, reachable, type Landscape } from "./generate";
import { CELL, FEAT_DEPOT, PLOT_DEPTH, PLOT_WIDTH, SURF_GRASS } from "./grid";

const SEEDS = Array.from({ length: 200 }, (_, i) => i + 1);
const cache = new Map<number, Landscape>();
const mapFor = (seed: number) => {
  let l = cache.get(seed);
  if (!l) cache.set(seed, (l = generateLandscape(seed)));
  return l;
};

function checkDepots(land: Landscape): void {
  const g = land.grid;
  const forests = land.depots.filter((d) => d.kind === "forest").length;
  const mills = land.depots.filter((d) => d.kind === "sawmill").length;
  expect(mills).toBe(1);
  expect(forests).toBeGreaterThanOrEqual(1);
  expect(forests).toBeLessThanOrEqual(2);
  const sites = [...land.towns.map((t) => t.centre), ...land.depots.map((d) => d.centre)];
  for (const d of land.depots) {
    // Faces a map direction, midpoint on a square centre, piece origin 108 mm behind it.
    expect(Math.abs(Math.round(d.piece.heading / (Math.PI / 2)) * (Math.PI / 2) - d.piece.heading)).toBeLessThan(1e-9);
    const i = g.cellAtWorld(d.centre.x, d.centre.z);
    expect(i).not.toBe(-1);
    expect(Math.abs(g.centreX(g.colOf(i)) - d.centre.x)).toBeLessThan(1e-6);
    expect(Math.hypot(d.piece.x + Math.cos(d.piece.heading) * 108 - d.centre.x, d.piece.z + Math.sin(d.piece.heading) * 108 - d.centre.z)).toBeLessThan(1e-6);
    // Its own flat, locked squares under the track.
    for (const t of [-90, 0, 90]) {
      const j = g.cellAtWorld(d.centre.x + Math.cos(d.piece.heading) * t, d.centre.z + Math.sin(d.piece.heading) * t);
      expect(g.feature[j]).toBe(FEAT_DEPOT);
      expect(g.owner[j]).toBe(d.id);
      expect(g.height[j]).toBe(0);
      expect(g.surface[j]).toBe(SURF_GRASS);
    }
    // Both ends on the land, far enough from every other site.
    for (const e of pieceEnds(d.piece)) {
      expect(Math.abs(e.x)).toBeLessThan(PLOT_WIDTH - CELL);
      expect(Math.abs(e.z)).toBeLessThan(PLOT_DEPTH - CELL);
    }
    for (const c of sites) if (c !== d.centre) expect(Math.hypot(c.x - d.centre.x, c.z - d.centre.z)).toBeGreaterThanOrEqual(750);
  }
  expect(reachable(land)).toBe(true);
}

describe("depots", () => {
  it.each(SEEDS)("seed %i: one sawmill and one or two forest yards, laid out like stations, all reachable", (seed) => {
    checkDepots(mapFor(seed));
  });

  it("the starter map has a sawmill near the first town and a forest near the second", () => {
    const land = generateLandscape(7, { starter: true });
    checkDepots(land);
    const [a, b] = land.towns;
    const mill = land.depots.find((d) => d.kind === "sawmill")!;
    const forest = land.depots.find((d) => d.kind === "forest")!;
    expect(Math.hypot(mill.centre.x - a.centre.x, mill.centre.z - a.centre.z)).toBeLessThan(1500);
    // (Six long straights from the second town's station: room for a passing loop mid-way.)
    expect(Math.hypot(forest.centre.x - b.centre.x, forest.centre.z - b.centre.z)).toBeLessThan(1600);
  });

  it("track can't be laid over a depot", () => {
    const land = mapFor(3);
    const d = land.depots[0];
    const pose = { x: d.centre.x - 27, z: d.centre.z, heading: 0 };
    expect(checkPlacement(land, "straight-54", false, pose, 0)).toEqual({ kind: "blocked", reason: "depot" });
  });

  it("is deterministic", () => {
    expect(generateLandscape(5).depots).toEqual(mapFor(5).depots);
  });
});

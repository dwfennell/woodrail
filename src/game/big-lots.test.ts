import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { FEAT_BUILDING, FEAT_NONE, SURF_ROAD, type Landscape } from "../landscape";
import { LandEditor } from "../landscape/edit";
import { scaleOf } from "../catalogue/scale";
import { loadFootprints } from "../props/footprints-testing";
import type { Footprint } from "../props/placement";
import { fitScale, fitsLot, townModels, townProps } from "../props/towns";
import { appendPiece, connectorRef } from "../track";
import { LANDMARKS } from "./landmarks";
import { growToCity, noRoomForBlocks } from "./town-testing";
import { buildStarterWorld } from "./world";

/** The game's own prop footprints (`Game.footprintOf`), so towns grow around their props as in the game. (Its props are towns' buildings.) */
let footprintOf: (asset: string) => Footprint | undefined = () => {
  throw new Error("footprints not loaded yet (see beforeAll)");
};
beforeAll(async () => {
  footprintOf = await loadFootprints(["bldg"]);
}, 60_000);

/** Is this a 2×2 block of squares with a street along one side? */
function isBlock(land: Landscape, cells: readonly number[]): boolean {
  const g = land.grid;
  const cols = new Set(cells.map((c) => g.colOf(c)));
  const rows = new Set(cells.map((c) => g.rowOf(c)));
  if (cells.length !== 4 || cols.size !== 2 || rows.size !== 2) return false;
  const [c0, c1] = [Math.min(...cols), Math.max(...cols)];
  const [r0, r1] = [Math.min(...rows), Math.max(...rows)];
  const side = (cs: [number, number][]) => cs.every(([c, r]) => g.surface[g.index(c, r)] === SURF_ROAD);
  return side([[c0 - 1, r0], [c0 - 1, r1]]) || side([[c1 + 1, r0], [c1 + 1, r1]]) || side([[c0, r0 - 1], [c1, r0 - 1]]) || side([[c0, r1 + 1], [c1, r1 + 1]]);
}

afterEach(() => vi.restoreAllMocks());

describe("big landmarks on 2×2 lots", () => {
  it("a city grows its market on a 2×2 block facing a street, with its own model", () => {
    const w = buildStarterWorld();
    const t = w.landscape.towns[0];
    growToCity(w, t, footprintOf);
    const props = townProps(w.landscape, t);
    for (const id of ["market"]) {
      const b = t.buildings.find((x) => x.landmark === id)!;
      expect(b.cells, id).toHaveLength(4);
      expect(isBlock(w.landscape, b.cells), id).toBe(true);
      expect(props.find((p) => p.building === b.id)!.asset, id).toBe(LANDMARKS.find((l) => l.id === id)!.models.four![0]);
    }
    // (Towns build no school or library: the player places a school, a depot beside a town, which grows its own wing.)
    expect(t.buildings.some((x) => x.landmark === "school" || x.landmark === "library")).toBe(false);
  });

  it("with no room for a block, on two squares, still itself (drawn as large as fits there); growth never waits", () => {
    for (const k of [0, 1, 2, 3, 4]) {
      const w = buildStarterWorld();
      noRoomForBlocks(w.landscape);
      const t = w.landscape.towns[k];
      growToCity(w, t, footprintOf);
      vi.restoreAllMocks();
      const props = townProps(w.landscape, t);
      for (const id of ["market"]) {
        const b = t.buildings.find((x) => x.landmark === id)!;
        expect(b, `${t.name} ${id}`).toBeDefined();
        expect(b.cells.length, id).toBeLessThan(4);
        const prop = props.find((p) => p.building === b.id)!;
        const mark = LANDMARKS.find((l) => l.id === id)!;
        // Its own model, never a stand-in, on two squares: smaller than it's drawn on a block, but no smaller than modelled.
        if (b.cells.length === 2) expect(prop.asset, `${t.name} ${id}`).toBe(mark.models.two[0]);
        const k = fitScale(prop.asset, b.cells.length)!;
        expect(k).toBeGreaterThanOrEqual(1);
        expect((prop.scale ?? 1) * scaleOf(prop.asset)).toBeCloseTo(k);
      }
    }
  });

  it("the same buildings level by level, and the same levels, with blocks or without", () => {
    // (Blocks are used: a market on one where there's room. Not in every town: one may have no block free when it
    // grows to a town.)
    let blocks = 0;
    for (const k of [0, 1, 2]) {
      const a = buildStarterWorld();
      const withBlocks = growToCity(a, a.landscape.towns[k], footprintOf);
      const b = buildStarterWorld();
      noRoomForBlocks(b.landscape);
      const without = growToCity(b, b.landscape.towns[k], footprintOf);
      vi.restoreAllMocks();
      expect(withBlocks.levels).toEqual(without.levels);
      expect(withBlocks.buildings, a.landscape.towns[k].name).toEqual(without.buildings);
      if (a.landscape.towns[k].buildings.some((x) => x.cells.length === 4)) blocks++;
    }
    expect(blocks).toBeGreaterThan(0);
  });

  it("no block over track or a station's way in", () => {
    const w = buildStarterWorld();
    const land = w.landscape;
    // Track out of each station's far end, along the towns' edges.
    for (const town of land.towns) {
      let last = w.stations.get(town.id)!;
      for (let i = 0; i < 4; i++) last = appendPiece(w.layout, "straight-216", false, connectorRef(last, 0));
    }
    for (const town of land.towns) growToCity(w, town, footprintOf);
    const g = land.grid;
    let blocks = 0;
    for (const town of land.towns) {
      for (const b of town.buildings.filter((x) => x.cells.length === 4)) {
        blocks++;
        // Let the block go for a moment, and ask a fresh editor (props aside: the building's own) about its squares.
        for (const c of b.cells) g.feature[c] = FEAT_NONE;
        const why = new LandEditor(land, w.layout, { inRect: () => false }).checkLot(b.cells, false);
        for (const c of b.cells) g.feature[c] = FEAT_BUILDING;
        expect(why, `${town.name} ${b.landmark}`).toBe(null);
      }
    }
    expect(blocks).toBeGreaterThan(0);
  });

  it("every model a town is dressed with fits inside its squares, at the size it's drawn", () => {
    for (const { asset, squares } of townModels()) expect(fitsLot(asset, squares), `${asset} on ${squares}`).toBe(true);
    for (const l of LANDMARKS) {
      // A landmark's list has at least one model that fits each lot it can go on.
      if (l.models.four?.length) expect(l.models.four.some((a) => fitsLot(a, 4)), l.id).toBe(true);
      expect(l.models.two.some((a) => fitsLot(a, 2)), l.id).toBe(true);
      if (!l.tech) expect(l.models.one.some((a) => fitsLot(a, 1)), l.id).toBe(true);
    }
  });
});

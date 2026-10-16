import { describe, expect, it } from "vitest";
import { buildStarterWorld, landForSale, plotsForSale, unlockPlot, type World } from "../game/world";
import { SURF_GRASS, SURF_LANE, SURF_SAND, SURF_SEA } from "../landscape/grid";
import { deserializeLandscape, serializeLandscape } from "../persist/landscape-data";
import { encodeRoad } from "./pieces";
import { groundUnder, RoadPlacer, setRoadSquare } from "./place";

/** The starter map with its coast plot bought. */
function coastWorld(): World {
  const w = buildStarterWorld();
  const p = plotsForSale(w.landscape).find((q) => landForSale(w.landscape, q.px, q.pz).grid.surface.includes(SURF_SEA))!;
  expect(unlockPlot(w, p.px, p.pz)).not.toBeNull();
  return w;
}

/** A square of beach a road may go on (nothing standing there), and one of grass. */
function squares(w: World): { sand: number; grass: number } {
  const g = w.landscape.grid;
  const placer = new RoadPlacer(w.landscape, w.layout, { inRect: () => false });
  let sand = -1;
  let grass = -1;
  g.forEachCell((i) => {
    if (sand === -1 && g.surface[i] === SURF_SAND && placer.check(i, encodeRoad("straight", 0)) === null) sand = i;
    if (grass === -1 && g.surface[i] === SURF_GRASS && placer.check(i, encodeRoad("straight", 0)) === null) grass = i;
  });
  expect(sand).not.toBe(-1);
  expect(grass).not.toBe(-1);
  return { sand, grass };
}

describe("roads on the beach", () => {
  it("go on sand, and the sand comes back when the road is taken off (deleted, or picked up)", () => {
    const w = coastWorld();
    const g = w.landscape.grid;
    const { sand, grass } = squares(w);
    expect(groundUnder(w.landscape, sand)).toBe(SURF_SAND);
    expect(groundUnder(w.landscape, grass)).toBe(SURF_GRASS);
    const road = encodeRoad("straight", 0);
    // Laid (as an edit), then deleted (another edit, as the delete tool does).
    setRoadSquare(g, sand, road, groundUnder(w.landscape, sand));
    expect(g.surface[sand]).toBe(SURF_LANE);
    setRoadSquare(g, sand, 0, groundUnder(w.landscape, sand));
    expect(g.surface[sand]).toBe(SURF_SAND);
    expect(g.road[sand]).toBe(0);
    // Picked up (the hand takes it off its square outside the history): sand under it; put back, a lane again.
    g.setRoad(sand, road, groundUnder(w.landscape, sand));
    g.setRoad(sand, 0, groundUnder(w.landscape, sand));
    expect(g.surface[sand]).toBe(SURF_SAND);
    // Grass stays grass.
    setRoadSquare(g, grass, road, groundUnder(w.landscape, grass));
    setRoadSquare(g, grass, 0, groundUnder(w.landscape, grass));
    expect(g.surface[grass]).toBe(SURF_GRASS);
  });

  it("undoing the road, or its removal, puts the square back as it was", () => {
    const w = coastWorld();
    const g = w.landscape.grid;
    const { sand } = squares(w);
    const road = encodeRoad("straight", 0);
    const undoLay = setRoadSquare(g, sand, road, groundUnder(w.landscape, sand));
    undoLay();
    expect([g.surface[sand], g.road[sand]]).toEqual([SURF_SAND, 0]);
    setRoadSquare(g, sand, road, groundUnder(w.landscape, sand));
    const undoDelete = setRoadSquare(g, sand, 0, groundUnder(w.landscape, sand));
    expect(g.surface[sand]).toBe(SURF_SAND);
    undoDelete();
    expect([g.surface[sand], g.road[sand]]).toEqual([SURF_LANE, road]);
  });

  it("a road on the beach is saved, and after loading, taking it off still leaves sand", () => {
    const w = coastWorld();
    const { sand } = squares(w);
    const road = encodeRoad("straight", 0);
    setRoadSquare(w.landscape.grid, sand, road, groundUnder(w.landscape, sand));
    const back = deserializeLandscape(JSON.parse(JSON.stringify(serializeLandscape(w.landscape))));
    expect(back.ok).toBe(true);
    if (!back.ok) return;
    const g = back.value.grid;
    expect([g.surface[sand], g.road[sand]]).toEqual([SURF_LANE, road]);
    setRoadSquare(g, sand, 0, groundUnder(back.value, sand));
    expect(g.surface[sand]).toBe(SURF_SAND);
  });

  it("still keeps off the sea", () => {
    const w = coastWorld();
    const g = w.landscape.grid;
    const placer = new RoadPlacer(w.landscape, w.layout, { inRect: () => false });
    let sea = -1;
    g.forEachCell((i) => {
      if (sea === -1 && g.surface[i] === SURF_SEA) sea = i;
    });
    expect(placer.check(sea, encodeRoad("straight", 0))).toBe("sea");
  });
});

import { describe, expect, it } from "vitest";
import { checkPlacement, crossesRoad, FEAT_BUILDING, FEAT_TREE, gridWithPlots, SURF_RIVER, SURF_ROAD, CELL, type Landscape } from "../landscape";
import { Layout } from "../track";
import { edgesOf, encodeRoad, EDGE_E, EDGE_W } from "./pieces";
import { RoadPlacer, roadNeighbours, roadsInRect, setRoadSquare } from "./place";

function land(): Landscape {
  return { seed: 1, starter: false, grid: gridWithPlots(0, 0, 1, 1), towns: [], depots: [], fields: [], shed: null, corridors: [], nextBuildingId: 0 };
}

describe("road placement", () => {
  it("goes on open level grass, and says why not elsewhere", () => {
    const l = land();
    const g = l.grid;
    const at = (c: number, r: number) => g.index(c, r);
    g.surface[at(1, 1)] = SURF_RIVER;
    g.surface[at(2, 1)] = SURF_ROAD;
    g.feature[at(3, 1)] = FEAT_BUILDING;
    g.height[at(4, 1)] = 1;
    g.feature[at(5, 1)] = FEAT_TREE;
    l.corridors = [at(6, 1)];
    const placer = new RoadPlacer(l, null, { inRect: (x0, z0) => x0 === 7 * CELL && z0 === CELL });
    expect(placer.check(at(0, 1))).toBeNull();
    expect(placer.check(-1)).toBe("off-land");
    expect(placer.check(at(1, 1))).toBe("river");
    expect(placer.check(at(2, 1))).toBe("town");
    expect(placer.check(at(3, 1))).toBe("in-use");
    expect(placer.check(at(4, 1))).toBe("hill");
    expect(placer.check(at(5, 1))).toBeNull();
    expect(placer.check(at(6, 1))).toBe("station-way");
    expect(placer.check(at(7, 1))).toBe("prop");
  });

  it("keeps clear of ground-level track", () => {
    const l = land();
    const layout = new Layout();
    // A long straight along x through row 3.
    layout.addPiece("straight-216", { x: 2 * CELL, z: 3.5 * CELL, heading: 0 }, 0, false);
    const placer = new RoadPlacer(l, layout);
    expect(placer.check(l.grid.index(3, 3))).toBe("track");
    expect(placer.check(l.grid.index(3, 5))).toBeNull();
  });

  it("turns a dropped piece to join the roads beside it, town streets included", () => {
    const l = land();
    const g = l.grid;
    g.surface[g.index(4, 4)] = SURF_ROAD;
    const placer = new RoadPlacer(l, null);
    const road = placer.fit("end", g.index(5, 4), 0);
    expect(edgesOf(road)).toBe(1 << EDGE_W);
    expect(roadNeighbours(g, g.index(5, 4))[EDGE_W]).not.toBe(0);
    expect(roadNeighbours(g, g.index(5, 4))[EDGE_E]).toBe(0);
  });

  it("clears a tree with the road and puts both back on undo", () => {
    const g = land().grid;
    const i = g.index(2, 2);
    g.feature[i] = FEAT_TREE;
    const undo = setRoadSquare(g, i, encodeRoad("straight", 0));
    expect(g.road[i]).not.toBe(0);
    expect(g.feature[i]).toBe(0);
    expect(roadsInRect(g, 2 * CELL + 10, 2 * CELL + 10, 2 * CELL + 20, 2 * CELL + 20)).toBe(true);
    expect(roadsInRect(g, 0, 0, 2 * CELL, 2 * CELL)).toBe(false);
    undo();
    expect(g.road[i]).toBe(0);
    expect(g.feature[i]).toBe(FEAT_TREE);
  });
});

describe("level crossings", () => {
  it("lets a plain straight go under ground-level track crossing it, but nothing along it or at a junction", () => {
    const l = land();
    const layout = new Layout();
    layout.addPiece("straight-216", { x: 2 * CELL, z: 3.5 * CELL, heading: 0 }, 0, false);
    const placer = new RoadPlacer(l, layout);
    const i = l.grid.index(3, 3);
    expect(placer.check(i, encodeRoad("straight", 1))).toBeNull();
    expect(placer.check(i, encodeRoad("straight", 0))).toBe("track");
    expect(placer.check(i, encodeRoad("tee", 0))).toBe("track");
    expect(placer.check(i, encodeRoad("zebra", 1))).toBe("track");
  });

  it("lets track cross a straight road square only across it", () => {
    const l = land();
    const g = l.grid;
    // A road running along z down column 4.
    for (let r = 0; r < 10; r++) g.setRoad(g.index(4, r), encodeRoad("straight", 1));
    const across = checkPlacement(l, "straight-216", false, { x: 2.5 * CELL, z: 5.5 * CELL, heading: 0 }, 0);
    expect(across.kind).toBe("clear");
    const along = checkPlacement(l, "straight-216", false, { x: 4.5 * CELL, z: 1 * CELL, heading: Math.PI / 2 }, 0);
    expect(along).toEqual({ kind: "blocked", reason: "road" });
    // Up on risers it passes over.
    expect(checkPlacement(l, "straight-216", false, { x: 4.5 * CELL, z: 1 * CELL, heading: Math.PI / 2 }, 24).kind).not.toBe("blocked");
    expect(crossesRoad(encodeRoad("curve", 0), 0)).toBe(false);
  });
});

describe("road bridges", () => {
  it("go over river squares only, and leave them river", () => {
    const l = land();
    const g = l.grid;
    const river = g.index(5, 5);
    g.surface[river] = SURF_RIVER;
    const placer = new RoadPlacer(l, null);
    expect(placer.check(river, encodeRoad("bridge", 0))).toBeNull();
    expect(placer.check(river, encodeRoad("straight", 0))).toBe("river");
    expect(placer.check(g.index(6, 5), encodeRoad("bridge", 0))).toBe("dry");
    const undo = setRoadSquare(g, river, encodeRoad("bridge", 0));
    expect(g.surface[river]).toBe(SURF_RIVER);
    // A road laid up to it turns to meet it.
    expect(edgesOf(placer.fit("end", g.index(6, 5), 0))).toBe(1 << EDGE_W);
    undo();
    expect(g.road[river]).toBe(0);
    expect(g.surface[river]).toBe(SURF_RIVER);
  });
});

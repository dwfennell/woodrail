import { describe, expect, it } from "vitest";
import { gridWithPlots, SURF_GRASS, SURF_LANE, SURF_ROAD } from "../landscape/grid";
import { fitLaneRoads } from "./lanes";
import { EDGE_E, EDGE_N, EDGE_S, EDGE_W, edgesOf, encodeRoad, pieceOf } from "./pieces";

describe("fitLaneRoads", () => {
  it("gives each lane square the piece that joins its lane neighbours", () => {
    const g = gridWithPlots(0, 0, 1, 1);
    // An L from a town street at (1,5): east to (4,5), then down to (4,6); and a lone lane square.
    for (const [c, r] of [[2, 5], [3, 5], [4, 5], [4, 6]]) g.surface[g.index(c, r)] = SURF_LANE;
    g.surface[g.index(1, 5)] = SURF_ROAD;
    g.surface[g.index(10, 10)] = SURF_LANE;
    expect(fitLaneRoads(g)).toBe(5);
    const edges = (c: number, r: number) => edgesOf(g.road[g.index(c, r)]);
    expect(edges(2, 5)).toBe((1 << EDGE_W) | (1 << EDGE_E));
    expect(edges(4, 5)).toBe((1 << EDGE_W) | (1 << EDGE_S));
    expect(edges(4, 6)).toBe(1 << EDGE_N);
    expect(pieceOf(g.road[g.index(10, 10)])?.id).toBe("end");
    // Squares that already have a piece keep it.
    g.road[g.index(3, 5)] = encodeRoad("zebra", 0);
    expect(fitLaneRoads(g)).toBe(0);
  });

  it("setRoad keeps the surface in step", () => {
    const g = gridWithPlots(0, 0, 1, 1);
    const i = g.index(3, 3);
    g.setRoad(i, encodeRoad("straight", 0));
    expect(g.surface[i]).toBe(SURF_LANE);
    g.setRoad(i, 0);
    expect(g.surface[i]).toBe(SURF_GRASS);
  });
});

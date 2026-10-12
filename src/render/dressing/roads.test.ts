import { MeshBasicMaterial, type Mesh } from "three";
import { describe, expect, it } from "vitest";
import { CELL, gridWithPlots, PLOT_COLS } from "../../landscape";
import { encodeRoad, ROAD_PIECES } from "../../roads";
import { buildRoadTiles, type RoadTiles } from "./roads";

const m = new MeshBasicMaterial();
const mats = { board: m, felt: m, paint: m, dark: m, beacon: m };

describe("road tiles", () => {
  it("draws every piece and turn within its own square", () => {
    for (const def of ROAD_PIECES) {
      for (let t = 0; t < 4; t++) {
        const g = gridWithPlots(0, 0, 1, 1);
        g.setRoad(g.index(5, 7), encodeRoad(def.id, t));
        const group = buildRoadTiles([g], mats, new Map());
        expect(group.children.length).toBeGreaterThanOrEqual(2);
        for (const child of group.children) {
          const box = (child as Mesh).geometry.boundingBox!;
          expect(box.min.x).toBeGreaterThanOrEqual(5 * CELL - 0.01);
          expect(box.max.x).toBeLessThanOrEqual(6 * CELL + 0.01);
          expect(box.min.z).toBeGreaterThanOrEqual(7 * CELL - 0.01);
          expect(box.max.z).toBeLessThanOrEqual(8 * CELL + 0.01);
        }
      }
    }
  });

  it("rebuilds only the tile whose roads changed", () => {
    const g = gridWithPlots(0, 0, 4, 1);
    const a = g.index(3, 3);
    const b = g.index(2 * PLOT_COLS + 3, 3);
    g.setRoad(a, encodeRoad("straight", 0));
    g.setRoad(b, encodeRoad("straight", 0));
    const cache: RoadTiles = new Map();
    buildRoadTiles([g], mats, cache);
    const before = new Map([...cache].map(([id, t]) => [id, t.geometries[0]]));
    expect(before.size).toBe(2);
    g.setRoad(b, encodeRoad("curve", 1));
    buildRoadTiles([g], mats, cache);
    const same = [...cache].filter(([id, t]) => before.get(id) === t.geometries[0]);
    expect(same).toHaveLength(1);
    // Taking the last road off a tile drops it.
    g.setRoad(b, 0);
    buildRoadTiles([g], mats, cache);
    expect(cache.size).toBe(1);
  });
});

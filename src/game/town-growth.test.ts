import { describe, expect, it } from "vitest";
import { FEAT_BUILDING, FEAT_NONE, FEAT_TREE, reachable, SURF_LANE, SURF_ROAD, SURF_TOWN } from "../landscape";
import { LandEditor } from "../landscape/edit";
import { addTownProps } from "../props/towns";
import { appendPiece, connectorRef } from "../track";
import { buildOnLots, lotPoint, nextLots } from "./town-growth";
import { buildStarterWorld } from "./world";

describe("town growth", () => {
  it("finds lots bordering the town, level and clear, without changing the map", () => {
    const w = buildStarterWorld();
    const town = w.landscape.towns[0];
    const before = w.landscape.grid.feature.slice();
    const lots = nextLots(w.landscape, town, new LandEditor(w.landscape, w.layout), 4);
    expect(lots).toHaveLength(4);
    expect(new Set(lots.flatMap((l) => l.cells)).size).toBe(lots.flatMap((l) => l.cells).length);
    // Every town on the starter map has room to grow (up onto hills where they must).
    for (const t of w.landscape.towns) expect(nextLots(w.landscape, t, new LandEditor(w.landscape, w.layout), 12).length, t.name).toBe(12);
    expect(w.landscape.grid.feature).toEqual(before);
  });

  it("builds on them: town squares with buildings that get catalogue models, every town still reachable", () => {
    const w = buildStarterWorld();
    const land = w.landscape;
    const town = land.towns[1];
    const had = town.buildings.length;
    const lots = nextLots(land, town, new LandEditor(land, w.layout), 3);
    const slots = buildOnLots(land, town, lots);
    expect(slots.length).toBeGreaterThan(0);
    expect(town.buildings).toHaveLength(had + 3);
    for (const c of lots.flatMap((l) => l.cells)) {
      expect(land.grid.feature[c]).toBe(FEAT_BUILDING);
      expect(land.grid.surface[c]).toBe(SURF_TOWN);
      expect(town.cells).toContain(c);
    }
    expect(addTownProps(land, w.props)).toBe(3);
    expect(reachable(land)).toBe(true);
  });

  it("keeps clear of track", () => {
    const w = buildStarterWorld();
    const town = w.landscape.towns[0];
    // Track out of the station's far end and on along the town's edge.
    let last = w.stations.get(town.id)!;
    const track: number[] = [];
    for (let i = 0; i < 3; i++) track.push((last = appendPiece(w.layout, "straight-216", false, connectorRef(last, 0))));
    const lots = nextLots(w.landscape, town, new LandEditor(w.landscape, w.layout), 30);
    const g = w.landscape.grid;
    for (const l of lots) {
      const p = lotPoint(w.landscape, l);
      for (const id of track) {
        const pose = w.layout.getPiece(id)!.pose;
        // No lot square has this piece's end inside it.
        expect(Math.abs(pose.x - p.x) < 36 && Math.abs(pose.z - p.z) < 36).toBe(false);
      }
      // Open, or a tree that the town fells.
      for (const c of l.cells) expect([FEAT_NONE, FEAT_TREE]).toContain(g.feature[c]);
    }
  });

  it("grows along its streets: each building faces a street joined to the town's, laid as it's needed", () => {
    const w = buildStarterWorld();
    const land = w.landscape;
    const g = land.grid;
    /** Separate street networks among a town's road squares (and the lanes they lead on to). */
    const networks = (town: (typeof land.towns)[number]) => {
      const isRoad = (i: number) => g.surface[i] === SURF_ROAD || g.surface[i] === SURF_LANE;
      const roads = town.cells.filter(isRoad);
      const seen = new Set<number>();
      let count = 0;
      for (const r of roads) {
        if (seen.has(r)) continue;
        count++;
        const todo = [r];
        seen.add(r);
        for (let k = 0; k < todo.length; k++) {
          for (const [dc, dr] of [[1, 0], [0, 1], [-1, 0], [0, -1]]) {
            const j = g.index(g.colOf(todo[k]) + dc, g.rowOf(todo[k]) + dr);
            if (j !== -1 && !seen.has(j) && isRoad(j)) {
              seen.add(j);
              todo.push(j);
            }
          }
        }
      }
      return count;
    };
    for (const town of land.towns) {
      const before = networks(town);
      const lots = nextLots(land, town, new LandEditor(land, w.layout), 10);
      buildOnLots(land, town, lots);
      const street = lots.filter((l) => l.streets !== undefined);
      expect(street.length, `${town.name}: lots along streets`).toBeGreaterThan(0);
      for (const l of street) {
        const c = l.cells[0];
        const front = g.index(g.colOf(c) + [1, 0, -1, 0][l.front!], g.rowOf(c) + [0, 1, 0, -1][l.front!]);
        expect([SURF_ROAD, SURF_LANE], `${town.name}: a street in front`).toContain(g.surface[front]);
      }
      // New streets join the ones there were: no stranded pieces of street. (A town may open a street behind its
      // station, across the line, reached by footbridge: one network each side of the line at most.)
      expect(networks(town), `${town.name}: street networks`).toBeGreaterThanOrEqual(before);
      expect(networks(town), `${town.name}: street networks`).toBeLessThanOrEqual(Math.max(before, 2));
    }
    expect(reachable(land)).toBe(true);
  });
});

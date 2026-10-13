import { describe, expect, it } from "vitest";
import { FEAT_BUILDING, FEAT_NONE, FEAT_TREE, reachable, SURF_TOWN } from "../landscape";
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
    expect(new Set(lots.map((l) => l.cell)).size).toBe(4);
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
    for (const l of lots) {
      expect(land.grid.feature[l.cell]).toBe(FEAT_BUILDING);
      expect(land.grid.surface[l.cell]).toBe(SURF_TOWN);
      expect(town.cells).toContain(l.cell);
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
      expect([FEAT_NONE, FEAT_TREE]).toContain(g.feature[l.cell]);
    }
  });
});

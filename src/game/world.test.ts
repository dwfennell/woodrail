import { describe, expect, it } from "vitest";
import { checkPlacement, connectedPairs } from "../landscape";
import { appendPiece, connectorRef } from "../track";
import { buildStarterWorld, createWorld } from "./world";

describe("createWorld", () => {
  it("places one station piece per town at the town's station pose", () => {
    const w = createWorld(123);
    expect(w.stations.size).toBe(w.landscape.towns.length);
    for (const town of w.landscape.towns) {
      const p = w.layout.getPiece(w.stations.get(town.id)!)!;
      expect(p.type).toBe("station");
      expect(p.pose).toEqual(town.station);
    }
    expect(w.sim.trainCount).toBe(0);
  });
});

describe("buildStarterWorld", () => {
  it("starts bare: just the towns' stations, no track and no trains", () => {
    const w = buildStarterWorld();
    for (const id of w.layout.pieceIds()) expect(w.layout.getPiece(id)!.type).toBe("station");
    expect(w.layout.pieceCount).toBe(w.landscape.towns.length);
    expect(w.sim.trainCount).toBe(0);
    expect(connectedPairs(w.layout, w.stations)).toEqual([]);
  });

  it("leaves an easy first job: four long straights join the first two towns, clear of the landscape", () => {
    const w = buildStarterWorld();
    const [a, b] = w.landscape.towns;
    let last = w.stations.get(a.id)!;
    for (let i = 0; i < 4; i++) {
      last = appendPiece(w.layout, "straight-216", false, connectorRef(last, 1));
      const p = w.layout.getPiece(last)!;
      expect(checkPlacement(w.landscape, p.type, p.flipped, p.pose, p.y)).toEqual({ kind: "clear" });
    }
    expect(connectedPairs(w.layout, w.stations)).toContainEqual([a.id, b.id]);
  });
});

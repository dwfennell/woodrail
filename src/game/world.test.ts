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
  it("starts bare: just the towns' stations and the depots, no track and no trains", () => {
    const w = buildStarterWorld();
    const fixed = new Set([...w.stations.values(), ...w.depots.values()]);
    for (const id of w.layout.pieceIds()) expect(fixed.has(id)).toBe(true);
    expect(w.layout.pieceCount).toBe(w.landscape.towns.length + w.landscape.depots.length);
    for (const d of w.landscape.depots) expect(w.layout.getPiece(w.depots.get(d.id)!)!.type).toBe(d.kind === "forest" ? "depot-forest" : "depot-sawmill");
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

describe("stations on the grid", () => {
  it("four long straights join the starter stations exactly", () => {
    const w = buildStarterWorld();
    const [a] = w.landscape.towns;
    let last = w.stations.get(a.id)!;
    // The station's peg end (connector 1) faces the other town.
    for (let i = 0; i < 4; i++) last = appendPiece(w.layout, "straight-216", false, connectorRef(last, 1));
    const joint = w.layout.jointAt(connectorRef(last, 1));
    expect(joint).toBeDefined();
    expect(joint!.posError).toBeLessThan(1e-6);
    expect(joint!.angleError).toBeLessThan(1e-6);
  });
});

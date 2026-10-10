import { describe, expect, it } from "vitest";
import { checkPlacement, connectedPairs } from "../landscape";
import { SIM_DT } from "../sim";
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
  it("joins the first two towns and keeps every piece clear of the landscape", () => {
    const w = buildStarterWorld();
    const [a, b] = w.landscape.towns;
    expect(connectedPairs(w.layout, w.stations)).toContainEqual([a.id, b.id]);
    for (const id of w.layout.pieceIds()) {
      const p = w.layout.getPiece(id)!;
      if (p.type === "station") continue;
      expect(checkPlacement(w.landscape, p.type, p.flipped, p.pose, p.y)).toEqual({ kind: "clear" });
    }
  });

  it("runs its train for a minute without derailing", () => {
    const w = buildStarterWorld();
    expect(w.sim.trainCount).toBe(1);
    for (let i = 0; i < 60 / SIM_DT; i++) w.sim.tick();
    expect(w.sim.getTrain(w.sim.trainIds()[0])!.derailed).toBe(false);
  });
});

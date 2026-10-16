import { describe, expect, it } from "vitest";
import { appendPiece, connectorRef, type WorldConnector } from "../track";
import { buildStarterWorld } from "./world";

const at = (): WorldConnector => ({ x: 0, z: 0, heading: 0, y: 0, kind: "peg" }) as WorldConnector;

describe("the starter line", () => {
  it("three long straights from the first town's station, then two large curves, meet the sawmill", () => {
    const w = buildStarterWorld();
    const station = w.stations.get(w.landscape.towns[0].id)!;
    // The station's west end.
    const ends = [0, 1].map((k) => w.layout.worldConnector(connectorRef(station, k), at()));
    let from = connectorRef(station, ends[0].x < ends[1].x ? 0 : 1);
    for (let k = 0; k < 3; k++) from = connectorRef(appendPiece(w.layout, "straight-216", false, from), 1);
    const saw = w.landscape.depots.find((d) => d.kind === "sawmill")!;
    const sawPiece = w.depots.get(saw.id)!;
    const sawEnds = [0, 1].map((k) => w.layout.worldConnector(connectorRef(sawPiece, k), at()));
    // The curves turn toward the sawmill (one way or the other: try both).
    let best = Infinity;
    for (const flipped of [false, true]) {
      const c1 = appendPiece(w.layout, "curve-large", flipped, from);
      const c2 = appendPiece(w.layout, "curve-large", flipped, connectorRef(c1, 1));
      const end = w.layout.worldConnector(connectorRef(c2, 1), at());
      for (const e of sawEnds) best = Math.min(best, Math.hypot(e.x - end.x, e.z - end.z));
      w.layout.removePiece(c2);
      w.layout.removePiece(c1);
    }
    expect(best).toBeLessThan(1);
  });
});

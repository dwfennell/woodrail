import { describe, expect, it } from "vitest";
import { Economy } from "../economy";
import { ringWithLoop } from "../routing/scenarios";
import { Sim } from "../sim";
import { Layout } from "../track";
import { createLine, inTheWayOf, joinLine, takeOffLine } from "./lines";

/**
 * Leave line's toast says the train is in the way only when it is (`inTheWayOf`): standing on the line's own track
 * with other trains on the line, not on a road of a passing loop (the others take the other road), and not when it
 * was the line's only train.
 */

/** A ring with one passing loop, a line A → B, a train standing at `at` and one more on the line (`others`: 0 or 1). */
function world(at: (r: ReturnType<typeof ringWithLoop>) => number, others = 1) {
  const layout = new Layout();
  const r = ringWithLoop(layout);
  const sim = new Sim(layout);
  const economy = new Economy(layout, sim);
  const a = economy.addDepot("forest", r.a, 0);
  const b = economy.addDepot("forest", r.b, 0);
  const put = (pieceId: number) => {
    const p = sim.addTrain(["engine"], { pieceId, pathIndex: 0, reversed: false, s: 60 });
    if (p.kind !== "placed") throw new Error("no room");
    return sim.getTrain(p.trainId)!.cars[0].id;
  };
  const line = createLine(economy, [
    { depotId: a.id, action: "auto" },
    { depotId: b.id, action: "auto" },
  ]);
  const off = put(at(r));
  joinLine(economy, off, line.id);
  const rest = others > 0 ? [put(r.round[2])] : [];
  for (const e of rest) joinLine(economy, e, line.id);
  takeOffLine(economy, off);
  return { economy, off, line, rest };
}

describe("a train taken off its line: in its other trains' way?", () => {
  it("standing on the line's plain track: in the way of the line's other train", () => {
    const w = world((r) => r.north[1]);
    expect(inTheWayOf(w.economy, w.off, w.line.id)).toEqual(w.rest);
  });

  it("on either road of a passing loop: not in the way, the others pass by the other road", () => {
    for (const at of [(r: ReturnType<typeof ringWithLoop>) => r.loop.main[0], (r: ReturnType<typeof ringWithLoop>) => r.loop.side[1]]) {
      const w = world(at);
      expect(inTheWayOf(w.economy, w.off, w.line.id)).toEqual([]);
    }
  });

  it("the line's only train: in nobody's way", () => {
    const w = world((r) => r.north[1], 0);
    expect(inTheWayOf(w.economy, w.off, w.line.id)).toEqual([]);
  });
});

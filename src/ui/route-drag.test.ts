import { describe, expect, it } from "vitest";
import { Economy } from "../economy";
import { editLine, joinLine, moveStop } from "../game/lines";
import { Sim } from "../sim";
import { Layout } from "../track";
import { dropSlot, dropTarget, wouldRepeat } from "./route-drag";

describe("drag to reorder a route's stops", () => {
  // (Three chips, their middles at 40, 120 and 200 px along the strip.)
  const middles = [40, 120, 200];

  it("dropSlot: the slot past every stop's middle left of the finger", () => {
    expect(dropSlot(middles, 10)).toBe(0);
    expect(dropSlot(middles, 41)).toBe(1);
    expect(dropSlot(middles, 150)).toBe(2);
    expect(dropSlot(middles, 400)).toBe(3);
  });

  it("dropTarget: the index the stop ends at; next to itself is no move", () => {
    // Stop 2 dragged before stop 0: it's first.
    expect(dropTarget(2, 0)).toBe(0);
    // Stop 0 dragged past the last: it's last (index 2 of 3).
    expect(dropTarget(0, 3)).toBe(2);
    // Either side of itself: where it was.
    expect(dropTarget(1, 1)).toBe(1);
    expect(dropTarget(1, 2)).toBe(1);
    // And with moveStop, as the card does it.
    const order = ["a", "b", "c"].map((p, i) => ({ depotId: i, action: "auto" as const, p }));
    moveStop(order, 2, dropTarget(2, dropSlot(middles, 10)));
    expect(order.map((s) => s.p)).toEqual(["c", "a", "b"]);
  });

  it("wouldRepeat: not where it puts the same place twice in a row (as the ← → arrows)", () => {
    // A → B → A → C: the second A next to the first, either way.
    expect(wouldRepeat([1, 2, 1, 3], 2, 1)).toBe(true);
    expect(wouldRepeat([1, 2, 1, 3], 2, 0)).toBe(true);
    expect(wouldRepeat([1, 2, 1, 3], 2, 3)).toBe(false);
    expect(wouldRepeat([1, 2, 1, 3], 3, 1)).toBe(false);
    expect(wouldRepeat([1, 2, 1, 3], 1, 3)).toBe(true);
    expect(wouldRepeat([1, 2, 3], 0, 0)).toBe(false);
  });

  it("a stop dragged to the front of a line run by two trains: each keeps heading for the stop it was", () => {
    const layout = new Layout();
    const ids = (["depot-forest", "straight-216", "depot-sawmill", "straight-216", "station"] as const).map((t, i) => layout.addPiece(t, { x: i * 216, z: 0, heading: 0 }));
    const sim = new Sim(layout);
    const economy = new Economy(layout, sim);
    const forest = economy.addDepot("forest", ids[0], 0).id;
    const mill = economy.addDepot("sawmill", ids[2], 0).id;
    const town = economy.addDepot("town", ids[4], 0).id;
    const engines = [ids[1], ids[3]].map((pieceId) => {
      const r = sim.addTrain(["engine"], { pieceId, pathIndex: 0, reversed: false, s: 100 });
      if (r.kind !== "placed") throw new Error();
      return sim.getTrain(r.trainId)!.cars[0].id;
    });
    const line = editLine(economy, engines[0], (s) => s.push({ depotId: forest, action: "auto" }, { depotId: mill, action: "drop" }, { depotId: town, action: "auto", waitFill: true }))!;
    joinLine(economy, engines[1], line.id);
    economy.routeOf(engines[0])!.next = 1;
    economy.routeOf(engines[1])!.next = 2;
    const heading = (e: number) => economy.routeOf(e)!.stops[economy.routeOf(e)!.next].depotId;
    editLine(economy, engines[0], (s) => moveStop(s, 2, dropTarget(2, 0)));
    expect(line.stops.map((s) => s.depotId)).toEqual([town, forest, mill]);
    // (Its settings go with it.)
    expect(line.stops[0]).toMatchObject({ action: "auto", waitFill: true });
    expect(line.stops[2]).toMatchObject({ action: "drop" });
    expect(heading(engines[0])).toBe(mill);
    expect(heading(engines[1])).toBe(town);
  });
});

import { describe, expect, it } from "vitest";
import { Sim, SIM_HZ } from "../sim";
import { appendPiece, connectorRef, Layout, type PieceTypeId } from "../track";
import { Economy } from "./economy";

/**
 * A closed oval: half a circle of large curves, then forest yard, a straight and the sawmill; the other half
 * circle, then the town station and two straights. One engine with three timber wagons goes round and round.
 */
function loop() {
  const layout = new Layout();
  const half: PieceTypeId[] = ["curve-large", "curve-large", "curve-large", "curve-large"];
  const sequence: PieceTypeId[] = [...half, "depot-forest", "straight-216", "depot-sawmill", ...half, "station", "straight-216", "straight-216"];
  const ids: number[] = [];
  let last = -1;
  for (const type of sequence) {
    last = last === -1 ? layout.addPiece(type, { x: 0, z: 0, heading: 0 }) : appendPiece(layout, type, false, connectorRef(last, 1));
    ids.push(last);
  }
  const sim = new Sim(layout);
  const economy = new Economy(layout, sim);
  const at = (type: PieceTypeId) => ids[sequence.indexOf(type)];
  economy.addDepot("forest", at("depot-forest"));
  economy.addDepot("sawmill", at("depot-sawmill"));
  economy.addDepot("town", at("station"), 0);
  const placed = sim.addTrain(["engine", "timber", "timber", "timber"], { pieceId: ids[ids.length - 1], pathIndex: 0, reversed: false, s: 200 });
  if (placed.kind !== "placed") throw new Error("no room");
  sim.setLever(sim.getTrain(placed.trainId)!.cars[0].id, 1);
  return { layout, sim, economy, closed: [...layout.joints()].length === sequence.length };
}

function deliveredAfter(minutes: number): number {
  const { sim, economy } = loop();
  for (let i = 0; i < minutes * 60 * SIM_HZ; i++) {
    sim.tick();
    economy.tick();
  }
  expect(sim.getTrain(sim.trainIds()[0])!.derailed).toBe(false);
  return economy.delivered.get(0) ?? 0;
}

describe("a timber loop runs itself", () => {
  it("is a closed loop", () => {
    expect(loop().closed).toBe(true);
  });

  it("delivers planks to the town, the same number every time", () => {
    const first = deliveredAfter(10);
    expect(first).toBeGreaterThan(0);
    expect(deliveredAfter(10)).toBe(first);
    expect(first).toBe(DELIVERED_IN_10_MINUTES);
  });
});

/**
 * Recorded from a run; a change here means the loop's timing changed. (25 until trains stopped crawling through
 * depots where they had nothing to do.)
 */
const DELIVERED_IN_10_MINUTES = 27;

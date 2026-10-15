import { describe, expect, it } from "vitest";
import { CARGO, Economy } from "../economy";
import { Sim, SIM_HZ } from "../sim";
import { appendPiece, connectorRef, getPieceDef, Layout, type PieceTypeId } from "../track";
import { townLevel } from "./towns";

function lay(layout: Layout, ref: number, type: PieceTypeId): number {
  const end = layout.worldConnector(ref, { x: 0, z: 0, heading: 0, y: 0, kind: "peg" });
  const via = getPieceDef(type, false).connectors.findIndex((c) => c.kind !== end.kind);
  return appendPiece(layout, type, false, ref, via);
}
const otherEnd = (layout: Layout, id: number) => [0, 1].map((k) => connectorRef(id, k)).find((r) => layout.joinedConnector(r) === -1)!;
function endAt(layout: Layout, ref: number): void {
  const end = layout.worldConnector(ref, { x: 0, z: 0, heading: 0, y: 0, kind: "peg" });
  lay(layout, end.kind === "peg" ? ref : otherEnd(layout, lay(layout, ref, "adapter-peg")), "buffer-turnback");
}

describe("mining and iron", () => {
  it("a hopper train between a mine and a foundry: coal and ore in, iron out", () => {
    const layout = new Layout();
    const mine = layout.addPiece("depot-mine", { x: 0, z: 0, heading: 0 });
    endAt(layout, connectorRef(mine, 0));
    let last = mine;
    for (let i = 0; i < 3; i++) last = lay(layout, otherEnd(layout, last), "straight-216");
    const foundry = lay(layout, otherEnd(layout, last), "depot-foundry");
    endAt(layout, otherEnd(layout, foundry));
    const sim = new Sim(layout);
    const placed = sim.addTrain(["engine", "hopper", "hopper"], { pieceId: last, pathIndex: 0, reversed: false, s: 150 });
    if (placed.kind !== "placed") throw new Error("no room");
    const economy = new Economy(layout, sim);
    const m = economy.addDepot("mine", mine);
    const f = economy.addDepot("foundry", foundry);
    sim.setLever(sim.getTrain(placed.trainId)!.cars[0].id, -1);
    for (let i = 0; i < 6 * 60 * SIM_HZ; i++) {
      sim.tick();
      economy.tick();
    }
    expect(economy.made[CARGO.coal.index]).toBeGreaterThan(0);
    expect(economy.made[CARGO.ore.index]).toBeGreaterThan(0);
    expect(economy.made[CARGO.iron.index]).toBeGreaterThan(0);
    expect(f.piles[CARGO.iron.index] + m.piles[CARGO.coal.index]).toBeGreaterThan(0);
  });

  it("cities want iron from their second star on", () => {
    expect(townLevel(4).wants.iron).toBeUndefined();
    expect(townLevel(5).wants.iron).toBe(10);
    expect(townLevel(6).wants.iron).toBe(15);
  });
});

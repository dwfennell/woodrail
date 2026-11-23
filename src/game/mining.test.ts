import { describe, expect, it } from "vitest";
import { capAt, CARGO, Economy } from "../economy";
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

  it("a mine full of ore goes on bringing up coal; full of both, it stops", () => {
    const layout = new Layout();
    const mine = layout.addPiece("depot-mine", { x: 0, z: 0, heading: 0 });
    const sim = new Sim(layout);
    const economy = new Economy(layout, sim);
    const m = economy.addDepot("mine", mine);
    const run = (seconds: number) => {
      for (let i = 0; i < seconds * SIM_HZ; i++) economy.tick();
    };
    // A cycle brings up two coal and one ore.
    run(18 + 1);
    expect([m.piles[CARGO.coal.index], m.piles[CARGO.ore.index]]).toEqual([2, 1]);
    // Ore piled to the cap (no train takes it): coal still comes up, two a cycle, and no ore past the cap.
    m.piles[CARGO.coal.index] = 0;
    m.piles[CARGO.ore.index] = capAt(m);
    expect(economy.working(m)).toBe(true);
    run(18 * 3);
    expect(m.piles[CARGO.coal.index]).toBe(6);
    expect(m.piles[CARGO.ore.index]).toBe(capAt(m));
    expect(economy.made[CARGO.coal.index]).toBe(2 + 6);
    expect(economy.made[CARGO.ore.index]).toBe(1);
    // Room for one coal only: the pile is topped up to its cap.
    m.piles[CARGO.ore.index] = 0;
    m.piles[CARGO.coal.index] = capAt(m) - 1;
    run(18);
    expect([m.piles[CARGO.coal.index], m.piles[CARGO.ore.index]]).toEqual([capAt(m), 1]);
    // The same the other way round.
    m.piles[CARGO.ore.index] = 0;
    m.piles[CARGO.coal.index] = capAt(m);
    run(18 + 1);
    expect(m.piles[CARGO.ore.index]).toBe(1);
    expect(m.piles[CARGO.coal.index]).toBe(capAt(m));
    // Both full: not working, nothing made.
    m.piles[CARGO.ore.index] = capAt(m);
    expect(economy.working(m)).toBe(false);
    const made = [economy.made[CARGO.coal.index], economy.made[CARGO.ore.index]];
    run(60);
    expect([economy.made[CARGO.coal.index], economy.made[CARGO.ore.index]]).toEqual(made);
    expect(m.piles[CARGO.coal.index]).toBe(capAt(m));
  });

  it("a city ★ wants iron to grow its second star, and more from then on", () => {
    expect(townLevel(3).wants.iron).toBeUndefined();
    expect(townLevel(4).wants.iron).toBe(10);
    expect(townLevel(5).wants.iron).toBe(15);
  });
});

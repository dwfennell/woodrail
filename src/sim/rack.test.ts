import { describe, expect, it } from "vitest";
import { appendPiece, connectorRef, Layout, type PieceTypeId } from "../track";
import { Sim, SIM_DT, RACK_SLOW } from "./sim";

/** Flat straights, a rack up two levels, straights on top: the piece ids in order (the rack is `ids[2]`). */
function line(rack: PieceTypeId = "rack"): { layout: Layout; ids: number[] } {
  const layout = new Layout();
  const ids = [layout.addPiece("straight-216", { x: 0, z: 0, heading: 0 }, 0, false)];
  for (const type of ["straight-216", rack, "straight-216", "straight-216"] as PieceTypeId[]) {
    const id = appendPiece(layout, type, false, connectorRef(ids[ids.length - 1], 1), 0);
    expect(id).toBeGreaterThanOrEqual(0);
    ids.push(id);
  }
  return { layout, ids };
}

/** A train on the first straight, its lever on; `may` says whether it may climb a rack. Ticks till `seconds`. */
function run(layout: Layout, from: number, may: boolean | null, seconds: number, onTick?: (sim: Sim, trainId: number) => void) {
  const sim = new Sim(layout);
  sim.mayRack = may === null ? null : () => may;
  const r = sim.addTrain(["engine", "passenger"], { pieceId: from, pathIndex: 0, reversed: false, s: 150 });
  if (r.kind !== "placed") throw new Error(r.kind);
  const t = sim.getTrain(r.trainId)!;
  sim.setLever(t.cars.find((c) => c.kind === "engine")!.id, 1);
  for (let k = 0; k * SIM_DT < seconds; k++) {
    sim.tick();
    onTick?.(sim, r.trainId);
  }
  return { sim, train: sim.getTrain(sim.trainIds()[0])! };
}

/** The top speed a train reaches on the flat (the second straight). */
function flatTop(layout: Layout, ids: number[]): number {
  let top = 0;
  run(layout, ids[0], null, 10, (s) => {
    const t = s.getTrain(s.trainIds()[0])!;
    if (t.bogies.every((b) => b.pieceId === ids[1])) top = Math.max(top, t.speed);
  });
  return top;
}

describe("racks", () => {
  it("a train with no rack engine stops short of the rack's foot and waits there, saying which rack", () => {
    const { layout, ids } = line();
    const { sim, train } = run(layout, ids[0], false, 20);
    expect(train.speed).toBe(0);
    expect(train.bogies.every((b) => b.pieceId !== ids[2])).toBe(true);
    // Its nose (the engine's front) is on the straight before the rack, close to the joint.
    expect(train.bogies[0].pieceId).toBe(ids[1]);
    expect(train.bogies[0].s).toBeGreaterThan(150);
    expect(sim.rackHeld(train.id)).toBe(ids[2]);
  });

  it("the same going down: no rack engine, it stops short of the rack's top", () => {
    const { layout, ids } = line();
    const sim = new Sim(layout);
    sim.mayRack = () => false;
    const r = sim.addTrain(["engine", "passenger"], { pieceId: ids[3], pathIndex: 0, reversed: true, s: 200 });
    if (r.kind !== "placed") throw new Error(r.kind);
    const t = sim.getTrain(r.trainId)!;
    sim.setLever(t.cars.find((c) => c.kind === "engine")!.id, 1);
    for (let k = 0; k * SIM_DT < 20; k++) sim.tick();
    expect(t.speed).toBe(0);
    expect(t.bogies.every((b) => b.pieceId !== ids[2])).toBe(true);
    expect(sim.rackHeld(t.id)).toBe(ids[2]);
  });

  it("a train with a rack engine climbs it, at half speed on it, and runs on at the top", () => {
    const { layout, ids } = line();
    let onRack = 0;
    let flat = 0;
    const { sim, train } = run(layout, ids[0], true, 30, (s, id) => {
      const t = s.getTrain(s.trainIds()[0])!;
      void id;
      if (t.bogies[0].pieceId === ids[2] && t.bogies[0].s > 60) onRack = Math.max(onRack, t.speed);
      if (t.bogies.every((b) => b.pieceId === ids[1])) flat = Math.max(flat, t.speed);
    });
    expect(train.bogies.some((b) => b.pieceId === ids[4]) || train.turnback >= 0 || train.bogies.some((b) => b.pieceId === ids[3])).toBe(true);
    expect(onRack).toBeGreaterThan(0);
    expect(onRack).toBeLessThanOrEqual(flat * RACK_SLOW + 1);
    expect(sim.rackHeld(train.id)).toBe(-1);
  });

  it("with no rule (Sandbox), any train climbs it at full speed", () => {
    const { layout, ids } = line("rack-short");
    let top = 0;
    const { train } = run(layout, ids[0], null, 30, (s, id) => {
      const t = s.getTrain(s.trainIds()[0])!;
      void id;
      if (t.bogies[0].pieceId === ids[2] && t.bogies[0].s > 60) top = Math.max(top, t.speed);
    });
    expect(train.bogies.some((b) => b.pieceId === ids[3] || b.pieceId === ids[4])).toBe(true);
    expect(top).toBeGreaterThan(0);
    // (Full speed on it: no rack slowing without the rule.)
    expect(top).toBeGreaterThan(flatTop(layout, ids) * RACK_SLOW + 5);
  });

  it("the short rack holds a train with no rack engine too", () => {
    const { layout, ids } = line("rack-short");
    const { sim, train } = run(layout, ids[0], false, 20);
    expect(train.bogies.every((b) => b.pieceId !== ids[2])).toBe(true);
    expect(sim.rackHeld(train.id)).toBe(ids[2]);
  });
});

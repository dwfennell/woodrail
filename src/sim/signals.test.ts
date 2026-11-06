import { describe, expect, it } from "vitest";
import { appendPiece, connectorRef, getPieceDef, Layout, type PieceTypeId } from "../track";
import { Sim, SIM_DT } from "./sim";

function chain(types: PieceTypeId[]): { layout: Layout; ids: number[] } {
  const layout = new Layout();
  const ids = [layout.addPiece(types[0], { x: 0, z: 0, heading: 0 }, 0, false)];
  for (let i = 1; i < types.length; i++) ids.push(appendPiece(layout, types[i], false, connectorRef(ids[i - 1], 1)));
  return { layout, ids };
}

function run(sim: Sim, seconds: number): void {
  for (let i = Math.round(seconds / SIM_DT); i > 0; i--) sim.tick();
}

/** A train with its engine driving forward (toward connector 1 of each piece), its front at `s` on `pieceId`. */
function driving(sim: Sim, pieceId: number, s: number, cars: ("engine" | "hopper")[] = ["engine", "hopper"]): number {
  const r = sim.addTrain(cars, { pieceId, pathIndex: 0, reversed: false, s });
  if (r.kind !== "placed") throw new Error(r.kind);
  sim.setLever(sim.getTrain(r.trainId)!.cars[0].id, 1);
  return r.trainId;
}

const STOP_AT = getPieceDef("signal", false).signal!.stopAt;

// straight, straight, SIGNAL, straight × 4 (the block), buffer.
const line = () => chain(["straight-216", "straight-216", "signal", "straight-216", "straight-216", "straight-216", "straight-216", "buffer"]);

describe("signals: block working", () => {
  it("a train stops just short of a signal while a train stands in the block beyond, and goes on once it's clear", () => {
    const { layout, ids } = line();
    const sim = new Sim(layout);
    // A train standing in the block (lever off).
    const parked = sim.addTrain(["engine", "hopper"], { pieceId: ids[5], pathIndex: 0, reversed: false, s: 100 });
    if (parked.kind !== "placed") throw new Error();
    const t = driving(sim, ids[0], 150);
    run(sim, 6);
    expect(sim.signalClear(ids[2])).toBe(false);
    const front = sim.getTrain(t)!.bogies[0];
    // Halted on the signal piece, its front axle at the stop point (not past it).
    expect(front.pieceId).toBe(ids[2]);
    expect(front.s).toBeLessThanOrEqual(STOP_AT);
    expect(front.s).toBeGreaterThan(STOP_AT - 4);
    expect(sim.getTrain(t)!.speed).toBe(0);
    // The block clears (the standing train is taken away): the signal goes to clear and the train drives on.
    sim.removeTrain(parked.trainId);
    run(sim, 0.1);
    expect(sim.signalClear(ids[2])).toBe(true);
    run(sim, 3);
    expect(sim.getTrain(t)!.bogies[0].pieceId).not.toBe(ids[2]);
  });

  it("two trains running the same way on one line: the one behind waits at the signal rather than catching up", () => {
    const { layout, ids } = line();
    const sim = new Sim(layout);
    const ahead = driving(sim, ids[3], 200);
    const behind = driving(sim, ids[1], 150);
    run(sim, 2);
    // The one ahead runs on to the buffer and waits there (in the block): the one behind holds at the signal.
    run(sim, 4);
    expect(sim.getTrain(behind)).toBeDefined();
    expect(sim.getTrain(behind)!.bogies[0].pieceId).toBe(ids[2]);
    expect(sim.signalClear(ids[2])).toBe(false);
    void ahead;
  });

  it("held at red by a tap, whatever the line ahead; a second tap lets it work by itself again", () => {
    const { layout, ids } = line();
    const sim = new Sim(layout);
    sim.toggleSwitch(ids[2]);
    expect(sim.signalHeld(ids[2])).toBe(true);
    const t = driving(sim, ids[0], 150);
    run(sim, 6);
    expect(sim.getTrain(t)!.bogies[0].pieceId).toBe(ids[2]);
    expect(sim.getTrain(t)!.speed).toBe(0);
    sim.toggleSwitch(ids[2]);
    run(sim, 3);
    expect(sim.getTrain(t)!.bogies[0].pieceId).not.toBe(ids[2]);
  });

  it("a signal guards one way only: a train running the other way passes it at red", () => {
    const { layout, ids } = line();
    const sim = new Sim(layout);
    sim.toggleSwitch(ids[2]);
    // Running back toward the start (against the signal's way).
    const r = sim.addTrain(["engine"], { pieceId: ids[3], pathIndex: 0, reversed: true, s: 150 });
    if (r.kind !== "placed") throw new Error();
    sim.setLever(sim.getTrain(r.trainId)!.cars[0].id, 1);
    run(sim, 4);
    const front = sim.getTrain(r.trainId)?.bogies[0];
    expect(front && front.pieceId !== ids[2] && front.pieceId !== ids[3]).toBe(true);
  });

  it("its block runs on through a switch (a path signal): a train on the way beyond holds one coming to it; points set the other way, it goes", () => {
    const { layout, ids } = chain(["straight-216", "signal", "straight-216", "switch", "straight-216", "straight-216", "buffer"]);
    const sim = new Sim(layout);
    const beyond = sim.addTrain(["engine"], { pieceId: ids[4], pathIndex: 0, reversed: false, s: 150 });
    if (beyond.kind !== "placed") throw new Error();
    const t = driving(sim, ids[0], 200, ["engine"]);
    run(sim, 5);
    expect(sim.getTrain(t)!.bogies[0].pieceId).toBe(ids[1]);
    expect(sim.getTrain(t)!.speed).toBe(0);
    expect(sim.signalClear(ids[1])).toBe(false);
    expect(sim.heldBy(t)).toBe(beyond.trainId);
    expect(sim.heldHow(t)).toBe("signal");
    // (The switch's other road: its way is free.)
    expect(sim.toggleSwitch(ids[3])).toBe(true);
    run(sim, 0.2);
    expect(sim.signalClear(ids[1])).toBe(true);
    run(sim, 3);
    expect(sim.getTrain(t)!.bogies[0].pieceId).not.toBe(ids[1]);
  });
});

/** A pair on the joint after `ids[k]`: one post each way, as the tray drops them (signals audit, 2026-11-06). */
function pairAt(layout: Layout, pieceId: number): { on: number; back: number } {
  const at = connectorRef(pieceId, 1);
  return { on: layout.addSignal(at), back: layout.addSignal(layout.joinedConnector(at)) };
}

describe("signals: a pair on one joint (signals audit, 2026-11-06)", () => {
  it("the post facing a train coming is red while a train stands just past the pair, and its block runs on past its partner", () => {
    // (Report 1: a train standing just past a pair before a station, the post facing trains coming showed green. Its
    // block ended at once at the other post of the pair, the one facing back on the same joint: empty, so never red.)
    const { layout, ids } = chain(["straight-216", "straight-216", "straight-216", "straight-216", "straight-216", "buffer"]);
    const { on, back } = pairAt(layout, ids[1]);
    const sim = new Sim(layout);
    const parked = sim.addTrain(["engine"], { pieceId: ids[2], pathIndex: 0, reversed: false, s: 150 });
    if (parked.kind !== "placed") throw new Error();
    run(sim, 0.1);
    const blockOf = (id: number) => sim.signalBlock(sim.signalList().find((g) => g.key === -1 - id)!.key);
    expect(blockOf(on)).toEqual([ids[2], ids[3], ids[4], ids[5]]);
    expect(blockOf(back)).toEqual([ids[1], ids[0]]);
    expect(sim.markClear(on)).toBe(false);
    expect(sim.markClear(back)).toBe(true);
    // A train coming stops at it, short of the joint, and goes once the one past it has gone.
    const t = driving(sim, ids[0], 150, ["engine"]);
    run(sim, 6);
    expect(sim.getTrain(t)!.bogies[0].pieceId).toBe(ids[1]);
    expect(sim.atRedSignal(t)).toBe(true);
    sim.removeTrain(parked.trainId);
    run(sim, 3);
    expect(sim.getTrain(t)!.bogies[0].pieceId).not.toBe(ids[1]);
  });

  it("a pair before points is a path signal: red for a train coming while the way beyond is taken, green once the points go the free way", () => {
    const { layout, ids } = chain(["straight-216", "straight-216", "straight-216", "switch", "straight-216", "straight-216", "buffer"]);
    const { on } = pairAt(layout, ids[1]);
    const sim = new Sim(layout);
    const beyond = sim.addTrain(["engine"], { pieceId: ids[4], pathIndex: 0, reversed: false, s: 150 });
    if (beyond.kind !== "placed") throw new Error();
    expect(sim.signalList().find((g) => g.key === -1 - on)!.junction).toBe(true);
    const t = driving(sim, ids[0], 150, ["engine"]);
    run(sim, 5);
    expect(sim.getTrain(t)!.bogies[0].pieceId).toBe(ids[1]);
    expect(sim.heldBy(t)).toBe(beyond.trainId);
    expect(sim.toggleSwitch(ids[3])).toBe(true);
    run(sim, 3);
    expect(sim.getTrain(t)!.bogies[0].pieceId).not.toBe(ids[1]);
  });
});

describe("signals: a path signal at rest, and what a signal's card says (signals audit U6)", () => {
  it("a path signal rests green while its block is free (it rested red), red while a train stands on its way, and its card says why", () => {
    const { layout, ids } = chain(["straight-216", "straight-216", "straight-216", "switch", "straight-216", "straight-216", "buffer"]);
    const { on } = pairAt(layout, ids[1]);
    const sim = new Sim(layout);
    run(sim, 0.1);
    expect(sim.signalList().find((g) => g.key === -1 - on)!.junction).toBe(true);
    expect(sim.markClear(on)).toBe(true);
    expect(sim.markWhy(on)).toMatchObject({ clear: true, why: "clear" });
    const beyond = sim.addTrain(["engine"], { pieceId: ids[4], pathIndex: 0, reversed: false, s: 150 });
    if (beyond.kind !== "placed") throw new Error();
    run(sim, 0.1);
    expect(sim.markClear(on)).toBe(false);
    expect(sim.markWhy(on)).toMatchObject({ clear: false, why: "train", by: beyond.trainId });
    // (Held: red, said so; Always green: said so.)
    sim.setMarkMode(on, "red");
    expect(sim.markWhy(on)).toMatchObject({ clear: false, why: "held" });
    sim.setMarkMode(on, "green");
    expect(sim.markWhy(on).why).toBe("forced");
  });
});

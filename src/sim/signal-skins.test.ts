import { describe, expect, it } from "vitest";
import { appendPiece, connectorRef, getPieceDef, Layout, type PieceTypeId } from "../track";
import { Sim, SIM_DT } from "./sim";

// Signal skins (src/track/kits.ts) are the signal piece with a model: each holds trains exactly as the plain one does.
// These are signals.test.ts's cases, run for each, and the gantry's two signals.

function chain(types: PieceTypeId[]): { layout: Layout; ids: number[] } {
  const layout = new Layout();
  const ids = [layout.addPiece(types[0], { x: 0, z: 0, heading: 0 }, 0, false)];
  for (let i = 1; i < types.length; i++) ids.push(appendPiece(layout, types[i], false, connectorRef(ids[i - 1], 1)));
  return { layout, ids };
}

function run(sim: Sim, seconds: number): void {
  for (let i = Math.round(seconds / SIM_DT); i > 0; i--) sim.tick();
}

/** A train with its engine driving forward (toward each piece's far end), its front at `s` on `pieceId`'s `pathIndex`. */
function driving(sim: Sim, pieceId: number, s: number, cars: ("engine" | "hopper")[] = ["engine", "hopper"], pathIndex = 0): number {
  const r = sim.addTrain(cars, { pieceId, pathIndex, reversed: false, s });
  if (r.kind !== "placed") throw new Error(r.kind);
  sim.setLever(sim.getTrain(r.trainId)!.cars[0].id, 1);
  return r.trainId;
}

for (const signal of ["signal", "kit-semaphore-signal", "kit-colour-light-signal"] as const) {
  const STOP_AT = getPieceDef(signal, false).signal!.stopAt;
  // straight, straight, SIGNAL, straight × 4 (the block), buffer.
  const line = () => chain(["straight-216", "straight-216", signal, "straight-216", "straight-216", "straight-216", "straight-216", "buffer"]);

  describe(`${signal}: block working`, () => {
    it("has the plain signal's track and stop point", () => {
      const def = getPieceDef(signal, false);
      const plain = getPieceDef("signal", false);
      expect(def.signal).toEqual(plain.signal);
      expect(def.connectors.map((c) => [c.kind, c.pose])).toEqual(plain.connectors.map((c) => [c.kind, c.pose]));
      expect(def.paths.map((p) => [p.from, p.to, p.geom])).toEqual(plain.paths.map((p) => [p.from, p.to, p.geom]));
    });

    it("a train stops just short of it while a train stands in the block beyond, and goes on once it's clear", () => {
      const { layout, ids } = line();
      const sim = new Sim(layout);
      const parked = sim.addTrain(["engine", "hopper"], { pieceId: ids[5], pathIndex: 0, reversed: false, s: 100 });
      if (parked.kind !== "placed") throw new Error();
      const t = driving(sim, ids[0], 150);
      run(sim, 6);
      expect(sim.signalClear(ids[2])).toBe(false);
      const front = sim.getTrain(t)!.bogies[0];
      expect(front.pieceId).toBe(ids[2]);
      expect(front.s).toBeLessThanOrEqual(STOP_AT);
      expect(front.s).toBeGreaterThan(STOP_AT - 4);
      expect(sim.getTrain(t)!.speed).toBe(0);
      sim.removeTrain(parked.trainId);
      run(sim, 0.1);
      expect(sim.signalClear(ids[2])).toBe(true);
      run(sim, 3);
      expect(sim.getTrain(t)!.bogies[0].pieceId).not.toBe(ids[2]);
    });

    it("two trains running the same way: the one behind waits at it rather than catching up", () => {
      const { layout, ids } = line();
      const sim = new Sim(layout);
      driving(sim, ids[3], 200);
      const behind = driving(sim, ids[1], 150);
      run(sim, 6);
      expect(sim.getTrain(behind)!.bogies[0].pieceId).toBe(ids[2]);
      expect(sim.signalClear(ids[2])).toBe(false);
    });

    it("held at red by a tap (its lever), whatever the line ahead; a second tap lets it go", () => {
      const { layout, ids } = line();
      const sim = new Sim(layout);
      sim.toggleSwitch(ids[2]);
      expect(sim.signalHeld(ids[2])).toBe(true);
      expect(layout.switchState(ids[2])).toBe(1);
      const t = driving(sim, ids[0], 150);
      run(sim, 6);
      expect(sim.getTrain(t)!.bogies[0].pieceId).toBe(ids[2]);
      expect(sim.getTrain(t)!.speed).toBe(0);
      // The tap on its model holds its one signal, as the lever does.
      sim.toggleSignal(ids[2], 0);
      expect(layout.switchState(ids[2])).toBe(0);
      run(sim, 3);
      expect(sim.getTrain(t)!.bogies[0].pieceId).not.toBe(ids[2]);
    });

    it("guards one way only: a train running the other way passes it at red", () => {
      const { layout, ids } = line();
      const sim = new Sim(layout);
      sim.toggleSwitch(ids[2]);
      const r = sim.addTrain(["engine"], { pieceId: ids[3], pathIndex: 0, reversed: true, s: 150 });
      if (r.kind !== "placed") throw new Error();
      sim.setLever(sim.getTrain(r.trainId)!.cars[0].id, 1);
      run(sim, 4);
      const front = sim.getTrain(r.trainId)?.bogies[0];
      expect(front && front.pieceId !== ids[2] && front.pieceId !== ids[3]).toBe(true);
    });

    it("its block ends at a switch: a train beyond the switch doesn't hold it", () => {
      const { layout, ids } = chain(["straight-216", signal, "straight-216", "switch", "straight-216", "straight-216", "buffer"]);
      const sim = new Sim(layout);
      const beyond = sim.addTrain(["engine"], { pieceId: ids[5], pathIndex: 0, reversed: false, s: 100 });
      if (beyond.kind !== "placed") throw new Error();
      run(sim, 0.1);
      expect(sim.signalClear(ids[1])).toBe(true);
      sim.addTrain(["engine"], { pieceId: ids[2], pathIndex: 0, reversed: false, s: 150 });
      run(sim, 0.1);
      expect(sim.signalClear(ids[1])).toBe(false);
    });
  });
}

describe("the signal gantry: a signal on each of its two roads", () => {
  /**
   * Double track: double straight, double straight, GANTRY, then on each road its own block (four straights) to a
   * buffer. The gantry's roads (connectors 0→1 and 2→3) line up with the double straight's.
   */
  function doubleLine(): { layout: Layout; ids: number[]; roads: number[][] } {
    const layout = new Layout();
    const a = layout.addPiece("double-straight", { x: 0, z: 0, heading: 0 }, 0, false);
    const b = appendPiece(layout, "double-straight", false, connectorRef(a, 1));
    const g = appendPiece(layout, "kit-signal-gantry", false, connectorRef(b, 1));
    // Joined at both roads (the second road's ends meet where they lie).
    expect(layout.joinedConnector(connectorRef(g, 2))).toBe(connectorRef(b, 3));
    const roads = [1, 3].map((end) => {
      const ids: number[] = [];
      let at = connectorRef(g, end);
      for (const type of ["straight-216", "straight-216", "straight-216", "straight-216", "buffer"] as const) {
        const id = appendPiece(layout, type, false, at);
        ids.push(id);
        at = connectorRef(id, 1);
      }
      return ids;
    });
    return { layout, ids: [a, b, g], roads };
  }

  it("is a 4-connector piece with two signal paths, each from a first end", () => {
    const def = getPieceDef("kit-signal-gantry", false);
    expect(def.connectors).toHaveLength(4);
    expect(def.paths.map((p) => [p.from, p.to])).toEqual([
      [0, 1],
      [2, 3],
    ]);
    expect(def.signal).toEqual(getPieceDef("signal", false).signal);
  });

  it("each road's signal works its own block: a train standing beyond road 1 holds road 1's train, not road 0's", () => {
    const { layout, ids, roads } = doubleLine();
    const sim = new Sim(layout);
    const gantry = ids[2];
    const stopAt = getPieceDef("kit-signal-gantry", false).signal!.stopAt;
    // A train standing in road 1's block.
    const parked = sim.addTrain(["engine", "hopper"], { pieceId: roads[1][2], pathIndex: 0, reversed: false, s: 100 });
    if (parked.kind !== "placed") throw new Error();
    const on0 = driving(sim, ids[0], 150, ["engine", "hopper"], 0);
    const on1 = driving(sim, ids[0], 150, ["engine", "hopper"], 1);
    run(sim, 0.1);
    expect(sim.signalClear(gantry, 0)).toBe(true);
    expect(sim.signalClear(gantry, 1)).toBe(false);
    run(sim, 6);
    // Road 1's train halted at its stop point, on the gantry's second road.
    const front = sim.getTrain(on1)!.bogies[0];
    expect([front.pieceId, front.pathIndex]).toEqual([gantry, 1]);
    expect(front.s).toBeLessThanOrEqual(stopAt);
    expect(front.s).toBeGreaterThan(stopAt - 4);
    expect(sim.getTrain(on1)!.speed).toBe(0);
    // Road 0's ran on past it, into its own block.
    expect(roads[0]).toContain(sim.getTrain(on0)!.bogies[0].pieceId);
    // Road 1's block clears: its signal goes to clear and its train goes on.
    sim.removeTrain(parked.trainId);
    run(sim, 0.1);
    expect(sim.signalClear(gantry, 1)).toBe(true);
    run(sim, 3);
    expect(roads[1]).toContain(sim.getTrain(on1)!.bogies[0].pieceId);
  });

  it("a tap holds one road's signal at red, its own bit of the piece's state; the other road runs on", () => {
    const { layout, ids, roads } = doubleLine();
    const sim = new Sim(layout);
    const gantry = ids[2];
    sim.toggleSignal(gantry, 1);
    expect([sim.signalHeld(gantry, 0), sim.signalHeld(gantry, 1)]).toEqual([false, true]);
    expect(layout.switchState(gantry)).toBe(2);
    const v = sim.signalsVersion;
    sim.toggleSignal(gantry, 0);
    // Both held: state 3 (saved as it is: see save.test.ts), and the aspect changed at once.
    expect(layout.switchState(gantry)).toBe(3);
    expect(sim.signalsVersion).toBeGreaterThan(v);
    sim.toggleSignal(gantry, 0);
    const on0 = driving(sim, ids[0], 150, ["engine", "hopper"], 0);
    const on1 = driving(sim, ids[0], 150, ["engine", "hopper"], 1);
    run(sim, 6);
    expect(sim.getTrain(on1)!.bogies[0].pieceId).toBe(gantry);
    expect(sim.getTrain(on1)!.speed).toBe(0);
    expect(roads[0]).toContain(sim.getTrain(on0)!.bogies[0].pieceId);
    // Let go: it runs on.
    sim.toggleSignal(gantry, 1);
    run(sim, 3);
    expect(roads[1]).toContain(sim.getTrain(on1)!.bogies[0].pieceId);
  });

  it("a block running into the gantry ends there, as at any signal; a train on the gantry holds neither of its own", () => {
    // signal, straight, GANTRY (its road 0), straight, buffer.
    const { layout, ids } = chain(["signal", "straight-216", "kit-signal-gantry", "straight-216", "buffer"]);
    const sim = new Sim(layout);
    const past = sim.addTrain(["engine"], { pieceId: ids[3], pathIndex: 0, reversed: false, s: 150 });
    if (past.kind !== "placed") throw new Error();
    run(sim, 0.1);
    // Beyond the gantry: out of the plain signal's block (but in the gantry's road 0's).
    expect(sim.signalClear(ids[0])).toBe(true);
    expect([sim.signalClear(ids[2], 0), sim.signalClear(ids[2], 1)]).toEqual([false, true]);
    sim.removeTrain(past.trainId);
    sim.addTrain(["engine"], { pieceId: ids[2], pathIndex: 0, reversed: false, s: 60 });
    run(sim, 0.1);
    expect(sim.signalClear(ids[0])).toBe(false);
    expect([sim.signalClear(ids[2], 0), sim.signalClear(ids[2], 1)]).toEqual([true, true]);
  });
});

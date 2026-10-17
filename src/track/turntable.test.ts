import { describe, expect, it } from "vitest";
import { Sim, SIM_HZ } from "../sim";
import { nearestCursor } from "../sim/nearest";
import { connectorRef, createRouteStep, createWorldConnector, DECK_GLIDE_S, getPieceDef, KITS, Layout, MAX_CONNECTORS, routeFrom, type PieceTypeId } from ".";

/** A piece added with its first end on end `index` of piece `id` (facing out of it). */
function onEnd(layout: Layout, id: number, index: number, type: PieceTypeId): number {
  const c = createWorldConnector();
  layout.worldConnector(connectorRef(id, index), c);
  return layout.addPiece(type, { x: c.x, z: c.z, heading: c.heading });
}

/**
 * A kit with a deck (`kit`) on a line: a turnback buffer, a straight (the train starts on it) joined to the kit's first
 * end, and off each of `outs` of its ends a straight and a turnback buffer.
 */
function yard(kit: PieceTypeId, outs: number[]) {
  const layout = new Layout();
  layout.addPiece("buffer-turnback", { x: 0, z: 0, heading: Math.PI });
  const start = layout.addPiece("straight-216", { x: 0, z: 0, heading: 0 });
  const c = createWorldConnector();
  layout.worldConnector(connectorRef(start, 1), c);
  // The kit's first end on the straight's far end.
  const id = layout.addPiece(kit, { x: c.x, z: c.z, heading: 0 });
  const out = new Map<number, number>();
  for (const k of outs) {
    const s = onEnd(layout, id, k, "straight-216");
    out.set(k, s);
    onEnd(layout, s, 1, "buffer-turnback");
  }
  const sim = new Sim(layout);
  const placed = sim.addTrain(["engine"], { pieceId: start, pathIndex: 0, reversed: false, s: 120 });
  if (placed.kind !== "placed") throw new Error("no room");
  const train = () => sim.getTrain(sim.trainIds()[0])!;
  sim.setLever(train().cars[0].id, 1);
  return { layout, sim, id, start, out, train };
}

/** Tap the deck and wait till it's there (the train held still meanwhile). */
function turn(w: ReturnType<typeof yard>, taps = 1): void {
  const lever = w.train().cars[0].lever;
  w.sim.setLever(w.train().cars[0].id, 0);
  for (let i = 0; i < taps; i++) {
    expect(w.sim.toggleSwitch(w.id)).toBe(true);
    for (let k = 0; k < DECK_GLIDE_S * SIM_HZ; k++) w.sim.tick();
  }
  w.sim.setLever(w.train().cars[0].id, lever);
}

/** Run the sim for `seconds`, noting every piece the train's front was on. */
function run(w: ReturnType<typeof yard>, seconds: number): Set<number> {
  const on = new Set<number>();
  for (let i = 0; i < seconds * SIM_HZ; i++) {
    w.sim.tick();
    on.add(w.train().bogies[0].pieceId);
  }
  return on;
}

describe("the turntable", () => {
  const def = getPieceDef("kit-turntable", false);

  it("has eight ends round its pit, an eighth of a turn apart, and four ways across (the deck's)", () => {
    expect(def.connectors).toHaveLength(8);
    expect(def.connectors.length).toBeLessThanOrEqual(MAX_CONNECTORS);
    expect(def.paths).toHaveLength(4);
    expect(def.gated).toBe(true);
    expect(KITS["kit-turntable"].moves).toBe("state");
    expect(KITS["kit-turntable"].rails).toBe("model");
    for (let k = 0; k < 8; k++) {
      const p = def.connectors[k].pose;
      expect(Math.hypot(p.x - 92, p.z)).toBeCloseTo(92, 6);
    }
    // End 0 at the piece's origin, facing back along −x (as any piece's first end).
    expect(def.connectors[0].pose.x).toBeCloseTo(0, 9);
    expect(def.connectors[0].pose.z).toBeCloseTo(0, 9);
    for (let k = 0; k < 4; k++) expect([def.paths[k].from, def.paths[k].to]).toEqual([k, k + 4]);
  });

  it("only the way the deck lies joins its ends: a tap turns it to the next, round and back", () => {
    const w = yard("kit-turntable", [2, 4]);
    const step = createRouteStep();
    // The deck along the line (state 0): from the straight, across to end 4.
    expect(routeFrom(w.layout, w.start, 1, step)).toBe(true);
    expect([step.pieceId, step.pathIndex, step.reversed]).toEqual([w.id, 0, false]);
    // Out of end 2 (the road a quarter turn round): the deck isn't there, so it's the end of the line.
    expect(routeFrom(w.layout, w.out.get(2)!, 0, step)).toBe(false);
    // While it turns, it joins nothing; then it's there.
    w.sim.setLever(w.train().cars[0].id, 0);
    expect(w.sim.toggleSwitch(w.id)).toBe(true);
    expect(w.layout.deckTurning(w.id)).toBe(true);
    expect(routeFrom(w.layout, w.start, 1, step)).toBe(false);
    expect(routeFrom(w.layout, w.out.get(2)!, 0, step)).toBe(false);
    for (let k = 0; k < DECK_GLIDE_S * SIM_HZ; k++) w.sim.tick();
    expect(w.layout.deckTurning(w.id)).toBe(false);
    turn(w);
    // Now across from end 2 to end 6; the line's road is closed.
    expect(w.layout.switchState(w.id)).toBe(2);
    expect(routeFrom(w.layout, w.out.get(2)!, 0, step)).toBe(true);
    expect([step.pathIndex, step.reversed]).toEqual([2, false]);
    expect(routeFrom(w.layout, w.start, 1, step)).toBe(false);
    // Four ways, then round to the first.
    turn(w, 2);
    expect(w.layout.switchState(w.id)).toBe(0);
  });

  it("a train runs across the deck when it lies along the line, and turns back at the pit when it doesn't", () => {
    const across = yard("kit-turntable", [4]);
    const on = run(across, 12);
    expect(on.has(across.id)).toBe(true);
    expect(on.has(across.out.get(4)!)).toBe(true);
    expect(across.train().derailed).toBe(false);

    const turned = yard("kit-turntable", [2, 4]);
    turn(turned);
    const reached = run(turned, 12);
    // The deck lies the other way: the train never gets onto it, nor beyond.
    expect(reached.has(turned.out.get(4)!)).toBe(false);
    expect(reached.has(turned.out.get(2)!)).toBe(false);
    expect(turned.train().derailed).toBe(false);
  });

  it("a train is put down only on the way the deck lies (dropped, or put back on the rails)", () => {
    const w = yard("kit-turntable", [2, 4]);
    const t = w.layout.getPiece(w.id)!.pose;
    // Over the pit on the road a quarter turn round (end 2's), heading along it: the deck isn't there.
    const along = nearestCursor(w.layout, t.x + 92, t.z - 60, 30, Math.PI / 2);
    expect(along?.cursor.pieceId === w.id && along.cursor.pathIndex !== 0).toBe(false);
    turn(w, 2);
    const there = nearestCursor(w.layout, t.x + 92, t.z - 60, 30, Math.PI / 2);
    expect(there?.cursor).toMatchObject({ pieceId: w.id, pathIndex: 2 });
  });

  it("won't turn with a train on it", () => {
    const w = yard("kit-turntable", [4]);
    for (let i = 0; i < 20 * SIM_HZ && !w.train().bogies.some((b) => b.pieceId === w.id); i++) w.sim.tick();
    expect(w.sim.pieceOccupied(w.id)).toBe(true);
    expect(w.sim.toggleSwitch(w.id)).toBe(false);
    expect(w.layout.switchState(w.id)).toBe(0);
  });
});

describe("the transfer table", () => {
  const def = getPieceDef("kit-transfer-table", false);

  it("has three roads side by side, each its own way across (the deck's), the middle one first", () => {
    expect(def.connectors).toHaveLength(6);
    expect(def.paths).toHaveLength(3);
    expect(def.gated).toBe(true);
    expect(def.paths.map((p) => p.geom.kind === "line" && p.geom.start.z)).toEqual([0, 60, -60]);
  });

  it("a train runs across to the road the deck lies on, and turns back at the pit when it's elsewhere", () => {
    const w = yard("kit-transfer-table", [1]);
    const on = run(w, 12);
    expect(on.has(w.out.get(1)!)).toBe(true);
    const moved = yard("kit-transfer-table", [1]);
    turn(moved);
    expect(moved.layout.switchState(moved.id)).toBe(1);
    const reached = run(moved, 12);
    expect(reached.has(moved.out.get(1)!)).toBe(false);
    expect(reached.has(moved.id)).toBe(false);
    expect(moved.train().derailed).toBe(false);
    // Three ways, then back to the first.
    turn(moved, 2);
    expect(moved.layout.switchState(moved.id)).toBe(0);
  });
});

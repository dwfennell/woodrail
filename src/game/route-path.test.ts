import { describe, expect, it } from "vitest";
import { Economy } from "../economy";
import { Sim, SIM_HZ } from "../sim";
import { appendPiece, connectorRef, getPieceDef, Layout, pathLength, type PieceTypeId } from "../track";
import { aheadRuns, legFromCursor, lineLegs, pinnedBlocking, runsLength, stopCursors, type PathRun } from "./route-path";

/** Lay `types` end to end from a first piece at the origin; their ids. */
function chain(layout: Layout, types: readonly PieceTypeId[], from = -1): number[] {
  const ids: number[] = [];
  let last = from;
  for (const t of types) {
    last = last === -1 ? layout.addPiece(t, { x: 0, z: 0, heading: 0 }) : appendPiece(layout, t, false, connectorRef(last, 1));
    ids.push(last);
  }
  return ids;
}

const len = (layout: Layout, id: number, path = 0) => {
  const p = layout.getPiece(id)!;
  return pathLength(getPieceDef(p.type, p.flipped).paths[path].geom);
};

/** The pieces a leg runs over, in order, without repeats in a row. */
const piecesOf = (runs: readonly PathRun[]) => runs.map((r) => r.pieceId).filter((id, i, a) => i === 0 || a[i - 1] !== id);

/** Runs join up: each starts where the last ended (same piece), or at an end of its path (a new piece). */
function expectContinuous(layout: Layout, runs: readonly PathRun[]) {
  for (let i = 1; i < runs.length; i++) {
    const a = runs[i - 1];
    const b = runs[i];
    if (a.pieceId === b.pieceId && a.pathIndex === b.pathIndex) expect(b.s0).toBeCloseTo(a.s1);
    else expect([0, len(layout, b.pieceId, b.pathIndex)]).toContain(b.s0);
  }
}

/**
 * An oval (a half circle of large curves, depot A and the switch; the other half circle and two straights to close
 * it), with a spur off the switch's curve to depot B, the end of its line.
 */
function loopWithSpur() {
  const layout = new Layout();
  const half: PieceTypeId[] = ["curve-large", "curve-large", "curve-large", "curve-large"];
  const ids = chain(layout, [...half, "depot-farm", "switch", ...half, "straight-216", "straight-144"]);
  const a = ids[4];
  const sw = ids[5];
  const spur = appendPiece(layout, "straight-216", false, connectorRef(sw, 2));
  const b = appendPiece(layout, "depot-mill", false, connectorRef(spur, 1));
  return { layout, ids, a, sw, spur, b, closed: [...layout.joints()].length === ids.length + 2 };
}

describe("route path", () => {
  it("a straight line: from the middle of one stop to the middle of the other, both ways", () => {
    const layout = new Layout();
    const [a, s1, s2, b] = chain(layout, ["depot-farm", "straight-216", "straight-216", "depot-mill"]);
    const [there, back] = lineLegs(layout, [a, b]);
    expect(there).toEqual([
      { pieceId: a, pathIndex: 0, s0: 108, s1: 216 },
      { pieceId: s1, pathIndex: 0, s0: 0, s1: 216 },
      { pieceId: s2, pathIndex: 0, s0: 0, s1: 216 },
      { pieceId: b, pathIndex: 0, s0: 0, s1: 108 },
    ]);
    expect(back!.map((r) => r.pieceId)).toEqual([b, s2, s1, a]);
    expect(back![0]).toMatchObject({ s0: 108, s1: 0 });
    expect(runsLength(back!)).toBeCloseTo(216 * 3);
  });

  it("a loop with a switch: the leg takes the branch toward the stop", () => {
    const j = loopWithSpur();
    expect(j.closed).toBe(true);
    const [toB, toA] = lineLegs(j.layout, [j.a, j.b]);
    expect(toB).not.toBeNull();
    expectContinuous(j.layout, toB!);
    // Out of A straight into the switch, and down its curve (path 1) to the spur and B.
    expect(piecesOf(toB!)).toEqual([j.a, j.sw, j.spur, j.b]);
    expect(toB!.find((r) => r.pieceId === j.sw)!.pathIndex).toBe(1);
    // Back from B (the end of its line): up the spur and through the switch to A the short way.
    expect(piecesOf(toA!)).toEqual([j.b, j.spur, j.sw, j.a]);
    expect(toA![toA!.length - 1]).toMatchObject({ pieceId: j.a, s1: 108 });
  });

  it("a pinned switch set away from a stop: no way there, and the switch is named as what keeps it away", () => {
    const j = loopWithSpur();
    expect(pinnedBlocking(j.layout, stopCursors(j.layout, j.a), j.b)).toBe(-1);
    // Pinned straight on (not down the curve to the spur): B is out of reach from A.
    j.layout.setSwitchState(j.sw, 0);
    j.layout.setPinned(j.sw, true);
    expect(lineLegs(j.layout, [j.a, j.b])[0]).toBeNull();
    const version = j.layout.switchesVersion;
    expect(pinnedBlocking(j.layout, stopCursors(j.layout, j.a), j.b)).toBe(j.sw);
    // Asked without touching the layout: still pinned, nothing to redraw.
    expect(j.layout.isPinned(j.sw)).toBe(true);
    expect(j.layout.switchesVersion).toBe(version);
    // Pinned the way to the spur: B is reached, nothing to blame.
    j.layout.setSwitchState(j.sw, 1);
    expect(lineLegs(j.layout, [j.a, j.b])[0]).not.toBeNull();
    // A stop no track leads to at all: no switch to blame.
    const lone = j.layout.addPiece("depot-mine", { x: 5000, z: 5000, heading: 0 });
    expect(pinnedBlocking(j.layout, stopCursors(j.layout, j.a), lone)).toBe(-1);
  });

  it("from a train's front, the way a routed train goes, whatever the switch is set to now", () => {
    const j = loopWithSpur();
    const sim = new Sim(j.layout);
    // On the far side of the loop, heading round toward A and the switch.
    const start = j.ids[8];
    const front = { pieceId: start, pathIndex: 0, reversed: false, s: 10 };
    expect(sim.addTrain(["engine"], front).kind).toBe("placed");
    const leg = legFromCursor(j.layout, front, j.b)!;
    expect(leg).not.toBeNull();
    expectContinuous(j.layout, leg);
    expect(piecesOf(leg).slice(-3)).toEqual([j.sw, j.spur, j.b]);
    expect(leg[0]).toMatchObject({ pieceId: start, s0: 10 });
    j.layout.setSwitchState(j.sw, 1);
    expect(legFromCursor(j.layout, front, j.b)).toEqual(leg);
    j.layout.setSwitchState(j.sw, 0);
    // A train routed to B goes that way: the pieces its front runs over are the leg's.
    const economy = new Economy(j.layout, sim);
    const depot = economy.addDepot("mill", j.b);
    const engine = sim.getTrain(sim.trainIds()[0])!.cars[0];
    economy.setRoute(engine.id, { stops: [{ depotId: depot.id, action: "both" }], next: 0 });
    sim.setLever(engine.id, 1);
    const ran: number[] = [];
    for (let i = 0; i < 60 * SIM_HZ && ran[ran.length - 1] !== j.b; i++) {
      sim.tick();
      economy.tick();
      const at = sim.getTrain(sim.trainIds()[0])!.bogies[0].pieceId;
      if (ran[ran.length - 1] !== at) ran.push(at);
    }
    expect([start, ...ran.filter((id) => id !== start)]).toEqual(piecesOf(leg));
  });

  it("turning back at the end of a line shows as the path running back", () => {
    // A buffer behind the train: the way to B runs into it and back.
    const layout = new Layout();
    const [s0, a, b] = chain(layout, ["straight-216", "depot-farm", "depot-mill"]);
    const leg = legFromCursor(layout, { pieceId: a, pathIndex: 0, reversed: true, s: 50 }, b)!;
    expect(piecesOf(leg)).toEqual([a, s0, a, b]);
    expect(leg[1]).toMatchObject({ pieceId: s0, s0: 216, s1: 0 });
    expect(leg[2]).toMatchObject({ pieceId: s0, s0: 0, s1: 216 });
  });

  it("an unreachable stop gives null", () => {
    const layout = new Layout();
    const [a] = chain(layout, ["depot-farm", "straight-216"]);
    const b = layout.addPiece("depot-mill", { x: 0, z: 1000, heading: 0 });
    expect(lineLegs(layout, [a, b])).toEqual([null, null]);
    expect(legFromCursor(layout, { pieceId: a, pathIndex: 0, reversed: false, s: 0 }, b)).toBeNull();
    // Round and round a loop never gets there either.
    const j = loopWithSpur();
    const far = j.layout.addPiece("depot-mine", { x: 5000, z: 5000, heading: 0 });
    expect(legFromCursor(j.layout, { pieceId: j.ids[0], pathIndex: 0, reversed: false, s: 0 }, far)).toBeNull();
  });

  it("aheadRuns follows a switch as it's set, and stops at a buffer", () => {
    const j = loopWithSpur();
    const front = { pieceId: j.a, pathIndex: 0, reversed: false, s: 100 };
    // Set straight: round the loop, for as far as asked.
    const straight = aheadRuns(j.layout, front, 400);
    expect(piecesOf(straight)).toEqual([j.a, j.sw, j.ids[6]]);
    expect(straight.find((r) => r.pieceId === j.sw)!.pathIndex).toBe(0);
    expect(runsLength(straight)).toBeCloseTo(400);
    // Set to the curve: down the spur to the buffer at B's far end, and no further.
    j.layout.setSwitchState(j.sw, 1);
    const spur = aheadRuns(j.layout, front, 5000);
    expect(piecesOf(spur)).toEqual([j.a, j.sw, j.spur, j.b]);
    expect(spur[spur.length - 1]).toMatchObject({ pieceId: j.b, s0: 0, s1: 216 });
    expect(runsLength(spur)).toBeCloseTo(116 + len(j.layout, j.sw, 1) + 216 + 216);
  });

  it("lineLegs is cyclic: stop k to k+1, and the last back to the first", () => {
    const layout = new Layout();
    const [a, , b, , c] = chain(layout, ["depot-farm", "straight-216", "depot-mill", "straight-216", "depot-mine"]);
    const legs = lineLegs(layout, [a, b, c]);
    expect(legs).toHaveLength(3);
    expect(legs.map((l) => [l![0].pieceId, l![l!.length - 1].pieceId])).toEqual([
      [a, b],
      [b, c],
      [c, a],
    ]);
    expect(lineLegs(layout, [a])).toEqual([]);
    expect(lineLegs(layout, [a, a])).toEqual([[], []]);
  });
});

import { describe, expect, it } from "vitest";
import { Sim, SIM_HZ, type CarKind, type Train } from "../sim";
import { appendPiece, connectorRef, Layout, type PieceTypeId } from "../track";
import { editLine } from "../game/lines";
import { Economy } from "./economy";
import { chain, train, type World } from "./loop-fixtures";

/**
 * Issue #3: points never move under a train. With a car on or over them (`Sim.piecesUnder`), a lever's throw is refused
 * and a route's steering leaves them be; otherwise the cars still to come onto them would take the other road (a wye's
 * or a crossover's choice from a branch isn't remembered) and the train would split across the two.
 */

const CARS: CarKind[] = ["engine", "timber", "timber", "timber"];

/** Straight-line distances between a train's axles in a row, front to back. */
function gaps(t: Train): number[] {
  return t.world.slice(1).map((p, i) => Math.hypot(p.x - t.world[i].x, p.z - t.world[i].z));
}

/** Watches trains for a split: how far any two axles in a row have drawn apart, beyond how they started. */
function splitWatch(trains: (() => Train | undefined)[]) {
  const start = trains.map((t) => gaps(t()!));
  let worst = 0;
  return {
    check: () =>
      trains.forEach((t, k) => {
        const tr = t();
        if (tr) gaps(tr).forEach((d, i) => (worst = Math.max(worst, d - start[k][i])));
      }),
    worst: () => worst,
  };
}

/**
 * A trunk Y ══ ══ ══ into points (a switch, or a wye), one way on to X, the other to P (buffers past all three). Two
 * routed trains on the trunk, heading in: the first (A) for X, the second (B), close behind, for P (the other road).
 */
function junction(type: "switch" | "wye") {
  const layout = new Layout();
  const [y, , t2, t1, sw] = chain(layout, ["depot-sawmill", "straight-216", "straight-216", "straight-216", type]);
  appendPiece(layout, "buffer-turnback", false, connectorRef(y, 0), 0);
  const [, , x] = chain(layout, ["straight-216", "straight-216", "depot-forest"], connectorRef(sw, 1));
  appendPiece(layout, "buffer-turnback", false, connectorRef(x, 1));
  const toP: PieceTypeId[] = type === "switch" ? ["curve-large", "straight-216", "straight-216", "depot-forest"] : ["straight-216", "straight-216", "depot-forest"];
  const pIds = chain(layout, toP, connectorRef(sw, 2), [type === "switch"]);
  const p = pIds[pIds.length - 1];
  appendPiece(layout, "buffer-turnback", false, connectorRef(p, 1));
  const w = { layout } as World;
  w.sim = new Sim(layout);
  w.economy = new Economy(layout, w.sim);
  const dy = w.economy.addDepot("town", y, 0);
  const dx = w.economy.addDepot("forest", x, 1);
  const dp = w.economy.addDepot("forest", p, 1);
  const a = train(w, t1, false, CARS, 150);
  const b = train(w, t2, false, CARS, 20);
  editLine(w.economy, a, (s) => s.push({ depotId: dy.id, action: "auto" }, { depotId: dx.id, action: "auto" }));
  w.economy.routeOf(a)!.next = 1;
  editLine(w.economy, b, (s) => s.push({ depotId: dy.id, action: "auto" }, { depotId: dp.id, action: "auto" }));
  w.economy.routeOf(b)!.next = 1;
  return { w, a, b, sw, x, p };
}

/**
 * Points with three straights on each way out, and a train (lever on, no route) on the arm at connector `from`, heading
 * in. A crossover entered at its connector 3, or a wye at a branch, picks its road by the lever.
 */
function pointsWith(type: "switch" | "wye" | "crossover", from: number) {
  const layout = new Layout();
  const [, , a2] = chain(layout, ["straight-216", "straight-216", "straight-216"]);
  const sw = appendPiece(layout, type, false, connectorRef(a2, 1));
  const arms: number[][] = [];
  for (let c = 1; c < (type === "crossover" ? 4 : 3); c++) arms[c] = chain(layout, ["straight-216", "straight-216", "straight-216"], connectorRef(sw, c));
  const sim = new Sim(layout);
  const at = from === 0 ? { pieceId: a2, pathIndex: 0, reversed: false, s: 100 } : { pieceId: arms[from][1], pathIndex: 0, reversed: true, s: 100 };
  const placed = sim.addTrain(CARS, at);
  if (placed.kind !== "placed") throw new Error("no room");
  const id = placed.trainId;
  sim.setLever(sim.getTrain(id)!.cars[0].id, 1);
  return { layout, sim, sw, train: () => sim.getTrain(id) };
}

describe("points never move under a train (issue #3)", () => {
  for (const type of ["switch", "wye"] as const)
    it(`${type}: two routed trains, the second needing the points the other way: the first passes intact, both reach their stops`, () => {
      const { w, a, b, sw, x, p } = junction(type);
      const watch = splitWatch([a, b].map((e) => () => w.sim.findCar(e)?.train));
      const reached = new Set<string>();
      let thrownUnder = 0;
      for (let i = 0; i < 60 * SIM_HZ && reached.size < 2; i++) {
        const before = w.layout.switchState(sw);
        const held = w.sim.pointsHeld(sw);
        w.sim.tick();
        w.economy.tick();
        if (held && w.layout.switchState(sw) !== before) thrownUnder++;
        watch.check();
        if (w.sim.findCar(a)!.train.bogies[0].pieceId === x) reached.add("A at X");
        if (w.sim.findCar(b)!.train.bogies[0].pieceId === p) reached.add("B at P");
      }
      expect(thrownUnder).toBe(0);
      expect(watch.worst()).toBeLessThan(2);
      expect([...reached].sort()).toEqual(["A at X", "B at P"]);
    });

  for (const [type, from] of [
    ["switch", 0],
    ["switch", 1],
    ["wye", 1],
    ["wye", 2],
    ["crossover", 0],
    ["crossover", 3],
  ] as const)
    it(`${type}, coming in at its end ${from}: the lever thrown while the train runs over is refused; the train passes intact; then it throws`, () => {
      const { layout, sim, sw, train } = pointsWith(type, from);
      const watch = splitWatch([train]);
      let tries = 0;
      let refused = 0;
      let wasOn = false;
      let clear = false;
      for (let i = 0; i < 10 * SIM_HZ && !clear; i++) {
        const on = sim.piecesUnder(train()!.id).has(sw);
        // A tap on the lever every few ticks while any car is on or over the points (as `throwLever` calls it).
        if (on && i % 7 === 0) {
          tries++;
          const before = layout.switchState(sw);
          if (!sim.toggleSwitch(sw)) refused++;
          expect(layout.switchState(sw)).toBe(before);
        }
        if (wasOn && !on) clear = true;
        wasOn ||= on;
        sim.tick();
        watch.check();
      }
      expect(tries).toBeGreaterThan(5);
      expect(refused).toBe(tries);
      expect(watch.worst()).toBeLessThan(2);
      // Off them, the lever throws them again.
      expect(clear).toBe(true);
      const before = layout.switchState(sw);
      expect(sim.toggleSwitch(sw)).toBe(true);
      expect(layout.switchState(sw)).not.toBe(before);
    });
});

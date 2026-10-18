import { describe, expect, it } from "vitest";
import { Sim, SIM_DT, SIM_HZ, type CarKind } from "../sim";
import { connectorRef, createWorldConnector, Layout, type PieceTypeId } from "../track";
import { editLine, joinLine } from "../game/lines";
import { CARGO } from "./cargo";
import { Economy } from "./economy";
import { DEFAULT_HEADWAY_S, MAX_HOLD_S, Spacing } from "./spacing";
import { engineStatus } from "../game/engine-status";

/**
 * An oval with a forest on one side and a sawmill on the other, and `count` timber trains standing bunched up just
 * behind the forest, all set going. The forest's logs are kept topped up, so every train has work at both.
 */
function oval(count: number, cars: CarKind[] = ["engine", "timber"], topUp = true) {
  const layout = new Layout();
  const half: PieceTypeId[] = ["depot-forest", "straight-216", "straight-216", ...Array<PieceTypeId>(4).fill("curve-large")];
  const types: PieceTypeId[] = [...half, "depot-sawmill", "straight-216", "straight-216", ...Array<PieceTypeId>(4).fill("curve-large")];
  const c = createWorldConnector();
  let at = { x: 0, z: 0, heading: 0 };
  const ids: number[] = [];
  for (const type of types) {
    const id = layout.addPiece(type, at);
    ids.push(id);
    layout.worldConnector(connectorRef(id, 1), c);
    at = { x: c.x, z: c.z, heading: c.heading };
  }
  const sim = new Sim(layout);
  const economy = new Economy(layout, sim);
  const forest = economy.addDepot("forest", ids[0], 0);
  const mill = economy.addDepot("sawmill", ids[half.length], 0);
  // Bunched: each on the last curve before the forest, one behind the other.
  const engines: number[] = [];
  const last = ids.length - 1;
  for (let k = 0; k < count; k++) {
    const placed = sim.addTrain(cars, { pieceId: ids[last - k * 2], pathIndex: 0, reversed: false, s: 60 });
    if (placed.kind !== "placed") throw new Error("no room");
    const engine = sim.getTrain(placed.trainId)!.cars[0].id;
    engines.push(engine);
  }
  const line = editLine(economy, engines[0], (s) => s.push({ depotId: forest.id, action: "auto" }, { depotId: mill.id, action: "auto" }))!;
  for (const e of engines.slice(1)) joinLine(economy, e, line.id);
  for (const e of engines) sim.setLever(e, 1);
  const departures = new Map<number, number[]>(engines.map((e) => [e, []]));
  // Every hold the spacing grants, by engine and tick (to test against).
  const holds: { engine: number; tick: number }[] = [];
  const grant = economy.spacing.holds.bind(economy.spacing);
  economy.spacing.holds = (lineId, stops, engine, index, live, now, lever) => {
    const yes = grant(lineId, stops, engine, index, live, now, lever);
    if (yes) holds.push({ engine, tick: now });
    return yes;
  };
  let t = 0;
  const step = () => {
    if (topUp) forest.piles[CARGO.log.index] = Math.max(forest.piles[CARGO.log.index], 4);
    const before = engines.map((e) => economy.routeOf(e)?.next);
    sim.tick();
    economy.tick();
    t++;
    // A departure from the forest: heading for the mill now, from the forest before.
    engines.forEach((e, k) => {
      if (before[k] === 0 && economy.routeOf(e)?.next === 1) departures.get(e)!.push(t * SIM_DT);
    });
  };
  const run = (seconds: number) => {
    for (let i = 0; i < seconds * SIM_HZ; i++) step();
  };
  return { layout, sim, economy, engines, line, forest, mill, departures, holds, run, step, now: () => t * SIM_DT };
}

describe("auto-spacing (Spacing)", () => {
  it("a lone train is never held; one behind another waits for it, then the headway; never more than MAX_HOLD_S", () => {
    const tick = (sec: number) => sec / SIM_DT;
    const s = new Spacing();
    s.departed(1, "a,b", 10, 0, 0);
    expect(s.holds(1, "a,b", 11, 0, [11], 1)).toBe(false);
    // Two trains, no lap known yet: the default headway after the other left.
    expect(s.holds(1, "a,b", 11, 0, [10, 11], tick(1))).toBe(true);
    expect(s.holds(1, "a,b", 11, 0, [10, 11], tick(DEFAULT_HEADWAY_S + 0.1))).toBe(false);
    // Its own last departure doesn't hold it.
    const own = new Spacing();
    own.departed(1, "a,b", 11, 0, 0);
    expect(own.holds(1, "a,b", 11, 0, [10, 11], tick(1))).toBe(false);
    // Behind another still at the stop (which came first): waits; the first one doesn't.
    const q = new Spacing();
    q.arrived(1, "a,b", 10, 0, tick(1));
    q.arrived(1, "a,b", 11, 0, tick(2));
    expect(q.holds(1, "a,b", 10, 0, [10, 11], tick(3))).toBe(false);
    expect(q.holds(1, "a,b", 11, 0, [10, 11], tick(3))).toBe(true);
    // ...but not behind one no longer running (taken off).
    expect(q.holds(1, "a,b", 11, 0, [11, 12], tick(3))).toBe(false);
    // A long lap (a big headway): the hold still ends MAX_HOLD_S after it began.
    const t = new Spacing();
    t.departed(1, "a,b", 10, 0, 0);
    t.departed(1, "a,b", 10, 0, tick(200));
    expect(t.lapSeconds(1)).toBeCloseTo(200);
    expect(t.holds(1, "a,b", 11, 0, [10, 11], tick(201))).toBe(true);
    expect(t.holds(1, "a,b", 11, 0, [10, 11], tick(201 + MAX_HOLD_S - 0.1))).toBe(true);
    expect(t.holds(1, "a,b", 11, 0, [10, 11], tick(201 + MAX_HOLD_S + 0.1))).toBe(false);
    // The line edited (its stops changed): learnt afresh, no lap, no last departure.
    expect(t.holds(1, "a,b,c", 12, 0, [10, 12], tick(202))).toBe(false);
    expect(t.lapSeconds(1)).toBe(0);
  });
});

describe("auto-spacing on a line", () => {
  it("two trains started bunched spread out to about half a lap apart within a few laps", () => {
    const w = oval(2);
    w.run(1500);
    const [a, b] = w.engines.map((e) => w.departures.get(e)!);
    expect(a.length).toBeGreaterThanOrEqual(5);
    expect(b.length).toBeGreaterThanOrEqual(5);
    const lap = w.economy.spacing.lapSeconds(w.line.id);
    expect(lap).toBeGreaterThan(0);
    const all = [...a.map((t) => ({ t, e: 0 })), ...b.map((t) => ({ t, e: 1 }))].sort((x, y) => x.t - y.t);
    // The last few: the two trains alternate, about half a lap apart.
    const late = all.slice(-6);
    for (let k = 1; k < late.length; k++) {
      expect(late[k].e).not.toBe(late[k - 1].e);
      expect(late[k].t - late[k - 1].t).toBeGreaterThan(lap * 0.35);
    }
    expect(w.holds.length).toBeGreaterThan(0);
  });

  it("one train on a line is never held", () => {
    const w = oval(1);
    w.run(300);
    expect(w.departures.get(w.engines[0])!.length).toBeGreaterThan(0);
    expect(w.holds).toHaveLength(0);
  });

  it("a hold is never granted while the train's being worked, nor more than MAX_HOLD_S after its work", () => {
    const w = oval(2);
    let workedHold = 0;
    const grant = w.economy.spacing.holds.bind(w.economy.spacing);
    w.economy.spacing.holds = (...args) => {
      const yes = grant(...args);
      if (yes && [w.forest.id, w.mill.id].some((d) => w.engines.includes(-1) || w.sim.findCar(w.economy.servicedCar(d))?.train === w.sim.findCar(args[2])?.train)) workedHold++;
      return yes;
    };
    w.run(800);
    expect(workedHold).toBe(0);
    // Each run of holds for one train at one stop lasts at most MAX_HOLD_S.
    for (const e of w.engines) {
      const ticks = w.holds.filter((h) => h.engine === e).map((h) => h.tick);
      let start = ticks[0];
      for (let k = 1; k < ticks.length; k++) {
        if (ticks[k] !== ticks[k - 1] + 1) start = ticks[k];
        expect((ticks[k] - start) * SIM_DT).toBeLessThanOrEqual(MAX_HOLD_S);
      }
    }
  });

  it("the lever sends a held train on; removing the other train releases it at once", () => {
    for (const how of ["lever", "remove"] as const) {
      const w = oval(2);
      let held = -1;
      for (let i = 0; i < 800 * SIM_HZ && held === -1; i++) {
        const n = w.holds.length;
        w.step();
        if (w.holds.length > n && w.holds.at(-1)!.tick > 0) held = w.holds.at(-1)!.engine;
      }
      expect(held, how).not.toBe(-1);
      const other = w.engines.find((e) => e !== held)!;
      if (how === "lever") w.sim.setLever(held, -1);
      else w.sim.removeTrain(w.sim.findCar(other)!.train.id);
      const n = w.holds.length;
      w.run(1);
      expect(w.holds.filter((h) => h.engine === held).length, how).toBe(w.holds.slice(0, n).filter((h) => h.engine === held).length);
      expect(w.sim.findCar(held)!.train.speed, how).toBeGreaterThan(0);
    }
  });

  it("unrouted trains are never held", () => {
    const w = oval(2);
    for (const e of w.engines) w.economy.setRoute(e, null);
    w.economy.lineIdOf.clear();
    w.run(300);
    expect(w.holds).toHaveLength(0);
  });

  it("new work during a hold ends it: the train is served, then holds only for what's left (by its first hold + MAX_HOLD_S)", () => {
    // No logs at the forest: a train there has nothing to do, and is held (spacing) while the other has just left.
    const w = oval(2, ["engine", "timber"], false);
    w.forest.piles[CARGO.log.index] = 0;
    w.forest.rate = 0;
    let held = -1;
    let holdStart = -1;
    for (let i = 0; i < 600 * SIM_HZ && held === -1; i++) {
      const n = w.holds.length;
      w.step();
      const h = w.holds.at(-1);
      // (A headway hold: the other train has left the forest, so the logs are this one's.)
      const other = h && w.engines.find((e) => e !== h.engine)!;
      const gone = other !== undefined && !w.sim.findCar(other)!.train.bogies.some((b) => b.pieceId === w.forest.pieceId);
      if (w.holds.length > n && h && gone && w.economy.routeOf(h.engine)!.stops[w.economy.routeOf(h.engine)!.next].depotId === w.forest.id) {
        held = h.engine;
        holdStart = h.tick;
      }
    }
    expect(held).not.toBe(-1);
    const wagon = w.sim.findCar(held)!.train.cars[1].id;
    expect(w.economy.cargoOf(wagon).count).toBe(0);
    // Mid-hold, logs on the forest's pile: the train is served (loads), not held, while there's work.
    w.run(0.5);
    w.forest.piles[CARGO.log.index] = 3;
    let served = false;
    let heldWhileWorked = false;
    for (let i = 0; i < 30 * SIM_HZ && w.economy.routeOf(held)!.next === 0; i++) {
      const n = w.holds.length;
      w.step();
      const worked = w.economy.servicedCar(w.forest.id) === wagon;
      if (worked) served = true;
      if (worked && w.holds.length > n && w.holds.at(-1)!.engine === held) heldWhileWorked = true;
    }
    expect(served).toBe(true);
    expect(heldWhileWorked).toBe(false);
    expect(w.economy.cargoOf(wagon).count).toBeGreaterThan(0);
    // It's gone (left the forest) by its first hold's start + MAX_HOLD_S, with any hold after the work inside that.
    const last = w.holds.filter((h) => h.engine === held).at(-1)!;
    expect((last.tick - holdStart) * SIM_DT).toBeLessThanOrEqual(MAX_HOLD_S);
    expect(w.economy.routeOf(held)!.next).toBe(1);
  });

  it("a held train's card says it's spacing out (with how long, at most, where it's known); its lever set again sends it on", () => {
    const w = oval(2);
    let held = -1;
    for (let i = 0; i < 800 * SIM_HZ && held === -1; i++) {
      const n = w.holds.length;
      w.step();
      const h = w.holds.at(-1);
      if (w.holds.length > n && h && w.economy.spacingWait(h.engine)?.left) held = h.engine;
    }
    expect(held).not.toBe(-1);
    const status = engineStatus(w.sim, w.economy, held, () => "");
    expect(status).toMatch(/^Spacing out from the other Red line trains · \d+ s$/);
    const wait = w.economy.spacingWait(held)!;
    expect(wait.left!).toBeLessThanOrEqual(MAX_HOLD_S);
    // "Go now": the lever set again, as it is.
    const lever = w.sim.findCar(held)!.train.cars[0].lever as 1 | -1;
    w.sim.setLever(held, lever);
    w.run(1);
    expect(w.economy.spacingWait(held)).toBe(null);
    expect(w.sim.findCar(held)!.train.speed).toBeGreaterThan(0);
  });
});

import { describe, expect, it } from "vitest";
import { connectorRef, createWorldConnector, getPieceDef, KITS, Layout, LIFT_LENGTH, LIFT_RISE, LIFT_SECONDS, routeFrom, createRouteStep, type PieceTypeId } from "../track";
import { LIFT_DWELL, Sim, SIM_HZ, type CarKind, type SimEvent } from ".";

/** A piece added with its first end on end `index` of piece `id` (facing out of it, at its height). */
function onEnd(layout: Layout, id: number, index: number, type: PieceTypeId): number {
  const c = createWorldConnector();
  layout.worldConnector(connectorRef(id, index), c);
  return layout.addPiece(type, { x: c.x, z: c.z, heading: c.heading }, c.y);
}

/**
 * A line through a train lift: a turnback buffer, three straights (the train starts on the second, trailing back over the first), the lift, and on its
 * high end two straights a level up and a turnback buffer.
 */
function line(cars: CarKind[] = ["engine", "passenger"], s = 60) {
  const layout = new Layout();
  layout.addPiece("buffer-turnback", { x: 0, z: 0, heading: Math.PI });
  const first = layout.addPiece("straight-216", { x: 0, z: 0, heading: 0 });
  const low = onEnd(layout, first, 1, "straight-216");
  const near = onEnd(layout, low, 1, "straight-216");
  const lift = onEnd(layout, near, 1, "kit-train-lift");
  const high = onEnd(layout, lift, 1, "straight-216");
  const far = onEnd(layout, high, 1, "straight-216");
  onEnd(layout, far, 1, "buffer-turnback");
  const sim = new Sim(layout);
  const events: SimEvent[] = [];
  const placed = sim.addTrain(cars, { pieceId: low, pathIndex: 0, reversed: false, s });
  if (placed.kind !== "placed") throw new Error("no room");
  const train = () => sim.getTrain(sim.trainIds()[0])!;
  sim.setLever(train().cars.find((c) => c.kind === "engine")!.id, 1);
  const tick = (n = 1) => {
    for (let i = 0; i < n; i++) {
      sim.tick();
      events.push(...sim.drainEvents());
    }
  };
  /** Run till `done` holds (or `seconds` pass); false if it never did. */
  const until = (done: () => boolean, seconds = 30) => {
    for (let i = 0; i < seconds * SIM_HZ; i++) {
      if (done()) return true;
      tick();
    }
    return done();
  };
  return { layout, sim, lift, low, near, high, far, train, tick, until, events };
}

const onLift = (w: ReturnType<typeof line>, id = w.sim.trainIds()[0]) => w.sim.getTrain(id)!.bogies.every((b) => b.pieceId === w.lift);

describe("the train lift", () => {
  const def = getPieceDef("kit-train-lift", false);

  it("has a low end and a high end a level up, straight on, and the platform at each (gated: only one is live)", () => {
    expect(def.connectors.map((c) => c.y)).toEqual([0, LIFT_RISE]);
    expect(def.connectors[1].pose).toMatchObject({ x: LIFT_LENGTH, z: 0, heading: 0 });
    expect(def.paths.map((p) => [p.from, p.to])).toEqual([
      [0, null],
      [1, null],
    ]);
    expect(def.gated).toBe(true);
    expect(def.lift?.seconds).toBe(LIFT_SECONDS);
    expect(KITS["kit-train-lift"]).toMatchObject({ rails: "model", moves: "state", asset: "mech-train-lift" });
    const w = line();
    const step = createRouteStep();
    // Down: the low line runs onto it, the high line doesn't.
    expect(routeFrom(w.layout, w.near, 1, step)).toBe(true);
    expect(step).toMatchObject({ pieceId: w.lift, pathIndex: 0 });
    expect(routeFrom(w.layout, w.high, 0, step)).toBe(false);
    w.layout.setSwitchState(w.lift, 1);
    expect(routeFrom(w.layout, w.near, 1, step)).toBe(false);
    expect(routeFrom(w.layout, w.high, 0, step)).toBe(true);
    expect(step).toMatchObject({ pieceId: w.lift, pathIndex: 1 });
  });

  it("a train halts on the platform, waits a moment, is carried up a level over T seconds held still, and drives off the top", () => {
    const w = line();
    expect(w.until(() => onLift(w) && w.train().speed === 0)).toBe(true);
    // Halted with its front just short of the platform's end.
    const t = w.train();
    expect(t.bogies[0].s).toBeGreaterThan(LIFT_LENGTH - 30);
    expect(t.bogies[0].s).toBeLessThan(LIFT_LENGTH);
    const before = t.bogies.map((b) => b.s);
    // The dwell, then it goes.
    let started = -1;
    w.until(() => {
      if (w.sim.liftPosition(w.lift) > 0) started = w.sim.ticks;
      return started >= 0;
    }, 5);
    expect(started).toBeGreaterThan(0);
    expect(w.sim.liftState(t.id)).toBe("riding");
    expect(w.layout.switchState(w.lift)).toBe(1);
    expect(w.layout.deckTurning(w.lift)).toBe(true);
    // Axles on the upper road at once, at the same spots, heading out; drawn rising, held still.
    expect(t.bogies.every((b) => b.pieceId === w.lift && b.pathIndex === 1 && b.reversed)).toBe(true);
    expect(t.bogies.map((b) => b.s)).toEqual(before);
    let lastY = -1;
    const ys: number[] = [];
    for (let i = 0; i < LIFT_SECONDS * SIM_HZ - 2; i++) {
      w.tick();
      expect(w.train().speed).toBe(0);
      expect(w.train().world[0].y).toBeGreaterThanOrEqual(lastY);
      lastY = w.train().world[0].y;
      ys.push(lastY);
      expect(w.train().bogies.map((b) => b.s)).toEqual(before);
    }
    expect(ys[Math.floor(ys.length / 2)]).toBeGreaterThan(LIFT_RISE * 0.3);
    expect(ys[Math.floor(ys.length / 2)]).toBeLessThan(LIFT_RISE * 0.7);
    w.tick(3);
    expect(w.sim.liftPosition(w.lift)).toBe(1);
    expect(w.train().world[0].y).toBeCloseTo(LIFT_RISE, 6);
    // Off the top, lever still on, and nothing came off the rails.
    expect(w.until(() => w.train().bogies[0].pieceId === w.far, 10)).toBe(true);
    expect(w.train().derailed).toBe(false);
    expect(w.train().world[0].y).toBeCloseTo(LIFT_RISE, 6);
  });

  it("carries it back down: the train turns back at the top's buffer, comes onto the platform there, and rides down", () => {
    const w = line();
    expect(w.until(() => w.train().bogies[0].pieceId === w.far, 30)).toBe(true);
    // Back down, and off the bottom.
    expect(w.until(() => w.events.some((e) => e.kind === "turned") && w.train().bogies[0].pieceId === w.near && w.layout.switchState(w.lift) === 0 && !w.train().bogies.some((b) => b.pieceId === w.lift), 60)).toBe(true);
    expect(w.train().derailed).toBe(false);
    expect(w.train().world[0].y).toBeCloseTo(0, 6);
    expect(w.events.some((e) => e.kind === "derailed")).toBe(false);
  });

  it("the move itself: carry(A → B) over T seconds moves every axle and draws the train there at the end", () => {
    const w = line();
    w.sim.setLever(w.train().cars[0].id, 0);
    w.sim.removeTrain(w.train().id);
    const placed = w.sim.addTrain(["engine"], { pieceId: w.lift, pathIndex: 0, reversed: false, s: 150 });
    expect(placed.kind).toBe("placed");
    const id = w.sim.trainIds()[0];
    expect(w.sim.carry(w.lift, 1, 2)).toEqual([id]);
    // Gated meanwhile: nothing joins it.
    expect(routeFrom(w.layout, w.high, 0, createRouteStep())).toBe(false);
    expect(routeFrom(w.layout, w.near, 1, createRouteStep())).toBe(false);
    // Asked again mid-ride: still going.
    expect(w.sim.deckRefusal(w.lift)).toBe("turning");
    expect(w.sim.carry(w.lift, 0, 2)).toBeNull();
    w.tick(SIM_HZ);
    expect(w.sim.liftPosition(w.lift)).toBeCloseTo(0.5, 1);
    expect(w.sim.getTrain(id)!.world[0].y).toBeCloseTo(LIFT_RISE / 2, 0);
    w.tick(SIM_HZ);
    expect(w.sim.liftPosition(w.lift)).toBe(1);
    expect(routeFrom(w.layout, w.high, 0, createRouteStep())).toBe(true);
    expect(w.sim.getTrain(id)!.world[0].y).toBeCloseTo(LIFT_RISE, 6);
  });

  it("a tap sends the empty platform to the other end; a train coming in to an end that's away waits there and calls it", () => {
    const w = line(["engine"], 10);
    w.sim.setLever(w.train().cars[0].id, 0);
    expect(w.sim.toggleSwitch(w.lift)).toBe(true);
    expect(w.sim.liftPosition(w.lift)).toBe(0);
    w.tick(LIFT_SECONDS * SIM_HZ + 1);
    expect(w.sim.liftPosition(w.lift)).toBe(1);
    // The platform's up: the train runs to the low end and waits there (as at a red signal: no turning back).
    w.sim.setLever(w.train().cars[0].id, 1);
    expect(w.until(() => w.train().bogies[0].pieceId === w.near && w.train().speed === 0 && w.train().bogies[0].s > 150, 20)).toBe(true);
    expect(w.train().turnback).toBe(-1);
    expect(w.sim.liftState(w.train().id)).toBe("waiting");
    // Called, the platform comes down for it (after a moment), and it rides up.
    expect(w.until(() => w.sim.liftPosition(w.lift) < 1, 3)).toBe(true);
    expect(w.until(() => w.layout.switchState(w.lift) === 1 && onLift(w) && w.train().bogies[0].reversed, 20)).toBe(true);
    expect(w.events.some((e) => e.kind === "derailed" || e.kind === "buffer")).toBe(false);
  });

  it("refuses a train too long for the platform: it's told once, runs to the end and turns back; the lift stays", () => {
    const w = line(["engine", "passenger", "passenger", "passenger"], 200);
    const carIds = w.train().cars.map((c) => c.id);
    expect(w.until(() => w.events.some((e) => e.kind === "turned"), 40)).toBe(true);
    const refused = w.events.filter((e) => e.kind === "lift-refused");
    expect(refused).toHaveLength(1);
    // The refusal names the train's cars (the toast is keyed by them, the train gone by then, turned round).
    expect(refused[0].kind === "lift-refused" && refused[0].carIds).toEqual(carIds);
    expect(w.layout.switchState(w.lift)).toBe(0);
    expect(w.sim.liftPosition(w.lift)).toBe(0);
    // Off again the way it came, on the rails.
    expect(w.until(() => !w.sim.getTrain(w.sim.trainIds()[0])!.bogies.some((b) => b.pieceId === w.lift), 10)).toBe(true);
    expect(w.sim.getTrain(w.sim.trainIds()[0])!.derailed).toBe(false);
  });

  it("won't go with a train partly on it, nor with one coming in within its braking distance", () => {
    const w = line(["engine", "passenger"], 10);
    // Coming in: the lift waits.
    expect(w.until(() => w.train().bogies[0].pieceId === w.near && w.train().bogies[0].s > 170 && w.train().speed > 100, 10)).toBe(true);
    expect(w.sim.deckRefusal(w.lift)).toBe("approaching");
    expect(w.sim.toggleSwitch(w.lift)).toBe(false);
    // Partly on.
    expect(w.until(() => w.train().bogies[0].pieceId === w.lift && w.train().bogies.some((b) => b.pieceId !== w.lift), 5)).toBe(true);
    expect(w.sim.deckRefusal(w.lift)).toBe("partly");
    expect(w.sim.toggleSwitch(w.lift)).toBe(false);
    expect(w.layout.switchState(w.lift)).toBe(0);
    // A train well away doesn't hold it up.
    const far = line(["engine"], 10);
    expect(far.sim.deckRefusal(far.lift)).toBeNull();
  });

  it("a second train waits at the end behind the one on the platform, then gets its own ride", () => {
    const w = line(["engine"], 150);
    const second = w.sim.addTrain(["engine"], { pieceId: w.low, pathIndex: 0, reversed: false, s: 30 });
    expect(second.kind).toBe("placed");
    const b = second.kind === "placed" ? second.trainId : -1;
    w.sim.setLever(w.sim.getTrain(b)!.cars[0].id, 1);
    const a = w.sim.trainIds()[0];
    expect(w.until(() => w.sim.liftState(a) === "riding", 10)).toBe(true);
    // The second held off the lift, at its end.
    expect(w.sim.getTrain(b)!.bogies.every((c) => c.pieceId !== w.lift)).toBe(true);
    expect(w.until(() => !!w.sim.getTrain(b)?.bogies.every((c) => c.pieceId === w.lift) && w.sim.liftState(b) === "riding", 40)).toBe(true);
    expect(w.events.some((e) => e.kind === "derailed")).toBe(false);
  });

  it("a train waiting at its end, in the way of one coming off it: both stand, neither turns back nor rides round", () => {
    // A dead-end branch: the low line, the lift, and a turnback at the top. One train rides up and back down; the other
    // comes up behind it and waits at the low end, in the way of the one coming off. Neither turns back (routing §16
    // Q3): they stand, each held by the other, till the player moves one. Before, the waiting one gave way; before
    // that, the one coming off turned back onto the lift and rode round for good (QA's sweep: 35 rides).
    const layout = new Layout();
    layout.addPiece("buffer-turnback", { x: 0, z: 0, heading: Math.PI });
    const s: number[] = [layout.addPiece("straight-216", { x: 0, z: 0, heading: 0 })];
    for (let i = 0; i < 5; i++) s.push(onEnd(layout, s.at(-1)!, 1, "straight-216"));
    const lift = onEnd(layout, s.at(-1)!, 1, "kit-train-lift");
    onEnd(layout, lift, 1, "buffer-turnback");
    const sim = new Sim(layout);
    const engines = [s[4], s[1]].map((pieceId) => {
      const placed = sim.addTrain(["engine", "passenger"], { pieceId, pathIndex: 0, reversed: false, s: 60 });
      if (placed.kind !== "placed") throw new Error("no room");
      const id = sim.getTrain(placed.trainId)!.cars[0].id;
      sim.setLever(id, 1);
      return id;
    });
    // (Cars keep their ids; a train turned back is a new train.)
    const longest = [0, 0];
    const now = [0, 0];
    for (let i = 0; i < 300 * SIM_HZ; i++) {
      sim.tick();
      engines.forEach((car, k) => {
        const t = sim.findCar(car)!.train;
        now[k] = sim.liftState(t.id) === "waiting" ? now[k] + 1 : 0;
        longest[k] = Math.max(longest[k], now[k]);
      });
    }
    // They stand nose to nose (one of them on, or at the foot of, the lift), each held by the other; no derailment.
    const [ta, tb] = engines.map((car) => sim.findCar(car)!.train);
    expect(ta.speed + tb.speed).toBe(0);
    expect(sim.heldBy(ta.id)).toBe(tb.id);
    expect(sim.heldBy(tb.id)).toBe(ta.id);
    expect(Math.max(...longest) / SIM_HZ).toBeGreaterThan(30);
    expect(sim.drainEvents().some((e) => e.kind === "derailed")).toBe(false);
  });

  it("a train just off a lift meeting one running at it: both stop nose to nose; neither turns back, it never rides again", () => {
    // QA: one coming off met the other still running in (not yet waiting); both turned back, so the one coming off
    // went back up the lift, round and round (35 rides, 2 stops reached).
    const layout = new Layout();
    layout.addPiece("buffer-turnback", { x: 0, z: 0, heading: Math.PI });
    const s: number[] = [layout.addPiece("straight-216", { x: 0, z: 0, heading: 0 })];
    for (let i = 0; i < 5; i++) s.push(onEnd(layout, s.at(-1)!, 1, "straight-216"));
    const lift = onEnd(layout, s.at(-1)!, 1, "kit-train-lift");
    onEnd(layout, lift, 1, "buffer-turnback");
    const sim = new Sim(layout);
    // One on the platform, carried down and driving off; the other running toward the lift.
    const off = sim.addTrain(["engine", "passenger"], { pieceId: lift, pathIndex: 0, reversed: true, s: 200 });
    const on = sim.addTrain(["engine", "passenger"], { pieceId: s[3], pathIndex: 0, reversed: false, s: 100 });
    if (off.kind !== "placed" || on.kind !== "placed") throw new Error("no room");
    const [a, b] = [off, on].map((p) => sim.getTrain(p.trainId)!.cars[0].id);
    sim.setLever(a, 1);
    sim.setLever(b, 1);
    const turns = { a: 0, b: 0 };
    let rodeAgain = false;
    for (let i = 0; i < 12 * SIM_HZ; i++) {
      sim.tick();
      for (const e of sim.drainEvents()) {
        if (e.kind !== "buffer") continue;
        if (sim.findCar(a)?.train.id === e.trainId) turns.a++;
        if (sim.findCar(b)?.train.id === e.trainId) turns.b++;
      }
      const ta = sim.findCar(a)!.train;
      if (sim.liftState(ta.id) === "riding") rodeAgain = true;
    }
    // Neither turned back (routing §16 Q3); the one coming off never rode again; they stand, each held by the other.
    expect(turns).toEqual({ a: 0, b: 0 });
    expect(rodeAgain).toBe(false);
    expect(sim.heldBy(sim.findCar(a)!.train.id)).toBe(sim.findCar(b)!.train.id);
    expect(sim.heldBy(sim.findCar(b)!.train.id)).toBe(sim.findCar(a)!.train.id);
  });

  it("paused (the sim not ticked), a ride holds where it is, and carries on after", () => {
    const w = line();
    expect(w.until(() => w.sim.liftState(w.train().id) === "riding", 30)).toBe(true);
    w.tick(SIM_HZ);
    const pos = w.sim.liftPosition(w.lift);
    const y = w.train().world[0].y;
    const version = w.sim.ridesVersion;
    // Nothing ticks while the game's paused: nothing moves, and nothing asks for a redraw.
    expect(w.sim.liftPosition(w.lift)).toBe(pos);
    expect(w.train().world[0].y).toBe(y);
    expect(w.sim.ridesVersion).toBe(version);
    w.tick();
    expect(w.sim.liftPosition(w.lift)).toBeGreaterThan(pos);
    expect(w.until(() => w.sim.liftPosition(w.lift) === 1, 3)).toBe(true);
  });

  it("dwells LIFT_DWELL ticks before going", () => {
    expect(LIFT_DWELL).toBe(SIM_HZ);
  });

  it("says which lifts ride (for their sound): none still, the lift from its ride's start to its end", () => {
    const w = line();
    w.sim.removeTrain(w.sim.trainIds()[0]);
    w.tick();
    expect(w.sim.ridingLifts()).toEqual([]);
    expect(w.sim.toggleSwitch(w.lift)).toBe(true);
    expect(w.sim.ridingLifts()).toEqual([w.lift]);
    let ticks = 0;
    while (w.sim.ridingLifts().length > 0 && ticks < 10 * SIM_HZ) {
      w.tick();
      ticks++;
    }
    expect(ticks).toBe(LIFT_SECONDS * SIM_HZ);
    expect(w.sim.liftPosition(w.lift)).toBe(1);
  });
});

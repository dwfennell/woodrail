import { describe, expect, it } from "vitest";
import { CAR_SPECS, Sim, SIM_HZ, type CarKind, type Train } from "../sim";
import { connectorRef, Layout, pieceOfRef } from "../track";
import { engineStatus } from "../game/engine-status";
import { CARGO } from "./cargo";
import { PILE_CAP } from "./constants";
import { Economy, type DepotRole } from "./economy";

// Load in place (docs/superpowers/specs/2026-11-16-load-in-place.md): a train pulls up once, its nose short of the
// depot's far end, and stands still while the crane runs along it and works every wagon where it stands.

const P = 216;

/**
 * Pieces in a row along +x: `before` straights, a depot, four straights. A train stands on the straights before the
 * depot, heading toward it (along +x, or along −x from the far side).
 */
function setup(role: DepotRole, cars: CarKind[], dir: 1 | -1 = 1, before = 4) {
  const layout = new Layout();
  const types = [...Array(before).fill("straight-216"), role === "town" ? "station" : `depot-${role}`, ...Array(4).fill("straight-216")];
  const ids = types.map((t, i) => layout.addPiece(t, { x: i * P, z: 0, heading: 0 }));
  const sim = new Sim(layout);
  const at = before;
  const lead = dir === 1 ? { pieceId: ids[at - 1], pathIndex: 0, reversed: false, s: 150 } : { pieceId: ids[at + 1], pathIndex: 0, reversed: true, s: 150 };
  if (dir === -1) for (let i = 0; i < 3; i++) layout.addPiece("straight-216", { x: -(i + 1) * P, z: 0, heading: 0 });
  const placed = sim.addTrain(cars, lead);
  if (placed.kind !== "placed") throw new Error("no room");
  const economy = new Economy(layout, sim);
  const depot = role === "town" ? economy.addDepot("town", ids[at], 0, 30) : economy.addDepot(role, ids[at], 0);
  const trains = () => [...sim.trainIds()].map((id) => sim.getTrain(id)!);
  const train = () => trains()[0] as Train;
  sim.setLever(train().cars[0].id, 1);
  const step = () => {
    sim.tick();
    economy.tick();
  };
  // The depot's ends along x, in the direction of travel: where it comes in, and its far end.
  const near = dir === 1 ? at * P : (at + 1) * P;
  const far = dir === 1 ? (at + 1) * P : at * P;
  return { layout, sim, economy, depot, ids, train, trains, step, near, far };
}

/** How far the train's nose reaches in the direction of travel (its first car's front face). */
const noseX = (t: Train, dir: 1 | -1) => {
  const inset = CAR_SPECS[t.cars[0].kind].bogieInset;
  return t.world[0].x + dir * inset;
};

const sameSpot = (a: readonly { x: number; z: number }[], b: readonly { x: number; z: number }[]) => a.every((p, i) => Math.abs(p.x - b[i].x) < 1e-6 && Math.abs(p.z - b[i].z) < 1e-6);

describe("load in place", () => {
  for (const dir of [1, -1] as const) {
    it(`stops once, its nose short of the far end, and stands still while every wagon is unloaded and loaded (${dir === 1 ? "+x" : "−x"})`, () => {
      const w = setup("sawmill", ["engine", "timber", "timber", "timber"], dir);
      const wagons = w.train().cars.filter((c) => c.kind === "timber");
      for (const car of wagons) w.economy.setCargo(car.id, "log", 3);
      w.depot.piles[CARGO.planks.index] = PILE_CAP;
      let stops = 0;
      let wasMoving = true;
      let standing: { x: number; z: number }[] | null = null;
      const served = new Set<number>();
      for (let i = 0; i < 60 * SIM_HZ; i++) {
        w.step();
        const t = w.train();
        const working = w.economy.servingDepot(t.id) !== undefined && w.economy.atStop(t.id) !== null;
        if (t.speed === 0 && wasMoving && working) stops++;
        wasMoving = t.speed > 0;
        const car = w.economy.servicedCar(w.depot.id);
        if (car !== -1) {
          served.add(car);
          // Never moves while being served.
          standing ??= t.world.map((p) => ({ x: p.x, z: p.z }));
          expect(sameSpot(t.world, standing)).toBe(true);
          // Its nose short of the depot's far end, never over the joint.
          expect((noseX(t, dir) - w.far) * dir).toBeLessThan(0);
        }
        if (wagons.every((c) => w.economy.cargoOf(c.id).kind === "planks" && w.economy.cargoOf(c.id).count === 3) && t.speed > 0) break;
      }
      expect(stops).toBe(1);
      expect([...served].sort()).toEqual(wagons.map((c) => c.id).sort());
      for (const car of wagons) expect(w.economy.cargoOf(car.id)).toEqual({ kind: "planks", count: 3 });
      // It stood with its nose by the far end (STOP_SHORT, give or take a step).
      expect(Math.abs((noseX({ ...w.train(), world: standing! } as Train, dir) - w.far) * dir + 6)).toBeLessThan(2);
    });
  }

  it("takes about as long as it did when it crept under the crane wagon by wagon", () => {
    // Today's times on main (crept under the crane), from the same start: 1, 2 and 3 wagons of logs unloaded and
    // planks loaded, till the train's tail is past the depot.
    const before = [9.54, 14.7, 19.87];
    for (const n of [1, 2, 3]) {
      const w = setup("sawmill", ["engine", ...Array(n).fill("timber")]);
      const wagons = w.train().cars.filter((c) => c.kind === "timber");
      for (const car of wagons) w.economy.setCargo(car.id, "log", 3);
      w.depot.piles[CARGO.planks.index] = PILE_CAP;
      let seconds = -1;
      for (let i = 0; i < 120 * SIM_HZ; i++) {
        w.step();
        const t = w.train();
        const done = wagons.every((c) => w.economy.cargoOf(c.id).kind === "planks" && w.economy.cargoOf(c.id).count === 3);
        if (done && Math.min(...t.world.map((p) => p.x)) > w.far) {
          seconds = i / SIM_HZ;
          break;
        }
      }
      expect(seconds).toBeGreaterThan(0);
      expect(Math.abs(seconds - before[n - 1]) / before[n - 1]).toBeLessThan(0.15);
    }
  });

  it("serves a train longer than the depot where it stands: its nose by the far end, the rest behind", () => {
    const w = setup("sawmill", ["engine", "timber", "timber", "timber", "timber"]);
    const wagons = w.train().cars.filter((c) => c.kind === "timber");
    for (const car of wagons) w.economy.setCargo(car.id, "log", 3);
    let standing: { x: number; z: number }[] | null = null;
    for (let i = 0; i < 60 * SIM_HZ && wagons.some((c) => w.economy.cargoOf(c.id).count > 0); i++) {
      w.step();
      const t = w.train();
      if (w.economy.servicedCar(w.depot.id) !== -1) {
        standing ??= t.world.map((p) => ({ x: p.x, z: p.z }));
        expect(sameSpot(t.world, standing)).toBe(true);
      }
    }
    for (const car of wagons) expect(w.economy.cargoOf(car.id).count).toBe(0);
    // Its tail stood back on the track it came in on.
    expect(Math.min(...standing!.map((p) => p.x))).toBeLessThan(w.near);
    expect(noseX({ ...w.train(), world: standing! } as Train, 1)).toBeLessThan(w.far);
  });

  it("boards every coach at once", () => {
    const w = setup("town", ["engine", "passenger", "passenger", "passenger"]);
    w.economy.seatsOf = () => 4;
    // A second town further on for them to go to.
    const there = w.layout.addPiece("station", { x: 9 * P, z: 0, heading: 0 });
    w.economy.addDepot("town", there, 1, 30);
    w.depot.waiting = 12;
    const coaches = w.train().cars.filter((c) => c.kind === "passenger");
    let together = false;
    for (let i = 0; i < 30 * SIM_HZ && w.depot.waiting > 0; i++) {
      w.step();
      const counts = coaches.map((c) => w.economy.ridersOf(c.id).count);
      if (counts.every((n) => n === 1)) together = true;
      // Never one coach two ahead of another: they fill side by side.
      expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(1);
    }
    expect(together).toBe(true);
    expect(coaches.map((c) => w.economy.ridersOf(c.id).count)).toEqual([4, 4, 4]);
  });

  it("serves a visit begun standing where it stands", () => {
    const w = setup("sawmill", ["engine", "timber"]);
    // Run it onto the depot with nothing to do, then stop it there.
    w.economy.skipVisit(w.train().id);
    for (let i = 0; i < 4 * SIM_HZ && !w.train().bogies.every((b) => b.pieceId === w.depot.pieceId); i++) w.step();
    w.sim.setLever(w.train().cars[0].id, 0);
    for (let i = 0; i < 2 * SIM_HZ; i++) w.step();
    const wagon = w.train().cars[1];
    // (A fresh visit: as a game loaded mid-load.)
    w.economy.setCargo(wagon.id, "log", 3);
    w.sim.setLever(w.train().cars[0].id, 0);
    const economy = new Economy(w.layout, w.sim);
    economy.addDepot("sawmill", w.depot.pieceId, 0);
    economy.setCargo(wagon.id, "log", 3);
    w.sim.setLever(w.train().cars[0].id, 1);
    const at = w.train().world.map((p) => ({ x: p.x, z: p.z }));
    for (let i = 0; i < 10 * SIM_HZ && economy.cargoOf(wagon.id).count > 0; i++) {
      w.sim.tick();
      economy.tick();
      expect(sameSpot(w.train().world, at)).toBe(true);
    }
    expect(economy.cargoOf(wagon.id).count).toBe(0);
  });

  it("a train held short behind another pulls up once that one has gone, and stops only there", () => {
    const w = setup("sawmill", ["engine", "timber"], 1, 5);
    // A second train behind the first.
    const back = w.sim.addTrain(["engine", "timber"], { pieceId: w.ids[2], pathIndex: 0, reversed: false, s: 150 });
    if (back.kind !== "placed") throw new Error("no room");
    const second = w.trains().find((t) => t.id !== w.train().id)!;
    w.sim.setLever(second.cars[0].id, 1);
    const first = w.train();
    for (const t of [first, second]) w.economy.setCargo(t.cars[1].id, "log", 3);
    let secondStandsAt: number[] = [];
    let wasMoving = true;
    for (let i = 0; i < 60 * SIM_HZ && w.economy.cargoOf(second.cars[1].id).count > 0; i++) {
      w.step();
      const t = w.sim.getTrain(second.id)!;
      if (t.speed === 0 && wasMoving) secondStandsAt.push(noseX(t, 1));
      wasMoving = t.speed > 0;
    }
    expect(w.economy.cargoOf(first.cars[1].id).count).toBe(0);
    expect(w.economy.cargoOf(second.cars[1].id).count).toBe(0);
    // Its last stop (where it was served) is its pull-up spot by the far end.
    secondStandsAt = secondStandsAt.slice(-1);
    expect(Math.abs(secondStandsAt[0] - (w.far - 6))).toBeLessThan(2);
  });
});

describe("load in place: points behind the depot", () => {
  /**
   * Straights, a switch (its straight road along +x), a sawmill, then `after` along +x (a signal on the sawmill's far
   * joint, or not): a train of an engine and three flatbeds of logs (much longer than the sawmill) comes in over the switch.
   */
  function pointsBehind(signal: boolean) {
    const layout = new Layout();
    const ids: number[] = [];
    let x = 0;
    for (let i = 0; i < 4; i++, x += P) ids.push(layout.addPiece("straight-216", { x, z: 0, heading: 0 }));
    const sw = layout.addPiece("switch", { x, z: 0, heading: 0 });
    const swEnd = [0, 1, 2].map((c) => layout.worldConnector(connectorRef(sw, c), { x: 0, z: 0, heading: 0, y: 0, kind: "peg" })).reduce((a, b) => (b.x > a.x && Math.abs(b.z) < 1 ? b : a));
    const mill = layout.addPiece("depot-sawmill", { x: swEnd.x, z: 0, heading: 0 });
    for (let i = 0; i < 4; i++) layout.addPiece("straight-216", { x: swEnd.x + P * (i + 1), z: 0, heading: 0 });
    const far = [0, 1].find((c) => layout.worldConnector(connectorRef(mill, c), { x: 0, z: 0, heading: 0, y: 0, kind: "peg" }).x > swEnd.x + 100)!;
    expect(layout.joinedConnector(connectorRef(mill, far))).not.toBe(-1);
    expect([0, 1].some((c) => pieceOfRef(layout.joinedConnector(connectorRef(mill, c))) === sw)).toBe(true);
    if (signal) expect(layout.addSignal(connectorRef(mill, far))).toBeGreaterThanOrEqual(0);
    const sim = new Sim(layout);
    const placed = sim.addTrain(["engine", "timber", "timber", "timber"], { pieceId: ids[2], pathIndex: 0, reversed: false, s: 150 });
    if (placed.kind !== "placed") throw new Error("no room");
    const economy = new Economy(layout, sim);
    const depot = economy.addDepot("sawmill", mill, 0);
    const train = () => sim.getTrain([...sim.trainIds()][0])!;
    const engine = train().cars[0].id;
    sim.setLever(engine, 1);
    const wagons = train().cars.slice(1).map((c) => c.id);
    for (const id of wagons) economy.setCargo(id, "log", 3);
    let flagged = false;
    let said = "";
    let standing: Train | null = null;
    for (let i = 0; i < 60 * SIM_HZ && wagons.some((id) => economy.cargoOf(id).count > 0); i++) {
      sim.tick();
      economy.tick();
      if (economy.servicedCar(depot.id) !== -1) {
        standing = train();
        if (economy.standsOnPoints(train().id)) flagged = true;
        said = engineStatus(sim, economy, engine, () => "the sawmill");
      }
    }
    return { layout, sw, mill, flagged, said, standing: standing!, unloaded: wagons.every((id) => economy.cargoOf(id).count === 0), economy, depot };
  }

  it("with plain track past the depot it pulls on till its tail is clear of the points behind", () => {
    const r = pointsBehind(false);
    expect(r.unloaded).toBe(true);
    expect(r.flagged).toBe(false);
    expect(r.standing.bogies.some((b) => b.pieceId === r.sw)).toBe(false);
    expect(r.said).not.toMatch(/points/);
  });

  it("with a signal at the depot's far end there's no such spot: it loads standing on the points, and its card says why", () => {
    const r = pointsBehind(true);
    expect(r.unloaded).toBe(true);
    expect(r.flagged).toBe(true);
    // Its nose not past the signal.
    expect(r.standing.bogies[0].pieceId).toBe(r.mill);
    expect(r.said).toMatch(/^(Loading and unloading|Unloading) at the sawmill: too long for its yard, its tail is on the points$/);
  });
});

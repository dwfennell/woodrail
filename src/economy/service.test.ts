import { describe, expect, it } from "vitest";
import { Sim, SIM_HZ, type CarKind, type Train } from "../sim";
import { Layout } from "../track";
import { CARGO } from "./cargo";
import { CRAWL_SPEED, PILE_CAP } from "./constants";
import { Economy, type DepotRole } from "./economy";

/**
 * Five pieces in a row along +x: two straights, a depot, two straights. A train of an engine and three timber
 * wagons stands on the straights before the depot, heading toward it (along +x, or along −x from the far side).
 */
function setup(role: DepotRole, dir: 1 | -1 = 1, cars: CarKind[] = ["engine", "timber", "timber", "timber"]) {
  const layout = new Layout();
  const types = ["straight-216", "straight-216", role === "forest" ? "depot-forest" : "depot-sawmill", "straight-216", "straight-216"] as const;
  const ids = types.map((t, i) => layout.addPiece(t, { x: i * 216, z: 0, heading: 0 }));
  const sim = new Sim(layout);
  const lead = dir === 1 ? { pieceId: ids[1], pathIndex: 0, reversed: false, s: 150 } : { pieceId: ids[3], pathIndex: 0, reversed: true, s: 150 };
  const placed = sim.addTrain(cars, lead);
  if (placed.kind !== "placed") throw new Error("no room");
  const economy = new Economy(layout, sim);
  const depot = economy.addDepot(role, ids[2], 0);
  const train = () => [...sim.trainIds()].map((id) => sim.getTrain(id)!)[0] as Train;
  const engine = () => train().cars.find((c) => c.kind === "engine")!;
  sim.setLever(engine().id, 1);
  const step = () => {
    sim.tick();
    economy.tick();
  };
  const wagons = () => train().cars.filter((c) => c.kind === "timber");
  return { layout, sim, economy, depot, train, engine, step, wagons, craneX: 2 * 216 + 108 };
}

const carCentreX = (t: Train, carId: number) => {
  const c = t.cars.findIndex((x) => x.id === carId);
  return (t.world[2 * c].x + t.world[2 * c + 1].x) / 2;
};

describe("automatic servicing", () => {
  for (const dir of [1, -1] as const) {
    it(`halts each wagon under the crane and unloads before loading (travelling ${dir === 1 ? "+x" : "−x"})`, () => {
      const w = setup("sawmill", dir);
      for (const car of w.wagons()) w.economy.setCargo(car.id, "log", 3);
      w.depot.piles[CARGO.planks.index] = PILE_CAP;
      const halts: { carId: number; x: number }[] = [];
      let last = -1;
      // How far the whole train got past the depot (it turns back at the end of the line after).
      let past = -Infinity;
      for (let i = 0; i < 120 * SIM_HZ; i++) {
        w.step();
        const xs = w.train().world.map((p) => p.x);
        past = Math.max(past, dir === 1 ? Math.min(...xs) : -Math.max(...xs));
        const now = w.economy.servicedCar(w.depot.id);
        if (now !== -1 && now !== last) halts.push({ carId: now, x: carCentreX(w.train(), now) });
        last = now;
        for (const car of w.wagons()) {
          const c = w.economy.cargoOf(car.id);
          // A wagon never holds two kinds, and only takes planks once its logs are off.
          expect(c.count).toBeLessThanOrEqual(3);
        }
      }
      expect(halts.map((h) => h.carId)).toEqual(w.wagons().map((c) => c.id));
      for (const h of halts) expect(Math.abs(h.x - w.craneX)).toBeLessThan(3);
      for (const car of w.wagons()) expect(w.economy.cargoOf(car.id)).toEqual({ kind: "planks", count: 3 });
      // The whole train went on past the depot.
      expect(past).toBeGreaterThan(dir === 1 ? w.craneX + 108 : -(w.craneX - 108));
    });
  }

  it("crawls through without stopping when there is nothing to do", () => {
    const w = setup("sawmill");
    let maxOnDepot = 0;
    let stopped = false;
    for (let i = 0; i < 40 * SIM_HZ; i++) {
      // Measured on ticks that start with the train already on the depot (the cap applies from then on).
      const on = w.train().bogies.some((b) => b.pieceId === w.depot.pieceId);
      w.step();
      const t = w.train();
      if (on && t.bogies.some((b) => b.pieceId === w.depot.pieceId)) {
        maxOnDepot = Math.max(maxOnDepot, t.speed);
        if (t.speed === 0) stopped = true;
      }
    }
    expect(maxOnDepot).toBeLessThanOrEqual(CRAWL_SPEED + 1e-9);
    expect(maxOnDepot).toBeGreaterThan(0);
    expect(stopped).toBe(false);
  });

  it("with Automatic off, trains run through at full speed and nothing is loaded", () => {
    const w = setup("forest");
    w.economy.setAuto(w.depot.id, false);
    w.depot.piles[CARGO.log.index] = PILE_CAP;
    let max = 0;
    for (let i = 0; i < 15 * SIM_HZ; i++) {
      w.step();
      if (w.train().bogies.some((b) => b.pieceId === w.depot.pieceId)) max = Math.max(max, w.train().speed);
    }
    expect(max).toBeGreaterThan(CRAWL_SPEED * 2);
    for (const car of w.wagons()) expect(w.economy.cargoOf(car.id).count).toBe(0);
  });

  it("a wagon that has rolled past the crane is still loaded, from where it stands", () => {
    const w = setup("forest");
    w.depot.piles[CARGO.log.index] = PILE_CAP;
    // Automatic off until the first wagon is past the crane, then on.
    w.economy.setAuto(w.depot.id, false);
    const first = w.wagons()[0].id;
    for (let i = 0; i < 30 * SIM_HZ && carCentreX(w.train(), first) < w.craneX + 40; i++) w.step();
    expect(carCentreX(w.train(), first)).toBeGreaterThan(w.craneX + 40);
    w.economy.setAuto(w.depot.id, true);
    for (let i = 0; i < 60 * SIM_HZ; i++) w.step();
    for (const car of w.wagons()) expect(w.economy.cargoOf(car.id)).toEqual({ kind: "log", count: 3 });
  });

  it("a train held up short of the crane (a buffer just past the depot) has all its wagons loaded where they stand", () => {
    const layout = new Layout();
    const types = ["straight-216", "straight-216", "depot-forest", "buffer"] as const;
    const ids = types.map((t, i) => layout.addPiece(t, { x: i * 216, z: 0, heading: 0 }));
    const sim = new Sim(layout);
    const placed = sim.addTrain(["engine", "timber", "timber", "timber"], { pieceId: ids[1], pathIndex: 0, reversed: false, s: 150 });
    if (placed.kind !== "placed") throw new Error("no room");
    const economy = new Economy(layout, sim);
    const depot = economy.addDepot("forest", ids[2], 0);
    depot.piles[CARGO.log.index] = PILE_CAP;
    const train = sim.getTrain(placed.trainId)!;
    sim.setLever(train.cars[0].id, 1);
    for (let i = 0; i < 90 * SIM_HZ; i++) {
      sim.tick();
      economy.tick();
    }
    for (const car of sim.getTrain([...sim.trainIds()][0])!.cars.filter((c) => c.kind === "timber")) expect(economy.cargoOf(car.id)).toEqual({ kind: "log", count: 3 });
  });

  it("with wait-for-full, the first wagon waits under the crane until the forest has filled it", () => {
    const w = setup("forest");
    w.economy.setWaitFull(w.depot.id, true);
    const first = w.wagons()[0].id;
    let waited = 0;
    for (let i = 0; i < 70 * SIM_HZ; i++) {
      w.step();
      if (w.economy.servicedCar(w.depot.id) === first) waited++;
    }
    // Three logs at one per 15 s, counted from the start (the train arrives a few seconds in): over 30 s waiting.
    expect(waited / SIM_HZ).toBeGreaterThan(30);
    expect(w.economy.cargoOf(first)).toEqual({ kind: "log", count: 3 });
  });

  it("lever off holds the train and pauses the crane; lever on carries on", () => {
    const w = setup("forest");
    w.depot.piles[CARGO.log.index] = PILE_CAP;
    let i = 0;
    while (w.economy.servicedCar(w.depot.id) === -1 && i++ < 60 * SIM_HZ) w.step();
    const car = w.economy.servicedCar(w.depot.id);
    expect(car).not.toBe(-1);
    w.sim.setLever(w.engine().id, 0);
    const x = carCentreX(w.train(), car);
    const before = w.economy.cargoOf(car).count;
    for (let k = 0; k < 10 * SIM_HZ; k++) w.step();
    expect(carCentreX(w.train(), car)).toBeCloseTo(x, 6);
    expect(w.economy.cargoOf(car).count).toBe(before);
    w.sim.setLever(w.engine().id, 1);
    for (let k = 0; k < 10 * SIM_HZ; k++) w.step();
    expect(w.economy.cargoOf(car).count).toBe(3);
  });

  it("reversing the lever under the crane sends the train back out, with no more loading", () => {
    const w = setup("forest");
    w.depot.piles[CARGO.log.index] = PILE_CAP;
    let i = 0;
    while (w.economy.servicedCar(w.depot.id) === -1 && i++ < 60 * SIM_HZ) w.step();
    const car = w.economy.servicedCar(w.depot.id);
    w.sim.setLever(w.engine().id, -1);
    const x0 = carCentreX(w.train(), car);
    const count = w.economy.cargoOf(car).count;
    for (let k = 0; k < 6 * SIM_HZ; k++) w.step();
    expect(carCentreX(w.train(), car)).toBeLessThan(x0 - 100);
    expect(w.economy.cargoOf(car).count).toBe(count);
    expect(w.economy.servicedCar(w.depot.id)).toBe(-1);
  });

  it("a second train running into one under the crane couples on, and loading carries on", () => {
    const w = setup("forest");
    w.depot.piles[CARGO.log.index] = PILE_CAP;
    let i = 0;
    while (w.economy.servicedCar(w.depot.id) === -1 && i++ < 60 * SIM_HZ) w.step();
    // A lone engine comes up behind on the first straight.
    const first = w.layout.pieceIds().next().value as number;
    const placed = w.sim.addTrain(["engine"], { pieceId: first, pathIndex: 0, reversed: false, s: 60 });
    expect(placed.kind).toBe("placed");
    if (placed.kind === "placed") w.sim.setLever(w.sim.getTrain(placed.trainId)!.cars[0].id, 1);
    expect(() => {
      for (let k = 0; k < 90 * SIM_HZ; k++) w.step();
    }).not.toThrow();
    w.economy.prune();
    const trains = w.sim.trainIds().map((id) => w.sim.getTrain(id)!);
    const wagons = trains.flatMap((t) => t.cars.filter((c) => c.kind === "timber"));
    expect(wagons).toHaveLength(3);
    for (const car of wagons) expect(w.economy.cargoOf(car.id)).toEqual({ kind: "log", count: 3 });
  });

  it("reports each crane move: three unloads, then three loads, for a wagon at the sawmill", () => {
    const w = setup("sawmill", 1, ["engine", "timber"]);
    w.economy.setCargo(w.wagons()[0].id, "log", 3);
    w.depot.piles[CARGO.planks.index] = PILE_CAP;
    const kinds: string[] = [];
    for (let i = 0; i < 40 * SIM_HZ; i++) {
      w.step();
      for (const e of w.economy.drainEvents()) kinds.push(`${e.kind}:${e.cargo}`);
    }
    expect(kinds).toEqual(["unloaded:log", "unloaded:log", "unloaded:log", "loaded:planks", "loaded:planks", "loaded:planks"]);
  });

  it("wait-for-full never holds a wagon at a sawmill with no logs coming (the logs are on a later wagon)", () => {
    const w = setup("sawmill", 1, ["engine", "timber", "timber"]);
    w.economy.setWaitFull(w.depot.id, true);
    const [empty, loaded] = w.wagons();
    w.economy.setCargo(loaded.id, "log", 3);
    // The whole train gets past the depot (before turning back at the end of the line).
    let left = false;
    for (let i = 0; i < 120 * SIM_HZ; i++) {
      w.step();
      if (w.train().world.every((p) => p.x > w.craneX + 108)) left = true;
    }
    expect(w.economy.cargoOf(loaded.id).kind === "log").toBe(false);
    expect(left).toBe(true);
    void empty;
  });
});

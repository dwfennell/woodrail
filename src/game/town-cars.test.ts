import { describe, expect, it } from "vitest";
import { CAR_REST, CARS_EVERY, CARS_PER_TOWN, carsFor, TownCars, type CarTrip } from "./town-cars";
import { Vans } from "./vans";
import { buildStarterWorld } from "./world";

/**
 * A town's own cars (tech tree 3) on the starter map. Setup shortcut (named): the cars a town has had written into the
 * economy's totals, as a car carrier's delivery adds them (that delivery, by train, is next-nodes.test.ts's).
 */
function setup(known = true) {
  const w = buildStarterWorld();
  const town = w.landscape.towns.find((t) => t.name === "Larkfield")!;
  const vans = new Vans(() => w, () => ({ version: 0, has: () => false }));
  let on = known;
  const cars = new TownCars({ world: w, vans, knows: () => on });
  const deliver = (n: number) => w.economy.deliveredGoods.set(town.id, { ...(w.economy.deliveredGoods.get(town.id) ?? {}), autos: n });
  /** Game time: the economy's ticks (the cars move), and the cars looked at once a second, as main.ts does. */
  const run = (seconds: number) => {
    for (let s = 0; s < seconds; s++) {
      for (let k = 0; k < 120; k++) w.economy.tick();
      cars.sync();
    }
  };
  return { w, town, vans, cars, deliver, run, setKnown: (k: boolean) => (on = k) };
}

describe("a town's cars (tech tree 3)", () => {
  it("one with the first delivery of cars, another every few more, two at most", () => {
    expect([0, 1, CARS_EVERY, CARS_EVERY + 1, 100].map(carsFor)).toEqual([0, 1, 1, 2, CARS_PER_TOWN]);
  });

  it("none till a town has had cars; then one drives off along its streets at once, and another comes with more", () => {
    const s = setup();
    s.run(2);
    expect(s.vans.vehicles.list).toHaveLength(0);
    s.deliver(1);
    s.run(1);
    const [car] = s.cars.carsOf(s.town.id);
    expect(car?.kind).toBe("car");
    expect(car.leg).not.toBe("home");
    // It drives on the town's own streets.
    const cells = new Set(s.town.cells);
    for (const i of car.path!.squares) expect(cells.has(i)).toBe(true);
    s.deliver(CARS_EVERY + 1);
    s.run(1);
    expect(s.cars.carsOf(s.town.id)).toHaveLength(2);
  });

  it("it comes back, rests, and goes somewhere else; nothing moves while all rest", () => {
    const s = setup();
    s.deliver(1);
    s.run(1);
    const car = s.cars.carsOf(s.town.id)[0];
    const trip = car.data as CarTrip;
    const legs = new Set<string>();
    const goals = new Set<string>();
    for (let t = 0; t < 240; t++) {
      s.run(1);
      legs.add(car.leg);
      goals.add((car.data as CarTrip).goalKey);
    }
    expect([...legs]).toEqual(expect.arrayContaining(["out", "back", "loading"]));
    expect(goals.size).toBeGreaterThan(1);
    expect((car.data as CarTrip).home).toBe(trip.home);
    // Resting: no pose changes, so the view asks for no frames.
    // (From the start of a rest: a tick at a time till it's back and parked.)
    while (car.leg !== "back") s.w.economy.tick();
    while ((car.leg as string) !== "loading") s.w.economy.tick();
    const v = s.vans.vehicles.version;
    for (let k = 0; k < 120 * (CAR_REST - 1); k++) s.w.economy.tick();
    expect(s.vans.vehicles.version).toBe(v);
  });

  it("taken off the streets when towns' cars don't drive (another mode)", () => {
    const s = setup();
    s.deliver(1);
    s.run(1);
    expect(s.vans.vehicles.list).toHaveLength(1);
    s.setKnown(false);
    s.cars.sync();
    expect(s.vans.vehicles.list).toHaveLength(0);
  });
});

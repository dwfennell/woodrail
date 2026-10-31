import { describe, expect, it } from "vitest";
import { ENGINE_SPEED, Sim, SIM_HZ, type CarKind } from "../sim";
import { appendPiece, connectorRef, Layout } from "../track";
import { attachEngines, CABOOSE_BONUS, quickness, tooHeavy, topSpeed } from "./engines";
import type { World } from "./world";

/** A long straight line and a train of `cars` on it (its engines given `looks`, in order). */
function line(cars: CarKind[], looks: string[] = []) {
  const layout = new Layout();
  let last = layout.addPiece("straight-216", { x: 0, z: 0, heading: 0 });
  for (let i = 0; i < 12; i++) last = appendPiece(layout, "straight-216", false, connectorRef(last, 1));
  const sim = new Sim(layout);
  const placed = sim.addTrain(cars, { pieceId: last, pathIndex: 0, reversed: false, s: 200 });
  if (placed.kind !== "placed") throw new Error("no room");
  const train = () => sim.getTrain(sim.trainIds()[0])!;
  const engines = train().cars.filter((c) => c.kind === "engine");
  looks.forEach((l, i) => sim.setLook(engines[i].id, l as never));
  const w = { layout, sim } as unknown as World;
  return { w, sim, train, engines };
}

describe("engines", () => {
  it("a classic engine pulls 4 cars at the usual speed; a fifth makes it too heavy to move", () => {
    const four = line(["engine", "timber", "timber", "hopper", "van"]);
    expect(topSpeed(four.w, four.train())).toBe(ENGINE_SPEED);
    expect(tooHeavy(four.w, four.train())).toBeNull();
    const five = line(["engine", "timber", "timber", "hopper", "van", "caboose"]);
    expect(topSpeed(five.w, five.train())).toBe(0);
    expect(tooHeavy(five.w, five.train())).toBe("Too heavy: an engine pulls 4 cars, and this train has 5. Add an engine or take a car off");
  });

  it("each kind its own: a tank engine pulls 3 but is quick off the mark; a diesel pulls 6 at 1.2×", () => {
    const tank = line(["engine", "timber", "timber", "timber"], ["tank"]);
    expect(topSpeed(tank.w, tank.train())).toBe(ENGINE_SPEED);
    expect(quickness(tank.w, tank.train())).toBe(2);
    const diesel = line(["engine", "timber", "timber", "timber", "timber", "timber", "timber"], ["diesel"]);
    expect(topSpeed(diesel.w, diesel.train())).toBeCloseTo(ENGINE_SPEED * 1.2);
  });

  it("two engines pull both their loads, at the slower one's speed", () => {
    const t = line(["engine", "engine", "timber", "timber", "timber", "timber", "timber", "timber"], ["diesel", "classic"]);
    expect(topSpeed(t.w, t.train())).toBe(ENGINE_SPEED);
  });

  it("on the sim: too heavy stays put; a tank engine gets going sooner", () => {
    const heavy = line(["engine", "timber", "timber", "timber", "timber", "timber"]);
    attachEngines(heavy.w);
    heavy.sim.setLever(heavy.engines[0].id, 1);
    for (let i = 0; i < SIM_HZ; i++) heavy.sim.tick();
    expect(heavy.train().speed).toBe(0);
    const speedAfter = (looks: string[]) => {
      const t = line(["engine", "timber"], looks);
      attachEngines(t.w);
      t.sim.setLever(t.engines[0].id, 1);
      for (let i = 0; i < SIM_HZ / 5; i++) t.sim.tick();
      return t.train().speed;
    };
    expect(speedAfter(["tank"])).toBeGreaterThan(speedAfter(["classic"]));
  });
});

describe("the goods engine", () => {
  it("pulls 8 cars, slowly, and is slow to get going", () => {
    const t = line(["engine", "timber", "timber", "timber", "timber", "hopper", "hopper", "van", "van"], ["goods"]);
    expect(topSpeed(t.w, t.train())).toBeCloseTo(ENGINE_SPEED * 0.8);
    expect(quickness(t.w, t.train())).toBe(0.7);
  });
});

describe("the caboose (#13)", () => {
  it("at the tail, the train runs a bit faster; mid-train it doesn't; two don't add up", () => {
    expect(CABOOSE_BONUS).toBe(1.1);
    const none = line(["engine", "hopper", "passenger"]);
    expect(topSpeed(none.w, none.train())).toBe(ENGINE_SPEED);
    const tail = line(["engine", "hopper", "caboose"]);
    expect(topSpeed(tail.w, tail.train())).toBeCloseTo(ENGINE_SPEED * 1.1);
    const mid = line(["engine", "caboose", "hopper"]);
    expect(topSpeed(mid.w, mid.train())).toBe(ENGINE_SPEED);
    const two = line(["engine", "caboose", "hopper", "caboose"]);
    expect(topSpeed(two.w, two.train())).toBeCloseTo(ENGINE_SPEED * 1.1);
    // On top of the engine's own speed: a diesel's 1.2×.
    const diesel = line(["engine", "hopper", "caboose"], ["diesel"]);
    expect(topSpeed(diesel.w, diesel.train())).toBeCloseTo(ENGINE_SPEED * 1.2 * 1.1);
    // A caboose on its own, or a train too heavy to move, gets nothing from it.
    const alone = line(["caboose"]);
    expect(topSpeed(alone.w, alone.train())).toBe(ENGINE_SPEED);
    const heavy = line(["engine", "timber", "timber", "hopper", "van", "caboose"]);
    expect(topSpeed(heavy.w, heavy.train())).toBe(0);
  });

  it("on the sim: a train with a caboose at its tail runs a measured stretch sooner", () => {
    const run = (cars: CarKind[]) => {
      const t = line(cars);
      attachEngines(t.w);
      t.sim.setLever(t.engines[0].id, 1);
      for (let i = 0; i < SIM_HZ * 3; i++) t.sim.tick();
      return t.train().speed;
    };
    const plain = run(["engine", "hopper", "passenger"]);
    expect(plain).toBeCloseTo(ENGINE_SPEED, 0);
    expect(run(["engine", "hopper", "caboose"])).toBeCloseTo(ENGINE_SPEED * 1.1, 0);
    expect(run(["engine", "caboose", "hopper"])).toBeCloseTo(plain, 5);
  });
});

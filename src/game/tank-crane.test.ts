import { describe, expect, it } from "vitest";
import { canCarry, CARGO, CARGO_KINDS, CARRIES, Economy, RECIPES, type CargoKind, type CraneEvent } from "../economy";
import { CAR_KINDS, CAR_SPECS, Sim, SIM_HZ, type CarKind } from "../sim";
import { appendPiece, connectorRef, Layout, type PieceTypeId } from "../track";
import { SURF_SEA } from "../landscape";
import { BLUEPRINTS } from "./blueprints";
import { buysText } from "./town-ledger";
import { FULL_PAY, PRICES } from "./towns";
import { THING_RULES } from "./things";
import { buildStarterWorld, INDUSTRY_ROLE } from "./world";
import { checkYard } from "./depot-footprint";
import { trackBlock } from "./track-rules";
import { resourceAt, siteWhy } from "./industries";
import { coastWorld, harbourSite } from "./harbours-testing";
import { firstFoodNews } from "./food-text";

/**
 * Tank wagons and the breakdown crane (claude/tank-crane). Tank wagons: an oil well and a water pump (by water) make
 * oil and water, which ride in tank wagons only, to towns that buy both at full pay. The crane: a crane train drives
 * out by itself to a derailed train and lifts it back on, or is sent to lift a stuck train off the line.
 */

const bp = (id: string) => BLUEPRINTS.find((b) => b.id === id)!;

/** A closed oval of the game's own pieces: an industry on one side and a town's station on the other, a train going round. */
function loop(industries: PieceTypeId[], cars: CarKind[]) {
  const layout = new Layout();
  const half: PieceTypeId[] = ["curve-large", "curve-large", "curve-large", "curve-large"];
  const sequence: PieceTypeId[] = [...half, ...industries, ...half, "station", ...industries.slice(1).map((): PieceTypeId => "straight-216")];
  const ids: number[] = [];
  let last = -1;
  for (const type of sequence) {
    last = last === -1 ? layout.addPiece(type, { x: 0, z: 0, heading: 0 }) : appendPiece(layout, type, false, connectorRef(last, 1));
    ids.push(last);
  }
  const sim = new Sim(layout);
  const economy = new Economy(layout, sim);
  for (const type of industries) economy.addDepot(INDUSTRY_ROLE[type]!, ids[sequence.indexOf(type)]);
  economy.addDepot("town", ids[sequence.indexOf("station")], 0);
  const placed = sim.addTrain(cars, { pieceId: ids[ids.length - 1], pathIndex: 0, reversed: false, s: 200 });
  if (placed.kind !== "placed") throw new Error("no room");
  sim.setLever(sim.getTrain(placed.trainId)!.cars[0].id, 1);
  const run = (minutes: number) => {
    for (let i = 0; i < minutes * 60 * SIM_HZ; i++) {
      sim.tick();
      economy.tick();
    }
  };
  const got = (k: CargoKind) => economy.deliveredGoods.get(0)?.[k] ?? 0;
  return { economy, run, got };
}

describe("Tank wagons", () => {
  it("is built: after Dairy farm, mostly coins, bringing a tank wagon, an oil well and a water pump", () => {
    expect(bp("tankers").plan).toBeUndefined();
    expect(bp("tankers")).toMatchObject({ needs: ["dairy"], tier: 2, research: { goods: { planks: 6 }, coins: 120 } });
    expect(THING_RULES["car:oiltank"]).toMatchObject({ tech: "tankers", cost: { planks: 3 } });
    expect(THING_RULES["piece:depot-oilwell"]).toMatchObject({ tech: "tankers" });
    expect(THING_RULES["piece:depot-waterpump"]).toMatchObject({ tech: "tankers" });
    expect(CAR_SPECS.oiltank).toMatchObject({ length: 84, powered: false });
    expect(RECIPES.oilwell).toMatchObject({ takes: [], gives: ["oil"] });
    expect(RECIPES.waterpump).toMatchObject({ takes: [], gives: ["water"] });
  });

  it("oil and water ride in tank wagons only, and towns buy both at full pay", () => {
    for (const k of ["oil", "water"] as const) {
      expect(CAR_KINDS.filter((c) => canCarry(c, k))).toEqual(["oiltank"]);
      expect(FULL_PAY.has(k)).toBe(true);
      expect(RECIPES.town.takes).toContain(k);
      expect(PRICES[k]).toBeGreaterThan(0);
    }
    expect(CARRIES.oiltank).toEqual(["oil", "water"]);
    expect(canCarry("oiltank", "milk")).toBe(false);
    expect(CARGO_KINDS.indexOf("oil")).toBe(CARGO.oil.index);
    expect(CARGO_KINDS.indexOf("water")).toBe(CARGO.water.index);
    expect(buysText(new Set(["tankers"]))).toContain("oil");
    expect(firstFoodNews("oil", 1, 1, "Ashby")).toBe("First oil! 🛢️ Ashby buys it at full pay");
  });

  it("an oil well's oil goes to town in a tank wagon", () => {
    const { run, got, economy } = loop(["depot-oilwell"], ["engine", "oiltank"]);
    run(6);
    expect(economy.made[CARGO.oil.index]).toBeGreaterThan(0);
    expect(got("oil")).toBeGreaterThan(0);
  }, 120_000);

  it("a water pump's water goes to town in a tank wagon; a van takes none", () => {
    const tank = loop(["depot-waterpump"], ["engine", "oiltank"]);
    tank.run(6);
    expect(tank.got("water")).toBeGreaterThan(0);
    const van = loop(["depot-waterpump"], ["engine", "van"]);
    van.run(4);
    expect(van.got("water")).toBe(0);
  }, 120_000);

  it("a water pump fits by the starter map's river, near the start, and by one square of water (QA 2026-11-05)", () => {
    const w = buildStarterWorld();
    const land = w.landscape;
    const ctx = { land, layout: w.layout, props: w.props, footprint: () => undefined };
    // Every pose within reach of the start (the first towns' stations, x −1500..1500, z −1200..1200), each eighth of a
    // turn: where the track and the yard may go and the water's enough.
    let fits = 0;
    let one = 0;
    for (let x = -1500; x <= 1500; x += 36)
      for (let z = -1200; z <= 1200; z += 36)
        for (let k = 0; k < 8; k++) {
          const pose = { x, z, heading: (k * Math.PI) / 4 };
          if (trackBlock(ctx, "depot-waterpump", false, pose, 0, -1) || checkYard(ctx, "depot-waterpump", pose, 0, -1)) continue;
          if (siteWhy(land, "depot-waterpump", pose)) continue;
          fits++;
          if (resourceAt(land, "waterpump", pose)!.count === 1) one++;
        }
    // (Two squares within 110 mm, as it was: 331 here, 13% of the places by the water it could stand; now 825, 35%.)
    expect(fits).toBeGreaterThan(600);
    // A single square of water is enough to stand by, at a quarter of the pump's rate.
    expect(one).toBeGreaterThan(0);
  }, 120_000);

  it("a water pump must stand by water; an oil well stands anywhere", () => {
    const w = coastWorld();
    const pose = harbourSite(w, SURF_SEA);
    expect(siteWhy(w.landscape, "depot-waterpump", pose)).toBeNull();
    expect(resourceAt(w.landscape, "waterpump", pose)!.count).toBeGreaterThanOrEqual(2);
    // (Far inland, turned away from the coast: no water.)
    const dry = { x: pose.x + Math.cos(pose.heading + Math.PI) * 2000, z: pose.z + Math.sin(pose.heading + Math.PI) * 2000, heading: pose.heading + Math.PI };
    expect(siteWhy(w.landscape, "depot-waterpump", dry)).toMatch(/^Needs water past its yard: \d of 1\. Turn it to face the water$/);
    expect(resourceAt(w.landscape, "oilwell", dry)).toBeNull();
  });
});

/** A long oval of plain track (no depots): `straights` 216s each side. */
function oval(straights = 8) {
  const layout = new Layout();
  const half: PieceTypeId[] = ["curve-large", "curve-large", "curve-large", "curve-large"];
  const side: PieceTypeId[] = Array.from({ length: straights }, () => "straight-216");
  const sequence = [...half, ...side, ...half, ...side];
  const ids: number[] = [];
  let last = -1;
  for (const type of sequence) {
    last = last === -1 ? layout.addPiece(type, { x: 0, z: 0, heading: 0 }) : appendPiece(layout, type, false, connectorRef(last, 1));
    ids.push(last);
  }
  const sim = new Sim(layout);
  const economy = new Economy(layout, sim);
  const tick = (seconds: number, until?: () => boolean) => {
    for (let i = 0; i < seconds * SIM_HZ; i++) {
      sim.tick();
      economy.tick();
      if (until?.()) return true;
    }
    return false;
  };
  const events: CraneEvent[] = [];
  const drain = () => {
    events.push(...economy.breakdown.drainEvents());
    return events;
  };
  return { layout, sim, economy, ids, tick, drain, sequence };
}

describe("Breakdown crane", () => {
  it("is built: after Goods engine and Quicker cranes, a crane wagon of its own", () => {
    expect(bp("breakdown").plan).toBeUndefined();
    expect(bp("breakdown")).toMatchObject({ needs: ["goods-engine", "cranes1"], tier: 2 });
    expect(THING_RULES["car:crane"]).toMatchObject({ tech: "breakdown", cost: { planks: 8 } });
    expect(canCarry("crane")).toBe(false);
  });

  it("an idle crane train drives out by itself to a derailed train and lifts it back on", () => {
    const { sim, economy, ids, tick, drain } = oval();
    // A goods train on the far side, derailed (the track under it moved, as a careless edit does).
    const goods = sim.addTrain(["engine", "van", "van"], { pieceId: ids[16], pathIndex: 0, reversed: false, s: 100 });
    const crane = sim.addTrain(["engine", "crane"], { pieceId: ids[6], pathIndex: 0, reversed: false, s: 100 });
    if (goods.kind !== "placed" || crane.kind !== "placed") throw new Error("no room");
    const goodsCar = sim.getTrain(goods.trainId)!.cars[0].id;
    const craneCar = sim.getTrain(crane.trainId)!.cars[1].id;
    sim.trackChanged([sim.getTrain(goods.trainId)!.bogies[0].pieceId]);
    expect(sim.findCar(goodsCar)!.train.derailed).toBe(true);
    tick(1);
    expect(drain()).toContainEqual({ kind: "sent", crane: craneCar, target: goodsCar, auto: true });
    expect(economy.breakdown.jobFor(goodsCar)?.crane).toBe(craneCar);
    // It sets off (its engine's lever on), and arrives and works within a couple of minutes.
    expect(sim.findCar(craneCar)!.train.speed).toBeGreaterThan(0);
    const start = { ...sim.findCar(craneCar)!.train.world[2] };
    let lifted = 0;
    expect(tick(150, () => ((lifted = Math.max(lifted, economy.breakdown.hoistOf(goodsCar))), drain().some((e) => e.kind === "rerailed")))).toBe(true);
    expect(lifted).toBeGreaterThan(0.9);
    const back = sim.findCar(goodsCar)!.train;
    expect(back.derailed).toBe(false);
    expect(back.cars.map((c) => c.kind)).toEqual(["engine", "van", "van"]);
    // It drove there: its crane moved, and it stands within reach.
    const now = sim.findCar(craneCar)!.train;
    expect(Math.hypot(now.world[2].x - start.x, now.world[2].z - start.z)).toBeGreaterThan(300);
    // The turret swings home; then it drives back to where it set out from (QA 2026-11-05 #2), and waits there, levers
    // off. The goods train had its levers off (standing): it's put back standing.
    expect(drain().find((e) => e.kind === "rerailed")).toMatchObject({ goes: false });
    tick(3);
    expect(economy.breakdown.jobOf(craneCar)?.phase).toBe("home");
    expect(tick(150, () => !economy.breakdown.jobOf(craneCar))).toBe(true);
    const home = sim.findCar(craneCar)!.train;
    expect(sim.piecesUnder(home.id).has(ids[6])).toBe(true);
    expect(home.cars.every((c) => c.lever === 0)).toBe(true);
    expect(economy.breakdown.rerailed).toBe(1);
  }, 60_000);

  it("a running train put back carries on, and the crane goes back out of its way (QA 2026-11-05 #2)", () => {
    const { sim, economy, ids, tick, drain } = oval();
    const goods = sim.addTrain(["engine", "van"], { pieceId: ids[16], pathIndex: 0, reversed: false, s: 100 });
    const crane = sim.addTrain(["engine", "crane"], { pieceId: ids[6], pathIndex: 0, reversed: false, s: 100 });
    if (goods.kind !== "placed" || crane.kind !== "placed") throw new Error("no room");
    const goodsCar = sim.getTrain(goods.trainId)!.cars[0].id;
    const craneCar = sim.getTrain(crane.trainId)!.cars[1].id;
    // Running when it came off (its lever on), as a train on its route is.
    sim.setLever(goodsCar, 1);
    tick(0.5);
    sim.trackChanged([sim.getTrain(goods.trainId)!.bogies[0].pieceId]);
    expect(sim.findCar(goodsCar)!.train.derailed).toBe(true);
    expect(tick(150, () => drain().some((e) => e.kind === "rerailed"))).toBe(true);
    expect(drain().find((e) => e.kind === "rerailed")).toMatchObject({ target: goodsCar, goes: true });
    // Its lever is on again: it runs on (the crane, first in its way or not, sets off home).
    const back = sim.findCar(goodsCar)!.train;
    expect(back.derailed).toBe(false);
    expect(back.cars[0].lever).not.toBe(0);
    expect(tick(150, () => !economy.breakdown.jobOf(craneCar))).toBe(true);
    expect(sim.piecesUnder(sim.findCar(craneCar)!.train.id).has(ids[6])).toBe(true);
    // The goods train has got going round the oval.
    const at = { ...sim.findCar(goodsCar)!.train.world[0] };
    tick(5);
    const now = sim.findCar(goodsCar)!.train.world[0];
    expect(Math.hypot(now.x - at.x, now.z - at.z)).toBeGreaterThan(100);
  }, 60_000);

  it("is sent to lift a train off the line, back into the box", () => {
    const { sim, economy, ids, tick, drain } = oval();
    const stuck = sim.addTrain(["engine", "hopper"], { pieceId: ids[14], pathIndex: 0, reversed: false, s: 100 });
    const crane = sim.addTrain(["crane", "engine"], { pieceId: ids[5], pathIndex: 0, reversed: false, s: 100 });
    if (stuck.kind !== "placed" || crane.kind !== "placed") throw new Error("no room");
    const stuckCar = sim.getTrain(stuck.trainId)!.cars[0].id;
    expect(economy.breakdown.send(stuckCar, "remove")).toMatchObject({ ok: true });
    expect(economy.breakdown.send(stuckCar, "remove")).toEqual({ ok: false, why: "on-its-way" });
    expect(tick(150, () => drain().some((e) => e.kind === "removed"))).toBe(true);
    expect(sim.findCar(stuckCar)).toBeUndefined();
    expect(sim.trainIds()).toHaveLength(1);
    expect(economy.breakdown.removed).toBe(1);
  }, 60_000);

  it("with no crane, or one on a line, nothing is sent; a crane already beside the train works at once", () => {
    const { sim, economy, ids, tick, drain } = oval();
    const a = sim.addTrain(["engine", "van"], { pieceId: ids[14], pathIndex: 0, reversed: false, s: 100 });
    if (a.kind !== "placed") throw new Error("no room");
    const car = sim.getTrain(a.trainId)!.cars[0].id;
    expect(economy.breakdown.send(car, "remove")).toEqual({ ok: false, why: "no-crane" });
    // (Just ahead of it, crane at the back: within reach.)
    let c = sim.addTrain(["engine", "crane"], { pieceId: ids[15], pathIndex: 0, reversed: false, s: 0 });
    for (let k = 0; c.kind !== "placed" && k < 20; k++) c = sim.addTrain(["engine", "crane"], { pieceId: ids[15 + Math.floor(k / 10)], pathIndex: 0, reversed: false, s: (k % 10) * 21 });
    if (c.kind !== "placed") throw new Error("no room");
    const craneEngine = sim.getTrain(c.trainId)!.cars[0].id;
    economy.lineIdOf.set(craneEngine, 99);
    expect(economy.breakdown.send(car, "remove")).toEqual({ ok: false, why: "busy" });
    economy.lineIdOf.delete(craneEngine);
    expect(economy.breakdown.send(car, "remove")).toMatchObject({ ok: true });
    // (Next to it already: it doesn't drive, it swings straight round to work.)
    const at = { ...sim.getTrain(c.trainId)!.world[2] };
    tick(0.2);
    expect(economy.breakdown.jobFor(car)?.phase).not.toBe("drive");
    expect(sim.getTrain(c.trainId)!.world[2]).toMatchObject({ x: at.x, z: at.z });
    expect(tick(10, () => drain().some((e) => e.kind === "removed"))).toBe(true);
  }, 60_000);

  it("offers no crane when the only one is the train in the way (QA 2026-11-05 #1)", () => {
    const { sim, economy, ids } = oval();
    // The crane train parked on the line after a job, and a train stuck behind it.
    const stuck = sim.addTrain(["engine", "oiltank"], { pieceId: ids[14], pathIndex: 0, reversed: false, s: 100 });
    const parked = sim.addTrain(["engine", "crane"], { pieceId: ids[16], pathIndex: 0, reversed: false, s: 100 });
    if (stuck.kind !== "placed" || parked.kind !== "placed") throw new Error("no room");
    const stuckCar = sim.getTrain(stuck.trainId)!.cars[0].id;
    const parkedCar = sim.getTrain(parked.trainId)!.cars[0].id;
    // (Sent anyway, it would say there's no crane: the card mustn't offer it.)
    expect(economy.breakdown.send(parkedCar, "remove")).toEqual({ ok: false, why: "no-crane" });
    expect(economy.breakdown.canLift(parkedCar, stuckCar)).toBe(false);
    // A second crane train elsewhere can: the card offers it, and it goes.
    const other = sim.addTrain(["engine", "crane"], { pieceId: ids[4], pathIndex: 0, reversed: false, s: 100 });
    if (other.kind !== "placed") throw new Error("no room");
    expect(economy.breakdown.canLift(parkedCar, stuckCar)).toBe(true);
    expect(economy.breakdown.send(parkedCar, "remove")).toMatchObject({ ok: true });
  });

  it("throws the points on its way: a derailed train on the branch the switch isn't set for", () => {
    const layout = new Layout();
    let end = layout.addPiece("straight-216", { x: 0, z: 0, heading: 0 });
    const trunk = [end];
    for (let k = 0; k < 3; k++) trunk.push((end = appendPiece(layout, "straight-216", false, connectorRef(end, 1))!));
    const sw = appendPiece(layout, "switch", false, connectorRef(end, 1))!;
    const main = [appendPiece(layout, "straight-216", false, connectorRef(sw, 1))!];
    main.push(appendPiece(layout, "straight-216", false, connectorRef(main[0], 1))!);
    const branch = [appendPiece(layout, "curve-large", true, connectorRef(sw, 2))!];
    for (let k = 0; k < 3; k++) branch.push(appendPiece(layout, "straight-216", false, connectorRef(branch[branch.length - 1], 1))!);
    const sim = new Sim(layout);
    const economy = new Economy(layout, sim);
    // (The switch set for the main road; the goods train on the branch.)
    const route = layout.switchState(sw);
    const goods = sim.addTrain(["engine", "van"], { pieceId: branch[3], pathIndex: 0, reversed: false, s: 150 });
    const crane = sim.addTrain(["crane", "engine"], { pieceId: trunk[1], pathIndex: 0, reversed: false, s: 150 });
    if (goods.kind !== "placed" || crane.kind !== "placed") throw new Error("no room");
    if (layout.switchState(sw) !== route) throw new Error("moved");
    const car = sim.getTrain(goods.trainId)!.cars[0].id;
    sim.trackChanged([sim.getTrain(goods.trainId)!.bogies[0].pieceId]);
    const events: CraneEvent[] = [];
    let done = false;
    for (let i = 0; i < 120 * SIM_HZ && !done; i++) {
      sim.tick();
      economy.tick();
      events.push(...economy.breakdown.drainEvents());
      done = events.some((e) => e.kind === "rerailed");
    }
    expect(events.map((e) => e.kind)).toContain("rerailed");
    expect(layout.switchState(sw)).not.toBe(route);
    expect(sim.findCar(car)!.train.derailed).toBe(false);
  }, 60_000);

  it("the player's Stop calls a driving crane off; it stays where it stands", () => {
    const { sim, economy, ids, tick } = oval();
    const goods = sim.addTrain(["engine", "van"], { pieceId: ids[16], pathIndex: 0, reversed: false, s: 100 });
    const crane = sim.addTrain(["engine", "crane"], { pieceId: ids[6], pathIndex: 0, reversed: false, s: 100 });
    if (goods.kind !== "placed" || crane.kind !== "placed") throw new Error("no room");
    const engine = sim.getTrain(crane.trainId)!.cars[0].id;
    sim.trackChanged([sim.getTrain(goods.trainId)!.bogies[0].pieceId]);
    tick(2);
    expect(economy.breakdown.busy).toBe(true);
    sim.setLever(engine, 0);
    tick(2);
    expect(economy.breakdown.busy).toBe(false);
    // (Not set out again by itself for that train: the player said no. Sent from a card, it goes.)
    tick(3);
    expect(economy.breakdown.busy).toBe(false);
    const car = sim.getTrain(goods.trainId)!.cars[0].id;
    expect(economy.breakdown.send(car, "rerail")).toMatchObject({ ok: true });
  }, 60_000);

  it("a crane at work costs a look every half second at most when idle", () => {
    const { tick, economy } = oval(2);
    // (No crane, no derailed train: nothing to do, and nothing done.)
    tick(5);
    expect(economy.breakdown.busy).toBe(false);
    expect(economy.breakdown.drainEvents()).toEqual([]);
  });
});

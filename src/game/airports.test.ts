import { describe, expect, it } from "vitest";
import { AIRPORT_LOUNGE, Economy } from "../economy";
import { deserializeWorld, serializeWorld } from "../persist/save";
import { Sim, SIM_HZ, type CarKind } from "../sim";
import { appendPiece, connectorRef, getPieceDef, Layout, type PieceTypeId } from "../track";
import { AIRPORT_FARE, Airports, FIRST_PLANE, land, phaseAt, PLANE_EVERY, PLANE_FLIGHT, PLANE_PARKED, PLANE_SEATS, PLANE_VISITORS, planePose, VISITOR_BONUS, VISITORS_CAP } from "./airports";
import { BLUEPRINTS } from "./blueprints";
import { attachPassengers, fareFor } from "./passengers";
import { Progress } from "./progress";
import { THING_RULES } from "./things";
import { buildStarterWorld, INDUSTRY_ROLE, STATION_CRANE_AT, type World } from "./world";

function lay(layout: Layout, ref: number, type: PieceTypeId): number {
  const end = layout.worldConnector(ref, { x: 0, z: 0, heading: 0, y: 0, kind: "peg" });
  const via = getPieceDef(type, false).connectors.findIndex((c) => c.kind !== end.kind);
  return appendPiece(layout, type, false, ref, via);
}
const otherEnd = (layout: Layout, id: number) => [0, 1].map((k) => connectorRef(id, k)).find((r) => layout.joinedConnector(r) === -1)!;
function endAt(layout: Layout, ref: number): void {
  const end = layout.worldConnector(ref, { x: 0, z: 0, heading: 0, y: 0, kind: "peg" });
  lay(layout, end.kind === "peg" ? ref : otherEnd(layout, lay(layout, ref, "adapter-peg")), "buffer-turnback");
}

/** A town's station and an airport joined by a few straights, a turnback past each; a coach train between, for the airport. */
function line(cars: CarKind[] = ["passenger", "engine"]) {
  const layout = new Layout();
  const a = layout.addPiece("station", { x: 0, z: 0, heading: 0 });
  endAt(layout, connectorRef(a, 0));
  let last = a;
  const straights: number[] = [];
  for (let i = 0; i < 4; i++) straights.push((last = lay(layout, i === 0 ? connectorRef(a, 1) : otherEnd(layout, last), "straight-216")));
  const b = lay(layout, otherEnd(layout, last), "depot-airport");
  endAt(layout, otherEnd(layout, b));
  const sim = new Sim(layout);
  const placed = sim.addTrain(cars, { pieceId: straights[0], pathIndex: 0, reversed: false, s: 150 });
  if (placed.kind !== "placed") throw new Error("no room");
  const economy = new Economy(layout, sim);
  const town = economy.addDepot("town", a, 0, STATION_CRANE_AT);
  const airport = economy.addDepot("airport", b);
  const w = { layout, sim, economy } as unknown as World;
  const train = () => sim.getTrain(sim.trainIds()[0])!;
  const car = (kind: CarKind) => train().cars.find((c) => c.kind === kind)!;
  sim.setLever(car("engine").id, 1);
  const run = (seconds: number) => {
    for (let i = 0; i < seconds * SIM_HZ; i++) {
      sim.tick();
      economy.tick();
    }
  };
  return { w, sim, economy, town, airport, car, run };
}

describe("a plane's visit", () => {
  it("flies in, stands on the apron, flies out, then is away till the next", () => {
    expect(phaseAt(-PLANE_FLIGHT - 1).kind).toBe("away");
    expect(phaseAt(-PLANE_FLIGHT / 2)).toEqual({ kind: "in", u: 0.5 });
    expect(phaseAt(1).kind).toBe("parked");
    expect(phaseAt(PLANE_PARKED + PLANE_FLIGHT / 2)).toEqual({ kind: "out", u: 0.5 });
    expect(phaseAt(PLANE_PARKED + PLANE_FLIGHT + 1).kind).toBe("away");
    expect(phaseAt(PLANE_EVERY - PLANE_FLIGHT / 2)).toEqual({ kind: "in", u: 0.5 });
    // (A frame's time past a landing.)
    expect(phaseAt(PLANE_EVERY + 1).kind).toBe("parked");
  });

  it("comes in along the airport's line from far off and high, and stands on the apron", () => {
    const pose = { x: 0, z: 0, heading: 0 };
    const far = planePose(pose, 0, { kind: "in", u: 0 })!;
    const parked = planePose(pose, 0, { kind: "parked" })!;
    expect(far.y).toBeGreaterThan(400);
    expect(far.x - parked.x).toBeGreaterThan(2000);
    expect(parked.y).toBe(0);
    expect(planePose(pose, 0, { kind: "away" })).toBeNull();
  });

  it("takes the lounge (paying each) and leaves visitors, each up to its limit", () => {
    const { airport } = line();
    const p = Progress.fresh();
    airport.flyers = AIRPORT_LOUNGE;
    const v = land(airport, p);
    expect(v.flew).toBe(PLANE_SEATS);
    expect(airport.flyers).toBe(AIRPORT_LOUNGE - PLANE_SEATS);
    expect(p.coins).toBe(PLANE_SEATS * AIRPORT_FARE);
    expect(airport.waiting).toBe(PLANE_VISITORS);
    airport.waiting = VISITORS_CAP - 2;
    expect(land(airport, p).visitors).toBe(2);
    expect(airport.waiting).toBe(VISITORS_CAP);
  });

  it("a new airport's first plane lands soon, then one every few minutes, by the game's clock", () => {
    const { w, airport } = line();
    const p = Progress.fresh();
    const planes = new Airports();
    expect(planes.update(w, p, 0)).toEqual([]);
    expect(planes.nextIn(airport.id)).toBe(FIRST_PLANE);
    expect(planes.update(w, p, FIRST_PLANE - 1)).toEqual([]);
    expect(planes.update(w, p, FIRST_PLANE)).toHaveLength(1);
    expect(airport.waiting).toBe(PLANE_VISITORS);
    expect(planes.update(w, p, FIRST_PLANE + PLANE_EVERY - 1)).toEqual([]);
    expect(planes.update(w, p, FIRST_PLANE + PLANE_EVERY)).toHaveLength(1);
  });
});

describe("riders and the airport", () => {
  it("riders a train brings get off into the lounge (paying nothing yet), and fly with the next plane", () => {
    const { w, economy, town, airport, car, run } = line();
    const p = Progress.fresh();
    attachPassengers(w, () => p);
    // Riders from the town: the coach (at the back) passes the station first going back, so fill it there.
    town.waiting = 4;
    const coach = car("passenger").id;
    economy.setRiders(coach, 4, town.id);
    run(20);
    expect(airport.flyers).toBe(4);
    expect(p.coins).toBe(0);
    expect(p.riders).toBe(4);
    land(airport, p);
    expect(p.coins).toBe(4 * AIRPORT_FARE);
    expect(airport.flyers).toBe(0);
  });

  it("no one gets off into a full lounge", () => {
    const { w, economy, town, airport, car, run } = line();
    const p = Progress.fresh();
    attachPassengers(w, () => p);
    airport.flyers = AIRPORT_LOUNGE;
    const coach = car("passenger").id;
    economy.setRiders(coach, 4, town.id);
    run(20);
    expect(economy.ridersOf(coach).count).toBe(4);
    expect(airport.flyers).toBe(AIRPORT_LOUNGE);
  });

  it("visitors off a plane get on a coach there, and pay half as much again where they get off", () => {
    const { w, economy, town, airport, car, run } = line();
    const p = Progress.fresh();
    attachPassengers(w, () => p);
    airport.waiting = 4;
    const coach = car("passenger").id;
    run(15);
    expect(economy.ridersOf(coach)).toEqual({ count: 4, from: airport.id });
    run(40);
    expect(economy.ridersOf(coach).count).toBe(0);
    const fare = fareFor(w, airport, town, coach);
    const plain = fareFor(w, { ...airport, role: "town" }, town, coach);
    expect(fare).toBe(Math.round(plain * VISITOR_BONUS));
    expect(p.coins).toBe(4 * fare);
  });
});

describe("the airport in the game", () => {
  it("is a blueprint after Electricity and Harbours and 400 riders, made at the workshop, an industry of its own", () => {
    const b = BLUEPRINTS.find((x) => x.id === "airport")!;
    expect(b).toBeDefined();
    expect(b.needs).toEqual(["electricity", "harbours"]);
    expect(b.requires).toContainEqual({ kind: "count", stat: "riders", n: 400 });
    expect(THING_RULES["piece:depot-airport"]?.tech).toBe("airport");
    expect(INDUSTRY_ROLE["depot-airport"]).toBe("airport");
  });

  it("keeps its lounge and its visitors in the save", () => {
    const w = buildStarterWorld();
    const at = w.layout.addPiece("depot-airport", { x: 9000, z: 9000, heading: 0 });
    const d = w.economy.addDepot("airport", at);
    d.flyers = 5;
    d.waiting = 3;
    const r = deserializeWorld(JSON.parse(JSON.stringify(serializeWorld(w))));
    if (!r.ok) throw new Error(r.error);
    const back = r.value.economy.allDepots().find((x) => x.role === "airport")!;
    expect([back.flyers, back.waiting]).toEqual([5, 3]);
  });
});

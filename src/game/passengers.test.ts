import { describe, expect, it } from "vitest";
import { Economy } from "../economy";
import { deserializeWorld, serializeWorld } from "../persist/save";
import { ENGINE_SPEED, Sim, SIM_HZ, type CarKind } from "../sim";
import { appendPiece, connectorRef, getPieceDef, Layout, type PieceTypeId } from "../track";
import { attachPassengers, detachPassengers, EXPRESS, fareFor, peopleArrive, RIDER_SECONDS, SEATS, topSpeed, WAITING_CAP } from "./passengers";
import { Progress } from "./progress";
import { learnByRiders, offerFor, ready, TECHS } from "./tech";
import { buildStarterWorld, STATION_CRANE_AT, type World } from "./world";

/** Lay `type` on free end `ref` (seated by an end of the other kind); returns its id. */
function lay(layout: Layout, ref: number, type: PieceTypeId): number {
  const end = layout.worldConnector(ref, { x: 0, z: 0, heading: 0, y: 0, kind: "peg" });
  const via = getPieceDef(type, false).connectors.findIndex((c) => c.kind !== end.kind);
  return appendPiece(layout, type, false, ref, via);
}
const otherEnd = (layout: Layout, id: number) => [0, 1].map((k) => connectorRef(id, k)).find((r) => layout.joinedConnector(r) === -1)!;
/** A turnback on free end `ref` (through an adapter if the end is a socket, as a turnback's own end is). */
function endAt(layout: Layout, ref: number): void {
  const end = layout.worldConnector(ref, { x: 0, z: 0, heading: 0, y: 0, kind: "peg" });
  lay(layout, end.kind === "peg" ? ref : otherEnd(layout, lay(layout, ref, "adapter-peg")), "buffer-turnback");
}

/**
 * Two towns' stations joined by a few straights, a turnback past each: a train of `cars` stands on the line between,
 * heading for B.
 */
function line(cars: CarKind[] = ["engine", "passenger"]) {
  const layout = new Layout();
  const a = layout.addPiece("station", { x: 0, z: 0, heading: 0 });
  endAt(layout, connectorRef(a, 0));
  let last = a;
  const straights: number[] = [];
  for (let i = 0; i < 4; i++) straights.push((last = lay(layout, i === 0 ? connectorRef(a, 1) : otherEnd(layout, last), "straight-216")));
  const b = lay(layout, otherEnd(layout, last), "station");
  endAt(layout, otherEnd(layout, b));
  const sim = new Sim(layout);
  const placed = sim.addTrain(cars, { pieceId: straights[0], pathIndex: 0, reversed: false, s: 150 });
  if (placed.kind !== "placed") throw new Error("no room");
  const economy = new Economy(layout, sim);
  const A = economy.addDepot("town", a, 0, STATION_CRANE_AT);
  const B = economy.addDepot("town", b, 1, STATION_CRANE_AT);
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
  return { w, sim, economy, A, B, train, car, run };
}

describe("passengers", () => {
  it("people wait at a station, more often in a bigger town, up to a few", () => {
    const { w, A } = line();
    const p = Progress.fresh();
    const clock = new Map<number, number>();
    // Not before coaches are known.
    peopleArrive(w, p, RIDER_SECONDS * 2, clock);
    expect(A.waiting).toBe(0);
    p.learned.add("passengers");
    peopleArrive(w, p, RIDER_SECONDS - 1, clock);
    expect(A.waiting).toBe(0);
    peopleArrive(w, p, 1, clock);
    expect(A.waiting).toBe(1);
    peopleArrive(w, p, RIDER_SECONDS * 20, clock);
    expect(A.waiting).toBe(WAITING_CAP);
    // Busy stations: twice as often, and twice as many can wait.
    p.learned.add("stations");
    A.waiting = 0;
    peopleArrive(w, p, RIDER_SECONDS / 2, clock);
    expect(A.waiting).toBe(1);
    peopleArrive(w, p, RIDER_SECONDS * 20, clock);
    expect(A.waiting).toBe(WAITING_CAP * 2);
  });

  it("a coach takes them to the next town, where they pay a fare by how far they came", () => {
    const { w, economy, A, B, car, run } = line(["passenger", "engine"]);
    const p = Progress.fresh();
    attachPassengers(w, () => p);
    B.waiting = 6;
    const coach = car("passenger").id;
    // On to B: it stops, its seats fill from B's platform.
    run(15);
    expect(economy.ridersOf(coach)).toEqual({ count: SEATS.classic!, from: B.id });
    expect(B.waiting).toBe(6 - SEATS.classic!);
    // Back to A (turned back past B): they get off and pay.
    run(40);
    expect(p.riders).toBe(SEATS.classic);
    const fare = fareFor(w, B, A, coach);
    expect(fare).toBeGreaterThanOrEqual(1);
    expect(p.coins).toBe(SEATS.classic! * fare);
  });

  it("in Sandbox coaches carry no one, and trains don't stop for them", () => {
    const { w, economy, B, car, train, run } = line(["passenger", "engine"]);
    B.waiting = 6;
    detachPassengers(w);
    let stopped = 0;
    for (let i = 0; i < 15; i++) {
      run(1);
      if (train().speed === 0) stopped++;
    }
    expect(economy.ridersOf(car("passenger").id).count).toBe(0);
    expect(B.waiting).toBe(6);
    expect(stopped).toBeLessThan(3);
  });

  it("a first-class coach pays double, and a dining car on the train half as much again", () => {
    const { w, sim, A, B, car } = line(["engine", "passenger", "passenger"]);
    const [c1, c2] = sim.getTrain(sim.trainIds()[0])!.cars.filter((c) => c.kind === "passenger");
    const plain = fareFor(w, A, B, c1.id);
    sim.setLook(c1.id, "first-class");
    expect(fareFor(w, A, B, c1.id)).toBe(Math.round(plain * 2));
    sim.setLook(c2.id, "dining");
    expect(fareFor(w, A, B, c1.id)).toBe(Math.round(plain * 2 * 1.5));
    void car;
  });

  it("an express engine runs half as fast again, once learned", () => {
    const { w, sim, train, car } = line();
    const p = Progress.fresh();
    sim.setLook(car("engine").id, "express");
    expect(topSpeed(w, p, train())).toBe(ENGINE_SPEED);
    p.learned.add("express");
    expect(topSpeed(w, p, train())).toBe(ENGINE_SPEED * EXPRESS);
  });

  it("riders and people waiting are saved", () => {
    const w = buildStarterWorld();
    const [a, b] = w.landscape.towns;
    const A = w.economy.depotAtPiece(w.stations.get(a.id)!)!;
    const B = w.economy.depotAtPiece(w.stations.get(b.id)!)!;
    let last = w.stations.get(a.id)!;
    for (let i = 0; i < 3; i++) last = appendPiece(w.layout, "straight-216", false, connectorRef(last, 1));
    const placed = w.sim.addTrain(["engine", "passenger", "hopper"], { pieceId: last, pathIndex: 0, reversed: false, s: 200 });
    if (placed.kind !== "placed") throw new Error("no room");
    const [, coach, hopper] = w.sim.getTrain(placed.trainId)!.cars;
    w.economy.setRiders(coach.id, 3, B.id);
    w.economy.setCargo(hopper.id, "grain", 2);
    A.waiting = 5;
    const back = deserializeWorld(JSON.parse(JSON.stringify(serializeWorld(w))));
    expect(back.ok).toBe(true);
    if (!back.ok) return;
    const e = back.value.economy;
    const cars = back.value.sim.getTrain(back.value.sim.trainIds()[0])!.cars;
    expect(e.ridersOf(cars[1].id)).toEqual({ count: 3, from: B.id });
    // (A hopper's grain comes back too, not just a timber wagon's load.)
    expect(e.cargoOf(cars[2].id)).toEqual({ kind: "grain", count: 2 });
    expect(e.depot(A.id)!.waiting).toBe(5);
  });
});

describe("the passenger line of blueprints", () => {
  it("is learned by itself as you carry more people, in order, and never offered by a town", () => {
    const line = TECHS.filter((t) => t.riders !== undefined);
    expect(line.map((t) => t.id)).toEqual(["dining", "first-class", "stations", "double-decker", "express"]);
    const p = Progress.fresh();
    p.riders = 500;
    expect(learnByRiders(p)).toEqual([]);
    p.learned.add("passengers");
    p.riders = 70;
    expect(learnByRiders(p)).toEqual(["dining", "first-class"]);
    expect(ready(p, "stations")).toBe(false);
    for (let i = 0; i < 20; i++) for (const id of offerFor(p, Math.random)) expect(line.some((t) => t.id === id)).toBe(false);
  });
});

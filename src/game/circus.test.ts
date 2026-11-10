import { describe, expect, it } from "vitest";
import { Economy } from "../economy";
import { Sim, SIM_HZ, type CarKind } from "../sim";
import { appendPiece, connectorRef, getPieceDef, Layout, type PieceTypeId } from "../track";
import { BLUEPRINTS } from "./blueprints";
import { bigTopSpot, CIRCUS_FARE, CIRCUS_RIDERS, CIRCUS_SECONDS, circusFare, circusStop, circusTick } from "./circus";
import { crateFor, learnGift } from "./rewards";
import { attachPassengers, fareFor, peopleArrive, RIDER_SECONDS } from "./passengers";
import { Progress } from "./progress";
import { isGift, THING_RULES } from "./things";
import { buildStarterWorld, STATION_CRANE_AT, type World } from "./world";

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

/** Two towns' stations on a line, a train of `cars` between them heading for B. */
function line(cars: CarKind[]) {
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
  return { w, sim, economy, A, B, car, run };
}

describe("the circus train", () => {
  it("is earned, never bought: learning Circus gives two cages once, and the workshop and cards never offer one", () => {
    const b = BLUEPRINTS.find((x) => x.id === "circus")!;
    expect(b).toBeDefined();
    expect(BLUEPRINTS.some((x) => x.id === "circus-train")).toBe(false);
    expect(isGift("car:cage")).toBe(true);
    expect(THING_RULES["car:cage"]?.tech).toBe("circus");
    const p = Progress.fresh();
    expect(learnGift(p, "circus")).toEqual([["car:cage", 2]]);
    expect(p.owned.get("car:cage")).toBe(2);
    expect(learnGift(p, "circus")).toEqual([]);
    p.learned.add("circus");
    for (let i = 0; i < 50; i++) expect(crateFor(p, 3, Math.random).map(([id]) => id)).not.toContain("car:cage");
  });

  it("standing at a town's station, a train with a cage puts the big top up there; three months later it closes", () => {
    const { w, A, B, run } = line(["cage", "engine"]);
    const p = Progress.fresh();
    let up = 0;
    let down = 0;
    // (On its way to B: passing through counts.)
    for (let k = 0; k < 40 && circusStop(w)?.id !== B.id; k++) run(0.5);
    expect(circusStop(w)?.id).toBe(B.id);
    const opened = circusTick(w, p, 1, () => ++up, () => down++);
    expect(opened).toEqual([{ kind: "opened", town: B.townId }]);
    expect(p.circus).toEqual({ town: B.townId, left: CIRCUS_SECONDS, prop: 1 });
    expect(p.circusTowns.has(B.townId)).toBe(true);
    // Still standing there: nothing new.
    expect(circusTick(w, p, 1, () => ++up, () => down++)).toEqual([]);
    expect(circusTick(w, p, CIRCUS_SECONDS, () => ++up, () => down++)).toEqual([{ kind: "closed", town: B.townId }]);
    expect([p.circus, p.circusLast, down]).toEqual([null, B.townId, 1]);
    // It moves on: not the same town twice running.
    expect(circusTick(w, p, 1, () => ++up, () => down++)).toEqual([]);
    void A;
  });

  it("a train without a cage is no circus", () => {
    const { w, run } = line(["passenger", "engine"]);
    run(15);
    expect(circusStop(w)).toBeNull();
  });
});

describe("the show's payoff", () => {
  it("riders to the circus's town pay double; elsewhere as before", () => {
    const { w, A, B, car, run } = line(["passenger", "cage", "engine"]);
    const p = Progress.fresh();
    attachPassengers(w, () => p);
    p.circus = { town: A.townId, left: CIRCUS_SECONDS, prop: -1 };
    expect(circusFare(p, A)).toBe(CIRCUS_FARE);
    expect(circusFare(p, B)).toBe(1);
    B.waiting = 4;
    const coach = car("passenger").id;
    run(15);
    expect(w.economy.ridersOf(coach).count).toBe(4);
    run(40);
    expect(p.coins).toBe(4 * fareFor(w, B, A, coach) * CIRCUS_FARE);
  });

  it("the circus's town's people come twice as often", () => {
    const { w, A } = line(["engine"]);
    const p = Progress.fresh();
    p.learned.add("passengers");
    p.circus = { town: A.townId, left: CIRCUS_SECONDS, prop: -1 };
    const clock = new Map<number, number>();
    peopleArrive(w, p, RIDER_SECONDS / CIRCUS_RIDERS, clock);
    expect(A.waiting).toBe(1);
  });

  it("finds room for the big top near a town's station, on clear land", () => {
    const w = buildStarterWorld();
    const station = w.layout.getPiece(w.stations.get(w.landscape.towns[0].id)!)!;
    const spot = bigTopSpot(w, station.pose, { cx: 0, cz: 0, hw: 70, hd: 70 }, () => undefined);
    expect(spot).not.toBeNull();
    expect(Math.hypot(spot!.x - station.pose.x, spot!.z - station.pose.z)).toBeLessThan(700);
  });

  it("is saved with the game's progress", () => {
    const p = Progress.fresh();
    p.circus = { town: 2, left: 100, prop: 7 };
    p.circusLast = 1;
    p.circusTowns.add(1).add(2);
    const back = Progress.fromJSON(JSON.parse(JSON.stringify(p.toJSON())));
    expect([back.circus, back.circusLast, [...back.circusTowns]]).toEqual([{ town: 2, left: 100, prop: 7 }, 1, [1, 2]]);
  });
});

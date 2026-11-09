import { describe, expect, it } from "vitest";
import { Economy } from "../economy";
import { Sim, SIM_HZ, type CarKind } from "../sim";
import { appendPiece, connectorRef, getPieceDef, Layout, RISER_HEIGHT, type PieceTypeId } from "../track";
import { CELL } from "../landscape/grid";
import { attachPassengers, fareFor, isView, noteViews, OBSERVATION, peopleArrive, SEATS, SLEEPER, SLEEPER_TRIP } from "./passengers";
import { Progress } from "./progress";
import { LOOK_TECH } from "./things";
import { BLUEPRINTS } from "./blueprints";
import { STATION_CRANE_AT, type World } from "./world";

function lay(layout: Layout, ref: number, type: PieceTypeId): number {
  const end = layout.worldConnector(ref, { x: 0, z: 0, heading: 0, y: 0, kind: "peg" });
  const via = getPieceDef(type, false).connectors.findIndex((c) => c.kind !== end.kind);
  return appendPiece(layout, type, false, ref, via);
}
const otherEnd = (layout: Layout, id: number) => [0, 1].map((k) => connectorRef(id, k)).find((r) => layout.joinedConnector(r) === -1)!;

/** Two towns' stations `straights` × 216 apart (a bridge for the `bridge`th straight, if given), a train heading for B. */
function line(cars: CarKind[], straights = 4, bridge = -1) {
  const layout = new Layout();
  const a = layout.addPiece("station", { x: 0, z: 0, heading: 0 });
  let last = a;
  const ids: number[] = [];
  for (let i = 0; i < straights; i++) ids.push((last = lay(layout, i === 0 ? connectorRef(a, 1) : otherEnd(layout, last), i === bridge ? "bridge" : "straight-216")));
  const b = lay(layout, otherEnd(layout, last), "station");
  const sim = new Sim(layout);
  const placed = sim.addTrain(cars, { pieceId: ids[0], pathIndex: 0, reversed: false, s: 200 });
  if (placed.kind !== "placed") throw new Error("no room");
  const economy = new Economy(layout, sim);
  const A = economy.addDepot("town", a, 0, STATION_CRANE_AT);
  const B = economy.addDepot("town", b, 1, STATION_CRANE_AT);
  const w = { layout, sim, economy } as unknown as World;
  const train = () => sim.getTrain(sim.trainIds()[0])!;
  return { w, sim, economy, layout, A, B, train, ids };
}

describe("Night sleepers", () => {
  it("is learned by riders carried, and gates the sleeper coach", () => {
    const row = BLUEPRINTS.find((b) => b.id === "sleeper")!;
    expect(row).toBeDefined();
    expect(LOOK_TECH.sleeper).toBe("sleeper");
  });

  it("a sleeper's riders pay more on a long trip only", () => {
    const short = line(["engine", "passenger", "passenger"], 4);
    const [s1, s2] = short.train().cars.filter((c) => c.kind === "passenger");
    short.sim.setLook(s1.id, "sleeper");
    // (A short trip: as a plain coach.)
    expect(fareFor(short.w, short.A, short.B, s1.id)).toBe(fareFor(short.w, short.A, short.B, s2.id));
    const n = Math.ceil(SLEEPER_TRIP / 216);
    const far = line(["engine", "passenger", "passenger"], n);
    const [f1, f2] = far.train().cars.filter((c) => c.kind === "passenger");
    far.sim.setLook(f1.id, "sleeper");
    const plain = fareFor(far.w, far.A, far.B, f2.id);
    expect(plain).toBeGreaterThanOrEqual(Math.floor(SLEEPER_TRIP / 800));
    expect(fareFor(far.w, far.A, far.B, f1.id)).toBe(Math.round(plain * SLEEPER));
    expect(SEATS.sleeper).toBe(4);
    expect(SLEEPER_TRIP).toBe(40 * CELL);
  });
});

describe("Observation car", () => {
  it("is a coach with three seats, gated by its blueprint", () => {
    expect(SEATS.observation).toBe(3);
    expect(LOOK_TECH.observation).toBe("observation");
    expect(BLUEPRINTS.find((b) => b.id === "observation")!).toBeDefined();
  });

  it("bridges and hilltop track are views; plain track isn't", () => {
    const { w, ids, layout } = line(["engine", "passenger"], 4, 2);
    expect(isView(w, ids[2])).toBe(true);
    expect(isView(w, ids[0])).toBe(false);
    (layout.getPiece(ids[1])! as { y: number }).y = 2 * RISER_HEIGHT;
    expect(isView(w, ids[1])).toBe(true);
  });

  it("riders carried over a bridge on a train with an observation car pay half as much again, by the player's run", () => {
    const fares = (look: "observation" | "classic", bridge: number) => {
      const l = line(["engine", "passenger", "passenger"], 5, bridge);
      const [, c2] = l.train().cars.filter((c) => c.kind === "passenger");
      l.sim.setLook(c2.id, look);
      const p = Progress.fresh();
      p.learned.add("passengers");
      p.learned.add("observation");
      const paid: number[] = [];
      attachPassengers(l.w, () => p, (fare) => paid.push(fare));
      l.A.waiting = 0;
      const coach = l.train().cars.find((c) => c.kind === "passenger")!;
      l.economy.setRiders(coach.id, 2, l.A.id);
      l.sim.setLever(l.train().cars[0].id, 1);
      const clock = new Map<number, number>();
      for (let s = 0; s < 40 && paid.length < 2; s++) {
        for (let i = 0; i < SIM_HZ; i++) {
          l.sim.tick();
          l.economy.tick();
        }
        peopleArrive(l.w, p, 1, clock);
      }
      return paid;
    };
    const plain = fares("classic", 2);
    expect(plain.length).toBe(2);
    // An observation car, but no bridge: the plain fare.
    expect(fares("observation", -1)).toEqual(plain);
    // Over the bridge with one: half as much again.
    expect(fares("observation", 2)).toEqual(plain.map((f) => Math.round(f * OBSERVATION)));
  });

  it("noteViews looks only at trains with an observation car", () => {
    const { w, economy, train } = line(["engine", "passenger"], 4, 0);
    const coach = train().cars.find((c) => c.kind === "passenger")!;
    economy.setRiders(coach.id, 1, 0);
    noteViews(w);
    expect(economy.ridersOf(coach.id).scenic).toBeFalsy();
    w.sim.setLook(coach.id, "observation");
    noteViews(w);
    expect(economy.ridersOf(coach.id).scenic).toBe(true);
  });
});

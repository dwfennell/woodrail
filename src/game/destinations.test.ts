import { describe, expect, it } from "vitest";
import { ANYWHERE, Economy } from "../economy";
import { savedRiders } from "../persist/save";
import { Sim, SIM_HZ, type CarKind } from "../sim";
import { appendPiece, connectorRef, getPieceDef, Layout, type PieceTypeId } from "../track";
import { attachPassengers, fareFor, placePull, SEATS } from "./passengers";
import { Progress } from "./progress";
import { startLine } from "./lines";
import { buildStarterWorld, STATION_CRANE_AT, type World } from "./world";

/** Passenger destinations (spec 2026-11-15-passenger-destinations.md). */

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

/**
 * Towns A, B and C's stations in a row, two straights between each, a turnback past each end: a train of `cars` on the
 * straight after A, heading for B.
 */
function row(cars: CarKind[] = ["engine", "passenger"]) {
  const layout = new Layout();
  const a = layout.addPiece("station", { x: 0, z: 0, heading: 0 });
  endAt(layout, connectorRef(a, 0));
  const s0 = lay(layout, connectorRef(a, 1), "straight-216");
  let last = lay(layout, otherEnd(layout, s0), "straight-216");
  const b = lay(layout, otherEnd(layout, last), "station");
  last = b;
  for (let i = 0; i < 6; i++) last = lay(layout, otherEnd(layout, last), "straight-216");
  const c = lay(layout, otherEnd(layout, last), "station");
  endAt(layout, otherEnd(layout, c));
  const sim = new Sim(layout);
  const placed = sim.addTrain(cars, { pieceId: s0, pathIndex: 0, reversed: false, s: 150 });
  if (placed.kind !== "placed") throw new Error("no room");
  const economy = new Economy(layout, sim);
  const A = economy.addDepot("town", a, 0, STATION_CRANE_AT);
  const B = economy.addDepot("town", b, 1, STATION_CRANE_AT);
  const C = economy.addDepot("town", c, 2, STATION_CRANE_AT);
  const w = { layout, sim, economy, stations: new Map([[0, a], [1, b], [2, c]]) } as unknown as World;
  const train = () => sim.getTrain(sim.trainIds()[0])!;
  const car = (kind: CarKind) => train().cars.find((x) => x.kind === kind)!;
  sim.setLever(car("engine").id, 1);
  const run = (seconds: number) => {
    for (let i = 0; i < seconds * SIM_HZ; i++) {
      sim.tick();
      economy.tick();
    }
  };
  const route = (...stops: { id: number }[]) => startLine(economy, car("engine").id, stops.map((d) => ({ depotId: d.id, action: "auto" as const })));
  return { w, sim, economy, A, B, C, car, run, route };
}

const counts = (wants: readonly number[], n: number) => {
  const out = new Map<number, number>();
  for (const k of wants.slice(0, n)) out.set(k, (out.get(k) ?? 0) + 1);
  return out;
};

describe("passenger destinations", () => {
  it("with no line to take them, people want anywhere (as before)", () => {
    const { w, economy, A } = row();
    attachPassengers(w, () => Progress.fresh());
    A.waiting = 3;
    economy.refreshReach();
    expect(economy.placesFrom(A)).toEqual([]);
    expect(A.wants).toEqual([ANYWHERE, ANYWHERE, ANYWHERE]);
  });

  it("only places a line with a coach goes to, dealt by pull, not by nearness", () => {
    const { w, economy, A, B, C, route } = row();
    attachPassengers(w, () => Progress.fresh());
    route(A, B, C);
    // C draws three times as many as B (a far city against a near hamlet).
    economy.pullOf = (k) => (k === C.townId ? 3 : 1);
    A.waiting = 8;
    economy.refreshReach();
    expect([...economy.placesFrom(A)].sort()).toEqual([B.townId, C.townId]);
    const by = counts(A.wants, 8);
    expect(by.get(C.townId)).toBe(6);
    expect(by.get(B.townId)).toBe(2);
    // No one at A wants A.
    expect(by.has(A.townId)).toBe(false);
  });

  it("a line that goes only to B: A's people all want B", () => {
    const { w, economy, A, B, route } = row();
    attachPassengers(w, () => Progress.fresh());
    route(A, B);
    A.waiting = 4;
    economy.refreshReach();
    expect(A.wants).toEqual([B.townId, B.townId, B.townId, B.townId]);
  });

  it("a goods train's line doesn't count: no seats, no one waits for it", () => {
    const { w, economy, A, B, route } = row(["engine", "timber"]);
    attachPassengers(w, () => Progress.fresh());
    route(A, B);
    A.waiting = 2;
    economy.refreshReach();
    expect(A.wants).toEqual([ANYWHERE, ANYWHERE]);
  });

  it("riders for C stay aboard past B, get off at C, and pay the whole trip's fare", () => {
    const { w, economy, A, B, C, car, run, route } = row();
    const p = Progress.fresh();
    attachPassengers(w, () => p);
    route(A, B, C);
    A.waiting = 4;
    economy.refreshReach();
    // (Equal pull: two each.)
    expect(counts(A.wants, 4).get(C.townId)).toBe(2);
    const coach = car("passenger").id;
    // Back to A (the turnback past it), all four on, then B: two get off there, two ride on.
    let fares = 0;
    economy.onAlight = ((pay) => (from, to, id) => {
      fares += fareFor(w, from, to, id);
      pay?.(from, to, id);
    })(economy.onAlight);
    for (let s = 0; s < 120 && economy.ridersOf(coach).count < 4; s++) run(1);
    expect(economy.ridersOf(coach).count).toBe(4);
    for (let s = 0; s < 120 && p.riders < 2; s++) run(1);
    expect(p.riders).toBe(2);
    expect(economy.ridersOf(coach).count).toBe(2);
    expect([...economy.ridersByPlace(coach)]).toEqual([[C.townId, 2]]);
    for (let s = 0; s < 120 && p.riders < 4; s++) run(1);
    expect(p.riders).toBe(4);
    const toB = fareFor(w, A, B, coach);
    const toC = fareFor(w, A, C, coach);
    expect(toC).toBeGreaterThan(toB);
    expect(fares).toBe(2 * toB + 2 * toC);
    expect(p.coins).toBe(2 * toB + 2 * toC);
  });

  it("a coach takes only people its line goes to, and mixes riders from different stops", () => {
    const { w, economy, A, B, C, car, run, route } = row();
    const p = Progress.fresh();
    attachPassengers(w, () => p);
    route(A, B, C);
    economy.refreshReach();
    const coach = car("passenger").id;
    // One rider from A for C already aboard; at B, two for C and one for A wait (A is on the way round).
    economy.setTrips(coach, [A.id], [C.townId]);
    B.waiting = 3;
    B.wants.push(C.townId, C.townId, A.townId);
    for (let s = 0; s < 60 && economy.ridersOf(coach).count < SEATS.classic!; s++) run(1);
    const r = economy.ridersOf(coach);
    expect(r.count).toBe(4);
    expect(r.froms).toEqual([A.id, B.id, B.id, B.id]);
    expect(counts(r.to!, 4).get(C.townId)).toBe(3);
    expect(B.waiting).toBe(0);
  });

  it("a hand-run coach takes only people who want anywhere", () => {
    const { w, economy, A, B, car, run } = row();
    attachPassengers(w, () => Progress.fresh());
    A.waiting = 0;
    B.waiting = 2;
    B.wants.push(2, ANYWHERE);
    run(15);
    const r = economy.ridersOf(car("passenger").id);
    expect(r.count).toBe(1);
    expect(r.to).toEqual([ANYWHERE]);
    expect(B.wants).toEqual([2]);
  });

  it("a coach's riders keep their places and stops through a save (renumbered with the depots)", () => {
    // Depots 4 and 7 saved as 0 and 1; a lookout's place (−2 − 7) follows its depot; one from a stop gone is dropped.
    const renumbered = new Map([[4, 0], [7, 1]]);
    const r = { count: 3, from: 4, to: [2, -2 - 7, 5], froms: [4, 7, 9] };
    expect(savedRiders(r, renumbered)).toEqual({ count: 2, from: 0, to: [2, -2 - 1], froms: [0, 1] });
    // An old coach's riders (no places): as before.
    expect(savedRiders({ count: 2, from: 7 }, renumbered)).toEqual({ count: 2, from: 1 });
  });

  it("an old save's riders want anywhere and get off at the first other town", () => {
    const { w, economy, A, car, run } = row();
    const p = Progress.fresh();
    attachPassengers(w, () => p);
    economy.setRiders(car("passenger").id, 2, A.id);
    run(20);
    expect(p.riders).toBe(2);
  });

  it("a town's pull: its size, and its places (a museum draws more)", () => {
    const w = buildStarterWorld();
    const p = Progress.fresh();
    const [t0] = w.landscape.towns;
    const plain = placePull(w, p, t0.id);
    expect(plain).toBeGreaterThanOrEqual(1);
    const b = t0.buildings[0];
    const was = b.landmark;
    b.landmark = "museum";
    // (One place, +10%; its visitors ×1.5.)
    expect(placePull(w, p, t0.id)).toBeCloseTo(plain * 1.1 * 1.5);
    b.landmark = was;
  });
});

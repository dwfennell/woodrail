import { describe, expect, it } from "vitest";
import { CARGO } from "../economy/cargo";
import { Economy } from "../economy";
import { deserializeWorld, serializeWorld } from "../persist/save";
import { Sim, SIM_HZ, type CarKind } from "../sim";
import { appendPiece, connectorRef, getPieceDef, Layout, type PieceTypeId } from "../track";
import { attachPassengers, fareFor, SEATS } from "./passengers";
import { Progress } from "./progress";
import { routeStops } from "./route-stops";
import { buildStarterWorld, HALT_KITS, HALT_REACH, haltTown, haltWhy, STATION_CRANE_AT, syncIndustries, type World } from "./world";

/** Lay `type` on free end `ref` (seated by an end of the other kind); returns its id. */
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
 * Town A's station, a straight, a country halt of town B's (as Game mode registers one near B), two straights and town
 * B's station, a turnback past each end: a train of `cars` on the first straight, heading for B.
 */
function line(cars: CarKind[] = ["engine", "passenger"]) {
  const layout = new Layout();
  const a = layout.addPiece("station", { x: 0, z: 0, heading: 0 });
  endAt(layout, connectorRef(a, 0));
  const s0 = lay(layout, connectorRef(a, 1), "straight-216");
  const h = lay(layout, otherEnd(layout, s0), "kit-country-halt");
  let last = h;
  for (let i = 0; i < 2; i++) last = lay(layout, otherEnd(layout, last), "straight-216");
  const b = lay(layout, otherEnd(layout, last), "station");
  endAt(layout, otherEnd(layout, b));
  const sim = new Sim(layout);
  const placed = sim.addTrain(cars, { pieceId: s0, pathIndex: 0, reversed: false, s: 150 });
  if (placed.kind !== "placed") throw new Error("no room");
  const economy = new Economy(layout, sim);
  const A = economy.addDepot("town", a, 0, STATION_CRANE_AT);
  const B = economy.addDepot("town", b, 1, STATION_CRANE_AT);
  // The halt: a stop of town B's, its coaches stopping along its platform.
  const H = economy.addDepot("town", h, 1);
  const w = { layout, sim, economy, stations: new Map([[0, a], [1, b]]) } as unknown as World;
  const train = () => sim.getTrain(sim.trainIds()[0])!;
  const car = (kind: CarKind) => train().cars.find((c) => c.kind === kind)!;
  sim.setLever(car("engine").id, 1);
  /** Run `seconds`, counting the ticks the train stands still on `pieceId`. */
  const run = (seconds: number, pieceId = -1) => {
    let still = 0;
    for (let i = 0; i < seconds * SIM_HZ; i++) {
      sim.tick();
      economy.tick();
      if (train().speed === 0 && train().bogies.some((b) => b.pieceId === pieceId)) still++;
    }
    return still;
  };
  return { w, sim, economy, A, B, H, h, train, car, run };
}

describe("halts (Game mode)", () => {
  it("people get on at a halt, and pay a fare in another town; none get off in their own town", () => {
    const { w, economy, A, B, H, car, run } = line(["engine", "passenger"]);
    const p = Progress.fresh();
    attachPassengers(w, () => p);
    H.waiting = 3;
    B.waiting = 1;
    const coach = car("passenger").id;
    // At the halt: three get on, as at a station.
    run(8);
    expect(H.waiting).toBe(0);
    expect(economy.ridersOf(coach)).toEqual({ count: 3, from: H.id });
    // At B's station (the same town): no one gets off; the last seat fills from B's platform.
    run(10);
    expect(p.riders).toBe(0);
    expect(economy.ridersOf(coach).count).toBe(SEATS.classic);
    expect(B.waiting).toBe(0);
    // Turned back past B, through the halt again (nothing for it there), on to A: they all get off and pay.
    run(60);
    expect(p.riders).toBe(SEATS.classic);
    expect(p.coins).toBe(SEATS.classic! * fareFor(w, H, A, coach));
  });

  it("people from another town get off at a halt, and pay", () => {
    const { w, economy, A, H, car, run } = line(["engine", "passenger"]);
    const p = Progress.fresh();
    attachPassengers(w, () => p);
    const coach = car("passenger").id;
    economy.setRiders(coach, 2, A.id);
    run(10);
    expect(economy.ridersOf(coach).count).toBe(0);
    expect(p.riders).toBe(2);
    expect(p.coins).toBe(2 * fareFor(w, A, H, coach));
  });

  it("trains stop once at a halt, for its people; with no one to pick up or set down they run through", () => {
    const { w, H, h, run } = line(["engine", "passenger"]);
    attachPassengers(w, () => Progress.fresh());
    // Nothing to do there: no stop at all (not the kit's own dwell either).
    expect(run(8, h)).toBe(0);
    // Someone waiting: one stop, as long as boarding takes (not that and the kit's 4 s dwell too).
    const again = line(["engine", "passenger"]);
    attachPassengers(again.w, () => Progress.fresh());
    again.H.waiting = 1;
    const still = again.run(10, again.h);
    expect(still).toBeGreaterThan(0);
    expect(still).toBeLessThan(4 * SIM_HZ);
    expect(again.economy.kitStops.halts).toBe(0);
    void H;
  });

  it("goods trains run through a halt: it takes no goods", () => {
    const { economy, H, h, car, run } = line(["engine", "timber"]);
    economy.setCargo(car("timber").id, "planks", 3);
    expect(run(8, h)).toBe(0);
    expect(economy.cargoOf(car("timber").id).count).toBe(3);
    expect(H.piles[CARGO.planks.index]).toBe(0);
  });

  it("is a route stop by its town's name", () => {
    const { w, H } = line();
    (w as { landscape: unknown }).landscape = { towns: [{ id: 0, name: "Ashby" }, { id: 1, name: "Brook" }] };
    expect(routeStops(w).map((s) => s.name)).toEqual(["Ashby", "Brook", "Brook halt"]);
    expect(routeStops(w)[2].depotId).toBe(H.id);
  });
});

describe("placing a halt in Game mode", () => {
  /** The starter map with a country halt laid out of town A's station's far end. */
  function withHalt() {
    const w = buildStarterWorld();
    const town = w.landscape.towns[0];
    const station = w.stations.get(town.id)!;
    const piece = appendPiece(w.layout, "kit-country-halt", false, connectorRef(station, 0));
    return { w, town, piece };
  }

  it("becomes a passenger stop of the town nearest it (Game mode only)", () => {
    const { w, town, piece } = withHalt();
    // Sandbox: a kit's own stop, no depot.
    expect(syncIndustries(w)).toBe(false);
    expect(w.economy.depotAtPiece(piece)).toBeUndefined();
    expect(syncIndustries(w, true)).toBe(true);
    const d = w.economy.depotAtPiece(piece)!;
    expect([d.role, d.townId]).toEqual(["town", town.id]);
    expect(w.economy.isHalt(d)).toBe(true);
    expect(w.economy.isHalt(w.economy.depotAtPiece(w.stations.get(town.id)!)!)).toBe(false);
    expect(syncIndustries(w, true)).toBe(false);
  });

  it("is refused far from towns, and allowed near one", () => {
    const { w, town } = withHalt();
    const near = { x: town.centre.x + 300, z: town.centre.z, heading: 0 };
    expect(haltTown(w.landscape, near)?.id).toBe(town.id);
    expect(haltWhy(w.landscape, "kit-country-halt", near)).toBeNull();
    const far = { x: town.centre.x + HALT_REACH * 4, z: town.centre.z + HALT_REACH * 4, heading: 0 };
    expect(haltTown(w.landscape, far)).toBeNull();
    for (const type of HALT_KITS) expect(haltWhy(w.landscape, type, far)).toBe("Build halts within 23 squares of a town");
    // Only halts are held to towns.
    expect(haltWhy(w.landscape, "kit-water-tower", far)).toBeNull();
    expect(haltWhy(w.landscape, "straight-216", far)).toBeNull();
  });

  it("is saved, and comes back a stop of its town", () => {
    const { w, town, piece } = withHalt();
    syncIndustries(w, true);
    const d = w.economy.depotAtPiece(piece)!;
    d.waiting = 2;
    const back = deserializeWorld(JSON.parse(JSON.stringify(serializeWorld(w))));
    expect(back.ok).toBe(true);
    if (!back.ok) return;
    const e = back.value.economy.depotAtPiece(piece)!;
    expect([e.role, e.townId, e.waiting, e.craneAt]).toEqual(["town", town.id, 2, d.craneAt]);
    expect(back.value.economy.isHalt(e)).toBe(true);
  });
});

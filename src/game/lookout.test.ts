import { describe, expect, it } from "vitest";
import { Economy } from "../economy";
import { deserializeWorld, serializeWorld } from "../persist/save";
import { Sim, SIM_HZ, type CarKind } from "../sim";
import { appendPiece, connectorRef, getPieceDef, Layout, type PieceTypeId } from "../track";
import { CELL, hillsOf } from "../landscape";
import { attachEngines, canRack, RACK_WAIT } from "./engines";
import { engineStatus } from "./engine-status";
import { attachPassengers, fareFor, LOOKOUT_FARE, peopleArrive } from "./passengers";
import { Progress } from "./progress";
import { buildStarterWorld, haltWhy, LOOKOUT_HEIGHT, LOOKOUT_KIT, LOOKOUT_LOW, onHilltop, STATION_CRANE_AT, stopTown, syncIndustries, type World } from "./world";

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
 * Town A's station, a straight, a lookout (a stop of town A's, as Game mode registers one for the nearest town), two
 * straights and town B's station, a turnback past each end: a train of `cars` on the first straight, heading for B.
 * (Flat: the lookout's hilltop rule is the placement's, tested on a real map below.)
 */
function line(cars: CarKind[] = ["engine", "passenger"]) {
  const layout = new Layout();
  const a = layout.addPiece("station", { x: 0, z: 0, heading: 0 });
  endAt(layout, connectorRef(a, 0));
  const s0 = lay(layout, connectorRef(a, 1), "straight-216");
  const h = lay(layout, otherEnd(layout, s0), LOOKOUT_KIT);
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
  const L = economy.addDepot("town", h, 0);
  const w = { layout, sim, economy, stations: new Map([[0, a], [1, b]]), landscape: { towns: [] } } as unknown as World;
  const train = () => sim.getTrain(sim.trainIds()[0])!;
  const car = (kind: CarKind) => train().cars.find((c) => c.kind === kind)!;
  sim.setLever(car("engine").id, 1);
  const run = (seconds: number) => {
    for (let i = 0; i < seconds * SIM_HZ; i++) {
      sim.tick();
      economy.tick();
    }
  };
  return { w, sim, economy, A, B, L, train, car, run };
}

describe("the lookout halt", () => {
  it("riders from another town get off there for the view, and pay twice the fare", () => {
    const { w, economy, B, L, car, run } = line();
    const p = Progress.fresh();
    const paid: number[] = [];
    attachPassengers(w, () => p, (fare, _from, to) => void (to === L && paid.push(fare)));
    B.waiting = 3;
    const coach = car("passenger").id;
    // Through the lookout (no one aboard), on to B: three get on.
    run(14);
    expect(economy.ridersOf(coach)).toEqual({ count: 3, from: B.id });
    // Turned back past B, to the lookout: they all get off and pay twice the fare from B.
    const plain = Math.max(1, Math.round(Math.hypot(w.layout.getPiece(B.pieceId)!.pose.x - w.layout.getPiece(L.pieceId)!.pose.x, 0) / 800));
    run(12);
    expect(p.riders).toBe(3);
    expect(paid).toEqual([plain * LOOKOUT_FARE, plain * LOOKOUT_FARE, plain * LOOKOUT_FARE]);
    expect(fareFor(w, B, L, coach)).toBe(plain * LOOKOUT_FARE);
  });

  it("riders from its own town get off there too", () => {
    const { w, economy, A, sim, car, run } = line();
    const p = Progress.fresh();
    attachPassengers(w, () => p);
    A.waiting = 2;
    // Back to A first: two get on there, then on to the lookout, where they get off.
    const coach = car("passenger").id;
    sim.setLever(car("engine").id, -1);
    run(12);
    const boarded = economy.ridersOf(coach).count;
    run(14);
    expect(boarded).toBe(2);
    expect(p.riders).toBe(2);
  });

  it("no one waits at a lookout: its town's riders all turn up at its station", () => {
    const w = buildStarterWorld();
    const town = w.landscape.towns[0];
    const id = w.layout.addPiece(LOOKOUT_KIT, { x: town.centre.x + 400, z: town.centre.z + 400, heading: 0 }, 0, false);
    syncIndustries(w, true);
    const L = w.economy.depotAtPiece(id)!;
    expect(L.townId).toBe(town.id);
    const station = w.economy.depotAtPiece(w.stations.get(town.id)!)!;
    const p = Progress.fresh();
    p.learned.add("passengers");
    peopleArrive(w, p, 600, new Map());
    expect(L.waiting).toBe(0);
    expect(station.waiting).toBeGreaterThan(0);
  });

  it("stands only on a hilltop two levels up; any town is its town, however far", () => {
    const w = buildStarterWorld();
    const g = w.landscape.grid;
    const hills = hillsOf(g);
    // A spot three squares long along x, every square two levels up or more; and one on the felt.
    let top: { x: number; z: number; heading: number } | null = null;
    g.forEachCell((i, col, row) => {
      if (top || g.height[i] < 2) return;
      const x = g.centreX(col) - CELL / 2;
      const z = g.centreZ(row);
      const pose = { x, z, heading: 0 };
      if ([12, 108, 204].every((t) => hills.groundAt(x + t, z) >= LOOKOUT_HEIGHT)) top = pose;
    });
    expect(top).not.toBeNull();
    expect(onHilltop(w.landscape, top!)).toBe(true);
    expect(haltWhy(w.landscape, LOOKOUT_KIT, top!)).toBeNull();
    const town = w.landscape.towns[0];
    const felt = { x: town.centre.x + 300, z: town.centre.z, heading: 0 };
    expect(onHilltop(w.landscape, felt)).toBe(false);
    expect(haltWhy(w.landscape, LOOKOUT_KIT, felt)).toBe(LOOKOUT_LOW);
    expect(stopTown(w.landscape, LOOKOUT_KIT, { x: 99999, z: 99999, heading: 0 })).not.toBeNull();
  });

  it("is a stop of the nearest town once laid, and comes back from a save", () => {
    const w = buildStarterWorld();
    const id = w.layout.addPiece(LOOKOUT_KIT, { x: 20000, z: 20000, heading: 0 }, 0, false);
    expect(syncIndustries(w, true)).toBe(true);
    const d = w.economy.depotAtPiece(id)!;
    expect(d.role).toBe("town");
    expect(w.economy.isLookout(d)).toBe(true);
    expect(w.economy.isHalt(d)).toBe(true);
    const back = deserializeWorld(serializeWorld(w));
    if (!back.ok) throw new Error("didn't load");
    const d2 = back.value.economy.depotAtPiece(id)!;
    expect(back.value.economy.isLookout(d2)).toBe(true);
    expect(d2.townId).toBe(d.townId);
  });
});

describe("the rack engine", () => {
  it("can climb a rack; a train with only other engines can't, and its card says why", () => {
    const w = buildStarterWorld();
    attachEngines(w);
    const layout = w.layout;
    const s0 = layout.addPiece("straight-216", { x: 30000, z: 30000, heading: 0 }, 0, false);
    const s1 = appendPiece(layout, "straight-216", false, connectorRef(s0, 1), 0);
    const r = appendPiece(layout, "rack", false, connectorRef(s1, 1), 0);
    const top = appendPiece(layout, "straight-216", false, connectorRef(r, 1), 0);
    w.sim.trackChanged();
    const placed = w.sim.addTrain(["engine", "passenger"], { pieceId: s0, pathIndex: 0, reversed: false, s: 150 });
    if (placed.kind !== "placed") throw new Error(placed.kind);
    const t = w.sim.getTrain(placed.trainId)!;
    const engine = t.cars.find((c) => c.kind === "engine")!.id;
    w.sim.setLook(engine, "tank");
    expect(canRack(w, t)).toBe(false);
    w.sim.setLever(engine, 1);
    for (let i = 0; i < 20 * SIM_HZ; i++) w.sim.tick();
    expect(w.sim.rackHeld(t.id)).toBe(r);
    expect(engineStatus(w.sim, w.economy, engine, () => "")).toBe(RACK_WAIT);
    // A rack engine instead: it climbs on.
    w.sim.setLook(engine, "rack");
    expect(canRack(w, t)).toBe(true);
    let up = false;
    for (let i = 0; i < 20 * SIM_HZ; i++) {
      w.sim.tick();
      const now = w.sim.getTrain(w.sim.findCar(engine)!.train.id)!;
      if (now.bogies.some((b) => b.pieceId === top)) up = true;
    }
    expect(up).toBe(true);
    expect(w.sim.rackHeld(t.id)).toBe(-1);
  });
});

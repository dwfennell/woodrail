import { describe, expect, it } from "vitest";
import { Sim, SIM_HZ, type CarKind, type Train } from "../sim";
import { Layout } from "../track";
import { CARGO } from "./cargo";
import { CRAWL_SPEED } from "./constants";
import { Economy, type DepotRole, type DepotState, type RouteStopDef } from "./economy";

/**
 * The intent rules for trains on a line ("auto" stops: docs/superpowers/specs/2026-10-17-routes-design.md §3.3):
 * drop what this stop takes, pick up only what a later stop takes; warehouses keep only what no later stop uses; the
 * workshop's first claim on planks; wait to fill per stop; and skip a stop with nothing to do.
 */

/**
 * A row of straights along +x: two to start on, then each depot's piece with a straight after it, then two more. A
 * train of the given cars stands on the first two, heading +x toward the depots. (Depots sit on plain straights: the
 * economy only needs a piece with a track.)
 */
function line(roles: DepotRole[], cars: CarKind[] = ["engine", "timber"]) {
  const layout = new Layout();
  const n = 2 + roles.length * 2 + 2;
  const ids = Array.from({ length: n }, (_, i) => layout.addPiece("straight-216", { x: i * 216, z: 0, heading: 0 }));
  const sim = new Sim(layout);
  const placed = sim.addTrain(cars, { pieceId: ids[1], pathIndex: 0, reversed: false, s: 200 });
  if (placed.kind !== "placed") throw new Error("no room");
  const economy = new Economy(layout, sim);
  const depots = roles.map((role, k) => economy.addDepot(role, ids[2 + 2 * k], role === "town" ? k : -1));
  // Nothing made while a test runs unless it says so (piles hold just what the test puts there).
  for (const d of depots) d.rate = 0;
  const train = () => sim.getTrain(sim.trainIds()[0])! as Train;
  const engine = train().cars[0].id;
  const wagons = () => train().cars.filter((c) => c.kind !== "engine").map((c) => c.id);
  const route = (stops: RouteStopDef[], next = 0) => economy.setRoute(engine, { stops, next });
  const auto = (...ds: DepotState[]): RouteStopDef[] => ds.map((d) => ({ depotId: d.id, action: "auto" }));
  /** Head for stop `k` of the route (as if it had left the ones before). */
  const at = (k: number) => (economy.routeOf(engine)!.next = k);
  const step = () => {
    sim.tick();
    economy.tick();
  };
  return { layout, sim, economy, depots, train, engine, wagons, route, auto, at, step };
}

const pile = (d: DepotState, kind: keyof typeof CARGO) => d.piles[CARGO[kind].index];

/**
 * Run a train (lever forward) for `seconds` (or until `until`), noting on each depot the fastest it went, its speed as
 * it left (its last tick there), whether it stopped, and how long it stood under the crane.
 */
function drive(w: ReturnType<typeof line>, seconds: number, until?: () => boolean) {
  w.sim.setLever(w.engine, 1);
  const fastest = new Map<number, number>();
  const leaving = new Map<number, number>();
  const stopped = new Map<number, boolean>();
  const held = new Map<number, number>();
  for (let i = 0; i < seconds * SIM_HZ && !until?.(); i++) {
    w.step();
    const t = w.train();
    for (const d of w.depots) {
      if (t.bogies.some((b) => b.pieceId === d.pieceId)) {
        fastest.set(d.id, Math.max(fastest.get(d.id) ?? 0, t.speed));
        leaving.set(d.id, t.speed);
        if (t.speed === 0) stopped.set(d.id, true);
      }
      if (w.economy.servicedCar(d.id) !== -1) held.set(d.id, (held.get(d.id) ?? 0) + 1 / SIM_HZ);
    }
  }
  return { fastest: (d: DepotState) => fastest.get(d.id) ?? 0, leaving: (d: DepotState) => leaving.get(d.id) ?? 0, stopped: (d: DepotState) => !!stopped.get(d.id), held: (d: DepotState) => held.get(d.id) ?? 0 };
}

describe("automatic intent: drop what this stop takes, pick up what a later stop takes", () => {
  it("Forest → Sawmill → Town: logs on at the forest and off at the sawmill; planks on at the sawmill and off at the town", () => {
    const w = line(["forest", "sawmill", "town"], ["engine", "timber", "timber"]);
    const [forest, saw, town] = w.depots;
    forest.piles[CARGO.log.index] = 6;
    saw.piles[CARGO.planks.index] = 6;
    w.route(w.auto(forest, saw, town));
    drive(w, 120, () => (w.economy.delivered.get(town.townId) ?? 0) >= 6);
    expect(pile(forest, "log")).toBe(0);
    expect(pile(saw, "log")).toBe(6);
    expect(pile(saw, "planks")).toBe(0);
    expect(w.economy.delivered.get(town.townId)).toBe(6);
    for (const car of w.wagons()) expect(w.economy.cargoOf(car).count).toBe(0);
  });

  it("each stop of that line, wagon by wagon", () => {
    const w = line(["forest", "sawmill", "town"], ["engine", "timber", "timber"]);
    const [forest, saw, town] = w.depots;
    const [full, empty] = w.wagons();
    forest.piles[CARGO.log.index] = 6;
    saw.piles[CARGO.planks.index] = 6;
    w.route(w.auto(forest, saw, town));
    expect(w.economy.needsService(forest, empty)).toBe(true);
    w.economy.setCargo(full, "log", 3);
    w.at(1);
    expect(w.economy.needsService(saw, full)).toBe(true);
    expect(w.economy.needsService(saw, empty)).toBe(true);
    // Logs are for the sawmill: not dropped at the town.
    w.at(2);
    expect(w.economy.needsService(town, full)).toBe(false);
    w.economy.setCargo(full, "planks", 3);
    expect(w.economy.needsService(town, full)).toBe(true);
  });

  it("a good no later stop takes is left behind (Forest → Town: no logs taken; Sawmill → Forest: no planks)", () => {
    const w = line(["forest", "town", "sawmill"]);
    const [forest, town, saw] = w.depots;
    const [wagon] = w.wagons();
    forest.piles[CARGO.log.index] = 6;
    saw.piles[CARGO.planks.index] = 6;
    w.route(w.auto(forest, town));
    expect(w.economy.needsService(forest, wagon)).toBe(false);
    w.route(w.auto(saw, forest));
    expect(w.economy.needsService(saw, wagon)).toBe(false);
    // A loop doesn't pick up at a stop what only that stop takes (the sawmill twice: still only itself).
    w.route([...w.auto(saw, forest), ...w.auto(saw)]);
    expect(w.economy.needsService(saw, wagon)).toBe(false);
    // With the sawmill on the line after the forest, logs are taken there.
    w.route(w.auto(forest, town, saw));
    expect(w.economy.needsService(forest, wagon)).toBe(true);
    // And left behind on the track: run it.
    w.route(w.auto(forest, town));
    drive(w, 30);
    expect(w.economy.cargoOf(wagon).count).toBe(0);
    expect(pile(forest, "log")).toBe(6);
  });

  it("a stop on the line twice is two places on it: each sees the rest of the line (Forest → Town → Forest → Sawmill)", () => {
    const w = line(["forest", "town", "sawmill"]);
    const [forest, town, saw] = w.depots;
    const [wagon] = w.wagons();
    forest.piles[CARGO.log.index] = 6;
    w.route(w.auto(forest, town, forest, saw));
    for (const k of [0, 2]) {
      w.at(k);
      expect(w.economy.needsService(forest, wagon), `stop ${k}`).toBe(true);
    }
    // Logs aboard ride through the town (and on to the sawmill).
    w.economy.setCargo(wagon, "log", 3);
    w.at(1);
    expect(w.economy.needsService(town, wagon)).toBe(false);
    w.at(3);
    expect(w.economy.needsService(saw, wagon)).toBe(true);
  });
});

describe("warehouses on a line", () => {
  it("Forest → Warehouse → Sawmill: logs aren't dropped at the warehouse (the sawmill takes them later)", () => {
    const w = line(["forest", "warehouse", "sawmill"], ["engine", "timber", "timber"]);
    const [forest, store, saw] = w.depots;
    forest.piles[CARGO.log.index] = 6;
    w.route(w.auto(forest, store, saw));
    const [full] = w.wagons();
    w.economy.setCargo(full, "log", 3);
    w.at(1);
    expect(w.economy.needsService(store, full)).toBe(false);
    // Run it: the logs ride past the warehouse to the sawmill.
    w.economy.setCargo(full, null, 0);
    w.at(0);
    drive(w, 120, () => pile(saw, "log") >= 6);
    expect(pile(store, "log")).toBe(0);
    expect(pile(saw, "log")).toBe(6);
  });

  it("a buffer: what no later stop takes is dropped at the warehouse, and picked up from it by a line that takes it on", () => {
    const w = line(["forest", "warehouse", "town", "sawmill"], ["engine", "timber", "timber"]);
    const [forest, store, town, saw] = w.depots;
    const [full, empty] = w.wagons();
    // Forest → Warehouse → Town: the town doesn't take logs, so they're left at the warehouse.
    w.route(w.auto(forest, store, town));
    // Logs are still picked up at the forest: the warehouse takes them.
    forest.piles[CARGO.log.index] = 3;
    expect(w.economy.needsService(forest, empty)).toBe(true);
    w.economy.setCargo(full, "log", 3);
    store.piles[CARGO.log.index] = 4;
    w.at(1);
    expect(w.economy.needsService(store, full)).toBe(true);
    // No churn: this line doesn't take back what it left (no later stop takes logs).
    expect(w.economy.needsService(store, empty)).toBe(false);
    // Warehouse → Sawmill: picked up from the warehouse for the sawmill.
    w.route(w.auto(store, saw));
    expect(w.economy.needsService(store, empty)).toBe(true);
    w.economy.setCargo(full, "log", 2);
    expect(w.economy.needsService(store, full)).toBe(true);
    // Its logs aboard stay on (topped up, not dropped).
    expect(w.economy.workFor(w.train().id, store)).toEqual({ load: true, unload: false });
  });

  it("run end to end: the buffered logs go in at the warehouse, and the empty wagon takes nothing back there", () => {
    const w = line(["forest", "warehouse", "town"], ["engine", "timber", "timber"]);
    const [forest, store, town] = w.depots;
    forest.piles[CARGO.log.index] = 6;
    w.route(w.auto(forest, store, town));
    drive(w, 120, () => pile(store, "log") >= 6);
    expect(pile(store, "log")).toBe(6);
    // On past the warehouse, the wagons are still empty.
    drive(w, 15);
    for (const car of w.wagons()) expect(w.economy.cargoOf(car).count).toBe(0);
    expect(pile(store, "log")).toBe(6);
  });

  it("two warehouses on a line don't hand goods back and forth", () => {
    const w = line(["warehouse", "warehouse"]);
    const [a, b] = w.depots;
    const [wagon] = w.wagons();
    a.piles[CARGO.log.index] = 5;
    w.route(w.auto(a, b));
    expect(w.economy.needsService(a, wagon)).toBe(false);
  });
});

describe("the workshop's first claim on planks", () => {
  it("a town before a workshop on the line keeps its hands off planks while the workshop is short, and gets them once it isn't", () => {
    const w = line(["sawmill", "town", "workshop"]);
    const [saw, town, shop] = w.depots;
    const [wagon] = w.wagons();
    let short = true;
    w.economy.reserved = (kind) => kind === "planks" && short;
    w.economy.setCargo(wagon, "planks", 3);
    w.route(w.auto(saw, town, shop), 1);
    expect(w.economy.needsService(town, wagon)).toBe(false);
    w.at(2);
    expect(w.economy.needsService(shop, wagon)).toBe(true);
    short = false;
    w.at(1);
    expect(w.economy.needsService(town, wagon)).toBe(true);
    // With no workshop on the line, the town gets them as usual.
    short = true;
    w.route(w.auto(saw, town), 1);
    expect(w.economy.needsService(town, wagon)).toBe(true);
  });

  it("run: the planks ride past the town to the workshop", () => {
    const w = line(["sawmill", "town", "workshop"]);
    const [saw, town, shop] = w.depots;
    w.economy.reserved = (kind) => kind === "planks";
    saw.piles[CARGO.planks.index] = 3;
    w.route(w.auto(saw, town, shop));
    drive(w, 90, () => pile(shop, "planks") >= 3);
    expect(pile(shop, "planks")).toBe(3);
    expect(w.economy.delivered.get(town.townId) ?? 0).toBe(0);
  });
});

describe("wait here till full (per stop)", () => {
  it("holds the train only at the stop that says so, whatever the depots' own setting", () => {
    // Forest A → Forest B (wait here) → Sawmill. A has a log; B grows them.
    const w = line(["forest", "forest", "sawmill"]);
    const [a, b, saw] = w.depots;
    a.piles[CARGO.log.index] = 1;
    a.rate = b.rate = 1;
    // A's own "wait for a full load" is for unrouted trains: this one doesn't wait there.
    w.economy.setWaitFull(a.id, true);
    w.route([
      { depotId: a.id, action: "auto" },
      { depotId: b.id, action: "auto", waitFill: true },
      { depotId: saw.id, action: "auto" },
    ]);
    const [wagon] = w.wagons();
    const r = drive(w, 90, () => pile(saw, "log") >= 3);
    expect(r.held(a)).toBeLessThan(3);
    // Two more logs at one per 15 s: held a while at B, till full.
    expect(r.held(b)).toBeGreaterThan(10);
    expect(pile(saw, "log")).toBe(3);
    expect(w.economy.cargoOf(wagon).count).toBe(0);
  });

  it("waits only for goods a later stop takes (Forest with wait → Town: no wait, no logs)", () => {
    const w = line(["forest", "town"]);
    const [forest, town] = w.depots;
    forest.rate = 1;
    w.route([
      { depotId: forest.id, action: "auto", waitFill: true },
      { depotId: town.id, action: "auto" },
    ]);
    const [wagon] = w.wagons();
    expect(w.economy.needsService(forest, wagon)).toBe(false);
    const r = drive(w, 20);
    expect(r.held(forest)).toBe(0);
    expect(w.economy.cargoOf(wagon).count).toBe(0);
  });
});

describe("skip a stop with nothing to do", () => {
  it("an auto stop where the train would neither drop nor pick up anything is run through at speed", () => {
    // Logs on the forest's pile, but nothing later on the line takes them.
    const w = line(["forest", "town"]);
    const [forest, town] = w.depots;
    forest.piles[CARGO.log.index] = 12;
    w.route(w.auto(forest, town));
    const r = drive(w, 15);
    expect(r.fastest(forest)).toBeGreaterThan(CRAWL_SPEED * 1.5);
    expect(r.leaving(forest)).toBeGreaterThan(CRAWL_SPEED * 1.5);
    expect(r.stopped(forest)).toBe(false);
  });

  it("decided as it comes up to the stop: a pile that has filled meanwhile is served", () => {
    const w = line(["forest", "sawmill"]);
    const [forest, saw] = w.depots;
    const [wagon] = w.wagons();
    w.route(w.auto(forest, saw));
    expect(w.economy.needsService(forest, wagon)).toBe(false);
    // Logs come before it gets there: it stops for them.
    forest.piles[CARGO.log.index] = 3;
    const r = drive(w, 20, () => w.economy.cargoOf(wagon).count >= 3);
    expect(r.stopped(forest)).toBe(true);
    expect(w.economy.cargoOf(wagon)).toEqual({ kind: "log", count: 3 });
    expect(pile(saw, "log")).toBe(0);
  });

  it("a wait-to-fill stop is never skipped: it crawls in, even with nothing there yet", () => {
    const w = line(["forest", "sawmill"]);
    const [forest, saw] = w.depots;
    w.route([
      { depotId: forest.id, action: "auto", waitFill: true },
      { depotId: saw.id, action: "auto" },
    ]);
    // Its first pass (until it has left the forest for the sawmill).
    const r = drive(w, 40, () => w.economy.routeOf(w.engine)!.next !== 0);
    expect(w.economy.routeOf(w.engine)!.next).toBe(1);
    expect(r.fastest(forest)).toBeGreaterThan(0);
    // It slows on coming in, and goes through at a crawl.
    expect(r.leaving(forest)).toBeLessThanOrEqual(CRAWL_SPEED + 1e-9);
  });

  it("passengers count as something to do: a coach stops at a station with people for a later station, not otherwise", () => {
    const w = line(["town", "forest", "town"], ["engine", "passenger"]);
    const [here, forest, there] = w.depots;
    w.economy.seatsOf = () => 4;
    here.waiting = 3;
    const [coach] = w.wagons();
    // No station later on the line: nobody gets on.
    w.route(w.auto(here, forest));
    expect(w.economy.needsService(here, coach)).toBe(false);
    w.route(w.auto(here, forest, there));
    expect(w.economy.needsService(here, coach)).toBe(true);
    const r = drive(w, 20, () => w.economy.ridersOf(coach).count >= 3);
    expect(r.stopped(here)).toBe(true);
    expect(w.economy.ridersOf(coach)).toEqual({ count: 3, from: here.id });
    // And they get off at the next station on the line.
    w.at(2);
    expect(w.economy.needsService(there, coach)).toBe(true);
  });
});

describe("explicit stops override intent", () => {
  it("Only pick up takes what's there whatever later stops want; Only drop leaves goods even at a warehouse a later stop needs", () => {
    const w = line(["forest", "town", "warehouse", "sawmill"]);
    const [forest, town, store, saw] = w.depots;
    const [wagon] = w.wagons();
    forest.piles[CARGO.log.index] = 6;
    w.route([{ depotId: forest.id, action: "pick" }, ...w.auto(town)]);
    expect(w.economy.needsService(forest, wagon)).toBe(true);
    w.economy.setCargo(wagon, "log", 3);
    w.route([{ depotId: store.id, action: "drop" }, ...w.auto(saw)]);
    expect(w.economy.needsService(store, wagon)).toBe(true);
    // A Drop stop picks nothing up, and a Pick-up stop drops nothing.
    w.economy.setCargo(wagon, null, 0);
    w.route([{ depotId: forest.id, action: "drop" }, ...w.auto(saw)]);
    expect(w.economy.needsService(forest, wagon)).toBe(false);
    w.economy.setCargo(wagon, "log", 3);
    w.route([{ depotId: saw.id, action: "pick" }, ...w.auto(forest)]);
    expect(w.economy.needsService(saw, wagon)).toBe(false);
    // A later Pick-up stop takes nothing: logs aren't picked up for it.
    w.economy.setCargo(wagon, null, 0);
    w.route([...w.auto(forest), { depotId: saw.id, action: "pick" }]);
    expect(w.economy.needsService(forest, wagon)).toBe(false);
    // The crane's words follow the stop: a Drop stop only unloads.
    w.route([{ depotId: saw.id, action: "drop" }, ...w.auto(forest)]);
    expect(w.economy.workFor(w.train().id, saw)).toEqual({ load: false, unload: true });
  });
});

describe("\"both\" on a line is automatic (as the engine card shows it)", () => {
  it("picks up only what a later stop takes, and keeps at a warehouse what a later stop uses", () => {
    const w = line(["forest", "town", "warehouse", "sawmill"]);
    const [forest, town, store, saw] = w.depots;
    const [wagon] = w.wagons();
    forest.piles[CARGO.log.index] = 6;
    w.route([{ depotId: forest.id, action: "both" }, ...w.auto(town)]);
    expect(w.economy.needsService(forest, wagon)).toBe(false);
    w.economy.setCargo(wagon, "log", 3);
    w.route([{ depotId: store.id, action: "both" }, ...w.auto(saw)]);
    expect(w.economy.needsService(store, wagon)).toBe(false);
    w.route([{ depotId: store.id, action: "both" }, ...w.auto(town)]);
    expect(w.economy.needsService(store, wagon)).toBe(true);
  });
});

describe("harbours on a line", () => {
  it("drop only what no later stop uses (planks for a later town aren't sold at the quay); landed goods are picked up as usual", () => {
    const w = line(["harbour", "town", "forest", "smithy", "warehouse"]);
    const [harbour, town, forest, smithy, store] = w.depots;
    const [wagon] = w.wagons();
    w.economy.setCargo(wagon, "planks", 3);
    w.route(w.auto(harbour, town));
    expect(w.economy.needsService(harbour, wagon)).toBe(false);
    // A warehouse later doesn't count: it would only keep them.
    w.route(w.auto(harbour, store));
    expect(w.economy.needsService(harbour, wagon)).toBe(true);
    w.route(w.auto(harbour, forest));
    expect(w.economy.needsService(harbour, wagon)).toBe(true);
    // Iron a boat landed: picked up for a later stop that takes it (a warehouse too), not otherwise.
    w.economy.setCargo(wagon, null, 0);
    w.economy.land(harbour, "iron", 3);
    w.route(w.auto(harbour, smithy));
    expect(w.economy.needsService(harbour, wagon)).toBe(true);
    w.route(w.auto(harbour, store));
    expect(w.economy.needsService(harbour, wagon)).toBe(true);
    w.route(w.auto(harbour, forest));
    expect(w.economy.needsService(harbour, wagon)).toBe(false);
    // Unrouted trains: the quay takes what it's given, as before.
    w.route([]);
    w.economy.setCargo(wagon, "planks", 3);
    expect(w.economy.needsService(harbour, wagon)).toBe(true);
  });
});

describe("what later stops take is kept, and worked out again when it changes", () => {
  it("a line edited (stops changed in place), a depot's Automatic, and what a town wants", () => {
    const w = line(["sawmill", "town", "forest"]);
    const [saw, town, forest] = w.depots;
    const [wagon] = w.wagons();
    saw.piles[CARGO.planks.index] = 6;
    const stops = w.auto(saw, forest);
    w.route(stops);
    expect(w.economy.needsService(saw, wagon)).toBe(false);
    // The town added to the line (in place, as editLine does, then set).
    stops.push({ depotId: town.id, action: "auto" });
    w.route(stops);
    expect(w.economy.needsService(saw, wagon)).toBe(true);
    // The town's depot not automatic: it takes nothing from trains.
    w.economy.setAuto(town.id, false);
    expect(w.economy.needsService(saw, wagon)).toBe(false);
    w.economy.setAuto(town.id, true);
    // Game mode: the town wants planks until it's had one.
    w.economy.accepts = (d, kind) => d.role !== "town" || kind !== "planks" || (w.economy.delivered.get(d.townId) ?? 0) < 1;
    expect(w.economy.needsService(saw, wagon)).toBe(true);
    w.economy.setCargo(wagon, "planks", 1);
    expect(w.economy.moveCargo({ kind: "car", carId: wagon }, { kind: "pile", depotId: town.id, cargo: "planks" })).toBe(true);
    expect(w.economy.needsService(saw, wagon)).toBe(false);
  });
});

describe("unrouted trains are unchanged", () => {
  it("served at every automatic depot they pass, with the depot's own wait for a full load", () => {
    const w = line(["forest", "town"]);
    const [forest, town] = w.depots;
    const [wagon] = w.wagons();
    forest.piles[CARGO.log.index] = 3;
    expect(w.economy.needsService(forest, wagon)).toBe(true);
    w.economy.setCargo(wagon, "planks", 3);
    expect(w.economy.needsService(town, wagon)).toBe(true);
    w.economy.setCargo(wagon, null, 0);
    forest.piles[CARGO.log.index] = 0;
    forest.rate = 1;
    w.economy.setWaitFull(forest.id, true);
    expect(w.economy.needsService(forest, wagon)).toBe(true);
  });
});

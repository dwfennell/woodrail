import { describe, expect, it } from "vitest";
import { Sim, SIM_HZ, trainKey, type CarKind, type Train } from "../sim";
import { appendPiece, connectorRef, Layout } from "../track";
import { CARGO } from "./cargo";
import { Economy, type DepotRole, type DepotState } from "./economy";
import { HaulLog, LOG_LINES, LOG_VISITS, loadLog, RIDERS, saveLog, VehicleLog } from "./history";
import { buildStarterWorld } from "../game/world";
import { deserializeWorld, serializeWorld, type SaveData } from "../persist/save";

/**
 * Trains' and boats' delivery history (spec docs/superpowers/specs/2026-11-28-delivery-history.md): what's recorded at
 * a stop, where a pickup is meant for, where a drop came from and how long it rode, a town's coins shared among the
 * drops they're for, and the log bounded and saved.
 */

/** A row of straights along +x with a depot on every other one, and a train of `cars` heading +x toward them. */
function line(roles: DepotRole[], cars: CarKind[] = ["engine", "timber"]) {
  const layout = new Layout();
  const n = 2 + roles.length * 2 + 2;
  const ids = Array.from({ length: n }, (_, i) => layout.addPiece("straight-216", { x: i * 216, z: 0, heading: 0 }));
  const sim = new Sim(layout);
  const placed = sim.addTrain(cars, { pieceId: ids[1], pathIndex: 0, reversed: false, s: 200 });
  if (placed.kind !== "placed") throw new Error("no room");
  const economy = new Economy(layout, sim);
  const depots = roles.map((role, k) => economy.addDepot(role, ids[2 + 2 * k], role === "town" ? k : -1));
  for (const d of depots) d.rate = 0;
  const train = () => sim.getTrain(sim.trainIds()[0])! as Train;
  const engine = train().cars[0].id;
  const run = (seconds: number, until?: () => boolean) => {
    sim.setLever(engine, 1);
    for (let i = 0; i < seconds * SIM_HZ && !until?.(); i++) {
      sim.tick();
      economy.tick();
    }
  };
  return { sim, economy, depots, train, engine, run };
}

const lines = (e: Economy, engine: number) => (e.history.trains.get(engine)?.visits() ?? []).map((v) => ({ at: v.depotId, lines: v.lines.map((l) => ({ ...l })) }));

describe("a train's history", () => {
  it("on a line forest → sawmill: the logs picked up meant for the sawmill, dropped there from the forest, with the time they rode", () => {
    const w = line(["forest", "sawmill"]);
    const [forest, sawmill] = w.depots as [DepotState, DepotState];
    forest.piles[CARGO.log.index] = 6;
    w.economy.setRoute(w.engine, { stops: [forest, sawmill].map((d) => ({ depotId: d.id, action: "auto" as const })), next: 0 });
    w.run(120, () => sawmill.piles[CARGO.log.index] > 0 && w.economy.history.trains.get(w.engine)!.open === null);
    const [drop, pick] = lines(w.economy, w.engine);
    expect(pick.at).toBe(forest.id);
    expect(pick.lines).toEqual([{ drop: false, good: CARGO.log.index, n: expect.any(Number), place: sawmill.id, coins: 0, rode: 0 }]);
    expect(pick.lines[0].n).toBeGreaterThan(0);
    expect(drop.at).toBe(sawmill.id);
    expect(drop.lines[0]).toMatchObject({ drop: true, good: CARGO.log.index, n: pick.lines[0].n, place: forest.id, coins: 0 });
    // (It rode some seconds: the run along the straights between them, a crane's work at each end.)
    expect(drop.lines[0].rode / drop.lines[0].n).toBeGreaterThan(1);
    // The car's "came aboard" is gone once it's empty.
    expect(w.economy.history.carSince.size).toBe(0);
  });

  it("one line a good a visit (a crane's every move added to it), and the next stop a new visit", () => {
    const w = line(["forest", "sawmill"], ["engine", "timber", "timber"]);
    const [forest, sawmill] = w.depots as [DepotState, DepotState];
    forest.piles[CARGO.log.index] = 20;
    w.economy.setRoute(w.engine, { stops: [forest, sawmill].map((d) => ({ depotId: d.id, action: "auto" as const })), next: 0 });
    w.run(200, () => sawmill.piles[CARGO.log.index] > 0 && w.economy.history.trains.get(w.engine)!.open === null);
    const log = lines(w.economy, w.engine);
    expect(log.map((v) => v.at)).toEqual([sawmill.id, forest.id]);
    expect(log[1].lines).toHaveLength(1);
    expect(log[0].lines).toHaveLength(1);
    expect(log[0].lines[0].n).toBe(log[1].lines[0].n);
  });

  it("run by hand, a pickup says where it's meant for: nowhere (no one knows where it goes)", () => {
    const w = line(["forest", "sawmill"]);
    const [forest] = w.depots as [DepotState];
    forest.piles[CARGO.log.index] = 3;
    w.run(60, () => w.economy.cargoOf(w.train().cars[1].id).count > 0 && w.economy.history.trains.get(w.engine)?.open === null);
    const [pick] = lines(w.economy, w.engine);
    expect(pick).toMatchObject({ at: forest.id, lines: [{ drop: false, place: -1 }] });
  });

  it("mail is meant for the post office the line takes it to; a sorting van's for the town that takes the post", () => {
    const w = line(["town", "postoffice", "town"], ["engine", "mailvan"]);
    const [a, office, b] = w.depots as [DepotState, DepotState, DepotState];
    const stops = [a, office, b].map((d) => ({ depotId: d.id, action: "auto" as const }));
    w.economy.setRoute(w.engine, { stops, next: 0 });
    expect(w.economy.meantFor(w.train(), a, "mail")).toBe(office.id);
    const s = line(["town", "postoffice", "town"], ["engine", "sortvan"]);
    s.economy.setRoute(s.engine, { stops: s.depots.map((d) => ({ depotId: d.id, action: "auto" as const })), next: 0 });
    expect(s.economy.meantFor(s.train(), s.depots[0], "mail")).toBe(s.depots[2].id);
    // (Round the line from the last stop: the post office again.)
    expect(w.economy.meantFor(w.train(), b, "mail")).toBe(office.id);
  });

  it("a rider's place is a town's station (its own place's depot for a place of its own; anywhere: none)", () => {
    const w = line(["town", "town", "airport"]);
    const [a, b, port] = w.depots as [DepotState, DepotState, DepotState];
    expect(w.economy.placeDepot(w.economy.placeKey(b))).toBe(b.id);
    expect(w.economy.placeDepot(w.economy.placeKey(a))).toBe(a.id);
    expect(w.economy.placeDepot(-2 - port.id)).toBe(port.id);
    expect(w.economy.placeDepot(-1)).toBe(-1);
  });
});

describe("HaulLog", () => {
  it("riders: on for their place, off from where they got on with their fare and the time they rode", () => {
    const h = new HaulLog();
    let now = 100;
    h.clock = () => now;
    h.boarded(1, 7, 10, 20);
    h.boarded(1, 7, 10, 30);
    h.boarded(1, 7, 10, 20);
    h.left(1);
    now = 160;
    h.alighted(1, 7, 20, 10, 12, 1);
    h.alighted(1, 7, 20, 10, 12, 0);
    const [off, on] = h.trains.get(1)!.visits();
    expect(on.lines.map((l) => [l.good, l.place, l.n])).toEqual([
      [RIDERS, 20, 2],
      [RIDERS, 30, 1],
    ]);
    expect(off).toMatchObject({ at: 160, depotId: 20, lines: [{ drop: true, good: RIDERS, n: 2, place: 10, coins: 24, rode: 120 }] });
    expect(h.riderSince.size).toBe(0);
  });

  it("a town's coins go to the drops there they're for, by units, and none twice", () => {
    const h = new HaulLog();
    h.dropped(1, 5, 3, "planks", false, 0);
    h.dropped(1, 5, 3, "planks", true, 0);
    h.left(1);
    h.dropped(2, 9, 3, "planks", true, 0);
    h.dropped(2, 9, 3, "flour", true, 0);
    h.paid(0, "planks", 3, 30);
    h.paid(0, "flour", 1, 9);
    h.paid(0, "planks", 2, 20);
    expect(h.trains.get(1)!.visits()[0].lines[0].coins).toBe(20);
    expect(h.trains.get(2)!.visits()[0].lines.map((l) => l.coins)).toEqual([10, 9]);
  });

  it(`keeps a vehicle's last ${LOG_VISITS} visits, newest first, reusing the oldest; ${LOG_LINES} lines a visit`, () => {
    const h = new HaulLog();
    let now = 0;
    h.clock = () => now;
    for (let i = 0; i < LOG_VISITS + 7; i++) {
      now = i;
      h.picked(1, 2, i, "log", -1, true);
      h.left(1);
    }
    const log = h.trains.get(1)!;
    expect(log.ring).toHaveLength(LOG_VISITS);
    expect(log.visits().map((v) => v.at)).toEqual(Array.from({ length: LOG_VISITS }, (_, k) => LOG_VISITS + 6 - k));
    for (let to = 0; to < LOG_LINES + 4; to++) h.boarded(1, 3, 99, to);
    const v = log.visits()[0];
    expect(v.lines).toHaveLength(LOG_LINES);
    expect(v.lines.reduce((n, l) => n + l.n, 0)).toBe(LOG_LINES + 4);
  });

  it("the summary counts loads dropped and coins since a time", () => {
    const h = new HaulLog();
    let now = 0;
    h.clock = () => now;
    h.alighted(1, 2, 3, 4, 10, 0);
    h.left(1);
    now = 4000;
    h.dropped(1, 5, 6, "log", true);
    h.alighted(1, 2, 6, 4, 5, 0);
    expect(HaulLog.summary(h.trains.get(1), 3000)).toEqual({ loads: 1, people: 1, coins: 5 });
    expect(HaulLog.summary(undefined, 0)).toEqual({ loads: 0, people: 0, coins: 0 });
  });

  it("saves oldest first with depots renumbered, and loads back the same (a depot gone: −1)", () => {
    const h = new HaulLog();
    let now = 5;
    h.clock = () => now;
    h.picked(1, 2, 10, "log", 11, true);
    h.left(1);
    now = 65;
    h.dropped(1, 2, 11, "log", true);
    const saved = saveLog(h.trains.get(1), (id) => (id === 10 ? 0 : id === 11 ? 1 : -1))!;
    expect(saved).toEqual([
      [5, 0, [[CARGO.log.index, 1, 0, 1, 0, 0]]],
      [65, 1, [[CARGO.log.index, 1, 1, 0, 0, 60]]],
    ]);
    const back = loadLog(saved, (d) => d === 1);
    expect(back.visits().map((v) => [v.at, v.depotId, v.lines[0].place])).toEqual([
      [65, 1, -1],
      [5, -1, 1],
    ]);
    expect(saveLog(new VehicleLog(), () => 0)).toBeUndefined();
  });
});

describe("history in a save", () => {
  it("a train's log and its wagon's load's origin come back after a reload, on its engine", () => {
    const world = buildStarterWorld();
    const [a] = world.landscape.towns;
    let last = world.stations.get(a.id)!;
    const track: number[] = [];
    for (let i = 0; i < 6; i++) track.push((last = appendPiece(world.layout, "straight-216", false, connectorRef(last, 1))));
    const placed = world.sim.addTrain(["engine", "timber"], { pieceId: track[2], pathIndex: 0, reversed: false, s: 120 });
    if (placed.kind !== "placed") throw new Error("no room");
    const train = world.sim.getTrain(placed.trainId)!;
    const [forest, sawmill] = [world.economy.allDepots().find((d) => d.role === "forest")!, world.economy.allDepots().find((d) => d.role === "sawmill")!];
    const h = world.economy.history;
    h.clock = () => 30;
    world.economy.setCargo(train.cars[1].id, "log", 2);
    h.picked(trainKey(train), train.cars[1].id, forest.id, "log", sawmill.id, true);
    h.picked(trainKey(train), train.cars[1].id, forest.id, "log", sawmill.id, false);
    const data = JSON.parse(JSON.stringify(serializeWorld(world))) as SaveData;
    const r = deserializeWorld(data);
    if (!r.ok) throw new Error(r.error);
    const w2 = r.value;
    const t2 = w2.sim.getTrain(w2.sim.trainIds()[0])!;
    const ids = new Map(w2.economy.allDepots().map((d) => [d.role, d.id]));
    const [v] = w2.economy.history.trains.get(trainKey(t2))!.visits();
    expect(v).toMatchObject({ at: 30, depotId: ids.get("forest"), lines: [{ drop: false, good: CARGO.log.index, n: 2, place: ids.get("sawmill") }] });
    expect(w2.economy.history.carSince.get(t2.cars[1].id)).toEqual({ from: ids.get("forest"), at: 30 });
    // Saved again, the same.
    expect(JSON.parse(JSON.stringify(serializeWorld(w2))).trains).toEqual(data.trains);
  });
});

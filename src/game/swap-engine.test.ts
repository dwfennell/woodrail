import { describe, expect, it } from "vitest";
import { deserializeWorld, serializeWorld } from "../persist/save";
import { SIM_HZ, type CarLook } from "../sim";
import { appendPiece, connectorRef } from "../track";
import { attachEngines, load, topSpeed } from "./engines";
import { createLine, joinLine, lineOf } from "./lines";
import { swapChoices, swapEngine, swapRefusal, swappedWords, type SwapRules } from "./swap-engine";
import { buildStarterWorld } from "./world";

/**
 * Swap engine (spec 2026-11-23-swap-engine.md): the engine's look set in place, so the train keeps everything keyed by
 * its engine's id (line, next stop, name, paint, lever) and its wagons and loads, and runs as the new engine at once.
 */

/** The starter map's first town's station with track on, a tank engine and two hoppers on it, running a line between two towns. */
function trainOnALine() {
  const world = buildStarterWorld();
  attachEngines(world);
  const [a] = world.landscape.towns;
  let last = world.stations.get(a.id)!;
  const track: number[] = [];
  for (let i = 0; i < 8; i++) track.push((last = appendPiece(world.layout, "straight-216", false, connectorRef(last, 1))));
  const r = world.sim.addTrain(["engine", "hopper", "hopper"], { pieceId: track[3], pathIndex: 0, reversed: false, s: 120 });
  if (r.kind !== "placed") throw new Error("no room");
  const train = world.sim.getTrain(r.trainId)!;
  const engine = train.cars[0].id;
  world.sim.setLook(engine, "tank");
  world.sim.setLivery(engine, "red");
  const [town, other] = world.economy.allDepots().filter((d) => d.role === "town");
  const line = createLine(world.economy, [
    { depotId: town.id, action: "auto" },
    { depotId: other.id, action: "auto", waitFill: true },
  ]);
  joinLine(world.economy, engine, line.id);
  world.economy.setCargo(train.cars[1].id, "grain", 2);
  return { world, engine, line, track, wagons: train.cars.slice(1).map((c) => c.id) };
}

const ALL: SwapRules = { locked: () => null };
const tick = (world: ReturnType<typeof trainOnALine>["world"], seconds: number) => {
  for (let i = 0; i < seconds * SIM_HZ; i++) {
    world.sim.tick();
    world.economy.tick();
  }
};

describe("swap engine", () => {
  it("keeps the train's line, next stop, wagons, loads, name, paint and lever; runs as the new engine at once", () => {
    const { world, engine, line, wagons } = trainOnALine();
    const next = world.economy.routeOf(engine)!.next;
    const name = world.sim.nameOf(engine);
    const train = world.sim.findCar(engine)!.train;
    const before = topSpeed(world, train, false);
    expect(load(world, train).pulls).toBe(3);
    const version = world.sim.looksVersion;

    expect(swapEngine(world, engine, "goods", ALL)).toBe("tank");
    const after = world.sim.findCar(engine)!.train;
    expect(after).toBe(train);
    expect(world.sim.lookOf(engine)).toBe("goods");
    expect(world.sim.looksVersion).toBeGreaterThan(version);
    expect(lineOf(world.economy, engine)).toBe(line);
    expect(world.economy.routeOf(engine)!.next).toBe(next);
    expect(world.economy.routeOf(engine)!.stops[1].waitFill).toBe(true);
    expect(after.cars.map((c) => c.id)).toEqual([engine, ...wagons]);
    expect(world.economy.cargoOf(wagons[0])).toMatchObject({ kind: "grain", count: 2 });
    expect(world.sim.nameOf(engine)).toBe(name);
    expect(world.sim.liveryOf(engine)).toBe("red");
    // (A goods engine: 8 cars at 0.8×.)
    expect(load(world, after).pulls).toBe(8);
    expect(topSpeed(world, after, false)).toBeLessThan(before);
    expect(swappedWords(name, "goods")).toBe(`${name} is a goods engine now`);
    expect(swappedWords(name, "express")).toBe(`${name} is an express engine now`);

    // It carries on along its line, a goods engine still, and a save keeps it so.
    world.sim.setLever(engine, 1);
    tick(world, 5);
    expect(lineOf(world.economy, engine)).toBe(line);
    const r = deserializeWorld(JSON.parse(JSON.stringify(serializeWorld(world))));
    if (!r.ok) throw new Error(r.error);
    const back = r.value;
    expect(back.sim.lookOf(engine)).toBe("goods");
    expect(back.economy.lineIdOf.get(engine)).toBeDefined();
    expect(back.sim.nameOf(engine)).toBe(name);
  });

  it("undone, the old engine is back: the look set again, nothing else touched", () => {
    const { world, engine, line } = trainOnALine();
    const was = swapEngine(world, engine, "diesel", ALL)!;
    world.sim.setLook(engine, was);
    expect(world.sim.lookOf(engine)).toBe("tank");
    expect(lineOf(world.economy, engine)).toBe(line);
  });

  it("refuses a moving train, a crane's, the metro's and the Royal Train's, what isn't learned, and leaving a rack without a rack engine", () => {
    const { world, engine, track } = trainOnALine();
    expect(swapRefusal(world, engine, null, ALL)).toBeNull();
    expect(swapRefusal(world, engine, "tank", ALL)).toBe("same");
    // Not learned (Game mode's rules), but Sandbox's (none) let it.
    const noDiesel: SwapRules = { locked: (l: CarLook) => (l === "diesel" ? "Diesel" : null) };
    expect(swapRefusal(world, engine, "diesel", noDiesel)).toBe("locked");
    expect(swapEngine(world, engine, "diesel", noDiesel)).toBeNull();
    expect(swapRefusal(world, engine, "diesel", null)).toBeNull();
    // A wagon isn't an engine.
    const wagon = world.sim.findCar(engine)!.train.cars[1].id;
    expect(swapRefusal(world, wagon, "diesel", ALL)).toBe("none");
    // The metro's and the Royal Train's, either way.
    expect(swapRefusal(world, engine, "metro", ALL)).toBe("special");
    world.sim.setLook(engine, "royal");
    expect(swapRefusal(world, engine, null, ALL)).toBe("special");
    world.sim.setLook(engine, "tank");
    // Moving.
    world.sim.setLever(engine, 1);
    tick(world, 1);
    expect(swapRefusal(world, engine, null, ALL)).toBe("moving");
    world.sim.setLever(engine, 0);
    tick(world, 3);
    expect(swapRefusal(world, engine, "diesel", ALL)).toBeNull();
    // Derailed.
    const train = world.sim.findCar(engine)!.train;
    train.derailed = true;
    expect(swapRefusal(world, engine, null, ALL)).toBe("crane");
    train.derailed = false;
    // On a rack: a rack engine may leave it as another rack engine only (Game mode); Sandbox's trains all climb.
    const under = [...world.sim.piecesUnder(train.id)];
    expect(under.length).toBeGreaterThan(0);
    const piece = world.layout.getPiece(under[0])!;
    const type = piece.type;
    (piece as { type: string }).type = "rack";
    world.sim.setLook(engine, "rack");
    expect(swapRefusal(world, engine, "tank", ALL)).toBe("rack");
    expect(swapRefusal(world, engine, "tank", null)).toBeNull();
    (piece as { type: string }).type = type;
    expect(swapRefusal(world, engine, "tank", ALL)).toBeNull();
    expect(track.length).toBe(8);
  });

  it("the sheet's rows: each engine, what it does, the one it is, what's locked, too weak, needs power", () => {
    const { world, engine } = trainOnALine();
    const rules: SwapRules = { locked: (l) => (l === "express" ? "Express" : null) };
    const rows = swapChoices(world, engine, rules);
    expect(rows.map((r) => r.look)).toEqual(["classic", "tank", "diesel", "electric", "express", "goods", "rack"]);
    const by = Object.fromEntries(rows.map((r) => [r.look, r]));
    expect(by.tank).toMatchObject({ label: "Tank engine", state: "current", note: "This one", stats: "Pulls 3 · steady" });
    expect(by.express).toMatchObject({ state: "locked", note: "Learn Express first" });
    // (Two hoppers: a rack engine pulls 2, enough; with a third it'd be too weak.)
    expect(by.rack).toMatchObject({ state: "ok", note: "Climbs racks" });
    expect(by.electric.note).toContain("power");
    const t = world.sim.findCar(engine)!.train;
    world.sim.removeTrain(t.id);
    const r = world.sim.addTrain(["engine", "hopper", "hopper", "hopper"], { ...t.bogies[0] }, [engine, ...t.cars.slice(1).map((c) => c.id), world.sim.newCarIds(1)[0]]);
    expect(r.kind).toBe("placed");
    expect(swapChoices(world, engine, rules).find((c) => c.look === "rack")).toMatchObject({ state: "warn", note: "Too weak for 3 cars" });
    // Sandbox: no numbers, nothing locked.
    expect(swapChoices(world, engine, null).every((c) => c.stats === "" && c.state !== "locked")).toBe(true);
  });
});

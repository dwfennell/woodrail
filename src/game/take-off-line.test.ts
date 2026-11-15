import { describe, expect, it } from "vitest";
import { Economy } from "../economy";
import { deserializeWorld, serializeWorld } from "../persist/save";
import { Sim, SIM_HZ } from "../sim";
import { appendPiece, connectorRef, getPieceDef, Layout } from "../track";
import { createLine, joinLine, lineOf, restoreLines, snapshotLines, takeOffLine, trainsOn } from "./lines";
import { buildStarterWorld } from "./world";

/**
 * Leaving a line (the train card's Leave line, and the line sheet's Take off): the train leaves its line and is run by hand,
 * standing where it is (never on points: it runs on till it's clear of them); the line stays, with its other trains or
 * none; and a save keeps it so.
 */

/** The starter map's first town's station with track on, two trains on it, both running a line between two towns. */
function twoOnALine() {
  const world = buildStarterWorld();
  const [a] = world.landscape.towns;
  let last = world.stations.get(a.id)!;
  const track: number[] = [];
  for (let i = 0; i < 8; i++) track.push((last = appendPiece(world.layout, "straight-216", false, connectorRef(last, 1))));
  const engines = [track[1], track[5]].map((pieceId) => {
    const r = world.sim.addTrain(["engine", "hopper"], { pieceId, pathIndex: 0, reversed: false, s: 120 });
    if (r.kind !== "placed") throw new Error("no room");
    return world.sim.getTrain(r.trainId)!.cars[0].id;
  });
  const [town, other] = world.economy.allDepots().filter((d) => d.role === "town");
  const line = createLine(world.economy, [
    { depotId: town.id, action: "auto" },
    { depotId: other.id, action: "auto" },
  ]);
  for (const e of engines) {
    joinLine(world.economy, e, line.id);
    world.sim.setLever(e, 1);
  }
  return { world, engines, line };
}

const leverOf = (sim: Sim, engine: number) => {
  const f = sim.findCar(engine)!;
  return f.train.cars[f.index].lever;
};

describe("take a train off its line", () => {
  it("off the line, hand-run and stopped; the line kept with its other train; a save keeps it so", () => {
    const { world, engines, line } = twoOnALine();
    const [off, stays] = engines;
    for (let i = 0; i < SIM_HZ; i++) {
      world.sim.tick();
      world.economy.tick();
    }
    expect(takeOffLine(world.economy, off)).toBe(true);
    expect(lineOf(world.economy, off)).toBeUndefined();
    expect(world.economy.routeOf(off)).toBeUndefined();
    // (On plain track: its lever off at once, it stands.)
    expect(leverOf(world.sim, off)).toBe(0);
    expect(world.economy.lines.get(line.id)).toBe(line);
    expect(trainsOn(world.economy, line.id)).toEqual([stays]);
    expect(leverOf(world.sim, stays)).toBe(1);
    // Taken off again: nothing to do.
    expect(takeOffLine(world.economy, off)).toBe(false);

    const r = deserializeWorld(JSON.parse(JSON.stringify(serializeWorld(world))));
    if (!r.ok) throw new Error(r.error);
    const back = r.value;
    expect([...back.economy.lines.values()].map((l) => l.name)).toEqual([line.name]);
    const lineBack = [...back.economy.lines.keys()][0];
    const loaded = back.sim.trainIds().map((id) => back.sim.getTrain(id)!.cars[0].id);
    const onLine = loaded.filter((e) => back.economy.lineIdOf.get(e) === lineBack);
    const handRun = loaded.filter((e) => !back.economy.lineIdOf.has(e));
    expect(onLine).toHaveLength(1);
    expect(handRun).toHaveLength(1);
    expect(back.economy.routeOf(handRun[0])).toBeUndefined();
    expect(leverOf(back.sim, handRun[0])).toBe(0);
  });

  it("its last train taken off: the line stays, run by no train", () => {
    const { world, engines, line } = twoOnALine();
    for (const e of engines) takeOffLine(world.economy, e);
    expect(world.economy.lines.get(line.id)).toBe(line);
    expect(trainsOn(world.economy, line.id)).toEqual([]);
    world.economy.prune();
    expect(world.economy.lines.has(line.id)).toBe(true);
  });

  it("undone, it's on the line again (the lines' snapshot, as the game's undo step)", () => {
    const { world, engines, line } = twoOnALine();
    const before = snapshotLines(world.economy);
    takeOffLine(world.economy, engines[0]);
    const after = snapshotLines(world.economy);
    restoreLines(world.economy, before, after);
    expect(lineOf(world.economy, engines[0])).toBe(line);
    restoreLines(world.economy, after, before);
    expect(lineOf(world.economy, engines[0])).toBeUndefined();
  });

  it("taken off on points, it runs on till it's clear of them, then stands", () => {
    // A straight, points, then plain track to a station at the end; the train over the points, going on.
    const layout = new Layout();
    const a = layout.addPiece("straight-216", { x: 0, z: 0, heading: 0 });
    const s = appendPiece(layout, "switch", false, connectorRef(a, 1));
    let last = s;
    for (let i = 0; i < 5; i++) last = appendPiece(layout, "straight-216", false, connectorRef(last, 1));
    const station = appendPiece(layout, "station", false, connectorRef(last, 1));
    const sim = new Sim(layout);
    const economy = new Economy(layout, sim);
    const town = economy.addDepot("town", station, 0).id;
    const r = sim.addTrain(["engine", "hopper"], { pieceId: s, pathIndex: 0, reversed: false, s: 60 });
    if (r.kind !== "placed") throw new Error(r.kind);
    const train = sim.getTrain(r.trainId)!;
    const engine = train.cars[0].id;
    joinLine(economy, engine, createLine(economy, [{ depotId: town, action: "auto" }]).id);
    sim.setLever(engine, train.cars[0].facing);
    for (let i = 0; i < 4; i++) {
      sim.tick();
      economy.tick();
    }
    const onPoints = () =>
      [...sim.piecesUnder(train.id)].some((id) => {
        const p = layout.getPiece(id)!;
        return getPieceDef(p.type, p.flipped).isSwitch;
      });
    expect(onPoints()).toBe(true);
    takeOffLine(economy, engine);
    // (Still going: on the points.)
    expect(leverOf(sim, engine)).not.toBe(0);
    expect(economy.stopsClear.has(engine)).toBe(true);
    for (let i = 0; i < 20 * SIM_HZ; i++) {
      sim.tick();
      economy.tick();
      // Never standing on points.
      if (Math.abs(train.speed) < 1e-6 && i > 0) expect(onPoints()).toBe(false);
    }
    expect(leverOf(sim, engine)).toBe(0);
    expect(train.speed).toBe(0);
    expect(onPoints()).toBe(false);
    expect(economy.stopsClear.size).toBe(0);
  });

  it("a lever moved by the player before it's clear of the points is the player's: it isn't stopped after", () => {
    const layout = new Layout();
    const a = layout.addPiece("straight-216", { x: 0, z: 0, heading: 0 });
    const s = appendPiece(layout, "switch", false, connectorRef(a, 1));
    let last = s;
    for (let i = 0; i < 3; i++) last = appendPiece(layout, "straight-216", false, connectorRef(last, 1));
    const station = appendPiece(layout, "station", false, connectorRef(last, 1));
    const sim = new Sim(layout);
    const economy = new Economy(layout, sim);
    const town = economy.addDepot("town", station, 0).id;
    const r = sim.addTrain(["engine"], { pieceId: s, pathIndex: 0, reversed: false, s: 60 });
    if (r.kind !== "placed") throw new Error(r.kind);
    const engine = sim.getTrain(r.trainId)!.cars[0].id;
    joinLine(economy, engine, createLine(economy, [{ depotId: town, action: "auto" }]).id);
    sim.setLever(engine, 1);
    takeOffLine(economy, engine);
    expect(economy.stopsClear.has(engine)).toBe(true);
    sim.setLever(engine, -1);
    economy.tick();
    expect(economy.stopsClear.has(engine)).toBe(false);
    expect(leverOf(sim, engine)).toBe(-1);
  });
});

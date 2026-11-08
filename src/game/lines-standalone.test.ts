import { describe, expect, it } from "vitest";
import { Economy } from "../economy";
import { Sim } from "../sim";
import { appendPiece, connectorRef, Layout } from "../track";
import { buildStarterWorld, type World } from "./world";
import { deserializeWorld, serializeWorld, type SaveData } from "../persist/save";
import { createLine, deleteLine, editLine, editLineById, joinLine, LINE_COLOURS, lineOf, restoreLines, snapshotLines, startLine, stopLine, trainsOn } from "./lines";
import { callHome } from "./telegraph";

/**
 * Lines that stand alone (the routes UX, 2026-11-06): a line is the player's, run by trains or by none. Made with no
 * train (`createLine`), edited by its id, kept when its last train leaves or is taken off the map, saved and loaded
 * with no train, and gone only when the player deletes it. A transient line (a telegraph's call home) still goes with
 * its train.
 */

/** Three depots on a straight line, and an engine between the first two. */
function small() {
  const layout = new Layout();
  const ids = (["depot-forest", "straight-216", "depot-sawmill", "straight-216", "station"] as const).map((t, i) => layout.addPiece(t, { x: i * 216, z: 0, heading: 0 }));
  const sim = new Sim(layout);
  const economy = new Economy(layout, sim);
  const forest = economy.addDepot("forest", ids[0], 0).id;
  const mill = economy.addDepot("sawmill", ids[2], 0).id;
  const town = economy.addDepot("town", ids[4], 0).id;
  const r = sim.addTrain(["engine"], { pieceId: ids[1], pathIndex: 0, reversed: false, s: 100 });
  if (r.kind !== "placed") throw new Error();
  return { economy, sim, engine: sim.getTrain(r.trainId)!.cars[0].id, trainId: r.trainId, forest, mill, town };
}

describe("lines with no train", () => {
  it("a line is made with no train: its stops, the next free colour, and no train on it", () => {
    const w = small();
    const red = startLine(w.economy, w.engine, [{ depotId: w.forest, action: "auto" }]);
    const line = createLine(w.economy, [
      { depotId: w.mill, action: "pick", waitFill: true },
      { depotId: w.town, action: "auto" },
    ]);
    expect(line.id).not.toBe(red.id);
    expect(line.colour).toBe(LINE_COLOURS[1].colour);
    expect(line.name).toBe("Blue line");
    expect(line.stops).toEqual([
      { depotId: w.mill, action: "pick", waitFill: true },
      { depotId: w.town, action: "auto" },
    ]);
    expect(trainsOn(w.economy, line.id)).toEqual([]);
    // Pruned (as each tick's tidy-up does), it stays.
    w.economy.prune();
    expect(w.economy.lines.get(line.id)).toBe(line);
  });

  it("is edited by its id, and a train put on it runs its stops (heading for the one it comes to first)", () => {
    const w = small();
    const line = createLine(w.economy, [{ depotId: w.forest, action: "auto" }]);
    editLineById(w.economy, line.id, (s) => s.push({ depotId: w.mill, action: "auto" }));
    expect(line.stops.map((s) => s.depotId)).toEqual([w.forest, w.mill]);
    joinLine(w.economy, w.engine, line.id);
    expect(lineOf(w.economy, w.engine)).toBe(line);
    expect(w.economy.routeOf(w.engine)!.stops).toBe(line.stops);
    // (The engine faces the sawmill, ahead of it.)
    expect(w.economy.routeOf(w.engine)!.next).toBe(1);
    // An edit by the line's id is its train's route at once.
    editLineById(w.economy, line.id, (s) => s.push({ depotId: w.town, action: "drop" }));
    expect(w.economy.routeOf(w.engine)!.stops.map((s) => s.depotId)).toEqual([w.forest, w.mill, w.town]);
    expect(w.economy.routeOf(w.engine)!.next).toBe(1);
  });

  it("its last train leaving keeps it (no train runs it now); the train goes anywhere again", () => {
    const w = small();
    const line = editLine(w.economy, w.engine, (s) => s.push({ depotId: w.forest, action: "auto" }, { depotId: w.mill, action: "auto" }))!;
    stopLine(w.economy, w.engine);
    expect(w.economy.routeOf(w.engine)).toBeUndefined();
    expect(lineOf(w.economy, w.engine)).toBeUndefined();
    expect(w.economy.lines.get(line.id)).toBe(line);
    expect(trainsOn(w.economy, line.id)).toEqual([]);
  });

  it("its last train taken off the map keeps it too", () => {
    const w = small();
    const line = editLine(w.economy, w.engine, (s) => s.push({ depotId: w.forest, action: "auto" }))!;
    w.sim.removeTrain(w.trainId);
    w.economy.prune();
    expect(w.economy.lineIdOf.size).toBe(0);
    expect(w.economy.lines.get(line.id)).toBe(line);
  });

  it("deleted, it's gone, and its trains go anywhere again", () => {
    const w = small();
    const line = editLine(w.economy, w.engine, (s) => s.push({ depotId: w.forest, action: "auto" }, { depotId: w.mill, action: "auto" }))!;
    deleteLine(w.economy, line.id);
    expect(w.economy.lines.has(line.id)).toBe(false);
    expect(w.economy.routeOf(w.engine)).toBeUndefined();
    expect(w.economy.lineIdOf.has(w.engine)).toBe(false);
  });

  it("its last stop taken off: the line's gone (a line has stops)", () => {
    const w = small();
    const line = createLine(w.economy, [{ depotId: w.forest, action: "auto" }]);
    expect(editLineById(w.economy, line.id, (s) => s.splice(0))).toBeNull();
    expect(w.economy.lines.has(line.id)).toBe(false);
  });

  it("undo and redo keep a line no train runs, and put its trains back on it", () => {
    const w = small();
    const line = editLine(w.economy, w.engine, (s) => s.push({ depotId: w.forest, action: "auto" }, { depotId: w.mill, action: "auto" }))!;
    const before = snapshotLines(w.economy);
    stopLine(w.economy, w.engine);
    const after = snapshotLines(w.economy);
    restoreLines(w.economy, before, after);
    expect(lineOf(w.economy, w.engine)).toBe(line);
    restoreLines(w.economy, after, before);
    expect(lineOf(w.economy, w.engine)).toBeUndefined();
    expect(w.economy.lines.get(line.id)).toBe(line);
  });

  it("a call home's line is transient: gone once its train is off it", () => {
    const world = withTrack();
    const engine = world.sim.getTrain(world.sim.trainIds()[0])!.cars[0].id;
    const r = callHome(world, engine);
    expect(r.ok).toBe(true);
    const line = lineOf(world.economy, engine)!;
    expect(line.transient).toBe(true);
    stopLine(world.economy, engine);
    expect(world.economy.lines.has(line.id)).toBe(false);
  });
});

/** The starter map, its first town's station with four straights on and a train there. */
function withTrack(): World {
  const world = buildStarterWorld();
  const [a] = world.landscape.towns;
  let last = world.stations.get(a.id)!;
  const track: number[] = [];
  for (let i = 0; i < 4; i++) track.push((last = appendPiece(world.layout, "straight-216", false, connectorRef(last, 1))));
  const placed = world.sim.addTrain(["engine", "hopper"], { pieceId: track[1], pathIndex: 0, reversed: false, s: 120 });
  if (placed.kind !== "placed") throw new Error("no room");
  return world;
}

const reload = (world: World) => {
  const r = deserializeWorld(JSON.parse(JSON.stringify(serializeWorld(world))));
  if (!r.ok) throw new Error(r.error);
  return r.value;
};

describe("saving lines with no train", () => {
  it("a line no train runs is saved and loads back: its colour, name and stops", () => {
    const world = withTrack();
    const [town, other] = world.economy.allDepots().filter((d) => d.role === "town");
    const line = createLine(world.economy, [
      { depotId: town.id, action: "auto", waitFill: true },
      { depotId: other.id, action: "drop" },
    ]);
    line.name = "Timber run";
    const back = reload(world);
    const loaded = [...back.economy.lines.values()];
    expect(loaded).toHaveLength(1);
    expect(loaded[0]).toMatchObject({ colour: line.colour, name: "Timber run" });
    expect(loaded[0].stops.map((s) => [back.economy.depot(s.depotId)!.pieceId, s.action, !!s.waitFill])).toEqual([
      [town.pieceId, "auto", true],
      [other.pieceId, "drop", false],
    ]);
    expect(back.economy.lineIdOf.size).toBe(0);
  });

  it("a line run by a train and one run by none load together, the train back on its own", () => {
    const world = withTrack();
    const engine = world.sim.getTrain(world.sim.trainIds()[0])!.cars[0].id;
    const [town, other] = world.economy.allDepots().filter((d) => d.role === "town");
    const run = editLine(world.economy, engine, (s) => s.push({ depotId: town.id, action: "auto" }, { depotId: other.id, action: "auto" }))!;
    const idle = createLine(world.economy, [{ depotId: other.id, action: "pick" }]);
    const back = reload(world);
    expect([...back.economy.lines.keys()].sort()).toEqual([run.id, idle.id].sort());
    const loaded = back.sim.getTrain(back.sim.trainIds()[0])!.cars[0].id;
    expect(lineOf(back.economy, loaded)!.id).toBe(run.id);
    expect(back.economy.routeOf(loaded)!.stops).toBe(back.economy.lines.get(run.id)!.stops);
    expect(trainsOn(back.economy, idle.id)).toEqual([]);
  });

  it("an old save (lines only as its trains ran them) loads as before: each train's route its line", () => {
    const world = withTrack();
    const engine = world.sim.getTrain(world.sim.trainIds()[0])!.cars[0].id;
    const [town, other] = world.economy.allDepots().filter((d) => d.role === "town");
    editLine(world.economy, engine, (s) => s.push({ depotId: town.id, action: "both" }, { depotId: other.id, action: "auto" }));
    const data = JSON.parse(JSON.stringify(serializeWorld(world))) as SaveData;
    // (As an older save wrote it: no field it didn't know; "both" as the old saves' action.)
    expect(Object.keys(data.lines![0]).sort()).toEqual(["colour", "id", "name", "stops"]);
    const r = deserializeWorld(data);
    if (!r.ok) throw new Error(r.error);
    const loaded = r.value.sim.getTrain(r.value.sim.trainIds()[0])!.cars[0].id;
    expect(lineOf(r.value.economy, loaded)!.stops.map((s) => s.action)).toEqual(["both", "auto"]);
    expect(r.value.economy.lines.size).toBe(1);
  });

  it("a line whose places are all gone isn't saved; a transient line with no train isn't either", () => {
    const world = withTrack();
    const [town] = world.economy.allDepots().filter((d) => d.role === "town");
    const home = createLine(world.economy, [{ depotId: town.id, action: "auto" }]);
    home.transient = true;
    expect(reload(world).economy.lines.size).toBe(0);
  });
});

describe("what a line carries", () => {
  it("counts the loads its trains unload over the last month (the Lines list's loads a month)", async () => {
    const { CARGO, PILE_CAP } = await import("../economy");
    const { SIM_HZ } = await import("../sim");
    const layout = new Layout();
    const ids = (["depot-forest", "straight-216", "straight-216", "straight-216", "depot-sawmill"] as const).map((t, i) => layout.addPiece(t, { x: i * 216, z: 0, heading: 0 }));
    const sim = new Sim(layout);
    const economy = new Economy(layout, sim);
    const forest = economy.addDepot("forest", ids[0], 0);
    const mill = economy.addDepot("sawmill", ids[4], 0).id;
    const r = sim.addTrain(["engine", "timber"], { pieceId: ids[2], pathIndex: 0, reversed: true, s: 100 });
    if (r.kind !== "placed") throw new Error();
    const engine = sim.getTrain(r.trainId)!.cars[0].id;
    const line = startLine(economy, engine, [{ depotId: forest.id, action: "auto" }, { depotId: mill, action: "auto" }]);
    sim.setLever(engine, sim.getTrain(r.trainId)!.cars[0].facing);
    let unloaded = 0;
    for (let i = 0; i < 90 * SIM_HZ; i++) {
      forest.piles[CARGO.log.index] = PILE_CAP;
      sim.tick();
      economy.tick();
      for (const ev of economy.drainEvents()) if (ev.kind === "unloaded") unloaded++;
    }
    expect(unloaded).toBeGreaterThan(0);
    expect(economy.lineLoadsLately(line.id)).toBe(unloaded);
    // A line no train runs carries nothing.
    expect(economy.lineLoadsLately(createLine(economy, [{ depotId: mill, action: "auto" }]).id)).toBe(0);
  });
});

describe("line names", () => {
  it("past eight lines the colours come round again, the names numbered so no two are the same", () => {
    const w = small();
    const names = Array.from({ length: 10 }, () => createLine(w.economy, [{ depotId: w.forest, action: "auto" }]).name);
    expect(names.slice(0, 2)).toEqual(["Red line", "Blue line"]);
    expect(new Set(names).size).toBe(10);
    expect(names[8]).toBe("Red line 2");
  });
});

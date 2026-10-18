import { describe, expect, it } from "vitest";
import { Economy } from "../economy";
import { Sim } from "../sim";
import { Layout } from "../track";
import { editLine, joinLine, LINE_COLOURS, LINE_NAME_MAX, lineOf, moveStop, recolourLine, renameLine, stopLine, trainsOn } from "./lines";

/** An economy with three depots on a straight line, and an engine. */
function world() {
  const layout = new Layout();
  const ids = (["depot-forest", "straight-216", "depot-sawmill", "straight-216", "station"] as const).map((t, i) => layout.addPiece(t, { x: i * 216, z: 0, heading: 0 }));
  const sim = new Sim(layout);
  const economy = new Economy(layout, sim);
  const forest = economy.addDepot("forest", ids[0], 0).id;
  const mill = economy.addDepot("sawmill", ids[2], 0).id;
  const town = economy.addDepot("town", ids[4], 0).id;
  const r = sim.addTrain(["engine"], { pieceId: ids[1], pathIndex: 0, reversed: false, s: 100 });
  if (r.kind !== "placed") throw new Error();
  return { economy, sim, engine: sim.getTrain(r.trainId)!.cars[0].id, forest, mill, town };
}

describe("lines", () => {
  it("a train's first stop makes it a line, with a colour and a name; its route is the line's stops", () => {
    const w = world();
    const line = editLine(w.economy, w.engine, (s) => s.push({ depotId: w.forest, action: "auto" }))!;
    expect(line.colour).toBe(LINE_COLOURS[0].colour);
    expect(line.name).toBe("Red line");
    expect(w.economy.routeOf(w.engine)!.stops).toBe(line.stops);
    expect(w.economy.lineOfCar(w.engine)).toEqual({ stops: [{ depot: w.forest, intent: "auto", waitFill: false }] });
    // A second train's line takes the next colour.
    const r = w.sim.addTrain(["engine"], { pieceId: w.economy.depot(w.town)!.pieceId, pathIndex: 0, reversed: false, s: 100 });
    if (r.kind !== "placed") throw new Error();
    const other = editLine(w.economy, w.sim.getTrain(r.trainId)!.cars[0].id, (s) => s.push({ depotId: w.town, action: "auto" }))!;
    expect(other.name).toBe("Blue line");
  });

  it("editing keeps the train heading for the stop it was; emptied, the line goes and the train goes anywhere", () => {
    const w = world();
    editLine(w.economy, w.engine, (s) => s.push({ depotId: w.forest, action: "auto" }, { depotId: w.mill, action: "auto" }, { depotId: w.town, action: "drop" }));
    w.economy.routeOf(w.engine)!.next = 2;
    // A stop before it taken off: still heading for the town (now stop 1).
    editLine(w.economy, w.engine, (s) => s.splice(0, 1));
    expect(w.economy.routeOf(w.engine)!.next).toBe(1);
    expect(w.economy.routeOf(w.engine)!.stops[1].depotId).toBe(w.town);
    // Reordered: still the town.
    editLine(w.economy, w.engine, (s) => moveStop(s, 1, 0));
    expect(w.economy.routeOf(w.engine)!.stops[w.economy.routeOf(w.engine)!.next].depotId).toBe(w.town);
    // The stop it was heading for taken off: the one now in its place.
    editLine(w.economy, w.engine, (s) => s.splice(0, 1));
    expect(w.economy.routeOf(w.engine)!.next).toBe(0);
    expect(editLine(w.economy, w.engine, (s) => s.splice(0))).toBe(null);
    expect(w.economy.routeOf(w.engine)).toBeUndefined();
    expect(lineOf(w.economy, w.engine)).toBeUndefined();
    expect(w.economy.lines.size).toBe(0);
  });

  it("stopLine: the train goes anywhere, and the line no train runs is forgotten", () => {
    const w = world();
    editLine(w.economy, w.engine, (s) => s.push({ depotId: w.forest, action: "auto" }));
    stopLine(w.economy, w.engine);
    expect(w.economy.routeOf(w.engine)).toBeUndefined();
    expect(w.economy.lines.size).toBe(0);
  });

  it("an engine taken off the map takes its line with it (pruned)", () => {
    const w = world();
    editLine(w.economy, w.engine, (s) => s.push({ depotId: w.forest, action: "auto" }));
    w.sim.removeTrain(w.sim.trainIds()[0]);
    w.economy.prune();
    expect(w.economy.lines.size).toBe(0);
    expect(w.economy.lineIdOf.size).toBe(0);
  });

  it("several trains run one line: an edit keeps each heading for its own stop; one leaving keeps the line for the rest", () => {
    const w = world();
    const line = editLine(w.economy, w.engine, (s) => s.push({ depotId: w.forest, action: "auto" }, { depotId: w.mill, action: "auto" }, { depotId: w.town, action: "auto" }))!;
    const r = w.sim.addTrain(["engine"], { pieceId: w.economy.depot(w.town)!.pieceId, pathIndex: 0, reversed: false, s: 100 });
    if (r.kind !== "placed") throw new Error();
    const second = w.sim.getTrain(r.trainId)!.cars[0].id;
    expect(joinLine(w.economy, second, line.id)).toBe(line);
    expect(trainsOn(w.economy, line.id).sort()).toEqual([w.engine, second].sort());
    expect(w.economy.routeOf(second)!.stops).toBe(line.stops);
    w.economy.routeOf(w.engine)!.next = 1;
    w.economy.routeOf(second)!.next = 2;
    // The first stop taken off: each still heading for its own (mill, town).
    editLine(w.economy, second, (s) => s.splice(0, 1));
    expect(line.stops[w.economy.routeOf(w.engine)!.next].depotId).toBe(w.mill);
    expect(line.stops[w.economy.routeOf(second)!.next].depotId).toBe(w.town);
    // One leaves: the other still runs it.
    stopLine(w.economy, w.engine);
    expect(w.economy.lines.has(line.id)).toBe(true);
    expect(trainsOn(w.economy, line.id)).toEqual([second]);
    // Emptied: every train on it goes anywhere again.
    joinLine(w.economy, w.engine, line.id);
    expect(editLine(w.economy, w.engine, (s) => s.splice(0))).toBe(null);
    expect(w.economy.routeOf(second)).toBeUndefined();
    expect(w.economy.lines.size).toBe(0);
  });

  it("a line can be renamed and recoloured (its name follows its colour while it's the colour's own)", () => {
    const w = world();
    const line = editLine(w.economy, w.engine, (s) => s.push({ depotId: w.forest, action: "auto" }))!;
    recolourLine(w.economy, line.id, LINE_COLOURS[3].colour);
    expect(line.colour).toBe(LINE_COLOURS[3].colour);
    expect(line.name).toBe("Green line");
    renameLine(w.economy, line.id, "  Timber run  ");
    expect(line.name).toBe("Timber run");
    renameLine(w.economy, line.id, "   ");
    expect(line.name).toBe("Timber run");
    recolourLine(w.economy, line.id, LINE_COLOURS[1].colour);
    expect(line.name).toBe("Timber run");
    renameLine(w.economy, line.id, "x".repeat(60));
    expect(line.name).toHaveLength(LINE_NAME_MAX);
  });
});

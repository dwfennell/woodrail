import { describe, expect, it } from "vitest";
import { Economy } from "../economy";
import { Sim } from "../sim";
import { Layout } from "../track";
import { copyLine, editLine, joinLine, LINE_COLOURS, LINE_NAME_MAX, lineOf, moveStop, recolourLine, renameLine, restoreLines, reverseStops, sameLines, snapshotLines, stopLine, trainsOn } from "./lines";

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

  it("a line's second stop: the train heads for the stop it comes to first along its way, not the first tapped (play-test 2026-11-01)", () => {
    // (The engine is between the forest, behind it, and the sawmill, ahead.)
    const w = world();
    editLine(w.economy, w.engine, (s) => s.push({ depotId: w.forest, action: "auto" }));
    expect(w.economy.routeOf(w.engine)!.next).toBe(0);
    editLine(w.economy, w.engine, (s) => s.push({ depotId: w.mill, action: "auto" }));
    expect(w.economy.routeOf(w.engine)!.next).toBe(1);
    // (A third stop after that: it keeps heading for the stop it was.)
    editLine(w.economy, w.engine, (s) => s.push({ depotId: w.town, action: "auto" }));
    expect(w.economy.routeOf(w.engine)!.next).toBe(1);
    // A train joining the line between the sawmill and the town, facing the sawmill: it heads for the sawmill (stop 1);
    // facing the town, for the town (stop 2).
    const id = lineOf(w.economy, w.engine)!.id;
    const between = [...w.economy.layout.pieceIds()][3];
    for (const [reversed, next] of [[true, 1], [false, 2]] as const) {
      const r = w.sim.addTrain(["engine"], { pieceId: between, pathIndex: 0, reversed, s: 108 });
      if (r.kind !== "placed") throw new Error();
      const other = w.sim.getTrain(r.trainId)!.cars[0].id;
      w.sim.setLever(other, 1);
      joinLine(w.economy, other, id);
      expect(w.economy.routeOf(other)!.next, reversed ? "facing the sawmill" : "facing the town").toBe(next);
      w.sim.removeTrain(r.trainId);
    }
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

  it("one of a line's trains taken off the map (Remove, or back in the box): the line counts only the rest at once", () => {
    // (Interaction prunes straight after taking it off: a count kept till the next track edit said "3 trains on it now".)
    const w = world();
    const line = editLine(w.economy, w.engine, (s) => s.push({ depotId: w.forest, action: "auto" }, { depotId: w.mill, action: "auto" }))!;
    const r = w.sim.addTrain(["engine"], { pieceId: w.economy.depot(w.town)!.pieceId, pathIndex: 0, reversed: false, s: 100 });
    if (r.kind !== "placed") throw new Error();
    const second = w.sim.getTrain(r.trainId)!.cars[0].id;
    joinLine(w.economy, second, line.id);
    expect(trainsOn(w.economy, line.id)).toHaveLength(2);
    w.sim.removeTrain(r.trainId);
    w.economy.prune();
    expect(trainsOn(w.economy, line.id)).toEqual([w.engine]);
    expect(w.economy.lineIdOf.has(second)).toBe(false);
    expect(w.economy.routeOf(second)).toBeUndefined();
    expect(w.economy.sectionWait(second)).toBe(null);
    expect(w.economy.lines.has(line.id)).toBe(true);
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

/** A route edit as the card makes one undoable (main.ts `routeEdit`): its snapshots before and after, undo and redo. */
function undoable(w: ReturnType<typeof world>, change: () => void) {
  const before = snapshotLines(w.economy);
  change();
  const after = snapshotLines(w.economy);
  return { changed: !sameLines(before, after), undo: () => restoreLines(w.economy, before, after), redo: () => restoreLines(w.economy, after, before) };
}

describe("route edits undone (audit F1)", () => {
  it("a stop added, undone: the route as it was, the train heading where it did; redone: the stop back", () => {
    const w = world();
    editLine(w.economy, w.engine, (s) => s.push({ depotId: w.forest, action: "auto" }));
    // (Its second stop sends it to the stop it comes to first: the sawmill, ahead.)
    const add = undoable(w, () => editLine(w.economy, w.engine, (s) => s.push({ depotId: w.mill, action: "auto" })));
    expect(add.changed).toBe(true);
    expect(w.economy.routeOf(w.engine)!.next).toBe(1);
    const line = lineOf(w.economy, w.engine)!;
    add.undo();
    expect(lineOf(w.economy, w.engine)).toBe(line);
    expect(line.stops.map((s) => s.depotId)).toEqual([w.forest]);
    expect(w.economy.routeOf(w.engine)!.stops).toBe(line.stops);
    expect(w.economy.routeOf(w.engine)!.next).toBe(0);
    add.redo();
    expect(line.stops.map((s) => s.depotId)).toEqual([w.forest, w.mill]);
    expect(w.economy.routeOf(w.engine)!.next).toBe(1);
  });

  it("a stop's mode and its via points come back as they were", () => {
    const w = world();
    editLine(w.economy, w.engine, (s) => s.push({ depotId: w.forest, action: "auto", via: [7] }, { depotId: w.mill, action: "drop", waitFill: true }));
    const line = lineOf(w.economy, w.engine)!;
    const e = undoable(w, () =>
      editLine(w.economy, w.engine, (s) => {
        s[0].via!.push(8);
        s[1].action = "pick";
        delete s[1].waitFill;
      }),
    );
    e.undo();
    expect(line.stops).toEqual([{ depotId: w.forest, action: "auto", via: [7] }, { depotId: w.mill, action: "drop", waitFill: true }]);
    e.redo();
    expect(line.stops).toEqual([{ depotId: w.forest, action: "auto", via: [7, 8] }, { depotId: w.mill, action: "pick" }]);
  });

  it("Leave on a line's only train, undone: the line is back, with its name, colour and stops, and the train on it", () => {
    const w = world();
    editLine(w.economy, w.engine, (s) => s.push({ depotId: w.forest, action: "auto" }, { depotId: w.mill, action: "auto" }));
    const line = lineOf(w.economy, w.engine)!;
    renameLine(w.economy, line.id, "Logs");
    const next = w.economy.routeOf(w.engine)!.next;
    const leave = undoable(w, () => stopLine(w.economy, w.engine));
    expect(w.economy.lines.size).toBe(0);
    leave.undo();
    expect(lineOf(w.economy, w.engine)).toBe(line);
    expect(line.name).toBe("Logs");
    expect(w.economy.routeOf(w.engine)).toMatchObject({ stops: line.stops, next });
    leave.redo();
    expect(w.economy.lines.size).toBe(0);
    expect(w.economy.routeOf(w.engine)).toBeUndefined();
  });

  it("a train that has run on since the edit keeps heading for its stop; nothing changed, nothing recorded", () => {
    const w = world();
    editLine(w.economy, w.engine, (s) => s.push({ depotId: w.forest, action: "auto" }, { depotId: w.mill, action: "auto" }));
    const add = undoable(w, () => editLine(w.economy, w.engine, (s) => s.push({ depotId: w.town, action: "auto" })));
    // (It passed the sawmill meanwhile: now heading for the town, stop 2.)
    w.economy.routeOf(w.engine)!.next = 2;
    add.undo();
    // (The town's off the line now: it heads for the stop it comes to first.)
    expect(lineOf(w.economy, w.engine)!.stops.length).toBe(2);
    expect(w.economy.routeOf(w.engine)!.next).toBeLessThan(2);
    expect(undoable(w, () => editLine(w.economy, w.engine, () => {})).changed).toBe(false);
  });
});

describe("copying and reversing a line (the route UX audit, heuristic 7)", () => {
  it("reverseStops: the order the other way round, each leg's via points on the stop it now leaves, reversed", () => {
    const stops = [
      { depotId: 1, action: "auto" as const, via: [10, 11] },
      { depotId: 2, action: "drop" as const },
      { depotId: 3, action: "pick" as const, waitFill: true, via: [30] },
    ];
    reverseStops(stops);
    // (Legs were 1→2 by 10, 11; 2→3 none; 3→1 by 30. Now 3→2 none, 2→1 by 11, 10, and 1→3 by 30.)
    expect(stops).toEqual([
      { depotId: 3, action: "pick", waitFill: true },
      { depotId: 2, action: "drop", via: [11, 10] },
      { depotId: 1, action: "auto", via: [30] },
    ]);
    // Twice: as it was.
    reverseStops(stops);
    expect(stops).toEqual([
      { depotId: 1, action: "auto", via: [10, 11] },
      { depotId: 2, action: "drop" },
      { depotId: 3, action: "pick", waitFill: true, via: [30] },
    ]);
  });

  it("Reverse on a line: its train keeps heading for its stop; undone, the line is as it was", () => {
    const w = world();
    const line = editLine(w.economy, w.engine, (s) => s.push({ depotId: w.forest, action: "auto" }, { depotId: w.mill, action: "drop" }, { depotId: w.town, action: "auto", via: [42] }))!;
    w.economy.routeOf(w.engine)!.next = 1;
    const before = snapshotLines(w.economy);
    editLine(w.economy, w.engine, reverseStops);
    expect(line.stops.map((s) => s.depotId)).toEqual([w.town, w.mill, w.forest]);
    const r = w.economy.routeOf(w.engine)!;
    expect(r.stops[r.next].depotId).toBe(w.mill);
    const after = snapshotLines(w.economy);
    restoreLines(w.economy, before, after);
    expect(line.stops.map((s) => ({ d: s.depotId, via: s.via }))).toEqual([{ d: w.forest, via: undefined }, { d: w.mill, via: undefined }, { d: w.town, via: [42] }]);
  });

  it("copyLine: a new line in the next colour with the same stops (copies, not shared), run by the free train; undone, gone", () => {
    const w = world();
    const line = editLine(w.economy, w.engine, (s) => s.push({ depotId: w.forest, action: "pick", via: [7] }, { depotId: w.town, action: "drop", waitFill: true }))!;
    const r = w.sim.addTrain(["engine"], { pieceId: w.economy.depot(w.mill)!.pieceId, pathIndex: 0, reversed: false, s: 100 });
    if (r.kind !== "placed") throw new Error();
    const second = w.sim.getTrain(r.trainId)!.cars[0].id;
    const before = snapshotLines(w.economy);
    const copy = copyLine(w.economy, line.id, second)!;
    expect(copy.id).not.toBe(line.id);
    expect(copy.name).toBe("Blue line");
    expect(copy.stops).toEqual(line.stops);
    expect(copy.stops[0]).not.toBe(line.stops[0]);
    expect(copy.stops[0].via).not.toBe(line.stops[0].via);
    expect(lineOf(w.economy, second)).toBe(copy);
    expect(lineOf(w.economy, w.engine)).toBe(line);
    // (The copy's train, on the sawmill's piece facing on, comes to the town first.)
    const route = w.economy.routeOf(second)!;
    expect(route.stops[route.next].depotId).toBe(w.town);
    // Changing the copy leaves the first be.
    editLine(w.economy, second, reverseStops);
    expect(line.stops.map((s) => s.depotId)).toEqual([w.forest, w.town]);
    restoreLines(w.economy, before, snapshotLines(w.economy));
    expect(w.economy.lines.size).toBe(1);
    expect(lineOf(w.economy, second)).toBeUndefined();
  });
});


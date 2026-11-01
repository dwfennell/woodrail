import { describe, expect, it } from "vitest";
import { Sim, SIM_HZ } from "../sim";
import { appendPiece, connectorRef, Layout, type PieceTypeId } from "../track";
import { Editor } from "../editor/editor";
import { Economy } from "../economy/economy";
import { CARGO } from "../economy/cargo";
import { chain, loopOn } from "../economy/loop-fixtures";
import { editLine, joinLine, lineOf } from "./lines";
import { putAway } from "./put-away";
import { lostStopName, lostStopWords } from "./route-stops";

/**
 * A route survives any edit that leaves its stops on the map (the user: a planks train found with no route after a
 * loop was added at the end of its line, two routed lines sharing the track). Two lines, Red and Blue, both Forest →
 * Sawmill over one passing loop; edits made through the editor, as the draw and the tray make them, each followed by
 * `economy.prune()` (as every track edit's `Game.trackChanged` runs it).
 *
 *   ⊐ Forest ══ ══ S1 ══ main ══ S2 ══ ══ Sawmill ─ (open end)
 *                    ╲_ side _╱
 */
function world() {
  const layout = new Layout();
  const [forest, ...west] = chain(layout, ["depot-forest", "straight-216", "straight-216"]);
  appendPiece(layout, "buffer-turnback", false, connectorRef(forest, 0));
  const loop = loopOn(layout, connectorRef(west[1], 1), ["straight-216", "straight-216"], ["straight-216"]);
  const east = chain(layout, ["straight-216", "straight-216", "depot-sawmill"], connectorRef(loop.s2, 0));
  const sawmill = east[2];
  const sim = new Sim(layout);
  const economy = new Economy(layout, sim);
  const fixed = new Set([forest, sawmill]);
  const editor = new Editor(layout, sim, () => economy.prune(), (id) => fixed.has(id));
  const df = economy.addDepot("forest", forest, 0);
  const ds = economy.addDepot("sawmill", sawmill, 0);
  const put = (pieceId: number, reversed: boolean) => {
    const r = sim.addTrain(["engine", "timber"], { pieceId, pathIndex: 0, reversed, s: 100 });
    if (r.kind !== "placed") throw new Error("no room");
    const e = sim.getTrain(r.trainId)!.cars[0].id;
    sim.setLever(e, 1);
    return e;
  };
  const red = put(west[0], false);
  editLine(economy, red, (s) => s.push({ depotId: df.id, action: "auto" }, { depotId: ds.id, action: "auto" }));
  const blue = put(east[0], true);
  // (Blue: its own line, the same stops, as a second "Plan a route" makes it.)
  editLine(economy, blue, (s) => s.push({ depotId: df.id, action: "auto" }, { depotId: ds.id, action: "auto" }));
  economy.routeOf(blue)!.next = 0;
  let logs = 0;
  const run = (seconds: number) => {
    for (let i = 0; i < seconds * SIM_HZ; i++) {
      df.piles[CARGO.log.index] = Math.max(df.piles[CARGO.log.index], 6);
      sim.tick();
      economy.tick();
      for (const ev of economy.drainEvents()) if (ev.kind === "unloaded" && ev.depotId === ds.id) logs++;
    }
  };
  return { layout, sim, economy, editor, forest, sawmill, east, loop, df, ds, red, blue, run, delivered: () => logs };
}

type W = ReturnType<typeof world>;

/** Both trains still on their lines, each with both stops. */
function kept(w: W): { red: string; blue: string } {
  const of = (e: number) => {
    const line = lineOf(w.economy, e);
    const r = w.economy.routeOf(e);
    return `${line?.name ?? "no line"}:${r?.stops.length ?? 0}:${w.economy.routeOfCar(e) ? "routed" : "unrouted"}`;
  };
  return { red: of(w.red), blue: of(w.blue) };
}
const BOTH = { red: "Red line:2:routed", blue: "Blue line:2:routed" };

/** The pieces of `lay` laid on the scratch copy of the layout (where they'd go), taken off it again: for `placeRun`. */
function planned(layout: Layout, lay: () => number[]) {
  const ids = lay();
  const out = ids.map((id) => {
    const p = layout.getPiece(id)!;
    return { type: p.type as PieceTypeId, pose: { ...p.pose }, y: p.y, flipped: p.flipped };
  });
  for (const id of [...ids].reverse()) layout.removePiece(id);
  return out;
}

describe("a route survives edits near its stops", () => {
  it("a passing loop added at the end of the line, past the sawmill (and undone, redone)", () => {
    const w = world();
    w.run(20);
    const end = connectorRef(w.sawmill, 1);
    const pieces = planned(w.layout, () => {
      const l = loopOn(w.layout, end, ["straight-216", "straight-216"], ["straight-216"]);
      const b = appendPiece(w.layout, "buffer-turnback", false, connectorRef(l.s2, 0));
      return [l.s1, ...l.main, ...l.side, l.s2, b];
    });
    w.editor.placeRun(pieces);
    expect(kept(w)).toEqual(BOTH);
    w.run(30);
    w.editor.undo();
    expect(kept(w)).toEqual(BOTH);
    w.editor.redo();
    expect(kept(w)).toEqual(BOTH);
    const before = w.delivered();
    w.run(240);
    expect(kept(w)).toEqual(BOTH);
    expect(w.delivered()).toBeGreaterThan(before);
  });

  it("a straight next to the sawmill replaced (new piece ids at the stop), undone and redone", () => {
    const w = world();
    w.run(20);
    const at = w.east[1];
    const p = w.layout.getPiece(at)!;
    const pieces = planned(w.layout, () => {
      // (Two short straights where the long one was: laid on a copy's place, the long one off first.)
      const back = w.layout.joinedConnector(connectorRef(at, 0));
      w.layout.removePiece(at);
      const ids = chain(w.layout, ["straight-108", "straight-108"], back);
      return ids;
    });
    w.layout.restorePiece(at, p.type, p.pose, p.y, p.flipped);
    w.editor.replaceRun([at], pieces);
    expect(kept(w)).toEqual(BOTH);
    w.editor.undo();
    expect(kept(w)).toEqual(BOTH);
    w.editor.redo();
    expect(kept(w)).toEqual(BOTH);
    const before = w.delivered();
    w.run(240);
    expect(w.delivered()).toBeGreaterThan(before);
  });

  it("track laid on at the sawmill's open end, and taken up again", () => {
    const w = world();
    w.run(20);
    const pieces = planned(w.layout, () => chain(w.layout, ["straight-216", "curve-large"], connectorRef(w.sawmill, 1)));
    const ids = w.editor.placeRun(pieces);
    expect(kept(w)).toEqual(BOTH);
    w.editor.removeGroup(ids);
    expect(kept(w)).toEqual(BOTH);
    w.editor.undo();
    w.editor.undo();
    expect(kept(w)).toEqual(BOTH);
  });

  it("the sawmill taken up: its stop stays on the line (shown lost), and back with an undo", () => {
    const w = world();
    // (Before the trains have run: neither is on it, and the editor won't take up track a train is on.)
    expect(w.editor.remove(w.sawmill)).toBe(true);
    w.economy.prune();
    expect(lineOf(w.economy, w.red)?.stops.length).toBe(2);
    expect(w.economy.lostStops(w.red).map((s) => s.depotId)).toEqual([w.ds.id]);
    // The card says so, by name.
    expect(lostStopWords(lostStopName({ landscape: { towns: [] } as never, economy: w.economy }, w.ds.id))).toBe("Sawmill was taken up, so it's off the route");
    w.run(30);
    w.editor.undo();
    expect(kept(w)).toEqual(BOTH);
    expect(w.economy.lostStops(w.red)).toEqual([]);
  });

  it("put away, the only train on its line, and back with an undo: on its line again", () => {
    const w = world();
    w.run(5);
    const away = putAway(w.sim, w.economy, w.blue)!;
    w.economy.prune();
    expect(lineOf(w.economy, w.blue)).toBeUndefined();
    expect(away.restore()).toBe(true);
    w.economy.prune();
    expect(kept(w)).toEqual(BOTH);
  });

  it("put away, then the line's other train joins another line meanwhile; undone, it's back on its own line", () => {
    const w = world();
    const third = (() => {
      const r = w.sim.addTrain(["engine", "timber"], { pieceId: w.loop.side[1], pathIndex: 0, reversed: false, s: 100 });
      if (r.kind !== "placed") throw new Error("no room");
      return w.sim.getTrain(r.trainId)!.cars[0].id;
    })();
    joinLine(w.economy, third, lineOf(w.economy, w.blue)!.id);
    const away = putAway(w.sim, w.economy, w.blue)!;
    joinLine(w.economy, third, lineOf(w.economy, w.red)!.id);
    w.economy.prune();
    expect(away.restore()).toBe(true);
    expect(kept(w).blue).toBe("Blue line:2:routed");
  });

  it("a train picked up, another run into its spot while it's in the hand: put back nearby, on its line (`Sim.putBack`)", () => {
    const w = world();
    const t = w.sim.findCar(w.blue)!.train;
    const kinds = t.cars.map((c) => c.kind);
    const ids = t.cars.map((c) => c.id);
    const origin = { ...t.bogies[0] };
    // (As `beginTrainPickup`: told first, then lifted.)
    w.economy.prune();
    w.sim.removeTrain(t.id);
    // Another train put down where it stood.
    expect(w.sim.addTrain(["engine"], origin).kind).toBe("placed");
    expect(w.sim.addTrain(kinds, origin, ids).kind).toBe("no-room");
    expect(w.sim.putBack(kinds, origin, ids).kind).toBe("placed");
    w.economy.prune();
    expect(kept(w)).toEqual(BOTH);
  });
});

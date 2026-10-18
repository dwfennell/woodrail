import { describe, expect, it } from "vitest";
import { Editor } from "../editor/editor";
import { deserializeWorld, serializeWorld } from "../persist/save";
import { appendPiece, connectorRef, findSplice, getPieceDef, pathLength } from "../track";
import { workshops } from "./crafting";
import { depotSpot } from "./depot-footprint";
import { GOALS } from "./goals";
import { routeStops } from "./route-stops";
import { buildStarterWorld, syncIndustries, type World } from "./world";

/** The starter map with its first town's station run on by four long straights, and an editor on it. */
function setup(): { w: World; editor: Editor } {
  const w = buildStarterWorld();
  let last = w.stations.get(w.landscape.towns[0].id)!;
  for (let i = 0; i < 4; i++) last = appendPiece(w.layout, "straight-216", false, connectorRef(last, 1));
  syncIndustries(w, true);
  const fixed = new Set([...w.stations.values(), ...w.depots.values()]);
  return { w, editor: new Editor(w.layout, w.sim, () => syncIndustries(w, true), (id) => fixed.has(id)) };
}

/** Drop a workshop onto the line where it fits (as the tray drop does: in the straights' place), one undo step. */
function placeWorkshop(w: World, editor: Editor): number {
  const spot = depotSpot(w, "depot-workshop", [])!;
  const s = findSplice(w.layout, "depot-workshop", false, spot, spot.heading, 14);
  if (s.kind !== "splice") throw new Error("no splice");
  const id = editor.replace(s.covers, "depot-workshop", s.pose, s.y, false);
  syncIndustries(w, true);
  return id;
}

const roles = (w: World) => w.economy.allDepots().map((d) => `${d.role}:${d.pieceId}`);
const savedRoles = (w: World) => serializeWorld(w).depots.map((d) => `${d.role}:${d.pieceId}`);
const placeWorkshopGoal = GOALS.find((g) => g.id === "place-workshop")!;

describe("undoing and redoing a depot's placement keeps the economy in step", () => {
  it("place, undo, redo: allDepots, the save, the stops a line can take and the goal follow each time", () => {
    const { w, editor } = setup();
    const before = roles(w);
    const id = placeWorkshop(w, editor);
    const shop = w.economy.depotAtPiece(id)!;
    expect(roles(w)).toEqual([...before, `workshop:${id}`]);
    expect(savedRoles(w)).toContain(`workshop:${id}`);
    expect(workshops(w)).toEqual([shop]);
    expect(placeWorkshopGoal.check(w).done).toBe(true);
    shop.piles.fill(0);
    shop.piles[0] = 3;
    // A train whose route stops at the town's station and the workshop.
    const station = w.economy.depotAtPiece(w.stations.get(w.landscape.towns[0].id)!)!;
    const st = w.layout.getPiece(station.pieceId)!;
    const s = pathLength(getPieceDef(st.type, st.flipped).paths[0].geom) / 2;
    const placed = w.sim.addTrain(["engine"], { pieceId: station.pieceId, pathIndex: 0, reversed: false, s });
    if (placed.kind !== "placed") throw new Error("no room for the train");
    const engine = w.sim.getTrain(placed.trainId)!.cars[0].id;
    w.economy.setRoute(engine, { stops: [{ depotId: station.id, action: "drop" }, { depotId: shop.id, action: "drop" }], next: 1 });
    const savedStops = (x: World) => {
      const data = serializeWorld(x);
      return (data.lines ?? []).flatMap((l) => l.stops.map(([d]) => data.depots[d].pieceId));
    };
    expect(savedStops(w)).toEqual([station.pieceId, id]);

    editor.undo();
    // (QA: the undone depot stayed in allDepots.)
    expect(w.layout.getPiece(id)).toBeUndefined();
    expect(roles(w)).toEqual(before);
    expect(savedRoles(w)).toEqual(before);
    expect(routeStops(w).map((s) => s.depotId)).not.toContain(shop.id);
    expect(workshops(w)).toEqual([]);
    expect(placeWorkshopGoal.check(w).done).toBe(false);
    // Its train's line is saved with the station only.
    expect(savedStops(w)).toEqual([station.pieceId]);
    // Saved now and loaded back, it's not there either.
    const loaded = deserializeWorld(JSON.parse(JSON.stringify(serializeWorld(w))));
    expect(loaded.ok && loaded.value.economy.allDepots().map((d) => `${d.role}:${d.pieceId}`)).toEqual(before);

    editor.redo();
    expect(roles(w)).toEqual([...before, `workshop:${id}`]);
    // The same depot, its piles as they were.
    expect(w.economy.depotAtPiece(id)).toBe(shop);
    expect(shop.piles[0]).toBe(3);
    expect(savedRoles(w)).toContain(`workshop:${id}`);
    expect(routeStops(w).map((s) => s.depotId)).toContain(shop.id);
    expect(workshops(w)).toEqual([shop]);
    expect(placeWorkshopGoal.check(w).done).toBe(true);
    expect(savedStops(w)).toEqual([station.pieceId, id]);
    const again = deserializeWorld(JSON.parse(JSON.stringify(serializeWorld(w))));
    expect(again.ok && again.value.economy.allDepots().map((d) => `${d.role}:${d.pieceId}`)).toEqual([...before, `workshop:${id}`]);

    // Undo again, redo again: still in step (no second depot for the piece).
    editor.undo();
    editor.redo();
    expect(roles(w)).toEqual([...before, `workshop:${id}`]);
  });
});

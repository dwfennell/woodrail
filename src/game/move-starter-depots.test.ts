import { describe, expect, it } from "vitest";
import { Editor } from "../editor/editor";
import { FEAT_DEPOT } from "../landscape";
import { deserializeWorld, serializeWorld, type SaveData } from "../persist/save";
import { inUse } from "./progress";
import { buildStarterWorld, createWorld, freeMapDepot, movableMapDepot, movedMapDepotPiece, plotsForSale, syncMapDepots, unlockPlot, type World } from "./world";

/** Squares of the map marked as this depot's own. */
function depotSquares(w: World, depotId: number): number {
  const g = w.landscape.grid;
  let n = 0;
  g.forEachCell((i) => {
    if (g.feature[i] === FEAT_DEPOT && g.owner[i] === depotId) n++;
  });
  return n;
}

describe("the starter map's lumber yard and sawmill move as industries the player placed", () => {
  it("only the start's two are movable: not another map's depots, nor a bought plot's", () => {
    const w = buildStarterWorld(true);
    expect(w.landscape.depots.map((d) => d.kind)).toEqual(["sawmill", "forest"]);
    expect(movableMapDepot(w.landscape, 0)).toBe(true);
    expect(movableMapDepot(w.landscape, 1)).toBe(true);
    // (A plot bought later brings its own depots, which stay put.)
    let bought = 0;
    for (const p of plotsForSale(w.landscape)) {
      const got = unlockPlot(w, p.px, p.pz);
      for (const id of got?.depots ?? []) {
        expect(movableMapDepot(w.landscape, id)).toBe(false);
        bought++;
      }
      if (bought > 0) break;
    }
    expect(bought).toBeGreaterThan(0);
    const other = createWorld(12345, false);
    for (const d of other.landscape.depots) expect(movableMapDepot(other.landscape, d.id)).toBe(false);
  });

  it("the sawmill, freed and moved: its squares given up, its record following it, kept by a save and loaded there", () => {
    const w = buildStarterWorld(true);
    const pieceId = w.depots.get(0)!;
    const before = w.layout.getPiece(pieceId)!;
    expect(depotSquares(w, 0)).toBeGreaterThan(0);
    expect(movedMapDepotPiece(w, pieceId)).toBe(false);
    const revision = w.landscape.grid.revision;
    expect(freeMapDepot(w.landscape, 0)).toBe(true);
    // (Once only.)
    expect(freeMapDepot(w.landscape, 0)).toBe(false);
    expect(depotSquares(w, 0)).toBe(0);
    expect(depotSquares(w, 1)).toBeGreaterThan(0);
    expect(w.landscape.grid.revision).toBeGreaterThan(revision);
    expect(movedMapDepotPiece(w, pieceId)).toBe(true);
    // Moved (an editor's move, as a drop does) a long way along and turned round.
    const centreBefore = { ...w.landscape.depots[0].centre };
    const offset = { x: centreBefore.x - before.pose.x, z: centreBefore.z - before.pose.z };
    const to = { x: before.pose.x + 400, z: before.pose.z - 200, heading: before.pose.heading + Math.PI };
    const ed = new Editor(w.layout, w.sim, () => {});
    expect(ed.move(pieceId, to, 0, { pose: { ...before.pose }, y: before.y })).toBe(true);
    syncMapDepots(w);
    const d = w.landscape.depots[0];
    expect(d.piece).toEqual(to);
    // (Its centre the same way along it: turned round, the other way from its origin.)
    expect(d.centre.x).toBeCloseTo(to.x - offset.x, 6);
    expect(d.centre.z).toBeCloseTo(to.z - offset.z, 6);
    // Still the map's own: not one of the player's sawmills.
    expect(inUse(w, "piece:depot-sawmill")).toBe(0);
    const data = JSON.parse(JSON.stringify(serializeWorld(w))) as SaveData;
    const r = deserializeWorld(data);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const back = r.value;
    expect(back.landscape.depots[0].moved).toBe(true);
    const id = back.depots.get(0)!;
    expect(back.layout.getPiece(id)!.pose).toEqual(expect.objectContaining({ x: to.x, z: to.z }));
    expect(back.economy.depotAtPiece(id)?.role).toBe("sawmill");
    expect(depotSquares(back, 0)).toBe(0);
    expect(movedMapDepotPiece(back, id)).toBe(true);
    expect(inUse(back, "piece:depot-sawmill")).toBe(0);
    // Undone, it goes back where it was (its record too), and stays free to move.
    ed.undo();
    syncMapDepots(w);
    expect(w.landscape.depots[0].piece).toEqual({ x: before.pose.x, z: before.pose.z, heading: before.pose.heading });
    expect(w.landscape.depots[0].centre.x).toBeCloseTo(centreBefore.x, 6);
    expect(w.landscape.depots[0].centre.z).toBeCloseTo(centreBefore.z, 6);
  });

  it("an old save (no word of moving) loads with its starter yard and mill where they were, movable", () => {
    const w = buildStarterWorld(true);
    const data = JSON.parse(JSON.stringify(serializeWorld(w))) as SaveData;
    for (const d of data.landscape.depots) expect("moved" in d).toBe(false);
    const r = deserializeWorld(data);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const back = r.value;
    expect(depotSquares(back, 0)).toBeGreaterThan(0);
    expect(movableMapDepot(back.landscape, 0)).toBe(true);
    expect(movableMapDepot(back.landscape, 1)).toBe(true);
    expect(freeMapDepot(back.landscape, 1)).toBe(true);
    expect(depotSquares(back, 1)).toBe(0);
  });
});

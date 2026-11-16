import { describe, expect, it } from "vitest";
import { Economy, type RouteStopDef } from "../economy";
import { chain } from "../economy/loop-fixtures";
import { Sim } from "../sim";
import { appendPiece, connectorRef, Layout, type PieceTypeId } from "../track";
import { bestInsert, editLine, insertStop, keepAt, lineOf } from "./lines";

const S: PieceTypeId = "straight-216";
const C: PieceTypeId = "curve-large";

/**
 * A line with ends: ⊏ A ══ B ══ D ══ C ══ E ⊐ (buffers at both ends), each a depot. A line A → B → C, and a train on
 * it (the engine on the track between A and B, heading for B).
 */
function straight() {
  const layout = new Layout();
  const ids = chain(layout, ["depot-forest", S, "depot-sawmill", S, "depot-workshop", S, "depot-forest", S, "depot-sawmill"]);
  appendPiece(layout, "buffer-turnback", false, connectorRef(ids[0], 0));
  appendPiece(layout, "buffer-turnback", false, connectorRef(ids.at(-1)!, 1));
  const sim = new Sim(layout);
  const economy = new Economy(layout, sim);
  const at = (i: number, role: "forest" | "sawmill" | "workshop") => economy.addDepot(role, ids[i], 0).id;
  const d = { A: at(0, "forest"), B: at(2, "sawmill"), D: at(4, "workshop"), C: at(6, "forest"), E: at(8, "sawmill") };
  const r = sim.addTrain(["engine"], { pieceId: ids[1], pathIndex: 0, reversed: false, s: 100 });
  if (r.kind !== "placed") throw new Error();
  const engine = sim.getTrain(r.trainId)!.cars[0].id;
  sim.setLever(engine, 1);
  editLine(economy, engine, (s) => s.push(...[d.A, d.B, d.C].map((depotId): RouteStopDef => ({ depotId, action: "auto" }))));
  return { economy, sim, engine, ids, d };
}

/** A ring (an oval), one way round: A ══ B ══ (round) D ══ C ══ (round) back to A, a depot at each letter. */
function ring() {
  const layout = new Layout();
  const ids = chain(layout, ["depot-forest", S, "depot-sawmill", C, C, C, C, "depot-workshop", S, "depot-forest", C, C, C, C]);
  if (layout.joinedConnector(connectorRef(ids[0], 0)) === -1) throw new Error("the oval doesn't close");
  const sim = new Sim(layout);
  const economy = new Economy(layout, sim);
  const d = { A: economy.addDepot("forest", ids[0], 0).id, B: economy.addDepot("sawmill", ids[2], 0).id, D: economy.addDepot("workshop", ids[7], 0).id, C: economy.addDepot("forest", ids[9], 0).id };
  return { economy, ids, d };
}

const auto = (...depots: number[]): RouteStopDef[] => depots.map((depotId) => ({ depotId, action: "auto" }));

describe("a stop put in where it fits (route-insert)", () => {
  it("a place between two stops goes between them, not at the end", () => {
    const w = straight();
    const stops = lineOf(w.economy, w.engine)!.stops;
    expect(bestInsert(w.economy, stops, w.d.D)).toMatchObject({ at: 2, between: true });
  });

  it("a place past the line's end goes at the end; one already on the line too (A → B → A is asked for in order)", () => {
    const w = straight();
    const stops = lineOf(w.economy, w.engine)!.stops;
    expect(bestInsert(w.economy, stops, w.d.E)).toMatchObject({ at: 3, between: false });
    expect(bestInsert(w.economy, stops, w.d.B)).toMatchObject({ at: 3, between: false });
    // (Fewer than two stops: at the end, the order tapped.)
    expect(bestInsert(w.economy, stops.slice(0, 1), w.d.D).at).toBe(1);
  });

  it("on a ring, between the two stops it lies between going round", () => {
    const w = ring();
    expect(bestInsert(w.economy, auto(w.d.A, w.d.B, w.d.C), w.d.D)).toMatchObject({ at: 2, between: true });
    // (The other way round, C → B → A: D lies between C and B.)
    expect(bestInsert(w.economy, auto(w.d.C, w.d.B, w.d.A), w.d.D).at).toBe(1);
  });

  it("a via point past the new stop goes on with it; one before it stays", () => {
    const w = straight();
    // A → B (via ids[5], between D and C) → C: D goes after B, and the via (past D on the way) goes on with D.
    const stops = auto(w.d.A, w.d.B, w.d.C);
    stops[1].via = [w.ids[3], w.ids[5]];
    const fit = bestInsert(w.economy, stops, w.d.D);
    expect(fit).toMatchObject({ at: 2, keep: 1 });
    insertStop(stops, fit.at, { depotId: w.d.D, action: "auto" }, fit.keep);
    expect(stops.map((s) => [s.depotId, s.via ?? []])).toEqual([
      [w.d.A, []],
      [w.d.B, [w.ids[3]]],
      [w.d.D, [w.ids[5]]],
      [w.d.C, []],
    ]);
  });

  it("a stop put in by hand (the sheet's +) splits the via points the same way", () => {
    const w = straight();
    const stops = auto(w.d.A, w.d.B, w.d.C);
    stops[1].via = [w.ids[3], w.ids[5]];
    expect(keepAt(w.economy, stops, w.d.D, 2)).toBe(1);
    // (No via points: nothing to split.)
    expect(keepAt(w.economy, auto(w.d.A, w.d.B, w.d.C), w.d.D, 2)).toBe(0);
  });

  it("insertStop at 0 splits the last stop's vias (a line runs round); by default all stay", () => {
    const stops = auto(1, 2);
    stops[1].via = [7, 8];
    insertStop(stops, 0, { depotId: 3, action: "auto", via: [99] }, 1);
    expect(stops).toEqual([{ depotId: 3, action: "auto", via: [8] }, { depotId: 1, action: "auto" }, { depotId: 2, action: "auto", via: [7] }]);
    insertStop(stops, 3, { depotId: 4, action: "drop" });
    expect(stops.at(-1)).toEqual({ depotId: 4, action: "drop" });
    expect(stops[2].via).toEqual([7]);
  });

  it("a train keeps heading for the stop it was: the index moves with it", () => {
    const w = straight();
    const route = () => w.economy.routeOf(w.engine)!;
    // Heading for B (stop 1): a stop put in after B leaves it 1.
    expect(route().stops[route().next].depotId).toBe(w.d.B);
    const fit = bestInsert(w.economy, route().stops, w.d.D);
    editLine(w.economy, w.engine, (s) => insertStop(s, fit.at, { depotId: w.d.D, action: "auto" }, fit.keep));
    expect(route().stops.map((s) => s.depotId)).toEqual([w.d.A, w.d.B, w.d.D, w.d.C]);
    expect(route().next).toBe(1);
    // Heading for C (now stop 3): a stop put in before it, at 0, moves it to 4, still C.
    route().next = 3;
    editLine(w.economy, w.engine, (s) => insertStop(s, 0, { depotId: w.d.E, action: "auto" }));
    expect(route().next).toBe(4);
    expect(route().stops[route().next].depotId).toBe(w.d.C);
  });
});

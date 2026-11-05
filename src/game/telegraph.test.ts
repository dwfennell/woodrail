import { describe, expect, it } from "vitest";
import { Economy } from "../economy";
import type { Landscape } from "../landscape";
import { PropStore } from "../props/store";
import { Sim, SIM_HZ } from "../sim";
import { appendPiece, connectorRef, Layout, type PieceTypeId } from "../track";
import { lineOf, startLine } from "./lines";
import { LEVER_REACH, TELEGRAPH_POLE, WIRE_SPAN } from "./lineside";
import { callHome, calledLine, homeOf, trainsInReach } from "./telegraph";

/**
 * The Telegraph's train list and Call home: a closed oval of the game's own pieces with two towns' stations (Ashby on
 * one side, Brill on the other), a hand-run train going round, and a signal box (a point) by the track.
 */
function oval() {
  const layout = new Layout();
  const half: PieceTypeId[] = ["curve-large", "curve-large", "curve-large", "curve-large"];
  const sequence: PieceTypeId[] = [...half, "straight-216", "station", ...half, "straight-216", "station"];
  const ids: number[] = [];
  let last = -1;
  for (const type of sequence) {
    last = last === -1 ? layout.addPiece(type, { x: 0, z: 0, heading: 0 }) : appendPiece(layout, type, false, connectorRef(last, 1));
    ids.push(last);
  }
  const sim = new Sim(layout);
  const economy = new Economy(layout, sim);
  const ashby = economy.addDepot("town", ids[sequence.indexOf("station")], 0);
  const brill = economy.addDepot("town", ids[sequence.lastIndexOf("station")], 1);
  const landscape = { towns: [{ id: 0, name: "Ashby" }, { id: 1, name: "Brill" }] } as unknown as Landscape;
  const props = new PropStore();
  const world = { layout, sim, economy, landscape, props };
  const add = (pieceIndex: number, s = 50) => {
    const placed = sim.addTrain(["engine", "van"], { pieceId: ids[pieceIndex], pathIndex: 0, reversed: false, s });
    if (placed.kind !== "placed") throw new Error("no room");
    return { trainId: placed.trainId, engine: sim.getTrain(placed.trainId)!.cars[0].id };
  };
  const run = (seconds: number) => {
    for (let i = 0; i < seconds * SIM_HZ; i++) {
      sim.tick();
      economy.tick();
    }
  };
  const pose = (pieceIndex: number) => layout.getPiece(ids[pieceIndex])!.pose;
  const trainOf = (engine: number) => sim.findCar(engine)!.train;
  return { layout, sim, economy, world, props, ids, sequence, ashby, brill, add, run, pose, trainOf };
}

describe("Telegraph: the trains in a signal box's reach", () => {
  it("near the box only; with the Telegraph, near every pole wired to it too; nearest first, by their engines' names", () => {
    const o = oval();
    // One train by Ashby's station, one on the far side by Brill's.
    const near = o.add(o.sequence.indexOf("station"));
    const far = o.add(o.sequence.lastIndexOf("station"));
    const at = o.pose(o.sequence.indexOf("station"));
    const box = { x: at.x + 60, z: at.z + 120 };
    expect(trainsInReach(o.world, box.x, box.z, false).map((t) => t.engine)).toEqual([near.engine]);
    expect(trainsInReach(o.world, box.x, box.z, true).map((t) => t.engine)).toEqual([near.engine]);
    // A chain of poles from the box round to Brill's side (each within a span of the one before).
    const to = o.pose(o.sequence.lastIndexOf("station"));
    const steps = Math.ceil(Math.hypot(to.x - box.x, to.z - box.z) / (WIRE_SPAN - 100));
    for (let i = 1; i <= steps; i++) o.props.add(TELEGRAPH_POLE, { x: box.x + ((to.x - box.x) * i) / steps, z: box.z + ((to.z - box.z) * i) / steps, heading: 0, y: 0 });
    const both = trainsInReach(o.world, box.x, box.z, true);
    expect(both.map((t) => t.engine).sort((a, b) => a - b)).toEqual([near.engine, far.engine].sort((a, b) => a - b));
    expect(both.find((t) => t.engine === near.engine)!.name).toBe(o.sim.nameOf(near.engine));
    for (let i = 1; i < both.length; i++) expect(both[i].distance).toBeGreaterThanOrEqual(both[i - 1].distance);
    for (const t of both) expect(t.distance).toBeLessThanOrEqual(LEVER_REACH);
    // Without the Telegraph learned, the poles carry nothing.
    expect(trainsInReach(o.world, box.x, box.z, false).map((t) => t.engine)).toEqual([near.engine]);
  });

  it("wagons standing with no engine aren't listed: there's nothing to call", () => {
    const o = oval();
    const i = o.sequence.indexOf("station");
    const placed = o.sim.addTrain(["van"], { pieceId: o.ids[i], pathIndex: 0, reversed: false, s: 50 });
    expect(placed.kind).toBe("placed");
    const at = o.pose(i);
    expect(trainsInReach(o.world, at.x + 60, at.z + 120, true)).toEqual([]);
  });
});

describe("Telegraph: Call home", () => {
  it("a train on no line goes to the station it comes to first, on a line of its own, and stops there", () => {
    const o = oval();
    // Just past Brill's station, heading on round toward Ashby's.
    const t = o.add(0, 100);
    const home = homeOf(o.world, t.engine)!;
    expect(home.kind).toBe("station");
    const r = callHome(o.world, t.engine);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(lineOf(o.economy, t.engine)?.stops.map((s) => s.depotId)).toEqual([r.home.depotId]);
    expect(lineOf(o.economy, t.engine)?.name).toBe("Home");
    expect(calledLine("Puffin", r.home)).toBe(`Puffin is called home to ${r.home.name} station`);
    // The payoff: it runs there and stops, its lever off, and stays.
    o.run(30);
    const station = o.economy.depot(r.home.depotId)!.pieceId;
    expect([...o.sim.piecesUnder(o.trainOf(t.engine).id)]).toContain(station);
    expect(o.economy.drainCameHome()).toEqual([t.engine]);
    expect(o.trainOf(t.engine).cars[0].lever).toBe(0);
    o.run(30);
    expect(o.trainOf(t.engine).speed).toBe(0);
    expect([...o.sim.piecesUnder(o.trainOf(t.engine).id)]).toContain(station);
    expect(o.economy.homeCalls.size).toBe(0);
    // Sent on from its card (its lever on), it runs again.
    o.sim.setLever(t.engine, 1);
    o.run(5);
    expect(o.trainOf(t.engine).speed).toBeGreaterThan(0);
  }, 60_000);

  it("a train on a line goes back to its line's first stop (its depot), keeping its line, and stops there", () => {
    const o = oval();
    const t = o.add(o.sequence.indexOf("station"), 30);
    // Brill first, then Ashby: it's at Ashby now, heading on to Brill next time round.
    const line = startLine(o.economy, t.engine, [
      { depotId: o.brill.id, action: "auto" },
      { depotId: o.ashby.id, action: "auto" },
    ]);
    o.economy.setRoute(t.engine, { stops: line.stops, next: 1, at: false });
    expect(homeOf(o.world, t.engine)).toEqual({ depotId: o.brill.id, kind: "depot", name: "Brill" });
    const r = callHome(o.world, t.engine);
    expect(r.ok).toBe(true);
    expect(lineOf(o.economy, t.engine)).toBe(line);
    expect(o.economy.routeOf(t.engine)?.next).toBe(0);
    if (r.ok) expect(calledLine("Puffin", r.home)).toBe("Puffin is called home to Brill");
    // The payoff: it reaches Brill.
    let reached = false;
    for (let s = 0; s < 120 && !reached; s++) {
      o.run(1);
      reached = [...o.sim.piecesUnder(o.trainOf(t.engine).id)].includes(o.brill.pieceId) && !!o.economy.routeOf(t.engine)?.at;
    }
    expect(reached).toBe(true);
    o.run(10);
    expect(o.trainOf(t.engine).speed).toBe(0);
    expect([...o.sim.piecesUnder(o.trainOf(t.engine).id)]).toContain(o.brill.pieceId);
  }, 60_000);

  it("nothing to call: a derailed train, or one with no station anywhere", () => {
    const o = oval();
    const t = o.add(0, 100);
    o.trainOf(t.engine).derailed = true;
    expect(callHome(o.world, t.engine)).toEqual({ ok: false, why: "no-train" });
    expect(callHome(o.world, 12345)).toEqual({ ok: false, why: "no-train" });
  });
});

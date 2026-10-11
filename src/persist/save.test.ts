import { describe, expect, it } from "vitest";
import { buildStarterWorld, type World } from "../game/world";
import { appendPiece, connectorRef } from "../track";
import { connectedPairs } from "../landscape";
import { SIM_DT } from "../sim";
import { deserializeWorld, SAVE_VERSION, serializeWorld } from "./save";

/** The starter map with its first two towns joined by a line and a train running on it. */
function worldWithTrain(): World {
  const world = buildStarterWorld();
  const [a] = world.landscape.towns;
  let last = world.stations.get(a.id)!;
  const line: number[] = [];
  for (let i = 0; i < 4; i++) line.push((last = appendPiece(world.layout, "straight-216", false, connectorRef(last, 1))));
  const placed = world.sim.addTrain(["engine", "hopper", "passenger", "caboose"], { pieceId: line[1], pathIndex: 0, reversed: false, s: 120 });
  if (placed.kind === "placed") world.sim.setLever(world.sim.getTrain(placed.trainId)!.cars[0].id, 1);
  return world;
}

describe("save format v2", () => {
  it("round-trips the landscape, stations, track and trains", () => {
    const world = worldWithTrain();
    for (let i = 0; i < 2 / SIM_DT; i++) world.sim.tick();
    const r = deserializeWorld(JSON.parse(JSON.stringify(serializeWorld(world))));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const w = r.value;
    expect(Array.from(w.landscape.grid.height)).toEqual(Array.from(world.landscape.grid.height));
    expect(Array.from(w.landscape.grid.feature)).toEqual(Array.from(world.landscape.grid.feature));
    expect(w.landscape.towns.map((t) => t.name)).toEqual(world.landscape.towns.map((t) => t.name));
    expect([...w.stations]).toEqual([...world.stations]);
    expect(connectedPairs(w.layout, w.stations)).toEqual(connectedPairs(world.layout, world.stations));
    expect(w.layout.pieceCount).toBe(world.layout.pieceCount);
    expect(w.sim.trainCount).toBe(1);
    expect(w.sim.getTrain(w.sim.trainIds()[0])!.cars[0].lever).toBe(1);
  });

  it("rejects version 1 saves", () => {
    const r = deserializeWorld({ version: 1, pieces: [], switches: [], trains: [] });
    expect(r.ok).toBe(false);
  });

  it("rejects a save whose town station piece is missing", () => {
    const data = serializeWorld(worldWithTrain());
    data.pieces = data.pieces.filter((p) => p.id !== data.towns[0].stationPieceId);
    const r = deserializeWorld(JSON.parse(JSON.stringify(data)));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/town 0/);
  });

  it("rejects malformed data with a reason instead of throwing", () => {
    const r = deserializeWorld({ version: SAVE_VERSION, pieces: [{ id: "x" }] });
    expect(r.ok).toBe(false);
  });

  it("skips trains whose path index or distance is out of range", () => {
    const data = serializeWorld(worldWithTrain());
    data.trains[0].lead.pathIndex = 7;
    const r = deserializeWorld(JSON.parse(JSON.stringify(data)));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.sim.trainCount).toBe(0);
  });
});

describe("station binding", () => {
  it("rejects stations swapped between towns", () => {
    const data = serializeWorld(worldWithTrain());
    const [a, b] = data.towns;
    [a.stationPieceId, b.stationPieceId] = [b.stationPieceId, a.stationPieceId];
    expect(deserializeWorld(JSON.parse(JSON.stringify(data))).ok).toBe(false);
  });
});

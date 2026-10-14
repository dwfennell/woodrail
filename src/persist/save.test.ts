import { describe, expect, it } from "vitest";
import { RISER_HEIGHT } from "../track";
import { buildStarterWorld, unlockPlot, type World } from "../game/world";
import { appendPiece, connectorRef } from "../track";
import { connectedPairs, PLOT_CELLS, SURF_GRASS, SURF_LANE } from "../landscape";
import { encodeRoad, pieceOf } from "../roads";
import { SIM_DT } from "../sim";
import { deserializeWorld, SAVE_VERSION, serializeWorld, type SaveData } from "./save";

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

describe("save format", () => {
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

  it("keeps a train saved lying across another (after a crash), putting it back beside it", () => {
    const world = worldWithTrain();
    const data = JSON.parse(JSON.stringify(serializeWorld(world))) as SaveData;
    const t = data.trains[0];
    data.trains.push({ ...t, lead: { ...t.lead, s: t.lead.s - 40 } });
    const r = deserializeWorld(data);
    expect(r.ok && r.value.sim.trainCount).toBe(2);
  });

  it("keeps where a train delivers to", () => {
    const world = worldWithTrain();
    const engine = world.sim.getTrain(world.sim.trainIds()[0])!.cars[0];
    const town = world.economy.allDepots().find((d) => d.role === "town")!;
    world.economy.setDeliverTo(engine.id, town.id);
    const r = deserializeWorld(JSON.parse(JSON.stringify(serializeWorld(world))));
    if (!r.ok) throw new Error(r.error);
    const loaded = r.value.sim.getTrain(r.value.sim.trainIds()[0])!.cars[0];
    expect(r.value.economy.depot(r.value.economy.deliverToOf(loaded.id))?.pieceId).toBe(town.pieceId);
  });

  it("is at version 9 (a level is RISER_HEIGHT, not 64 mm)", () => {
    expect(SAVE_VERSION).toBe(9);
  });

  it("loads version 8 saves, their heights scaled from 64 mm levels to today's", () => {
    const world = worldWithTrain();
    const data = serializeWorld(world) as unknown as { version: number; pieces: { y: number }[] };
    data.version = 8;
    data.pieces.forEach((p, k) => (p.y = k === 0 ? 128 : 0));
    const r = deserializeWorld(data);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const ys = [...r.value.layout.pieceIds()].map((id) => r.value.layout.getPiece(id)!.y);
    expect(ys).toContain(2 * RISER_HEIGHT);
  });

  it("refuses version 7 saves (their landscape was only a seed)", () => {
    const data = serializeWorld(worldWithTrain()) as unknown as { version: number; landscape: unknown };
    data.version = 7;
    data.landscape = { seed: 7, starter: true };
    expect(deserializeWorld(JSON.parse(JSON.stringify(data))).ok).toBe(false);
  });

  it("loads the land as saved, not as the seed would make it", () => {
    const world = worldWithTrain();
    const g = world.landscape.grid;
    // An edit no generator would make: a hill on a corner square, a tree beside it.
    const i = g.index(-31, -23);
    g.height[i] = 3;
    const r = deserializeWorld(JSON.parse(JSON.stringify(serializeWorld(world))));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.landscape.grid.height[r.value.landscape.grid.index(-31, -23)]).toBe(3);
  });

  it("round-trips a world grown by a few plots: its land, towns, depots, economy and trains", () => {
    const world = worldWithTrain();
    for (const [px, pz] of [[1, 0], [1, -1], [-2, 0]] as const) expect(unlockPlot(world, px, pz)).not.toBeNull();
    const before = world.economy.allDepots().map((d) => [d.pieceId, d.role, d.townId]);
    world.economy.allDepots()[before.length - 1].piles[0] = 3;
    const r = deserializeWorld(JSON.parse(JSON.stringify(serializeWorld(world))));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const w = r.value;
    const g = world.landscape.grid;
    const h = w.landscape.grid;
    expect(h.plots).toEqual(g.plots);
    for (const k of ["height", "surface", "feature", "owner", "road"] as const) expect(Array.from(h[k].subarray(0, h.cellCount))).toEqual(Array.from(g[k].subarray(0, g.cellCount)));
    expect(w.landscape.towns).toEqual(world.landscape.towns);
    expect(w.landscape.depots).toEqual(world.landscape.depots);
    expect(w.landscape.fields).toEqual(world.landscape.fields);
    expect(w.landscape.nextBuildingId).toBe(world.landscape.nextBuildingId);
    expect([...w.stations]).toEqual([...world.stations]);
    expect([...w.depots]).toEqual([...world.depots]);
    expect(w.economy.allDepots().map((d) => [d.pieceId, d.role, d.townId])).toEqual(before);
    expect(w.economy.allDepots()[before.length - 1].piles[0]).toBe(world.economy.allDepots()[before.length - 1].piles[0]);
    expect(w.sim.trainCount).toBe(1);
  });

  it("rejects damaged land with a reason instead of throwing", () => {
    const good = serializeWorld(worldWithTrain());
    const cases: ((d: SaveData) => void)[] = [
      (d) => (d.landscape.plots[0].height = "!!"),
      (d) => (d.landscape.plots[0].height = d.landscape.plots[0].height.slice(0, 20)),
      (d) => (d.landscape.plots[1] = { ...d.landscape.plots[0] }),
      (d) => (d.landscape.towns[0].cells = [99999999]),
      (d) => (d.landscape.towns[1].id = 7),
      (d) => (d.landscape.nextBuildingId = 0),
      (d) => (d.depots = d.depots.slice(1)),
    ];
    for (const damage of cases) {
      const data = JSON.parse(JSON.stringify(good)) as SaveData;
      damage(data);
      const r = deserializeWorld(data);
      expect(r.ok).toBe(false);
    }
  });

  it("keeps road pieces, and gives lanes in saves from before road pieces theirs", () => {
    const world = worldWithTrain();
    const g = world.landscape.grid;
    const i = g.index(0, 0);
    g.setRoad(i, encodeRoad("zebra", 1));
    const data = JSON.parse(JSON.stringify(serializeWorld(world))) as SaveData;
    const r = deserializeWorld(data);
    expect(r.ok && r.value.landscape.grid.road[i]).toBe(encodeRoad("zebra", 1));
    // An old save: no road bytes. Its lanes get pieces, and the zebra becomes the plain piece that fits.
    for (const p of data.landscape.plots) delete p.road;
    const old = deserializeWorld(data);
    expect(old.ok).toBe(true);
    if (!old.ok) return;
    const h = old.value.landscape.grid;
    for (let k = 0; k < h.cellCount; k++) expect(h.road[k] !== 0).toBe(h.surface[k] === SURF_LANE);
    expect(pieceOf(h.road[i])).not.toBeNull();
  });

  it("refuses a road on a square that isn't a lane, or an unknown piece", () => {
    const world = worldWithTrain();
    const g = world.landscape.grid;
    const grass = Array.from({ length: PLOT_CELLS }, (_, k) => k).find((k) => g.surface[k] === SURF_GRASS)!;
    for (const bad of [encodeRoad("straight", 0), 63]) {
      const data = serializeWorld(world);
      const road = Uint8Array.from(atob(data.landscape.plots[0].road!), (c) => c.charCodeAt(0));
      road[grass] = bad;
      data.landscape.plots[0].road = btoa(String.fromCharCode(...road));
      expect(deserializeWorld(data).ok).toBe(false);
    }
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

describe("economy in saves", () => {
  /** The starter map with a timber train standing just before its forest yard, and some history. */
  function timberWorld(): World {
    const world = buildStarterWorld();
    const forest = world.landscape.depots.find((d) => d.kind === "forest")!;
    const pieceId = world.depots.get(forest.id)!;
    const p = world.layout.getPiece(pieceId)!.pose;
    const c = Math.cos(p.heading);
    const s = Math.sin(p.heading);
    const b1 = world.layout.addPiece("straight-216", { x: p.x - c * 216, z: p.z - s * 216, heading: p.heading });
    world.layout.addPiece("straight-216", { x: p.x - c * 432, z: p.z - s * 432, heading: p.heading });
    world.layout.addPiece("straight-216", { x: p.x + c * 216, z: p.z + s * 216, heading: p.heading });
    const placed = world.sim.addTrain(["engine", "timber", "timber"], { pieceId: b1, pathIndex: 0, reversed: false, s: 200 });
    if (placed.kind !== "placed") throw new Error("no room");
    const t = world.sim.getTrain(placed.trainId)!;
    world.sim.setLever(t.cars[0].id, 1);
    const d = world.economy.depotAtPiece(pieceId)!;
    d.piles[0] = 7;
    d.waitFull = true;
    world.economy.setCargo(t.cars[2].id, "log", 2);
    world.economy.delivered.set(1, 9);
    return world;
  }
  const step = (w: World, seconds: number) => {
    for (let i = 0; i < seconds / SIM_DT; i++) {
      w.sim.tick();
      w.economy.tick();
    }
  };
  const roundTrip = (w: World) => {
    const r = deserializeWorld(JSON.parse(JSON.stringify(serializeWorld(w))));
    if (!r.ok) throw new Error(r.error);
    return r.value;
  };

  it("round-trips piles, timers, switches, cargo on wagons and deliveries", () => {
    const world = timberWorld();
    step(world, 3);
    const w = roundTrip(world);
    for (const d of world.economy.allDepots()) {
      const e = w.economy.depot(d.id)!;
      expect([e.role, e.pieceId, e.auto, e.waitFull, e.timer, Array.from(e.piles)]).toEqual([d.role, d.pieceId, d.auto, d.waitFull, d.timer, Array.from(d.piles)]);
    }
    const cargo = (x: World) => x.sim.trainIds().flatMap((id) => x.sim.getTrain(id)!.cars.map((c) => x.economy.cargoOf(c.id)));
    expect(cargo(w)).toEqual(cargo(world));
    expect(w.economy.delivered.get(1)).toBe(9);
  });

  it("round-trips each car's look", () => {
    const world = timberWorld();
    const t = world.sim.getTrain(world.sim.trainIds()[0])!;
    world.sim.setLook(t.cars[0].id, "diesel");
    const w = roundTrip(world);
    const looks = (x: World) => x.sim.trainIds().flatMap((id) => x.sim.getTrain(id)!.cars.map((c) => x.sim.lookOf(c.id)));
    expect(looks(w)).toEqual(looks(world));
    expect(looks(w)[0]).toBe("diesel");
  });

  it("loads piles a depot doesn't use as empty", () => {
    const world = timberWorld();
    const data = serializeWorld(world);
    const forest = world.economy.allDepots().find((d) => d.role === "forest")!;
    // An older save's two piles (logs, planks), the planks pile one a forest doesn't use.
    data.depots[forest.id].piles = [3, 12];
    const r = deserializeWorld(JSON.parse(JSON.stringify(data)));
    expect(r.ok).toBe(true);
    if (r.ok) expect(Array.from(r.value.economy.depot(forest.id)!.piles)).toEqual([3, 0, 0, 0, 0]);
  });

  it("a train saved half way through loading carries on loading after a load", () => {
    const world = timberWorld();
    // Run until the crane is working on the first wagon.
    let i = 0;
    while (world.economy.servicedCar(0) === -1 && world.economy.allDepots().every((d) => world.economy.servicedCar(d.id) === -1) && i++ < 60 / SIM_DT) step(world, SIM_DT);
    step(world, 1.5);
    const w = roundTrip(world);
    const wagons = (x: World) => x.sim.getTrain(x.sim.trainIds()[0])!.cars.filter((c) => c.kind === "timber");
    const before = w.economy.cargoOf(wagons(w)[0].id).count;
    step(w, 10);
    expect(w.economy.cargoOf(wagons(w)[0].id).count).toBeGreaterThan(before);
  });
});

describe("props in saves", () => {
  it("round-trip with their ids, and saves without props load with no placed models", () => {
    const world = buildStarterWorld();
    world.props.add("bldg-red-barn", { x: 100, z: 50, heading: 0.5, y: 0 });
    world.props.add("life-cow", { x: -40, z: 10, heading: 2, y: 64 });
    const data = JSON.parse(JSON.stringify(serializeWorld(world))) as SaveData;
    const r = deserializeWorld(data);
    expect(r.ok && [...r.value.props.all()]).toEqual([...world.props.all()]);
    // New props after loading don't reuse ids.
    const top = Math.max(...[...world.props.all()].map((p) => p.id));
    if (r.ok) expect(r.value.props.add("life-dog", { x: 0, z: 0, heading: 0, y: 0 }).id).toBe(top + 1);
    // A save from before props: no placed models (its towns get their buildings' models).
    delete data.props;
    const old = deserializeWorld(data);
    expect(old.ok && [...old.value.props.all()].filter((p) => p.building === undefined).length).toBe(0);
  });
});

import { describe, expect, it, vi } from "vitest";
import { buildStarterWorld, schoolTown, syncIndustries, unlockPlot, type World } from "../game/world";
import { appendPiece, connectorRef, LIFT_RISE } from "../track";
import { connectedPairs, PLOT_CELLS, SURF_GRASS, SURF_LANE } from "../landscape";
import { encodeRoad, pieceOf } from "../roads";
import { SIM_DT, SIM_HZ } from "../sim";
import { backupKey, deserializeWorld, hasOlderSave, loadFromStorage, loadSession, OLDER_SAVE, SAVE_VERSION, saveSession, saveToStorage, serializeWorld, type SaveData } from "./save";
import { Journal } from "../game/journal";
import { editLine, lineOf } from "../game/lines";
import { CARGO_KINDS } from "../economy";

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

  it("keeps a train whose engine ran round to the other end: the order, the engine facing out, every car in place", () => {
    const world = worldWithTrain();
    const id = world.sim.trainIds()[0];
    const engine = world.sim.getTrain(id)!.cars[0].id;
    world.sim.setLever(engine, 0);
    expect(world.sim.runAround(engine)).toBe("ran-round");
    const before = world.sim.getTrain(id)!;
    const r = deserializeWorld(JSON.parse(JSON.stringify(serializeWorld(world))));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const t = r.value.sim.getTrain(r.value.sim.trainIds()[0])!;
    expect(t.cars.map((c) => c.kind)).toEqual(before.cars.map((c) => c.kind));
    expect(t.cars.map((c) => c.facing)).toEqual(before.cars.map((c) => c.facing));
    t.world.forEach((w, i) => expect(Math.hypot(w.x - before.world[i].x, w.z - before.world[i].z)).toBeLessThan(0.5));
  });

  it("keeps a train saved lying across another (after a crash), putting it back beside it", () => {
    const world = worldWithTrain();
    const data = JSON.parse(JSON.stringify(serializeWorld(world))) as SaveData;
    const t = data.trains[0];
    data.trains.push({ ...t, lead: { ...t.lead, s: t.lead.s - 40 } });
    const r = deserializeWorld(data);
    expect(r.ok && r.value.sim.trainCount).toBe(2);
  });

  it("keeps a train's route: its stops, what it does at each, and the one it heads for", () => {
    const world = worldWithTrain();
    const engine = world.sim.getTrain(world.sim.trainIds()[0])!.cars[0];
    const [town, other] = world.economy.allDepots().filter((d) => d.role === "town");
    world.economy.setRoute(engine.id, { stops: [{ depotId: town.id, action: "pick" }, { depotId: other.id, action: "drop" }], next: 1 });
    const r = deserializeWorld(JSON.parse(JSON.stringify(serializeWorld(world))));
    if (!r.ok) throw new Error(r.error);
    const loaded = r.value.sim.getTrain(r.value.sim.trainIds()[0])!.cars[0];
    const route = r.value.economy.routeOf(loaded.id)!;
    expect(route.next).toBe(1);
    expect(route.stops.map((s) => [r.value.economy.depot(s.depotId)!.pieceId, s.action])).toEqual([
      [town.pieceId, "pick"],
      [other.pieceId, "drop"],
    ]);
  });

  it("is at version 12 (research: the school depot), and turns older saves away, saying so", () => {
    expect(SAVE_VERSION).toBe(12);
    const data = serializeWorld(worldWithTrain()) as unknown as { version: number };
    data.version = 11;
    const r = deserializeWorld(data);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe(OLDER_SAVE);
  });

  it("keeps a running train's speed: it carries on as fast, not from a standstill (and a standing train stands)", () => {
    const world = worldWithTrain();
    for (let i = 0; i < 3 / SIM_DT; i++) world.sim.tick();
    const before = world.sim.getTrain(world.sim.trainIds()[0])!;
    expect(before.speed).toBeGreaterThan(50);
    const data = serializeWorld(world);
    const r = deserializeWorld(JSON.parse(JSON.stringify(data)));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.sim.getTrain(r.value.sim.trainIds()[0])!.speed).toBeCloseTo(before.speed, 1);
    // A save without speeds (older, or every train standing) loads them at rest.
    delete data.trains[0].speed;
    const old = deserializeWorld(JSON.parse(JSON.stringify(data)));
    expect(old.ok && old.value.sim.getTrain(old.value.sim.trainIds()[0])!.speed).toBe(0);
  });

  it("keeps the game's clock, its pause and the Journal beside a mode's autosave", () => {
    const store = new Map<string, string>();
    vi.stubGlobal("localStorage", { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) });
    try {
      let now = 0;
      const journal = new Journal(() => now);
      for (let i = 0; i < 32; i++) {
        now = i * 70_000;
        journal.add({ kind: "event", text: `Delivered ${i}`, key: `d${i % 3}`, qty: 2, place: { x: i, z: 10 - i } });
      }
      journal.markRead();
      journal.add({ kind: "milestone", text: "Larkfield grew" });
      expect(journal.unread).toBe(1);
      saveSession("game", { clock: 2240.5, paused: true, journal: journal.toJSON() });
      expect(loadSession("sandbox")).toBeNull();
      const s = loadSession("game")!;
      expect(s.clock).toBe(2240.5);
      expect(s.paused).toBe(true);
      const back = new Journal(() => now);
      back.restore(s.journal);
      expect(JSON.parse(JSON.stringify(back.entries))).toEqual(JSON.parse(JSON.stringify(journal.entries)));
      expect(back.unread).toBe(1);
      // News after loading counts as unread, on top.
      back.add({ kind: "event", text: "More" });
      expect(back.unread).toBe(2);
      expect(back.entries[0].text).toBe("More");
      // Damaged: none (start afresh), not a throw.
      store.set("woodrail.game.v2.session", "{");
      expect(loadSession("game")).toBeNull();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("an older autosave is kept aside under a backup key (not overwritten by the fresh map's), and the title knows", () => {
    const store = new Map<string, string>();
    vi.stubGlobal("localStorage", { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) });
    try {
      const data = serializeWorld(worldWithTrain()) as unknown as { version: number };
      // (A v11 save, from before research: turned away kindly, kept aside.)
      data.version = 11;
      const raw = JSON.stringify(data);
      store.set("woodrail.game.v2", raw);
      expect(hasOlderSave("game")).toBe(true);
      expect(hasOlderSave("sandbox")).toBe(false);
      const r = loadFromStorage("game");
      expect(r?.ok).toBe(false);
      if (r && !r.ok) expect(r.error).toBe(OLDER_SAVE);
      expect(store.get(backupKey("game", 11))).toBe(raw);
      // The fresh map saves over the autosave; the backup stays.
      expect(saveToStorage(worldWithTrain(), "game")).toBe(true);
      expect(hasOlderSave("game")).toBe(false);
      expect(store.get(backupKey("game", 11))).toBe(raw);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("keeps a school depot with the id of the town it's beside (and turns away one whose town doesn't match)", () => {
    const world = worldWithTrain();
    // On the line's far end from the station, beside a town.
    const end = appendPiece(world.layout, "depot-school", false, connectorRef([...world.layout.pieceIds()].at(-1)!, 1));
    syncIndustries(world, true);
    const school = world.economy.depotAtPiece(end)!;
    const town = schoolTown(world.landscape, world.layout.getPiece(end)!.pose)!.town;
    expect(school.role).toBe("school");
    expect(school.townId).toBe(town.id);
    const data = JSON.parse(JSON.stringify(serializeWorld(world))) as SaveData;
    const r = deserializeWorld(data);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.economy.depotAtPiece(end)).toMatchObject({ role: "school", townId: town.id });
    data.depots.find((d) => d.role === "school")!.townId = 99;
    expect(deserializeWorld(data).ok).toBe(false);
  });

  it("keeps lines: their colour, name and stops (wait to fill too), shared by the trains that run them", () => {
    const world = worldWithTrain();
    const engine = world.sim.getTrain(world.sim.trainIds()[0])!.cars[0];
    const [town, other] = world.economy.allDepots().filter((d) => d.role === "town");
    const line = editLine(world.economy, engine.id, (s) => s.push({ depotId: town.id, action: "auto", waitFill: true }, { depotId: other.id, action: "drop" }))!;
    line.name = "Timber run";
    world.economy.routeOf(engine.id)!.next = 1;
    const r = deserializeWorld(JSON.parse(JSON.stringify(serializeWorld(world))));
    if (!r.ok) throw new Error(r.error);
    const loaded = r.value.sim.getTrain(r.value.sim.trainIds()[0])!.cars[0];
    const back = lineOf(r.value.economy, loaded.id)!;
    expect(back).toMatchObject({ colour: line.colour, name: "Timber run" });
    expect(back.stops.map((s) => [r.value.economy.depot(s.depotId)!.pieceId, s.action, !!s.waitFill])).toEqual([
      [town.pieceId, "auto", true],
      [other.pieceId, "drop", false],
    ]);
    expect(r.value.economy.routeOf(loaded.id)!.stops).toBe(back.stops);
    expect(r.value.economy.routeOf(loaded.id)!.next).toBe(1);
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

  it("round-trips pinned switches; a save without them loads with none", () => {
    const world = buildStarterWorld();
    const [a] = world.landscape.towns;
    const station = world.stations.get(a.id)!;
    const sw = appendPiece(world.layout, "switch", false, connectorRef(station, 1));
    world.layout.setSwitchState(sw, 1);
    world.layout.setPinned(sw, true);
    const data = JSON.parse(JSON.stringify(serializeWorld(world))) as SaveData;
    expect(data.pinned).toEqual([sw]);
    const r = deserializeWorld(data);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.layout.isPinned(sw)).toBe(true);
    expect(r.value.layout.switchState(sw)).toBe(1);
    // An older save (no field): loads, nothing pinned; and nothing pinned saves no field.
    delete data.pinned;
    const old = deserializeWorld(data);
    expect(old.ok).toBe(true);
    if (!old.ok) return;
    expect(old.value.layout.isPinned(sw)).toBe(false);
    expect(old.value.layout.pinnedCount).toBe(0);
    expect("pinned" in serializeWorld(old.value)).toBe(false);
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
    if (r.ok) expect(Array.from(r.value.economy.depot(forest.id)!.piles)).toEqual([3, ...new Array(CARGO_KINDS.length - 1).fill(0)]);
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
    // A landmark drawn smaller than its model (on a smaller lot than it wants) keeps its scale.
    world.props.add("bldg-library", { x: 300, z: -50, heading: 0, y: 0 }, undefined, { scale: 0.85 });
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

describe("kit pieces in saves", () => {
  it("round-trip as pieces, and an old save's furnished platform prop stays a prop where it was", () => {
    const world = buildStarterWorld();
    const [a] = world.landscape.towns;
    const station = world.stations.get(a.id)!;
    const kit = appendPiece(world.layout, "kit-platform-furnished", false, connectorRef(station, 1));
    world.props.add("bldg-platform-furnished", { x: 300, z: 120, heading: 1, y: 0 });
    const data = JSON.parse(JSON.stringify(serializeWorld(world))) as SaveData;
    const r = deserializeWorld(data);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const piece = r.value.layout.getPiece(kit)!;
    expect(piece.type).toBe("kit-platform-furnished");
    expect(r.value.layout.joinedConnector(connectorRef(kit, 0))).toBe(connectorRef(station, 1));
    // The prop isn't turned into a kit: a plain prop, where it stood.
    const prop = [...r.value.props.all()].find((p) => p.asset === "bldg-platform-furnished")!;
    expect(prop).toMatchObject({ x: 300, z: 120, heading: 1 });
  });

  it("cargo kits round-trip with their depots (a loader and an unloader), and a train's route stops at them", () => {
    const world = buildStarterWorld();
    const [a] = world.landscape.towns;
    const station = world.stations.get(a.id)!;
    const loader = appendPiece(world.layout, "kit-log-loader", false, connectorRef(station, 1));
    const shed = appendPiece(world.layout, "kit-goods-shed", false, connectorRef(loader, 1));
    expect(syncIndustries(world)).toBe(true);
    const before = world.economy.allDepots().map((d) => ({ pieceId: d.pieceId, role: d.role }));
    expect(before).toContainEqual({ pieceId: loader, role: "loader-log" });
    expect(before).toContainEqual({ pieceId: shed, role: "unloader" });
    const data = JSON.parse(JSON.stringify(serializeWorld(world))) as SaveData;
    const r = deserializeWorld(data);
    expect(r.ok, r.ok ? "" : r.error).toBe(true);
    if (!r.ok) return;
    expect(r.value.economy.allDepots().map((d) => ({ pieceId: d.pieceId, role: d.role }))).toEqual(before);
    // The loader's heap is as full as ever; nothing new to add.
    expect(r.value.economy.depotAtPiece(loader)!.piles[CARGO_KINDS.indexOf("log")]).toBeGreaterThan(0);
    expect(syncIndustries(r.value)).toBe(false);
  });

  it("a turntable round-trips with its deck turned (a switch state past a three-way's)", () => {
    const world = buildStarterWorld();
    const [a] = world.landscape.towns;
    const station = world.stations.get(a.id)!;
    const table = appendPiece(world.layout, "kit-turntable", false, connectorRef(station, 1));
    world.layout.setSwitchState(table, 3);
    const data = JSON.parse(JSON.stringify(serializeWorld(world))) as SaveData;
    const r = deserializeWorld(data);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.layout.getPiece(table)!.type).toBe("kit-turntable");
    expect(r.value.layout.switchState(table)).toBe(3);
  });

  it("a train lift round-trips up or down, and a save mid-ride comes back at the end it was going to", () => {
    const world = buildStarterWorld();
    const [a] = world.landscape.towns;
    const station = world.stations.get(a.id)!;
    const near = appendPiece(world.layout, "straight-216", false, connectorRef(station, 1));
    const lift = appendPiece(world.layout, "kit-train-lift", false, connectorRef(near, 1));
    const high = appendPiece(world.layout, "straight-216", false, connectorRef(lift, 1));
    expect(world.layout.getPiece(high)!.y).toBe(LIFT_RISE);
    const placed = world.sim.addTrain(["engine", "passenger"], { pieceId: lift, pathIndex: 0, reversed: false, s: 250 });
    expect(placed.kind).toBe("placed");
    const id = placed.kind === "placed" ? placed.trainId : -1;
    const engine = world.sim.getTrain(id)!.cars[0].id;
    world.sim.setLever(engine, 1);
    const reload = () => {
      const r = deserializeWorld(JSON.parse(JSON.stringify(serializeWorld(world))));
      expect(r.ok, r.ok ? "" : r.error).toBe(true);
      if (!r.ok) throw new Error(r.error);
      return r.value;
    };
    // Down, a train halted on the platform: as it was.
    for (let i = 0; i < SIM_HZ / 2 && (i === 0 || world.sim.getTrain(id)!.speed > 0); i++) world.sim.tick();
    expect(world.sim.getTrain(id)!.speed).toBe(0);
    let w = reload();
    expect(w.layout.switchState(lift)).toBe(0);
    expect(w.sim.getTrain(w.sim.trainIds()[0])!.bogies.every((b) => b.pieceId === lift && b.pathIndex === 0)).toBe(true);
    // Mid-ride (sent up): it comes back up, the train on the upper road heading out, lever on, drawn a level up.
    expect(world.sim.toggleSwitch(lift)).toBe(true);
    for (let i = 0; i < SIM_HZ; i++) world.sim.tick();
    expect(world.sim.liftPosition(lift)).toBeGreaterThan(0);
    expect(world.sim.liftPosition(lift)).toBeLessThan(1);
    w = reload();
    expect(w.layout.switchState(lift)).toBe(1);
    expect(w.sim.liftPosition(lift)).toBe(1);
    const t = w.sim.getTrain(w.sim.trainIds()[0])!;
    expect(t.bogies.every((b) => b.pieceId === lift && b.pathIndex === 1 && b.reversed)).toBe(true);
    expect(t.world[0].y).toBeCloseTo(LIFT_RISE, 6);
    expect(t.cars[0].lever).toBe(1);
    // And it drives off the top.
    for (let i = 0; i < 4 * SIM_HZ; i++) w.sim.tick();
    expect(w.sim.getTrain(w.sim.trainIds()[0])!.bogies[0].pieceId).toBe(high);
    expect(w.sim.getTrain(w.sim.trainIds()[0])!.derailed).toBe(false);
  });

  it("an old save's held-back props (now kits) load unchanged, as props where they were", () => {
    const world = buildStarterWorld();
    const old = ["bldg-engine-shed", "bldg-castle-gate", "mech-log-loader", "mech-water-crane", "mech-weighbridge", "bldg-grand-terminus", "mech-turntable", "mech-transfer-table", "mech-train-wash"];
    old.forEach((asset, i) => world.props.add(asset, { x: 200 + i * 150, z: 600, heading: 0.5, y: 0 }));
    const data = JSON.parse(JSON.stringify(serializeWorld(world))) as SaveData;
    const r = deserializeWorld(data);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const props = [...r.value.props.all()].filter((p) => old.includes(p.asset));
    expect(props.map((p) => p.asset).sort()).toEqual([...old].sort());
    for (const p of props) expect(p).toMatchObject({ x: 200 + old.indexOf(p.asset) * 150, z: 600, heading: 0.5 });
    // No kit pieces made of them.
    expect([...r.value.layout.pieceIds()].some((id) => r.value.layout.getPiece(id)!.type.startsWith("kit-"))).toBe(false);
  });

  it("signal skins and the buffer-stop lamp round-trip as pieces, with their signals' holds (a gantry's both: state 3)", () => {
    const world = buildStarterWorld();
    const [a] = world.landscape.towns;
    const station = world.stations.get(a.id)!;
    const sem = appendPiece(world.layout, "kit-semaphore-signal", false, connectorRef(station, 1));
    const light = appendPiece(world.layout, "kit-colour-light-signal", false, connectorRef(sem, 1));
    const gantry = appendPiece(world.layout, "kit-signal-gantry", false, connectorRef(light, 1));
    const lamp = appendPiece(world.layout, "kit-buffer-stop-lamp", false, connectorRef(gantry, 1));
    world.sim.toggleSignal(sem, 0);
    world.sim.toggleSignal(gantry, 0);
    world.sim.toggleSignal(gantry, 1);
    const w = roundTripOf(world);
    expect([sem, light, gantry, lamp].map((id) => w.layout.getPiece(id)!.type)).toEqual(["kit-semaphore-signal", "kit-colour-light-signal", "kit-signal-gantry", "kit-buffer-stop-lamp"]);
    expect([w.layout.switchState(sem), w.layout.switchState(light), w.layout.switchState(gantry)]).toEqual([1, 0, 3]);
    expect([w.sim.signalHeld(gantry, 0), w.sim.signalHeld(gantry, 1)]).toEqual([true, true]);
    expect(w.layout.joinedConnector(connectorRef(lamp, 0))).toBe(connectorRef(gantry, 1));
  });

  it("old saves load unchanged: a plain signal held at red, buffers, and the held-back signal and crossing models as props", () => {
    const world = buildStarterWorld();
    const [a] = world.landscape.towns;
    const station = world.stations.get(a.id)!;
    const signal = appendPiece(world.layout, "signal", false, connectorRef(station, 1));
    const buffer = appendPiece(world.layout, "buffer-turnback", false, connectorRef(signal, 1));
    world.sim.toggleSwitch(signal);
    const old = ["mech-semaphore-signal", "mech-colour-light-signal", "mech-signal-gantry", "mech-buffer-stop-lamp", "mech-level-crossing", "mech-gated-crossing"];
    old.forEach((asset, i) => world.props.add(asset, { x: 200 + i * 150, z: 600, heading: 0.5, y: 0 }));
    const data = JSON.parse(JSON.stringify(serializeWorld(world))) as SaveData;
    // (As an older build wrote it: nothing in it is new.)
    expect(data.switches).toContainEqual([signal, 1]);
    const r = deserializeWorld(data);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.layout.getPiece(signal)!.type).toBe("signal");
    expect(r.value.layout.getPiece(buffer)!.type).toBe("buffer-turnback");
    expect(r.value.sim.signalHeld(signal)).toBe(true);
    const props = [...r.value.props.all()].filter((p) => old.includes(p.asset));
    expect(props.map((p) => p.asset).sort()).toEqual([...old].sort());
    for (const p of props) expect(p).toMatchObject({ x: 200 + old.indexOf(p.asset) * 150, z: 600, heading: 0.5 });
    expect([...r.value.layout.pieceIds()].some((id) => r.value.layout.getPiece(id)!.type.startsWith("kit-"))).toBe(false);
    // And saved again, the same.
    expect(JSON.parse(JSON.stringify(serializeWorld(r.value)))).toEqual(data);
  });
});

function roundTripOf(w: World): World {
  const r = deserializeWorld(JSON.parse(JSON.stringify(serializeWorld(w))));
  if (!r.ok) throw new Error(r.error);
  return r.value;
}

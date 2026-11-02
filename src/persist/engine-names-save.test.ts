import { describe, expect, it } from "vitest";
import { buildStarterWorld, type World } from "../game/world";
import { appendPiece, connectorRef } from "../track";
import { ENGINE_NAMES } from "../sim";
import { deserializeWorld, serializeWorld, type SaveData } from "./save";

/** The starter map with a line of track and two trains on it, each with an engine. */
function worldWithEngines(): { world: World; engines: number[] } {
  const world = buildStarterWorld();
  const [a] = world.landscape.towns;
  let last = world.stations.get(a.id)!;
  const line: number[] = [];
  for (let i = 0; i < 8; i++) line.push((last = appendPiece(world.layout, "straight-216", false, connectorRef(last, 1))));
  const engines: number[] = [];
  for (const pieceId of [line[1], line[5]]) {
    const placed = world.sim.addTrain(["engine", "hopper"], { pieceId, pathIndex: 0, reversed: false, s: 120 });
    if (placed.kind !== "placed") throw new Error("no room");
    engines.push(world.sim.getTrain(placed.trainId)!.cars[0].id);
  }
  return { world, engines };
}

const roundTrip = (world: World): World => {
  const data = JSON.parse(JSON.stringify(serializeWorld(world))) as SaveData;
  const r = deserializeWorld(data);
  if (!r.ok) throw new Error(r.error);
  return r.value;
};

const namesOf = (w: World) => w.sim.trainIds().flatMap((id) => w.sim.getTrain(id)!.cars.filter((c) => c.kind === "engine").map((c) => [c.id, w.sim.nameOf(c.id)] as const));

describe("engines' names in saves", () => {
  it("each engine is given a name from the list as it's put down, no two alike, and wagons none", () => {
    const { world, engines } = worldWithEngines();
    const [a, b] = engines.map((id) => world.sim.nameOf(id));
    expect(ENGINE_NAMES).toContain(a);
    expect(ENGINE_NAMES).toContain(b);
    expect(a).not.toBe(b);
    const wagon = world.sim.findCar(engines[0])!.train.cars[1];
    expect(world.sim.nameOf(wagon.id)).toBe("");
  });

  it("names are saved and load back the same, a renamed one too", () => {
    const { world, engines } = worldWithEngines();
    expect(world.sim.setName(engines[1], "  Old   Faithful  ")).toBe(true);
    expect(world.sim.nameOf(engines[1])).toBe("Old Faithful");
    const data = serializeWorld(world);
    expect(data.trains.flatMap((t) => t.cars.map((c) => c.name ?? null))).toEqual([world.sim.nameOf(engines[0]), null, "Old Faithful", null]);
    const before = namesOf(world);
    const loaded = roundTrip(world);
    expect(namesOf(loaded)).toEqual(before);
    // And again: stable across many loads.
    expect(namesOf(roundTrip(loaded))).toEqual(before);
  });

  it("an older save, with no names, loads with its engines named, and the same names every time", () => {
    const { world } = worldWithEngines();
    const data = JSON.parse(JSON.stringify(serializeWorld(world))) as SaveData;
    for (const t of data.trains) for (const c of t.cars) delete c.name;
    const load = () => {
      const r = deserializeWorld(JSON.parse(JSON.stringify(data)));
      if (!r.ok) throw new Error(r.error);
      return namesOf(r.value);
    };
    const first = load();
    expect(first).toHaveLength(2);
    for (const [, name] of first) expect(ENGINE_NAMES).toContain(name);
    expect(new Set(first.map(([, n]) => n)).size).toBe(2);
    expect(load()).toEqual(first);
  });

  it("a name too long or odd in a save is tidied as it loads; an empty one gets a name of its own", () => {
    const { world, engines } = worldWithEngines();
    const data = JSON.parse(JSON.stringify(serializeWorld(world))) as SaveData;
    data.trains[0].cars[0].name = "The Very Long Name Indeed";
    const r = deserializeWorld(data);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.sim.nameOf(engines[0])).toBe("The Very Long");
    expect(r.value.sim.setName(engines[1], "   ")).toBe(false);
    expect(ENGINE_NAMES).toContain(r.value.sim.nameOf(engines[1]));
  });

  it("an engine picked up and put down again (its id kept) keeps its name", () => {
    const { world, engines } = worldWithEngines();
    world.sim.setName(engines[0], "Pip Squeak");
    const t = world.sim.findCar(engines[0])!.train;
    const ids = t.cars.map((c) => c.id);
    const lead = { ...t.bogies[0] };
    world.sim.removeTrain(t.id);
    const placed = world.sim.addTrain(["engine", "hopper"], lead, ids);
    expect(placed.kind).toBe("placed");
    expect(world.sim.nameOf(engines[0])).toBe("Pip Squeak");
  });
});

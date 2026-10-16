import { describe, expect, it } from "vitest";
import { appendPiece, connectorRef, Layout, type PieceTypeId } from "../track";
import { buildStarterWorld } from "../game/world";
import { deserializeWorld, serializeWorld } from "../persist/save";
import type { CarKind } from "./cars";
import { Sim, SIM_DT } from "./sim";

function chain(types: PieceTypeId[]): { layout: Layout; ids: number[] } {
  const layout = new Layout();
  const ids = [layout.addPiece(types[0], { x: 0, z: 0, heading: 0 }, 0, false)];
  for (let i = 1; i < types.length; i++) ids.push(appendPiece(layout, types[i], false, connectorRef(ids[i - 1], 1)));
  return { layout, ids };
}

const line = () => chain(["straight-216", "straight-216", "straight-216", "straight-216", "straight-216", "straight-216"]);

/** A train of these cars, its front at `s` on piece `at` of the line, heading toward connector 1 (+x). */
function trainOn(sim: Sim, pieceId: number, s: number, kinds: CarKind[]) {
  const r = sim.addTrain(kinds, { pieceId, pathIndex: 0, reversed: false, s });
  if (r.kind !== "placed") throw new Error(r.kind);
  return sim.getTrain(r.trainId)!;
}

const carIds = (sim: Sim, trainId: number) => sim.getTrain(trainId)!.cars.map((c) => c.id);
const xs = (sim: Sim, trainId: number) => sim.getTrain(trainId)!.world.map((w) => w.x);

describe("decouple", () => {
  it("a wagon in the middle splits from its neighbour on the engine's side; the rear part is set back 8 mm", () => {
    const { layout, ids: p } = line();
    const sim = new Sim(layout);
    const t = trainOn(sim, p[3], 150, ["engine", "hopper", "timber", "caboose"]);
    const [engine, hopper, timber, caboose] = t.cars.map((c) => c.id);
    const before = xs(sim, t.id);
    const r = sim.decouple(timber);
    expect(r.kind).toBe("decoupled");
    if (r.kind !== "decoupled") return;
    expect(sim.trainCount).toBe(2);
    expect(r.trainId).not.toBe(t.id);
    expect(carIds(sim, t.id)).toEqual([engine, hopper]);
    expect(carIds(sim, r.trainId)).toEqual([timber, caboose]);
    xs(sim, t.id).forEach((x, i) => expect(x).toBeCloseTo(before[i], 3));
    // The new part is the rear part: moved back (−x) by about 8 mm.
    xs(sim, r.trainId).forEach((x, i) => expect(Math.abs(before[4 + i] - x - 8)).toBeLessThan(1));
    expect(sim.getTrain(r.trainId)!.speed).toBe(0);
  });

  it("an engine at the front comes away from its cars", () => {
    const { layout, ids: p } = line();
    const sim = new Sim(layout);
    const t = trainOn(sim, p[3], 150, ["engine", "hopper", "timber"]);
    const [engine, hopper, timber] = t.cars.map((c) => c.id);
    const r = sim.decouple(engine);
    expect(r.kind).toBe("decoupled");
    if (r.kind !== "decoupled") return;
    expect(carIds(sim, t.id)).toEqual([engine]);
    expect(carIds(sim, r.trainId)).toEqual([hopper, timber]);
  });

  it("after a run-around, a wagon splits toward the engine, now at the back", () => {
    const { layout, ids: p } = line();
    const sim = new Sim(layout);
    const t = trainOn(sim, p[3], 150, ["engine", "hopper", "timber", "caboose"]);
    const [engine, hopper, timber, caboose] = t.cars.map((c) => c.id);
    expect(sim.runAround(engine)).toBe("ran-round");
    expect(carIds(sim, t.id)).toEqual([hopper, timber, caboose, engine]);
    const before = xs(sim, t.id);
    const r = sim.decouple(timber);
    expect(r.kind).toBe("decoupled");
    if (r.kind !== "decoupled") return;
    // The engine is behind, so the timber and the car in front stay together; the engine's part keeps the id.
    expect(carIds(sim, t.id)).toEqual([caboose, engine]);
    expect(carIds(sim, r.trainId)).toEqual([hopper, timber]);
    // The new part is the front part: moved forward (+x) by about 8 mm.
    xs(sim, r.trainId).forEach((x, i) => expect(Math.abs(x - before[i] - 8)).toBeLessThan(1));
  });

  it("is refused while moving; nothing to split from alone", () => {
    const { layout, ids: p } = line();
    const sim = new Sim(layout);
    const t = trainOn(sim, p[2], 150, ["engine", "hopper"]);
    sim.setLever(t.cars[0].id, 1);
    for (let k = 0; k < 30; k++) sim.tick();
    expect(sim.decouple(t.cars[1].id).kind).toBe("moving");
    expect(sim.decouple(9999).kind).toBe("none");

    const { layout: l2, ids: p2 } = line();
    const sim2 = new Sim(l2);
    const lone = trainOn(sim2, p2[3], 150, ["engine"]);
    expect(sim2.decouple(lone.cars[0].id).kind).toBe("alone");
    const wagons = trainOn(sim2, p2[1], 150, ["hopper", "timber"]);
    expect(sim2.decouple(wagons.cars[0].id).kind).toBe("alone");
  });

  it("the halves stay apart standing still; an engine driven back into its wagons couples them again", () => {
    const { layout, ids: p } = line();
    const sim = new Sim(layout);
    const t = trainOn(sim, p[3], 150, ["engine", "hopper", "timber"]);
    const engine = t.cars[0].id;
    // The engine runs round to the back, then the wagons come away from it (ahead of it).
    expect(sim.runAround(engine)).toBe("ran-round");
    expect(sim.decouple(t.cars[0].id).kind).toBe("decoupled");
    for (let k = 0; k < 1 / SIM_DT; k++) sim.tick();
    expect(sim.trainCount).toBe(2);
    // Drive the engine (facing out the back) forward into the wagons: it catches them and they couple.
    sim.setLever(engine, -1);
    for (let k = 0; k < 4 / SIM_DT && sim.trainCount > 1; k++) sim.tick();
    expect(sim.trainCount).toBe(1);
    expect(sim.getTrain(sim.trainIds()[0])!.cars.length).toBe(3);
  });

  it("an engine uncoupled at the front backs into its wagons and picks them up again (wagons met end to end couple on)", () => {
    const { layout, ids } = line();
    const sim = new Sim(layout);
    const t = trainOn(sim, ids[4], 100, ["engine", "hopper", "timber"]);
    const engine = t.cars[0].id;
    const r = sim.decouple(engine);
    expect(r.kind).toBe("decoupled");
    // Pull away a little, then back up.
    sim.setLever(engine, 1);
    for (let k = 0; k < 0.5 / SIM_DT; k++) sim.tick();
    sim.setLever(engine, -1);
    for (let k = 0; k < 4 / SIM_DT && sim.trainCount > 1; k++) sim.tick();
    expect(sim.trainCount).toBe(1);
    expect(sim.findCar(engine)!.train.cars.length).toBe(3);
  });

  it("saves keep both halves, their cars and positions", () => {
    const world = buildStarterWorld();
    const [a] = world.landscape.towns;
    let last = world.stations.get(a.id)!;
    const pieces: number[] = [];
    for (let i = 0; i < 4; i++) pieces.push((last = appendPiece(world.layout, "straight-216", false, connectorRef(last, 1))));
    const placed = world.sim.addTrain(["engine", "hopper", "passenger", "caboose"], { pieceId: pieces[1], pathIndex: 0, reversed: false, s: 120 });
    if (placed.kind !== "placed") throw new Error(placed.kind);
    const car = world.sim.getTrain(placed.trainId)!.cars[2].id;
    expect(world.sim.decouple(car).kind).toBe("decoupled");
    const r = deserializeWorld(JSON.parse(JSON.stringify(serializeWorld(world))));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.sim.trainCount).toBe(2);
    for (const id of world.sim.trainIds()) {
      const before = world.sim.getTrain(id)!;
      const match = r.value.sim
        .trainIds()
        .map((i) => r.value.sim.getTrain(i)!)
        .find((t) => t.cars[0].id === before.cars[0].id)!;
      expect(match.cars.map((c) => c.id)).toEqual(before.cars.map((c) => c.id));
      match.world.forEach((w, i) => expect(Math.hypot(w.x - before.world[i].x, w.z - before.world[i].z)).toBeLessThan(0.5));
    }
  });
});

import { describe, expect, it } from "vitest";
import { appendPiece, connectorRef, Layout, type PieceTypeId } from "../track";
import { CAR_SPECS, COUPLER_GAP } from "./cars";
import { createWorldSample, cursorWorld } from "./cursor";
import { createSnapshot, Sim, SIM_DT } from "./sim";

function chain(types: PieceTypeId[], flips: boolean[] = []): { layout: Layout; ids: number[] } {
  const layout = new Layout();
  const ids = [layout.addPiece(types[0], { x: 0, z: 0, heading: 0 }, 0, flips[0] ?? false)];
  for (let i = 1; i < types.length; i++) {
    ids.push(appendPiece(layout, types[i], flips[i] ?? false, connectorRef(ids[i - 1], 1)));
  }
  return { layout, ids };
}

const circle = (): ReturnType<typeof chain> => chain(Array(8).fill("curve-large"));
const longLine = (n = 8): ReturnType<typeof chain> => chain(Array(n).fill("straight-216"));

function run(sim: Sim, seconds: number): void {
  const steps = Math.round(seconds / SIM_DT);
  for (let i = 0; i < steps; i++) sim.tick();
}

function bogieGap(sim: Sim, trainId: number, a: number, b: number): number {
  const t = sim.getTrain(trainId)!;
  const p = cursorWorld(sim.layout, t.bogies[a], createWorldSample());
  const q = cursorWorld(sim.layout, t.bogies[b], createWorldSample());
  return Math.hypot(p.x - q.x, p.z - q.z);
}

describe("placing trains", () => {
  it("places cars nose to tail behind the start point", () => {
    const { layout, ids } = longLine();
    const sim = new Sim(layout);
    const r = sim.addTrain(["engine", "hopper"], { pieceId: ids[3], pathIndex: 0, reversed: false, s: 100 });
    expect(r.kind).toBe("placed");
    if (r.kind !== "placed") return;
    const t = sim.getTrain(r.trainId)!;
    expect(t.bogies).toHaveLength(4);
    const front = cursorWorld(layout, t.bogies[0], createWorldSample());
    const rear = cursorWorld(layout, t.bogies[3], createWorldSample());
    const e = CAR_SPECS.engine;
    const h = CAR_SPECS.hopper;
    expect(front.x - rear.x).toBeCloseTo(e.length - e.bogieInset + COUPLER_GAP + h.length - h.bogieInset, 5);
  });

  it("refuses to place a train where the track runs out", () => {
    const { layout, ids } = chain(["straight-54"]);
    const sim = new Sim(layout);
    expect(sim.addTrain(["engine", "hopper", "caboose"], { pieceId: ids[0], pathIndex: 0, reversed: false, s: 50 }).kind).toBe(
      "no-room",
    );
  });
});

describe("running", () => {
  it("an engine with its lever forward runs at about 120 mm/s on the level", () => {
    const { layout, ids } = longLine(12);
    const sim = new Sim(layout);
    const r = sim.addTrain(["engine"], { pieceId: ids[1], pathIndex: 0, reversed: false, s: 100 });
    if (r.kind !== "placed") throw new Error("not placed");
    const engine = sim.getTrain(r.trainId)!.cars[0];
    sim.setLever(engine.id, 1);
    run(sim, 3);
    const t = sim.getTrain(r.trainId)!;
    expect(t.speed).toBeGreaterThan(110);
    expect(t.speed).toBeLessThan(130);
  });

  it("keeps bogie spacing constant all the way round a circle", () => {
    const { layout, ids } = circle();
    const sim = new Sim(layout);
    const r = sim.addTrain(["engine", "passenger", "caboose"], { pieceId: ids[4], pathIndex: 0, reversed: false, s: 10 });
    if (r.kind !== "placed") throw new Error("not placed");
    const before = bogieGap(sim, r.trainId, 1, 2);
    sim.setLever(sim.getTrain(r.trainId)!.cars[0].id, 1);
    run(sim, 20); // ~2 laps
    expect(sim.getTrain(r.trainId)!.derailed).toBe(false);
    expect(bogieGap(sim, r.trainId, 1, 2)).toBeCloseTo(before, 3);
  });

  it("stops gently at a buffer", () => {
    const { layout, ids } = chain(["straight-216", "straight-216", "buffer"]);
    const sim = new Sim(layout);
    const r = sim.addTrain(["engine"], { pieceId: ids[1], pathIndex: 0, reversed: false, s: 150 });
    if (r.kind !== "placed") throw new Error("not placed");
    sim.setLever(sim.getTrain(r.trainId)!.cars[0].id, 1);
    run(sim, 5);
    const t = sim.getTrain(r.trainId)!;
    expect(t.derailed).toBe(false);
    expect(t.speed).toBe(0);
    expect(t.bogies[0].pieceId).toBe(ids[2]);
  });

  it("derails when running off an open end", () => {
    const { layout, ids } = chain(["straight-216", "straight-216"]);
    const sim = new Sim(layout);
    const r = sim.addTrain(["engine"], { pieceId: ids[1], pathIndex: 0, reversed: false, s: 150 });
    if (r.kind !== "placed") throw new Error("not placed");
    sim.setLever(sim.getTrain(r.trainId)!.cars[0].id, 1);
    run(sim, 3);
    expect(sim.getTrain(r.trainId)!.derailed).toBe(true);
    expect(sim.drainEvents().some((e) => e.kind === "derailed" && e.trainId === r.trainId)).toBe(true);
  });

  it("reverse lever drives the train the other way", () => {
    const { layout, ids } = longLine(12);
    const sim = new Sim(layout);
    const r = sim.addTrain(["engine", "hopper"], { pieceId: ids[6], pathIndex: 0, reversed: false, s: 100 });
    if (r.kind !== "placed") throw new Error("not placed");
    const engine = sim.getTrain(r.trainId)!.cars[0];
    const x0 = cursorWorld(layout, sim.getTrain(r.trainId)!.bogies[0], createWorldSample()).x;
    sim.setLever(engine.id, -1);
    run(sim, 2);
    const snap = sim.writeSnapshot(createSnapshot());
    const engineIdx = Array.from(snap.ids.subarray(0, snap.count)).indexOf(engine.id);
    expect(snap.transforms[engineIdx * 6]).toBeLessThan(x0 - 150);
  });

  it("climbs a ramp more slowly than it runs on the level", () => {
    const { layout, ids } = chain(["straight-216", "straight-216", "straight-216", "ramp", "bridge", "bridge"]);
    const sim = new Sim(layout);
    const r = sim.addTrain(["engine", "hopper", "hopper"], { pieceId: ids[1], pathIndex: 0, reversed: false, s: 200 });
    if (r.kind !== "placed") throw new Error("not placed");
    sim.setLever(sim.getTrain(r.trainId)!.cars[0].id, 1);
    const t = sim.getTrain(r.trainId)!;
    let flatSpeed = 0;
    for (let i = 0; i < 120 * 10; i++) {
      sim.tick();
      const b = t.bogies[0];
      if (b.pieceId === ids[2] && b.s > 200) flatSpeed = t.speed;
      if (b.pieceId === ids[3] && b.s > 150) break;
    }
    expect(t.bogies[0].pieceId).toBe(ids[3]);
    expect(flatSpeed).toBeGreaterThan(95);
    expect(t.speed).toBeLessThan(flatSpeed * 0.8);
    expect(t.speed).toBeGreaterThan(10);
  });

  it("an unpowered car rolls down a ramp", () => {
    const { layout, ids } = chain(["bridge", "bridge"]);
    // ramp descending from the bridge: attach a ramp by its peg (high end) to the bridge's socket
    const ramp = appendPiece(layout, "ramp", false, connectorRef(ids[0], 0), 1);
    const floor = appendPiece(layout, "straight-216", false, connectorRef(ramp, 0), 1);
    void floor;
    const sim = new Sim(layout);
    const r = sim.addTrain(["hopper"], { pieceId: ramp, pathIndex: 0, reversed: true, s: 60 });
    if (r.kind !== "placed") throw new Error("not placed");
    run(sim, 1);
    expect(sim.getTrain(r.trainId)!.speed).toBeGreaterThan(20);
  });
});

describe("switches", () => {
  it("takes the branch when the switch is set, and the whole train follows it", () => {
    const { layout, ids } = chain(["straight-216", "straight-216", "switch", "curve-large", "curve-large"], [false, false, false, false, false]);
    // chain() follows connector 1 (straight branch); attach a track to the curved branch too
    const branchTail = appendPiece(layout, "straight-216", false, connectorRef(ids[2], 2));
    const sim = new Sim(layout);
    layout.setSwitchState(ids[2], 1);
    const r = sim.addTrain(["engine", "passenger"], { pieceId: ids[1], pathIndex: 0, reversed: false, s: 200 });
    if (r.kind !== "placed") throw new Error("not placed");
    sim.setLever(sim.getTrain(r.trainId)!.cars[0].id, 1);
    run(sim, 0.4); // lead bogie enters the switch
    layout.setSwitchState(ids[2], 0); // flip under the train
    run(sim, 2.5);
    const t = sim.getTrain(r.trainId)!;
    expect(t.derailed).toBe(false);
    for (const b of t.bogies) expect([ids[2], branchTail]).toContain(b.pieceId);
    for (const b of t.bogies) if (b.pieceId === ids[2]) expect(b.pathIndex).toBe(1);
  });
});

describe("coupling", () => {
  function twoTrains(rearKindsOfFront: Parameters<Sim["addTrain"]>[0]) {
    const { layout, ids } = longLine(14);
    const sim = new Sim(layout);
    const a = sim.addTrain(["engine"], { pieceId: ids[3], pathIndex: 0, reversed: false, s: 100 });
    const b = sim.addTrain(rearKindsOfFront, { pieceId: ids[6], pathIndex: 0, reversed: false, s: 100 });
    if (a.kind !== "placed" || b.kind !== "placed") throw new Error("not placed");
    return { sim, a: a.trainId, b: b.trainId };
  }

  it("a gentle approach with opposite poles couples into one train", () => {
    const { sim, a, b } = twoTrains(["hopper"]);
    sim.setLever(sim.getTrain(a)!.cars[0].id, 1);
    run(sim, 8);
    expect(sim.trainCount).toBe(1);
    const merged = sim.getTrain(sim.trainIds()[0])!;
    expect(merged.cars).toHaveLength(2);
    expect(sim.drainEvents().some((e) => e.kind === "coupled")).toBe(true);
    void b;
  });

  it("matching poles repel: the trains stay separate and the pusher stops", () => {
    const { sim, a, b } = twoTrains(["hopper"]);
    sim.flipCar(sim.getTrain(b)!.cars[0].id);
    sim.setLever(sim.getTrain(a)!.cars[0].id, 1);
    run(sim, 8);
    expect(sim.trainCount).toBe(2);
    expect(sim.getTrain(a)!.speed).toBeLessThan(5);
    expect(sim.drainEvents().some((e) => e.kind === "repelled")).toBe(true);
  });

  it("a fast impact derails both trains", () => {
    const { sim, a, b } = twoTrains(["hopper"]);
    sim.getTrain(a)!.speed = 400; // shoved hard by hand, motor off
    run(sim, 2);
    expect(sim.getTrain(a)!.derailed).toBe(true);
    expect(sim.getTrain(b)!.derailed).toBe(true);
  });
});

describe("determinism and snapshot", () => {
  it("the same commands produce identical snapshots", () => {
    const build = () => {
      const { layout, ids } = circle();
      const sim = new Sim(layout);
      const r = sim.addTrain(["engine", "hopper", "caboose"], { pieceId: ids[5], pathIndex: 0, reversed: false, s: 20 });
      if (r.kind !== "placed") throw new Error("not placed");
      sim.setLever(sim.getTrain(r.trainId)!.cars[0].id, 1);
      run(sim, 7.3);
      return sim.writeSnapshot(createSnapshot());
    };
    const s1 = build();
    const s2 = build();
    expect(Array.from(s1.transforms.subarray(0, s1.count * 6))).toEqual(Array.from(s2.transforms.subarray(0, s2.count * 6)));
  });

  it("snapshot lists every car with kind and transform", () => {
    const { layout, ids } = longLine();
    const sim = new Sim(layout);
    sim.addTrain(["engine", "passenger", "caboose"], { pieceId: ids[4], pathIndex: 0, reversed: false, s: 50 });
    const snap = sim.writeSnapshot(createSnapshot());
    expect(snap.count).toBe(3);
    expect(Array.from(snap.kinds.subarray(0, 3))).toEqual([0, 2, 3]);
    expect(snap.transforms[1]).toBeCloseTo(0); // y on the floor
  });
});

describe("track edits under trains", () => {
  it("removing a piece a train is standing on derails that train only", () => {
    const { layout, ids } = longLine(10);
    const sim = new Sim(layout);
    const a = sim.addTrain(["engine"], { pieceId: ids[2], pathIndex: 0, reversed: false, s: 150 });
    const b = sim.addTrain(["engine"], { pieceId: ids[7], pathIndex: 0, reversed: false, s: 150 });
    if (a.kind !== "placed" || b.kind !== "placed") throw new Error("not placed");
    layout.removePiece(ids[2]);
    sim.trackChanged();
    expect(sim.getTrain(a.trainId)!.derailed).toBe(true);
    expect(sim.getTrain(b.trainId)!.derailed).toBe(false);
    sim.tick(); // must not touch the removed piece
  });

  it("lifting a piece derails trains on it", () => {
    const { layout, ids } = longLine(4);
    const sim = new Sim(layout);
    const a = sim.addTrain(["engine"], { pieceId: ids[1], pathIndex: 0, reversed: false, s: 150 });
    if (a.kind !== "placed") throw new Error("not placed");
    layout.liftPiece(ids[1]);
    sim.trackChanged();
    expect(sim.getTrain(a.trainId)!.derailed).toBe(true);
  });

  it("rerail puts a derailed train back on the nearest track", () => {
    const { layout, ids } = chain(["straight-216", "straight-216"]);
    const sim = new Sim(layout);
    const r = sim.addTrain(["engine", "hopper"], { pieceId: ids[1], pathIndex: 0, reversed: false, s: 150 });
    if (r.kind !== "placed") throw new Error("not placed");
    sim.setLever(sim.getTrain(r.trainId)!.cars[0].id, 1);
    run(sim, 3);
    expect(sim.getTrain(r.trainId)!.derailed).toBe(true);
    const back = sim.rerail(r.trainId);
    expect(back).not.toBe(-1);
    const t = sim.getTrain(back)!;
    expect(t.derailed).toBe(false);
    expect(t.cars.map((c) => c.kind)).toEqual(["engine", "hopper"]);
    expect(t.cars[0].lever).toBe(0);
  });
});

describe("joint events", () => {
  it("emits one joint event per axle crossing a joint", () => {
    const { layout, ids } = longLine(6);
    const sim = new Sim(layout);
    const r = sim.addTrain(["engine"], { pieceId: ids[2], pathIndex: 0, reversed: false, s: 150 });
    if (r.kind !== "placed") throw new Error("not placed");
    sim.setLever(sim.getTrain(r.trainId)!.cars[0].id, 1);
    run(sim, 1.6); // ~150 mm: both axles cross the joint at the end of ids[2], 66 mm and 122 mm ahead
    const joints = sim.drainEvents().filter((e) => e.kind === "joint");
    expect(joints.length).toBe(2);
    expect(joints.map((e) => (e.kind === "joint" ? e.bogie : -1))).toEqual([0, 1]);
  });
});

describe("occupied track", () => {
  it("refuses to place a train on top of another train", () => {
    const { layout, ids } = longLine(6);
    const sim = new Sim(layout);
    expect(sim.addTrain(["engine", "hopper"], { pieceId: ids[3], pathIndex: 0, reversed: false, s: 100 }).kind).toBe("placed");
    expect(sim.addTrain(["engine"], { pieceId: ids[3], pathIndex: 0, reversed: false, s: 60 }).kind).toBe("no-room");
    expect(sim.addTrain(["engine"], { pieceId: ids[5], pathIndex: 0, reversed: false, s: 150 }).kind).toBe("placed");
  });
});

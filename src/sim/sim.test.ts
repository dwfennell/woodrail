import { describe, expect, it } from "vitest";
import { appendPiece, connectorRef, Layout, RAMP_LENGTH, type PieceTypeId } from "../track";
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

  it("centres a dropped train on the drop point", () => {
    const { layout, ids } = longLine();
    const sim = new Sim(layout);
    const at = { pieceId: ids[3], pathIndex: 0, reversed: false, s: 100 };
    const r = sim.addTrainAround(["engine", "hopper"], at);
    expect(r.kind).toBe("placed");
    if (r.kind !== "placed") return;
    const t = sim.getTrain(r.trainId)!;
    const front = cursorWorld(layout, t.bogies[0], createWorldSample());
    const rear = cursorWorld(layout, t.bogies[3], createWorldSample());
    const drop = cursorWorld(layout, at, createWorldSample());
    expect((front.x + rear.x) / 2).toBeCloseTo(drop.x, 0);
  });

  it("slides a train dropped near a dead end along the track until it fits, still over the drop point", () => {
    const { layout, ids } = chain(["straight-216", "straight-216"]);
    const sim = new Sim(layout);
    // 20 mm from the open end behind: laid out behind the point, it wouldn't fit.
    const at = { pieceId: ids[0], pathIndex: 0, reversed: false, s: 20 };
    expect(sim.addTrain(["engine", "hopper"], at).kind).toBe("no-room");
    const r = sim.addTrainAround(["engine", "hopper"], at);
    expect(r.kind).toBe("placed");
    if (r.kind !== "placed") return;
    const t = sim.getTrain(r.trainId)!;
    const xs = t.bogies.map((b) => cursorWorld(layout, b, createWorldSample()).x);
    const drop = cursorWorld(layout, at, createWorldSample()).x;
    expect(Math.min(...xs)).toBeLessThanOrEqual(drop + 1e-6);
    expect(Math.max(...xs)).toBeGreaterThanOrEqual(drop - 1e-6);
  });

  it("still refuses a train longer than the track it's dropped on", () => {
    const { layout, ids } = chain(["straight-54"]);
    const sim = new Sim(layout);
    expect(sim.addTrainAround(["engine", "hopper", "caboose"], { pieceId: ids[0], pathIndex: 0, reversed: false, s: 27 }).kind).toBe("no-room");
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
      if (b.pieceId === ids[3] && b.s > RAMP_LENGTH * 0.7) break;
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

describe("joint play", () => {
  it("runs across a joint 8 mm and 3° off, as when closing a run between two stations", () => {
    const layout = new Layout();
    const a = layout.addPiece("straight-216", { x: 0, z: 0, heading: 0 });
    const b = layout.addPiece("straight-216", { x: 222, z: 5, heading: (3 * Math.PI) / 180 });
    const c = appendPiece(layout, "straight-216", false, connectorRef(b, 1));
    expect(layout.jointCount).toBe(2);
    const sim = new Sim(layout);
    const t = sim.addTrain(["engine", "hopper"], { pieceId: a, pathIndex: 0, reversed: false, s: 150 });
    if (t.kind !== "placed") throw new Error("not placed");
    sim.setLever(sim.getTrain(t.trainId)!.cars[0].id, 1);
    run(sim, 2.5);
    const train = sim.getTrain(t.trainId)!;
    expect(train.derailed).toBe(false);
    expect([b, c]).toContain(train.bogies[train.bogies.length - 1].pieceId);
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

describe("reversing through a switch", () => {
  it("a train that reverses while straddling a switch goes back the way it came, all of it", () => {
    // Trunk ← switch → straight branch (curves) and curved branch (two straights), the train coming off the curved
    // branch onto the trunk (a trailing move), then reversing halfway through with the switch set straight.
    const { layout, ids } = chain(["straight-216", "straight-216", "switch", "curve-large", "curve-large"]);
    const branchA = appendPiece(layout, "straight-216", false, connectorRef(ids[2], 2));
    const branchB = appendPiece(layout, "straight-216", false, connectorRef(branchA, 1));
    const sim = new Sim(layout);
    layout.setSwitchState(ids[2], 1);
    const r = sim.addTrain(["engine", "passenger", "passenger"], { pieceId: branchA, pathIndex: 0, reversed: true, s: 120 });
    if (r.kind !== "placed") throw new Error("not placed");
    const engine = sim.getTrain(r.trainId)!.cars[0].id;
    sim.setLever(engine, 1);
    run(sim, 3.2); // the front is out on the trunk, the back still on the curved branch
    const mid = sim.getTrain(r.trainId)!;
    expect(mid.bogies.some((b) => b.pieceId === ids[1])).toBe(true);
    expect(mid.bogies.some((b) => b.pieceId === branchA || (b.pieceId === ids[2] && b.pathIndex === 1))).toBe(true);
    layout.setSwitchState(ids[2], 0);
    sim.setLever(engine, -1);
    run(sim, 4);
    const t = sim.getTrain(r.trainId)!;
    expect(t.derailed).toBe(false);
    // Nobody went down the straight branch: every axle is on the curved side (or still on the switch's curved path).
    for (const b of t.bogies) {
      expect([ids[3], ids[4]]).not.toContain(b.pieceId);
      if (b.pieceId === ids[2]) expect(b.pathIndex).toBe(1);
    }
    expect(t.bogies.some((b) => b.pieceId === branchA || b.pieceId === branchB)).toBe(true);
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

  it("a gentle approach couples into one train", () => {
    const { sim, a, b } = twoTrains(["hopper"]);
    sim.setLever(sim.getTrain(a)!.cars[0].id, 1);
    run(sim, 8);
    expect(sim.trainCount).toBe(1);
    const merged = sim.getTrain(sim.trainIds()[0])!;
    expect(merged.cars).toHaveLength(2);
    expect(sim.drainEvents().some((e) => e.kind === "coupled")).toBe(true);
    void b;
  });

  it("couples whichever way the car's magnet faces", () => {
    const { sim, a, b } = twoTrains(["hopper"]);
    sim.flipCar(sim.getTrain(b)!.cars[0].id);
    sim.setLever(sim.getTrain(a)!.cars[0].id, 1);
    run(sim, 8);
    expect(sim.trainCount).toBe(1);
    expect(sim.getTrain(sim.trainIds()[0])!.cars).toHaveLength(2);
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

describe("balloon loop", () => {
  it.each(["balloon-loop", "balloon-loop-small"] as const)("%s turns a train round: in at its end, round the loop, and back out the way it came", (loop) => {
    const { layout, ids } = chain(["straight-216", "straight-216", "straight-216", loop]);
    const sim = new Sim(layout);
    const r = sim.addTrain(["engine", "passenger", "caboose"], { pieceId: ids[1], pathIndex: 0, s: 200, reversed: false });
    expect(r.kind).toBe("placed");
    if (r.kind !== "placed") return;
    const t = sim.getTrain(r.trainId)!;
    sim.setLever(t.cars[0].id, 1);
    let visited = false;
    let maxX = -Infinity;
    // Run until it's back on the first straight (the far end of the line is open: stop before it runs off).
    for (let i = 0; i < 60 / SIM_DT && !(visited && t.bogies[0].pieceId === ids[0]); i++) {
      sim.tick();
      visited ||= t.bogies.some((b) => b.pieceId === ids[3]);
      maxX = Math.max(maxX, cursorWorld(layout, t.bogies[0], createWorldSample()).x);
    }
    expect(t.derailed).toBe(false);
    expect(visited).toBe(true);
    expect(t.bogies[0].pieceId).toBe(ids[0]);
    // Out past the start of the loop, then all the way back down the line.
    expect(maxX).toBeGreaterThan(700);
  });
});


import { describe, expect, it } from "vitest";
import { CARGO, Economy } from "../economy";
import { Sim, SIM_DT, type CarKind } from "../sim";
import { chain as loopChain } from "../economy/loop-fixtures";
import { startLine } from "./lines";
import { appendPiece, connectorRef, Layout, type PieceTypeId } from "../track";
import { engineStatus, fullLineToast, headOnTip, trainState, trainsForReport } from "./engine-status";

function chain(types: PieceTypeId[]): { layout: Layout; ids: number[] };
function chain(types: PieceTypeId[], layout: Layout): number[];
function chain(types: PieceTypeId[], into?: Layout): { layout: Layout; ids: number[] } | number[] {
  const layout = into ?? new Layout();
  const ids = [layout.addPiece(types[0], { x: 0, z: 0, heading: 0 }, 0, false)];
  for (let i = 1; i < types.length; i++) ids.push(appendPiece(layout, types[i], false, connectorRef(ids[i - 1], 1)));
  return into ? ids : { layout, ids };
}

const run = (sim: Sim, seconds: number) => {
  for (let i = Math.round(seconds / SIM_DT); i > 0; i--) sim.tick();
};

describe("the engine card's status line", () => {
  it("says what the train's doing: stopped, running, at a red signal, turning back at the end of the line", () => {
    const { layout, ids } = chain(["straight-216", "straight-216", "signal", "straight-216", "straight-216", "buffer"]);
    const sim = new Sim(layout);
    const economy = new Economy(layout, sim);
    const status = (car: number) => engineStatus(sim, economy, car, () => "Oakhollow");
    const r = sim.addTrain(["engine"], { pieceId: ids[0], pathIndex: 0, reversed: false, s: 120 });
    if (r.kind !== "placed") throw new Error();
    const engine = sim.getTrain(r.trainId)!.cars[0].id;
    expect(status(engine)).toBe("Stopped");
    sim.setLever(engine, 1);
    run(sim, 0.5);
    expect(status(engine)).toBe("Running");
    // Held at red: it waits at the signal.
    sim.toggleSwitch(ids[2]);
    run(sim, 5);
    expect(status(engine)).toBe("Waiting at a red signal");
    // Let go: it runs on to the buffer and turns back there.
    sim.toggleSwitch(ids[2]);
    let turning = false;
    for (let k = 0; k < 120 * 8 && !turning; k++) {
      sim.tick();
      const t = sim.findCar(engine)?.train;
      if (t && t.turnback >= 0) turning = status(engine) === "Turning back at the end of the line";
    }
    expect(turning).toBe(true);
  });

  it("names the next stop of the train's route", () => {
    const { layout, ids } = chain(["straight-216", "straight-216", "straight-216"]);
    const sim = new Sim(layout);
    const economy = new Economy(layout, sim);
    const r = sim.addTrain(["engine"], { pieceId: ids[1], pathIndex: 0, reversed: false, s: 120 });
    if (r.kind !== "placed") throw new Error();
    const engine = sim.getTrain(r.trainId)!.cars[0].id;
    const d = economy.addDepot("sawmill", ids[2]);
    economy.setRoute(engine, { stops: [{ depotId: d.id, action: "both" }], next: 0 });
    sim.setLever(engine, 1);
    run(sim, 0.3);
    expect(engineStatus(sim, economy, engine, (id) => (id === d.id ? "the sawmill" : "?"))).toBe("On its way to the sawmill");
  });

  it("says what a depot's crane does there: a forest yard only loads", () => {
    const layout = new Layout();
    const ids = (["straight-216", "straight-216", "depot-forest", "straight-216", "straight-216"] as const).map((t, i) => layout.addPiece(t, { x: i * 216, z: 0, heading: 0 }));
    const sim = new Sim(layout);
    const economy = new Economy(layout, sim);
    const d = economy.addDepot("forest", ids[2], 0);
    // Logs waiting on its pile.
    d.piles[CARGO.log.index] = 4;
    const r = sim.addTrain(["engine", "timber", "timber"], { pieceId: ids[1], pathIndex: 0, reversed: false, s: 150 });
    if (r.kind !== "placed") throw new Error();
    const engine = sim.getTrain(r.trainId)!.cars[0].id;
    sim.setLever(engine, 1);
    const seen = new Set<string>();
    for (let k = 0; k < 120 * 20; k++) {
      sim.tick();
      economy.tick();
      seen.add(engineStatus(sim, economy, engine, (id) => (id === d.id ? "the forest yard" : "?")));
    }
    expect(seen).toContain("Loading at the forest yard");
    expect([...seen].some((st) => st.startsWith("Loading and unloading"))).toBe(false);
  });

  /** A train of an engine and two timber wagons (logs on the first) running through a sawmill and on. */
  function sawmillRun(route: "none" | "drop" | "elsewhere") {
    const layout = new Layout();
    const ids = (["straight-216", "straight-216", "depot-sawmill", "straight-216", "depot-forest", "straight-216"] as const).map((t, i) => layout.addPiece(t, { x: i * 216, z: 0, heading: 0 }));
    const sim = new Sim(layout);
    const economy = new Economy(layout, sim);
    const mill = economy.addDepot("sawmill", ids[2], 0);
    const forest = economy.addDepot("forest", ids[4], 0);
    // Planks on the mill's pile, logs on the first wagon.
    mill.piles[CARGO.planks.index] = 6;
    const r = sim.addTrain(["engine", "timber", "timber"], { pieceId: ids[1], pathIndex: 0, reversed: false, s: 200 });
    if (r.kind !== "placed") throw new Error();
    const train = sim.getTrain(r.trainId)!;
    economy.setCargo(train.cars[1].id, "log", 3);
    const engine = train.cars[0].id;
    if (route === "drop") economy.setRoute(engine, { stops: [{ depotId: mill.id, action: "drop" }], next: 0 });
    if (route === "elsewhere") economy.setRoute(engine, { stops: [{ depotId: forest.id, action: "both" }], next: 0 });
    sim.setLever(engine, 1);
    const seen = new Set<string>();
    for (let k = 0; k < 120 * 12; k++) {
      sim.tick();
      economy.tick();
      seen.add(engineStatus(sim, economy, engine, (id) => (id === mill.id ? "the sawmill" : "the forest")));
    }
    return [...seen].filter((s) => /^(Loading|Unloading)/.test(s) && s.endsWith("the sawmill"));
  }

  it("leaving a stop, it's on its way to the next one at once (not still to the one it's leaving)", () => {
    const layout = new Layout();
    const ids = (["straight-216", "straight-216", "depot-forest", "straight-216", "straight-216", "depot-sawmill", "straight-216", "straight-216"] as const).map((t, i) => layout.addPiece(t, { x: i * 216, z: 0, heading: 0 }));
    const sim = new Sim(layout);
    const economy = new Economy(layout, sim);
    const forest = economy.addDepot("forest", ids[2], 0);
    const mill = economy.addDepot("sawmill", ids[5], 0);
    forest.piles[CARGO.log.index] = 6;
    const r = sim.addTrain(["engine", "timber"], { pieceId: ids[1], pathIndex: 0, reversed: false, s: 100 });
    if (r.kind !== "placed") throw new Error();
    const engine = sim.getTrain(r.trainId)!.cars[0].id;
    economy.setRoute(engine, { stops: [{ depotId: forest.id, action: "pick" }, { depotId: mill.id, action: "drop" }], next: 0 });
    sim.setLever(engine, 1);
    const said: string[] = [];
    for (let k = 0; k < 120 * 30; k++) {
      sim.tick();
      economy.tick();
      const st = engineStatus(sim, economy, engine, (id) => (id === forest.id ? "the forest" : "the sawmill"));
      if (said.at(-1) !== st) said.push(st);
    }
    const loaded = said.indexOf("Loading at the forest");
    expect(loaded).toBeGreaterThanOrEqual(0);
    // From the forest to the sawmill: never back to "the forest" on the way (nor on arriving at the sawmill).
    const leg = said.slice(loaded, said.indexOf("Unloading at the sawmill", loaded));
    expect(leg).not.toContain("On its way to the forest");
    expect(leg.slice(1)).toEqual(["On its way to the sawmill"]);
  });

  it("says what's being done for this train: just Unloading at a Drop stop, nothing at a depot not on its route", () => {
    expect(sawmillRun("none")).toContain("Loading and unloading at the sawmill");
    expect(sawmillRun("drop")).toEqual(["Unloading at the sawmill"]);
    // Passing a depot that isn't one of its stops: never "Loading" there.
    expect(sawmillRun("elsewhere")).toEqual([]);
  });
});

describe("which way a stopped engine can go", () => {
  it("knows when its front, or its back, is up against a buffer", () => {
    const { layout, ids } = chain(["straight-216", "straight-216", "straight-216", "buffer"]);
    const sim = new Sim(layout);
    const r = sim.addTrain(["engine"], { pieceId: ids[1], pathIndex: 0, reversed: false, s: 120 });
    if (r.kind !== "placed") throw new Error();
    const engine = sim.getTrain(r.trainId)!.cars[0].id;
    expect(sim.engineBlocked(engine, 1)).toBe(false);
    sim.setLever(engine, 1);
    for (let k = 0; k < 120 * 8 && sim.findCar(engine)!.train.turnback < 0; k++) sim.tick();
    sim.setLever(engine, 0);
    // At the buffer: its front is blocked, its back is open.
    expect(sim.engineBlocked(engine, 1)).toBe(true);
    expect(sim.engineBlocked(engine, -1)).toBe(false);
    // Swapped end for end, the same holds for the other way round.
    sim.flipCar(engine);
    expect(sim.engineBlocked(engine, -1)).toBe(true);
    expect(sim.engineBlocked(engine, 1)).toBe(false);
  });
});

describe("why a train with its lever on isn't moving", () => {
  const line = () => {
    const { layout, ids } = chain(["straight-216", "straight-216", "signal", "straight-216", "straight-216", "straight-216"]);
    const sim = new Sim(layout);
    const economy = new Economy(layout, sim);
    const r = sim.addTrain(["engine", "hopper"], { pieceId: ids[1], pathIndex: 0, reversed: false, s: 200 });
    if (r.kind !== "placed") throw new Error();
    const train = sim.getTrain(r.trainId)!;
    return { layout, ids, sim, economy, train, engine: train.cars[0].id };
  };

  it("too heavy for its engine, or no power: says so, not just that something's in the way", () => {
    const { sim, economy, engine } = line();
    sim.setLever(engine, 1);
    // Game mode's engine rules: this one can't move at all.
    sim.topSpeed = () => 0;
    run(sim, 0.5);
    expect(engineStatus(sim, economy, engine, () => "?", () => "too-heavy")).toBe("Too heavy for its engine: take a car off, or add an engine");
    expect(engineStatus(sim, economy, engine, () => "?", () => "no-power")).toBe("No power: a power station needs coal");
    // Without the rules to ask (Sandbox), the plain reason.
    expect(engineStatus(sim, economy, engine, () => "?")).toBe("Waiting: something's in the way");
    // Lever off: just stopped, heavy or not.
    sim.setLever(engine, 0);
    expect(engineStatus(sim, economy, engine, () => "?", () => "too-heavy")).toBe("Stopped");
  });

  it("names the red signal it's held at", () => {
    const { ids, sim, economy, train, engine } = line();
    sim.toggleSwitch(ids[2]);
    sim.setLever(engine, 1);
    run(sim, 5);
    expect(trainState(sim, economy, train, 1)).toEqual({ kind: "red-signal", signalId: ids[2] });
    expect(sim.redSignalAhead(train.id)).toBe(ids[2]);
    sim.toggleSwitch(ids[2]);
    run(sim, 1);
    expect(trainState(sim, economy, train, 1).kind).toBe("running");
    expect(sim.redSignalAhead(train.id)).toBe(-1);
  });

  it("a report has each train: cars, levers, speed, top speed, the piece its front is on, and why it stands", () => {
    const { layout, ids, sim, economy, train, engine } = line();
    sim.toggleSwitch(ids[2]);
    sim.setLever(engine, 1);
    run(sim, 5);
    const [t] = trainsForReport(sim, economy, layout);
    expect(t).toMatchObject({ id: train.id, levers: [1], speed: 0, topSpeed: null, state: { kind: "red-signal", signalId: ids[2] } });
    expect(t.cars).toEqual([`${engine}:engine`, `${train.cars[1].id}:hopper`]);
    expect(t.piece).toMatchObject({ id: train.bogies[0].pieceId, type: layout.getPiece(train.bogies[0].pieceId)!.type });
    // JSON-able, as the report stores it.
    expect(JSON.parse(JSON.stringify(t))).toEqual(t);
  });
});

describe("turning back where the track just stops", () => {
  it("says the track ends here while it waits (turning back), for a while as it runs back (turned back); then just running", () => {
    // No buffer: the line just stops (a gap the player can't see).
    // A long way back: it runs back a good while before the far end.
    const { layout, ids } = chain(Array<PieceTypeId>(16).fill("straight-216"));
    const sim = new Sim(layout);
    const economy = new Economy(layout, sim);
    const r = sim.addTrain(["engine"], { pieceId: ids[14], pathIndex: 0, reversed: false, s: 120 });
    if (r.kind !== "placed") throw new Error();
    const engine = sim.getTrain(r.trainId)!.cars[0].id;
    sim.setLever(engine, 1);
    const status = () => engineStatus(sim, economy, engine, () => "?");
    let waiting = false;
    for (let k = 0; k < 120 * 10 && !waiting; k++) {
      sim.tick();
      waiting = (sim.findCar(engine)?.train.turnback ?? -1) >= 0;
    }
    expect(waiting).toBe(true);
    expect(status()).toBe("Turning back: the track ends here");
    expect(sim.findCar(engine)!.train.lastTurn).toMatchObject({ cause: "open-end", pieceId: ids[15] });
    // Turned round and running back (the cars keep their ids): still says why for a few seconds.
    run(sim, 3);
    const t = sim.findCar(engine)!.train;
    expect(t.turnback).toBe(-1);
    expect(t.speed).toBeGreaterThan(1);
    expect(status()).toBe("Turned back: the track ends here");
    run(sim, 6);
    expect(sim.findCar(engine)!.train.speed).toBeGreaterThan(1);
    expect(status()).toBe("Running");
  });

  it("a buffer at the end of the line is the plain end of the line (the player's own choice)", () => {
    const { layout, ids } = chain(["straight-216", "straight-216", "straight-216", "buffer"]);
    const sim = new Sim(layout);
    const economy = new Economy(layout, sim);
    const r = sim.addTrain(["engine"], { pieceId: ids[1], pathIndex: 0, reversed: false, s: 120 });
    if (r.kind !== "placed") throw new Error();
    const engine = sim.getTrain(r.trainId)!.cars[0].id;
    sim.setLever(engine, 1);
    let said = "";
    for (let k = 0; k < 120 * 10 && !said; k++) {
      sim.tick();
      if ((sim.findCar(engine)?.train.turnback ?? -1) >= 0) said = engineStatus(sim, economy, engine, () => "?");
    }
    expect(said).toBe("Turning back at the end of the line");
    // Once it's running back from a buffer: just running.
    run(sim, 4);
    expect(engineStatus(sim, economy, engine, () => "?")).toBe("Running");
  });
});

describe("a train just told to go", () => {
  it("says Starting while it gets going (not Waiting), then Running", () => {
    const { layout, ids } = chain(["straight-216", "straight-216", "straight-216", "straight-216"]);
    const sim = new Sim(layout);
    const economy = new Economy(layout, sim);
    const r = sim.addTrain(["engine", "hopper"], { pieceId: ids[2], pathIndex: 0, reversed: false, s: 100 });
    if (r.kind !== "placed") throw new Error();
    const engine = sim.getTrain(r.trainId)!.cars[0].id;
    const status = () => engineStatus(sim, economy, engine, () => "?");
    sim.setLever(engine, 1);
    // Before the sim has moved it at all, and through its first ticks while it creeps up past 1 mm/s.
    const seen = new Set<string>([status()]);
    for (let k = 0; k < 120 && sim.findCar(engine)!.train.speed < 1; k++) {
      sim.tick();
      seen.add(status());
    }
    expect([...seen].filter((s) => s !== "Running")).toEqual(["Starting"]);
    run(sim, 0.3);
    expect(status()).toBe("Running");
  });

  it("one that can't move says why once the moment's past, not Starting", () => {
    const { layout, ids } = chain(["straight-216", "straight-216", "straight-216"]);
    const sim = new Sim(layout);
    const economy = new Economy(layout, sim);
    const r = sim.addTrain(["engine"], { pieceId: ids[1], pathIndex: 0, reversed: false, s: 120 });
    if (r.kind !== "placed") throw new Error();
    const engine = sim.getTrain(r.trainId)!.cars[0].id;
    sim.topSpeed = () => 0;
    sim.setLever(engine, 1);
    expect(engineStatus(sim, economy, engine, () => "?")).toBe("Starting");
    run(sim, 1);
    expect(engineStatus(sim, economy, engine, () => "?")).toBe("Waiting: something's in the way");
  });
});

describe("headOnTip", () => {
  it("points to Signals, or to what comes before them", () => {
    expect(headOnTip(new Set())).toBe("Trains met head on. Learn Switches, then Signals, so they can pass");
    expect(headOnTip(new Set(["switches"]))).toBe("Trains met head on. Learn Signals so they can pass on a loop");
    expect(headOnTip(new Set(["switches", "signals"]))).toBe("Trains met head on. A passing loop with signals lets them pass");
    expect(headOnTip(null)).toContain("signals");
  });
});

describe("the full line's toast", () => {
  it("says what the line has room for, and what would run them all, short", () => {
    expect(fullLineToast(2, 3, 1)).toBe("This line has room for 2 trains. Lay another passing loop, or put one away (on its card).");
    expect(fullLineToast(1, 2, 1)).toBe("This line has room for 1 train. Lay a passing loop, or put one away (on its card).");
    expect(fullLineToast(2, 4, 2)).toBe("This line has room for 2 trains. Lay 2 more passing loops, or put one away (on its card).");
    // (Three lines at most on a 360 px phone: the toast wraps at 328 px, some 33 characters a line.)
    for (const t of [fullLineToast(2, 3, 1), fullLineToast(9, 12, 3)]) expect(t.length).toBeLessThanOrEqual(96);
  });
});

describe("waiting at points (routing step 5)", () => {
  it("a routed train behind, needing the other road, says who it waits for, then goes its way", () => {
    // A trunk into a switch: its straight road to a farm, its curve to a mill, buffers beyond each.
    const layout = new Layout();
    const trunk = chain(Array<PieceTypeId>(7).fill("straight-216"), layout);
    const sw = appendPiece(layout, "switch", false, connectorRef(trunk[trunk.length - 1], 1), 0);
    const x = loopChain(layout, ["straight-216", "depot-farm", "straight-216", "straight-216"], connectorRef(sw, 1));
    const p = loopChain(layout, ["curve-large", "straight-216", "depot-mill", "straight-216", "straight-216"], connectorRef(sw, 2), [true]);
    for (const end of [connectorRef(trunk[0], 0), connectorRef(x[3], 1), connectorRef(p[4], 1)]) appendPiece(layout, "buffer-turnback", false, end);
    const sim = new Sim(layout);
    const economy = new Economy(layout, sim);
    const farm = economy.addDepot("farm", x[1]);
    const mill = economy.addDepot("mill", p[2]);
    const place = (pieceId: number, s: number, cars: CarKind[]) => {
      const r = sim.addTrain(cars, { pieceId, pathIndex: 0, reversed: false, s });
      if (r.kind !== "placed") throw new Error("no room");
      return sim.getTrain(r.trainId)!.cars[0].id;
    };
    // (The first, long, for the farm; the second right behind it, for the mill.)
    const first = place(trunk[6], 200, ["engine", "hopper", "hopper", "hopper", "hopper"]);
    const second = place(trunk[4], 160, ["engine", "hopper"]);
    startLine(economy, first, [{ depotId: farm.id, action: "both" }]);
    startLine(economy, second, [{ depotId: mill.id, action: "both" }]);
    sim.setLever(first, 1);
    sim.setLever(second, 1);
    const said = new Set<string>();
    let onFarm = false;
    let atMill = false;
    for (let k = 0; k < 30 * 120 && !atMill; k++) {
      sim.tick();
      economy.tick();
      const t = sim.findCar(second)!.train;
      said.add(engineStatus(sim, economy, second, (id) => (id === mill.id ? "the mill" : "the farm")));
      onFarm ||= t.bogies.some((b) => x.includes(b.pieceId));
      atMill = t.bogies.some((b) => b.pieceId === p[2]);
    }
    const text = "Waiting for the train on the Red line to pass the points";
    expect([...said], [...said].join(" / ")).toContain(text);
    // (Two lines on a 360 px card: some 33 characters a line.)
    expect(text.length).toBeLessThanOrEqual(66);
    expect(atMill).toBe(true);
    expect(onFarm).toBe(false);
  });

  it("a red switch against its way: says to unpin it", () => {
    const layout = new Layout();
    const trunk = chain(["straight-216", "straight-216", "straight-216"], layout);
    const sw = appendPiece(layout, "switch", false, connectorRef(trunk[2], 1), 0);
    const x = loopChain(layout, ["straight-216", "depot-farm"], connectorRef(sw, 1));
    const p = loopChain(layout, ["curve-large", "depot-mill"], connectorRef(sw, 2), [true]);
    for (const end of [connectorRef(trunk[0], 0), connectorRef(x[1], 1), connectorRef(p[1], 1)]) appendPiece(layout, "buffer-turnback", false, end);
    layout.setPinned(sw, true);
    const sim = new Sim(layout);
    const economy = new Economy(layout, sim);
    const mill = economy.addDepot("mill", p[1]);
    const r = sim.addTrain(["engine"], { pieceId: trunk[1], pathIndex: 0, reversed: false, s: 100 });
    if (r.kind !== "placed") throw new Error("no room");
    const engine = sim.getTrain(r.trainId)!.cars[0].id;
    startLine(economy, engine, [{ depotId: mill.id, action: "both" }]);
    sim.setLever(engine, 1);
    for (let k = 0; k < 5 * 120; k++) {
      sim.tick();
      economy.tick();
    }
    const text = engineStatus(sim, economy, engine, () => "the mill");
    expect(text).toBe("A red switch is in the way. Tap and hold it to unpin");
    expect(text.length).toBeLessThanOrEqual(66);
    expect(sim.piecesUnder(r.trainId).has(sw)).toBe(false);
  });
});

describe("stuck for good (stalls.ts; routing §16 Q3: nothing turns a train back)", () => {
  it("two lines head on along one line: both stand nose to nose; each card names the other's line and the fix, in two lines", () => {
    const layout = new Layout();
    const ids = loopChain(layout, ["depot-forest", ...Array<PieceTypeId>(6).fill("straight-216"), "depot-sawmill"]);
    appendPiece(layout, "buffer-turnback", false, connectorRef(ids[0], 0));
    appendPiece(layout, "buffer-turnback", false, connectorRef(ids[ids.length - 1], 1));
    const sim = new Sim(layout);
    const economy = new Economy(layout, sim);
    const forest = economy.addDepot("forest", ids[0]);
    const mill = economy.addDepot("sawmill", ids[ids.length - 1]);
    const place = (pieceId: number, reversed: boolean) => {
      const r = sim.addTrain(["engine", "timber"], { pieceId, pathIndex: 0, reversed, s: 100 });
      if (r.kind !== "placed") throw new Error("no room");
      return sim.getTrain(r.trainId)!.cars[0].id;
    };
    const red = place(ids[1], false);
    const blue = place(ids[ids.length - 2], true);
    startLine(economy, red, [{ depotId: mill.id, action: "both" }]);
    startLine(economy, blue, [{ depotId: forest.id, action: "both" }]);
    sim.setLever(red, 1);
    sim.setLever(blue, 1);
    const told: number[][] = [];
    economy.stalls.onStuck = (engines) => told.push([...engines]);
    for (let k = 0; k < 30 * 120; k++) {
      sim.tick();
      economy.tick();
    }
    const said = [red, blue].map((e) => engineStatus(sim, economy, e, () => "the stop"));
    expect(said).toEqual(["Stuck: the train on the Blue line is in the way. Put one away", "Stuck: the train on the Red line is in the way. Put one away"]);
    for (const e of [red, blue]) expect(sim.findCar(e)!.train.lastTurn).toBeUndefined();
    // (Told once, for both.)
    expect(told).toEqual([[red, blue].sort((a, b) => a - b)]);
  });
});

describe("a lever tap on points set for a train (routing §16 Q1)", () => {
  it("says they're set for that train and switch to the player's way after it passes, in three lines at most", async () => {
    const { pointsSetFor } = await import("./engine-status");
    const { layout, ids } = chain(["straight-216", "straight-216"]);
    const sim = new Sim(layout);
    const economy = new Economy(layout, sim);
    const r = sim.addTrain(["engine"], { pieceId: ids[1], pathIndex: 0, reversed: false, s: 120 });
    if (r.kind !== "placed") throw new Error();
    const engine = sim.getTrain(r.trainId)!.cars[0].id;
    expect(pointsSetFor(economy, engine)).toBe("Set for a train. They'll switch to your way after it passes");
    startLine(economy, engine, []);
    const text = pointsSetFor(economy, engine);
    expect(text).toBe("Set for the train on the Red line. They'll switch to your way after it passes");
    expect(text.length).toBeLessThanOrEqual(96);
  });
});

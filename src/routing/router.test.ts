import { describe, expect, it } from "vitest";
import { Sim, SIM_HZ, type Train } from "../sim";
import { appendPiece, connectorRef, getPieceDef, Layout, type PieceTypeId } from "../track";
import { Economy } from "../economy/economy";
import { waysFrom } from "./graph";
import { plan } from "./plan";
import { Router, SET_LOOK, type AvoidTest } from "./router";

/** Lay `type` on free end `ref` (seated by an end of the other kind); returns its id. */
function lay(layout: Layout, ref: number, type: PieceTypeId): number {
  const end = layout.worldConnector(ref, { x: 0, z: 0, heading: 0, y: 0, kind: "peg" });
  const via = getPieceDef(type, false).connectors.findIndex((c) => c.kind !== end.kind);
  return appendPiece(layout, type, false, ref, via);
}

/** The other free end of a two-ended piece laid by `lay`. */
const otherEnd = (layout: Layout, id: number) => [0, 1].map((k) => connectorRef(id, k)).find((r) => layout.joinedConnector(r) === -1)!;

/**
 * A trunk of two straights into a switch; its straight way runs on to depot A, its curve to depot B (each the end of
 * its line). A train (engine and hopper) stands on the trunk heading for the switch.
 */
function junction() {
  const layout = new Layout();
  const t0 = layout.addPiece("straight-216", { x: 0, z: 0, heading: 0 });
  const t1 = lay(layout, connectorRef(t0, 1), "straight-216");
  const sw = lay(layout, otherEnd(layout, t1), "switch");
  const a1 = lay(layout, connectorRef(sw, 1), "straight-216");
  const a = lay(layout, otherEnd(layout, a1), "depot-farm");
  const b1 = lay(layout, connectorRef(sw, 2), "straight-216");
  const b = lay(layout, otherEnd(layout, b1), "depot-mill");
  const sim = new Sim(layout);
  const placed = sim.addTrain(["engine", "hopper"], { pieceId: t1, pathIndex: 0, reversed: false, s: 200 });
  if (placed.kind !== "placed") throw new Error("no room");
  const economy = new Economy(layout, sim);
  const depotA = economy.addDepot("farm", a);
  const depotB = economy.addDepot("mill", b);
  const engine = () => sim.getTrain(sim.trainIds()[0])!.cars.find((c) => c.kind === "engine")!;
  sim.setLever(engine().id, 1);
  /** Run up to `seconds`; the depots the train's axles were on, in the order it reached them. */
  const run = (seconds: number) => {
    const visits: number[] = [];
    for (let i = 0; i < seconds * SIM_HZ; i++) {
      sim.tick();
      economy.tick();
      for (const p of [a, b]) if (sim.getTrain(sim.trainIds()[0])!.bogies.some((x) => x.pieceId === p) && visits[visits.length - 1] !== p) visits.push(p);
    }
    return visits;
  };
  return { layout, sim, economy, sw, a, b, depotA, depotB, engine, run };
}

describe("routes steer", () => {
  it("left alone a train takes the switch as it's set; on a route it's set toward its stop", () => {
    const plain = junction();
    expect(plain.run(20)[0]).toBe(plain.a);
    const routed = junction();
    routed.economy.setRoute(routed.engine().id, { stops: [{ depotId: routed.depotB.id, action: "both" }], next: 0 });
    expect(routed.run(20)[0]).toBe(routed.b);
  });

  it("a route of two stops on different branches: it goes to one, turns back, and on to the other", () => {
    const j = junction();
    j.economy.setRoute(j.engine().id, {
      stops: [
        { depotId: j.depotB.id, action: "both" },
        { depotId: j.depotA.id, action: "both" },
      ],
      next: 0,
    });
    const visits = j.run(90);
    expect(visits.slice(0, 2)).toEqual([j.b, j.a]);
    expect(j.economy.routeOf(j.engine().id)!.next).toBeGreaterThanOrEqual(0);
  });

  it("finds a stop it can reach only by turning back at the end of a line", () => {
    // Trunk → switch S; S's straight way runs to depot A (an end), its curve on to a second switch S2, entered from
    // its curve end (trailing): through S2 the track goes on to an open end, so depot T on S2's straight way is
    // reached by running to that end, turning back, and taking S2 from its trunk.
    const layout = new Layout();
    const t0 = layout.addPiece("straight-216", { x: 0, z: 0, heading: 0 });
    const t1 = lay(layout, connectorRef(t0, 1), "straight-216");
    const sw = lay(layout, otherEnd(layout, t1), "switch");
    const a1 = lay(layout, connectorRef(sw, 1), "straight-216");
    const a = lay(layout, otherEnd(layout, a1), "depot-farm");
    const b1 = lay(layout, connectorRef(sw, 2), "straight-216");
    const fit = lay(layout, otherEnd(layout, b1), "adapter-socket");
    const sw2 = appendPiece(layout, "switch", false, otherEnd(layout, fit), 2);
    const e1 = lay(layout, connectorRef(sw2, 0), "straight-216");
    lay(layout, otherEnd(layout, e1), "straight-216");
    const c1 = lay(layout, connectorRef(sw2, 1), "straight-216");
    const t = lay(layout, otherEnd(layout, c1), "depot-mill");
    const sim = new Sim(layout);
    const placed = sim.addTrain(["engine", "hopper"], { pieceId: t1, pathIndex: 0, reversed: false, s: 200 });
    if (placed.kind !== "placed") throw new Error("no room");
    const economy = new Economy(layout, sim);
    economy.addDepot("farm", a);
    const target = economy.addDepot("mill", t);
    const engine = sim.getTrain(sim.trainIds()[0])!.cars.find((c) => c.kind === "engine")!;
    sim.setLever(engine.id, 1);
    economy.setRoute(engine.id, { stops: [{ depotId: target.id, action: "both" }], next: 0 });
    let reached = false;
    let farm = false;
    for (let i = 0; i < 120 * SIM_HZ && !reached; i++) {
      sim.tick();
      economy.tick();
      const bogies = sim.getTrain(sim.trainIds()[0])!.bogies;
      reached = bogies.some((x) => x.pieceId === t);
      farm ||= bogies.some((x) => x.pieceId === a);
    }
    expect(reached).toBe(true);
    expect(farm, "never down the wrong branch").toBe(false);
  });

  it("stops in a row at one depot are one visit: leaving it, the route goes on past them all", () => {
    const j = junction();
    j.economy.setRoute(j.engine().id, {
      stops: [
        { depotId: j.depotB.id, action: "drop" },
        { depotId: j.depotB.id, action: "pick" },
        { depotId: j.depotA.id, action: "both" },
      ],
      next: 0,
    });
    const visits = j.run(90);
    expect(visits.slice(0, 2)).toEqual([j.b, j.a]);
  });
});

describe("pinned switches", () => {
  it("a routed engine leaves a pinned switch alone; a stop only the other route reaches: it stands short of it", () => {
    const j = junction();
    j.layout.setPinned(j.sw, true); // set to its straight way, toward A
    j.economy.setRoute(j.engine().id, { stops: [{ depotId: j.depotB.id, action: "both" }], next: 0 });
    expect(plan(j.layout, { pieceId: j.sw, entry: 0, lead: true }, j.b)).toBeNull();
    expect(plan(j.layout, { pieceId: j.sw, entry: 0, lead: true }, j.a)).not.toBeNull();
    // (Step 5, §7: it never runs over the red switch to A; it stands short of it, saying why, till it's unpinned.)
    expect(j.run(20)).toEqual([]);
    expect(j.economy.router.waitOf(j.engine().id)).toEqual({ kind: "pinned", pieceId: j.sw });
    expect(j.sim.piecesUnder(j.sim.trainIds()[0]).has(j.sw)).toBe(false);
    expect(j.layout.switchState(j.sw)).toBe(0);
    j.layout.setPinned(j.sw, false);
    expect(j.run(20)[0]).toBe(j.b);
    expect(j.economy.router.waitOf(j.engine().id)).toBeNull();
    // Pinned to the curve: B is reached that way; routed to A, it stands short of them too (the switch never thrown).
    const k = junction();
    k.layout.setSwitchState(k.sw, 1);
    k.layout.setPinned(k.sw, true);
    k.economy.setRoute(k.engine().id, { stops: [{ depotId: k.depotA.id, action: "both" }], next: 0 });
    expect(plan(k.layout, { pieceId: k.sw, entry: 0, lead: true }, k.b)).not.toBeNull();
    expect(k.run(20)).toEqual([]);
    expect(k.economy.router.waitOf(k.engine().id)?.kind).toBe("pinned");
    expect(k.layout.switchState(k.sw)).toBe(1);
    // (Routed to B, the way they're pinned: on it goes.)
    k.economy.setRoute(k.engine().id, { stops: [{ depotId: k.depotB.id, action: "both" }], next: 0 });
    expect(k.run(20)[0]).toBe(k.b);
    expect(k.layout.switchState(k.sw)).toBe(1);
  });

  it("a caller can ask what if a switch weren't pinned, without touching the layout", () => {
    const j = junction();
    j.layout.setPinned(j.sw, true); // toward A: B is out of reach
    const version = j.layout.switchesVersion;
    const unpinned = (id: number) => id !== j.sw && j.layout.isPinned(id);
    expect(plan(j.layout, { pieceId: j.sw, entry: 0, lead: true }, j.b)).toBeNull();
    expect(plan(j.layout, { pieceId: j.sw, entry: 0, lead: true }, j.b, undefined, unpinned)).not.toBeNull();
    expect(waysFrom(j.layout, j.sw, 0, unpinned).length).toBe(2);
    expect(waysFrom(j.layout, j.sw, 0).length).toBe(1);
    expect(j.layout.isPinned(j.sw)).toBe(true);
    expect(j.layout.switchesVersion).toBe(version);
  });

  it("steers at the next switch beyond a pinned one, along the route it's pinned to", () => {
    // Trunk → S (pinned to its curve) → S2, whose straight way runs to depot C and curve to depot D.
    const layout = new Layout();
    const t0 = layout.addPiece("straight-216", { x: 0, z: 0, heading: 0 });
    const t1 = lay(layout, connectorRef(t0, 1), "straight-216");
    const sw = lay(layout, otherEnd(layout, t1), "switch");
    lay(layout, otherEnd(layout, lay(layout, connectorRef(sw, 1), "straight-216")), "depot-farm");
    const b1 = lay(layout, connectorRef(sw, 2), "straight-216");
    const sw2 = lay(layout, otherEnd(layout, b1), "switch");
    const c = lay(layout, otherEnd(layout, lay(layout, connectorRef(sw2, 1), "straight-216")), "depot-mill");
    const d = lay(layout, otherEnd(layout, lay(layout, connectorRef(sw2, 2), "straight-216")), "depot-farm");
    layout.setSwitchState(sw, 1);
    layout.setPinned(sw, true);
    const sim = new Sim(layout);
    const placed = sim.addTrain(["engine"], { pieceId: t1, pathIndex: 0, reversed: false, s: 200 });
    if (placed.kind !== "placed") throw new Error("no room");
    const engine = sim.getTrain(placed.trainId)!.cars[0].id;
    sim.setLever(engine, 1);
    const goals = new Map([[engine, d]]);
    const r = routerOn(layout, sim, goals);
    r.look();
    expect(layout.switchState(sw)).toBe(1);
    expect(layout.switchState(sw2)).toBe(1);
    // Which switch it threw (for its lever to swing): the one beyond the pin.
    expect(r.thrown).toEqual([sw2]);
    goals.set(engine, c);
    r.look();
    expect(layout.switchState(sw2)).toBe(0);
    expect(layout.switchState(sw)).toBe(1);
  });
});

/** Watch every throw: how many were made with a car on the points. */
function spyThrows(layout: Layout, sim: Sim): () => number {
  let under = 0;
  const set = layout.setSwitchState.bind(layout);
  layout.setSwitchState = (id: number, state: number) => {
    if (state !== layout.switchState(id) && sim.pointsHeld(id)) under++;
    set(id, state);
  };
  return () => under;
}

/** A train's net drive toward its front (as `Economy.drive`). */
function drive(train: Train): number {
  let net = 0;
  for (const car of train.cars) if (car.kind === "engine") net += car.lever * car.facing;
  return net;
}

/**
 * A `Router` on a sim with no economy: `goals` are the routed engines' stop pieces (in steering order); `granted` and
 * `awaiting` stand in for sections. `look()` runs one steering round (8 ticks); `thrown` lists every `onSwitch`.
 */
function routerOn(layout: Layout, sim: Sim, goals: Map<number, number>, opts: { granted?: (engine: number) => { follow: AvoidTest; aim: number } | undefined; awaiting?: (engine: number) => boolean } = {}) {
  const router = new Router({
    layout,
    sim,
    routed: goals,
    goal: (engine) => goals.get(engine) ?? -1,
    drive,
    granted: (engine) => opts.granted?.(engine),
    awaitingGrant: (engine) => !!opts.awaiting?.(engine),
    soon: new Set(),
  });
  const thrown: number[] = [];
  router.onSwitch = (id) => thrown.push(id);
  router.laid();
  return {
    router,
    thrown,
    look: () => {
      for (let i = 0; i < 8; i++) router.tick();
    },
    /** Run the sim with the router `seconds`. */
    run: (seconds: number) => {
      for (let i = 0; i < seconds * SIM_HZ; i++) {
        sim.tick();
        router.tick();
      }
    },
  };
}

/**
 * An oval of large curves with a switch in it (its straight way runs on round the oval) and a spur off its curve to
 * the end of a line. From the switch's trunk both ways reach the oval's far side: round it, or down the spur and back.
 * A train stands just short of the switch, heading into its trunk.
 */
function ovalWithSpur() {
  const layout = new Layout();
  const half: PieceTypeId[] = ["curve-large", "curve-large", "curve-large", "curve-large"];
  const types: PieceTypeId[] = [...half, "straight-216", "switch", ...half, "straight-216", "straight-144"];
  const ids: number[] = [];
  for (const t of types) ids.push(ids.length === 0 ? layout.addPiece(t, { x: 0, z: 0, heading: 0 }) : appendPiece(layout, t, false, connectorRef(ids[ids.length - 1], 1)));
  const sw = ids[5];
  const spur = appendPiece(layout, "straight-216", false, connectorRef(sw, 2));
  const sim = new Sim(layout);
  const placed = sim.addTrain(["engine"], { pieceId: ids[4], pathIndex: 0, reversed: false, s: 150 });
  if (placed.kind !== "placed") throw new Error("no room");
  const train = () => sim.getTrain(sim.trainIds()[0])!;
  return { layout, sim, ids, sw, spur, train, far: ids[1] };
}

describe("route locks (§3.2)", () => {
  it("a train asks for its next points only within its set distance, then sets them for its way", () => {
    // Four straights into a switch (straight on to A, its curve to B); an engine on the second, over 400 mm short of it.
    const layout = new Layout();
    const trunk = [layout.addPiece("straight-216", { x: 0, z: 0, heading: 0 })];
    for (let k = 0; k < 3; k++) trunk.push(appendPiece(layout, "straight-216", false, connectorRef(trunk[k], 1)));
    const sw = appendPiece(layout, "switch", false, connectorRef(trunk[3], 1));
    lay(layout, otherEnd(layout, lay(layout, connectorRef(sw, 1), "straight-216")), "depot-farm");
    const b = lay(layout, otherEnd(layout, lay(layout, connectorRef(sw, 2), "straight-216")), "depot-mill");
    const sim = new Sim(layout);
    const placed = sim.addTrain(["engine"], { pieceId: trunk[1], pathIndex: 0, reversed: false, s: 100 });
    if (placed.kind !== "placed") throw new Error("no room");
    const train = sim.getTrain(placed.trainId)!;
    sim.setLever(train.cars[0].id, 1);
    const r = routerOn(layout, sim, new Map([[train.cars[0].id, b]]));
    r.look();
    expect(layout.switchState(sw)).toBe(0);
    expect(r.router.locked(sw)).toBe(false);
    // On toward it: set once its front is within braking distance and SET_LOOK of the points, and locked for it.
    let shortBy = -1;
    for (let i = 0; i < 10 * SIM_HZ && shortBy < 0; i++) {
      sim.tick();
      r.router.tick();
      if (layout.switchState(sw) === 1) shortBy = 216 * (3 - trunk.indexOf(train.bogies[0].pieceId)) + 216 - train.bogies[0].s;
    }
    expect(shortBy).toBeGreaterThan(SET_LOOK - 20);
    expect(shortBy).toBeLessThanOrEqual(SET_LOOK + 120 ** 2 / 480);
    expect(r.router.locked(sw)).toBe(true);
    expect(r.thrown).toEqual([sw]);
  });

  it("is let go behind the last axle, and the points swing back to the player's default", () => {
    const j = junction();
    const r = routerOn(j.layout, j.sim, new Map([[j.engine().id, j.b]]));
    const underTrain = spyThrows(j.layout, j.sim);
    const seen: number[] = [];
    const train = j.sim.getTrain(j.sim.trainIds()[0])!;
    // (On till it's at B, off the points.)
    for (let i = 0; i < 20 * SIM_HZ && (j.sim.pointsHeld(j.sw) || !train.bogies.some((b) => b.pieceId === j.b)); i++) {
      j.sim.tick();
      r.router.tick();
      seen.push(j.layout.switchState(j.sw));
    }
    r.look();
    expect(underTrain(), "never moved with a car on them").toBe(0);
    expect(train.bogies.some((b) => b.pieceId === j.b)).toBe(true);
    expect(seen).toContain(1);
    expect(j.layout.switchState(j.sw)).toBe(0);
    expect(r.router.locked(j.sw)).toBe(false);
    // (Set, then put back: each is a lever swing with its click.)
    expect(r.thrown).toEqual([j.sw, j.sw]);
    expect(r.router.restored).toBe(1);
  });

  it("asks for every points up to the next clear point, all at once", () => {
    // Trunk → S → (curve) S2 → D: S and S2 are within one train length, so both are set in one ask.
    const layout = new Layout();
    const t0 = layout.addPiece("straight-216", { x: 0, z: 0, heading: 0 });
    const t1 = lay(layout, connectorRef(t0, 1), "straight-216");
    const sw = lay(layout, otherEnd(layout, t1), "switch");
    lay(layout, otherEnd(layout, lay(layout, connectorRef(sw, 1), "straight-216")), "depot-farm");
    const sw2 = lay(layout, connectorRef(sw, 2), "switch");
    lay(layout, otherEnd(layout, lay(layout, connectorRef(sw2, 1), "straight-216")), "depot-mill");
    const d = lay(layout, otherEnd(layout, lay(layout, connectorRef(sw2, 2), "straight-216")), "depot-farm");
    const sim = new Sim(layout);
    const placed = sim.addTrain(["engine", "hopper", "hopper"], { pieceId: t1, pathIndex: 0, reversed: false, s: 200 });
    if (placed.kind !== "placed") throw new Error("no room");
    const engine = sim.getTrain(placed.trainId)!.cars[0].id;
    sim.setLever(engine, 1);
    const r = routerOn(layout, sim, new Map([[engine, d]]));
    r.look();
    expect([layout.switchState(sw), layout.switchState(sw2)]).toEqual([1, 1]);
    expect(r.thrown).toEqual([sw, sw2]);
  });

  it("follows sections' granted way at points, whatever the plan", () => {
    const o = ovalWithSpur();
    const engine = o.train().cars[0].id;
    o.sim.setLever(engine, 1);
    // Round the oval is the shorter way; the grant sends it down the spur.
    const follow = (id: number, path: number) => id === o.sw && path === 1;
    const r = routerOn(o.layout, o.sim, new Map([[engine, o.far]]), { granted: () => ({ follow, aim: o.far }) });
    r.look();
    expect(o.layout.switchState(o.sw)).toBe(1);
    // With none, the plan's way: round the oval (the switch set back as it lies; the lock not under the train goes).
    const plain = ovalWithSpur();
    const e2 = plain.train().cars[0].id;
    plain.sim.setLever(e2, 1);
    const p = routerOn(plain.layout, plain.sim, new Map([[e2, plain.far]]));
    p.look();
    expect(plain.layout.switchState(plain.sw)).toBe(0);
    expect(p.router.locked(plain.sw)).toBe(true);
  });

  it("a line's train with no move granted sets nothing (§5.2)", () => {
    const j = junction();
    const r = routerOn(j.layout, j.sim, new Map([[j.engine().id, j.b]]), { awaiting: () => true });
    r.look();
    expect(j.layout.switchState(j.sw)).toBe(0);
    expect(r.router.locked(j.sw)).toBe(false);
  });
});

describe("route locks: two trains", () => {
  it("a train behind needing the same road shares the lock; the points go back once both are by", () => {
    // Trunk → switch → A / B: two trains on the trunk, close together, both routed to B.
    const j = junction();
    const t0 = j.layout.pieceIds().next().value!;
    const placed = j.sim.addTrain(["engine"], { pieceId: t0, pathIndex: 0, reversed: false, s: 190 });
    if (placed.kind !== "placed") throw new Error("no room");
    const behind = j.sim.getTrain(placed.trainId)!.cars[0].id;
    j.sim.setLever(behind, 1);
    const r = routerOn(j.layout, j.sim, new Map([[j.engine().id, j.b], [behind, j.b]]));
    const underTrain = spyThrows(j.layout, j.sim);
    let both = false;
    const second = j.sim.findCar(behind)!.train;
    // (On till the second is at B, off the points.)
    for (let i = 0; i < 30 * SIM_HZ && (j.sim.pointsHeld(j.sw) || !second.bogies.some((b) => b.pieceId === j.b)); i++) {
      j.sim.tick();
      r.router.tick();
      both ||= r.router.holders(j.sw) === 2;
    }
    r.look();
    expect(both).toBe(true);
    expect(underTrain()).toBe(0);
    expect(j.layout.switchState(j.sw)).toBe(0);
    // (Set once for both, put back once.)
    expect(r.thrown).toEqual([j.sw, j.sw]);
  });

  it("points held for one road aren't thrown for a train wanting the other (all or none); never under a train", () => {
    const j = junction();
    const t0 = j.layout.pieceIds().next().value!;
    const placed = j.sim.addTrain(["engine"], { pieceId: t0, pathIndex: 0, reversed: false, s: 60 });
    if (placed.kind !== "placed") throw new Error("no room");
    const behind = j.sim.getTrain(placed.trainId)!.cars[0].id;
    j.sim.setLever(behind, 1);
    const goals = new Map([[j.engine().id, j.b], [behind, j.a]]);
    const r = routerOn(j.layout, j.sim, goals);
    r.look();
    // (Set for the first; the second's ask, for the other road, refused: it holds nothing.)
    expect(j.layout.switchState(j.sw)).toBe(1);
    expect(r.router.holders(j.sw)).toBe(1);
    expect(r.router.refused).toBeGreaterThan(0);
    const underTrain = spyThrows(j.layout, j.sim);
    const second = j.sim.findCar(behind)!.train;
    let atA = false;
    for (let i = 0; i < 20 * SIM_HZ && !atA; i++) {
      j.sim.tick();
      r.router.tick();
      atA = second.bogies.some((x) => x.pieceId === j.a);
    }
    // (Once the first is by, the second gets them, for A.)
    expect(underTrain()).toBe(0);
    expect(atA).toBe(true);
  });
});

describe("a lever tap on points set for a train (§16 Q1, as changed at step 5)", () => {
  it("doesn't move them: the train keeps its route, the tap is their new default, and they go to it once it has passed", () => {
    const j = junction();
    const engine = j.engine().id;
    const r = routerOn(j.layout, j.sim, new Map([[engine, j.b]]));
    r.look();
    // (Laid set for A (0), their default; locked for the train, for B.)
    expect(j.layout.switchState(j.sw)).toBe(1);
    expect(r.router.lever(j.sw)).toEqual({ deferred: true, by: engine });
    expect(j.layout.switchState(j.sw)).toBe(1);
    expect(r.router.locked(j.sw)).toBe(true);
    // (From the way they're set, as seen: the other road, A. A second tap goes on round, to B; a third back to A.)
    expect(r.router.defaultOf(j.sw)).toBe(0);
    r.router.lever(j.sw);
    expect(r.router.defaultOf(j.sw)).toBe(1);
    r.router.lever(j.sw);
    expect(r.router.defaultOf(j.sw)).toBe(0);
    // It goes on to B as set, never moved under it; once it's off them they go back to the tap's way.
    const train = j.sim.getTrain(j.sim.trainIds()[0])!;
    const underTrain = spyThrows(j.layout, j.sim);
    for (let i = 0; i < 20 * SIM_HZ && !train.bogies.some((x) => x.pieceId === j.b); i++) {
      j.sim.tick();
      r.router.tick();
    }
    expect(train.bogies.some((x) => x.pieceId === j.b)).toBe(true);
    for (let i = 0; i < 5 * SIM_HZ; i++) {
      j.sim.tick();
      r.router.tick();
    }
    expect(underTrain()).toBe(0);
    expect(r.router.locked(j.sw)).toBe(false);
    expect(j.layout.switchState(j.sw)).toBe(0);
  });

  it("moves points no train holds at once", () => {
    const j = junction();
    const r = routerOn(j.layout, j.sim, new Map());
    expect(r.router.lever(j.sw)).toEqual({ ok: true });
    expect(j.layout.switchState(j.sw)).toBe(1);
    expect(r.router.defaultOf(j.sw)).toBe(1);
  });

  it("is refused with a car on the points", () => {
    const o = ovalWithSpur();
    const placed = o.sim.addTrain(["engine"], { pieceId: o.sw, pathIndex: 0, reversed: false, s: 60 });
    if (placed.kind !== "placed") throw new Error("no room");
    const r = routerOn(o.layout, o.sim, new Map());
    expect(r.router.lever(o.sw)).toEqual({ refused: "under-train" });
    expect(o.layout.switchState(o.sw)).toBe(0);
  });
});

describe("a load (§4)", () => {
  it("a routed train takes the locks on the points under it; they go back once it's off them", () => {
    const j = junction();
    const engine = j.engine().id;
    const r = routerOn(j.layout, j.sim, new Map([[engine, j.b]]));
    // Run till the train is on the points, set for B.
    for (let i = 0; i < 20 * SIM_HZ && !j.sim.pointsHeld(j.sw); i++) {
      j.sim.tick();
      r.router.tick();
    }
    expect(j.layout.switchState(j.sw)).toBe(1);
    const saved = r.router.save();
    expect(saved).toEqual([[j.sw, 0]]);
    // (A new router, as a load makes one: the defaults restored, no locks.)
    const again = routerOn(j.layout, j.sim, new Map([[engine, j.b]]));
    again.router.restore(saved);
    expect(again.router.locked(j.sw)).toBe(false);
    again.look();
    expect(again.router.locked(j.sw)).toBe(true);
    // (On till it's at B, off the points: they've gone back.)
    const train = j.sim.getTrain(j.sim.trainIds()[0])!;
    for (let i = 0; i < 20 * SIM_HZ && (j.sim.pointsHeld(j.sw) || !train.bogies.some((x) => x.pieceId === j.b)); i++) {
      j.sim.tick();
      again.router.tick();
    }
    again.look();
    expect(j.sim.pointsHeld(j.sw)).toBe(false);
    expect(j.layout.switchState(j.sw)).toBe(0);
    expect(again.router.restored).toBe(1);
  });
});

describe("a switch with a train on it", () => {
  it("is never thrown under the train (its cars behind would take the other road)", () => {
    const o = ovalWithSpur();
    const engine = o.train().cars[0].id;
    o.sim.setLever(engine, 1);
    const placed = o.sim.addTrain(["engine"], { pieceId: o.sw, pathIndex: 0, reversed: false, s: 60 });
    if (placed.kind !== "placed") throw new Error("no room");
    const follow = (id: number, path: number) => id === o.sw && path === 1;
    const r = routerOn(o.layout, o.sim, new Map([[engine, o.far]]), { granted: () => ({ follow, aim: o.far }) });
    r.look();
    expect(o.layout.switchState(o.sw)).toBe(0);
    expect(r.router.refused).toBe(1);
  });

  it("a routed train doesn't throw the switch under a line-mate still on it", () => {
    // Trunk → switch → A (straight) / B (curve). One train stands across the switch on its straight way; another, on
    // the trunk behind it, is routed to B. Its steering must wait till the switch is clear.
    const j = junction();
    const placed = j.sim.addTrain(["engine"], { pieceId: j.sw, pathIndex: 0, reversed: false, s: 120 });
    if (placed.kind !== "placed") throw new Error("no room");
    j.economy.setRoute(j.engine().id, { stops: [{ depotId: j.depotB.id, action: "both" }], next: 0 });
    for (let i = 0; i < 3 * SIM_HZ; i++) {
      j.economy.tick();
      expect(j.layout.switchState(j.sw)).toBe(0);
    }
  });
});

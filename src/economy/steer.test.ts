import { describe, expect, it } from "vitest";
import { Sim, SIM_HZ } from "../sim";
import { appendPiece, connectorRef, getPieceDef, Layout, type PieceTypeId } from "../track";
import { Economy } from "./economy";
import { distanceTo, steer, waysFrom } from "./steer";

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
  it("a routed engine leaves a pinned switch alone; a stop only the other route reaches is out of reach", () => {
    const j = junction();
    j.layout.setPinned(j.sw, true); // set to its straight way, toward A
    j.economy.setRoute(j.engine().id, { stops: [{ depotId: j.depotB.id, action: "both" }], next: 0 });
    const train = j.sim.getTrain(j.sim.trainIds()[0])!;
    expect(steer(j.layout, train, true, j.b)).toBe(false);
    expect(distanceTo(j.layout, { pieceId: j.sw, entry: 0 }, j.b)).toBe(-1);
    expect(distanceTo(j.layout, { pieceId: j.sw, entry: 0 }, j.a)).toBeGreaterThan(0);
    expect(j.run(20)[0]).toBe(j.a);
    expect(j.layout.switchState(j.sw)).toBe(0);
    // Pinned to the curve, B is reached that way (and the switch is still never thrown).
    const k = junction();
    k.layout.setSwitchState(k.sw, 1);
    k.layout.setPinned(k.sw, true);
    k.economy.setRoute(k.engine().id, { stops: [{ depotId: k.depotA.id, action: "both" }], next: 0 });
    expect(distanceTo(k.layout, { pieceId: k.sw, entry: 0 }, k.b)).toBeGreaterThan(0);
    expect(k.run(20)[0]).toBe(k.b);
    expect(k.layout.switchState(k.sw)).toBe(1);
  });

  it("a caller can ask what if a switch weren't pinned, without touching the layout", () => {
    const j = junction();
    j.layout.setPinned(j.sw, true); // toward A: B is out of reach
    const version = j.layout.switchesVersion;
    const unpinned = (id: number) => id !== j.sw && j.layout.isPinned(id);
    expect(distanceTo(j.layout, { pieceId: j.sw, entry: 0 }, j.b)).toBe(-1);
    expect(distanceTo(j.layout, { pieceId: j.sw, entry: 0 }, j.b, unpinned)).toBeGreaterThan(0);
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
    const train = sim.getTrain(placed.trainId)!;
    expect(steer(layout, train, true, d)).toBe(true);
    expect(layout.switchState(sw)).toBe(1);
    expect(layout.switchState(sw2)).toBe(1);
    expect(steer(layout, train, true, c)).toBe(true);
    expect(layout.switchState(sw2)).toBe(0);
    expect(layout.switchState(sw)).toBe(1);
  });
});

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
  return { layout, ids, sw, spur, train, far: ids[1] };
}

describe("steer: an avoid hint", () => {
  it("without one, or with nothing in it, the choice is as ever", () => {
    const o = ovalWithSpur();
    expect(o.layout.switchState(o.sw)).toBe(0);
    expect(steer(o.layout, o.train(), true, o.far)).toBe(false);
    expect(steer(o.layout, o.train(), true, o.far, () => false)).toBe(false);
    expect(o.layout.switchState(o.sw)).toBe(0);
  });

  it("passes over a way onto avoided track, through the switch or just after it, while the other still gets there", () => {
    const o = ovalWithSpur();
    // The straight way through the switch avoided: down the spur (and back) instead.
    expect(steer(o.layout, o.train(), true, o.far, (id, path) => id === o.sw && path === 0)).toBe(true);
    expect(o.layout.switchState(o.sw)).toBe(1);
    // The spur (just after the switch's curve) avoided: back to the straight way.
    expect(steer(o.layout, o.train(), true, o.far, (id) => id === o.spur)).toBe(true);
    expect(o.layout.switchState(o.sw)).toBe(0);
  });

  it("never strands a train: with every way avoided it chooses as without the hint, and a pinned switch wins", () => {
    const o = ovalWithSpur();
    expect(steer(o.layout, o.train(), true, o.far, (id) => id === o.sw)).toBe(false);
    expect(o.layout.switchState(o.sw)).toBe(0);
    o.layout.setPinned(o.sw, true);
    expect(steer(o.layout, o.train(), true, o.far, (id, path) => id === o.sw && path === 0)).toBe(false);
    expect(o.layout.switchState(o.sw)).toBe(0);
  });
});

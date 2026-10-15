import { describe, expect, it } from "vitest";
import { Sim, SIM_HZ } from "../sim";
import { appendPiece, connectorRef, getPieceDef, Layout, type PieceTypeId } from "../track";
import { Economy } from "./economy";

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

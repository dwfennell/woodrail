import { describe, expect, it } from "vitest";
import { connectorRef, createWorldConnector, getPieceDef, Layout, LIFT_BRIDGE_LENGTH, type PieceTypeId } from "../track";
import { BRIDGE_RISE_S, BRIDGE_UP_S, Sim, SIM_HZ } from ".";

function onEnd(layout: Layout, id: number, index: number, type: PieceTypeId): number {
  const c = createWorldConnector();
  layout.worldConnector(connectorRef(id, index), c);
  return layout.addPiece(type, { x: c.x, z: c.z, heading: c.heading }, c.y);
}

/** A line over a lift bridge: three straights, the bridge, two straights, a turnback buffer; the train on the first. */
function line(s = 200) {
  const layout = new Layout();
  layout.addPiece("buffer", { x: 0, z: 0, heading: Math.PI });
  const first = layout.addPiece("straight-216", { x: 0, z: 0, heading: 0 });
  const a = onEnd(layout, first, 1, "straight-216");
  const near = onEnd(layout, a, 1, "straight-216");
  const bridge = onEnd(layout, near, 1, "kit-lift-bridge");
  const beyond = onEnd(layout, bridge, 1, "straight-216");
  const far = onEnd(layout, beyond, 1, "straight-216");
  onEnd(layout, far, 1, "buffer-turnback");
  const sim = new Sim(layout);
  const placed = sim.addTrain(["engine", "passenger"], { pieceId: a, pathIndex: 0, reversed: false, s });
  if (placed.kind !== "placed") throw new Error("no room");
  const train = () => sim.getTrain(sim.trainIds()[0])!;
  const tick = (n = 1) => {
    for (let i = 0; i < n; i++) sim.tick();
  };
  return { layout, sim, bridge, near, beyond, train, tick };
}

describe("the lift bridge", () => {
  it("is a gated straight at the ground, its span one way", () => {
    const def = getPieceDef("kit-lift-bridge", false);
    expect(def.gated).toBe(true);
    expect(def.drawbridge).toBeDefined();
    expect(def.paths).toHaveLength(1);
    expect(def.connectors.map((c) => c.y)).toEqual([0, 0]);
    expect(def.connectors[1].pose.x).toBeCloseTo(LIFT_BRIDGE_LENGTH);
  });

  it("goes up, stays up, comes down by itself; the sim's position follows", () => {
    const { sim, bridge, tick } = line();
    expect(sim.raiseBridge(bridge)).toBe(true);
    expect(sim.raiseBridge(bridge)).toBe(false);
    expect(sim.bridgeRaised(bridge)).toBe(true);
    expect(sim.bridgeOpen(bridge)).toBe(false);
    tick(BRIDGE_RISE_S * SIM_HZ + 2);
    expect(sim.bridgeOpen(bridge)).toBe(true);
    expect(sim.liftPosition(bridge)).toBe(1);
    // Nothing moves while it's held up: no redraws.
    const v = sim.ridesVersion;
    tick(SIM_HZ);
    expect(sim.ridesVersion).toBe(v);
    tick((BRIDGE_UP_S + BRIDGE_RISE_S) * SIM_HZ);
    expect(sim.bridgeRaised(bridge)).toBe(false);
    expect(sim.liftPosition(bridge)).toBe(0);
  });

  it("a train coming to it while it's up halts at its end, then goes on over once it's down", () => {
    const { sim, bridge, near, beyond, train, tick } = line();
    expect(sim.raiseBridge(bridge)).toBe(true);
    sim.setLever(train().cars[0].id, 1);
    tick(BRIDGE_RISE_S * SIM_HZ + 3 * SIM_HZ);
    // Held on the near straight, short of the bridge, and its card says why.
    expect(train().speed).toBe(0);
    expect(train().bogies[0].pieceId).toBe(near);
    expect(train().turnback).toBe(-1);
    expect(sim.bridgeWait(train().id)).toBe(true);
    tick((BRIDGE_UP_S + BRIDGE_RISE_S) * SIM_HZ);
    let crossed = false;
    for (let i = 0; i < 10 * SIM_HZ && !crossed; i++) {
      tick();
      crossed = train().bogies[0].pieceId === beyond;
    }
    expect(crossed).toBe(true);
  });

  it("won't go up with a train coming in close, or on it", () => {
    const { sim, bridge, near, train, tick } = line();
    sim.setLever(train().cars[0].id, 1);
    // Close: the front axle near the end of the straight before it, running at speed.
    for (let i = 0; i < 20 * SIM_HZ && !(train().bogies[0].pieceId === near && train().bogies[0].s > 180); i++) tick();
    expect(train().speed).toBeGreaterThan(0);
    expect(sim.raiseBridge(bridge)).toBe(false);
    for (let i = 0; i < 20 * SIM_HZ && train().bogies[0].pieceId !== bridge; i++) tick();
    expect(sim.raiseBridge(bridge)).toBe(false);
    expect(sim.bridgeRaised(bridge)).toBe(false);
  });

  it("a tap raises it (toggleSwitch)", () => {
    const { sim, bridge } = line();
    expect(sim.toggleSwitch(bridge)).toBe(true);
    expect(sim.bridgeRaised(bridge)).toBe(true);
  });
});

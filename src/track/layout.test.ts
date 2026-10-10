import { describe, expect, it } from "vitest";
import { connectorRef, createWorldConnector, Layout } from "./layout";
import type { Pose } from "./math";

const P = (x: number, z: number, heading = 0): Pose => ({ x, z, heading });
const deg = (d: number) => (d * Math.PI) / 180;

describe("Layout seating", () => {
  it("seats two exactly aligned straights", () => {
    const l = new Layout();
    const a = l.addPiece("straight-144", P(0, 0));
    const b = l.addPiece("straight-144", P(144, 0));
    expect(l.jointCount).toBe(1);
    expect(l.joinedConnector(connectorRef(a, 1))).toBe(connectorRef(b, 0));
    expect(l.joinedConnector(connectorRef(b, 0))).toBe(connectorRef(a, 1));
    expect(l.jointAt(connectorRef(a, 1))!.posError).toBeCloseTo(0);
  });

  it("seats within ±1.5 mm and records the error", () => {
    const l = new Layout();
    l.addPiece("straight-144", P(0, 0));
    l.addPiece("straight-144", P(145, 0));
    expect(l.jointCount).toBe(1);
    expect([...l.joints()][0].posError).toBeCloseTo(1);
  });

  it("does not seat beyond the position tolerance", () => {
    const l = new Layout();
    l.addPiece("straight-144", P(0, 0));
    l.addPiece("straight-144", P(147, 0));
    expect(l.jointCount).toBe(0);
  });

  it("seats within ±2° and not beyond", () => {
    const ok = new Layout();
    ok.addPiece("straight-144", P(0, 0));
    ok.addPiece("straight-144", P(144, 0, deg(1.5)));
    expect(ok.jointCount).toBe(1);
    expect([...ok.joints()][0].angleError).toBeCloseTo(deg(1.5));

    const bad = new Layout();
    bad.addPiece("straight-144", P(0, 0));
    bad.addPiece("straight-144", P(144, 0, deg(3)));
    expect(bad.jointCount).toBe(0);
  });

  it("never joins two pegs or two sockets", () => {
    const l = new Layout();
    l.addPiece("straight-144", P(0, 0)); // peg at x=144
    l.addPiece("adapter-peg", P(144, 0)); // peg at x=144 facing back
    expect(l.jointCount).toBe(0);
  });

  it("seats across the ±π heading wrap", () => {
    const l = new Layout();
    l.addPiece("straight-144", P(0, 0, Math.PI)); // peg at x=-144, facing -x
    l.addPiece("straight-144", P(-144, 0, -Math.PI)); // same orientation expressed as -π
    expect(l.jointCount).toBe(1);
  });

  it("requires matching height", () => {
    const l = new Layout();
    l.addPiece("straight-144", P(0, 0), 0);
    l.addPiece("straight-144", P(144, 0), 64);
    expect(l.jointCount).toBe(0);
  });

  it("ramp joins floor track to elevated track", () => {
    const l = new Layout();
    l.addPiece("straight-144", P(0, 0));
    l.addPiece("ramp", P(144, 0));
    l.addPiece("bridge", P(360, 0), 0); // bridge track sits at RISER_HEIGHT on its own legs
    expect(l.jointCount).toBe(2);
  });

  it("never makes a triple join on an already-joined connector", () => {
    const l = new Layout();
    l.addPiece("straight-144", P(0, 0));
    l.addPiece("straight-144", P(144, 0));
    l.addPiece("straight-108", P(144, 0)); // its socket sits on the same, already-joined peg
    expect(l.jointCount).toBe(1);
  });
});

describe("Layout editing", () => {
  it("removing a piece frees its neighbours' connectors for re-use", () => {
    const l = new Layout();
    const a = l.addPiece("straight-144", P(0, 0));
    const b = l.addPiece("straight-144", P(144, 0));
    l.addPiece("straight-144", P(288, 0));
    expect(l.jointCount).toBe(2);
    expect(l.removePiece(b)).toBe(true);
    expect(l.jointCount).toBe(0);
    expect(l.joinedConnector(connectorRef(a, 1))).toBe(-1);
    l.addPiece("straight-144", P(144, 0));
    expect(l.jointCount).toBe(2);
  });

  it("removing an unknown id returns false", () => {
    expect(new Layout().removePiece(42)).toBe(false);
  });

  it("moving a piece away unseats it, moving it back re-seats it", () => {
    const l = new Layout();
    l.addPiece("straight-144", P(0, 0));
    const b = l.addPiece("straight-144", P(144, 0));
    expect(l.movePiece(b, P(500, 500), 0)).toBe(true);
    expect(l.jointCount).toBe(0);
    expect(l.movePiece(b, P(144, 0), 0)).toBe(true);
    expect(l.jointCount).toBe(1);
    expect(l.getPiece(b)!.pose).toEqual(P(144, 0));
  });

  it("free connector queries exclude joined connectors", () => {
    const l = new Layout();
    l.addPiece("straight-144", P(0, 0));
    l.addPiece("straight-144", P(144, 0));
    const out: number[] = [];
    const n = l.queryFreeConnectors(144, 0, 5, out);
    expect(n).toBe(0);
  });

  it("computes world connectors from piece pose", () => {
    const l = new Layout();
    const a = l.addPiece("straight-144", P(10, 20, Math.PI / 2), 64);
    const w = l.worldConnector(connectorRef(a, 1), createWorldConnector());
    expect(w.x).toBeCloseTo(10);
    expect(w.z).toBeCloseTo(164);
    expect(w.y).toBe(64);
    expect(w.heading).toBeCloseTo(Math.PI / 2);
    expect(w.kind).toBe("peg");
  });

  it("stores switch state per piece, defaulting to 0", () => {
    const l = new Layout();
    const s = l.addPiece("switch", P(0, 0));
    expect(l.switchState(s)).toBe(0);
    l.setSwitchState(s, 1);
    expect(l.switchState(s)).toBe(1);
    l.removePiece(s);
    expect(l.switchState(s)).toBe(0);
  });
});

describe("Layout review fixes", () => {
  it("re-seats a freed neighbour with a free connector already at the same spot", () => {
    const l = new Layout();
    const a = l.addPiece("straight-144", P(0, 0));
    const b = l.addPiece("straight-144", P(144, 0));
    const c = l.addPiece("straight-108", P(144, 0)); // overlaps b; its socket stays free
    expect(l.jointCount).toBe(1);
    l.removePiece(b);
    expect(l.joinedConnector(connectorRef(a, 1))).toBe(connectorRef(c, 0));
  });

  it("lifting a piece frees its neighbours so it can snap back into its own gap", () => {
    const l = new Layout();
    l.addPiece("straight-144", P(0, 0));
    const b = l.addPiece("straight-144", P(144, 0));
    l.addPiece("straight-144", P(288, 0));
    l.liftPiece(b);
    expect(l.jointCount).toBe(0);
    expect(l.isLifted(b)).toBe(true);
    const out: number[] = [];
    expect(l.queryFreeConnectors(144, 0, 2, out)).toBe(1); // a's peg is free; b's own socket is not offered
    l.dropPiece(b, P(144, 0), 0);
    expect(l.isLifted(b)).toBe(false);
    expect(l.jointCount).toBe(2);
  });
});

import { describe, expect, it } from "vitest";
import { connectorRef, Layout } from "./layout";
import type { Pose } from "./math";
import { createSample, pathLength, samplePath } from "./path";
import { getPieceDef } from "./pieces";
import { createRouteStep, pathExitConnector, routeFrom } from "./routing";
import { appendPiece } from "./snap";

const P = (x: number, z: number, heading = 0): Pose => ({ x, z, heading });

describe("routeFrom", () => {
  it("goes forward from one straight into the next", () => {
    const l = new Layout();
    const a = l.addPiece("straight-144", P(0, 0));
    const b = appendPiece(l, "straight-144", false, connectorRef(a, 1));
    const out = createRouteStep();
    expect(routeFrom(l, a, 1, out)).toBe(true);
    expect(out).toEqual({ pieceId: b, pathIndex: 0, reversed: false });
  });

  it("goes backward, entering the previous piece at its path end", () => {
    const l = new Layout();
    const a = l.addPiece("straight-144", P(0, 0));
    const b = appendPiece(l, "straight-144", false, connectorRef(a, 1));
    const out = createRouteStep();
    expect(routeFrom(l, b, 0, out)).toBe(true);
    expect(out).toEqual({ pieceId: a, pathIndex: 0, reversed: true });
  });

  it("returns false at an open end", () => {
    const l = new Layout();
    const a = l.addPiece("straight-144", P(0, 0));
    expect(routeFrom(l, a, 1, createRouteStep())).toBe(false);
  });

  it("follows switch state when entering at the trunk", () => {
    const l = new Layout();
    const a = l.addPiece("straight-144", P(0, 0));
    const s = appendPiece(l, "switch", false, connectorRef(a, 1));
    const out = createRouteStep();
    routeFrom(l, a, 1, out);
    expect(out.pathIndex).toBe(0);
    l.setSwitchState(s, 1);
    routeFrom(l, a, 1, out);
    expect(out).toEqual({ pieceId: s, pathIndex: 1, reversed: false });
  });

  it("always merges when entering from a branch, regardless of switch state", () => {
    const l = new Layout();
    const s = l.addPiece("switch", P(0, 0));
    const tail = appendPiece(l, "straight-144", false, connectorRef(s, 2)); // straight's socket seats on the branch peg
    const out = createRouteStep();
    l.setSwitchState(s, 0); // set to straight; merging in from the curved branch must still work
    expect(routeFrom(l, tail, 0, out)).toBe(true);
    expect(out).toEqual({ pieceId: s, pathIndex: 1, reversed: true });
  });

  it("flipped switch branches the other way and still uses state 1 for the branch", () => {
    const l = new Layout();
    const a = l.addPiece("straight-144", P(0, 0));
    const s = appendPiece(l, "switch", true, connectorRef(a, 1));
    l.setSwitchState(s, 1);
    const out = createRouteStep();
    routeFrom(l, a, 1, out);
    expect(out.pathIndex).toBe(1);
    const geom = getPieceDef("switch", true).paths[1].geom;
    expect(samplePath(geom, pathLength(geom), createSample()).z).toBeLessThan(0);
  });

  it("crossing routes each line straight through", () => {
    const l = new Layout();
    const c = l.addPiece("crossing", P(0, 0));
    const before = l.addPiece("straight-144", P(72, -216, Math.PI / 2)); // peg at (72,-72) facing +z
    const out = createRouteStep();
    expect(routeFrom(l, before, 1, out)).toBe(true);
    expect(out).toEqual({ pieceId: c, pathIndex: 1, reversed: false });
  });
});

describe("pathExitConnector", () => {
  it("returns the far connector, the near one when reversed, and -1 for buffers", () => {
    const sw = getPieceDef("switch", false);
    expect(pathExitConnector(sw, 1, false)).toBe(2);
    expect(pathExitConnector(sw, 1, true)).toBe(0);
    expect(pathExitConnector(getPieceDef("buffer", false), 0, false)).toBe(-1);
  });
});

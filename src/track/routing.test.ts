import { describe, expect, it } from "vitest";
import { connectorRef, Layout } from "./layout";
import type { Pose } from "./math";
import { createSample, pathLength, samplePath } from "./path";
import { getPieceDef } from "./pieces";
import { createRouteStep, pathExitConnector, routeFrom } from "./routing";
import { appendPiece } from "./snap";
import { Sim } from "../sim";

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

  it("a three-way switch steps through straight, left and right; a Y through its two curves", () => {
    const sim = new Sim(new Layout());
    const l = sim.layout;
    const a = l.addPiece("straight-144", P(0, 0));
    const s = appendPiece(l, "switch-3way", false, connectorRef(a, 1));
    const out = createRouteStep();
    const seen: number[] = [];
    for (let i = 0; i < 4; i++) {
      routeFrom(l, a, 1, out);
      seen.push(out.pathIndex);
      sim.toggleSwitch(s);
    }
    expect(seen).toEqual([0, 1, 2, 0]);
    const b = l.addPiece("straight-144", P(0, 400));
    const y = appendPiece(l, "switch-y", false, connectorRef(b, 1));
    const ys: number[] = [];
    for (let i = 0; i < 3; i++) {
      routeFrom(l, b, 1, out);
      ys.push(out.pathIndex);
      sim.toggleSwitch(y);
    }
    expect(ys).toEqual([0, 1, 0]);
  });

  it("a crossover sends trains on, or over to the other line, from either line's facing end", () => {
    const l = new Layout();
    const a = l.addPiece("straight-144", P(0, 0));
    const x = appendPiece(l, "crossover", false, connectorRef(a, 1));
    const out = createRouteStep();
    routeFrom(l, a, 1, out);
    expect(getPieceDef("crossover", false).paths[out.pathIndex].to).toBe(1);
    l.setSwitchState(x, 1);
    routeFrom(l, a, 1, out);
    expect(getPieceDef("crossover", false).paths[out.pathIndex].to).toBe(3);
    // Coming back along the other line (into its far end), the same lever picks its line or the link across.
    const b = appendPiece(l, "straight-144", false, connectorRef(x, 3));
    routeFrom(l, b, 0, out);
    expect(out.reversed).toBe(true);
    expect(getPieceDef("crossover", false).paths[out.pathIndex].from).toBe(0);
    l.setSwitchState(x, 0);
    routeFrom(l, b, 0, out);
    expect(getPieceDef("crossover", false).paths[out.pathIndex].from).toBe(2);
    expect(out.reversed).toBe(true);
  });

  it("a wye: from any of its three ends, the lever picks which of the other two a train runs to", () => {
    const l = new Layout();
    const w = l.addPiece("wye", P(0, 0));
    const def = getPieceDef("wye", false);
    const out = createRouteStep();
    const ends = (connector: number) => {
      const t = appendPiece(l, "straight-144", false, connectorRef(w, connector));
      const seen = new Set<number>();
      // (Its lever at that end: a bit of the state each, #15.)
      for (const state of [0, 1 << connector]) {
        l.setSwitchState(w, state);
        routeFrom(l, t, 0, out);
        const p = def.paths[out.pathIndex];
        seen.add(out.reversed ? p.from : p.to!);
      }
      return [...seen].sort();
    };
    expect(ends(1)).toEqual([0, 2]);
    expect(ends(2)).toEqual([0, 1]);
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

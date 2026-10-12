import { describe, expect, it } from "vitest";
import {
  bestTurn,
  distinctTurns,
  EDGE_E,
  EDGE_N,
  EDGE_S,
  EDGE_W,
  edgesOf,
  encodeRoad,
  pieceForEdges,
  pieceOf,
  portsMeet,
  roadsJoin,
  ROAD_PIECES,
  turnOf,
  type Port,
} from "./pieces";

const bit = (...edges: number[]) => edges.reduce((m, e) => m | (1 << e), 0);

describe("road pieces", () => {
  it("codes are unique, non-zero and fit six bits", () => {
    const codes = ROAD_PIECES.map((p) => p.code);
    expect(new Set(codes).size).toBe(codes.length);
    for (const c of codes) expect(c > 0 && c < 64).toBe(true);
  });

  it("a road byte round-trips piece and turn; 0 is no road", () => {
    for (const p of ROAD_PIECES) {
      for (let t = 0; t < 4; t++) {
        const b = encodeRoad(p.id, t);
        expect(b).toBeGreaterThan(0);
        expect(b).toBeLessThan(256);
        expect(pieceOf(b)?.id).toBe(p.id);
        expect(turnOf(b)).toBe(t);
      }
    }
    expect(pieceOf(0)).toBeNull();
    expect(edgesOf(0)).toBe(0);
  });

  it("turning moves ports a quarter round: +x, then +z, then −x, then −z", () => {
    expect(edgesOf(encodeRoad("end", 0))).toBe(bit(EDGE_W));
    expect(edgesOf(encodeRoad("end", 1))).toBe(bit(EDGE_N));
    expect(edgesOf(encodeRoad("end", 2))).toBe(bit(EDGE_E));
    expect(edgesOf(encodeRoad("end", 3))).toBe(bit(EDGE_S));
    expect(edgesOf(encodeRoad("curve", 1))).toBe(bit(EDGE_N, EDGE_W));
  });

  it("counts distinct turns", () => {
    expect(distinctTurns("straight")).toEqual([0, 1]);
    expect(distinctTurns("cross")).toEqual([0]);
    expect(distinctTurns("curve")).toHaveLength(4);
    expect(distinctTurns("tee")).toHaveLength(4);
  });

  it("two squares join only where both have a port on the shared edge", () => {
    const ew = encodeRoad("straight", 0);
    const ns = encodeRoad("straight", 1);
    expect(roadsJoin(ew, EDGE_E, ew)).toBe(true);
    // Parallel roads side by side don't join.
    expect(roadsJoin(ew, EDGE_S, ew)).toBe(false);
    expect(roadsJoin(ew, EDGE_E, ns)).toBe(false);
    expect(roadsJoin(ew, EDGE_E, 0)).toBe(false);
  });

  it("one-way half ports meet the mirrored half going the other way", () => {
    const out: Port = { edge: EDGE_E, slot: "left", flow: "out" };
    expect(portsMeet(out, { edge: EDGE_W, slot: "right", flow: "in" })).toBe(true);
    expect(portsMeet(out, { edge: EDGE_W, slot: "left", flow: "in" })).toBe(false);
    expect(portsMeet(out, { edge: EDGE_W, slot: "right", flow: "out" })).toBe(false);
    expect(portsMeet(out, { edge: EDGE_W, slot: "mid", flow: "both" })).toBe(false);
  });

  it("turns a dropped piece to join its neighbours", () => {
    const ew = encodeRoad("straight", 0);
    const ns = encodeRoad("straight", 1);
    // Road to the west and road to the south: a bend joining both.
    const n = [0, ns, ew, 0];
    const t = bestTurn("curve", n);
    expect(edgesOf(encodeRoad("curve", t))).toBe(bit(EDGE_W, EDGE_S));
    // A straight between north and south roads runs north–south.
    expect(edgesOf(encodeRoad("straight", bestTurn("straight", [0, ns, 0, ns])))).toBe(bit(EDGE_N, EDGE_S));
    // Nothing near: keeps the held turn.
    expect(bestTurn("curve", [0, 0, 0, 0], 3)).toBe(3);
  });

  it("finds the piece for a set of edges", () => {
    for (let mask = 1; mask < 16; mask++) {
      const road = pieceForEdges(mask);
      expect(edgesOf(road)).toBe(mask);
      expect(pieceOf(road)?.id).not.toBe("zebra");
    }
    expect(edgesOf(pieceForEdges(0))).toBe(bit(EDGE_E));
  });
});

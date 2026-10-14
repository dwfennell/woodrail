import { describe, expect, it } from "vitest";
import { gridWithPlots } from "../landscape/grid";
import { autoEdges, autoReshapes, autoShape } from "./auto";
import { EDGE_E, EDGE_N, EDGE_S, EDGE_W, edgesOf, encodeRoad, isAutoRoad, pieceOf } from "./pieces";

const bits = (...e: number[]) => e.reduce((m, x) => m | (1 << x), 0);

describe("auto roads", () => {
  /** Lay an auto road at (col, row) with its neighbours reshaped, as the road hand does. */
  function lay(g: ReturnType<typeof gridWithPlots>, col: number, row: number, road?: number) {
    const i = g.index(col, row);
    const placed = road ?? autoShape(g, i, 0);
    const changes = new Map([[i, placed]]);
    const re = autoReshapes(g, changes);
    for (const [j, r] of [...changes, ...re]) g.setRoad(j, re.get(j) ?? r);
    return i;
  }
  function remove(g: ReturnType<typeof gridWithPlots>, i: number) {
    const re = autoReshapes(g, new Map([[i, 0]]));
    g.setRoad(i, 0);
    for (const [j, r] of re) g.setRoad(j, r);
  }

  it("bends to meet a road laid beside it, and goes back when it's taken away", () => {
    const g = gridWithPlots(0, 0, 1, 1);
    const a = lay(g, 5, 5);
    const b = lay(g, 6, 5);
    expect(edgesOf(g.road[a])).toBe(bits(EDGE_W, EDGE_E));
    expect(edgesOf(g.road[b])).toBe(bits(EDGE_W, EDGE_E));
    const c = lay(g, 6, 4);
    expect(pieceOf(g.road[b])?.id).toBe("curve");
    expect(edgesOf(g.road[b])).toBe(bits(EDGE_W, EDGE_N));
    expect(isAutoRoad(g.road[b])).toBe(true);
    // Another beside it makes a T, then taking that away a bend again, then a straight.
    const d = lay(g, 7, 5);
    expect(edgesOf(g.road[b])).toBe(bits(EDGE_W, EDGE_N, EDGE_E));
    remove(g, d);
    expect(edgesOf(g.road[b])).toBe(bits(EDGE_W, EDGE_N));
    remove(g, c);
    expect(edgesOf(g.road[b])).toBe(bits(EDGE_W, EDGE_E));
  });

  it("joins a road's open end, never the side of a piece laid by hand", () => {
    const g = gridWithPlots(0, 0, 1, 1);
    // A hand-laid road running north–south at column 8, and a gate-like straight pointing east at (3,3).
    for (let r = 2; r < 9; r++) g.setRoad(g.index(8, r), encodeRoad("straight", 1));
    g.setRoad(g.index(3, 3), encodeRoad("straight", 0));
    const side = lay(g, 7, 5);
    // Beside it, it isn't joined (alone, it just keeps the turn it was held at).
    expect(autoEdges(g, side)).toBe(0);
    // The hand-laid road is left as it was.
    expect(isAutoRoad(g.road[g.index(8, 5)])).toBe(false);
    const end = lay(g, 4, 3);
    expect(edgesOf(g.road[end]) & bits(EDGE_W)).not.toBe(0);
    // Below the end of the hand-laid road (which is open southward): joined.
    const below = lay(g, 8, 9);
    expect(edgesOf(g.road[below])).toBe(bits(EDGE_N, EDGE_S));
  });

  it("an auto road may be kept as it is (track over it)", () => {
    const g = gridWithPlots(0, 0, 1, 1);
    const a = lay(g, 5, 5);
    const before = g.road[a];
    const i = g.index(5, 4);
    const re = autoReshapes(g, new Map([[i, autoShape(g, i, 0)]]), (j) => j === a);
    expect(re.has(a)).toBe(false);
    expect(g.road[a]).toBe(before);
  });
});

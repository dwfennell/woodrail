import { describe, expect, it } from "vitest";
import { gridWithPlots, SURF_ROAD } from "../landscape/grid";
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

  it("meets a plain road laid by hand: it bends or branches to join, and goes back", () => {
    const g = gridWithPlots(0, 0, 1, 1);
    // A hand-laid road running north–south at column 8.
    for (let r = 2; r < 9; r++) g.setRoad(g.index(8, r), encodeRoad("straight", 1));
    const side = lay(g, 7, 5);
    // Laid against its side: joined, and the straight there becomes a T (an auto road from now on).
    expect(edgesOf(g.road[side])).toBe(bits(EDGE_E, EDGE_W));
    expect(pieceOf(g.road[g.index(8, 5)])?.id).toBe("tee");
    expect(edgesOf(g.road[g.index(8, 5)])).toBe(bits(EDGE_N, EDGE_S, EDGE_W));
    expect(isAutoRoad(g.road[g.index(8, 5)])).toBe(true);
    // Its neighbours along the road are left as they were.
    expect(isAutoRoad(g.road[g.index(8, 4)])).toBe(false);
    remove(g, side);
    expect(pieceOf(g.road[g.index(8, 5)])?.id).toBe("straight");
    expect(edgesOf(g.road[g.index(8, 5)])).toBe(bits(EDGE_N, EDGE_S));

    // A straight at a road's free end bends round to a road laid beside it.
    g.setRoad(g.index(3, 3), encodeRoad("straight", 0));
    g.setRoad(g.index(4, 3), encodeRoad("straight", 0));
    lay(g, 4, 4);
    expect(pieceOf(g.road[g.index(4, 3)])?.id).toBe("curve");
    expect(edgesOf(g.road[g.index(4, 3)])).toBe(bits(EDGE_W, EDGE_S));
  });

  it("never reshapes a town street, and leaves side-by-side hand-laid roads alone", () => {
    const g = gridWithPlots(0, 0, 1, 1);
    for (let r = 2; r < 9; r++) {
      const i = g.index(12, r);
      g.surface[i] = SURF_ROAD;
      g.road[i] = encodeRoad("straight", 1);
    }
    const beside = lay(g, 11, 5);
    expect(autoEdges(g, beside)).toBe(0);
    expect(pieceOf(g.road[g.index(12, 5)])?.id).toBe("straight");
    // Two hand-laid roads side by side: laying a third elsewhere doesn't join them.
    g.setRoad(g.index(3, 10), encodeRoad("straight", 0));
    g.setRoad(g.index(3, 11), encodeRoad("straight", 0));
    lay(g, 6, 10);
    expect(isAutoRoad(g.road[g.index(3, 10)])).toBe(false);
    expect(isAutoRoad(g.road[g.index(3, 11)])).toBe(false);
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

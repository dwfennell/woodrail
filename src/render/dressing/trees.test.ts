import { describe, expect, it } from "vitest";
import { CELL, FEAT_TREE, generateLandscape } from "../../landscape";
import { MAX_LEAN, treePlacements } from "./trees";

describe("treePlacements", () => {
  const land = generateLandscape(11);
  const g = land.grid;
  const trees = treePlacements(land);

  it("puts one tree on every tree square, near its centre and on its ground", () => {
    let count = 0;
    for (let i = 0; i < g.cellCount; i++) if (g.feature[i] === FEAT_TREE) count++;
    expect(trees).toHaveLength(count);
    for (const t of trees) {
      const i = g.cellAtWorld(t.x, t.z);
      expect(g.feature[i]).toBe(FEAT_TREE);
      expect(Math.abs(t.x - g.centreX(g.colOf(i)))).toBeLessThanOrEqual(CELL / 2 - 14);
      expect(t.y).toBe(g.groundY(i));
    }
  });

  it("leans and sizes stay within toy-like bounds", () => {
    for (const t of trees) {
      expect(t.lean).toBeLessThanOrEqual(MAX_LEAN);
      expect(t.scale).toBeGreaterThanOrEqual(0.8);
      expect(t.scale).toBeLessThanOrEqual(1.2);
    }
    expect(new Set(trees.map((t) => t.kind)).size).toBe(3);
  });

  it("is deterministic per map", () => {
    expect(treePlacements(generateLandscape(11))).toEqual(trees);
  });
});

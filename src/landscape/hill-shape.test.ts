import { describe, expect, it } from "vitest";
import { generateLandscape } from "./generate";
import { hillsOf } from "./hill-shape";

describe("HillShape", () => {
  it("gives the grid's block height at every square's centre, on generated maps", () => {
    for (const seed of [1, 7, 42]) {
      const { grid } = generateLandscape(seed);
      const hills = hillsOf(grid);
      for (let i = 0; i < grid.cellCount; i++) {
        const col = grid.colOf(i);
        const row = grid.rowOf(i);
        expect(hills.groundAt(grid.centreX(col), grid.centreZ(row))).toBe(grid.groundY(i));
      }
    }
  });

  it("is the felt off the mat, and one shape per map", () => {
    const { grid } = generateLandscape(3);
    expect(hillsOf(grid).groundAt(1e6, 0)).toBe(0);
    expect(hillsOf(grid)).toBe(hillsOf(grid));
  });
});

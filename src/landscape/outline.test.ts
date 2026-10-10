import { describe, expect, it } from "vitest";
import { generateLandscape } from "./generate";
import { COLS, ROWS, SURF_RIVER, SURF_ROAD } from "./grid";
import { insideLoops, smoothLoop, traceRegions, type Loop } from "./outline";

const fromRows = (rows: string[]) => (c: number, r: number) => rows[r]?.[c] === "#";

describe("traceRegions", () => {
  const rows = [
    "##....", //
    "#.....",
    "##..#.",
    "......",
    "......",
  ];
  const mask = fromRows(rows);

  it("finds one loop per 4-connected region", () => {
    expect(traceRegions(mask, 6, 5)).toHaveLength(2);
  });

  it("classifies every cell centre correctly", () => {
    const loops = traceRegions(mask, 6, 5);
    for (let r = 0; r < 5; r++) for (let c = 0; c < 6; c++) expect(insideLoops(loops, c + 0.5, r + 0.5)).toBe(mask(c, r));
  });

  it("traces regions with holes", () => {
    const ring = fromRows(["###", "#.#", "###"]);
    const loops = traceRegions(ring, 3, 3);
    expect(loops).toHaveLength(2);
    expect(insideLoops(loops, 1.5, 1.5)).toBe(false);
    expect(insideLoops(loops, 0.5, 0.5)).toBe(true);
  });

  it("traces along the grid edge", () => {
    const loops = traceRegions(fromRows(["##", "##"]), 2, 2);
    expect(loops).toHaveLength(1);
    const xs = loops[0].map((p) => p.x);
    expect(Math.min(...xs)).toBe(0);
    expect(Math.max(...xs)).toBe(2);
  });
});

describe("smoothLoop on generated maps", () => {
  const near = (mask: (c: number, r: number) => boolean, c: number, r: number) => {
    for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) if (mask(c + dc, r + dr)) return true;
    return false;
  };

  it("smoothed river and road outlines still cover exactly their cells", () => {
    for (let seed = 1; seed <= 50; seed++) {
      const { grid } = generateLandscape(seed);
      for (const surf of [SURF_RIVER, SURF_ROAD]) {
        const mask = (c: number, r: number) => grid.inBounds(c, r) && grid.surface[grid.index(c, r)] === surf;
        const loops: Loop[] = traceRegions(mask, COLS, ROWS).map((l) => smoothLoop(l));
        for (let r = 0; r < ROWS; r++) {
          for (let c = 0; c < COLS; c++) {
            const inside = insideLoops(loops, c + 0.5, r + 0.5);
            if (mask(c, r)) expect(inside, `seed ${seed} cell ${c},${r}`).toBe(true);
            else if (!near(mask, c, r)) expect(inside, `seed ${seed} cell ${c},${r}`).toBe(false);
          }
        }
      }
    }
  });
});

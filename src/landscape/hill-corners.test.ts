import { describe, expect, it } from "vitest";
import { RISER_HEIGHT } from "../track";
import { generateLandscape } from "./generate";
import { CELL, COLS, LandscapeGrid, ROWS } from "./grid";
import { blockOutline, CORNERS, CORNER_RADIUS, hillsOf, insideBlock } from "./hill-shape";
import { hillPieces } from "./slabs";

/** Point in polygon (x/z), even-odd. */
function inPolygon(poly: { x: number; z: number }[], x: number, z: number): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.z > z !== b.z > z && x < ((b.x - a.x) * (z - a.z)) / (b.z - a.z) + a.x) inside = !inside;
  }
  return inside;
}

const NEIGHBOURS = [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]] as const;

describe("rounded hill corners", () => {
  it("rounds exactly the corners whose two side squares and diagonal square are open, for all 256 neighbourhoods", () => {
    for (let pattern = 0; pattern < 256; pattern++) {
      const g = new LandscapeGrid();
      g.height[g.index(10, 10)] = 1;
      NEIGHBOURS.forEach(([dc, dr], k) => {
        if (pattern & (1 << k)) g.height[g.index(10 + dc, 10 + dr)] = 1;
      });
      const filled = (dc: number, dr: number) => g.height[g.index(10 + dc, 10 + dr)] > 0;
      let expected = 0;
      for (const { sx, sz, bit } of CORNERS) if (!filled(sx, 0) && !filled(0, sz) && !filled(sx, sz)) expected |= bit;
      expect(hillsOf(g).blockCorners(10, 10, 0), `pattern ${pattern}`).toBe(expected);
    }
  });

  it("keeps the mat's own edge square, and rounds each level of a stepped hill on its own", () => {
    const g = new LandscapeGrid();
    g.height[g.index(0, 0)] = 1;
    // In the mat's corner square, the two corners against the mat's edge stay square; the inner ones round.
    expect(hillsOf(g).blockCorners(0, 0, 0)).toBe(1);
    const s = new LandscapeGrid();
    for (let c = 10; c <= 12; c++) for (let r = 10; r <= 12; r++) s.height[s.index(c, r)] = 1;
    s.height[s.index(11, 11)] = 2;
    expect(hillsOf(s).blockCorners(11, 11, 0)).toBe(0);
    expect(hillsOf(s).blockCorners(11, 11, 1)).toBe(15);
  });

  it("the outline used for shadows and physics agrees with the ground height", () => {
    for (const corners of [0, 1, 5, 15]) {
      const outline = blockOutline(corners, 0, 64);
      for (let x = -35.5; x <= 35.5; x += 1.5) {
        for (let z = -35.5; z <= 35.5; z += 1.5) {
          // Skip points within half a millimetre of a rounding's arc (the outline's chords cut inside it).
          const nearArc = CORNERS.some(({ sx, sz, bit }) => {
            if (!(corners & bit)) return false;
            const d = Math.hypot(x - sx * (CELL / 2 - CORNER_RADIUS), z - sz * (CELL / 2 - CORNER_RADIUS));
            return Math.abs(d - CORNER_RADIUS) < 0.5;
          });
          if (nearArc) continue;
          expect(inPolygon(outline, x, z), `${corners} @ ${x},${z}`).toBe(insideBlock(corners, x, z));
        }
      }
    }
  });

  it("ground height follows the rounding: felt at a cut-away corner, the block top just inside", () => {
    const g = new LandscapeGrid();
    for (let c = 10; c <= 12; c++) for (let r = 10; r <= 11; r++) g.height[g.index(c, r)] = 1;
    const x0 = g.centreX(10) - CELL / 2;
    const z0 = g.centreZ(10) - CELL / 2;
    const hills = hillsOf(g);
    expect(hills.groundAt(x0 + 1, z0 + 1)).toBe(0);
    expect(hills.groundAt(x0 + CORNER_RADIUS, z0 + CORNER_RADIUS)).toBe(RISER_HEIGHT);
    // A middle edge square isn't rounded.
    expect(hills.groundAt(g.centreX(11) - CELL / 2 + 1, z0 + 1)).toBe(RISER_HEIGHT);
  });

  it("shadows and physics cover every block exactly once, on generated maps", () => {
    for (const seed of [1, 7, 42]) {
      const { grid } = generateLandscape(seed);
      const { slabs, round } = hillPieces(grid);
      let blocks = 0;
      for (let i = 0; i < COLS * ROWS; i++) blocks += grid.height[i];
      const covered = slabs.reduce((n, s) => n + ((s.x1 - s.x0) / CELL) * ((s.z1 - s.z0) / CELL), 0) + round.length;
      expect(covered, `seed ${seed}`).toBe(blocks);
      expect(round.length, `seed ${seed}`).toBeGreaterThan(0);
    }
  });
});

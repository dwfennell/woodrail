import { describe, expect, it } from "vitest";
import { generateLandscape } from "../../landscape";
import { RISER_HEIGHT } from "../../track";
import { BLOCK_TONES, blockInstances } from "./blocks";

describe("blockInstances", () => {
  const land = generateLandscape(7, { starter: true });
  const { grid } = land;

  it("places one block per cell per level", () => {
    let total = 0;
    for (let i = 0; i < grid.height.length; i++) total += grid.height[i];
    expect(blockInstances(grid, 7)).toHaveLength(total);
  });

  it("stacks blocks at whole riser heights", () => {
    for (const b of blockInstances(grid, 7)) {
      expect(b.y % RISER_HEIGHT).toBe(0);
      expect(b.y).toBeLessThan(grid.height[grid.cellAtWorld(b.x, b.z)] * RISER_HEIGHT);
    }
  });

  it("varies the wood tone, deterministically", () => {
    const a = blockInstances(grid, 7);
    const b = blockInstances(grid, 7);
    expect(a.map((x) => x.tone)).toEqual(b.map((x) => x.tone));
    expect(new Set(a.map((x) => x.tone)).size).toBeGreaterThanOrEqual(3);
    for (const x of a) expect(x.tone).toBeLessThan(BLOCK_TONES.length);
  });
});

describe("buried blocks", () => {
  it("skips only blocks hidden on every side and from above", () => {
    const land = generateLandscape(7, { starter: true });
    const g = land.grid;
    const all = blockInstances(g, 7);
    const shown = all.filter((b) => b.exposed);
    expect(shown.length).toBeLessThan(all.length);
    // Every top block is exposed, and so is every block on the mat's edge.
    for (const b of all) if (b.top) expect(b.exposed).toBe(true);
    for (const b of all) {
      if (b.exposed) continue;
      const i = g.cellAtWorld(b.x, b.z);
      const col = i % 50;
      const row = (i - col) / 50;
      const level = b.y / RISER_HEIGHT;
      for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        expect(g.inBounds(col + dc, row + dr)).toBe(true);
        expect(g.height[g.index(col + dc, row + dr)]).toBeGreaterThan(level);
      }
    }
  });
});

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

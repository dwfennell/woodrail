import { describe, expect, it } from "vitest";
import { loadBugMap } from "../play/bugmap";
import { passingOf } from "./blocks";
import own01 from "../play/bugmaps/reference/own-01-single-loops.txt?raw";
import own10 from "../play/bugmaps/reference/own-10-depots.txt?raw";
import own08 from "../play/bugmaps/reference/own-08-branch.txt?raw";

const roadsOf = async (m: string) => {
  const { world } = await loadBugMap(m);
  const p = passingOf((world as any).sim.layout ?? (world as any).economy.layout);
  return p.roads.map((g) => g.map((r) => [...r].sort((a, b) => a - b)));
};

describe("passing places (§13.6.2)", () => {
  it("own-01: three passing loops, two roads each", async () => {
    const roads = await roadsOf(own01);
    expect(roads.length).toBe(3);
    for (const g of roads) expect(g.length).toBe(2);
  });
  it("own-08: two loops; the branch and the dead ends aren't roads", async () => {
    const roads = await roadsOf(own08);
    expect(roads.length).toBe(2);
    expect(roads.flat(2)).not.toContain(85);
  });
  it("own-10: two loops and the two yards' second tracks", async () => {
    const roads = await roadsOf(own10);
    expect(roads.length).toBe(4);
  });
});

import { describe, expect, it } from "vitest";
import { SIM_HZ } from "../../sim";
import { engineStatus } from "../../game/engine-status";
import { loadBugMap } from "../bugmap";
import MAP from "./reports/2026-11-23-teal-line-planks-hint.txt?raw";

/**
 * A user's map (2026-11-23): Dandelion on Teal line 2 (seven stops, three vans, "Going to Teasel End · ↓ furniture,
 * tools") was told "Not loading planks at the warehouse 1: they go on a flatbed. Add one to this train": "I'm not trying
 * to run planks on this route, this warning is bad in this case." The warehouse held planks and the workshop further
 * on takes them, but the line's vans move other goods: a good it has no wagon for isn't this line's
 * (`Economy.movesGoods`).
 */
describe("the user's Teal line 2: no flatbed advice for planks on a line of vans", () => {
  const DANDELION = 56;

  it("Dandelion's card never says to add a wagon for planks, from the map as saved and on round its line", async () => {
    const { world } = await loadBugMap(MAP);
    const { sim, economy } = world;
    expect(economy.lines.get(economy.lineIdOf.get(DANDELION)!)!.name).toBe("Teal line 2");
    const train = () => sim.findCar(DANDELION)!.train;
    expect(train().cars.some((c) => c.kind === "van")).toBe(true);
    const said = new Set<string>();
    const wagon = new Set<string>();
    for (let i = 0; i < 300 * SIM_HZ; i++) {
      if (i % SIM_HZ === 0) {
        said.add(engineStatus(sim, economy, DANDELION, (id) => `place ${id}`));
        const not = economy.notLoadingAt(train().id);
        if (not?.why === "no-wagon") wagon.add(not.kind);
      }
      sim.tick();
      economy.tick();
    }
    expect([...said].filter((s) => /flatbed|Add one/.test(s))).toEqual([]);
    expect([...wagon]).toEqual([]);
  }, 120_000);
});

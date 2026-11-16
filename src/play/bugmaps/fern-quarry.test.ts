import { describe, expect, it } from "vitest";
import { SIM_HZ } from "../../sim";
import { engineStatus } from "../../game/engine-status";
import { loadBugMap } from "../bugmap";
import MAP from "./reports/2026-11-16-fern-quarry.txt?raw";

/**
 * A user's map (2026-11-16): Fern (engine 112, Orange line 2, Forest yard 2 to Sawmill 1) said "Stuck: the train parked
 * by the quarry is in the way. Move it", and "the train parked by the quarry should have no effect at all on this
 * route". It hadn't, by where it stood: Marigold (engine 105, a hopper train) stood in a balloon loop off the forest
 * yard's points, off Fern's way. But it had been granted its move to the forest yard, through the stretch Fern needed,
 * just before the player stopped it there, and sections kept that move while it stood with its levers off. Fern waited
 * for it ever after. (A save keeps no moves: the map loaded as saved, Fern goes at once; here the player's steps that
 * led to it are taken again: Marigold sent on, and stopped as its move is granted.)
 */
describe("the user's Fern map: a train stopped by the player holds no move", () => {
  it("Marigold, stopped just after its move was granted, doesn't keep Fern waiting", async () => {
    const { world } = await loadBugMap(MAP);
    const { sim, economy } = world;
    const FERN = 112;
    const MARIGOLD = 105;
    const levers = (engine: number, v: -1 | 0 | 1) => {
      for (const c of sim.findCar(engine)!.train.cars) if (c.kind === "engine") sim.setLever(c.id, v);
    };
    const step = () => {
      sim.tick();
      economy.tick();
    };
    // (Fern running as saved, Marigold sent on: Marigold is granted its move to the forest yard.)
    levers(MARIGOLD, 1);
    for (let i = 0; i < 30 * SIM_HZ && !economy.sections.stateOf(MARIGOLD)?.move; i++) step();
    expect(economy.sections.stateOf(MARIGOLD)?.move).not.toBeNull();
    for (let i = 0; i < 0.3 * SIM_HZ; i++) step();
    // (The player stops Marigold where it is.)
    levers(MARIGOLD, 0);
    const at = [...new Set(sim.findCar(FERN)!.train.bogies.map((b) => b.pieceId))].join(",");
    const said = new Set<string>();
    let moved = false;
    for (let i = 0; i < 60 * SIM_HZ; i++) {
      step();
      if (i % SIM_HZ) continue;
      const t = sim.findCar(FERN)!.train;
      if ([...new Set(t.bogies.map((b) => b.pieceId))].join(",") !== at) moved = true;
      said.add(engineStatus(sim, economy, FERN, () => "?"));
    }
    expect(sim.findCar(MARIGOLD)!.train.speed).toBeLessThan(1);
    expect(economy.sections.stateOf(MARIGOLD)?.move ?? null).toBeNull();
    expect(moved).toBe(true);
    expect([...said].filter((s) => s.startsWith("Stuck"))).toEqual([]);
  }, 60_000);
});

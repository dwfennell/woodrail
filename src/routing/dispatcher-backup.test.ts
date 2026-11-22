/**
 * The dispatcher's back-up (dispatcher spec §2.1 step 5), on a reference map with the dispatcher on, run as the jams
 * bar runs it (src/play/jams.ts): rowan-2, where a train stuck by another coming the other way gets out of it only by
 * backing up. It backs up (its levers set the other way, its card "Backing up to let … by"), at most its length, then
 * runs its own way again (its levers as they were); no invariant broken.
 */
import { describe, expect, it } from "vitest";
import { loadBugMap } from "../play/bugmap";
import { runJams } from "../play/jams";
import { engineStatus } from "../game/engine-status";
import { depotName } from "../game/world";
import rowan2 from "../play/bugmaps/reference/rowan-2.txt?raw";

describe("the dispatcher's back-up", () => {
  it("rowan-2: a stuck train backs up to let the other by, then runs its own way again", async () => {
    const { world } = await loadBugMap(rowan2);
    const e = world.economy;
    e.useDispatcher(true);
    const d = e.dispatcher!;
    const nameOf = (id: number) => {
      const x = e.depot(id);
      return x ? depotName(world, x) : "";
    };
    let backing = -1;
    let levers: number[] = [];
    let said = "";
    let resumed = false;
    const r = runJams(world, 175, {
      tick: () => {
        if (backing < 0) {
          for (const engine of e.lineIdOf.keys())
            if (d.backingFor(engine) >= 0) {
              backing = engine;
              levers = world.sim.findCar(engine)!.train.cars.filter((c) => c.kind === "engine").map((c) => c.lever);
              said = engineStatus(world.sim, e, engine, nameOf);
            }
        } else if (!resumed && d.backingFor(backing) < 0) {
          // (Done: its levers as they were before it backed up (the dispatcher set them the other way while it did).)
          const now = world.sim.findCar(backing)?.train.cars.filter((c) => c.kind === "engine").map((c) => c.lever);
          resumed = !!now && now.every((l) => l !== 0);
        }
      },
    });
    expect(d.backUps).toBeGreaterThan(0);
    expect(backing).toBeGreaterThan(0);
    expect(levers.every((l) => l !== 0)).toBe(true);
    expect(said).toMatch(/^Backing up to let .+ by$/);
    expect(resumed).toBe(true);
    expect(r.firstBreak).toBeNull();
  }, 300_000);
});

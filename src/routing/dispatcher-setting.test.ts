/**
 * The ☰ Train dispatcher (beta) switch (economy `useDispatcher`, saved with the game): flipped mid-game on a reference
 * map with trains running, each way, it breaks no train invariant and the trains go on delivering; a save keeps it.
 */
import { describe, expect, it } from "vitest";
import { loadBugMap } from "../play/bugmap";
import { economyChecks } from "../game/dev-checks";
import { deserializeWorld, serializeWorld } from "../persist/save";
import type { World } from "../game/world";
import { SIM_HZ } from "../sim";
import rowan3 from "../play/bugmaps/reference/rowan-3.txt?raw";

/** Stops come to by routed trains over `seconds`. */
function run(world: World, seconds: number): number {
  const at = new Map<number, boolean>();
  let arrivals = 0;
  for (let i = 0; i < seconds * SIM_HZ; i++) {
    world.sim.tick();
    world.economy.tick();
    for (const e of world.economy.lineIdOf.keys()) {
      const now = !!world.economy.routeOf(e)?.at;
      if (now && !at.get(e)) arrivals++;
      at.set(e, now);
    }
  }
  return arrivals;
}

describe("☰ Train dispatcher (beta)", () => {
  it("on and off mid-game with trains running: no invariant broken, trains deliver each way", async () => {
    const { world } = await loadBugMap(rowan3);
    const checks = economyChecks(world.economy, { every: 1 });
    expect(run(world, 60)).toBeGreaterThan(0);
    world.economy.useDispatcher(true);
    const on = run(world, 180);
    world.economy.useDispatcher(false);
    const off = run(world, 180);
    checks.off();
    const broke = Object.entries(checks.broke).filter(([, b]) => b.count > 0).map(([k, b]) => `${k}: ${b.first[0]}`);
    expect(broke).toEqual([]);
    expect(on).toBeGreaterThan(10);
    expect(off).toBeGreaterThan(10);
  }, 120_000);

  it("is saved with the game: on after a load, off when it was off", async () => {
    const { world } = await loadBugMap(rowan3);
    expect(serializeWorld(world).dispatcher).toBeUndefined();
    world.economy.useDispatcher(true);
    run(world, 5);
    const back = deserializeWorld(serializeWorld(world));
    expect(back.ok && !!back.value.economy.dispatcher).toBe(true);
    world.economy.useDispatcher(false);
    const off = deserializeWorld(serializeWorld(world));
    expect(off.ok && off.value.economy.dispatcher).toBe(null);
  }, 60_000);
});

import { describe, expect, it } from "vitest";
import { engineStatus } from "../../game/engine-status";
import { ADV_OK, advanceCursor, createAdvance, markKey, SIM_HZ } from "../../sim";
import { connectorRef } from "../../track";
import { describeBreak, loadBugMap, replayBugMap } from "../bugmap";
import MAP from "./signal-green-held.txt?raw";
import MAP_32 from "./signal-added-still-stuck.txt?raw";
import type { World } from "../../game/world";

/**
 * Test-only: no train in the ring gives way (none turns round, nor takes another road at points), as where there's no
 * room to: the ring stands, as it did for the user.
 */
function noGivingWay(world: World): void {
  world.sim.turnNow = () => null;
  world.economy.router.giveWayRoad = () => false;
}

/**
 * Issue #31 (2026-11-07, build mw5rjr7b): "I don't understand why this train is stuck... the signal ahead of it is
 * green". The user's map: four trains in a ring of signal blocks, each held by sections at a signal's waiting point for
 * the next (a hand-run one among them: issue #32). Sections stand a held train with its nose exactly
 * at the signal's stop point; its last braking step, or the first tick after a load, can leave it a hair past. The sim
 * read that as passing the signal: it showed the path signal clear for it, while sections held it. Now a standing train
 * that little past a stop point is at it (`STAND_SLOP`), and the signal shows red.
 */
describe("issue #31: a train held at a signal's waiting point, a hair past its stop point", () => {
  it("the signal it stands at shows red, and its card says why it waits", async () => {
    const { world } = await loadBugMap(MAP);
    const { sim, economy, layout } = world;
    // (The ring stood for the user: here too, so the signal it stands at is the thing looked at.)
    noGivingWay(world);
    const run = (s: number) => {
      for (let i = 0; i < s * SIM_HZ; i++) {
        sim.tick();
        economy.tick();
      }
    };
    run(30);
    // (Rowan, engine 30, the timber train: held at the pair on piece 80's end 1 for engine 44's train.)
    const rowan = sim.findCar(30)!.train;
    const mark = layout.signalAt(connectorRef(80, 1))!;
    expect(rowan.speed).toBe(0);
    expect(rowan.bogies[0].pieceId).toBe(80);
    expect(economy.sections.waitOf(30)).not.toBeNull();
    expect(sim.markClear(mark.id)).toBe(false);
    // Test-only: its nose put 1 mm on, past the stop point, as its last braking step or a load can leave it (every
    // bogie the same way, so the train is whole).
    const adv = createAdvance();
    for (const b of rowan.bogies) expect(advanceCursor(layout, b, 1, null, adv).status).toBe(ADV_OK);
    run(2);
    // Still held where it stands, and the signal says so.
    expect(rowan.bogies[0].pieceId).toBe(80);
    expect(rowan.speed).toBe(0);
    expect(sim.markClear(mark.id)).toBe(false);
    expect(sim.redSignalKeyAhead(rowan.id)).toBe(markKey(mark.id));
    // (Its card: the hand-run train in the ring is in the way (issue #32), not "Add a signal".)
    expect(engineStatus(sim, economy, 30, () => "")).toBe("Stuck: a train with no route is in the way. Move it or give it a route");
  }, 60_000);
});

/**
 * Issue #32 (filed three minutes after #31: the same map with a signal pair added at the sawmill, as the card said): all
 * the trains still stood. The signal did its part: the timber train on the passing loop pulled right in, clear of the
 * loop's points. But sections then sent the goods train (Yellow, engine 44) in behind it, onto the road it stood on
 * (one it may follow out), with the loop's other road empty: its path signal stayed red for the timber train, which
 * waited on the hand-run train, which waited on the next, round to Yellow. Now an empty road comes before one with a
 * train to follow: the trains run, and none has to turn round.
 */
describe("issue #32: the map with the signal added, nobody giving way", () => {
  it("the goods train takes the loop's empty road, and every routed train comes to its stops, none turning round", async () => {
    const { world } = await loadBugMap(MAP_32);
    noGivingWay(world);
    const r = replayBugMap(world, { seconds: 300 });
    expect(r.first && describeBreak(r.first)).toBeNull();
    for (const engine of world.economy.lineIdOf.keys()) expect(r.arrivals.get(engine) ?? 0, `engine ${engine}`).toBeGreaterThanOrEqual(4);
    expect(world.economy.stalls.gaveWay).toBe(0);
  }, 60_000);
});

import { describe, expect, it } from "vitest";
import type { World } from "../../game/world";
import { loopSignalHold } from "../../economy/loop-signal";
import { ADV_OK, advanceCursor, createAdvance, SIM_HZ } from "../../sim";
import { connectorRef } from "../../track";
import { describeBreak, loadBugMap, replayBugMap } from "../bugmap";
import MAP from "./signal-green-held.txt?raw";
import MAP_32 from "./signal-added-still-stuck.txt?raw";

/** Counts the trains turned round short of the end of the line (`Sim.turnNow`), watching only: none should be. */
function countTurns(world: World): () => number {
  let turned = 0;
  const turnNow = world.sim.turnNow.bind(world.sim);
  world.sim.turnNow = (id) => {
    const t = turnNow(id);
    if (t) turned++;
    return t;
  };
  return () => turned;
}

/**
 * Issue #31 (2026-11-07, build mw5rjr7b): "I don't understand why this train is stuck... the signal ahead of it is
 * green". The user's map: four trains in a ring of waits. The timber train (Teasel, Blue line) stood at a signal the
 * player put inside the passing loop's road, its tail over the loop's points, and the others waited on it in a ring.
 *
 * Since trains book only to the next signal they can stand at (2026-11-09: every signal of a pair is a waiting point,
 * sized for the train), the ring doesn't form: the trains run, and none turns round. (The ring's cards, "stands at a
 * signal inside the passing loop", are no longer reached on this map.) And since a train held short of its loop road's
 * end, its tail still on the points behind, has a path signal on the way there clear with only that stretch free
 * (2026-11-13, `Sim.standsWithin`), the saved position's hold is gone a tick in: Teasel pulls up off the points.
 *
 * Sections stand a held train with its nose exactly at the signal's stop point; its last braking step, or the first tick
 * after a load, can leave it a hair past. The sim read that as passing the signal: it showed the path signal clear for
 * it, while sections held it. Now a standing train that little past a stop point is at it (`STAND_SLOP`): red.
 */
describe("issue #31: the user's map, a signal inside the passing loop", () => {
  it("the ring doesn't form: every routed train comes to its stops, none turning round", async () => {
    const { world } = await loadBugMap(MAP);
    const turns = countTurns(world);
    // (The saved position: Teasel at the signal inside the loop road, its tail on the loop's points. A tick in, the
    // signal no longer holds it there: it pulls up to the road's end, off the points.)
    world.sim.tick();
    world.economy.tick();
    const inLoop = world.layout.signalAt(connectorRef(19, 0))!;
    expect(loopSignalHold(world.layout, world.sim, inLoop.id)).toBeNull();
    const r = replayBugMap(world, { seconds: 300, stopAtFirst: false });
    for (const engine of world.economy.lineIdOf.keys()) expect(r.arrivals.get(engine) ?? 0, `engine ${engine}`).toBeGreaterThanOrEqual(4);
    for (const [engine, s] of r.longestStand) expect(s, `engine ${engine}`).toBeLessThan(120);
    expect(turns()).toBe(0);
    expect(world.economy.stalls.gaveWay).toBe(0);
  }, 60_000);

  it("a train held at a signal shows red though it stands a hair past its stop point", async () => {
    const { world } = await loadBugMap(MAP);
    const { sim, economy, layout } = world;
    // (Run till a train stands at a red signal, held by sections: Rowan, engine 30, at about 20 s.)
    let held: { train: ReturnType<typeof sim.getTrain>; key: number } | null = null;
    for (let i = 0; i < 120 * SIM_HZ && !held; i++) {
      sim.tick();
      economy.tick();
      if (i < 5 * SIM_HZ || i % 12 !== 0) continue;
      for (const t of sim.trains()) {
        const e = t.cars.find((c) => c.kind === "engine")!.id;
        if (t.speed === 0 && sim.atRedSignal(t.id) && economy.sections.waitOf(e) && sim.redSignalKeyAhead(t.id) < 0) {
          held = { train: t, key: sim.redSignalKeyAhead(t.id) };
          break;
        }
      }
    }
    expect(held).not.toBeNull();
    const t = held!.train!;
    const piece = t.bogies[0].pieceId;
    // Test-only: its nose put 1 mm on, past the stop point, as its last braking step or a load can leave it (every
    // bogie the same way, so the train is whole).
    const adv = createAdvance();
    for (const b of t.bogies) expect(advanceCursor(layout, b, 1, null, adv).status).toBe(ADV_OK);
    sim.tick();
    economy.tick();
    // Still held where it stands, and the signal says so. (Its wait may end a moment later: the trains run now.)
    expect(t.bogies[0].pieceId).toBe(piece);
    expect(t.speed).toBe(0);
    expect(sim.redSignalKeyAhead(t.id)).toBe(held!.key);
    expect(sim.markClear(-1 - held!.key)).toBe(false);
  }, 60_000);
});

/**
 * Issue #32 (filed three minutes after #31: the same map with a signal pair added at the sawmill, as the card said): all
 * the trains still stood. The signal did its part: Teasel pulled right into the passing loop, clear of the loop's points.
 * But sections then sent the goods train (Muffin, engine 44) in behind it, onto the road it stood on (one it may follow
 * out), with the loop's other road empty: its path signal stayed red for Teasel, which waited on the hand-run train,
 * which waited on Rowan, which waited on Muffin. Now an empty road comes before one with a train to follow
 * (`Sections.wayOn`): the trains run as laid, and none turns round.
 */
describe("issue #32: the map with the signal added", () => {
  it("the goods train takes the loop's empty road, and every routed train comes to its stops, none turning round", async () => {
    const { world } = await loadBugMap(MAP_32);
    const turns = countTurns(world);
    const r = replayBugMap(world, { seconds: 300, stopAtFirst: false });
    // (netActed, the redesign's step 0 check, is known here: see bugmaps.test.ts.)
    const broke = Object.entries(r.checks.broke).filter(([k, b]) => k !== "netActed" && b.count > 0);
    expect(broke.map(([k, b]) => `${k}: ${b.first.join(" | ")}`), r.first ? describeBreak(r.first) : "").toEqual([]);
    for (const engine of world.economy.lineIdOf.keys()) expect(r.arrivals.get(engine) ?? 0, `engine ${engine}`).toBeGreaterThanOrEqual(4);
    expect(turns()).toBe(0);
    expect(world.economy.stalls.gaveWay).toBe(0);
  }, 60_000);
});

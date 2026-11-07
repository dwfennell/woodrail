import { describe, expect, it } from "vitest";
import { engineStatus } from "../../game/engine-status";
import { ADV_OK, advanceCursor, createAdvance, markKey, SIM_HZ } from "../../sim";
import { connectorRef } from "../../track";
import { loadBugMap } from "../bugmap";
import MAP from "./signal-green-held.txt?raw";

/**
 * Issue #31 (2026-11-07, build mw5rjr7b): "I don't understand why this train is stuck... the signal ahead of it is
 * green". The user's map: four trains in a ring of signal blocks, each held by sections at a signal's waiting point for
 * the next (their cards: "Stuck: too many trains for these signals"). Sections stand a held train with its nose exactly
 * at the signal's stop point; its last braking step, or the first tick after a load, can leave it a hair past. The sim
 * read that as passing the signal: it showed the path signal clear for it, while sections held it. Now a standing train
 * that little past a stop point is at it (`STAND_SLOP`), and the signal shows red.
 */
describe("issue #31: a train held at a signal's waiting point, a hair past its stop point", () => {
  it("the signal it stands at shows red, and its card says why it waits", async () => {
    const { world } = await loadBugMap(MAP);
    const { sim, economy, layout } = world;
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
    expect(engineStatus(sim, economy, 30, () => "")).toMatch(/^Stuck: too many trains for these signals|^Waiting for/);
  }, 60_000);
});

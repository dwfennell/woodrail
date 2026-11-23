import { describe, expect, it } from "vitest";
import { CARGO } from "../../economy";
import { legStop } from "../../game/lines";
import { viaLegs } from "../../game/route-path";
import { INVARIANTS } from "../../sim/invariants";
import { describeBreak, loadBugMap, replayBugMap } from "../bugmap";
import MAP from "./reports/2026-11-23-teal-line-double-track.txt?raw";

/**
 * A user's map (2026-11-23, desktop, main): "double track appears to be malfunctioning here", Teal line 2's sheet open
 * (Smithy, Warehouse 1, Rookhurst, the workshop, Dimbleby, its school, Teasel End, passing by piece 824 on the way back
 * to the smithy). Dandelion (engine 56, three vans) is its one train.
 *
 * The map didn't load: Warehouse 1 (depot 13) held 70 logs and 72 planks, stacked three high with Lift and load, and the
 * save's schema let no pile over a plain warehouse's 40, so the game turned the save away and put the starter map in
 * its place (`MAX_PILE`, src/persist/save-limits.ts). Loaded, its railway runs: every line keeps to its way, all the
 * traffic on the double track runs the one way round (none meets another head-on, none takes the other road), and the
 * second road beside the smithy (588–595, 621–628) stands empty because every line on it calls at the smithy.
 */
describe("the user's Teal line 2 double-track map", () => {
  const DANDELION = 56;
  const WAREHOUSE = 13;

  it("loads, with the warehouse's piles stacked over the plain cap kept", async () => {
    const { world } = await loadBugMap(MAP);
    const d = world.economy.depot(WAREHOUSE)!;
    expect(d.role).toBe("warehouse");
    expect([d.piles[CARGO.log.index], d.piles[CARGO.planks.index]]).toEqual([70, 72]);
  });

  it("runs: no invariant breaks but the shadow core's, Dandelion on its line's way every lap, every routed train calling", async () => {
    const { world } = await loadBugMap(MAP);
    const { sim, economy, layout } = world;
    const line = economy.lines.get(economy.lineIdOf.get(DANDELION)!)!;
    expect(line.name).toBe("Teal line 2");
    const legs = viaLegs(layout, line.stops.map((st) => legStop(economy, economy.depot(st.depotId)!, st.via)));
    expect(legs.every((l) => !!l)).toBe(true);
    const way = new Set(legs.flatMap((l) => l!.map((r) => r.pieceId)));
    const off = new Set<number>();
    const r = replayBugMap(world, {
      seconds: 300,
      stopAtFirst: false,
      onTick: () => {
        for (const p of sim.piecesUnder(sim.findCar(DANDELION)!.train.id)) if (!way.has(p)) off.add(p);
      },
    });
    // (heldFree is the booking core in shadow, opt-in: its holds are smaller than today's sections', as on main's maps.)
    const broke = INVARIANTS.filter((k) => k !== "heldFree" && r.checks.broke[k].count > 0);
    expect(broke.map((k) => `${k}: ${r.checks.broke[k].first.join(" | ")}`), r.first ? describeBreak(r.first) : "").toEqual([]);
    expect([...off]).toEqual([]);
    // (A lap is about 140 s: two laps' stops, seven a lap.)
    expect(r.arrivals.get(DANDELION) ?? 0).toBeGreaterThanOrEqual(12);
    for (const engine of economy.lineIdOf.keys()) expect(r.arrivals.get(engine) ?? 0, `engine ${engine}`).toBeGreaterThan(0);
    for (const [engine, s] of r.longestStand) expect(s, `engine ${engine} stood ${s} s`).toBeLessThan(120);
  }, 120_000);
});

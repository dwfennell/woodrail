import { describe, expect, it } from "vitest";
import { SIM_HZ } from "../../sim";
import { engineStatus } from "../../game/engine-status";
import { legStop } from "../../game/lines";
import { legFromCursor, viaLegs } from "../../game/route-path";
import { loadBugMap } from "../bugmap";
import MAP from "./reports/2026-11-22-teal-line-warehouse.txt?raw";
import ACORN_MAP from "./reports/2026-11-22-acorn-line-depot.txt?raw";

/**
 * A user's map (2026-11-22): "Seems to be some issue with the multi-track and routes... I should be able to 'stop' at
 * the warehouse on the second track here right?" Warehouse 2's second track (piece 607) isn't joined to its first (605):
 * it lies on another railway, Teal line 2's (Rookhurst, the workshop, Dimbleby, Teasel End), the first on Orange line
 * 2's. Dandelion (engine 56, three vans) loaded the warehouse's flour there each lap, served as on any track of it, but
 * to routes the track was no track of the warehouse till joined to the first: Dandelion was aimed at the first track,
 * which no track from its line reaches (it came to the second only by running over it), the map drew the stop out of
 * reach (a red "!", no way in or out of it) and the card said "Join the second track". And its card said "Not loading
 * planks at Warehouse 2: they go on a flatbed wagon" all along, for the workshop further on, though the warehouse held
 * no planks.
 */
describe("the user's Teal line 2 and Acorn maps: a warehouse's second track on another line", () => {
  const WAREHOUSE = 15;
  const DANDELION = 56;
  const ORANGE = 51;

  it("the second track is the warehouse's to routes: each train aimed at the track on its own line, the way drawn whole", async () => {
    const { world } = await loadBugMap(MAP);
    const { sim, economy, layout } = world;
    const d = economy.depot(WAREHOUSE)!;
    expect(d.role).toBe("warehouse");
    expect(economy.reachableTracks(d)).toEqual([605, 607]);
    expect(economy.unjoinedTracks(d)).toEqual([]);
    const line = economy.lines.get(economy.lineIdOf.get(DANDELION)!)!;
    expect(line.name).toBe("Teal line 2");
    // (The line's lap as the map draws it, with no train: every leg has a way, into the warehouse's second track and
    // on out of it.)
    const legs = viaLegs(layout, line.stops.map((st) => legStop(economy, economy.depot(st.depotId)!, st.via)));
    expect(legs.map((l) => !!l)).toEqual(line.stops.map(() => true));
    expect(legs[legs.length - 1]!.at(-1)!.pieceId).toBe(607);
    const step = () => {
      sim.tick();
      economy.tick();
    };
    const said = new Set<string>();
    const aims: Record<number, Set<number>> = { [DANDELION]: new Set(), [ORANGE]: new Set() };
    let arrivals = 0;
    let wasAt = false;
    let flour = 0;
    for (let i = 0; i < 300 * SIM_HZ; i++) {
      step();
      for (const engine of [DANDELION, ORANGE]) {
        const r = economy.routeOf(engine)!;
        const heading = r.stops[r.next % r.stops.length].depotId === WAREHOUSE;
        if (heading) aims[engine].add(economy.aimOf(engine));
      }
      const r = economy.routeOf(DANDELION)!;
      const at = !!r.at && r.stops[r.next % r.stops.length].depotId === WAREHOUSE;
      if (at && !wasAt) {
        arrivals++;
        expect(sim.piecesUnder(sim.findCar(DANDELION)!.train.id).has(607)).toBe(true);
      }
      wasAt = at;
      if (i % SIM_HZ) continue;
      const t = sim.findCar(DANDELION)!.train;
      flour = Math.max(flour, t.cars.reduce((n, c) => n + (economy.cargoOf(c.id)?.kind === "flour" ? economy.cargoOf(c.id)!.count : 0), 0));
      said.add(engineStatus(sim, economy, DANDELION, () => "Warehouse 2"));
      // (The map's way from the train on round its line, as the ribbon draws it: no stop out of reach.)
      const engine = t.cars.find((c) => c.id === DANDELION)!;
      const way = (engine.lever || 1) * engine.facing;
      const front = { ...(way > 0 ? t.bogies[0] : t.bogies[t.bogies.length - 1]) };
      if (way < 0) front.reversed = !front.reversed;
      const aim = economy.aimOf(DANDELION);
      const toNext = legFromCursor(layout, front, aim);
      const lap = viaLegs(layout, line.stops.map((st) => legStop(economy, economy.depot(st.depotId)!, st.via)), { k: r.next % line.stops.length, done: r.at ? Infinity : 0, leg: toNext });
      expect(toNext, `the way to its aim, ${aim}`).not.toBeNull();
      expect(lap.map((l) => !!l)).toEqual(line.stops.map(() => true));
    }
    // Dandelion aimed only at the second track, the one on its line; the Orange line's train only at the first.
    expect([...aims[DANDELION]]).toEqual([607]);
    expect([...aims[ORANGE]]).toEqual([605]);
    expect(arrivals).toBeGreaterThanOrEqual(1);
    expect(flour).toBeGreaterThan(0);
    expect([...said].filter((s) => /planks/.test(s))).toEqual([]);
  }, 120_000);

  it("the user's later map: Acorn (Red line 3) laps a ring through Warehouse 17's second track, not held at a red by its own tail", async () => {
    // "same with the acorn line": Warehouse 17's second track (652) on another line than its first (650), Acorn's line
    // (Warehouse 17, the yard at 654, the yard at 293) a ring through it with one signal (piece 413): all one block,
    // Acorn's own tail in it, so it stood at that red for good, "the train on the Red line 3 is in the block ahead".
    const { world } = await loadBugMap(ACORN_MAP);
    const { sim, economy, layout } = world;
    const ACORN = 60;
    const line = economy.lines.get(economy.lineIdOf.get(ACORN)!)!;
    expect(line.stops.map((st) => st.depotId)).toEqual([17, 18, 7]);
    expect(economy.reachableTracks(economy.depot(17)!)).toEqual([650, 652]);
    const legs = viaLegs(layout, line.stops.map((st) => legStop(economy, economy.depot(st.depotId)!, st.via)));
    expect(legs.map((l) => !!l)).toEqual([true, true, true]);
    let arrivals = 0;
    let wasAt = false;
    let longest = 0;
    let still = 0;
    for (let i = 0; i < 240 * SIM_HZ; i++) {
      sim.tick();
      economy.tick();
      const r = economy.routeOf(ACORN)!;
      const at = !!r.at && r.stops[r.next % r.stops.length].depotId === 17;
      if (at && !wasAt) {
        arrivals++;
        expect(sim.piecesUnder(sim.findCar(ACORN)!.train.id).has(652)).toBe(true);
      }
      wasAt = at;
      const t = sim.findCar(ACORN)!.train;
      still = t.speed < 1 && !r.at ? still + 1 : 0;
      longest = Math.max(longest, still);
      if (i % SIM_HZ === 0) expect(engineStatus(sim, economy, ACORN, () => "?")).not.toMatch(/red signal/);
    }
    expect(arrivals).toBeGreaterThanOrEqual(2);
    expect(longest / SIM_HZ).toBeLessThan(20);
  }, 120_000);
});


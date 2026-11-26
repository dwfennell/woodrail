import { describe, expect, it } from "vitest";
import { SIM_HZ } from "../../sim";
import { engineStatus } from "../../game/engine-status";
import { railwaysOf, stopApart } from "../../game/lines";
import { planTracks } from "../../game/depot-tracks";
import { findOverlap } from "../../track";
import { loadBugMap } from "../bugmap";
import MAP from "./reports/2026-11-26-sprocket-farm-unreachable.txt?raw";

/**
 * A user's map (2026-11-26): Sprocket (engine 51, Orange line 2: Farm yard, the dairy, the bakery, the mill, Warehouse
 * 2) heading for Warehouse 2, its card saying "Can't reach Farm yard: no track leads there", the farm beside it. "This
 * is still a problem with multiple tracks... routes do not work as expected a lot of the time."
 *
 * The cause: Warehouse 2 (depot 15, piece 605) was moved since the 2026-11-22 map onto the main line, by the smithy;
 * the farm, dairy, bakery and mill are a closed loop of their own beside it that no track joins to the main line (no
 * open end on it), and the warehouse's second and third tracks (607, 729) lie loose, joined to nothing. No way leads to
 * the warehouse whatever the switches, so Sprocket ran round its loop for good aimed at it, stopping at none of its
 * stops, and the card named the first stop out of reach in the list (the farm, as the way on from a stop out of reach
 * is out of reach too), not the one it couldn't get to.
 *
 * Now the train passes over a stop on another railway and serves the rest (`Economy.apartSkipOf`); its card and the
 * situation tip name the warehouse and say what to do. Teal line 2, whose train runs on the main line, still calls at
 * Warehouse 2.
 */
describe("the user's Sprocket map: a line's stop moved onto another railway", () => {
  const SPROCKET = 51;
  const TEAL = 56;
  const FARM = 14;
  const WAREHOUSE = 15;

  it("the warehouse is on another railway than the rest of Orange line 2, and the line goes on without it", async () => {
    const { world } = await loadBugMap(MAP);
    const { sim, economy } = world;
    const line = economy.lines.get(economy.lineIdOf.get(SPROCKET)!)!;
    expect(line.name).toBe("Orange line 2");
    expect(line.stops.map((st) => st.depotId)).toEqual([FARM, 35, 34, 16, WAREHOUSE]);
    const own = economy.railwayOf(sim.findCar(SPROCKET)!.train.bogies[0].pieceId);
    expect(railwaysOf(economy, FARM).has(own)).toBe(true);
    expect(railwaysOf(economy, WAREHOUSE).has(own)).toBe(false);
    expect(line.stops.map((_, k) => stopApart(economy, line.stops, k))).toEqual([false, false, false, false, true]);
    // (Teal line 2's train runs on the warehouse's railway.)
    expect(railwaysOf(economy, WAREHOUSE).has(economy.railwayOf(sim.findCar(TEAL)!.train.bogies[0].pieceId))).toBe(true);

    const names = (id: number) => economy.depot(id)?.role ?? "?";
    const calls = new Map<number, Map<number, number>>([[SPROCKET, new Map()], [TEAL, new Map()]]);
    const was = new Map<number, number>();
    const said = new Set<string>();
    for (let i = 0; i < 600 * SIM_HZ; i++) {
      sim.tick();
      economy.tick();
      for (const e of [SPROCKET, TEAL]) {
        const r = economy.routeOf(e)!;
        const at = r.at ? r.stops[r.next % r.stops.length].depotId : -1;
        if (at !== -1 && at !== was.get(e)) calls.get(e)!.set(at, (calls.get(e)!.get(at) ?? 0) + 1);
        was.set(e, at);
      }
      if (i % SIM_HZ === 0) said.add(engineStatus(sim, economy, SPROCKET, names));
    }
    // Sprocket calls at the farm, dairy, bakery and mill, lap after lap; never at the warehouse it can't get to.
    for (const id of [FARM, 35, 34, 16]) expect(calls.get(SPROCKET)!.get(id) ?? 0, `Sprocket at depot ${id}`).toBeGreaterThanOrEqual(2);
    expect(calls.get(SPROCKET)!.get(WAREHOUSE) ?? 0).toBe(0);
    expect([...said]).toContain("Skips warehouse: no track joins it to the track this train is on. Join its track to this line's, or take it off the line");
    // Teal line 2 still calls at Warehouse 2: it's on its railway.
    expect(calls.get(TEAL)!.get(WAREHOUSE) ?? 0).toBeGreaterThanOrEqual(1);
  }, 180_000);
});

describe("the user's Sprocket map: the warehouse's tracks left behind where it was", () => {
  const WAREHOUSE = 15;
  it("its card offers a second track beside it where it stands, toward Orange line 2's loop", async () => {
    // "The double track with the warehouse should be a stop but isn't": Orange line 2's loop runs beside Warehouse 2
    // (pieces 634, 635, about 117 mm off it), never joined to it. The way to make track beside a yard its stop is the
    // card's Second track, but the card said "It has 3 tracks already": its second and third tracks (607, 729) lay
    // loose where it stood before it was moved, still counted. A further track counts only beside its yard now.
    const { world } = await loadBugMap(MAP);
    const { economy, layout } = world;
    const d = economy.depot(WAREHOUSE)!;
    expect(economy.tracksOf(WAREHOUSE)!.roads.map((r) => r.pieceId)).toEqual([607, 729]);
    expect(economy.trackCount(WAREHOUSE)).toBe(1);
    expect(economy.unjoinedTracks(d)).toEqual([]);
    const plan = planTracks(world, d, () => null);
    if (typeof plan === "string") throw new Error(plan);
    expect(plan.tracks).toBe(2);
    expect(plan.keptRoads).toEqual([]);
    const road = plan.pieces[0];
    expect(findOverlap(layout, road.type, road.flipped, road.pose, road.y, new Set())).toBe(-1);
    // (On the loop's side: nearer the loop's track beside it than the yard is.)
    const loop = layout.getPiece(635)!.pose;
    const yard = layout.getPiece(d.pieceId)!.pose;
    expect(Math.abs(road.pose.x - loop.x)).toBeLessThan(Math.abs(yard.x - loop.x));
    // (The other yards' further tracks, beside them, still count.)
    expect(economy.trackCount(13)).toBe(2);
    expect(economy.trackCount(17)).toBe(2);
  });
});

describe("the user's Sprocket map with the train dispatcher on", () => {
  it("Sprocket laps its farm, dairy, bakery and mill, and the green line's trains lap theirs past a yard of two railways", async () => {
    // (With the dispatcher planning its way round by the warehouse, it stood on the mill's track for good: "Waiting:
    // something's in the way".)
    const { world } = await loadBugMap(MAP);
    const { sim, economy } = world;
    // (And the green line's trains, Pink line 3's (engine 47) and Teal line 3's (74): Warehouse 1 (depot 13) has its own
    // track on the main line and its second on the green line they run on. The dispatcher planned their laps round its
    // own track, which no way from the green line reaches, and they stood for good after a stop or two; Orange line 3's
    // (60) never came to the brickworks.)
    expect(railwaysOf(economy, 13).size).toBe(2);
    expect(railwaysOf(economy, 13).has(economy.railwayOf(economy.depot(13)!.pieceId))).toBe(true);
    expect(railwaysOf(economy, 13).has(economy.railwayOf(sim.findCar(47)!.train.bogies[0].pieceId))).toBe(true);
    expect(economy.railwayOf(economy.depot(13)!.pieceId)).not.toBe(economy.railwayOf(sim.findCar(47)!.train.bogies[0].pieceId));
    economy.useDispatcher(true);
    const engines = [51, 47, 74, 60];
    const calls = new Map<number, Map<number, number>>(engines.map((e) => [e, new Map()]));
    const was = new Map<number, number>();
    for (let i = 0; i < 600 * SIM_HZ; i++) {
      sim.tick();
      economy.tick();
      for (const e of engines) {
        const r = economy.routeOf(e)!;
        const at = r.at ? r.stops[r.next % r.stops.length].depotId : -1;
        if (at !== -1 && at !== was.get(e)) calls.get(e)!.set(at, (calls.get(e)!.get(at) ?? 0) + 1);
        was.set(e, at);
      }
    }
    for (const id of [14, 35, 34, 16]) expect(calls.get(51)!.get(id) ?? 0, `Sprocket at depot ${id}`).toBeGreaterThanOrEqual(2);
    for (const e of [47, 74, 60]) {
      const line = economy.lines.get(economy.lineIdOf.get(e)!)!;
      for (const st of line.stops) expect(calls.get(e)!.get(st.depotId) ?? 0, `${line.name} at depot ${st.depotId}`).toBeGreaterThanOrEqual(2);
    }
  }, 180_000);
});

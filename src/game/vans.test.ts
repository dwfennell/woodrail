import { describe, expect, it } from "vitest";
import type { Economy } from "../economy";
import { gridWithPlots, SURF_ROAD, type Landscape, type Town } from "../landscape";
import { pieceForEdges } from "../roads/pieces";
import { RoadVehicles } from "../roads/vehicles";
import type { Layout } from "../track";
import { Vans, type VanWorld } from "./vans";

/**
 * Two towns on row 2 (A's street at column 1, B's at column 9) joined by a road between; A's station beside its
 * street. The van layer only, over a stand-in economy (its road vehicles) and layout (the station's pose).
 */
function world(): { w: VanWorld; road: number[]; cross: { version: number; set: Set<number>; has(i: number): boolean } } {
  const grid = gridWithPlots(0, 0, 1, 1);
  const at = (c: number, r: number) => grid.index(c, r);
  const town = (id: number, col: number): Town => ({ id, name: `T${id}`, centre: { x: grid.centreX(col), z: grid.centreZ(2) }, station: { x: grid.centreX(col), z: grid.centreZ(1), heading: 0 }, cells: [at(col, 2), at(col, 1)], buildings: [] });
  const landscape: Landscape = { seed: 1, starter: false, grid, towns: [town(0, 1), town(1, 9)], depots: [], fields: [], shed: null, corridors: [], nextBuildingId: 0 };
  const road: number[] = [];
  for (let c = 1; c <= 9; c++) {
    const i = at(c, 2);
    road.push(i);
    grid.setRoad(i, pieceForEdges((c > 1 ? 4 : 0) | (c < 9 ? 1 : 0)));
  }
  grid.surface[at(1, 2)] = SURF_ROAD;
  grid.surface[at(9, 2)] = SURF_ROAD;
  grid.touch();
  const economy = { roadVehicles: new RoadVehicles() } as unknown as Economy;
  const layout = { getPiece: (id: number) => ({ pose: landscape.towns[id].station }) } as unknown as Layout;
  const w: VanWorld = { landscape, economy, layout, stations: new Map([[0, 0], [1, 1]]) };
  const cross = { version: 0, set: new Set<number>(), has(i: number) { return this.set.has(i); } };
  return { w, road, cross };
}

const run = (rv: RoadVehicles, seconds: number, until?: () => boolean) => {
  for (let k = 0; k < seconds * 120 && !until?.(); k++) rv.tick(1 / 120);
};

describe("vans' trips (roads spec step 4)", () => {
  it("parks on its town's street by the station, drives to the other town and back", () => {
    const { w, road, cross } = world();
    const vans = new Vans(() => w, () => cross);
    expect(vans.homeOf(0)).toBe(road[0]);
    expect(vans.drive(0, 1)).toBe(true);
    const v = vans.vehicles.list[0];
    expect(v.leg).toBe("out");
    run(vans.vehicles, 30, () => v.leg === "there");
    expect(w.landscape.grid.cellAtWorld(v.x, v.z)).toBe(road[8]);
    run(vans.vehicles, 30, () => v.leg === "home");
    expect(w.landscape.grid.cellAtWorld(v.x, v.z)).toBe(road[0]);
    // One van per station: sent again, the same one goes.
    expect(vans.drive(0, 1)).toBe(true);
    expect(vans.vehicles.list).toHaveLength(1);
  });

  it("turns back when the road ahead is taken up, and comes home", () => {
    const { w, road, cross } = world();
    const vans = new Vans(() => w, () => cross);
    vans.drive(0, 1);
    const v = vans.vehicles.list[0];
    run(vans.vehicles, 1.5);
    expect(v.leg).toBe("out");
    w.landscape.grid.setRoad(road[6], 0);
    w.landscape.grid.touch();
    run(vans.vehicles, 1 / 60);
    expect(v.leg).toBe("back");
    run(vans.vehicles, 30, () => v.leg === "home");
    expect(v.leg).toBe("home");
    expect(w.landscape.grid.cellAtWorld(v.x, v.z)).toBe(road[0]);
    // And with no way there, it isn't sent.
    expect(vans.drive(0, 1)).toBe(false);
  });

  it("with no road home at all, it's put back home", () => {
    const { w, road, cross } = world();
    const vans = new Vans(() => w, () => cross);
    vans.drive(0, 1);
    const v = vans.vehicles.list[0];
    run(vans.vehicles, 3);
    const here = w.landscape.grid.cellAtWorld(v.x, v.z);
    const k = road.indexOf(here);
    expect(k).toBeGreaterThan(1);
    // Cut both ways: ahead and behind.
    for (const i of [road[k - 1], road[k + 1]]) w.landscape.grid.setRoad(i, 0);
    w.landscape.grid.touch();
    run(vans.vehicles, 1 / 60);
    expect(v.leg).toBe("home");
    expect(w.landscape.grid.cellAtWorld(v.x, v.z)).toBe(road[0]);
  });

  it("a crossing that comes while it's on its way: it waits there while shut", () => {
    const { w, road, cross } = world();
    const vans = new Vans(() => w, () => cross);
    let shut = true;
    vans.vehicles.shut = () => shut;
    vans.drive(0, 1);
    const v = vans.vehicles.list[0];
    run(vans.vehicles, 0.5);
    cross.set.add(road[5]);
    cross.version++;
    run(vans.vehicles, 20);
    expect(v.holding).toBe(true);
    expect(w.landscape.grid.cellAtWorld(v.x, v.z)).toBe(road[4]);
    shut = false;
    run(vans.vehicles, 30, () => v.leg === "there");
    expect(v.leg).toBe("there");
  });

  it("searches once per trip and edit, not per tick", () => {
    const { w, cross } = world();
    const vans = new Vans(() => w, () => cross);
    vans.drive(0, 1);
    const v = vans.vehicles.list[0];
    run(vans.vehicles, 30, () => v.leg === "home");
    // Out, and back (worked out on arriving).
    expect(vans.paths.searches).toBe(2);
    vans.drive(0, 1);
    run(vans.vehicles, 30, () => v.leg === "home");
    expect(vans.paths.searches).toBe(2);
  });
});

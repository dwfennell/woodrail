import { describe, expect, it } from "vitest";
import { CELL, gridWithPlots, SURF_RIVER, SURF_ROAD, type Landscape } from "../landscape";
import { RISER_HEIGHT } from "../track";
import { encodeRoad, pieceForEdges } from "./pieces";
import { findRoadSquares, joinFrom, KEEP_LEFT, RoadPathCache, roadPath, VAN_REACH } from "./road-paths";
import { DWELL, RoadVehicles, VEHICLE_CAP, VEHICLE_SPEED } from "./vehicles";

function land(): Landscape {
  return { seed: 1, starter: false, grid: gridWithPlots(0, 0, 1, 1), towns: [], depots: [], fields: [], shed: null, corridors: [], nextBuildingId: 0 };
}

/** Lay a road along squares (col, row) in order, each shaped to join its neighbours on the list. */
function lay(l: Landscape, cells: readonly [number, number][]): number[] {
  const g = l.grid;
  const idx = cells.map(([c, r]) => g.index(c, r));
  idx.forEach((i, k) => {
    let mask = 0;
    for (const j of [idx[k - 1], idx[k + 1]]) {
      if (j === undefined) continue;
      const dc = g.colOf(j) - g.colOf(i);
      const dr = g.rowOf(j) - g.rowOf(i);
      mask |= 1 << (dc === 1 ? 0 : dr === 1 ? 1 : dc === -1 ? 2 : 3);
    }
    g.setRoad(i, pieceForEdges(mask));
  });
  g.touch();
  return idx;
}

const straightRow = (from: number, to: number, row: number): [number, number][] => Array.from({ length: to - from + 1 }, (_, k) => [from + k, row] as [number, number]);

describe("road paths (roads spec §3)", () => {
  it("finds the squares joined from one end to the other, and none past a gap", () => {
    const l = land();
    const sq = lay(l, straightRow(1, 6, 2));
    expect(findRoadSquares(l, [sq[0]], (i) => i === sq[5])).toEqual(sq);
    l.grid.setRoad(sq[3], 0);
    l.grid.touch();
    expect(findRoadSquares(l, [sq[0]], (i) => i === sq[5])).toBeNull();
  });

  it("only goes where pieces meet: two roads side by side don't join", () => {
    const l = land();
    const a = lay(l, straightRow(1, 3, 2));
    const b = lay(l, straightRow(1, 3, 3));
    expect(findRoadSquares(l, [a[0]], (i) => b.includes(i))).toBeNull();
  });

  it("reaches at most VAN_REACH squares that aren't town streets (streets are free)", () => {
    const l = land();
    const sq = lay(l, straightRow(0, VAN_REACH + 3, 2));
    // From square 0, the goal VAN_REACH + 1 squares on: too far…
    expect(findRoadSquares(l, [sq[0]], (i) => i === sq[VAN_REACH + 1])).toBeNull();
    expect(findRoadSquares(l, [sq[0]], (i) => i === sq[VAN_REACH])).toHaveLength(VAN_REACH + 1);
    // …unless three of the squares on the way are a town's streets.
    for (const k of [1, 2, 3]) l.grid.surface[sq[k]] = SURF_ROAD;
    expect(findRoadSquares(l, [sq[0]], (i) => i === sq[VAN_REACH + 3])).toHaveLength(VAN_REACH + 4);
  });

  it("is a polyline from the first square's middle to the last's, keeping left all the way (ends too: it parks at the kerb), round a bend", () => {
    const l = land();
    const g = l.grid;
    // East along row 2, then a bend south down column 4.
    const sq = lay(l, [[2, 2], [3, 2], [4, 2], [4, 3], [4, 4]]);
    const path = roadPath(l, sq);
    const n = path.at.length;
    // Starting east (left is −z), ending south (left is +x).
    expect(path.pts[0]).toBeCloseTo(g.centreX(2));
    expect(path.pts[2]).toBeCloseTo(g.centreZ(2) - KEEP_LEFT);
    expect(path.pts[(n - 1) * 3]).toBeCloseTo(g.centreX(4) + KEEP_LEFT);
    expect(path.pts[(n - 1) * 3 + 2]).toBeCloseTo(g.centreZ(4));
    // Between squares 2 and 3 of row 2 (x = 3 cells), heading +x: left is −z.
    const k = [...path.pts].findIndex((v, j) => j % 3 === 0 && Math.abs(v - 3 * CELL) < 0.01);
    expect(path.pts[k + 2]).toBeCloseTo(2.5 * CELL - KEEP_LEFT);
    // Shorter than going round the corner square's middle, longer than straight across.
    expect(path.length).toBeGreaterThan(3 * CELL);
    expect(path.length).toBeLessThan(4.2 * CELL);
    // On the road's top, at ground level.
    expect(path.pts[1]).toBeCloseTo(4.3);
  });

  it("climbs a ramp and humps over a bridge, level with the roads either side", () => {
    const l = land();
    const g = l.grid;
    const at = (c: number, r: number) => g.index(c, r);
    // Row 2: road, ramp bottom, ramp top, road on a hilltop a block up.
    g.setRoad(at(1, 2), encodeRoad("straight", 0));
    g.setRoad(at(2, 2), encodeRoad("ramp-low", 0));
    g.setRoad(at(3, 2), encodeRoad("ramp-high", 0));
    g.height[at(4, 2)] = 1;
    g.setRoad(at(4, 2), encodeRoad("straight", 0));
    g.touch();
    const sq = findRoadSquares(l, [at(1, 2)], (i) => i === at(4, 2))!;
    expect(sq).toHaveLength(4);
    const up = roadPath(l, sq);
    const y = (path: typeof up, x: number) => {
      let best = 0;
      for (let k = 0; k < path.at.length; k++) if (Math.abs(path.pts[k * 3] - x) < Math.abs(path.pts[best * 3] - x)) best = k;
      return path.pts[best * 3 + 1];
    };
    expect(y(up, 2 * CELL)).toBeCloseTo(4.3);
    expect(y(up, 3 * CELL)).toBeCloseTo(4.3 + RISER_HEIGHT / 2);
    expect(y(up, 4 * CELL)).toBeCloseTo(4.3 + RISER_HEIGHT);
    // A bridge over a river square: level at its ends, humped in the middle.
    const m = land();
    const h = m.grid;
    const bt = (c: number, r: number) => h.index(c, r);
    h.setRoad(bt(1, 2), encodeRoad("straight", 0));
    h.surface[bt(2, 2)] = SURF_RIVER;
    h.setRoad(bt(2, 2), encodeRoad("bridge", 0));
    h.setRoad(bt(3, 2), encodeRoad("straight", 0));
    h.touch();
    const over = roadPath(m, findRoadSquares(m, [bt(1, 2)], (i) => i === bt(3, 2))!);
    expect(y(over, 2 * CELL)).toBeCloseTo(4.3);
    expect(y(over, 2.5 * CELL)).toBeGreaterThan(4.3 + 8);
  });

  it("holds short of a crossing's first square", () => {
    const l = land();
    const sq = lay(l, straightRow(1, 6, 2));
    const path = roadPath(l, sq, (i) => i === sq[3] || i === sq[4]);
    expect(path.holds).toHaveLength(1);
    expect(path.holds[0].square).toBe(sq[3]);
    // The edge into square 3 is 2.5 squares from the first's middle.
    expect(path.holds[0].at).toBeLessThan(2.5 * CELL);
    expect(path.holds[0].at).toBeGreaterThan(2 * CELL - 10);
  });

  it("is cached by the grid's revision and the crossings: worked out again only after an edit", () => {
    const l = land();
    const sq = lay(l, straightRow(1, 6, 2));
    const cache = new RoadPathCache();
    const make = () => roadPath(l, findRoadSquares(l, [sq[0]], (i) => i === sq[5])!);
    const a = cache.get(l, 0, "a", make);
    expect(cache.get(l, 0, "a", make)).toBe(a);
    expect(cache.searches).toBe(1);
    l.grid.touch();
    expect(cache.get(l, 0, "a", make)).not.toBe(a);
    cache.get(l, 1, "a", make);
    expect(cache.searches).toBe(3);
  });

  it("rebuilds a van's way after a road edit in well under a millisecond (spec: under 1 ms)", () => {
    const l = land();
    const sq = lay(l, [...straightRow(0, 8, 2), [8, 3], [8, 4], [8, 5], [8, 6]]);
    const run = () => roadPath(l, findRoadSquares(l, [sq[0]], (i) => i === sq[sq.length - 1], 64)!);
    for (let k = 0; k < 50; k++) run();
    const times: number[] = [];
    for (let k = 0; k < 9; k++) {
      const t0 = performance.now();
      for (let j = 0; j < 20; j++) run();
      times.push((performance.now() - t0) / 20);
    }
    times.sort((a, b) => a - b);
    // (Median of nine; measured about 0.01 ms here. A 10× slowdown still passes; a broken search doesn't.)
    expect(times[4]).toBeLessThan(1);
  });
});

describe("road vehicles", () => {
  const path = () => {
    const l = land();
    return { l, out: roadPath(l, lay(l, straightRow(1, 6, 2))) };
  };

  it("drives out at its speed, stands, comes back and parks; nothing ticks while parked", () => {
    const { l, out } = path();
    const back = roadPath(l, [...out.squares].reverse());
    const rv = new RoadVehicles();
    const v = rv.add("van", out.pts[0], out.pts[1], out.pts[2], 0)!;
    const events: string[] = [];
    rv.onArrive = () => events.push("arrive");
    rv.onHome = () => events.push("home");
    rv.send(v, out, back);
    const dt = 1 / 120;
    rv.tick(dt);
    expect(v.t).toBeCloseTo(VEHICLE_SPEED.van * dt);
    let ticks = 1;
    while (v.leg === "out") {
      rv.tick(dt);
      ticks++;
    }
    expect(events).toEqual(["arrive"]);
    expect(ticks * dt).toBeCloseTo(out.length / VEHICLE_SPEED.van, 1);
    for (let k = 0; k < Math.ceil(DWELL / dt) + 1; k++) rv.tick(dt);
    expect(v.leg).toBe("back");
    while (v.leg !== "home") rv.tick(dt);
    expect(events).toEqual(["arrive", "home"]);
    expect(v.x).toBeCloseTo(out.pts[0]);
    // Parked: ticks change nothing (no pose, no version).
    const version = rv.version;
    let before = 0;
    rv.beforeTick = () => before++;
    for (let k = 0; k < 100; k++) rv.tick(dt);
    expect(rv.version).toBe(version);
    expect(before).toBe(0);
  });

  it("faces the way it drives, and keeps left", () => {
    const { out } = path();
    const rv = new RoadVehicles();
    const v = rv.add("van", out.pts[0], out.pts[1], out.pts[2], 0)!;
    rv.send(v, out, null);
    for (let k = 0; k < 120; k++) rv.tick(1 / 120);
    expect(v.heading).toBeCloseTo(0);
    expect(v.z).toBeCloseTo(2.5 * CELL - KEEP_LEFT);
  });

  it("waits at a shut crossing's edge, never on it, and goes on once it opens", () => {
    const l = land();
    const sq = lay(l, straightRow(1, 6, 2));
    const out = roadPath(l, sq, (i) => i === sq[3]);
    const rv = new RoadVehicles();
    let shut = true;
    rv.shut = () => shut;
    const v = rv.add("van", out.pts[0], out.pts[1], out.pts[2], 0)!;
    rv.send(v, out, null);
    for (let k = 0; k < 120 * 10; k++) rv.tick(1 / 120);
    expect(v.holding).toBe(true);
    expect(v.t).toBeCloseTo(out.holds[0].at);
    const version = rv.version;
    for (let k = 0; k < 120; k++) rv.tick(1 / 120);
    // Waiting costs no pose changes.
    expect(rv.version).toBe(version);
    shut = false;
    rv.tick(1 / 120);
    expect(v.holding).toBe(false);
    expect(v.t).toBeGreaterThan(out.holds[0].at);
    // Once on the crossing, a train coming doesn't stop it there.
    while (v.t < out.at[out.at.length - 1] - CELL * 2.2) rv.tick(1 / 120);
    shut = true;
    const t = v.t;
    rv.tick(1 / 120);
    expect(v.t).toBeGreaterThan(t);
  });

  it("sets off from where it stands: a pull-out joins the kerb to the lane, a turn round swings smoothly, never a jump", () => {
    const l = land();
    const sq = lay(l, straightRow(1, 6, 2));
    const east = roadPath(l, sq);
    const west = roadPath(l, [...sq].reverse());
    const rv = new RoadVehicles();
    // At the end of the way east, by the kerb on its left, facing east: the way back west starts on the other side.
    const n = east.pts.length / 3 - 1;
    const v = rv.add("van", east.pts[n * 3], east.pts[n * 3 + 1], east.pts[n * 3 + 2], 0)!;
    rv.send(v, west, null);
    const joined = v.path!;
    expect(joined.lead).toBeGreaterThan(0);
    expect(joined.length).toBeCloseTo(west.length + joined.lead!);
    // The join ends where the way west starts, and no step along it is long (no jump), nor turns sharply.
    const k0 = joined.at.length - west.at.length;
    expect(joined.pts[k0 * 3]).toBeCloseTo(west.pts[0]);
    expect(joined.pts[k0 * 3 + 2]).toBeCloseTo(west.pts[2]);
    let prev = v.heading;
    let turned = 0;
    for (let k = 0; k < 120 * 3; k++) {
      const x = v.x;
      const z = v.z;
      rv.tick(1 / 120);
      expect(Math.hypot(v.x - x, v.z - z)).toBeLessThan(2);
      const d = Math.atan2(Math.sin(v.heading - prev), Math.cos(v.heading - prev));
      expect(Math.abs(d)).toBeLessThan(0.15);
      turned += d;
      prev = v.heading;
    }
    // It turned round (half a turn), and drives west on its own left (+z of the middle).
    expect(Math.abs(turned)).toBeCloseTo(Math.PI, 0);
    expect(v.z).toBeGreaterThan(l.grid.centreZ(2));
    // Already where a path starts, facing its way: the path as it is.
    expect(joinFrom(west, west.pts[0], west.pts[1], west.pts[2], Math.PI)).toBe(west);
  });

  it("is capped per kind", () => {
    const rv = new RoadVehicles();
    for (let k = 0; k < VEHICLE_CAP.van; k++) expect(rv.add("van", 0, 0, 0, 0)).not.toBeNull();
    expect(rv.add("van", 0, 0, 0, 0)).toBeNull();
    expect(rv.add("bus", 0, 0, 0, 0)).not.toBeNull();
  });

  it("costs a few microseconds a tick for eight vans on the move", () => {
    const l = land();
    const sq = lay(l, [...straightRow(0, 8, 2), [8, 3], [8, 4], [8, 5], [8, 6]]);
    const out = roadPath(l, sq);
    const rv = new RoadVehicles();
    for (let k = 0; k < VEHICLE_CAP.van; k++) rv.send(rv.add("van", 0, 0, 0, 0)!, out, out);
    const runs: number[] = [];
    for (let r = 0; r < 7; r++) {
      const t0 = performance.now();
      for (let k = 0; k < 600; k++) rv.tick(1 / 1200);
      runs.push(((performance.now() - t0) / 600) * 1000);
    }
    runs.sort((a, b) => a - b);
    // µs a tick (median of seven); measured about 1 µs here.
    expect(runs[3]).toBeLessThan(50);
  });
});


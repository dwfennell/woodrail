import { describe, expect, it } from "vitest";
import { getPieceDef, RISER_HEIGHT } from "../track";
import { BLOCK_MESSAGES, checkPlacement, hillMessage, inRiver, levelsAbove, RIVER_GRACE, surfaceOutlines } from "./clearance";
import { insideLoops, type Loop } from "./outline";
import { CELL, isWater, SURF_SEA } from "./grid";
import { FEAT_BUILDING, FEAT_TREE, gridWithPlots, PLOT_WIDTH, SURF_RIVER, SURF_TOWN } from "./grid";
import { generateLandscape, stationEnds, type Landscape } from "./generate";

function flat(): Landscape {
  return { seed: 0, starter: false, grid: gridWithPlots(-1, -1, 2, 2), towns: [], corridors: [], fields: [], shed: null, depots: [], nextBuildingId: 0 };
}
function setCells(land: Landscape, x0: number, x1: number, z0: number, z1: number, fn: (i: number) => void): void {
  const g = land.grid;
  for (let x = x0; x <= x1; x += 16) for (let z = z0; z <= z1; z += 16) {
    const i = g.cellAtWorld(x, z);
    if (i !== -1) fn(i);
  }
}
const P = (x: number, z: number, heading = 0) => ({ x, z, heading });

describe("checkPlacement", () => {
  it("allows a straight on flat grass", () => {
    expect(checkPlacement(flat(), "straight-216", false, P(0, 0), 0)).toEqual({ kind: "clear" });
  });

  it("blocks a straight across a river but not a bridge", () => {
    const land = flat();
    setCells(land, 96, 150, -100, 100, (i) => (land.grid.surface[i] = SURF_RIVER));
    expect(checkPlacement(land, "straight-216", false, P(0, 0), 0)).toEqual({ kind: "blocked", reason: "river" });
    expect(checkPlacement(land, "bridge", false, P(0, 0), 0)).toEqual({ kind: "clear" });
  });

  it("lets track overlap a river's bank a little, but not stand in it", () => {
    const land = flat();
    setCells(land, 96, 120, -400, 400, (i) => (land.grid.surface[i] = SURF_RIVER));
    // The river squares span x 72..144; a straight along z with its edge 10 mm over the bank, then 30 mm in.
    expect(checkPlacement(land, "straight-216", false, P(62, -108, Math.PI / 2), 0)).toEqual({ kind: "clear" });
    expect(checkPlacement(land, "straight-216", false, P(82, -108, Math.PI / 2), 0)).toEqual({ kind: "blocked", reason: "river" });
  });

  it("judges the river by its drawn, smoothed banks: a square's corner cut off at a bend is dry", () => {
    const land = flat();
    // A river stepping diagonally: a staircase of squares, which the felt draws as a smooth diagonal band.
    for (let k = -6; k <= 6; k++) setCells(land, k * 72 + 10, k * 72 + 130, k * 72 + 10, k * 72 + 60, (i) => (land.grid.surface[i] = SURF_RIVER));
    const g = land.grid;
    // Find a river square whose outer corner the smoothing has cut away, and check that spot is dry.
    let dry = 0;
    let wet = 0;
    for (let k = -4; k <= 4; k++) {
      // Outer corner of square (k+1, k): far from the diagonal, inside the square.
      const cx = (k + 1) * 72 + 72 - 6;
      const cz = k * 72 + 6;
      expect(g.surface[g.cellAtWorld(cx, cz)]).toBe(SURF_RIVER);
      if (inRiver(g, cx, cz)) wet++;
      else dry++;
      // On the band's middle line it's always wet.
      expect(inRiver(g, (k + 1) * 72 + 18, k * 72 + 54)).toBe(true);
    }
    expect(dry).toBeGreaterThan(wet);
  });

  it("track can sit on a hill top but not cut into it", () => {
    const land = flat();
    setCells(land, -200, 400, -100, 100, (i) => (land.grid.height[i] = 1));
    expect(checkPlacement(land, "straight-216", false, P(0, 0), 64)).toEqual({ kind: "clear" });
    expect(checkPlacement(land, "straight-216", false, P(0, 0), 0)).toEqual({ kind: "blocked", reason: "hill" });
  });

  it("a ramp can climb onto a hill", () => {
    const land = flat();
    // The ramp covers three squares (0..216); the hill begins on the next square, where its high end rests.
    setCells(land, 220, 600, -100, 100, (i) => (land.grid.height[i] = 1));
    expect(checkPlacement(land, "ramp", false, P(0, 0), 0)).toEqual({ kind: "clear" });
  });

  it("blocks buildings, town squares and the mat edge, but not trees (they step aside)", () => {
    const land = flat();
    setCells(land, 60, 80, -10, 10, (i) => (land.grid.feature[i] = FEAT_BUILDING));
    expect(checkPlacement(land, "straight-216", false, P(0, 0), 0)).toEqual({ kind: "blocked", reason: "building" });
    const t = flat();
    setCells(t, 60, 80, -10, 10, (i) => (t.grid.feature[i] = FEAT_TREE));
    expect(checkPlacement(t, "straight-216", false, P(0, 0), 0)).toEqual({ kind: "clear" });
    const town = flat();
    setCells(town, 60, 80, -10, 10, (i) => (town.grid.surface[i] = SURF_TOWN));
    expect(checkPlacement(town, "straight-216", false, P(0, 0), 0)).toEqual({ kind: "blocked", reason: "town" });
    expect(checkPlacement(flat(), "straight-216", false, P(PLOT_WIDTH - 100, 0), 0)).toEqual({ kind: "blocked", reason: "off-mat" });
    expect(BLOCK_MESSAGES["off-mat"]).toBe("That's past the edge of the map");
  });

  it("a straight seated on a station end is clear", () => {
    const land = generateLandscape(7, { starter: true });
    const [, peg] = stationEnds(land.towns[0]);
    expect(checkPlacement(land, "straight-216", false, P(peg.x, peg.z, peg.heading), 0)).toEqual({ kind: "clear" });
    const [socket] = stationEnds(land.towns[0]);
    const def = getPieceDef("straight-144", false);
    // attach by its peg to the station socket: origin is 144 mm back along the outward heading... facing inward
    const h = socket.heading + Math.PI;
    const origin = P(socket.x - Math.cos(h) * def.connectors[1].pose.x, socket.z - Math.sin(h) * def.connectors[1].pose.x, h);
    expect(checkPlacement(land, "straight-144", false, origin, 0)).toEqual({ kind: "clear" });
  });
});

describe("station ends across many maps", () => {
  const seat = (end: { x: number; z: number; heading: number }, peg: boolean) =>
    // On the peg end a piece seats by its socket (origin at the end); on the socket end by its peg (origin 54 mm back).
    peg ? P(end.x, end.z, end.heading) : P(end.x + Math.cos(end.heading) * 54, end.z + Math.sin(end.heading) * 54, end.heading + Math.PI);

  it.each(Array.from({ length: 200 }, (_, i) => i + 1))("seed %i: a short straight seats on both ends of every station", (seed) => {
    const land = generateLandscape(seed);
    for (const town of land.towns) {
      const [socketEnd, pegEnd] = stationEnds(town);
      expect(checkPlacement(land, "straight-54", false, seat(pegEnd, true), 0), `${town.name} peg end`).toEqual({ kind: "clear" });
      expect(checkPlacement(land, "straight-54", false, seat(socketEnd, false), 0), `${town.name} socket end`).toEqual({ kind: "clear" });
    }
  });
});

describe("how far up a hill in the way is", () => {
  const flat = (): Landscape => ({ seed: 0, starter: false, grid: gridWithPlots(-1, -1, 2, 2), towns: [], corridors: [], fields: [], shed: null, depots: [], nextBuildingId: 0 }) as Landscape;
  const raise = (land: Landscape, x0: number, x1: number, h: number) => {
    for (let x = x0 + 1; x < x1; x += 8) for (let z = -200; z < 260; z += 8) {
      const i = land.grid.cellAtWorld(x, z);
      if (i !== -1) land.grid.height[i] = h;
    }
  };
  it("counts the levels the ground rises above the track, and says how to climb them", () => {
    const land = flat();
    raise(land, 144, 900, 2);
    // A straight a level up (off a ramp's top) running into a hill two levels high: one more level to go.
    const pose = { x: 144, z: 36, heading: 0 };
    expect(checkPlacement(land, "straight-144", false, pose, RISER_HEIGHT)).toEqual({ kind: "blocked", reason: "hill" });
    expect(levelsAbove(land, "straight-144", false, pose, RISER_HEIGHT)).toBe(1);
    // On the ground: two levels to go.
    expect(levelsAbove(land, "straight-144", false, pose, 0)).toBe(2);
    expect(hillMessage(2)).toContain("two ramps");
    expect(hillMessage(1)).toContain("a ramp");
    // On top of it: nothing higher.
    expect(levelsAbove(land, "straight-144", false, { x: 400, z: 36, heading: 0 }, 2 * RISER_HEIGHT)).toBe(0);
  });
});

describe("inRiver (bucketed)", () => {
  /** As it was: every loop's every point, for each call. */
  function slow(land: Landscape, x: number, z: number): boolean {
    const g = land.grid;
    let near = false;
    for (let dr = -1; dr <= 1 && !near; dr++)
      for (let dc = -1; dc <= 1 && !near; dc++) {
        const i = g.index(Math.floor(x / CELL) + dc, Math.floor(z / CELL) + dr);
        near = i !== -1 && isWater(g.surface[i]);
      }
    if (!near) return false;
    const loops: Loop[] = surfaceOutlines(g, [SURF_RIVER, SURF_SEA]);
    const u = x / CELL;
    const v = z / CELL;
    let best = Infinity;
    for (const loop of loops)
      for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) {
        const a = loop[j];
        const b = loop[i];
        const dx = b.x - a.x;
        const dz = b.z - a.z;
        const t = Math.max(0, Math.min(1, ((u - a.x) * dx + (v - a.z) * dz) / (dx * dx + dz * dz || 1)));
        best = Math.min(best, Math.hypot(a.x + dx * t - u, a.z + dz * t - v));
      }
    return insideLoops(loops, u, v) && best * CELL > RIVER_GRACE;
  }

  it("says what it said before, everywhere near the water on a generated map, and is quick", () => {
    const land = generateLandscape(7);
    const g = land.grid;
    let seed = 3;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const pts: [number, number][] = [];
    for (let i = 0; i < g.cellCount && pts.length < 3000; i++) {
      if (!isWater(g.surface[i])) continue;
      for (let k = 0; k < 3; k++) pts.push([g.centreX(g.colOf(i)) + (rnd() - 0.5) * 3 * CELL, g.centreZ(g.rowOf(i)) + (rnd() - 0.5) * 3 * CELL]);
    }
    expect(pts.length).toBeGreaterThan(300);
    let wet = 0;
    for (const [x, z] of pts.slice(0, 600)) {
      const got = inRiver(g, x, z);
      expect(got, `${x}, ${z}`).toBe(slow(land, x, z));
      if (got) wet++;
    }
    expect(wet).toBeGreaterThan(50);
    inRiver(g, pts[0][0], pts[0][1]);
    const t0 = performance.now();
    for (const [x, z] of pts) inRiver(g, x, z);
    // About a microsecond a call (it was a few tenths of a millisecond by a big river).
    expect((performance.now() - t0) / pts.length).toBeLessThan(0.02);
  });
});

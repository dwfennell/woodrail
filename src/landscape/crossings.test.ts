import { describe, expect, it } from "vitest";
import { Layout } from "../track";
import { checkPlacement } from "./clearance";
import { findCrossings } from "./crossings";
import { generateLandscape } from "./generate";
import { encodeRoad } from "../roads/pieces";
import { FEAT_NONE, gridWithPlots, SURF_LANE, SURF_ROAD, SURF_TOWN } from "./grid";
import type { Landscape } from "./generate";

const SEEDS = Array.from({ length: 200 }, (_, i) => i + 1);
// Generating a map is the slow part: make each one once for the whole file.
const cache = new Map<number, ReturnType<typeof generateLandscape>>();
const mapFor = (seed: number) => {
  let l = cache.get(seed);
  if (!l) cache.set(seed, (l = generateLandscape(seed)));
  return l;
};

function laneCells(seed: number): number[] {
  const g = mapFor(seed).grid;
  const out: number[] = [];
  for (let i = 0; i < g.cellCount; i++) if (g.surface[i] === SURF_LANE) out.push(i);
  return out;
}

describe("town gates", () => {
  it.each(SEEDS)("seed %i: gates lie on flat open felt, each beside a town street", (seed) => {
    const g = mapFor(seed).grid;
    for (const i of laneCells(seed)) {
      expect(g.height[i]).toBe(0);
      expect(g.feature[i]).toBe(FEAT_NONE);
      const c = g.colOf(i);
      const r = g.rowOf(i);
      const near = [g.index(c - 1, r), g.index(c + 1, r), g.index(c, r - 1), g.index(c, r + 1)];
      expect(near.some((j) => j !== -1 && (g.surface[j] === SURF_ROAD || g.surface[j] === SURF_TOWN))).toBe(true);
    }
  });
});

describe("findCrossings", () => {
  // A road running along z down column 10 of an empty plot, and a straight across it at row 8.
  const land: Landscape = { seed: 1, starter: false, grid: gridWithPlots(0, 0, 1, 1), towns: [], depots: [], fields: [], shed: null, corridors: [], nextBuildingId: 0 };
  const g = land.grid;
  const col = 10;
  const row = 8;
  for (let r = 2; r < 20; r++) g.setRoad(g.index(col, r), encodeRoad("straight", 1));
  const alongX = false;
  const heading = 0;
  const pose = { x: g.centreX(col) - 108, z: g.centreZ(row), heading };

  it("track may be laid across a lane", () => {
    // The lane square itself never blocks (the ends of the straight may still meet other things).
    const one = new Layout();
    one.addPiece("straight-54", { x: g.centreX(col) - 27, z: g.centreZ(row), heading });
    const p = one.getPiece([...one.pieceIds()][0])!;
    expect(checkPlacement(land, p.type, false, p.pose, 0)).toEqual({ kind: "clear" });
  });

  it("points don't sit on a road: a switch laid across it is refused", () => {
    for (const type of ["switch", "switch-y"] as const) {
      const p = { x: g.centreX(col) - 72, z: g.centreZ(row), heading };
      expect(checkPlacement(land, type, false, p, 0)).toEqual({ kind: "blocked", reason: "road" });
    }
  });

  it("finds one crossing where a straight runs over a lane, at the lane, with the lane's direction", () => {
    const layout = new Layout();
    layout.addPiece("straight-216", pose);
    const found = findCrossings(land, layout);
    expect(found).toHaveLength(1);
    expect(Math.hypot(found[0].x - g.centreX(col), found[0].z - g.centreZ(row))).toBeLessThan(40);
    expect(found[0].laneAlongX).toBe(alongX);
  });

  it("ignores lifted pieces and track raised off the ground", () => {
    const layout = new Layout();
    const id = layout.addPiece("straight-216", pose);
    layout.liftPiece(id);
    expect(findCrossings(land, layout)).toHaveLength(0);
    const raised = new Layout();
    raised.addPiece("straight-216", pose, 64);
    expect(findCrossings(land, raised)).toHaveLength(0);
  });
});

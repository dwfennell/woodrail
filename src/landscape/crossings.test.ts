import { describe, expect, it } from "vitest";
import { Layout } from "../track";
import { checkPlacement } from "./clearance";
import { findCrossings } from "./crossings";
import { generateLandscape } from "./generate";
import { COLS, FEAT_NONE, ROWS, SURF_LANE } from "./grid";

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
  for (let i = 0; i < g.surface.length; i++) if (g.surface[i] === SURF_LANE) out.push(i);
  return out;
}

describe("country lanes", () => {
  it.each(SEEDS)("seed %i: lanes lie on flat open felt and reach the mat edge", (seed) => {
    const land = mapFor(seed);
    const g = land.grid;
    const lanes = new Set(laneCells(seed));
    for (const i of lanes) {
      expect(g.height[i]).toBe(0);
      expect(g.feature[i]).toBe(FEAT_NONE);
    }
    // Every lane square connects (4-way, through lane squares) to a square on the mat's edge.
    const edge = (i: number) => {
      const c = i % COLS;
      const r = (i - c) / COLS;
      return c === 0 || r === 0 || c === COLS - 1 || r === ROWS - 1;
    };
    const seen = new Set<number>();
    for (const start of lanes) {
      if (seen.has(start)) continue;
      const group: number[] = [start];
      seen.add(start);
      for (let k = 0; k < group.length; k++) {
        const i = group[k];
        const c = i % COLS;
        for (const j of [c > 0 ? i - 1 : -1, c + 1 < COLS ? i + 1 : -1, i - COLS, i + COLS]) {
          if (lanes.has(j) && !seen.has(j)) {
            seen.add(j);
            group.push(j);
          }
        }
      }
      expect(group.some(edge)).toBe(true);
    }
  });

  it("most maps have at least one lane", () => {
    const withLanes = SEEDS.filter((s) => laneCells(s).length > 0).length;
    expect(withLanes).toBeGreaterThan(SEEDS.length * 0.8);
  });
});

describe("findCrossings", () => {
  // A seed with a lane square whose neighbours across the lane are open felt, so a straight fits over it.
  const seed = SEEDS.find((s) => laneCells(s).length > 0)!;
  const land = mapFor(seed);
  const g = land.grid;
  const cell = laneCells(seed).find((i) => {
    const c = i % COLS;
    const r = (i - c) / COLS;
    return c > 3 && c < COLS - 4 && r > 3 && r < ROWS - 4;
  })!;
  const col = cell % COLS;
  const row = (cell - col) / COLS;
  const alongX = g.surface[cell - 1] === SURF_LANE || g.surface[cell + 1] === SURF_LANE;
  // A long straight centred on the lane square, across the lane.
  const heading = alongX ? Math.PI / 2 : 0;
  const pose = { x: g.centreX(col) - Math.cos(heading) * 108, z: g.centreZ(row) - Math.sin(heading) * 108, heading };

  it("track may be laid across a lane", () => {
    // The lane square itself never blocks (the ends of the straight may still meet other things).
    const one = new Layout();
    one.addPiece("straight-54", { x: g.centreX(col) - Math.cos(heading) * 27, z: g.centreZ(row) - Math.sin(heading) * 27, heading });
    const p = one.getPiece([...one.pieceIds()][0])!;
    expect(checkPlacement(land, p.type, false, p.pose, 0)).toEqual({ kind: "clear" });
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

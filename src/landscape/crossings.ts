import { createSample, getPieceDef, pathLength, samplePath, type Layout } from "../track";
import { SURF_LANE } from "./grid";
import type { Landscape } from "./generate";

/** Where track crosses a country lane: the middle of the crossing and which way the lane runs there. */
export interface LevelCrossing {
  x: number;
  z: number;
  /** True when the lane runs along x at the crossing (false: along z). */
  laneAlongX: boolean;
  /** The ground's height there (a road on a hilltop). */
  y: number;
}

const STEP = 8;
const sample = createSample();

/** Every level crossing in a layout: one per group of touching lane squares that ground-level track runs over. */
export function findCrossings(land: Landscape, layout: Layout): LevelCrossing[] {
  const g = land.grid;
  // Lane square → the track points over it.
  const hits = new Map<number, { x: number; z: number; n: number }>();
  for (const id of layout.pieceIds()) {
    if (layout.isLifted(id)) continue;
    const p = layout.getPiece(id)!;
    const def = getPieceDef(p.type, p.flipped);
    const ch = Math.cos(p.pose.heading);
    const sh = Math.sin(p.pose.heading);
    for (const path of def.paths) {
      const len = pathLength(path.geom);
      const n = Math.max(1, Math.ceil(len / STEP));
      for (let k = 0; k <= n; k++) {
        samplePath(path.geom, (len * k) / n, sample);
        const x = p.pose.x + sample.x * ch - sample.z * sh;
        const z = p.pose.z + sample.x * sh + sample.z * ch;
        const i = g.cellAtWorld(x, z);
        if (i === -1 || g.surface[i] !== SURF_LANE) continue;
        if (p.y + sample.y > g.groundY(i) + 4) continue; // on a bridge or riser: no crossing
        const h = hits.get(i) ?? { x: 0, z: 0, n: 0 };
        h.x += x;
        h.z += z;
        h.n++;
        hits.set(i, h);
      }
    }
  }
  // Group touching hit squares; each group is one crossing.
  const out: LevelCrossing[] = [];
  const done = new Set<number>();
  for (const start of hits.keys()) {
    if (done.has(start)) continue;
    let x = 0;
    let z = 0;
    let n = 0;
    const queue = [start];
    done.add(start);
    while (queue.length) {
      const i = queue.pop()!;
      const h = hits.get(i)!;
      x += h.x;
      z += h.z;
      n += h.n;
      const col = g.colOf(i);
      const row = g.rowOf(i);
      for (const j of [g.index(col - 1, row), g.index(col + 1, row), g.index(col, row - 1), g.index(col, row + 1)]) {
        if (j !== -1 && hits.has(j) && !done.has(j)) {
          done.add(j);
          queue.push(j);
        }
      }
    }
    const col = g.colOf(start);
    const row = g.rowOf(start);
    const lane = (c: number, r: number) => {
      const j = g.index(c, r);
      return j !== -1 && g.surface[j] === SURF_LANE;
    };
    const alongX = lane(col - 1, row) || lane(col + 1, row);
    const alongZ = lane(col, row - 1) || lane(col, row + 1);
    out.push({ x: x / n, z: z / n, laneAlongX: alongX && !alongZ ? true : alongZ && !alongX ? false : alongX, y: g.groundY(start) });
  }
  return out;
}

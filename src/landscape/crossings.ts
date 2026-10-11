import { createSample, getPieceDef, pathLength, samplePath, type Layout } from "../track";
import { COLS, SURF_LANE } from "./grid";
import type { Landscape } from "./generate";

/** Where track crosses a country lane: the middle of the crossing and which way the lane runs there. */
export interface LevelCrossing {
  x: number;
  z: number;
  /** True when the lane runs along x at the crossing (false: along z). */
  laneAlongX: boolean;
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
        if (p.y + sample.y > 4) continue; // on a bridge or riser: no crossing
        const x = p.pose.x + sample.x * ch - sample.z * sh;
        const z = p.pose.z + sample.x * sh + sample.z * ch;
        const i = g.cellAtWorld(x, z);
        if (i === -1 || g.surface[i] !== SURF_LANE) continue;
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
      const col = i % COLS;
      for (const j of [col > 0 ? i - 1 : -1, col + 1 < COLS ? i + 1 : -1, i - COLS, i + COLS]) {
        if (j >= 0 && hits.has(j) && !done.has(j)) {
          done.add(j);
          queue.push(j);
        }
      }
    }
    const col = start % COLS;
    const lane = (j: number) => j >= 0 && j < g.surface.length && g.surface[j] === SURF_LANE;
    const alongX = (col > 0 && lane(start - 1)) || (col + 1 < COLS && lane(start + 1));
    const alongZ = lane(start - COLS) || lane(start + COLS);
    out.push({ x: x / n, z: z / n, laneAlongX: alongX && !alongZ ? true : alongZ && !alongX ? false : alongX });
  }
  return out;
}

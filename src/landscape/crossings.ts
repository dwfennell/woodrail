import { createSample, getPieceDef, pathLength, samplePath, TRACK_WIDTH, type Layout } from "../track";
import { CELL, SURF_LANE, SURF_ROAD } from "./grid";
import type { Landscape } from "./generate";

/**
 * A barrier where traffic comes into a level crossing, just outside the crossing's squares where the road carries on:
 * its post (x, z, on the ground at y), the way into the crossing (dx, dz) and the way its arm reaches, across the road
 * toward its middle (ax, az); all unit vectors.
 */
export interface CrossingGate {
  x: number;
  z: number;
  y: number;
  dx: number;
  dz: number;
  ax: number;
  az: number;
}

/**
 * Where track crosses a road or lane (at any angle, on any piece of track): the middle of the crossing and a gate on
 * each side the road leaves it, where the barriers stand.
 */
export interface LevelCrossing {
  x: number;
  z: number;
  /** The ground's height there (a road on a hilltop). */
  y: number;
  gates: CrossingGate[];
}

/** Gates stand this far out from the middle of the crossing's edge square (mm): just past its edge. */
const GATE_OUT = CELL / 2 + 8;
/** A barrier's post stands this far to the side of the road's middle. */
export const GATE_ASIDE = 30;
/** A post stands at least this far from any track's middle (half the track, and the post's foot). */
const POST_CLEAR = TRACK_WIDTH / 2 + 8;

const STEP = 8;
const sample = createSample();

/** Every level crossing in a layout: one per group of touching lane squares that ground-level track runs over. */
export function findCrossings(land: Landscape, layout: Layout): LevelCrossing[] {
  const g = land.grid;
  // Lane square → the track points over it.
  const hits = new Map<number, { x: number; z: number; n: number }>();
  // Every ground-level track point, by square (a barrier's post keeps clear of them).
  const near = new Map<number, number[]>();
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
        if (i === -1) continue;
        if (p.y + sample.y > g.groundY(i) + 4) continue; // on a bridge or riser: no crossing
        let pts = near.get(i);
        if (!pts) near.set(i, (pts = []));
        pts.push(x, z);
        if (g.surface[i] !== SURF_LANE) continue;
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
    const group = new Set<number>([start]);
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
          group.add(j);
          queue.push(j);
        }
      }
    }
    // A gate on each side where the road carries on out of the crossing's squares.
    const gates: CrossingGate[] = [];
    const road = (j: number) => j !== -1 && (g.surface[j] === SURF_LANE || g.surface[j] === SURF_ROAD);
    for (const i of group) {
      const col = g.colOf(i);
      const row = g.rowOf(i);
      for (const [dc, dr] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ] as const) {
        const j = g.index(col + dc, row + dr);
        if (!road(j) || group.has(j)) continue;
        // On the right of traffic coming in; else the left; else a little further up the road. None clear (track all
        // round): no barrier there.
        const side = { x: -dr, z: dc };
        for (const [s, out] of [
          [1, GATE_OUT],
          [-1, GATE_OUT],
          [1, GATE_OUT + CELL / 2],
          [-1, GATE_OUT + CELL / 2],
        ] as const) {
          const x = g.centreX(col) + dc * out + side.x * GATE_ASIDE * s;
          const z = g.centreZ(row) + dr * out + side.z * GATE_ASIDE * s;
          if (!clearOfTrack(g, near, x, z)) continue;
          gates.push({ x, z, y: g.groundY(j), dx: -dc, dz: -dr, ax: -side.x * s, az: -side.z * s });
          break;
        }
      }
    }
    out.push({ x: x / n, z: z / n, y: g.groundY(start), gates });
  }
  return out;
}

/** Is a post at (x, z) clear of all ground-level track (`near`: track points by square)? */
function clearOfTrack(g: Landscape["grid"], near: Map<number, number[]>, x: number, z: number): boolean {
  const col = g.colAt(x);
  const row = g.rowAt(z);
  for (let dc = -1; dc <= 1; dc++) {
    for (let dr = -1; dr <= 1; dr++) {
      const pts = near.get(g.index(col + dc, row + dr));
      if (!pts) continue;
      for (let k = 0; k < pts.length; k += 2) if (Math.hypot(pts[k] - x, pts[k + 1] - z) < POST_CLEAR) return false;
    }
  }
  return true;
}

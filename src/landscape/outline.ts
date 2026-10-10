/** Outlines of grid regions (rivers, roads) as polygons in grid units: x = column, z = row, cell corners on integers. */

export interface LoopPoint {
  x: number;
  z: number;
}
export type Loop = LoopPoint[];

/**
 * Trace the boundary of every 4-connected region of `mask` cells. Each region yields one outer loop, plus one loop
 * per hole. Loops run clockwise on screen (rows downward), keeping the region on the right; where two regions touch
 * only at a corner, the walk turns right so each stays separate.
 */
export function traceRegions(mask: (col: number, row: number) => boolean, cols: number, rows: number): Loop[] {
  const W = cols + 1;
  const from: number[] = [];
  const to: number[] = [];
  const out = new Map<number, number[]>();
  const edge = (c0: number, r0: number, c1: number, r1: number) => {
    const a = r0 * W + c0;
    const id = from.length;
    from.push(a);
    to.push(r1 * W + c1);
    let list = out.get(a);
    if (!list) out.set(a, (list = []));
    list.push(id);
  };
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (!mask(c, r)) continue;
      if (r === 0 || !mask(c, r - 1)) edge(c, r, c + 1, r);
      if (c === cols - 1 || !mask(c + 1, r)) edge(c + 1, r, c + 1, r + 1);
      if (r === rows - 1 || !mask(c, r + 1)) edge(c + 1, r + 1, c, r + 1);
      if (c === 0 || !mask(c - 1, r)) edge(c, r + 1, c, r);
    }
  }

  const used = new Uint8Array(from.length);
  const loops: Loop[] = [];
  const pt = (v: number): LoopPoint => ({ x: v % W, z: Math.floor(v / W) });
  for (let start = 0; start < from.length; start++) {
    if (used[start]) continue;
    const loop: Loop = [];
    let e = start;
    while (!used[e]) {
      used[e] = 1;
      loop.push(pt(from[e]));
      const choices = out.get(to[e])!.filter((n) => !used[n] || n === start);
      if (choices.length === 0) break;
      if (choices.length === 1) {
        e = choices[0];
        continue;
      }
      // Corner touch: take the right turn, staying with this region's cell.
      const a = pt(from[e]);
      const b = pt(to[e]);
      const rx = -(b.z - a.z);
      const rz = b.x - a.x;
      e = choices.find((n) => {
        const c = pt(to[n]);
        return c.x - b.x === rx && c.z - b.z === rz;
      }) ?? choices[0];
    }
    loops.push(loop);
  }
  return loops;
}

/**
 * Soften a cell outline: Taubin smoothing (alternating shrink and inflate passes, so dead ends don't shrink away)
 * turns diagonal staircases into straight runs, then Chaikin corner cutting rounds what is left. Cell centres stay on
 * the correct side (see the coverage test).
 */
export function smoothLoop(loop: Loop, relax = 8, iterations = 2): Loop {
  let pts = loop;
  // Small patches have no staircases to straighten, and relaxing would shrink them away: scale with outline length.
  const passes = Math.min(relax, Math.floor(loop.length / 8));
  for (let k = 0; k < passes * 2; k++) {
    const f = k % 2 === 0 ? 0.5 : -0.53;
    const n = pts.length;
    const next: Loop = new Array(n);
    for (let i = 0; i < n; i++) {
      const a = pts[(i + n - 1) % n];
      const p = pts[i];
      const b = pts[(i + 1) % n];
      next[i] = { x: p.x + f * ((a.x + b.x) / 2 - p.x), z: p.z + f * ((a.z + b.z) / 2 - p.z) };
    }
    pts = next;
  }
  for (let k = 0; k < iterations; k++) {
    const next: Loop = [];
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      const q = pts[(i + 1) % pts.length];
      next.push({ x: 0.75 * p.x + 0.25 * q.x, z: 0.75 * p.z + 0.25 * q.z });
      next.push({ x: 0.25 * p.x + 0.75 * q.x, z: 0.25 * p.z + 0.75 * q.z });
    }
    pts = next;
  }
  return pts;
}

/** Even-odd point-in-polygon over a set of loops (outer loops and their holes). */
export function insideLoops(loops: readonly Loop[], x: number, z: number): boolean {
  let inside = false;
  for (const loop of loops) {
    for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) {
      const a = loop[i];
      const b = loop[j];
      if (a.z > z !== b.z > z && x < ((b.x - a.x) * (z - a.z)) / (b.z - a.z) + a.x) inside = !inside;
    }
  }
  return inside;
}

/** Signed area (shoelace); positive for outer loops as traced, negative for holes. */
export function loopArea(loop: Loop): number {
  let s = 0;
  for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) s += loop[j].x * loop[i].z - loop[i].x * loop[j].z;
  return s / 2;
}

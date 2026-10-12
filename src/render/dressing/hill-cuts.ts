import { BoxGeometry, BufferGeometry, Color, InstancedMesh, Float32BufferAttribute, Group, Matrix4, Mesh, MeshBasicMaterial, type Material } from "three";
import { blockOutline, CELL, COLS, hillPieces, hillsOf, MAT_DEPTH, MAT_WIDTH, MAX_HEIGHT, mergeSlabsWhere, ROWS, type HillCut, type LandscapeGrid } from "../../landscape";
import { RISER_HEIGHT } from "../../track";
import { BEECH_UV_SCALE } from "../materials";
import { blockKey, CORE_COLOUR, CORE_INSET, hillCore, shadowProxy, SHADOW_PROXY_LAYER, type BlockInstanceRef } from "./blocks";

/** Gap between neighbouring blocks (mm), as the hill draws them. */
const GAP = 0.8;
/** A block's top is a grid this many steps across (about 4 mm); coarser (6 mm) for a quick preview. */
const STEPS = 18;
const PREVIEW_STEPS = 12;
/** A cut block's top edges are bevelled this much (mm), like a whole block's. */
const BEVEL = 1.6;
/** A cut block's top within this of the block's own top counts as uncut (painted green). */
const FLAT = 0.25;

type P2 = { x: number; z: number };

/**
 * A solid column over a convex plan outline (world x/z): flat bottom at `y0`, top at `top(x, z)` (clamped to at least
 * `y0`), walls down the outline. The top is a `steps`-square grid stretched out from the outline's middle to its
 * edge, and the walls stand on the grid's edge, so they share every point: watertight by construction. Where the top
 * comes all the way down to `y0`, nothing is drawn. Returns the column, and the part of its top still at `flatTop` (to
 * paint). Without `closed`, leaves out the bottom (never seen: it sits on the block or felt below). With `bevel`, the
 * top stops at the `inner` outline and slopes down `drop` from there to the walls, as a block's edges are bevelled.
 */
export function columnGeometry(
  outline: readonly P2[],
  y0: number,
  top: (x: number, z: number) => number,
  flatTop: number,
  { steps = STEPS, closed = true, bevel }: { steps?: number; closed?: boolean; bevel?: { inner: readonly P2[]; drop: number } } = {},
): { body: BufferGeometry; paint: BufferGeometry } {
  const height = (p: P2) => Math.max(y0, top(p.x, p.z));
  // The middle (of the bounding box: a block's outline always reaches its square's sides).
  const xs = outline.map((p) => p.x);
  const zs = outline.map((p) => p.z);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
  const cz = (Math.min(...zs) + Math.max(...zs)) / 2;
  const gridOf = (o: readonly P2[]) => gridFor(o.map((p) => ({ x: p.x - cx, z: p.z - cz })), steps).map((q) => ({ x: cx + q.x, z: cz + q.z }));
  // The top's grid (inside the bevel, if any), and the walls' tops round the outline.
  const grid = gridOf(bevel?.inner ?? outline);
  const outer = bevel ? gridOf(outline) : grid;
  const drop = bevel?.drop ?? 0;
  const at = (i: number, j: number) => grid[j * (steps + 1) + i];
  const pos: number[] = [];
  const uv: number[] = [];
  const paint: number[] = [];
  const paintUv: number[] = [];
  const put = (target: number[], uvs: number[], p: P2, y: number, uu: number, vv: number) => {
    target.push(p.x, y, p.z);
    uvs.push(uu * BEECH_UV_SCALE.x, vv * BEECH_UV_SCALE.y);
  };
  // Is a triangle anticlockwise seen from above (+y)?
  const up = (a: P2, b: P2, c: P2) => (b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x) < 0;
  const heights = grid.map(height);
  const hAt = (i: number, j: number) => heights[j * (steps + 1) + i];
  /** A point of the top; `out`, for one on its edge, is the point on the outline the bevel slopes down to. */
  type V = { p: P2; h: number; flat: boolean; out: P2 };
  const vertex = (i: number, j: number): V => ({ p: at(i, j), h: hAt(i, j), flat: hAt(i, j) > flatTop - FLAT, out: outer[j * (steps + 1) + i] });
  // Where an edge from a point still at the block's top to one in the cut crosses the cut's edge (found on the true
  // surface, so the paint's edge follows it, not the grid). The same for both triangles sharing the edge.
  const crossings = new Map<string, V>();
  const crossing = (flat: V, cut: V): V => {
    const key = `${flat.p.x},${flat.p.z}|${cut.p.x},${cut.p.z}`;
    let v = crossings.get(key);
    if (!v) {
      let lo = 0;
      let hi = 1;
      for (let k = 0; k < 14; k++) {
        const t = (lo + hi) / 2;
        if (top(flat.p.x + (cut.p.x - flat.p.x) * t, flat.p.z + (cut.p.z - flat.p.z) * t) > flatTop - FLAT) lo = t;
        else hi = t;
      }
      const p = { x: flat.p.x + (cut.p.x - flat.p.x) * lo, z: flat.p.z + (cut.p.z - flat.p.z) * lo };
      const out = { x: flat.out.x + (cut.out.x - flat.out.x) * lo, z: flat.out.z + (cut.out.z - flat.out.z) * lo };
      v = { p, h: flatTop, flat: true, out };
      crossings.set(key, v);
    }
    return v;
  };
  /** A piece of the top (a convex polygon, anticlockwise from above), with the bottom under it. */
  const facet = (poly: V[], painted: boolean) => {
    for (let k = 1; k + 1 < poly.length; k++) {
      const [a, b, c] = [poly[0], poly[k], poly[k + 1]];
      if (a.h <= y0 + 1e-3 && b.h <= y0 + 1e-3 && c.h <= y0 + 1e-3) continue;
      put(pos, uv, a.p, a.h, a.p.x, a.p.z);
      put(pos, uv, b.p, b.h, b.p.x, b.p.z);
      put(pos, uv, c.p, c.h, c.p.x, c.p.z);
      if (closed) {
        put(pos, uv, a.p, y0, a.p.x, a.p.z);
        put(pos, uv, c.p, y0, c.p.x, c.p.z);
        put(pos, uv, b.p, y0, b.p.x, b.p.z);
      }
      // Still at the block's top: painted, just above the wood.
      if (painted) {
        put(paint, paintUv, a.p, flatTop + 0.1, a.p.x, a.p.z);
        put(paint, paintUv, b.p, flatTop + 0.1, b.p.x, b.p.z);
        put(paint, paintUv, c.p, flatTop + 0.1, c.p.x, c.p.z);
      }
    }
  };
  const triangle = (a0: V, b0: V, c0: V) => {
    // Anticlockwise from above.
    const tri = up(a0.p, b0.p, c0.p) ? [a0, b0, c0] : [a0, c0, b0];
    const flats = tri.filter((v) => v.flat).length;
    if (flats === 3 || flats === 0) {
      facet(tri, flats === 3);
      return;
    }
    // Split along the cut's edge: the part still at the top, and the part in the cut.
    const flat: V[] = [];
    const cut: V[] = [];
    for (let k = 0; k < 3; k++) {
      const v = tri[k];
      const w = tri[(k + 1) % 3];
      (v.flat ? flat : cut).push(v);
      if (v.flat !== w.flat) {
        const x = v.flat ? crossing(v, w) : crossing(w, v);
        flat.push(x);
        cut.push(x);
      }
    }
    facet(flat, true);
    facet(cut, false);
  };
  for (let j = 0; j < steps; j++) {
    for (let i = 0; i < steps; i++) {
      triangle(vertex(i, j), vertex(i + 1, j), vertex(i + 1, j + 1));
      triangle(vertex(i, j), vertex(i + 1, j + 1), vertex(i, j + 1));
    }
  }
  // Walls: round the grid's edge (the way round that faces them outward), from the bottom up to the top's edge,
  // split where the cut's edge crosses it as the top is.
  const ring: [number, number][] = [];
  for (let i = 0; i < steps; i++) ring.push([i, 0]);
  for (let j = 0; j < steps; j++) ring.push([steps, j]);
  for (let i = steps; i > 0; i--) ring.push([i, steps]);
  for (let j = steps; j > 0; j--) ring.push([0, j]);
  const area = ring.reduce((sum, [i, j], k) => {
    const [i2, j2] = ring[(k + 1) % ring.length];
    return sum + at(i, j).x * at(i2, j2).z - at(i2, j2).x * at(i, j).z;
  }, 0);
  if (area < 0) ring.reverse();
  const edge: V[] = [];
  ring.forEach(([i, j], k) => {
    const v = vertex(i, j);
    const w = vertex(...ring[(k + 1) % ring.length]);
    edge.push(v);
    if (v.flat !== w.flat) edge.push(v.flat ? crossing(v, w) : crossing(w, v));
  });
  let along = 0;
  for (let k = 0; k < edge.length; k++) {
    const v = edge[k];
    const w = edge[(k + 1) % edge.length];
    const p = v.out;
    const q = w.out;
    const hp = Math.max(y0, v.h - drop);
    const hq = Math.max(y0, w.h - drop);
    if (bevel) {
      // The bevel: from the top's edge down and out to the wall, wound as the wall is (the outline its foot).
      const quad = (target: number[], uvs: number[], lift: number) => {
        put(target, uvs, p, hp + lift, p.x, p.z);
        put(target, uvs, w.p, w.h + lift, w.p.x, w.p.z);
        put(target, uvs, q, hq + lift, q.x, q.z);
        put(target, uvs, p, hp + lift, p.x, p.z);
        put(target, uvs, v.p, v.h + lift, v.p.x, v.p.z);
        put(target, uvs, w.p, w.h + lift, w.p.x, w.p.z);
      };
      if (v.h > y0 + 1e-3 || w.h > y0 + 1e-3) {
        quad(pos, uv, 0);
        // And the bottom under it.
        if (closed) {
          put(pos, uv, p, y0, p.x, p.z);
          put(pos, uv, q, y0, q.x, q.z);
          put(pos, uv, w.p, y0, w.p.x, w.p.z);
          put(pos, uv, p, y0, p.x, p.z);
          put(pos, uv, w.p, y0, w.p.x, w.p.z);
          put(pos, uv, v.p, y0, v.p.x, v.p.z);
        }
      }
      if (v.flat && w.flat) quad(paint, paintUv, 0.1);
    }
    const s0 = along;
    const s1 = (along += Math.hypot(q.x - p.x, q.z - p.z));
    // Facing out; a side that comes down to the base is a triangle, not a quad.
    if (hq > y0 + 1e-3) {
      put(pos, uv, p, y0, s0, y0);
      put(pos, uv, q, hq, s1, hq);
      put(pos, uv, q, y0, s1, y0);
    }
    if (hp > y0 + 1e-3) {
      put(pos, uv, p, y0, s0, y0);
      put(pos, uv, p, hp, s0, hp);
      put(pos, uv, q, hq, s1, hq);
    }
  }
  const body = new BufferGeometry();
  body.setAttribute("position", new Float32BufferAttribute(pos, 3));
  body.setAttribute("uv", new Float32BufferAttribute(uv, 2));
  body.computeVertexNormals();
  const paintGeometry = new BufferGeometry();
  paintGeometry.setAttribute("position", new Float32BufferAttribute(paint, 3));
  paintGeometry.setAttribute("uv", new Float32BufferAttribute(paintUv, 2));
  paintGeometry.computeVertexNormals();
  return { body, paint: paintGeometry };
}

const hiddenMatrix = new Matrix4().makeScale(0, 0, 0);
/** Cut blocks' shadows (drawn on the shadow layer only), and their cores. */
const shadowMaterial = new MeshBasicMaterial();
const coreMaterial = new MeshBasicMaterial({ color: CORE_COLOUR });

/** A block cut by a cutting: its column, and the instances it stands in for. */
interface CutBlock {
  key: string;
  meshes: Mesh[];
  refs: BlockInstanceRef[];
}

/**
 * The hills' blocks with ramps' cuttings in them: each cut block drawn as its own column (its instance hidden), with
 * its top following `HillShape`'s ground. Also the hills' dark core and shadow, which leave the cut blocks out (a
 * cut block's core is lowered under the cut; its column casts its own shadow). Only blocks whose cuts change are
 * rebuilt.
 */
export class HillCutsView {
  readonly group = new Group();
  private built = new Map<string, CutBlock>();
  private solids: Mesh[] = [];
  private solidsFor: string | null = null;
  /** The blocks the layout's cuttings cut, and how (at the last sync without a held ramp). */
  private settled = new Map<string, string>();

  constructor(
    private readonly grid: LandscapeGrid,
    private readonly materials: { wood: Material; top: Material },
    private readonly index: Map<string, BlockInstanceRef[]>,
  ) {
    this.sync();
  }

  /** Show the cuttings in force on the map's `HillShape`, and an extra one (a ramp being held), if given. */
  sync(extra?: HillCut): void {
    const hills = hillsOf(this.grid);
    const g = this.grid;
    // While a ramp is held, blocks it cuts are drawn coarser (quick to rebuild as it moves), and redrawn fine when it's
    // put down. (Blocks only the layout's cuttings cut are as they were at the last sync without one.)
    const wanted = new Map<string, { col: number; row: number; level: number; key: string; coarse: boolean }>();
    for (const b of hills.cutBlocks(extra)) {
      const id = `${b.col},${b.row},${b.level}`;
      const coarse = !!extra && this.settled.get(id) !== b.key;
      wanted.set(id, { ...b, key: coarse ? `~${b.key}` : b.key, coarse });
    }
    if (!extra) this.settled = new Map([...wanted].map(([id, b]) => [id, b.key]));
    // Blocks no longer cut, or cut differently: put back.
    for (const [id, entry] of this.built) {
      if (wanted.get(id)?.key === entry.key) continue;
      for (const m of entry.meshes) {
        this.group.remove(m);
        m.geometry.dispose();
        if ((m as InstancedMesh).isInstancedMesh) (m as InstancedMesh).dispose();
      }
      for (const ref of entry.refs) {
        ref.mesh.setMatrixAt(ref.i, ref.matrix);
        ref.mesh.instanceMatrix.needsUpdate = true;
      }
      this.built.delete(id);
    }
    for (const [id, b] of wanted) {
      if (this.built.has(id)) continue;
      const { body, paint, isTop, surface, cx, cz } = cutColumn(g, b, extra, { steps: b.coarse ? PREVIEW_STEPS : STEPS, closed: false });
      const refs = this.index.get(blockKey(cx, cz, b.level * RISER_HEIGHT)) ?? [];
      const wood = toned(body, this.materials.wood, refs[0]);
      wood.receiveShadow = true;
      const shadow = new Mesh(body, shadowMaterial);
      shadow.castShadow = true;
      shadow.layers.set(SHADOW_PROXY_LAYER);
      const meshes: Mesh[] = [wood, shadow];
      if (isTop && paint.getAttribute("position").count > 0) {
        const grass = toned(paint, this.materials.top, refs[1]);
        grass.receiveShadow = true;
        meshes.push(grass);
      } else paint.dispose();
      const core = lowCore(cx, cz, b.level * RISER_HEIGHT, surface);
      if (core) meshes.push(core);
      for (const m of meshes) this.group.add(m);
      for (const ref of refs) {
        ref.mesh.setMatrixAt(ref.i, hiddenMatrix);
        ref.mesh.instanceMatrix.needsUpdate = true;
      }
      this.built.set(id, { key: b.key, meshes, refs });
    }
    // The map's core and shadow change only when which blocks are cut does.
    const ids = [...this.built.keys()].sort().join(";");
    if (ids !== this.solidsFor) this.buildSolids();
  }

  /** The hills' dark core and shadow, around the blocks cut now. */
  private buildSolids(): void {
    for (const m of this.solids) {
      this.group.remove(m);
      m.geometry.dispose();
      (m.material as Material).dispose();
    }
    this.solids = [];
    const cut = (c: number, r: number, level: number) => this.built.has(`${c},${r},${level}`);
    const core = hillCore(mergeSlabsWhere((c, r, level) => this.grid.height[this.grid.index(c, r)] >= level && !cut(c, r, level - 1), COLS, ROWS, -MAT_WIDTH / 2, -MAT_DEPTH / 2, CELL, MAX_HEIGHT));
    const pieces = hillPieces(this.grid, cut);
    const proxy = shadowProxy(pieces.slabs, pieces.round);
    for (const m of [core, proxy]) {
      if (!m) continue;
      this.solids.push(m);
      this.group.add(m);
    }
    this.solidsFor = [...this.built.keys()].sort().join(";");
  }

  dispose(): void {
    for (const b of this.built.values()) for (const m of b.meshes) m.geometry.dispose();
    for (const m of this.solids) {
      m.geometry.dispose();
      (m.material as Material).dispose();
    }
  }
}

/** The top's grid for an outline (around its middle), by outline: blocks share a few shapes, so each is worked out once. */
const grids = new Map<string, P2[]>();

/**
 * Grid point (i, j), 0..steps each way, at `j * (steps + 1) + i`: the square's grid, each point pushed out along its
 * heading so the square's edge lands on the outline.
 */
function gridFor(outline: readonly P2[], steps: number): P2[] {
  const key = `${steps}:${outline.map((p) => `${p.x.toFixed(3)},${p.z.toFixed(3)}`).join(";")}`;
  let grid = grids.get(key);
  if (grid) return grid;
  /** Distance from the middle to the outline, heading (dx, dz) (a unit vector). */
  const reach = (dx: number, dz: number): number => {
    let best = Infinity;
    for (let i = 0; i < outline.length; i++) {
      const a = outline[i];
      const b = outline[(i + 1) % outline.length];
      const ex = b.x - a.x;
      const ez = b.z - a.z;
      const den = dx * ez - dz * ex;
      if (Math.abs(den) < 1e-12) continue;
      const t = (a.x * ez - a.z * ex) / den;
      const u = (a.x * dz - a.z * dx) / den;
      if (t > 0 && u >= -1e-9 && u <= 1 + 1e-9) best = Math.min(best, t);
    }
    return best;
  };
  grid = [];
  for (let j = 0; j <= steps; j++) {
    for (let i = 0; i <= steps; i++) {
      const u = (2 * i) / steps - 1;
      const v = (2 * j) / steps - 1;
      const s = Math.max(Math.abs(u), Math.abs(v));
      if (s === 0) {
        grid.push({ x: 0, z: 0 });
        continue;
      }
      const len = Math.hypot(u, v);
      const r = s * reach(u / len, v / len);
      grid.push({ x: (u / len) * r, z: (v / len) * r });
    }
  }
  grids.set(key, grid);
  return grid;
}

/** A block (level 0 on the felt) as cut by the cuttings (and an extra one): its column and painted top. */
export function cutColumn(g: LandscapeGrid, b: { col: number; row: number; level: number }, extra?: HillCut, options?: { steps?: number; closed?: boolean }) {
  const hills = hillsOf(g);
  const cx = g.centreX(b.col);
  const cz = g.centreZ(b.row);
  const y0 = b.level * RISER_HEIGHT + GAP / 2;
  const blockTop = (b.level + 1) * RISER_HEIGHT - GAP / 2;
  const isTop = g.height[g.index(b.col, b.row)] === b.level + 1;
  const corners = hills.blockCorners(b.col, b.row, b.level);
  const outline = blockOutline(corners, GAP / 2, 8).map((p) => ({ x: cx + p.x, z: cz + p.z }));
  const inner = blockOutline(corners, GAP / 2 + BEVEL, 8).map((p) => ({ x: cx + p.x, z: cz + p.z }));
  const surface = (x: number, z: number) => Math.min(blockTop, hills.cutSurfaceAt(x, z, extra));
  return { ...columnGeometry(outline, y0, surface, blockTop, { ...options, bevel: { inner, drop: BEVEL } }), isTop, surface, cx, cz };
}

/** A cut block's column, in the tone of the block (instance) it stands in for: one instance, coloured as that was. */
function toned(geometry: BufferGeometry, material: Material, like: BlockInstanceRef | undefined): Mesh {
  const mesh = new InstancedMesh(geometry, material, 1);
  mesh.setMatrixAt(0, new Matrix4());
  if (like?.mesh.instanceColor) {
    const colour = new Color();
    like.mesh.getColorAt(like.i, colour);
    mesh.setColorAt(0, colour);
  }
  return mesh;
}

/** A cut block's core: as high as it can be while staying a core's inset under the cut everywhere above it. */
function lowCore(x: number, z: number, y0: number, surface: (x: number, z: number) => number): Mesh | null {
  const half = CELL / 2 - CORE_INSET;
  let low = Infinity;
  const n = 12;
  for (let i = 0; i <= n; i++) for (let j = 0; j <= n; j++) low = Math.min(low, surface(x - half + (2 * half * i) / n, z - half + (2 * half * j) / n));
  // Samples a few mm apart on a bank as steep as 60° could miss a dip of up to about 4 mm: keep that much further down.
  const y1 = low - 4 - CORE_INSET;
  if (y1 < y0 + 1) return null;
  const g = new BoxGeometry(CELL - 2 * CORE_INSET, y1 - (y0 - CORE_INSET), CELL - 2 * CORE_INSET);
  g.translate(x, (y0 - CORE_INSET + y1) / 2, z);
  return new Mesh(g, coreMaterial);
}

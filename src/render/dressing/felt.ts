import { ExtrudeGeometry, Group, Mesh, Path, PlaneGeometry, Shape, ShapeGeometry, Vector2, type BufferGeometry, type Material } from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { CELL, PLOT_DEPTH, PLOT_WIDTH, type LandscapeGrid, type PlotCoord, type Rect } from "../../landscape";
import { insideLoops, loopArea, smoothLoop, traceRegions, type Loop, type LoopPoint } from "../../landscape/outline";
import { setCullBox, TILE_DEPTH, TILE_WIDTH, tileAt } from "./tiles";
import { FELT_TILE, type Materials } from "../materials";

/** The felt ground runs this far (mm) past the mat on every side: well into the total haze. */
const GROUND_REACH = 4000;
const HEM_INSET = 14;
const HEM_WIDTH = 9;
const STITCH_LENGTH = 9;

/**
 * The felt ground: one sheet running from the land out under the scenery into the haze, with a darker bound hem and a
 * running stitch marking the edge of the land that can be built on (the owned plots, `plots`).
 */
export function buildFeltGround(mats: Materials, land: Rect, plots: readonly PlotCoord[]): Group {
  const group = new Group();
  const w = land.x1 - land.x0 + 2 * GROUND_REACH;
  const d = land.z1 - land.z0 + 2 * GROUND_REACH;
  const sheet = new PlaneGeometry(w, d);
  sheet.rotateX(-Math.PI / 2);
  sheet.translate((land.x0 + land.x1) / 2, 0, (land.z0 + land.z1) / 2);
  // Felt tiles in mm, like the river and road ribbons.
  const uv = sheet.getAttribute("uv");
  for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) * w) / FELT_TILE, (uv.getY(i) * d) / FELT_TILE);
  const ground = new Mesh(sheet, mats.felt);
  ground.receiveShadow = true;
  group.add(ground);

  // Hem: a strip just inside each edge of the land's outline, a hair above the surface, each with a stitch line down
  // its middle. Strips along x run on over the corners, those along z stop short, so each corner is covered once.
  const hem: BufferGeometry[] = [];
  const stitches: BufferGeometry[] = [];
  const strip = (cx: number, cz: number, length: number, alongX: boolean) => {
    const h = new PlaneGeometry(length, HEM_WIDTH);
    const s = new PlaneGeometry(length, 4);
    const uv = s.getAttribute("uv");
    for (let i = 0; i < uv.count; i++) uv.setX(i, uv.getX(i) * (length / STITCH_LENGTH));
    for (const [g, y] of [[h, 0.25], [s, 0.4]] as const) {
      g.rotateX(-Math.PI / 2);
      if (!alongX) g.rotateY(Math.PI / 2);
      g.translate(cx, y, cz);
    }
    hem.push(h);
    stitches.push(s);
  };
  for (const loop of hemOutline(plots, HEM_INSET)) {
    for (let i = 0; i < loop.length; i++) {
      const a = loop[i];
      const b = loop[(i + 1) % loop.length];
      const alongX = Math.abs(b.x - a.x) > Math.abs(b.z - a.z);
      const length = Math.abs(b.x - a.x) + Math.abs(b.z - a.z) + (alongX ? HEM_WIDTH : -HEM_WIDTH);
      if (length > 0) strip((a.x + b.x) / 2, (a.z + b.z) / 2, length, alongX);
    }
  }
  if (hem.length > 0) {
    const hemMesh = new Mesh(mergeGeometries(hem), mats.hemFelt);
    hemMesh.receiveShadow = true;
    const stitchMesh = new Mesh(mergeGeometries(stitches), mats.stitch);
    stitchMesh.receiveShadow = true;
    group.add(hemMesh, stitchMesh);
  }
  for (const g of [...hem, ...stitches]) g.dispose();
  return group;
}

/**
 * The outline of a set of plots (world mm), each corner moved `inset` in from the edge: one loop per outline (and
 * per hole), with only its corners.
 */
export function hemOutline(plots: readonly PlotCoord[], inset: number): { x: number; z: number }[][] {
  if (plots.length === 0) return [];
  const px0 = Math.min(...plots.map((p) => p.px));
  const pz0 = Math.min(...plots.map((p) => p.pz));
  const pw = Math.max(...plots.map((p) => p.px)) - px0 + 1;
  const ph = Math.max(...plots.map((p) => p.pz)) - pz0 + 1;
  const have = new Set(plots.map((p) => `${p.px - px0},${p.pz - pz0}`));
  const loops = traceRegions((c, r) => have.has(`${c},${r}`), pw, ph);
  return loops.map((loop) => {
    // Corners only: drop points along a straight run.
    const pts = loop.filter((p, i) => {
      const a = loop[(i + loop.length - 1) % loop.length];
      const b = loop[(i + 1) % loop.length];
      return (p.x - a.x) * (b.z - p.z) - (p.z - a.z) * (b.x - p.x) !== 0;
    });
    // Each edge moves in along its inward normal (the region is on the right of the walk): a corner moves by both.
    return pts.map((p, i) => {
      const a = pts[(i + pts.length - 1) % pts.length];
      const b = pts[(i + 1) % pts.length];
      const n1 = inward(a, p);
      const n2 = inward(p, b);
      return { x: (px0 + p.x) * PLOT_WIDTH + (n1.x + n2.x) * inset, z: (pz0 + p.z) * PLOT_DEPTH + (n1.z + n2.z) * inset };
    });
  });
}

function inward(a: { x: number; z: number }, b: { x: number; z: number }): { x: number; z: number } {
  const len = Math.hypot(b.x - a.x, b.z - a.z) || 1;
  return { x: -(b.z - a.z) / len, z: (b.x - a.x) / len };
}

/** One region of felt's top alone, flat at `thickness` above the mat (for far off: see `buildFeltTiles`). */
function flatFelt(outer: Loop, holes: readonly Loop[], thickness: number): BufferGeometry {
  const toPts = (l: Loop) => l.map((p) => new Vector2(p.x * CELL, -(p.z * CELL)));
  const shape = new Shape(toPts(outer));
  for (const hole of holes) shape.holes.push(new Path(toPts(hole)));
  const g = new ShapeGeometry(shape);
  g.rotateX(-Math.PI / 2);
  g.translate(0, thickness - 0.2, 0);
  const uv = g.getAttribute("uv");
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) / FELT_TILE, uv.getY(i) / FELT_TILE);
  return g;
}

/** One region of felt: its outline and holes (in squares) extruded `thickness` tall, uv in felt tiles. */
function extrudeFelt(outer: Loop, holes: readonly Loop[], thickness: number, bevel: number): BufferGeometry {
  // Shape space is (world x, −world z): extruding along +z then rotating −90° about x stands it on the mat.
  const toPts = (l: Loop) => l.map((p) => ({ x: p.x * CELL, y: -(p.z * CELL) }));
  const shape = new Shape();
  const pts = toPts(outer);
  shape.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) shape.lineTo(pts[i].x, pts[i].y);
  for (const hole of holes) {
    const hp = toPts(hole);
    const path = new Path();
    path.moveTo(hp[0].x, hp[0].y);
    for (let i = 1; i < hp.length; i++) path.lineTo(hp[i].x, hp[i].y);
    shape.holes.push(path);
  }
  const g = new ExtrudeGeometry(shape, {
    depth: thickness - 2 * bevel,
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 2,
  });
  g.rotateX(-Math.PI / 2);
  g.translate(0, bevel - 0.2, 0);
  const uv = g.getAttribute("uv");
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) / FELT_TILE, uv.getY(i) / FELT_TILE);
  return g;
}

/** How far (squares) past its tile a tile's felt is traced, so smoothing near its edge comes out as if traced whole. */
const TILE_MARGIN = 8;

/** One tile's felt as built: what it was built from (a hash of the squares it was traced over), and its mesh. */
interface FeltTile {
  key: number;
  geometry: BufferGeometry | null;
  /** Far off: just the felt's top, flat (a fraction of the triangles). */
  flat: BufferGeometry | null;
}
/** Felt by tile (see `buildFeltTiles`), kept between builds. */
export type FeltTiles = Map<number, FeltTile>;

/**
 * Felt cut-outs for every region of cells with one of `surfaces` on some grids (the land, and land shown around it),
 * a mesh per tile (see `tiles.ts`) so the camera skips tiles out of view, and a river running across the whole world
 * costs no more to draw close up than a pond. Each tile is traced over its own squares and a margin round them, smoothed,
 * and cut back to the tile, so its felt meets its neighbours' as if traced whole. A tile is extruded again only when
 * the squares it was traced over change (kept in `cache`). `thickness(surface)` is each surface's height.
 */
export function buildFeltTiles(
  grids: readonly LandscapeGrid[],
  surfaces: readonly number[],
  material: Material,
  thickness: (surface: number) => number,
  cache: FeltTiles,
): Group {
  const group = new Group();
  const tileCols = TILE_WIDTH / CELL;
  const tileRows = TILE_DEPTH / CELL;
  const at = (col: number, row: number): number => {
    for (const g of grids) {
      const i = g.index(col, row);
      if (i !== -1) return g.surface[i];
    }
    return -1;
  };
  // The tiles any of these surfaces is in.
  const tiles = new Map<number, { tc: number; tr: number }>();
  for (const g of grids) {
    g.forEachCell((i, col, row) => {
      if (!surfaces.includes(g.surface[i])) return;
      const tc = Math.floor(col / tileCols);
      const tr = Math.floor(row / tileRows);
      tiles.set(tileAt(tc * TILE_WIDTH, tr * TILE_DEPTH), { tc, tr });
    });
  }
  const used = new Set<number>();
  for (const [id, { tc, tr }] of tiles) {
    used.add(id);
    const col0 = tc * tileCols - TILE_MARGIN;
    const row0 = tr * tileRows - TILE_MARGIN;
    const w = tileCols + 2 * TILE_MARGIN;
    const d = tileRows + 2 * TILE_MARGIN;
    // What this tile's felt is made from: which surface each square of the window has.
    const window = new Int8Array(w * d);
    let key = 0x811c9dc5;
    for (let r = 0; r < d; r++) {
      for (let c = 0; c < w; c++) {
        const s = at(col0 + c, row0 + r);
        const k = surfaces.indexOf(s);
        window[r * w + c] = k;
        key = Math.imul(key ^ (k + 2), 0x01000193);
      }
    }
    let tile = cache.get(id);
    if (!tile || tile.key !== key) {
      tile?.geometry?.dispose();
      tile?.flat?.dispose();
      const parts: BufferGeometry[] = [];
      const flats: BufferGeometry[] = [];
      surfaces.forEach((surface, k) => {
        const loops = traceRegions((c, r) => window[r * w + c] === k, w, d).map((l) => {
          // A loop cut off by the window's edge continues beyond it: smooth it fully, as the whole world's would be.
          const cut = l.some((p) => p.x <= 0 || p.z <= 0 || p.x >= w || p.z >= d);
          return smoothLoop(l, 8, 2, cut).map((p) => ({ x: col0 + p.x, z: row0 + p.z }));
        });
        const x0 = tc * tileCols;
        const z0 = tr * tileRows;
        const clipped = loops.map((l) => clipLoop(l, x0, z0, x0 + tileCols, z0 + tileRows)).filter((l) => l.length >= 3);
        const outers = clipped.filter((l) => loopArea(l) > 0);
        const holes = clipped.filter((l) => loopArea(l) < 0);
        const t = thickness(surface);
        for (const outer of outers) {
          const inside = holes.filter((h) => insideLoops([outer], h[0].x, h[0].z));
          parts.push(extrudeFelt(outer, inside, t, Math.min(0.6, t / 3)));
          flats.push(flatFelt(outer, inside, t));
        }
      });
      const merge = (list: BufferGeometry[]) => {
        const g = list.length === 0 ? null : list.length === 1 ? list[0] : mergeGeometries(list);
        if (list.length > 1) for (const p of list) p.dispose();
        return g;
      };
      cache.set(id, (tile = { key, geometry: merge(parts), flat: merge(flats) }));
    }
    if (!tile.geometry || !tile.flat) continue;
    // Close up, the felt as cut and stitched; far off, just its top (see `cullTiles`). The cache owns the geometry: the
    // meshes mustn't free it.
    const near = new Mesh(tile.geometry, material);
    const far = new Mesh(tile.flat, material);
    far.visible = false;
    const both = new Group();
    for (const m of [near, far]) {
      m.receiveShadow = true;
      m.userData.sharedGeometry = true;
      both.add(m);
    }
    both.userData.lod = { near, far };
    setCullBox(both, [{ x: tc * TILE_WIDTH, z: tr * TILE_DEPTH }, { x: (tc + 1) * TILE_WIDTH, z: (tr + 1) * TILE_DEPTH }], 4);
    group.add(both);
  }
  for (const [id, tile] of cache) {
    if (used.has(id)) continue;
    tile.geometry?.dispose();
    tile.flat?.dispose();
    cache.delete(id);
  }
  return group;
}

/** Cut a loop back to a rectangle (Sutherland–Hodgman: where it leaves and comes back, it runs along the edge). */
export function clipLoop(loop: Loop, x0: number, z0: number, x1: number, z1: number): Loop {
  let pts = loop;
  const edges: [(p: LoopPoint) => boolean, (a: LoopPoint, b: LoopPoint) => LoopPoint][] = [
    [(p) => p.x >= x0, (a, b) => ({ x: x0, z: a.z + ((b.z - a.z) * (x0 - a.x)) / (b.x - a.x) })],
    [(p) => p.x <= x1, (a, b) => ({ x: x1, z: a.z + ((b.z - a.z) * (x1 - a.x)) / (b.x - a.x) })],
    [(p) => p.z >= z0, (a, b) => ({ x: a.x + ((b.x - a.x) * (z0 - a.z)) / (b.z - a.z), z: z0 })],
    [(p) => p.z <= z1, (a, b) => ({ x: a.x + ((b.x - a.x) * (z1 - a.z)) / (b.z - a.z), z: z1 })],
  ];
  for (const [inside, cross] of edges) {
    const out: Loop = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[(i + pts.length - 1) % pts.length];
      const b = pts[i];
      if (inside(b)) {
        if (!inside(a)) out.push(cross(a, b));
        out.push(b);
      } else if (inside(a)) out.push(cross(a, b));
    }
    pts = out;
    if (pts.length === 0) break;
  }
  return pts;
}

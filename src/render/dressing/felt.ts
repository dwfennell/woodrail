import { ExtrudeGeometry, Group, Mesh, Path, PlaneGeometry, Shape, type BufferGeometry, type Material } from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { CELL, PLOT_DEPTH, PLOT_WIDTH, type LandscapeGrid, type PlotCoord, type Rect } from "../../landscape";
import { insideLoops, loopArea, smoothLoop, traceRegions, type Loop } from "../../landscape/outline";
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

/** Extruded felt by outline (a hash of its points), kept between builds so only outlines that change are made again. */
export type FeltCache = Map<number, BufferGeometry>;

/**
 * Felt cut-outs for every region of cells with surface `surface` (rivers, roads) on some grids (the land, and land
 * shown around it): one extruded mesh whose outlines follow the cells with rounded corners, traced across all of them
 * at once so the felt runs on over the grids' edges. The top sits at `thickness` above the mat. With a `cache`, each
 * region's felt is extruded only if its outline is new (the cache keeps just the regions drawn now).
 */
export function buildFeltRibbons(
  grids: readonly LandscapeGrid[],
  surface: number,
  material: Material,
  thickness: number,
  cache: FeltCache = new Map(),
): Mesh | null {
  let col0 = Infinity;
  let row0 = Infinity;
  let col1 = -Infinity;
  let row1 = -Infinity;
  for (const g of grids) {
    if (g.plots.length === 0) continue;
    const e = g.extent();
    col0 = Math.min(col0, e.col0);
    row0 = Math.min(row0, e.row0);
    col1 = Math.max(col1, e.col1);
    row1 = Math.max(row1, e.row1);
  }
  const used = new Map<number, BufferGeometry>();
  const finish = () => {
    for (const [key, g] of cache) if (!used.has(key)) g.dispose();
    cache.clear();
    for (const [key, g] of used) cache.set(key, g);
  };
  if (!Number.isFinite(col0)) {
    finish();
    return null;
  }
  const mask = (c: number, r: number) => {
    for (const g of grids) {
      const i = g.index(col0 + c, row0 + r);
      if (i !== -1) return g.surface[i] === surface;
    }
    return false;
  };
  const loops = traceRegions(mask, col1 - col0, row1 - row0).map((l) => smoothLoop(l).map((p) => ({ x: col0 + p.x, z: row0 + p.z })));
  const outers = loops.filter((l) => loopArea(l) > 0);
  const holes = loops.filter((l) => loopArea(l) <= 0);
  const bevel = Math.min(0.6, thickness / 3);
  const parts: BufferGeometry[] = [];
  for (const outer of outers) {
    const mine = holes.filter((hole) => insideLoops([outer], hole[0].x, hole[0].z));
    const key = loopsHash([outer, ...mine], thickness);
    let g = cache.get(key) ?? used.get(key);
    if (!g) g = extrudeFelt(outer, mine, thickness, bevel);
    used.set(key, g);
    parts.push(g);
  }
  finish();
  if (parts.length === 0) return null;
  const mesh = new Mesh(parts.length === 1 ? parts[0].clone() : mergeGeometries(parts), material);
  mesh.receiveShadow = true;
  return mesh;
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

/** A hash of some loops' points (to a thousandth of a square) and a thickness. */
function loopsHash(loops: readonly Loop[], thickness: number): number {
  let h = Math.imul(0x811c9dc5 ^ Math.round(thickness * 100), 0x01000193);
  for (const loop of loops) {
    h = Math.imul(h ^ loop.length, 0x01000193);
    for (const p of loop) {
      h = Math.imul(h ^ Math.round(p.x * 1000), 0x01000193);
      h = Math.imul(h ^ Math.round(p.z * 1000), 0x01000193);
    }
  }
  return h >>> 0;
}

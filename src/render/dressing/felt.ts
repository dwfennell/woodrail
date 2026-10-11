import { ExtrudeGeometry, Group, Mesh, Path, PlaneGeometry, Shape, type BufferGeometry, type Material } from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { CELL, COLS, MAT_DEPTH, MAT_WIDTH, ROWS, type LandscapeGrid } from "../../landscape";
import { insideLoops, loopArea, smoothLoop, traceRegions, type Loop } from "../../landscape/outline";
import { FELT_TILE, type Materials } from "../materials";

/** The felt ground runs this far (mm) past the mat on every side: well into the total haze. */
const GROUND_REACH = 4000;
const HEM_INSET = 14;
const HEM_WIDTH = 9;
const STITCH_LENGTH = 9;

/**
 * The felt ground: one sheet running from the mat out under the scenery into the haze, with a darker bound hem and a
 * running stitch marking the edge of the buildable mat.
 */
export function buildFeltGround(mats: Materials): Group {
  const group = new Group();
  const w = MAT_WIDTH + 2 * GROUND_REACH;
  const d = MAT_DEPTH + 2 * GROUND_REACH;
  const sheet = new PlaneGeometry(w, d);
  sheet.rotateX(-Math.PI / 2);
  // Felt tiles in mm, like the river and road ribbons.
  const uv = sheet.getAttribute("uv");
  for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) * w) / FELT_TILE, (uv.getY(i) * d) / FELT_TILE);
  const ground = new Mesh(sheet, mats.felt);
  ground.receiveShadow = true;
  group.add(ground);

  // Hem: four strips just inside the edge, a hair above the surface, each with a stitch line down its middle.
  const hem: BufferGeometry[] = [];
  const stitches: BufferGeometry[] = [];
  const hw = MAT_WIDTH / 2 - HEM_INSET;
  const hd = MAT_DEPTH / 2 - HEM_INSET;
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
  strip(0, -hd, 2 * hw + HEM_WIDTH, true);
  strip(0, hd, 2 * hw + HEM_WIDTH, true);
  strip(-hw, 0, 2 * hd - HEM_WIDTH, false);
  strip(hw, 0, 2 * hd - HEM_WIDTH, false);
  const hemMesh = new Mesh(mergeGeometries(hem), mats.hemFelt);
  hemMesh.receiveShadow = true;
  const stitchMesh = new Mesh(mergeGeometries(stitches), mats.stitch);
  stitchMesh.receiveShadow = true;
  group.add(hemMesh, stitchMesh);
  for (const g of [...hem, ...stitches]) g.dispose();
  return group;
}

const X0 = -MAT_WIDTH / 2;
const Z0 = -MAT_DEPTH / 2;

/**
 * Felt cut-outs for every region of cells with surface `surface` (rivers, roads): one extruded mesh whose outlines
 * follow the cells with rounded corners. The top sits at `thickness` above the mat.
 */
export function buildFeltRibbons(grid: LandscapeGrid, surface: number, material: Material, thickness: number): Mesh | null {
  const mask = (c: number, r: number) => grid.inBounds(c, r) && grid.surface[grid.index(c, r)] === surface;
  const loops = traceRegions(mask, COLS, ROWS).map((l) => smoothLoop(l));
  if (loops.length === 0) return null;
  const outers = loops.filter((l) => loopArea(l) > 0);
  const holes = loops.filter((l) => loopArea(l) <= 0);
  // Shape space is (world x, −world z): extruding along +z then rotating −90° about x stands it on the mat.
  const toPts = (l: Loop) => l.map((p) => ({ x: X0 + p.x * CELL, y: -(Z0 + p.z * CELL) }));
  const shapes = outers.map((outer) => {
    const shape = new Shape();
    const pts = toPts(outer);
    shape.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) shape.lineTo(pts[i].x, pts[i].y);
    for (const hole of holes) {
      if (!insideLoops([outer], hole[0].x, hole[0].z)) continue;
      const hp = toPts(hole);
      const path = new Path();
      path.moveTo(hp[0].x, hp[0].y);
      for (let i = 1; i < hp.length; i++) path.lineTo(hp[i].x, hp[i].y);
      shape.holes.push(path);
    }
    return shape;
  });
  const bevel = Math.min(0.6, thickness / 3);
  const g = new ExtrudeGeometry(shapes, {
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
  const mesh = new Mesh(g, material);
  mesh.receiveShadow = true;
  return mesh;
}

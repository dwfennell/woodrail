import { Vector3, type Mesh } from "three";
import { describe, expect, it } from "vitest";
import { loadModelSet, type ModelSet } from "./blender-models";

/**
 * No model has two parts of different materials with faces in one plane, facing the same way, over each other: the
 * depth buffer can't tell which is in front, so the two fight for the pixels, drawn as a patchwork of triangles that
 * shifts as the camera moves (the mine's rock hill, 2026-11-07: three blocks' backs in one plane, in three greys).
 * Step one in or out a millimetre or so in tools/blender/ and export the set again (`npm run models`).
 *
 * Looked at: flat triangles facing along x, y or z (a toy's boxes and slabs; a slope or a curve isn't). Faces looking
 * down are skipped: they sit on the floor, never seen.
 */

const SETS: ModelSet[] = ["trains", "life", "buildings", "dressing", "industry", "floors", "grand"];
/** Two faces this close (mm) count as in one plane. */
const SAME_PLANE = 0.05;
/** Two parts' faces overlapping by less than this much in all (mm²) are a seam or a sliver, not a fight. */
const MIN_AREA = 1;
/** Pairs allowed, as "<model>: <material> & <material>", each with its reason. (None.) */
const ALLOWED = new Map<string, string>();

interface Face {
  material: string;
  plane: number;
  /** In the plane: the triangle's corners (the two other axes). */
  pts: [number, number][];
}

type Pt = [number, number];

/** Twice the signed area of a polygon. */
function area2(p: Pt[]): number {
  let s = 0;
  for (let i = 0; i < p.length; i++) s += p[i][0] * p[(i + 1) % p.length][1] - p[(i + 1) % p.length][0] * p[i][1];
  return s;
}

/** The area two triangles in one plane share (mm²): one clipped by the other's edges (both convex). */
function overlapArea(a: Pt[], b: Pt[]): number {
  // (The clipping triangle wound anticlockwise: its inside to the left of each edge.)
  const clipper = area2(b) < 0 ? [...b].reverse() : b;
  let poly: Pt[] = a;
  for (let i = 0; i < 3 && poly.length > 0; i++) {
    const [x0, y0] = clipper[i];
    const [x1, y1] = clipper[(i + 1) % 3];
    const side = ([x, y]: Pt) => (x1 - x0) * (y - y0) - (y1 - y0) * (x - x0);
    const out: Pt[] = [];
    for (let j = 0; j < poly.length; j++) {
      const p = poly[j];
      const q = poly[(j + 1) % poly.length];
      const sp = side(p);
      const sq = side(q);
      if (sp >= 0) out.push(p);
      if (sp >= 0 !== sq >= 0) {
        const t = sp / (sp - sq);
        out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]);
      }
    }
    poly = out;
  }
  return poly.length < 3 ? 0 : Math.abs(area2(poly)) / 2;
}

/** A model's parts' faces in one plane, over each other: the area each pair of materials shares, by "<a> & <b> <±axis>=<plane>". */
function coplanarFaces(model: { traverse(f: (o: unknown) => void): void; updateMatrixWorld(force?: boolean): void }): Map<string, number> {
  model.updateMatrixWorld(true);
  const planes = new Map<string, Face[]>();
  const a = new Vector3();
  const b = new Vector3();
  const c = new Vector3();
  const n = new Vector3();
  model.traverse((o) => {
    const m = o as Mesh;
    if (!m.isMesh || Array.isArray(m.material)) return;
    const g = m.geometry;
    const pos = g.getAttribute("position");
    const idx = g.index;
    const count = idx ? idx.count : pos.count;
    for (let t = 0; t < count; t += 3) {
      const at = (k: number) => (idx ? idx.getX(t + k) : t + k);
      a.fromBufferAttribute(pos, at(0)).applyMatrix4(m.matrixWorld);
      b.fromBufferAttribute(pos, at(1)).applyMatrix4(m.matrixWorld);
      c.fromBufferAttribute(pos, at(2)).applyMatrix4(m.matrixWorld);
      n.subVectors(b, a).cross(c.clone().sub(a));
      if (n.length() < 1e-6) continue;
      n.normalize();
      const axis = (["x", "y", "z"] as const).find((k) => Math.abs(n[k]) > 0.999);
      if (!axis || (axis === "y" && n.y < 0)) continue;
      const [u, v] = (["x", "y", "z"] as const).filter((k) => k !== axis);
      const plane = (a[axis] + b[axis] + c[axis]) / 3;
      const key = `${n[axis] > 0 ? "+" : "-"}${axis}=${Math.round(plane / SAME_PLANE)}`;
      let list = planes.get(key);
      if (!list) planes.set(key, (list = []));
      list.push({
        material: m.material.name,
        plane,
        pts: [a, b, c].map((p) => [p[u], p[v]] as Pt),
      });
    }
  });
  const shared = new Map<string, number>();
  for (const [key, faces] of planes) {
    // (This bucket's pairs once each, and its faces with the next bucket up's: two faces SAME_PLANE apart can round
    // to either side of a bucket's edge.)
    const [head, step] = key.split("=");
    const above = planes.get(`${head}=${Number(step) + 1}`) ?? [];
    for (let i = 0; i < faces.length; i++) {
      const f = faces[i];
      for (const g of [...faces.slice(i + 1), ...above]) {
        if (g.material === f.material || Math.abs(g.plane - f.plane) > SAME_PLANE) continue;
        const area = overlapArea(f.pts, g.pts);
        if (area <= 0) continue;
        const pair = `${[f.material, g.material].sort().join(" & ")} ${head}=${f.plane.toFixed(1)}`;
        shared.set(pair, (shared.get(pair) ?? 0) + area);
      }
    }
  }
  return shared;
}

describe("models: no two parts' faces in one plane", () => {
  for (const set of SETS) {
    it(`${set}: none fight for the same pixels`, async () => {
      const models = await loadModelSet(set);
      const fights: string[] = [];
      for (const [id, model] of models) {
        for (const [pair, area] of coplanarFaces(model)) {
          if (area < MIN_AREA || ALLOWED.has(`${id}: ${pair.replace(/ [+-][xyz]=.*$/, "")}`)) continue;
          fights.push(`${id}: ${pair} (${area.toFixed(1)} mm² shared)`);
        }
      }
      expect(fights).toEqual([]);
    }, 120_000);
  }
});

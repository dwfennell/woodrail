import { BufferAttribute, Vector3, type BufferGeometry } from "three";
import { ConvexGeometry } from "three/examples/jsm/geometries/ConvexGeometry.js";

/**
 * A box w × h × d (centred) with every edge and corner bevelled flat by `r`: 44 triangles, against 108 for a
 * one-segment rounded box, and it catches the light much the same. Each face gets 0..1 texture coordinates, like
 * BoxGeometry (sides: u across, v up; top and bottom: u along x, v along z).
 */
export function chamferedBox(w: number, h: number, d: number, r: number): BufferGeometry {
  return roundedChamferedBox(w, h, d, r, 0, 0);
}

/** Segments in a rounded corner's quarter circle. */
const ARC_STEPS = 6;

/**
 * `chamferedBox` with some of its upright corners rounded off to radius `round` in plan: `corners` has bit 1 for the
 * (+x, +z) corner, 2 for (+x, −z), 4 for (−x, +z) and 8 for (−x, −z) (see the landscape's `CORNERS`).
 */
export function roundedChamferedBox(w: number, h: number, d: number, r: number, corners: number, round: number): BufferGeometry {
  const hx = w / 2;
  const hy = h / 2;
  const hz = d / 2;
  const points: Vector3[] = [];
  const bits: Record<string, number> = { "1,1": 1, "1,-1": 2, "-1,1": 4, "-1,-1": 8 };
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const rounded = (corners & bits[`${sx},${sz}`]) !== 0 && round > r;
      for (const sy of [-1, 1]) {
        if (!rounded) {
          points.push(new Vector3(sx * hx, sy * (hy - r), sz * (hz - r)));
          points.push(new Vector3(sx * (hx - r), sy * hy, sz * (hz - r)));
          points.push(new Vector3(sx * (hx - r), sy * (hy - r), sz * hz));
          continue;
        }
        // A quarter circle about the rounding's centre, its rim bevelled like the square edges.
        const cx = sx * (hx - round);
        const cz = sz * (hz - round);
        for (let k = 0; k <= ARC_STEPS; k++) {
          const a = (k / ARC_STEPS) * (Math.PI / 2);
          const dx = sx * Math.cos(a);
          const dz = sz * Math.sin(a);
          points.push(new Vector3(cx + dx * round, sy * (hy - r), cz + dz * round));
          points.push(new Vector3(cx + dx * (round - r), sy * hy, cz + dz * (round - r)));
        }
      }
    }
  }
  const g = new ConvexGeometry(points);
  const pos = g.getAttribute("position");
  const nrm = g.getAttribute("normal");
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    const ax = Math.abs(nrm.getX(i));
    const ay = Math.abs(nrm.getY(i));
    const az = Math.abs(nrm.getZ(i));
    const x = pos.getX(i) / w + 0.5;
    const y = pos.getY(i) / h + 0.5;
    const z = pos.getZ(i) / d + 0.5;
    const [u, v] = ay >= ax && ay >= az ? [x, z] : ax >= az ? [z, y] : [x, y];
    uv[i * 2] = u;
    uv[i * 2 + 1] = v;
  }
  g.setAttribute("uv", new BufferAttribute(uv, 2));
  return g;
}

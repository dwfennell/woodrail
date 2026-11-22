import { BufferAttribute, Vector3, type BufferGeometry, type Matrix4 } from "three";

const point = new Vector3();

/** Saw a shape from a single blank. Face, bevel and groove sample the same
 * oblique slice of beech in millimetres. The material sets the tile size. */
export function mapBoardGrain(g: BufferGeometry, toBoard?: Matrix4, mirrored = false): BufferGeometry {
  const pos = g.getAttribute("position");
  const uv = g.getAttribute("uv") ?? new BufferAttribute(new Float32Array(pos.count * 2), 2);
  const side = mirrored ? -1 : 1;
  for (let i = 0; i < pos.count; i++) {
    point.fromBufferAttribute(pos, i);
    if (toBoard) point.applyMatrix4(toBoard);
    uv.setXY(i, point.x + 0.25 * point.y, side * point.z + 0.75 * point.y);
  }
  g.setAttribute("uv", uv);
  return g;
}

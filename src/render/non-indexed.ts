import type { BufferGeometry } from "three";

/**
 * `g` as a non-indexed geometry: `g.toNonIndexed()` if it's indexed, else `g` itself. (Three's `toNonIndexed` returns
 * an already non-indexed geometry as it is too, but warns each time: ExtrudeGeometry and RoundedBoxGeometry are built
 * non-indexed.) Like `toNonIndexed`, it leaves an indexed `g` as it was and returns a new geometry.
 */
export function nonIndexed(g: BufferGeometry): BufferGeometry {
  return g.index ? g.toNonIndexed() : g;
}

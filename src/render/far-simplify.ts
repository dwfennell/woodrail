import type { MeshoptSimplifier } from "meshoptimizer/simplifier";

/** A far version saving less than this share of the triangles isn't worth its index. */
export const MIN_SAVING = 0.25;

/**
 * The normals count as well as the surface (a normal turned by a tenth counts as a tenth of a millimetre astray), so a
 * far version is shaded as the real one is, not only shaped like it (position alone left a fifth more triangles out,
 * and far-off houses a shade lighter or darker).
 */
const NORMAL_WEIGHTS = [1, 1, 1];

/**
 * A far version's index (see `far-detail.ts`): `index` simplified within `error` mm of the surface of `positions` (and
 * of `normals`, if given: floats, three a vertex). Null if it saves too little. No three here: the far worker runs it.
 */
export function simplifyIndex(
  simplifier: typeof MeshoptSimplifier,
  index: Uint32Array,
  positions: Float32Array,
  normals: Float32Array | null,
  error: number,
): Uint32Array | null {
  const [out] = normals
    ? simplifier.simplifyWithAttributes(index, positions, 3, normals, 3, NORMAL_WEIGHTS, null, 0, error, ["ErrorAbsolute"])
    : simplifier.simplify(index, positions, 3, 0, error, ["ErrorAbsolute"]);
  return out.length <= index.length * (1 - MIN_SAVING) ? out : null;
}

/** A far worker's job, and its answer. */
export interface FarJob {
  id: number;
  index: Uint32Array;
  positions: Float32Array;
  normals: Float32Array | null;
  error: number;
}
export interface FarAnswer {
  id: number;
  index: Uint32Array | null;
}

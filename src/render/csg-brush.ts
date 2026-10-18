import type { BufferAttribute, BufferGeometry, Material, TypedArray } from "three";
import { MeshBVH } from "three-mesh-bvh";
import { Brush, Evaluator, HalfEdgeMap, type CSGOperation } from "three-bvh-csg";

/**
 * The options a CSG brush's BVH is built with. three-bvh-csg 0.0.18 still passes `maxLeafSize`, which three-mesh-bvh
 * 0.9 deprecated (it warns on every build: thousands of console warnings in a session); `targetLeafSize` is its new
 * name, with the same meaning and value.
 */
export const CSG_BVH_OPTIONS = { targetLeafSize: 3, indirect: true } as const;

/** CSG data three-bvh-csg keeps on a brush's geometry (not in its types). */
type CsgGeometry = BufferGeometry & { boundsTree?: MeshBVH | null; halfEdges?: HalfEdgeMap | null; groupIndices?: Uint16Array | null };

/**
 * A three-bvh-csg `Brush` whose `prepareGeometry` is the library's, but builds its BVH with `CSG_BVH_OPTIONS`.
 * Use it for every brush, and as the target of every evaluation (`csgEvaluate`), so results fed back in are too.
 */
export class CsgBrush extends Brush {
  private preparedHash: string | null = null;

  constructor(geometry?: BufferGeometry, material?: Material | Material[]) {
    super(geometry, material);
  }

  override prepareGeometry(): void {
    const geometry = this.geometry as CsgGeometry;
    const attributes = geometry.attributes;
    const useSharedArrayBuffer = typeof SharedArrayBuffer !== "undefined";
    // Skip it when the geometry is the one last prepared, unchanged. (The library's key also has the attributes'
    // `uuid`, which three's BufferAttribute doesn't have: always undefined.)
    const index = geometry.index;
    const pos = attributes.position as BufferAttribute;
    const indexHash = index ? `${index.count}_${index.version}` : "-1_-1";
    const hash = `${geometry.uuid}_${indexHash}_${pos.count}_${pos.version}`;
    if (this.preparedHash === hash) return;
    this.preparedHash = hash;
    if (useSharedArrayBuffer) {
      for (const key in attributes) {
        const attribute = attributes[key];
        if ("isInterleavedBufferAttribute" in attribute) throw new Error("Brush: InterleavedBufferAttributes are not supported.");
        attribute.array = toSharedArray(attribute.array);
      }
    }
    geometry.boundsTree = new MeshBVH(geometry, { ...CSG_BVH_OPTIONS, useSharedArrayBuffer });
    if (!geometry.halfEdges) geometry.halfEdges = new HalfEdgeMap();
    geometry.halfEdges.updateFrom(geometry);
    // Each triangle's group, for materials.
    const triCount = (index ? index.count : pos.count) / 3;
    if (!geometry.groupIndices || geometry.groupIndices.length !== triCount) geometry.groupIndices = new Uint16Array(triCount);
    const groupIndices = geometry.groupIndices;
    geometry.groups.forEach(({ start, count }, i) => {
      for (let t = start / 3, end = (start + count) / 3; t < end; t++) groupIndices[t] = i;
    });
  }
}

function toSharedArray(array: TypedArray): TypedArray {
  if (array.buffer instanceof SharedArrayBuffer) return array;
  const shared = new SharedArrayBuffer(array.buffer.byteLength);
  new Uint8Array(shared).set(new Uint8Array(array.buffer));
  return new (array.constructor as new (buffer: SharedArrayBuffer) => TypedArray)(shared);
}

/** `evaluator.evaluate(a, b, operation)`, its result a `CsgBrush` (so it prepares without warning if fed back in). */
export function csgEvaluate(evaluator: Evaluator, a: Brush, b: Brush, operation: CSGOperation): CsgBrush {
  return evaluator.evaluate(a, b, operation, new CsgBrush()) as CsgBrush;
}

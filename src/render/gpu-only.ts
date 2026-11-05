import { StaticDrawUsage, type BufferAttribute, type BufferGeometry, type InterleavedBuffer, type InterleavedBufferAttribute, type Mesh, type Object3D } from "three";
import { compactVertices } from "./compact-vertices";
import { farBeforeFree } from "./far-detail";

/**
 * Geometry that's only drawn: its vertex data freed from JavaScript once the GPU has it.
 *
 * three keeps every attribute's array after uploading it, so a static mesh costs its vertex data twice: once on the GPU
 * and once in the page's memory (as typed arrays, outside the JS heap's own count). On a late map that's most of what
 * the page holds (the land's dressing, towns, felt and scenery: ~100 MB on a phone). Marked geometry keeps its bounds
 * (computed here first, for culling) and its counts, and draws as before; what it can't do after its first upload is
 * be read on the CPU: raycast, merged, cloned, or uploaded again (to a second renderer, or after it was disposed).
 * So mark only what's drawn and nothing else: not what picking hits, not a cache's sources, not what's shared with
 * thumbnails.
 *
 * A lost WebGL context can't bring freed data back: restore by building the scene again (or reloading), not by letting
 * three upload what it has. `Game` turns it on for the mobile tier only (`setGpuOnlyEnabled`): a desktop keeps its
 * copies and restores in place.
 */
let enabled = true;

export function setGpuOnlyEnabled(on: boolean): void {
  enabled = on;
}

/** Is drawn-only geometry freed (so a lost context must be restored by reloading: see `Game.restoreInPlace`)? */
export function gpuOnlyEnabled(): boolean {
  return enabled;
}

/** Bytes freed so far (for the perf readout and tests). */
export let gpuOnlyFreedBytes = 0;

const EMPTY = new Map<unknown, ArrayLike<number>>();

function emptyLike(array: ArrayLike<number>): ArrayLike<number> {
  const C = array.constructor;
  let e = EMPTY.get(C);
  if (!e) EMPTY.set(C, (e = new (C as new (n: number) => ArrayLike<number>)(0)));
  return e;
}

/** After its upload: drop the array (once). A second upload of a freed array is a bug: it would draw nothing. */
function freeAfterUpload(this: BufferAttribute | InterleavedBuffer): void {
  const array = this.array as ArrayLike<number> & { byteLength: number };
  if (array.length === 0) {
    if (this.count > 0) console.error("Woodrail: geometry uploaded again after its data was freed (see gpu-only.ts): it draws nothing", markedAt.get(this) ?? "");
    return;
  }
  gpuOnlyFreedBytes += array.byteLength;
  (this as { array: ArrayLike<number> }).array = emptyLike(array);
}

/** Dev builds: where each attribute was marked, for the error above. */
const markedAt = new WeakMap<object, string>();

function markAttribute(a: BufferAttribute | InterleavedBufferAttribute | null | undefined): void {
  if (!a) return;
  const target = (a as InterleavedBufferAttribute).isInterleavedBufferAttribute ? (a as InterleavedBufferAttribute).data : (a as BufferAttribute);
  // Only static data: anything updated in place (instances, dynamic buffers) needs its array.
  if (target.usage !== StaticDrawUsage) return;
  target.onUploadCallback = freeAfterUpload;
  if (import.meta.env.DEV) markedAt.set(target, new Error("marked").stack ?? "");
}

/**
 * How a drawn-only geometry is kept: `pickable` keeps its positions and index (what a raycast reads: picking still
 * hits it) and frees the rest.
 */
export interface GpuOnlyOptions {
  pickable?: boolean;
}

/**
 * Free this geometry's vertex data from JavaScript once it's uploaded (see above). Its bounds are computed now, and
 * its normals and colours made compact first (bytes and 16 bits: see `compact-vertices.ts`), so the GPU's copy is
 * smaller too.
 */
export function gpuOnlyGeometry(g: BufferGeometry, opts: GpuOnlyOptions = {}): void {
  if (!enabled || g.userData.gpuOnly) return;
  if (!g.getAttribute("position")) return;
  if (!g.boundingSphere) g.computeBoundingSphere();
  if (!g.boundingBox) g.computeBoundingBox();
  g.userData.gpuOnly = true;
  compactVertices(g);
  // (Its far version, if it has one, asked for now: made from its arrays, which go once it's uploaded.)
  farBeforeFree(g);
  for (const name of Object.keys(g.attributes)) if (!(opts.pickable && name === "position")) markAttribute(g.getAttribute(name));
  if (!opts.pickable) markAttribute(g.index);
}

/**
 * Mark every mesh's geometry under `root` as only drawn (see above), except geometry shared with something else
 * (`userData.sharedGeometry`: models' copies, caches' tiles), whose life isn't the mesh's.
 */
export function gpuOnly(root: Object3D, opts: GpuOnlyOptions = {}): void {
  if (!enabled) return;
  root.traverse((o) => {
    const m = o as Mesh;
    if (!m.isMesh || !m.geometry || m.userData.sharedGeometry) return;
    gpuOnlyGeometry(m.geometry, opts);
  });
}

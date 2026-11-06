import { Box3, BufferAttribute, BufferGeometry, type Mesh, type Vector3 } from "three";
import type { MeshoptSimplifier as Simplifier } from "meshoptimizer/simplifier";
import { simplifyIndex, type FarAnswer, type FarJob } from "./far-simplify";
import farWorkerUrl from "./far-worker.ts?worker-chunk";

/**
 * Far versions of finished static meshes (towns, industries' yards, ruins, the felt, the scenery around, props): the
 * same surface within `FAR_ERROR` mm, in a fraction of the triangles (meshoptimizer's simplifier: edges collapsed only
 * where the surface and its normals stay within the error, seams of colour kept). Drawn where a millimetre is under
 * `FAR_PX_PER_MM` pixels, so the error is under a quarter of a pixel; back to the real mesh 10% nearer (as the track's
 * far version: see claude/perf-4's `TrackView.setDetail`).
 *
 * A plain mesh's far version is only a new index over its own vertices (`farIndex`): its attributes are shared, so on
 * the GPU it costs that index alone. They're made once wanted for a while (`FAR_ASK_FRAMES` frames drawn with the
 * camera moving: zooming out), by a worker (`far-worker.ts`; the main thread only copies the arrays over), so loading
 * costs nothing more, a still game makes none, nothing holds up a tap, and a view zoomed out a long way draws the real
 * meshes until theirs are made. The simplifier (55 kB) is fetched with the worker.
 */
export const FAR_PX_PER_MM = 0.5;
export const FAR_HYSTERESIS = 1.1;
/** How far a far version may stray from the real surface (mm). */
export const FAR_ERROR = 0.5;
/**
 * Frames drawn with the camera moving that a mesh must have wanted its far version for before it's made: a camera
 * moving out, not a still view's frames (trains running, after loading, a tap), so a game left alone makes none (and
 * pays nothing while idle or paused).
 */
export const FAR_ASK_FRAMES = 12;
let simplifier: typeof Simplifier | null = null;
let loading: Promise<void> | null = null;

/** Fetch the simplifier (once), for making far versions on the main thread (where there's no worker: tests). */
export function loadSimplifier(): Promise<void> {
  loading ??= import("meshoptimizer/simplifier")
    .then(async ({ MeshoptSimplifier }) => {
      await MeshoptSimplifier.ready;
      simplifier = MeshoptSimplifier;
    })
    .catch((e: unknown) => console.warn("Woodrail: no far detail (the simplifier didn't load)", e));
  return loading;
}

/**
 * What a far version is made from (copies, to hand to a worker): the index, the positions, the normals as floats.
 * Null if it can't have one (not indexed, groups, positions not floats).
 */
function farInputs(g: BufferGeometry): { index: Uint32Array; positions: Float32Array; normals: Float32Array | null } | null {
  const pos = g.getAttribute("position");
  if (!g.index || g.groups.length > 0 || !(pos instanceof BufferAttribute) || !(pos.array instanceof Float32Array) || pos.itemSize !== 3) return null;
  // (Its arrays freed already, uploaded as drawn-only geometry (`gpu-only.ts`): nothing to make it from.)
  if (pos.array.length < pos.count * 3 || g.index.array.length < g.index.count || g.index.count === 0) return null;
  const n = g.getAttribute("normal");
  let normals: Float32Array | null = null;
  if (n instanceof BufferAttribute && n.array.length >= n.count * 3) {
    const src = n.array;
    normals = new Float32Array(n.count * 3);
    // (Bytes, as compact vertices keep them: read straight, not through getComponent, a vertex at a time.)
    if (src instanceof Int8Array && n.normalized) for (let i = 0; i < normals.length; i++) normals[i] = Math.max(src[i] / 127, -1);
    else for (let i = 0; i < n.count; i++) for (let j = 0; j < 3; j++) normals[i * 3 + j] = n.getComponent(i, j);
  }
  return { index: Uint32Array.from(g.index.array), positions: pos.array.slice(), normals };
}

/**
 * A far version's triangles for an indexed geometry (one material, all of it drawn), made here and now: an index over
 * the same vertices. Null if it can't be made (not indexed, groups, the simplifier not loaded) or saves too little.
 */
export function farIndex(g: BufferGeometry, error = FAR_ERROR): Uint32Array | null {
  const input = simplifier && farInputs(g);
  return input ? simplifyIndex(simplifier!, input.index, input.positions, input.normals, error) : null;
}

let worker: Worker | null | undefined;
let nextJob = 1;
const answers = new Map<number, (index: Uint32Array | null) => void>();

/** The far worker (made once); null where there are no module workers (tests), or it couldn't start. */
function farWorker(): Worker | null {
  if (worker !== undefined) return worker;
  worker = null;
  if (typeof Worker === "undefined") return null;
  try {
    worker = new Worker(farWorkerUrl, { type: "module" });
    worker.onmessage = (e: MessageEvent<FarAnswer>) => {
      answers.get(e.data.id)?.(e.data.index);
      answers.delete(e.data.id);
    };
    worker.onerror = () => {
      // (It failed to start: what it was asked is made here instead, and from now on.)
      worker = null;
      const waiting = [...answers.values()];
      answers.clear();
      for (const done of waiting) done(null);
    };
  } catch {
    worker = null;
  }
  return worker;
}

/**
 * A far version's index, made off the main thread (the far worker: a town tile's simplification is a long task, and
 * on the main thread it held up taps), or where there's no worker, here when the page is idle. Null as `farIndex`.
 */
export function farIndexLater(g: BufferGeometry, error = FAR_ERROR): Promise<Uint32Array | null> {
  // (Copied now: drawn-only geometry's arrays may be freed by the time it's made.)
  const input = farInputs(g);
  if (!input) return Promise.resolve(null);
  const w = farWorker();
  if (!w) return new Promise((done) => whenIdle(() => done(simplifier ? simplifyIndex(simplifier, input.index, input.positions, input.normals, error) : null)));
  const id = nextJob++;
  return new Promise((done) => {
    answers.set(id, done);
    const job: FarJob = { id, ...input, error };
    w.postMessage(job, [input.index.buffer, input.positions.buffer, ...(input.normals ? [input.normals.buffer] : [])]);
  });
}

/**
 * A far version as a geometry of its own, only the vertices it uses (for a `BatchedMesh`, which copies each geometry
 * in: an index over the whole model's vertices would copy them all), from its index (`farIndex`).
 */
export function farGeometryOf(g: BufferGeometry, index: Uint32Array): BufferGeometry {
  const remap = new Int32Array(g.getAttribute("position").count).fill(-1);
  const used: number[] = [];
  for (let i = 0; i < index.length; i++) {
    const v = index[i];
    if (remap[v] < 0) {
      remap[v] = used.length;
      used.push(v);
    }
    index[i] = remap[v];
  }
  const out = new BufferGeometry();
  for (const name of Object.keys(g.attributes)) {
    const a = g.getAttribute(name) as BufferAttribute;
    const s = a.itemSize;
    const arr = new (a.array.constructor as new (n: number) => typeof a.array)(used.length * s);
    used.forEach((v, k) => {
      for (let j = 0; j < s; j++) arr[k * s + j] = a.array[v * s + j];
    });
    out.setAttribute(name, new BufferAttribute(arr, s, a.normalized));
  }
  out.setIndex(new BufferAttribute(used.length <= 65535 ? Uint16Array.from(index) : index, 1));
  return out;
}

/** `farGeometryOf` made here and now (null as `farIndex`). */
export function farGeometry(g: BufferGeometry, error = FAR_ERROR): BufferGeometry | null {
  const index = farIndex(g, error);
  return index ? farGeometryOf(g, index) : null;
}

/** Run `job` when the page is idle (one job a moment, in the order asked), with the simplifier loaded. */
const jobs: (() => void)[] = [];
let scheduled = false;
export function whenIdle(job: () => void): void {
  jobs.push(job);
  if (scheduled) return;
  scheduled = true;
  const ric = (globalThis as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
  const next = () => (ric ? ric(run, { timeout: 500 }) : setTimeout(run, 16));
  const run = () => {
    const j = jobs.shift();
    if (j) j();
    if (jobs.length > 0) next();
    else scheduled = false;
  };
  void loadSimplifier().then(next);
}

/** A plain mesh's two versions, and which is drawn. */
interface Entry {
  near: BufferGeometry;
  /** Undefined: not made yet (or being made); null: none worth having. */
  far: BufferGeometry | null | undefined;
  isFar: boolean;
  /** Frames the camera moved in that it's wanted its far version without having one (see `FAR_ASK_FRAMES`). */
  wanted: number;
  /** Its bounds in the world (static meshes: found once). */
  box: Box3 | null;
}

/** Far versions by the real geometry (shared by meshes drawing the same one: the felt's tiles, kept in a cache). */
const farOf = new WeakMap<BufferGeometry, BufferGeometry | null>();
const pendingFor = new WeakSet<BufferGeometry>();
const watched = new WeakSet<BufferGeometry>();
const entries = new Map<Mesh, Entry>();
/** Bumped when a mesh with a far version comes or goes, or a far version's made: `updateFarDetail` runs again. */
let version = 0;
/** What `updateFarDetail` saw last, to skip a frame when nothing it looks at has changed. */
const seen = { version: -1, pxScale: 0, far: 0 };

/**
 * Give a finished static mesh (indexed, one material, not moving) a far version, drawn by `updateFarDetail` where it's
 * small enough. Its geometry may be shared: the far version is made once for it, and freed with it.
 */
export function useFarDetail(mesh: Mesh): Mesh {
  const g = mesh.geometry;
  if (!g.index || g.groups.length > 0 || Array.isArray(mesh.material)) return mesh;
  if (drawnOnly.has(g)) return mesh;
  entries.set(mesh, { near: g, far: farOf.get(g), isFar: false, wanted: 0, box: null });
  version++;
  if (!watched.has(g)) {
    watched.add(g);
    // Freed (its tile built again, its cache let it go): its meshes are forgotten.
    g.addEventListener("dispose", () => {
      for (const [m, e] of entries) if (e.near === g) entries.delete(m);
      version++;
    });
  }
  return mesh;
}

const _box = new Box3();

/**
 * On a drawn frame, before it's drawn: each mesh with a far version (`useFarDetail`) drawn far where a millimetre at its
 * nearest is under `FAR_PX_PER_MM` pixels, near again 10% nearer than that. `pxScale`: pixels a millimetre at a
 * millimetre away (the screen's height in pixels over twice the tangent of half the field of view). Far versions not
 * made yet are asked for once wanted on `FAR_ASK_FRAMES` frames drawn while the camera moved (`moving`). Returns how
 * many meshes are drawn far.
 */
export function updateFarDetail(eye: Vector3, pxScale: number, moving = true): number {
  // A still camera, and nothing added, freed or made since: as last time (a train running costs nothing here).
  if (!moving && version === seen.version && pxScale === seen.pxScale) return seen.far;
  let far = 0;
  for (const [mesh, e] of entries) {
    // Gone: taken out of the world (a tile built again), or its geometry freed or swapped by its owner.
    if (!mesh.parent || (mesh.geometry !== e.near && mesh.geometry !== e.far)) {
      if (mesh.geometry === e.far) mesh.geometry = e.near;
      entries.delete(mesh);
      continue;
    }
    // (A draw range shows part of it: the far version can't.)
    if (e.near.drawRange.count !== Infinity || e.near.drawRange.start !== 0) continue;
    if (!e.box) {
      if (!e.near.boundingBox) e.near.computeBoundingBox();
      mesh.updateWorldMatrix(true, false);
      e.box = _box.copy(e.near.boundingBox!).applyMatrix4(mesh.matrixWorld).clone();
    }
    const d = Math.max(1, e.box.distanceToPoint(eye));
    const wantFar = pxScale / d < FAR_PX_PER_MM * (e.isFar ? FAR_HYSTERESIS : 1);
    if (wantFar && e.far === undefined) {
      e.far = farOf.get(e.near);
      if (e.far === undefined && moving && ++e.wanted >= FAR_ASK_FRAMES) ask(e.near);
    } else if (!wantFar) e.wanted = 0;
    const drawFar = wantFar && !!e.far;
    if (drawFar !== e.isFar) {
      e.isFar = drawFar;
      mesh.geometry = drawFar ? e.far! : e.near;
    }
    if (drawFar) far++;
  }
  seen.version = version;
  seen.pxScale = pxScale;
  seen.far = far;
  return far;
}

/**
 * Called by `gpuOnlyGeometry` before it marks a geometry's arrays to be freed once uploaded: drawn-only geometry (the
 * mobile tier's land, towns, scenery and yards) has no far version, as there'd be nothing to make it from when it's
 * wanted. (Making them all from copies as the arrays went was tried: on a phone, a copy of every tile's arrays at load
 * and at each tile built again, and the garbage after, slowed e2e:roads' vans and e2e:workshop's cards.) Props and
 * kits, whose batches keep their arrays, still have theirs there; and every mesh on a desktop, which keeps its arrays.
 */
export function farBeforeFree(g: BufferGeometry): void {
  if (!watched.has(g)) return;
  drawnOnly.add(g);
  for (const [m, e] of entries) {
    if (e.near !== g) continue;
    if (m.geometry === e.far) m.geometry = g;
    entries.delete(m);
  }
  version++;
}

const drawnOnly = new WeakSet<BufferGeometry>();

/** Make `near`'s far version (once), off the main thread where it can be (`farIndexLater`). */
function ask(near: BufferGeometry): void {
  if (pendingFor.has(near)) return;
  pendingFor.add(near);
  let freed = false;
  near.addEventListener("dispose", () => (freed = true));
  void farIndexLater(near).then((index) => {
    if (freed) return;
    if (!index) {
      farOf.set(near, null);
      version++;
      for (const e of entries.values()) if (e.near === near) e.far = null;
      return;
    }
    const far = new BufferGeometry();
    for (const name of Object.keys(near.attributes)) far.setAttribute(name, near.getAttribute(name));
    far.setIndex(new BufferAttribute(near.getAttribute("position").count <= 65535 ? Uint16Array.from(index) : index, 1));
    far.boundingBox = near.boundingBox;
    far.boundingSphere = near.boundingSphere;
    // Freed together: whichever its owner frees (the one drawn at the time), the other goes too.
    let both = false;
    const free = () => {
      if (both) return;
      both = true;
      near.dispose();
      far.dispose();
    };
    near.addEventListener("dispose", free);
    far.addEventListener("dispose", free);
    farOf.set(near, far);
    version++;
    for (const e of entries.values()) if (e.near === near) e.far = far;
  });
}

/** For tests: forget every mesh. */
export function resetFarDetail(): void {
  entries.clear();
  version++;
}

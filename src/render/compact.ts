import { BufferAttribute, type BatchedMesh, type BufferGeometry, type TypedArray } from "three";
import { compactVertices } from "./compact-vertices";

/**
 * Static merged geometry made smaller for the GPU (and the JS heap, which keeps the same arrays unless `gpuOnly` frees
 * them), drawn the same:
 *
 * - **Compact vertices** (`compactVertices`, the one quantiser): normals as normalised bytes, vertex colours as
 *   normalised 16-bit. Positions and uvs are kept as floats.
 * - **Welded** (`weld`): a non-indexed geometry (as `mergeGeometries` of `toNonIndexed` parts makes) becomes indexed,
 *   vertices exactly alike in every attribute stored once. Merged scenery is mostly rounded boxes and cylinders, whose
 *   triangles share corners: about a quarter of the vertices are left. The index keeps each old vertex's place, so a
 *   group or draw range counts the same as before (a draw range counted vertices, it now counts the same indices).
 *   16-bit indices where the vertices fit.
 *
 * Only for geometry that's finished: nothing merges it again or writes its attributes afterwards (a batcher given one
 * takes it back as floats: `floatVertices`). Raycasting still works (three reads normalised attributes back as floats).
 */
export function compact(g: BufferGeometry): BufferGeometry {
  return weld(compactVertices(g));
}

/** The same elements of a typed array as unsigned integers of the same size, for comparing and hashing exactly. */
function bitsOf(a: TypedArray): Uint8Array | Uint16Array | Uint32Array {
  const len = a.length;
  if (a.BYTES_PER_ELEMENT === 4) return new Uint32Array(a.buffer, a.byteOffset, len);
  if (a.BYTES_PER_ELEMENT === 2) return new Uint16Array(a.buffer, a.byteOffset, len);
  if (a.BYTES_PER_ELEMENT === 1) return new Uint8Array(a.buffer, a.byteOffset, len);
  throw new Error("bitsOf: 8-byte arrays aren't drawn");
}

/**
 * `g` (non-indexed) made indexed in place, vertices alike in every attribute, bit for bit, kept once (in the order
 * first met). An indexed geometry, or one with interleaved or morph attributes, is left as it is. Returns `g`.
 */
export function weld(g: BufferGeometry): BufferGeometry {
  if (g.index || Object.keys(g.morphAttributes).length > 0) return g;
  const names = Object.keys(g.attributes);
  const attrs: BufferAttribute[] = [];
  for (const name of names) {
    const a = g.attributes[name];
    if (!(a instanceof BufferAttribute)) return g;
    attrs.push(a);
  }
  const count = g.getAttribute("position")?.count ?? 0;
  if (count === 0) return g;
  const bits = attrs.map((a) => bitsOf(a.array));
  const sizes = attrs.map((a) => a.itemSize);
  // Open addressing: each slot the first vertex (+1) of a kind; `remap` each vertex's new number.
  let cap = 1;
  while (cap < count * 2) cap <<= 1;
  const mask = cap - 1;
  const slots = new Int32Array(cap);
  const firstOf = new Int32Array(count);
  const remap = new Uint32Array(count);
  let unique = 0;
  for (let v = 0; v < count; v++) {
    let h = 0x811c9dc5;
    for (let k = 0; k < bits.length; k++) {
      const b = bits[k];
      const s = sizes[k];
      for (let j = v * s, end = j + s; j < end; j++) h = Math.imul(h ^ b[j], 0x01000193);
    }
    let at = (h ^ (h >>> 15)) & mask;
    for (;;) {
      const o = slots[at];
      if (o === 0) {
        slots[at] = v + 1;
        firstOf[unique] = v;
        remap[v] = unique++;
        break;
      }
      const u = o - 1;
      let same = true;
      for (let k = 0; k < bits.length && same; k++) {
        const b = bits[k];
        const s = sizes[k];
        for (let j = 0; j < s; j++) {
          if (b[v * s + j] !== b[u * s + j]) {
            same = false;
            break;
          }
        }
      }
      if (same) {
        remap[v] = remap[u];
        break;
      }
      at = (at + 1) & mask;
    }
  }
  // (Indexed even with nothing to share, so every compacted geometry is alike: a `BatchedMesh` wants that.)
  for (let k = 0; k < attrs.length; k++) {
    const a = attrs[k];
    const s = sizes[k];
    const src = a.array;
    const out = new (src.constructor as new (n: number) => TypedArray)(unique * s);
    for (let u = 0; u < unique; u++) {
      const from = firstOf[u] * s;
      for (let j = 0; j < s; j++) out[u * s + j] = src[from + j];
    }
    const na = new BufferAttribute(out, s, a.normalized);
    na.name = a.name;
    g.setAttribute(names[k], na);
  }
  g.setIndex(new BufferAttribute(unique <= 65535 ? Uint16Array.from(remap) : remap, 1));
  return g;
}

/** `g` if it's already as `compact` leaves it, else a compacted copy: every geometry in a `BatchedMesh` must be alike. */
export function compacted(g: BufferGeometry): BufferGeometry {
  const n = g.getAttribute("normal");
  const c = g.getAttribute("color");
  return g.index && (!n || n.normalized) && (!c || c.normalized) ? g : compact(g.clone());
}

/** A `BatchedMesh`'s room: vertices and indices it has space for. */
export interface BatchRoom {
  vertices: number;
  indices: number;
}

/**
 * Make room in a `BatchedMesh` (whose sizes are `room`) for one more geometry `g`, growing it by half again or what's
 * needed (doubling left a quarter of a big batch's buffers empty on average). Updates `room`.
 */
export function makeRoom(mesh: BatchedMesh, room: BatchRoom, g: BufferGeometry): void {
  const nv = g.getAttribute("position").count;
  const ni = g.index ? g.index.count : nv;
  if (mesh.unusedVertexCount >= nv && mesh.unusedIndexCount >= ni) return;
  const grow = (cap: number, unused: number, need: number) => (unused >= need ? cap : Math.max(Math.ceil(cap * 1.5), cap - unused + need));
  room.vertices = grow(room.vertices, mesh.unusedVertexCount, nv);
  room.indices = grow(room.indices, mesh.unusedIndexCount, ni);
  mesh.setGeometrySize(room.vertices, room.indices);
}

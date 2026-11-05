import { BufferAttribute, StaticDrawUsage, type BufferGeometry } from "three";

/**
 * Smaller vertex data for models drawn many times (the props' and kits' baked models, and the batches they're drawn
 * from): normals as bytes and colours as 16-bit, both normalized (three reads them back as floats, in the shader and in
 * `getX`). A vertex goes from 44 bytes to 29, in the model, in its batch, and on the GPU. Bytes are plenty for a
 * normal (under half a degree); colours keep 16 bits, as near-black paint in linear light needs more than 8.
 *
 * Merging needs one array type throughout: `floatVertices` turns them back to floats where a compact model is merged
 * with other geometry (`Batcher` does).
 */
export function compactVertices(g: BufferGeometry): BufferGeometry {
  // In place, the same attribute objects (a geometry already on the GPU keeps its buffers). Only static data: what's
  // updated in place is left as it is.
  const normal = g.getAttribute("normal") as BufferAttribute | undefined;
  if (normal && normal.array instanceof Float32Array && normal.usage === StaticDrawUsage) {
    const src = normal.array;
    const out = new Int8Array(src.length);
    for (let i = 0; i < src.length; i++) out[i] = Math.round(Math.max(-1, Math.min(1, src[i])) * 127);
    normal.array = out;
    normal.normalized = true;
  }
  const color = g.getAttribute("color") as BufferAttribute | undefined;
  if (color && color.array instanceof Float32Array && color.usage === StaticDrawUsage) {
    const src = color.array;
    const out = new Uint16Array(src.length);
    for (let i = 0; i < src.length; i++) out[i] = Math.round(Math.max(0, Math.min(1, src[i])) * 65535);
    color.array = out;
    color.normalized = true;
  }
  return g;
}

/** Every attribute as plain floats (undoing `compactVertices`, or a model's quantized data), in place. */
export function floatVertices(g: BufferGeometry): BufferGeometry {
  for (const name of Object.keys(g.attributes)) {
    const a = g.getAttribute(name) as BufferAttribute;
    if (a.array instanceof Float32Array || (a as unknown as { isInterleavedBufferAttribute?: boolean }).isInterleavedBufferAttribute) continue;
    const out = new Float32Array(a.count * a.itemSize);
    for (let i = 0; i < a.count; i++) for (let c = 0; c < a.itemSize; c++) out[i * a.itemSize + c] = a.getComponent(i, c);
    g.setAttribute(name, new BufferAttribute(out, a.itemSize));
  }
  return g;
}

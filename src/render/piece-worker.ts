/// <reference lib="webworker" />
// Builds track piece geometry off the main thread (the CSG carving is the slow part of loading).
import { buildPieceGeometry, compactPiece } from "./track-geometry";
import { getPieceDef, type PieceTypeId } from "../track";

export interface PieceJob {
  type: PieceTypeId;
  levels: number;
  /** The flipped piece (only asked for where flipping swaps its ends, so it isn't just a mirror image). */
  flipped?: boolean;
}

export interface PieceResult {
  type: PieceTypeId;
  levels: number;
  flipped?: boolean;
  attributes: { name: string; array: Float32Array; itemSize: number }[];
  index: Uint16Array | Uint32Array | null;
  groups: { start: number; count: number; materialIndex: number }[];
}

self.onmessage = (e: MessageEvent<PieceJob>) => {
  const { type, levels, flipped = false } = e.data;
  const g = compactPiece(buildPieceGeometry(getPieceDef(type, flipped), levels));
  const attributes = Object.entries(g.attributes).map(([name, a]) => ({ name, array: Float32Array.from(a.array as ArrayLike<number>), itemSize: a.itemSize }));
  const index = g.index ? (g.index.array as Uint16Array | Uint32Array).slice() : null;
  const groups = g.groups.map((gr) => ({ start: gr.start, count: gr.count, materialIndex: gr.materialIndex ?? 0 }));
  const result: PieceResult = { type, levels, flipped, attributes, index, groups };
  (self as unknown as Worker).postMessage(result, [...attributes.map((a) => a.array.buffer), ...(index ? [index.buffer] : [])]);
};

/// <reference lib="webworker" />
// Builds track piece geometry off the main thread (the CSG carving is the slow part of loading).
import { buildPieceGeometry } from "./track-geometry";
import { getPieceDef, type PieceTypeId } from "../track";

export interface PieceJob {
  type: PieceTypeId;
  levels: number;
}

export interface PieceResult {
  type: PieceTypeId;
  levels: number;
  attributes: { name: string; array: Float32Array; itemSize: number }[];
  index: Uint32Array | null;
  groups: { start: number; count: number; materialIndex: number }[];
}

self.onmessage = (e: MessageEvent<PieceJob>) => {
  const { type, levels } = e.data;
  const g = buildPieceGeometry(getPieceDef(type, false), levels);
  const attributes = Object.entries(g.attributes).map(([name, a]) => ({ name, array: Float32Array.from(a.array as ArrayLike<number>), itemSize: a.itemSize }));
  const index = g.index ? Uint32Array.from(g.index.array as ArrayLike<number>) : null;
  const groups = g.groups.map((gr) => ({ start: gr.start, count: gr.count, materialIndex: gr.materialIndex ?? 0 }));
  const result: PieceResult = { type, levels, attributes, index, groups };
  (self as unknown as Worker).postMessage(result, [...attributes.map((a) => a.array.buffer), ...(index ? [index.buffer] : [])]);
};

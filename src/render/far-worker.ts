/// <reference lib="webworker" />
import { MeshoptSimplifier } from "meshoptimizer/simplifier";
import { simplifyIndex, type FarAnswer, type FarJob } from "./far-simplify";

// Far versions made off the main thread (see `far-detail.ts`): a simplification of a town's tile is a long task, and
// on the main thread it held up a tap that came just after the camera moved.
self.onmessage = async (e: MessageEvent<FarJob>) => {
  const j = e.data;
  let index: Uint32Array | null = null;
  try {
    await MeshoptSimplifier.ready;
    index = simplifyIndex(MeshoptSimplifier, j.index, j.positions, j.normals, j.error);
  } catch (err) {
    console.warn("Woodrail: a far version couldn't be made", err);
  }
  const answer: FarAnswer = { id: j.id, index };
  (self as unknown as Worker).postMessage(answer, index ? [index.buffer] : []);
};

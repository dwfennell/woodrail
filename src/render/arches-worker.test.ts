import { afterEach, describe, expect, it, vi } from "vitest";
import { getPieceDef } from "../track";
import type { PieceJob, PieceResult } from "./piece-worker";
import { buildPieceGeometry, compactPiece } from "./track-geometry";

/** A stand-in Worker that carves a piece the way piece-worker does, a moment later (or never, when silent). */
function fakeWorkerClass(opts: { silent?: boolean } = {}) {
  const jobs: PieceJob[] = [];
  class FakeWorker {
    onmessage: ((e: MessageEvent) => void) | null = null;
    onmessageerror: ((e: MessageEvent) => void) | null = null;
    onerror: ((e: ErrorEvent) => void) | null = null;
    postMessage(job: PieceJob) {
      jobs.push(job);
      if (opts.silent) return;
      setTimeout(() => {
        const g = compactPiece(buildPieceGeometry(getPieceDef(job.type, !!job.flipped), job.levels));
        const result: PieceResult = {
          ...job,
          attributes: Object.entries(g.attributes).map(([name, a]) => ({ name, array: Float32Array.from(a.array as ArrayLike<number>), itemSize: a.itemSize })),
          index: g.index ? (g.index.array as Uint16Array | Uint32Array).slice() : null,
          groups: g.groups.map((gr) => ({ start: gr.start, count: gr.count, materialIndex: gr.materialIndex ?? 0 })),
        };
        this.onmessage?.({ data: result } as MessageEvent);
      }, 5);
    }
    terminate() {}
  }
  return { FakeWorker, jobs };
}

/** track-view, loaded fresh with this Worker in place (it decides at load whether workers can run). */
async function trackViewWith(Worker: unknown) {
  vi.resetModules();
  vi.stubGlobal("Worker", Worker);
  vi.stubGlobal("__BUILD_ID__", "");
  return import("./track-view");
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("taller arches come from the worker, not the drag", () => {
  it("a bridge lifted higher than any built yet shows its lowest arches at once, then its own when the worker's made them", async () => {
    const { FakeWorker, jobs } = fakeWorkerClass();
    const tv = await trackViewWith(FakeWorker);
    let told = 0;
    tv.onArchesBuilt(() => told++);
    const low = tv.pieceGeometry("bridge", false, 1);
    const t0 = performance.now();
    const shown = tv.pieceGeometry("bridge", false, 3);
    // No carving here: the stand-in is the one-level bridge, and the worker was asked for three levels, first.
    expect(performance.now() - t0).toBeLessThan(20);
    expect(shown).toBe(low);
    expect(jobs[0]).toEqual({ type: "bridge", levels: 3 });
    await vi.waitFor(() => expect(told).toBe(1), { timeout: 10_000 });
    const real = tv.pieceGeometry("bridge", false, 3);
    expect(real).not.toBe(low);
    // Its arches reach further down than the one-level bridge's.
    real.computeBoundingBox();
    low.computeBoundingBox();
    expect(real.boundingBox!.min.y).toBeLessThan(low.boundingBox!.min.y - 10);
    // The mirror image is made from it here, without asking the worker again.
    const asked = jobs.length;
    expect(tv.pieceGeometry("bridge", true, 3)).not.toBe(tv.pieceGeometry("bridge", true, 1));
    expect(jobs.length).toBe(asked);
  }, 30_000);

  it("a worker that goes silent: the stand-ins are let go, and arches are carved here from then on", async () => {
    vi.useFakeTimers();
    const { FakeWorker } = fakeWorkerClass({ silent: true });
    const tv = await trackViewWith(FakeWorker);
    let told = 0;
    tv.onArchesBuilt(() => told++);
    const low = tv.pieceGeometry("ramp", false, 0);
    expect(tv.pieceGeometry("ramp", false, 2)).toBe(low);
    await vi.advanceTimersByTimeAsync(20_000);
    // Told, so the stand-in is asked for again: carved here this time.
    expect(told).toBe(1);
    const real = tv.pieceGeometry("ramp", false, 2);
    expect(real).not.toBe(low);
  }, 30_000);

  it("with no workers at all, arches are carved when wanted (as before)", async () => {
    const tv = await trackViewWith(undefined);
    expect(tv.pieceGeometry("bridge", false, 2)).not.toBe(tv.pieceGeometry("bridge", false, 1));
  }, 30_000);
});

import { afterEach, describe, expect, it, vi } from "vitest";
import { getPieceDef, RISER_HEIGHT, type PieceTypeId } from "../track";
import type { PieceJob, PieceResult } from "./piece-worker";
import { buildPieceGeometry, compactPiece } from "./track-geometry";

/** How long the stand-in worker takes over each piece (ms). */
const JOB_MS = 20;

/** A stand-in Worker that carves a piece the way piece-worker does, `JOB_MS` later (or never, when silent). */
function fakeWorkerClass(opts: { silent?: boolean } = {}) {
  const jobs: PieceJob[] = [];
  class FakeWorker {
    onmessage: ((e: MessageEvent) => void) | null = null;
    onmessageerror: ((e: MessageEvent) => void) | null = null;
    onerror: ((e: ErrorEvent) => void) | null = null;
    private gone = false;
    postMessage(job: PieceJob) {
      jobs.push(job);
      if (opts.silent) return;
      setTimeout(() => {
        if (this.gone) return;
        const g = compactPiece(buildPieceGeometry(getPieceDef(job.type, !!job.flipped), job.levels));
        const result: PieceResult = {
          ...job,
          attributes: Object.entries(g.attributes).map(([name, a]) => ({ name, array: Float32Array.from(a.array as ArrayLike<number>), itemSize: a.itemSize })),
          index: g.index ? (g.index.array as Uint16Array | Uint32Array).slice() : null,
          groups: g.groups.map((gr) => ({ start: gr.start, count: gr.count, materialIndex: gr.materialIndex ?? 0 })),
        };
        this.onmessage?.({ data: result } as MessageEvent);
      }, JOB_MS);
    }
    terminate() {
      this.gone = true;
    }
  }
  return { FakeWorker, jobs };
}

/** track-view, loaded fresh with this Worker in place (it decides at load whether workers can run); one worker. */
async function trackViewWith(Worker: unknown) {
  vi.resetModules();
  vi.stubGlobal("Worker", Worker);
  vi.stubGlobal("__BUILD_ID__", "");
  vi.stubGlobal("navigator", { hardwareConcurrency: 2 });
  return import("./track-view");
}

/** Carving under way for these kinds of piece, with a count of the swaps it has asked for. */
async function carving(Worker: unknown, types: PieceTypeId[]) {
  const tv = await trackViewWith(Worker);
  const swaps = { n: 0 };
  tv.onPiecesBuilt(() => swaps.n++);
  await tv.TrackView.carveInBackground(types);
  return { tv, swaps };
}

/** Run the clock until `done`, a job at a time (at most `max` of them). */
async function until(done: () => boolean, max = 40) {
  for (let i = 0; i < max && !done(); i++) await vi.advanceTimersByTimeAsync(JOB_MS);
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("pieces carved in the background", () => {
  it("a piece wanted before its turn shows its plain body at once, goes to the front of the queue, and swaps in when carved", async () => {
    vi.useFakeTimers();
    const { FakeWorker, jobs } = fakeWorkerClass();
    const { tv, swaps } = await carving(FakeWorker, ["switch-3way", "curve-large", "straight-216"]);
    const t0 = performance.now();
    const shown = tv.pieceGeometry("straight-216", false, 0);
    // No carving here: a one-colour stand-in, and the straight is the next job the worker gets.
    expect(performance.now() - t0).toBeLessThan(50);
    expect(shown.groups.length).toBe(1);
    await vi.advanceTimersByTimeAsync(JOB_MS);
    expect(jobs[1]).toEqual({ type: "straight-216", levels: 0 });
    await until(() => swaps.n > 0);
    const real = tv.pieceGeometry("straight-216", false, 0);
    expect(real).not.toBe(shown);
    // Carved: grooves cut (their own material group).
    expect(real.groups.length).toBeGreaterThan(1);
  }, 30_000);

  it("whenBuilt waits for a piece, hurrying it; a bridge lifted higher shows its lowest arches till its own come", async () => {
    vi.useFakeTimers();
    const { FakeWorker, jobs } = fakeWorkerClass();
    const { tv, swaps } = await carving(FakeWorker, ["switch-3way", "curve-large", "straight-216", "bridge"]);
    let built = false;
    void tv.TrackView.whenBuilt("bridge").then(() => (built = true));
    await until(() => built);
    expect(built).toBe(true);
    const low = tv.pieceGeometry("bridge", false, 1);
    const shown = tv.pieceGeometry("bridge", false, 3);
    // Its lowest arches, on scaffolding (one more group, the darker wood) down to the ground three levels below;
    // made once (the same one each time it's asked for).
    expect(shown.groups.length).toBe(low.groups.length + 1);
    shown.computeBoundingBox();
    expect(shown.boundingBox!.min.y).toBeCloseTo(-3 * RISER_HEIGHT, -1);
    expect(tv.pieceGeometry("bridge", false, 3)).toBe(shown);
    const asked = jobs.length;
    await until(() => tv.pieceGeometry("bridge", false, 3) !== shown);
    expect(jobs[asked]).toEqual({ type: "bridge", levels: 3 });
    expect(swaps.n).toBeGreaterThan(0);
    const real = tv.pieceGeometry("bridge", false, 3);
    real.computeBoundingBox();
    low.computeBoundingBox();
    // Its arches reach further down than the one-level bridge's.
    expect(real.boundingBox!.min.y).toBeLessThan(low.boundingBox!.min.y - 10);
    // The mirror image is made from it here, without asking the worker again.
    const before = jobs.length;
    expect(tv.pieceGeometry("bridge", true, 3)).not.toBe(tv.pieceGeometry("bridge", true, 1));
    expect(jobs.length).toBe(before);
  }, 30_000);

  it("a worker that goes silent: what's waited for is carved here, one a frame, each swapped in on its own", async () => {
    vi.useFakeTimers();
    const { FakeWorker } = fakeWorkerClass({ silent: true });
    const { tv, swaps } = await carving(FakeWorker, ["straight-216", "curve-large", "bridge"]);
    const stand = [tv.pieceGeometry("straight-216", false, 0), tv.pieceGeometry("curve-large", false, 0), tv.pieceGeometry("bridge", false, 1)];
    // Its first job gets 60 s: nothing's carved here before then.
    await vi.advanceTimersByTimeAsync(59_990);
    expect(swaps.n).toBe(0);
    await vi.advanceTimersByTimeAsync(10);
    // Then carved here one at a time, each its own swap, never two at once (no one long stall).
    const seen: number[] = [];
    for (let i = 0; i < 12; i++) {
      await vi.advanceTimersByTimeAsync(10);
      seen.push(swaps.n);
    }
    expect(seen.every((n, i) => n - (seen[i - 1] ?? 0) <= 1)).toBe(true);
    expect(swaps.n).toBe(3);
    expect(tv.pieceGeometry("straight-216", false, 0)).not.toBe(stand[0]);
    expect(tv.pieceGeometry("bridge", false, 1)).not.toBe(stand[2]);
    // One wanted from now on joins that line too: a stand-in, then its own.
    const later = tv.pieceGeometry("switch-3way", false, 0);
    expect(later.groups.length).toBe(1);
    await vi.advanceTimersByTimeAsync(40);
    expect(tv.pieceGeometry("switch-3way", false, 0)).not.toBe(later);
  }, 30_000);

  it("with no workers at all, pieces are carved when wanted (as before)", async () => {
    const { tv } = await carving(undefined, ["straight-216", "bridge"]);
    expect(tv.pieceGeometry("straight-216", false, 0).groups.length).toBeGreaterThan(1);
    expect(tv.pieceGeometry("bridge", false, 2)).not.toBe(tv.pieceGeometry("bridge", false, 1));
  }, 30_000);
});

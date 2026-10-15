import { afterEach, describe, expect, it, vi } from "vitest";
import { drainQueue, type QueueWorker } from "./worker-queue";

/** A stand-in worker: answers each job (doubling it) after `delay` ms, or never if `silent`. */
function fakeWorker(opts: { silent?: boolean; delay?: number; failOn?: number; garbleOn?: number } = {}): QueueWorker & { sent: number[]; terminated: boolean } {
  const w = {
    sent: [] as number[],
    terminated: false,
    onmessage: null as QueueWorker["onmessage"],
    onmessageerror: null as QueueWorker["onmessageerror"],
    onerror: null as QueueWorker["onerror"],
    postMessage(job: unknown) {
      const n = job as number;
      w.sent.push(n);
      if (opts.silent) return;
      setTimeout(() => {
        if (w.terminated) return;
        if (n === opts.failOn) w.onerror?.({} as ErrorEvent);
        else if (n === opts.garbleOn) w.onmessageerror?.({} as MessageEvent);
        else w.onmessage?.({ data: n * 2 } as MessageEvent);
      }, opts.delay ?? 1);
    },
    terminate() {
      w.terminated = true;
    },
  };
  return w;
}

afterEach(() => vi.useRealTimers());

describe("a worker's job queue", () => {
  it("runs every job, one at a time, and lets the worker go when the queue's empty", async () => {
    const w = fakeWorker();
    const got: number[] = [];
    await drainQueue<number, number>(w, [1, 2, 3], (r) => got.push(r), 1000);
    expect(got).toEqual([2, 4, 6]);
    expect(w.terminated).toBe(true);
  });

  it("gives up on a worker that goes silent, leaving the job it had undone: loading never waits for ever", async () => {
    vi.useFakeTimers();
    const w = fakeWorker({ silent: true });
    const jobs = [1, 2, 3];
    let settled = false;
    const done = drainQueue<number, number>(w, jobs, () => {}, 20_000).then(() => (settled = true));
    await vi.advanceTimersByTimeAsync(19_999);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await done;
    expect(settled).toBe(true);
    expect(w.terminated).toBe(true);
    // Job 1 was lost with the worker; 2 and 3 are still queued for the caller to do another way.
    expect(w.sent).toEqual([1]);
    expect(jobs).toEqual([2, 3]);
  });

  it("stops at a worker that fails, and passes over a result that can't be read", async () => {
    const failing = fakeWorker({ failOn: 2 });
    const got: number[] = [];
    await drainQueue<number, number>(failing, [1, 2, 3], (r) => got.push(r), 1000);
    expect(got).toEqual([2]);
    expect(failing.terminated).toBe(true);

    const garbled = fakeWorker({ garbleOn: 2 });
    const got2: number[] = [];
    await drainQueue<number, number>(garbled, [1, 2, 3], (r) => got2.push(r), 1000);
    expect(got2).toEqual([2, 6]);
  });

  it("passes over jobs no longer wanted, and several workers share one queue", async () => {
    const jobs = [1, 2, 3, 4, 5, 6];
    const got: number[] = [];
    const a = fakeWorker({ delay: 2 });
    const b = fakeWorker({ delay: 3 });
    await Promise.all([a, b].map((w) => drainQueue<number, number>(w, jobs, (r) => got.push(r), 1000, (j) => j === 4)));
    expect(got.sort((x, y) => x - y)).toEqual([2, 4, 6, 10, 12]);
    expect(a.sent.length + b.sent.length).toBe(5);
  });
});

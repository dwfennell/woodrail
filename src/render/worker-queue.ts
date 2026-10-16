/** The part of a Worker a job queue uses (a stand-in in tests). */
export interface QueueWorker {
  postMessage(message: unknown): void;
  terminate(): void;
  onmessage: ((e: MessageEvent) => void) | null;
  onmessageerror: ((e: MessageEvent) => void) | null;
  onerror: ((e: ErrorEvent) => void) | null;
}

/** How many times the usual patience a worker's first job gets. */
export const FIRST_JOB_PATIENCE = 3;

/**
 * Feed `jobs` to a worker one at a time, handing each result to `take`, until the queue is empty. Several workers can
 * share one queue. Settles (and the worker is let go) when the queue's empty, when the worker fails, or when it has
 * been silent `patienceMs` on one job: a job it never finished is left undone, for the caller to do some other way.
 * Its first job gets three times that (it starts up first, and a queue's biggest jobs go first), so a slow phone's
 * worker isn't given up while it's still getting going.
 * Jobs `skip` says are no longer wanted are passed over. A result that can't be read is passed over too.
 */
export function drainQueue<J, R>(worker: QueueWorker, jobs: J[], take: (result: R) => void, patienceMs: number, skip?: (job: J) => boolean): Promise<void> {
  return new Promise((resolve) => {
    let patience: ReturnType<typeof setTimeout> | undefined;
    let first = true;
    const stop = () => {
      clearTimeout(patience);
      worker.onmessage = worker.onmessageerror = worker.onerror = null;
      worker.terminate();
      resolve();
    };
    const next = () => {
      clearTimeout(patience);
      let job = jobs.shift();
      while (job !== undefined && skip?.(job)) job = jobs.shift();
      if (job === undefined) return stop();
      patience = setTimeout(stop, first ? patienceMs * FIRST_JOB_PATIENCE : patienceMs);
      first = false;
      worker.postMessage(job);
    };
    worker.onmessage = (e) => {
      take(e.data as R);
      next();
    };
    worker.onmessageerror = next;
    worker.onerror = stop;
    next();
  });
}

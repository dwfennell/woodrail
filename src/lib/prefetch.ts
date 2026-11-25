/**
 * Fetch the code of sheets and cards a player is likely to open (`lazy`'s `import()`s), once the game has loaded and
 * gone quiet, so the browser's module map holds them before they're wanted. Then they open at once, and still open
 * after a newer deploy has taken the files this tab was built with off the site (the "Couldn't fetch that part of
 * the game" toast stays only for what wasn't fetched yet).
 *
 * Cheap by design: nothing per frame; one `import()` an idle callback, one after another; nothing while the page is
 * hidden (it waits for it to be shown), offline (a failed `import()` stays failed in Chromium till a reload, so one
 * tried offline would fail the real open later), or with Save-Data on. A load that fails is left: the real open
 * tries again and says so.
 */
export type Load = () => Promise<unknown>;

/** What the scheduler asks of the page: swapped in tests. */
export interface PrefetchEnv {
  /** Call `f` after `ms`. */
  later(f: () => void, ms: number): void;
  /** Call `f` when the page is next idle. */
  idle(f: () => void): void;
  hidden(): boolean;
  /** Call `f` once the page is next shown. */
  whenShown(f: () => void): void;
  /** False when the browser says it's offline or the player asked to save data. */
  online(): boolean;
}

/** After the first quiet seconds (`PREFETCH_DELAY_MS`) the loads start, each in an idle moment. */
export const PREFETCH_DELAY_MS = 5000;

export function browserPrefetchEnv(): PrefetchEnv {
  const g = globalThis as {
    requestIdleCallback?: (f: () => void, o?: { timeout: number }) => number;
    navigator?: { onLine?: boolean; connection?: { saveData?: boolean } };
  };
  return {
    later: (f, ms) => void setTimeout(f, ms),
    // (Safari has no requestIdleCallback: a short timeout instead.)
    idle: (f) => (g.requestIdleCallback ? void g.requestIdleCallback(f, { timeout: 10_000 }) : void setTimeout(f, 200)),
    hidden: () => typeof document !== "undefined" && document.visibilityState === "hidden",
    whenShown: (f) => {
      const on = (): void => {
        if (document.visibilityState === "hidden") return;
        document.removeEventListener("visibilitychange", on);
        f();
      };
      document.addEventListener("visibilitychange", on);
    },
    online: () => g.navigator?.onLine !== false && g.navigator?.connection?.saveData !== true,
  };
}

/**
 * Load each of `loads` in turn, the first `delayMs` from now, each in an idle moment while the page is shown and
 * online. Returns a promise for when all have been tried (for tests; the game doesn't wait on it).
 */
export function prefetchWhenIdle(loads: readonly Load[], env: PrefetchEnv = browserPrefetchEnv(), delayMs = PREFETCH_DELAY_MS): Promise<void> {
  return new Promise((done) => {
    let i = 0;
    const next = (): void => {
      if (i >= loads.length) return done();
      if (env.hidden()) return env.whenShown(() => env.idle(next));
      if (!env.online()) return env.later(next, 30_000);
      const load = loads[i++]!;
      let p: Promise<unknown>;
      try {
        p = load();
      } catch {
        p = Promise.resolve();
      }
      p.then(
        () => env.idle(next),
        () => env.idle(next),
      );
    };
    env.later(() => env.idle(next), delayMs);
  });
}

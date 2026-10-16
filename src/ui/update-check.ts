// Tells a running game that a newer build has been deployed: it reads version.json (written by `vite build`) when
// the tab comes back into view, never more than every few minutes, and costs nothing in between.

/** At most one check this often (ms). */
export const MIN_GAP_MS = 10 * 60 * 1000;

/** What version.json holds. */
export interface VersionInfo {
  build?: unknown;
  commit?: unknown;
  builtAt?: unknown;
}

/** Time for another check? (The first, with no earlier check, always is.) */
export function shouldCheck(now: number, lastCheckedAt: number | null, minGapMs = MIN_GAP_MS): boolean {
  return lastCheckedAt === null || now - lastCheckedAt >= minGapMs;
}

/** The fetched build is a real id, and not this one. */
export function isNewer(current: string, fetched: VersionInfo | null | undefined): boolean {
  const build = fetched?.build;
  return typeof build === "string" && build !== "" && build !== current;
}

export interface UpdateCheckOptions {
  currentBuild: string;
  /** Called once, with the new build's id. */
  onNewVersion: (build: string) => void;
}

/** Start watching for a newer deploy. Returns a function that stops it. Does nothing in dev and tests (no build id). */
export function startUpdateCheck({ currentBuild, onNewVersion }: UpdateCheckOptions): () => void {
  if (!currentBuild) return () => {};
  let last: number | null = null;
  let done = false;
  let timer = 0;

  const stop = (): void => {
    done = true;
    clearTimeout(timer);
    document.removeEventListener("visibilitychange", onVisible);
    window.removeEventListener("focus", onFocus);
  };
  async function check(): Promise<void> {
    const now = Date.now();
    if (done || !shouldCheck(now, last)) return;
    last = now;
    try {
      // Relative, so it works under a sub-path; no-store, so a cached copy never hides a new deploy.
      const res = await fetch("version.json", { cache: "no-store" });
      if (!res.ok) return;
      const info = (await res.json()) as VersionInfo;
      if (done || !isNewer(currentBuild, info)) return;
      stop();
      onNewVersion(info.build as string);
    } catch {
      // Offline, or no version.json here: try again next time.
    }
  }
  function onVisible(): void {
    if (document.visibilityState === "visible") void check();
  }
  function onFocus(): void {
    void check();
  }
  // One check after a while, for a tab that stays in view; each one books the next.
  const later = (): void => {
    timer = window.setTimeout(() => {
      void check();
      if (!done) later();
    }, MIN_GAP_MS);
  };

  document.addEventListener("visibilitychange", onVisible);
  window.addEventListener("focus", onFocus);
  later();
  return stop;
}

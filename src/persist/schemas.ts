import type * as SaveSchemas from "./save-schema";

/**
 * The save's Zod schemas (`save-schema.ts`, with Zod: about 90 KB), loaded on their own, not in the first download:
 * asked for as the game starts (main.ts, beside the models and the track carving), and waited for before a save is
 * read. Everything that reads a save (`deserializeWorld`, `loadSession`) runs after that. Tests load them in their
 * setup (`src/test-setup.ts`).
 */
let loaded: typeof SaveSchemas | null = null;
let loading: Promise<void> | null = null;

/** Fetch attempts before giving up, and the wait before the first retry (doubling after), as the models' files. */
const ATTEMPTS = 4;
const FIRST_RETRY_MS = 500;

/**
 * Load the save's schemas (once), retrying a failed fetch with backoff. Rejects if they can't be had (a v1.1.4 player's
 * loading screen hung for good on one failed fetch); a failure is forgotten, so asking again tries again.
 */
export function loadSaveSchemas(fetch: () => Promise<typeof SaveSchemas> = () => import("./save-schema"), retryMs = FIRST_RETRY_MS): Promise<void> {
  loading ??= (async () => {
    for (let attempt = 1; ; attempt++) {
      try {
        loaded = await fetch();
        return;
      } catch (e) {
        if (attempt >= ATTEMPTS) throw e;
        console.warn(`Woodrail: fetching the save's schemas failed (attempt ${attempt} of ${ATTEMPTS}), retrying`, e);
        await new Promise((r) => setTimeout(r, retryMs * 2 ** (attempt - 1)));
      }
    }
  })();
  const p = loading;
  p.catch(() => {
    if (loading === p) loading = null;
  });
  return p;
}

/** The save's schemas: loaded (`loadSaveSchemas`) before any save is read. */
export function saveSchemas(): typeof SaveSchemas {
  if (!loaded) throw new Error("Woodrail: a save was read before its schemas loaded (loadSaveSchemas)");
  return loaded;
}

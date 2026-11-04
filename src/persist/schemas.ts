import type * as SaveSchemas from "./save-schema";

/**
 * The save's Zod schemas (`save-schema.ts`, with Zod: about 90 KB), loaded on their own, not in the first download:
 * asked for as the game starts (main.ts, beside the models and the track carving), and waited for before a save is
 * read. Everything that reads a save (`deserializeWorld`, `loadSession`) runs after that. Tests load them in their
 * setup (`src/test-setup.ts`).
 */
let loaded: typeof SaveSchemas | null = null;
let loading: Promise<void> | null = null;

/** Load the save's schemas (once). */
export function loadSaveSchemas(): Promise<void> {
  return (loading ??= import("./save-schema").then((m) => {
    loaded = m;
  }));
}

/** The save's schemas: loaded (`loadSaveSchemas`) before any save is read. */
export function saveSchemas(): typeof SaveSchemas {
  if (!loaded) throw new Error("Woodrail: a save was read before its schemas loaded (loadSaveSchemas)");
  return loaded;
}

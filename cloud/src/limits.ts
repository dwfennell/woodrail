// (Apart from index.ts: a Worker's main module may export only its handlers.)

export const MODES = ["sandbox", "game"] as const;
/** A bundle's largest size (bytes, gzipped): a big railway is well under 200 KB. */
export const MAX_BYTES = 2 * 1024 * 1024;
/** One PUT per code and mode this often at most (ms): the game uploads at most every 30 s, and when the page hides. */
export const MIN_PUT_INTERVAL_MS = 10_000;

// (Apart from index.ts: a Worker's main module may export only its handlers.)

export const MODES = ["sandbox", "game"] as const;
/** A bundle's largest size (bytes, gzipped): a big railway is well under 200 KB. */
export const MAX_BYTES = 2 * 1024 * 1024;
/** One PUT per code and mode this often at most (ms): the game uploads at most every 30 s, and when the page hides. */
export const MIN_PUT_INTERVAL_MS = 10_000;
/**
 * The copy kept one step back (`<mode>.prev`) is the railway as it was before the player last sat down to play: a PUT
 * moves the copy it replaces there only if that copy had rested this long (ms), or there's none there yet, or the game
 * asks (`X-Keep-Prev: 1`: a restore). Moved on every PUT, it would be the copy from 30 s before, nearly the same.
 */
export const PREV_REST_MS = 10 * 60_000;
/**
 * What a sync-code lookup costs of the per-IP `CODE_LIMIT` (wrangler.toml: 120 a minute): 1, and one that finds nothing
 * `MISS_COST` more (guesses nearly all miss; a player's game nearly always finds its own).
 */
export const MISS_COST = 5;

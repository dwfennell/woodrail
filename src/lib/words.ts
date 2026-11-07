/**
 * English for the game's sentences: a list joined "a, b and c", a capital first letter. Before, the list was written
 * out in nine places (cards, toasts, research text, the town ledger, the map's place names).
 */

/** "a", "a and b", "a, b and c" (`last`: the joining word, "or" for "a, b or c"). An empty list is "". */
export function listed(xs: readonly string[], last = "and"): string {
  return xs.length <= 1 ? (xs[0] ?? "") : `${xs.slice(0, -1).join(", ")} ${last} ${xs[xs.length - 1]}`;
}

/** The text with its first letter a capital. */
export function capital(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

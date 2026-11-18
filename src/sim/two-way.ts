/**
 * Two-way track beyond a signal (the user's complex map, 2026-11-18): plain block signals let two trains of different
 * lines into one stretch of single track from its two ends, each into a free block, and they met between the signals
 * nose to nose for good. A signal shows clear to a train only if no train is coming the other way on the track its way
 * takes beyond it, up to the next place they can pass (`Sim.twoWayGate`: the economy's, a loop's road long enough for
 * it in sections' topology), and none has been let into that track from its far end (the sim's claims, `twoWayBy`).
 * It's the single-line rule sections keep for a managed line's trains (`comingAt`, `comingOnto`: one let into the
 * single track from the far end is coming as surely as one on it), for trains the signals work.
 */

/** A stretch: each piece, with the ends a train going into it comes onto it by and leaves it by (−1: a stop it ends at). */
export type Stretch = ReadonlyMap<number, { entry: number; exit: number }>;

/**
 * Do two trains going through these stretches meet head on: on a piece of both (of `b`'s, from its `from`th on), one
 * leaving it by the end the other comes onto it by?
 */
export function meetHeadOn(a: Stretch, b: Stretch, from = 0): boolean {
  let k = 0;
  for (const [p, t] of b) {
    if (k++ < from) continue;
    const s = a.get(p);
    if (s && (s.entry === t.exit || s.exit === t.entry)) return true;
  }
  return false;
}

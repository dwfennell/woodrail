/**
 * Picks the drawing resolution (pixel ratio). Phones get their screen's full density, which is sharp but costly, and
 * step down a notch whenever frames come too slowly while something moves. It never steps back up in a session, so it
 * can't see-saw between sharp and slow.
 */

/** Steps down to, from the device's own density. */
export const RATIO_STEPS = [3, 2.25, 1.5];
/** Frames slower than this on average (ms, against the game's 30 fps cap) are too slow. */
export const SLOW_FRAME_MS = 42;
/** How many frames drawn in a row are averaged before judging. */
export const SAMPLE_FRAMES = 30;

export class ResolutionGovernor {
  private ratio: number;
  private last = -Infinity;
  private total = 0;
  private count = 0;

  constructor(
    deviceRatio: number,
    maxRatio: number,
    private readonly minRatio: number,
  ) {
    this.ratio = Math.max(Math.min(deviceRatio, maxRatio), Math.min(deviceRatio, minRatio));
  }

  /** Frames before this time (ms) aren't judged. */
  private restUntil = -Infinity;

  /**
   * Don't judge frames until `until` (ms): the first frames after the map is built or shown are slow while shaders
   * compile and geometry uploads, which says nothing about how fast it draws once settled.
   */
  rest(until: number): void {
    this.restUntil = until;
    this.total = 0;
    this.count = 0;
  }

  get current(): number {
    return this.ratio;
  }

  /**
   * A frame was drawn at `time` (ms); `continuous` if the frame before it was drawn too (a gap after a pause is not a
   * slow frame). Returns the new ratio when it should change, else null.
   */
  frameDrawn(time: number, continuous: boolean): number | null {
    const gap = time - this.last;
    this.last = time;
    if (!continuous || time < this.restUntil) {
      this.total = 0;
      this.count = 0;
      return null;
    }
    this.total += gap;
    if (++this.count < SAMPLE_FRAMES) return null;
    const slow = this.total / this.count > SLOW_FRAME_MS;
    this.total = 0;
    this.count = 0;
    if (!slow) return null;
    const next = RATIO_STEPS.find((r) => r < this.ratio - 0.01 && r >= this.minRatio);
    if (next === undefined) return null;
    this.ratio = next;
    return next;
  }
}

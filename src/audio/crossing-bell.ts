import { Gate } from "./audio";

/** Level crossings' bells ring at most once in this long, however many close (ms). */
export const CROSSING_BELL_GAP_MS = 2500;
/** A crossing quieter than this (`listen`'s volume: far from the camera's focus) isn't rung. */
export const CROSSING_BELL_MIN_VOLUME = 0.3;

/**
 * Which level crossing's bell rings as barriers come down: of the crossings closing this frame, the loudest one the
 * camera can see (`hear` gives its volume and pan, or null when it's off the screen), if it's near enough, and only
 * once a `CROSSING_BELL_GAP_MS` (a busy map doesn't jangle). Frames with nothing closing cost one length check.
 */
export class CrossingBells {
  private readonly gate = new Gate(CROSSING_BELL_GAP_MS);

  ring(closing: readonly { x: number; z: number }[], now: number, hear: (x: number, z: number) => [number, number] | null): [number, number] | null {
    if (closing.length === 0) return null;
    let best: [number, number] | null = null;
    for (const c of closing) {
      const heard = hear(c.x, c.z);
      if (heard && heard[0] >= CROSSING_BELL_MIN_VOLUME && (!best || heard[0] > best[0])) best = heard;
    }
    if (!best || !this.gate.open(now)) return null;
    return best;
  }
}

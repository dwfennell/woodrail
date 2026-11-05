import type { Progress } from "./progress";

/**
 * Time control (late-game spec, Clockmaker CA: docs/superpowers/specs/2026-11-04-late-game-design.md). Learning
 * Clockmaker puts a clock on the HUD: a tap runs the railway at 2× (the sim takes twice the steps a frame, and every
 * clock on game time with it: research, the workshop, harbours, people coming to stations, the calendar). Learning
 * Clock tower (once a town is a city) adds 3×.
 *
 * Phones: a frame at 3× costs about three times the sim's CPU. `SlowWatch` sees the sim falling behind (its steps
 * cut short by the per-frame cap, or the sim alone over `SIM_BUDGET_MS` a frame) and asks for a slower speed: 3× drops
 * to 2×, 2× to 1×, said in a toast.
 */

/** The speeds a game can run at, in the order a tap on the clock goes through them. */
export const SPEEDS = [1, 2, 3] as const;
export type Speed = (typeof SPEEDS)[number];

/** The speeds open now: 1× always, 2× with Clockmaker, 3× with Clock tower too. */
export function speedsOpen(p: Pick<Progress, "learned">): Speed[] {
  const out: Speed[] = [1];
  if (p.learned.has("clockmaker")) out.push(2);
  if (p.learned.has("clockmaker") && p.learned.has("clock-tower")) out.push(3);
  return out;
}

/** The next speed a tap on the clock sets (round to 1× after the fastest open). */
export function nextSpeed(now: number, open: readonly Speed[]): Speed {
  const i = open.indexOf(now as Speed);
  return open[(i + 1) % open.length] ?? 1;
}

/** One step slower (the slow-phone fallback): 3× to 2×, 2× to 1×. */
export const slower = (now: number): Speed => (now >= 3 ? 2 : 1);

/** The sim's own time a frame (ms) that's too much on a phone: half a 30-a-second frame. */
export const SIM_BUDGET_MS = 16;
/** Frames looked at, and how many of them falling behind make a phone too slow for the speed. */
export const SLOW_WINDOW = 90;
export const SLOW_FRAMES = 45;

/** Watches the frames run at more than 1× for the sim falling behind (see the file's note). */
export class SlowWatch {
  private frames = 0;
  private behind = 0;

  /** One frame: `capped` (its steps cut short) and the sim's time (ms). True: too slow, go slower (and start again). */
  record(capped: boolean, simMs: number): boolean {
    this.frames++;
    if (capped || simMs > SIM_BUDGET_MS) this.behind++;
    if (this.frames < SLOW_WINDOW) return false;
    const slow = this.behind >= SLOW_FRAMES;
    this.frames = 0;
    this.behind = 0;
    return slow;
  }

  reset(): void {
    this.frames = 0;
    this.behind = 0;
  }
}

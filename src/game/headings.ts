/**
 * How a piece may be turned by hand. Turn (the tray's button, R) steps an eighth, as the curves do (`CURVE_SWEEP`:
 * eight make a circle). Finer turns (a two-finger twist on a held piece, Shift+R, Shift on Turn) go in 15° steps: 3 to
 * an eighth, so every eighth is one of them, and a curve laid on a piece held at 15° or 30° still turns
 * 45° and eight still close a loop. A twist sticks to the eighths (`STICK`): a finger's wobble near one stays on it.
 * Seated on a free end, a piece takes that end's heading whatever it's held at (`findSnap`): these are for loose pieces.
 */
import { CURVE_SWEEP } from "../track/constants";

/** Turn's step: an eighth, a curve's sweep. */
export const COARSE_STEP = CURVE_SWEEP;
/** The fine step: a third of an eighth (15°). */
export const FINE_STEP = COARSE_STEP / 3;
/** A twist within this of an eighth lands on it (wider than the 7.5° plain rounding gives it). */
export const STICK = (10 * Math.PI) / 180;
const EPS = 1e-6;

/** `h` in [0, 2π). */
export function wrap(h: number): number {
  const t = 2 * Math.PI;
  const r = h % t;
  return r < 0 ? r + t : r;
}

/** The fine heading nearest `h`, or the eighth when one is within `STICK`. */
export function snapHeading(h: number): number {
  const coarse = Math.round(h / COARSE_STEP) * COARSE_STEP;
  if (Math.abs(h - coarse) <= STICK) return coarse;
  return Math.round(h / FINE_STEP) * FINE_STEP;
}

/**
 * Turn's step from `h`: the next eighth on (`dir` 1) or back (-1). Held at an eighth, that's an eighth on; held in
 * between (twisted to 15°), the eighth just past it, so one Turn always puts a piece back on the eighths.
 */
export function nextCoarse(h: number, dir: 1 | -1 = 1): number {
  const k = h / COARSE_STEP;
  return (dir > 0 ? Math.floor(k + EPS) + 1 : Math.ceil(k - EPS) - 1) * COARSE_STEP;
}

/** A fine step from `h` (on the fine headings: a piece held off them first lands on the next one). */
export function nextFine(h: number, dir: 1 | -1 = 1): number {
  const k = h / FINE_STEP;
  return (dir > 0 ? Math.floor(k + EPS) + 1 : Math.ceil(k - EPS) - 1) * FINE_STEP;
}

/** Is `h` one of the fine headings (within a hair)? */
export function onFine(h: number): boolean {
  const k = h / FINE_STEP;
  return Math.abs(k - Math.round(k)) < 1e-4;
}

/** The smallest turn (radians, signed, in (−π, π]) that takes heading `from` to `to`. */
export function turnBetween(from: number, to: number): number {
  let d = wrap(to - from);
  if (d > Math.PI) d -= 2 * Math.PI;
  return d;
}

/**
 * A two-finger twist: the line between the fingers was at angle `start` (world plan radians) when the second finger
 * went down, with the piece held at `base`; it's at `now`. The piece turns as the line does, on the fine headings.
 */
export function twistHeading(base: number, start: number, now: number): number {
  const d = turnBetween(start, now);
  // (Till the fingers have turned half a step, as held: a piece lying off the fine headings, picked up, stays so.)
  if (Math.abs(d) < FINE_STEP / 2) return base;
  return snapHeading(base + d);
}

import type { DragTarget } from "./drag-rule";

/**
 * Long-press to pick up, on touch: a finger that rests on a piece, a train, a placed industry or cargo picks it up into a
 * drag without selecting it first. A finger that moves first pans, as it always has (see `dragMoves`), so panning a busy
 * map never grabs anything; a quick tap still selects (or, on cargo, moves it).
 *
 * HOLD_MS: 380 ms. Long enough that a finger landing to pan (which moves within a frame or two) or a tap (well under
 * 250 ms) never counts; shorter than the 500 ms the phone's own long-press menus take, since here it's the main way to
 * move things and should feel quick, not like waiting for a menu.
 *
 * HOLD_SLOP: 10 px. A finger held still wobbles a few pixels; 10 is what a tap allows here (and about what iOS allows a
 * long press), so a deliberate hold isn't spoilt by a tremble, while a pan has left it within its first frames.
 *
 * It's decided by when things happened (the events' own timestamps), not by which arrives first: on a slow phone the
 * moves of a pan can be delivered after the hold's timer, and the timer can fire late after a real hold.
 */
export const HOLD_MS = 380;
export const HOLD_SLOP = 10;

/**
 * Long-press on a switch's lever to pin it (or unpin it), with a mouse as well as a finger: PIN_HOLD_MS, 450 ms. A
 * little longer than a pickup's hold, since a lever is tapped often (a tap flips it) and a slow tap mustn't pin, and
 * nothing lifts under the finger to say it's coming; still short of the phone's own long-press menus. Decided as a
 * pickup's hold is (`decideHold`, `undoesHold` with this time).
 */
export const PIN_HOLD_MS = 450;

/**
 * What can be picked up with a long press: track, a train, an industry, cargo off a pile or a wagon (props and roads
 * still want selecting first).
 */
export function holdPicksUp(target: DragTarget, pointerType: string): boolean {
  if (pointerType === "mouse") return false;
  return target === "piece" || target === "car" || target === "depot" || target === "cargo";
}

/** Where a press that may become a hold has got to. */
export type HoldOutcome = "wait" | "hold" | "pan" | "cancel";

/**
 * A press that may become a hold: `strayedAt` is when (ms after it came down, by the events' timestamps) the finger
 * first went `HOLD_SLOP` or more from where it came down, or null if it hasn't; `elapsed` is how long it's been down as
 * of the latest event seen (or now); `touches` the fingers on the screen. A second finger cancels it (two fingers move
 * the view). If it strayed before `HOLD_MS` it's a pan, whenever that move is delivered; if it rested `HOLD_MS` first
 * it's a hold, even if it has moved since (it was picked up, then dragged) or the timer that checks it ran late.
 */
export function decideHold(strayedAt: number | null, elapsed: number, touches: number, ms = HOLD_MS): HoldOutcome {
  if (touches > 1) return "cancel";
  if (strayedAt !== null && strayedAt < ms) return "pan";
  if (elapsed >= ms || strayedAt !== null) return "hold";
  return "wait";
}

/**
 * After a pickup made by the hold's timer (no move seen yet), an event delivered late: does it show the press wasn't a
 * hold after all? Yes if it happened (`at`, ms after the press, by its own timestamp) before `HOLD_MS` and the finger
 * had then strayed past the slop (a pan) or been lifted (a tap).
 */
export function undoesHold(at: number, travel: number, lifted: boolean, ms = HOLD_MS): boolean {
  return at < ms && (lifted || travel >= HOLD_SLOP);
}

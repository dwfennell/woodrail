import type { DragTarget } from "./drag-rule";

/**
 * Long-press to pick up, on touch: a finger that rests on a piece, a train or a placed industry picks it up into a drag
 * without selecting it first. A finger that moves first pans, as it always has (see `dragMoves`), so panning a busy map
 * never grabs anything; a quick tap still selects.
 *
 * HOLD_MS: 380 ms. Long enough that a finger landing to pan (which moves within a frame or two) or a tap (well under
 * 250 ms) never counts; shorter than the 500 ms the phone's own long-press menus take, since here it's the main way to
 * move things and should feel quick, not like waiting for a menu.
 *
 * HOLD_SLOP: 10 px. A finger held still wobbles a few pixels; 10 is what a tap allows here (and about what iOS allows a
 * long press), so a deliberate hold isn't spoilt by a tremble, while a pan has left it within its first frames.
 */
export const HOLD_MS = 380;
export const HOLD_SLOP = 10;

/** What can be picked up with a long press: track, a train, an industry (props and roads still want selecting first). */
export function holdPicksUp(target: DragTarget, pointerType: string): boolean {
  if (pointerType === "mouse") return false;
  return target === "piece" || target === "car" || target === "depot";
}

/** Where a press that may become a hold has got to. */
export type HoldOutcome = "wait" | "hold" | "pan" | "cancel";

/**
 * A press that may become a hold, after `elapsed` ms, having strayed at most `travel` px from where it came down, with
 * `touches` fingers on the screen: a second finger cancels it (two fingers move the view); straying past the slop
 * makes it a pan; resting long enough makes it a hold. Straying is checked first: a finger that moved and then stopped
 * is still a pan.
 */
export function holdOutcome(elapsed: number, travel: number, touches: number): HoldOutcome {
  if (touches > 1) return "cancel";
  if (travel >= HOLD_SLOP) return "pan";
  if (elapsed >= HOLD_MS) return "hold";
  return "wait";
}

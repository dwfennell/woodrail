/**
 * Does a drag that starts on something placed move it, or pan the view? On touch (and a pen) something has to be
 * selected first, so a finger panning a busy map never grabs a piece by accident; a mouse moves track, trains and
 * industries straight away, as it always has. Props and road pieces want selecting first either way (a busy town).
 */
export type DragTarget = "piece" | "car" | "depot" | "prop" | "road";

export function dragMoves(target: DragTarget, selected: boolean, pointerType: string): boolean {
  if (selected) return true;
  if (target === "prop" || target === "road") return false;
  return pointerType === "mouse";
}

/**
 * How far (px) a press may move and still be a tap, and so how far it must go to become a drag (of what's pressed, or
 * of the view): a mouse 6, a finger (or a pen) 10, as a finger wobbles more (the same as `HOLD_SLOP`). One figure for
 * both, so a finger's tap on something selected (a turntable's deck, a switch's lever) is never taken for a drag of it.
 */
export function dragSlop(pointerType: string): number {
  return pointerType === "mouse" ? 6 : 10;
}

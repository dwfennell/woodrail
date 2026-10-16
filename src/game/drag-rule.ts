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

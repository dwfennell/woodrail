/** What happens to a dragged piece when it's let go. */
export type DropOutcome = "place" | "return" | "to-tray" | "delete";

/**
 * - over the tray: a moved piece is deleted (undo brings it back); a new one just goes back in the box;
 * - blocked by the landscape: a moved piece floats back where it was; a new one goes back to the tray;
 * - otherwise it's put down.
 */
export function dropOutcome(d: { blocked: boolean; overTray: boolean; isNew: boolean }): DropOutcome {
  if (d.overTray) return d.isNew ? "to-tray" : "delete";
  if (d.blocked) return d.isNew ? "to-tray" : "return";
  return "place";
}

/**
 * Why a depot held over a line can't go there, from the placement check's reason (`placed`) and what's said over the
 * line (`splice`: "splice-busy", a train on the straight; "splice-fit"; "splice-onto"), or null if it can go. On other
 * track, the line's reason says what would work. A train on the straight is said whatever else is in the way (a house
 * it's held slanting across): the line is where it's meant to go.
 */
export function heldReason<R extends string>(placed: R | null, splice: R | null): R | null {
  if (!placed || !splice) return placed;
  return placed === "piece" || splice === "splice-busy" ? splice : placed;
}

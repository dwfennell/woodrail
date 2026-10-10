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

import type { PieceDef } from "../track/pieces";

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

/** Said for a refusal with no reason of its own to give: a piece is never refused in silence. */
export const REFUSED_FALLBACK = "It can't go there";

/** What to say for a refused drop: its own reason, or `REFUSED_FALLBACK` if it has none (blank). */
export function refusalText(why: string | null | undefined): string {
  return why && why.trim() ? why : REFUSED_FALLBACK;
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

/**
 * A piece just put down: its free ends a line runs on from (where the next of its kind waits for a tap), by connector
 * index. `joined[i]`: is end i joined to other track. An end is onward if a path runs to it from a joined end; put down
 * on its own, if a path runs through it to another end. A terminus (its roads end at buffers) and a buffer stop have
 * none, nor a turntable (its roads lead to stalls and lines, never on to another turntable).
 */
export function onwardEnds(def: Pick<PieceDef, "paths" | "gated">, joined: readonly boolean[]): number[] {
  if (def.gated) return [];
  const alone = !joined.some(Boolean);
  const out = new Set<number>();
  for (const p of def.paths) {
    if (p.to === null) continue;
    if ((alone || joined[p.from]) && !joined[p.to]) out.add(p.to);
    if ((alone || joined[p.to]) && !joined[p.from]) out.add(p.from);
  }
  return [...out].sort((a, b) => a - b);
}

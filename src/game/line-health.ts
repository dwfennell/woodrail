import type { TrainState } from "./engine-status";

/**
 * A line's health for the Lines list, from what its trains are doing (`trainState`): the worst of them.
 * - "none": no train runs it;
 * - "stuck": one is stuck for good, off the track, can't move (too heavy, no power, no rack engine), or stands at a red
 *   switch against its way: it needs the player;
 * - "waiting": every train stands waiting (at a signal, points, a loop, spacing, its lever off): nothing's wrong yet;
 * - "moving": a train runs, or is loaded or unloaded at a stop.
 */
export type LineHealth = "none" | "moving" | "waiting" | "stuck";

const STUCK: ReadonlySet<TrainState["kind"]> = new Set(["stuck", "derailed", "too-heavy", "no-power", "rack", "red-switch"]);
const WAITING: ReadonlySet<TrainState["kind"]> = new Set(["red-signal", "line-wait-for", "spacing", "line-wait", "needs-loop", "full-wait", "points-wait", "held-up", "stopped", "lift-bridge", "at-stop", "lift"]);

export function lineHealth(states: readonly TrainState[]): LineHealth {
  if (states.length === 0) return "none";
  if (states.some((s) => STUCK.has(s.kind))) return "stuck";
  if (states.every((s) => WAITING.has(s.kind))) return "waiting";
  return "moving";
}

/** The pill's words: "Moving", "Waiting", "Stuck: needs you", "No trains". */
export const HEALTH_WORDS: Readonly<Record<LineHealth, string>> = { moving: "Moving", waiting: "Waiting", stuck: "Stuck: needs you", none: "No trains" };

/** Lines in the list, problems first: stuck, then no trains, then waiting, then moving; by name within each. */
export const HEALTH_ORDER: Readonly<Record<LineHealth, number>> = { stuck: 0, none: 1, waiting: 2, moving: 3 };

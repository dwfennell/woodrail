/**
 * Goals ticked close together are one toast and one News line ("2 goals done: A · B"). Close by game time (goals met
 * while paused, or on one busy frame, are one line), but never more than a few seconds by the clock either: after a
 * long pause, a goal is news of its own, not a rewrite of an old line.
 */

/** Goals ticked this close in game time (s) join. */
export const GOALS_JOIN_S = 2.5;
/** ...and this close by the clock (ms): the window clamped while paused. */
export const GOALS_JOIN_WALL_MS = 4000;
/** A goal ticked this soon after a town's growth (game s) joins its News entry. */
export const GROWTH_JOIN_S = 1.5;
/** Goals named in a merged toast; more are "…" (the News line names them all). */
export const TOAST_TITLES = 2;

/** A moment (game s, clock ms) a later one may join. */
export interface Moment {
  at: number;
  wallAt: number;
}

/** Is now (game s, clock ms) within `windowS` of game time, and the clamp by the clock, of `m`? */
export function joins(m: Moment, now: number, wallNow: number, windowS: number, wallMs = GOALS_JOIN_WALL_MS): boolean {
  return now - m.at < windowS && wallNow - m.wallAt < wallMs;
}

/** "✓ A", or "2 goals done: A · B", or, with `cap`, "4 goals done: A · B · …". */
export function goalsDoneText(titles: readonly string[], cap = Infinity): string {
  if (titles.length === 1) return `✓ ${titles[0]}`;
  const named = titles.length > cap ? [...titles.slice(0, cap), "…"] : titles;
  return `${titles.length} goals done: ${named.join(" · ")}`;
}

/** What to say for goals just ticked: a new toast and News line, or the last ones' changed. */
export type GoalTickSay =
  | { kind: "new"; toast: string; news: string }
  | { kind: "merge"; oldToast: string; toast: string; news: string };

/** The latest goals ticked, a moment apart at most: the next ones join their toast and News line. */
export class GoalTicks {
  private run: (Moment & { titles: string[]; toast: string }) | null = null;

  /**
   * Goals ticked now (game s, clock ms). They join the last ones if those were a moment ago and their toast is still up
   * or waiting (`toastUp`): a goal whose toast has gone isn't said again.
   */
  tick(titles: readonly string[], now: number, wallNow: number, toastUp: (toast: string) => boolean): GoalTickSay {
    const r = this.run;
    if (r && joins(r, now, wallNow, GOALS_JOIN_S) && toastUp(r.toast)) {
      const oldToast = r.toast;
      r.titles.push(...titles);
      r.at = now;
      r.wallAt = wallNow;
      r.toast = goalsDoneText(r.titles, TOAST_TITLES);
      return { kind: "merge", oldToast, toast: r.toast, news: goalsDoneText(r.titles) };
    }
    const toast = goalsDoneText(titles, TOAST_TITLES);
    this.run = { titles: [...titles], at: now, wallAt: wallNow, toast };
    return { kind: "new", toast, news: goalsDoneText(titles) };
  }

  /** The News line wasn't written: nothing to join. */
  drop(): void {
    this.run = null;
  }
}

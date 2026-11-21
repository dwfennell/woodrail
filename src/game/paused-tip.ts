import type { Situation } from "./situation-tips";

/**
 * Situation help's "The game is paused" (detector #5, spec docs/superpowers/specs/2026-11-18-situation-help.md): a
 * player who paused, forgot, and wonders why the trains stand still (#45: "apparently I had paused the game. oops.").
 *
 * Not one of the tracker's detectors: those look on the game's clock, which stands still while paused. This one is on
 * the wall clock, asked from the goals' check (about once a wall second, paused too, never per frame), and reads two
 * things main keeps anyway: the train card open, and the layout's version.
 *
 * Said when the game is paused and the player opens a train's card (a tap on an engine, Go), or lays track for two
 * minutes of being paused; never in the first 10 s after they pressed Pause themselves (they know). Once a session,
 * even if dismissed (it's cheap to hit again, and a reload is a new session). Gone as soon as the game runs.
 */

/** No tip this soon (wall s) after the player pressed Pause. */
export const PAUSE_GRACE_S = 10;
/** Paused this long (wall s) while laying track: said. */
export const PAUSED_BUILDING_S = 120;

export const PAUSED: Situation = {
  id: "paused",
  key: "paused",
  title: "The game is paused",
  short: "Paused",
  text: "Trains stand still while it's paused. Tap the play button to run them.",
  toast: "The game is paused",
  fixed: "",
};

/** What main reads for it, each check. */
export interface PausedLook {
  /** Wall s (performance.now() / 1000). */
  now: number;
  paused: boolean;
  /** The engine whose card is open (-1: none). */
  card: number;
  /** The layout's pieces version (track laid or lifted). */
  track: number;
  /** The tutorial, ☰ Tips off: nothing said. */
  quiet: boolean;
}

export class PausedTip {
  /** When it went paused (wall s), and whether by the player's own Pause (not a save read back paused). */
  private since = 0;
  private byPlayer = false;
  private wasPaused: boolean | null = null;
  private lastCard = -1;
  /** The track version when it went paused. */
  private trackAt = 0;
  private shownNow = false;
  /** Said already this session (shown, dismissed or not). */
  private said = false;

  /**
   * One check. `first`: it's just been said (toast it); `changed`: shown or gone. The first check's pause is a save's
   * (or the page's): no grace, a tap on a train says it at once.
   */
  update(l: PausedLook): { first: boolean; changed: boolean } {
    if (this.wasPaused === null) {
      this.wasPaused = l.paused;
      this.since = l.now;
      this.trackAt = l.track;
      this.lastCard = l.card;
    } else if (l.paused !== this.wasPaused) {
      this.wasPaused = l.paused;
      if (l.paused) {
        this.since = l.now;
        this.byPlayer = true;
        this.trackAt = l.track;
      }
    }
    const opened = l.card !== -1 && l.card !== this.lastCard;
    this.lastCard = l.card;
    if (!l.paused) {
      const changed = this.shownNow;
      this.shownNow = false;
      return { first: false, changed };
    }
    if (this.said || l.quiet) {
      // (Quiet, a tip showing goes: ☰ Tips off.)
      const changed = this.shownNow && l.quiet;
      if (changed) this.shownNow = false;
      return { first: false, changed };
    }
    const held = l.now - this.since;
    if (this.byPlayer && held < PAUSE_GRACE_S) return { first: false, changed: false };
    const building = l.track !== this.trackAt && held >= PAUSED_BUILDING_S;
    if (!opened && !building) return { first: false, changed: false };
    this.said = true;
    this.shownNow = true;
    return { first: true, changed: true };
  }

  current(): Situation | null {
    return this.shownNow ? PAUSED : null;
  }

  /** Got it: gone (and not again this session, as it would be anyway). */
  dismiss(): void {
    this.shownNow = false;
  }
}

import type { ExplainerId } from "../ui/explainer-keys";
import type { World } from "./world";

/**
 * Situation help (docs/superpowers/specs/2026-11-18-situation-help.md): a 💡 tip when the player is stuck in a way the
 * game can see (trains queuing for a whole stretch a signal could split, and later more), in the feature tips' row
 * under the goals. Not a goal and never a modal: one at a time, never in the tutorial, toasted once a kind a game, and
 * gone for good with Got it.
 *
 * Detectors read what the sim keeps anyway (sections' waits, the stall classifier), each on its own interval of game
 * time, from the goals' check (about once a game second, never per frame, nothing while paused).
 */

/** A situation found on the map: what to say, and where. */
export interface Situation {
  /** The detector's id (its kind): "jam-follow". */
  readonly id: string;
  /** What it's about (a line, a depot), so the same one isn't taken for a new one. */
  readonly key: string;
  /** The row's title: "Trains queuing on the Red line". */
  readonly title: string;
  /** The chip's, short: "Trains queuing". */
  readonly short: string;
  /** What's wrong and the fix, a line or two. */
  readonly text: string;
  /** The toast, one short line. */
  readonly toast: string;
  /** Its "Learn more" sheet, if it has one. */
  readonly more?: ExplainerId;
  /** The words of its ✓ toast when the player's fix clears it. */
  readonly fixed: string;
  /** Where Show where goes: a signal spot (a joint end) and the train it's for. */
  readonly signalAt?: number;
  readonly engine?: number;
}

/** What a detector may ask beyond the world. */
export interface SituationContext {
  /** Blueprints learned (null: Sandbox, everything at hand). */
  learned: ReadonlySet<string> | null;
  /** A depot's name as a stop says it ("the sawmill", "Elder"). */
  nameOf(depotId: number): string;
}

export interface Detector {
  readonly id: string;
  /** How often it looks (game s). */
  readonly every: number;
  /** How long it must be found, looked for each time, before it's said (game s). */
  readonly hold: number;
  /**
   * How long a tip showing stays after it was last found (game s): a situation that comes and goes (a queue that
   * forms on each trip) stays said between times, so the player can act on it.
   */
  readonly linger?: number;
  look(w: World, ctx: SituationContext): Situation | null;
}

/** Queuing, a signal helps (detector #1): a line's trains waiting for the whole stretch, going the same way. */
export const JAM_FOLLOW: Detector = {
  id: "jam-follow",
  // (Sections' own hint holds the wait 20 s first, and the queue clears a moment later, so it's looked for each game
  // second, as the follow toast was, and said when first found. Then it stays while trains keep queuing.)
  every: 1,
  hold: 0,
  linger: 120,
  look(w, ctx) {
    // (Signals come with "Signals and routes", whose id is "routes": an old save's "signals" is renamed to it.)
    if (ctx.learned && !ctx.learned.has("routes")) return null;
    const f = w.economy.sections.followWait();
    if (!f) return null;
    // (Keyed on the stall classifier: a train said stuck is another situation, whose fix is not a signal.)
    if (w.economy.stalls.stuckOf(f.engine) || w.economy.stalls.stuckOf(f.lead)) return null;
    const lineId = w.economy.lineIdOf.get(f.engine);
    const line = lineId === undefined ? undefined : w.economy.lines.get(lineId);
    if (!line) return null;
    const route = w.economy.routeOf(f.engine);
    const next = route && route.stops.length > 0 ? route.stops[route.next % route.stops.length].depotId : -1;
    const to = next >= 0 ? ctx.nameOf(next) : "";
    return {
      id: "jam-follow",
      key: `line:${line.id}`,
      title: `Trains queuing on the ${line.name}`,
      short: "Trains queuing",
      text: `Each train waits until the one ahead ${to ? `reaches ${to}` : "is through"}. A signal halfway lets the next one start sooner.`,
      toast: `${line.name} trains are stuck in a queue`,
      more: "signals",
      fixed: "✓ They follow now",
      signalAt: f.at,
      engine: f.engine,
    };
  },
};

/** The detectors, first first: the one shown is the first found (and held) of them. */
export const DETECTORS: readonly Detector[] = [JAM_FOLLOW];

/** When the tips may speak at all. */
export interface SituationGate {
  /** The game's clock (s). */
  now: number;
  /** Off by ☰ Tips, in the tutorial, or something else is talking (a card or sheet open, a toast just up). */
  quiet: boolean;
}

/** No tip in a game's first minutes, nor soon after another one went (game s). */
export const FIRST_AFTER_S = 120;
export const GAP_S = 120;
/** A tip that clears by itself waits this long before it may come back (game s). */
export const SNOOZE_S = 600;
/**
 * Cleared, and the player looked at it (Show where, Learn more) no more than this long before it was last found:
 * their fix. Then it's done (game s).
 */
export const FIX_WINDOW_S = 60;
/** Shown this many times in a game, it doesn't come back. */
export const MAX_SHOWS = 3;

export interface SituationSave {
  done: string[];
  toasted: string[];
  snoozed: Record<string, number>;
  shows: Record<string, number>;
}

const known = (detectors: readonly Detector[]) => new Set(detectors.map((d) => d.id));

/**
 * Which situation tip shows (one at a time), and what's done (Got it, fixed, or shown too often), snoozed and toasted:
 * saved with the game's session, so another game starts afresh.
 */
export class SituationTracker {
  private readonly done: Set<string>;
  private readonly toasted: Set<string>;
  private readonly snoozed: Map<string, number>;
  private readonly shows: Map<string, number>;
  /** Each detector's last look: when, what it found, and since when it's been found. */
  private readonly looks = new Map<string, { at: number; found: Situation | null; since: number; lastFound: number }>();
  private shown: Situation | null = null;
  /** When the tip showing was looked at (Show where, Learn more), or −∞. */
  private lookedAt = -Infinity;
  /** When the last tip went (game s). */
  private wentAt = -Infinity;

  constructor(
    save: Partial<SituationSave> | null = null,
    private readonly detectors: readonly Detector[] = DETECTORS,
  ) {
    const ids = known(detectors);
    this.done = new Set((save?.done ?? []).filter((id) => ids.has(id)));
    this.toasted = new Set((save?.toasted ?? []).filter((id) => ids.has(id)));
    this.snoozed = new Map(Object.entries(save?.snoozed ?? {}).filter(([id, t]) => ids.has(id) && Number.isFinite(t)));
    this.shows = new Map(Object.entries(save?.shows ?? {}).filter(([id, n]) => ids.has(id) && Number.isFinite(n)));
  }

  /**
   * Look (each detector when it's due), and say what changed: `first` a tip shown for the first time this game (to
   * toast), `fixed` one the player's fix cleared (its ✓ toast), `changed` if the tip shown or what's saved moved on.
   */
  update(w: World, ctx: SituationContext, gate: SituationGate): { first: Situation | null; fixed: Situation | null; changed: boolean } {
    const now = gate.now;
    let changed = false;
    let fixed: Situation | null = null;
    for (const d of this.detectors) {
      if (this.done.has(d.id)) continue;
      const last = this.looks.get(d.id);
      if (last && now - last.at < d.every && now >= last.at) continue;
      const found = d.look(w, ctx);
      const since = found ? (last?.found ? last.since : now) : now;
      this.looks.set(d.id, { at: now, found, since, lastFound: found ? now : (last?.lastFound ?? -Infinity) });
    }
    // The tip showing: still so, or gone (fixed by the player, or by itself).
    if (this.shown) {
      const look = this.looks.get(this.shown.id);
      const linger = this.detectors.find((d) => d.id === this.shown!.id)?.linger ?? 0;
      if (!look?.found && now - (look?.lastFound ?? -Infinity) >= linger) {
        const id = this.shown.id;
        if (this.lookedAt >= (look?.lastFound ?? -Infinity) - FIX_WINDOW_S) {
          this.done.add(id);
          fixed = this.shown;
        } else if ((this.shows.get(id) ?? 0) >= MAX_SHOWS) this.done.add(id);
        else this.snoozed.set(id, now + SNOOZE_S);
        this.shown = null;
        this.wentAt = now;
        this.lookedAt = -Infinity;
        changed = true;
      } else if (look?.found && (look.found.key !== this.shown.key || look.found.text !== this.shown.text)) {
        // (The same kind, about something else now, or its words moved on: kept, with the new.)
        this.shown = look.found;
        changed = true;
      }
    }
    let first: Situation | null = null;
    if (!this.shown && !gate.quiet && now >= FIRST_AFTER_S && now - this.wentAt >= GAP_S) {
      for (const d of this.detectors) {
        if (this.done.has(d.id) || (this.snoozed.get(d.id) ?? -Infinity) > now) continue;
        const look = this.looks.get(d.id);
        if (!look?.found || now - look.since < d.hold) continue;
        this.shown = look.found;
        this.shows.set(d.id, (this.shows.get(d.id) ?? 0) + 1);
        if (!this.toasted.has(d.id)) {
          this.toasted.add(d.id);
          first = look.found;
        }
        changed = true;
        break;
      }
    }
    return { first, fixed, changed };
  }

  /** The tip showing (null: none). */
  current(): Situation | null {
    return this.shown;
  }

  /** The player looked at it (Show where, Learn more): cleared soon after, it was their fix. */
  looked(now: number): void {
    if (this.shown) this.lookedAt = now;
  }

  /** Got it: that kind is done for this game. */
  dismiss(id: string, now: number): void {
    this.done.add(id);
    if (this.shown?.id === id) {
      this.shown = null;
      this.wentAt = now;
    }
  }

  /** Mark a kind done (an older device-wide "told once" flag, carried into this game). */
  markDone(id: string): void {
    if (known(this.detectors).has(id)) this.done.add(id);
  }

  isDone(id: string): boolean {
    return this.done.has(id);
  }

  /** ☰ Tips back on: the kinds hidden with Got it may show again. */
  showAgain(): void {
    this.done.clear();
    this.snoozed.clear();
    this.shows.clear();
  }

  /** Tips off (☰): the one showing goes, not done. */
  hide(): void {
    this.shown = null;
  }

  toJSON(): SituationSave {
    return { done: [...this.done], toasted: [...this.toasted], snoozed: Object.fromEntries(this.snoozed), shows: Object.fromEntries(this.shows) };
  }
}

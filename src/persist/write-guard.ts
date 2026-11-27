/**
 * The write guard (spec docs/superpowers/specs/2026-11-26-save-safety.md, layer 2): before Game mode's autosave
 * replaces a game that held a real railway, the two are compared, and a write that would put a different map, the
 * starter map, or a near-empty railway over it is refused until the stored one is kept safe (a `kept` backup). That
 * is the write that wiped a player's game on 2026-11-22: the starter map, made when their save wouldn't load, autosaved
 * over it.
 *
 * Cheap: the stored railway's summary is worked out once (from the save this page loaded, or one `JSON.parse`), and
 * again only when the stored text isn't the text this page last wrote or loaded (a string compare).
 */
import { STARTER_SEED } from "../game/world";

/** What the guard compares of a railway. */
export interface RailFacts {
  seed: number | null;
  /** The starter map (the first game's seed with `starter`: every Game map has `starter`, `nameOfLand`). */
  starterMap: boolean;
  pieces: number;
  cars: number;
}

/** A railway at least this big (pieces and cars) is a real one, guarded. */
export const REAL_WEIGHT = 25;
/** Near-empty beside it: this share of its pieces and cars or fewer… */
export const NEAR_EMPTY_SHARE = 0.25;
/** …and at least this many fewer. */
export const NEAR_EMPTY_LOSS = 20;

export type Trip = "seed" | "starter" | "empty" | "unreadable";

/** A save's facts, from its data (as `serializeWorld` makes it, or as parsed). */
export function railFacts(save: unknown): RailFacts {
  const s = save as { landscape?: { seed?: unknown; starter?: unknown }; pieces?: unknown; trains?: unknown } | null;
  const seed = typeof s?.landscape?.seed === "number" ? s.landscape.seed : null;
  const trains = Array.isArray(s?.trains) ? (s.trains as { cars?: unknown }[]) : [];
  return {
    seed,
    starterMap: !!s?.landscape?.starter && seed === STARTER_SEED,
    pieces: Array.isArray(s?.pieces) ? s.pieces.length : 0,
    cars: trains.reduce((a, t) => a + (Array.isArray(t?.cars) ? t.cars.length : 0), 0),
  };
}

const weight = (f: RailFacts): number => f.pieces + f.cars;

/** Why writing `next` over `stored` is refused, or null: it may be written. */
export function tripOf(stored: RailFacts | null, next: RailFacts): Exclude<Trip, "unreadable"> | null {
  if (!stored || weight(stored) < REAL_WEIGHT) return null;
  if (next.starterMap && !stored.starterMap) return "starter";
  if (next.seed !== stored.seed) return "seed";
  const was = weight(stored);
  const now = weight(next);
  if (now <= was * NEAR_EMPTY_SHARE && was - now >= NEAR_EMPTY_LOSS) return "empty";
  return null;
}

/** What the player is told when the guard trips, the stored railway kept (`kept`) or not. */
export function tripText(trip: Trip, kept: boolean, name: string): string {
  const why =
    trip === "starter"
      ? "the starter map was about to be saved over it"
      : trip === "seed"
        ? "a different map was about to be saved over it"
        : trip === "empty"
          ? "a much smaller railway was about to be saved over it"
          : "a save that doesn't read was about to be saved over";
  return kept
    ? `“${name}” is kept safe: ${why}. Find it in ☰ Your games, Earlier versions.`
    : `“${name}” wasn't saved over: ${why}, and there's no room to keep a copy. This game won't be saved: please tell us (☰ Report a bug).`;
}

export class WriteGuard {
  /** The stored text this page knows (it wrote or loaded it) and its facts. */
  private known: { raw: string; facts: RailFacts } | null = null;
  /** A stored text kept safe after a trip: writing over it is fine now. */
  private kept: string | null = null;

  /** The stored text is this, with these facts (the save loaded, or just written). */
  know(raw: string, facts: RailFacts): void {
    this.known = { raw, facts };
  }

  /** The stored text kept safe (a backup read back): it may be written over. */
  keptSafe(raw: string): void {
    this.kept = raw;
  }

  /** Why writing `next` over the stored text `raw` is refused, or null. Never throws. */
  check(raw: string | null, next: RailFacts): Trip | null {
    if (raw === null || raw === this.kept) return null;
    let stored: RailFacts;
    if (this.known && this.known.raw === raw) stored = this.known.facts;
    else {
      try {
        stored = railFacts(JSON.parse(raw));
      } catch {
        return "unreadable";
      }
      this.known = { raw, facts: stored };
    }
    return tripOf(stored, next);
  }
}

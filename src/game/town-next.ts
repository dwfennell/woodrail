/**
 * A town card's Next up (docs/agents/city-card-proposals.md, direction B): the one thing the town needs most, which
 * tab of its card that's on, and so which tab the card opens on. Pure: main gives it what the ledger, the places row
 * and the grand row already say.
 */

export type TownTab = "grow" | "build" | "projects" | "station";

export type NextKind =
  /** A grand project under way here: the Projects tab, its stage's goods coming. */
  | "underway"
  /** A City ★ that can start a grand project now: the Projects tab (its ticket's Start is the painted button). */
  | "grand"
  /** No line calls at its station: New route from here. */
  | "route"
  /** A good it needs that nothing on the map makes, its industry on the tray: Find it. */
  | "maker"
  /** The same, its industry's blueprint not learned yet: Show it in Research. */
  | "research"
  /** No town hall yet, and one can be built now. */
  | "hall"
  /** Nothing pressing: the goods bars say it. */
  | "grow";

export interface NextInput {
  /** A grand project under way in this town. */
  underway: boolean;
  /** A grand project can be started here now (a City ★, the coins, none under way). */
  canStartGrand: boolean;
  /** Train routes learned (New route from here is offered). */
  routes: boolean;
  /** Lines that call at its station. */
  lines: number;
  /** A good it needs that nothing makes: whether its industry's blueprint is still to learn. Null: none missing. */
  missing: { tech: string | null } | null;
  /** Its town hall's tile can be built now. */
  hallReady: boolean;
}

export interface NextUp {
  kind: NextKind;
  tab: TownTab;
}

/** What the town needs most, in the order a player needs it: what's under way, then trains, goods, places, projects. */
export function nextUp(i: NextInput): NextUp {
  if (i.underway) return { kind: "underway", tab: "projects" };
  if (i.routes && i.lines === 0) return { kind: "route", tab: "station" };
  if (i.canStartGrand) return { kind: "grand", tab: "projects" };
  if (i.missing) return i.missing.tech ? { kind: "research", tab: "grow" } : { kind: "maker", tab: "grow" };
  if (i.hallReady) return { kind: "hall", tab: "build" };
  return { kind: "grow", tab: "grow" };
}

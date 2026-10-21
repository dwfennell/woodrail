import { CARGO_KINDS, type CargoKind } from "../economy/cargo";
import { THING_RULES, type ThingId } from "./things";

/**
 * What a growing town offers (Game mode): pick one of three cards, never two of a kind (spec 2026-10-18-research-design
 * §3). Growth never gives a blueprint: blueprints are researched at a school. The cards are data, saved with the
 * progress; `rewards.ts` draws and applies them.
 */
export type GrowthCard =
  /** Planks into the workshop's yard (as many as fitted when it was offered). */
  | { kind: "planks"; n: number }
  | { kind: "coins"; n: number }
  /** A crate of things you know how to make (`crateFor`), into the toy box. */
  | { kind: "crate"; things: [ThingId, number][] }
  /** A wagon you know, or (a city, once Signals are learned) an engine, into the toy box. */
  | { kind: "wagon"; id: ThingId }
  /** Goods straight into the current research: this share of what it still lacks, of each good, when taken. */
  | { kind: "boost"; share: number }
  /** Goods you can't make yet, into the current research at the school (only what it lacks). */
  | { kind: "rare"; good: CargoKind; n: number };

export type CardKind = GrowthCard["kind"];

export const CARD_KINDS: readonly CardKind[] = ["planks", "coins", "crate", "wagon", "boost", "rare"];

/** A town's offer: three cards (fewer if fewer kinds can be offered), one to take. */
export interface Offer {
  /** The town's name. */
  from: string;
  /** The level it grew to (1 a village, 2 a town, 3 a city…). */
  level: number;
  cards: GrowthCard[];
}

/** Cards on an offer. */
export const CARDS_PER_OFFER = 3;

/** The amounts by level: village, town, city and up (spec §3). */
export const CARD_AMOUNTS = {
  planks: [8, 16, 30],
  coins: [30, 80, 200],
  /** Things in a crate. */
  crate: [2, 3, 4],
  /** Share of what the current research still lacks. */
  boost: [0.25, 0.4, 0.6],
  /** Rare cargo: none for a village. */
  rare: [0, 6, 12],
} as const;

/**
 * A research boost's floor: at least this many of each good the research lacks; a good it lacks fewer of is left off
 * the card (QA N2: "+1🪵 2🌾"), and it's offered (or can be taken) only while one good comes to this many (QA P5:
 * "+1🪵" beside +80 coins).
 */
export const BOOST_FLOOR = 3;

/** The column of `CARD_AMOUNTS` for a town that grew to `level`. */
export const amountAt = (amounts: readonly number[], level: number): number => amounts[Math.max(1, Math.min(level, 3)) - 1];

/** A card from saved data, or null if it's malformed. */
export function cardFromJSON(x: unknown): GrowthCard | null {
  const c = x as Record<string, unknown> | null;
  if (!c || typeof c !== "object") return null;
  const count = (n: unknown) => (Number.isInteger(n) && (n as number) > 0 ? (n as number) : 0);
  const thing = (id: unknown): id is ThingId => typeof id === "string" && id in THING_RULES;
  switch (c.kind) {
    case "planks":
    case "coins":
      return count(c.n) ? { kind: c.kind, n: count(c.n) } : null;
    case "crate": {
      const things = Array.isArray(c.things) ? c.things.filter((e): e is [ThingId, number] => Array.isArray(e) && thing(e[0]) && count(e[1]) > 0) : [];
      return things.length > 0 ? { kind: "crate", things: things.map(([id, n]) => [id, n] as [ThingId, number]) } : null;
    }
    case "wagon":
      return thing(c.id) && c.id.startsWith("car:") ? { kind: "wagon", id: c.id } : null;
    case "boost":
      return typeof c.share === "number" && c.share > 0 && c.share <= 1 ? { kind: "boost", share: c.share } : null;
    case "rare":
      return typeof c.good === "string" && (CARGO_KINDS as readonly string[]).includes(c.good) && count(c.n) ? { kind: "rare", good: c.good as CargoKind, n: count(c.n) } : null;
    default:
      return null;
  }
}

/** An offer from saved data: its cards that are sound (none: null). */
export function offerFromJSON(x: unknown): Offer | null {
  const o = x as Partial<Offer> | null;
  if (!o || typeof o !== "object" || !Array.isArray(o.cards)) return null;
  const cards: GrowthCard[] = [];
  for (const c of o.cards) {
    const card = cardFromJSON(c);
    if (card && !cards.some((k) => k.kind === card.kind)) cards.push(card);
  }
  if (cards.length === 0) return null;
  return { from: typeof o.from === "string" ? o.from : "", level: Number.isInteger(o.level) && o.level! > 0 ? o.level! : 1, cards };
}

/** An offer's saved form (a copy). */
export function offerToJSON(o: Offer): Offer {
  return { from: o.from, level: o.level, cards: o.cards.map((c) => (c.kind === "crate" ? { kind: "crate", things: c.things.map(([id, n]) => [id, n] as [ThingId, number]) } : { ...c })) };
}

import { CARGO, CARGO_KINDS, GOODS_ICON, type CargoKind } from "./cargo";

/**
 * A bag of goods: how many of each kind. The one shape for everything counted in goods (what a town wants, what it
 * has had, what a piece or a blueprint costs, what's in stock), so needs, costs and unlocks are all checked one way.
 */
export type Bag = Partial<Record<CargoKind, number>>;

/** The kinds in a bag with a count above zero, in cargo order. */
export function kindsOf(bag: Bag): CargoKind[] {
  return CARGO_KINDS.filter((k) => (bag[k] ?? 0) > 0);
}

/** Does `have` hold at least `need` of every kind? */
export function covers(have: Bag, need: Bag): boolean {
  return kindsOf(need).every((k) => (have[k] ?? 0) >= need[k]!);
}

/** A new bag: `a` and `b` added. */
export function plus(a: Bag, b: Bag): Bag {
  const out: Bag = { ...a };
  for (const k of kindsOf(b)) out[k] = (out[k] ?? 0) + b[k]!;
  return out;
}

/** A new bag: `a` with `b` taken away (never below zero). */
export function minus(a: Bag, b: Bag): Bag {
  const out: Bag = {};
  for (const k of kindsOf(a)) {
    const n = a[k]! - (b[k] ?? 0);
    if (n > 0) out[k] = n;
  }
  return out;
}

/** A new bag: every count multiplied by `n` (rounded up, so a need never rounds away). */
export function times(a: Bag, n: number): Bag {
  const out: Bag = {};
  for (const k of kindsOf(a)) out[k] = Math.ceil(a[k]! * n);
  return out;
}

/** How many there are in all. */
export function total(bag: Bag): number {
  return kindsOf(bag).reduce((n, k) => n + bag[k]!, 0);
}

/** "12🪵 planks + 1🌲 log" (empty: "nothing"): each count with its goods' icon, as on the tray's costs. */
export function describe(bag: Bag): string {
  // "1🪵 plank", "3🪵 planks" (the labels are plural).
  const parts = kindsOf(bag).map((k) => `${bag[k]}${GOODS_ICON[k]} ${bag[k] === 1 ? CARGO[k].label.toLowerCase().replace(/s$/, "") : CARGO[k].label.toLowerCase()}`);
  return parts.length > 0 ? parts.join(" + ") : "nothing";
}

/** "30🪵 10🪨" (empty: ""): counts and icons only, no words, for where room is short. */
export function iconCounts(bag: Bag): string {
  return kindsOf(bag)
    .map((k) => `${bag[k]}${GOODS_ICON[k]}`)
    .join(" ");
}

/** "a plank", "an engine": a thing's name with its article. */
export function aOrAn(noun: string): string {
  return `${/^[aeiou]/i.test(noun) ? "an" : "a"} ${noun}`;
}

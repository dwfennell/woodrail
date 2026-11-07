/**
 * Which wagon carries which goods, in the player's words: for the goods lines on industry, depot and town cards
 * ("🪨 Stone 3/12 · 🚃 Hopper"), a train standing at a place it can't load ("Needs a hopper for stone"), and the
 * tray's wagons ("Carries 🌾 grain, 🪨 stone…"). Read off `CARRIES`, the game's own rule (`canCarry`), so they never
 * disagree with what the cranes do. Pure, and asked when a card is drawn, never per frame.
 */
import type { CarKind } from "../sim";
import { CARGO, CARRIES, GOODS_ICON, type CargoKind } from "./cargo";
import { listed } from "../lib/words";

/** A wagon, drawn in the game's icon font (src/icons/u1F683-coach): one glyph for every kind, its name says which. */
export const WAGON_ICON = "🚃";

/**
 * Each wagon's name, short, as the Trains tray names it ("Flatbed wagon" → "Flatbed", "Milk tank wagon" → "Milk
 * tank"; "Tank wagon" keeps its "wagon": a tank alone could be anything).
 */
export const WAGON_NAME: Partial<Record<CarKind, string>> = {
  timber: "Flatbed",
  hopper: "Hopper",
  van: "Goods van",
  tanker: "Milk tank",
  reefer: "Cold van",
  carrier: "Car carrier",
  oiltank: "Tank wagon",
  mailvan: "Mail van",
  sortvan: "Sorting van",
};

/** The wagons that carry `kind`, in the tray's order (most goods ride in one; cheese, fish, chocolate in two). */
export function wagonsFor(kind: CargoKind): CarKind[] {
  return (Object.entries(CARRIES) as [CarKind, readonly CargoKind[]][]).filter(([car, list]) => list.includes(kind) && WAGON_NAME[car]).map(([car]) => car);
}

/** Names joined for a line: "Hopper", "Goods van or Cold van", "A, B or C". */
function either(names: readonly string[]): string {
  return listed(names, "or");
}

/** The wagon (or wagons) that carry `kind`, by name: "Hopper", "Goods van or Cold van"; "" if nothing carries it. */
export function wagonWords(kind: CargoKind): string {
  return either(wagonsFor(kind).map((c) => WAGON_NAME[c]!));
}

/** A goods line's wagon tag: "🚃 Hopper" ("" if nothing carries it: a good no train takes). */
export function wagonTag(kind: CargoKind): string {
  const w = wagonWords(kind);
  return w ? `${WAGON_ICON} ${w}` : "";
}

/**
 * What a train that can't take `kind` needs, plainly: "Needs a hopper for stone", "Needs a goods van or cold van for
 * cheese". ("A"/"an" by the name's first letter: none starts with a vowel today, but a new wagon might.)
 */
export function needsWagonText(kind: CargoKind): string {
  const names = wagonsFor(kind).map((c) => WAGON_NAME[c]!.toLowerCase());
  if (names.length === 0) return `Nothing carries ${CARGO[kind].label.toLowerCase()}`;
  const a = /^[aeiou]/.test(names[0]) ? "an" : "a";
  return `Needs ${a} ${either(names)} for ${CARGO[kind].label.toLowerCase()}`;
}

/** Everything a wagon carries, with its icons: "🌾 grain, 🪨 stone, ⚫ coal, ⛏️ ore" (the tray's card says it all). */
export function carriesLine(car: CarKind): string {
  return (CARRIES[car] ?? []).map((k) => `${GOODS_ICON[k]} ${CARGO[k].label.toLowerCase()}`).join(", ");
}

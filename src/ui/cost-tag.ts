import { COIN_ICON } from "../economy/cargo";
import { iconCounts, type Bag } from "../economy/goods";

/** A tray badge's cost, short: "30🪵 10🪨 100🪙" (goods by icon, in cargo order, then coins). */
export function costTag(cost: Bag, coins = 0): string {
  return [iconCounts(cost), coins > 0 ? `${coins}${COIN_ICON}` : ""].filter(Boolean).join(" ");
}

/**
 * About how wide `text` is in the badge's bold type, in ems: an emoji 1.3, a digit or letter 0.58, a space 0.27 (within
 * a few percent of Nunito's, measured in the game).
 */
export function badgeEms(text: string): number {
  let w = 0;
  for (const ch of text) {
    const c = ch.codePointAt(0)!;
    if (c === 0xfe0f) continue;
    w += ch === " " ? 0.27 : c >= 0x2000 ? 1.3 : 0.58;
  }
  return w;
}

/** The corner pill's room for text at its 12 px (ems), and a long badge's across its item (px; 70 px item on a phone). */
const PILL_EMS = 3.8;
const LONG_PX = 60;
const LONG_SIZES = [11, 10, 9];

/**
 * The type size for a tray badge to stay on one line inside its item: null for the corner pill at 12 px ("3", "12🪵",
 * "Locked"), else the largest size (px, 11 down to 9; `trayCostTag` keeps a badge short enough for that) at which a long one ("30🪵 10🪨 100🪙") fits across the item.
 */
export function costTagSize(text: string): number | null {
  const em = badgeEms(text);
  if (em <= PILL_EMS) return null;
  return LONG_SIZES.find((px) => em * px <= LONG_PX) ?? LONG_SIZES[LONG_SIZES.length - 1];
}

/** Does this badge text fit on one line in its item, at the smallest size we'll set it (9 px)? */
const fits = (text: string) => badgeEms(text) <= PILL_EMS || badgeEms(text) * LONG_SIZES[LONG_SIZES.length - 1] <= LONG_PX;

/**
 * A tray badge's cost, shortened to fit at 9 px or more (the card shows the full price): all of it if it fits, else
 * without the coins, else the first goods and "…" ("30🪵 …").
 */
export function trayCostTag(cost: Bag, coins = 0): string {
  const full = costTag(cost, coins);
  if (fits(full)) return full;
  const goods = costTag(cost);
  if (fits(goods)) return goods;
  return `${goods.split(" ")[0]} …`;
}

import type { CarKind } from "../sim";

export type CargoKind = "log" | "planks" | "grain" | "flour" | "stone" | "coal" | "ore" | "iron" | "furniture" | "tools" | "milk" | "bread" | "fruit" | "juice" | "cheese" | "icecream";

/** Cargo kinds by snapshot index. */
export const CARGO_KINDS: readonly CargoKind[] = ["log", "planks", "grain", "flour", "stone", "coal", "ore", "iron", "furniture", "tools", "milk", "bread", "fruit", "juice", "cheese", "icecream"];

export const CARGO: Record<CargoKind, { readonly index: number; readonly label: string }> = {
  log: { index: 0, label: "Logs" },
  planks: { index: 1, label: "Planks" },
  grain: { index: 2, label: "Grain" },
  flour: { index: 3, label: "Flour" },
  stone: { index: 4, label: "Stone" },
  // Mining and iron (Game mode's Phase C): coal and ore from a mine, iron from a foundry.
  coal: { index: 5, label: "Coal" },
  ore: { index: 6, label: "Ore" },
  iron: { index: 7, label: "Iron" },
  // Made goods: furniture from a carpenter's yard, tools from a smithy (towns pay well for them).
  furniture: { index: 8, label: "Furniture" },
  tools: { index: 9, label: "Tools" },
  // The dairy chain (tech-tree I3, I4): milk from a dairy farm; a bakery makes bread of flour and milk. Fruit from an
  // orchard (towns eat it as it comes; juice and jam come later).
  milk: { index: 10, label: "Milk" },
  bread: { index: 11, label: "Bread" },
  fruit: { index: 12, label: "Fruit" },
  // Juice from a juice works, pressed from an orchard's fruit (next nodes, 2026-11-02): bottles by the crate.
  juice: { index: 13, label: "Juice" },
  // Cheese from a creamery, made of a dairy's milk: round cheeses on a board.
  cheese: { index: 14, label: "Cheese" },
  // Ice cream from an ice cream factory, of milk and fruit: tubs, in cold vans only.
  icecream: { index: 15, label: "Ice cream" },
};

/**
 * One icon per kind of goods, used wherever goods are counted (tray costs, cards, needs, the journal): "30🪵 10🪨" (logs and stone).
 * Each is one glyph (a single code point, at most with a variation selector; no joined sequences that older phones
 * draw as two), and no two kinds share one. Logs are 🪵 (it's a log: raw wood). On screen each is the game's own
 * drawing, not the emoji (src/icons/*.svg, compiled into the "Woodrail Icons" font: see style.css). Planks have no
 * emoji, so they're U+E000 (private use), three sawn boards with a strap. Where that font isn't used (a screen
 * reader, a copied text) it's silent or a box, so a line meant to be read without the picture says "planks" too.
 */
export const GOODS_ICON: Record<CargoKind, string> = {
  log: "🪵",
  planks: "\uE000",
  grain: "🌾",
  flour: "🍞",
  stone: "🪨",
  coal: "⚫",
  ore: "⛏️",
  iron: "🔩",
  furniture: "🪑",
  tools: "🧰",
  // The dairy chain's goods: drawn in the icon font (src/icons/u1F95B-milk, u1F956-bread, u1F34E-fruit).
  milk: "🥛",
  bread: "🥖",
  fruit: "🍎",
  // The next nodes' goods (src/icons/u1F9C3-juice).
  juice: "🧃",
  cheese: "🧀",
  icecream: "🍦",
};

/** Coins, beside goods in a cost. */
export const COIN_ICON = "🪙";

/** What each kind of wagon carries: a kind of wagon per kind of goods (timber wagons take logs and planks). */
export const CARRIES: Partial<Record<CarKind, readonly CargoKind[]>> = {
  // Timber wagons are flatbeds: logs, planks, iron bars and crates of fruit.
  timber: ["log", "planks", "iron", "fruit"],
  hopper: ["grain", "stone", "coal", "ore"],
  // Vans: sacks and crates (flour, made goods, bread, crates of juice bottles, cheeses). Milk goes in a tank wagon.
  van: ["flour", "furniture", "tools", "bread", "juice", "cheese"],
  tanker: ["milk"],
  // The cold van: cheese (which a van carries too) and, the only wagon it rides in, ice cream.
  reefer: ["cheese", "icecream"],
};

/** Can this kind of car carry cargo (any, or this kind)? */
export function canCarry(kind: CarKind, cargo?: CargoKind): boolean {
  const list = CARRIES[kind];
  return !!list && (cargo === undefined || list.includes(cargo));
}

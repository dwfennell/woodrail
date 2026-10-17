import type { CarKind } from "../sim";

export type CargoKind = "log" | "planks" | "grain" | "flour" | "stone" | "coal" | "ore" | "iron" | "furniture" | "tools";

/** Cargo kinds by snapshot index. */
export const CARGO_KINDS: readonly CargoKind[] = ["log", "planks", "grain", "flour", "stone", "coal", "ore", "iron", "furniture", "tools"];

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
};

/**
 * One icon per kind of goods, used wherever goods are counted (tray costs, cards, needs, the journal): "30🪵 10🪨".
 * Each is one glyph (a single code point, at most with a variation selector; no joined sequences that older phones
 * draw as two), and no two kinds share one. Planks are 🪵 (as they always were); logs are a tree.
 */
export const GOODS_ICON: Record<CargoKind, string> = {
  log: "🌲",
  planks: "🪵",
  grain: "🌾",
  flour: "🍞",
  stone: "🪨",
  coal: "⚫",
  ore: "⛏️",
  iron: "🔩",
  furniture: "🪑",
  tools: "🧰",
};

/** Coins, beside goods in a cost. */
export const COIN_ICON = "🪙";

/** What each kind of wagon carries: a kind of wagon per kind of goods (timber wagons take logs and planks). */
export const CARRIES: Partial<Record<CarKind, readonly CargoKind[]>> = {
  // Timber wagons are flatbeds: logs, planks and iron bars.
  timber: ["log", "planks", "iron"],
  hopper: ["grain", "stone", "coal", "ore"],
  van: ["flour", "furniture", "tools"],
};

/** Can this kind of car carry cargo (any, or this kind)? */
export function canCarry(kind: CarKind, cargo?: CargoKind): boolean {
  const list = CARRIES[kind];
  return !!list && (cargo === undefined || list.includes(cargo));
}

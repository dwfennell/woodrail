import { CARGO, GOODS_ICON, type CargoKind } from "../economy/cargo";
import { FOODS } from "./towns";

/**
 * The News's milestone for the first of an everyday food (milk, bread, fruit) any town has had: "First milk! 🥛
 * Ashby buys it at full pay", or null (not a food, or not the first). `total` is how much of it every town has had in
 * all, this delivery's `n` included: the first is when they're the same. Worked out from the economy's totals (saved
 * with the world), so a reload never says it twice.
 */
export function firstFoodNews(kind: CargoKind, n: number, total: number, town: string): string | null {
  if (!FOODS.has(kind) || n <= 0 || total !== n) return null;
  return `First ${CARGO[kind].label.toLowerCase()}! ${GOODS_ICON[kind]} ${town} buys it at full pay`;
}

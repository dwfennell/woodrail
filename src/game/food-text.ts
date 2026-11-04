import { CARGO, GOODS_ICON, type CargoKind } from "../economy/cargo";
import { FULL_PAY } from "./towns";

/**
 * The News's milestone for the first of a good towns always buy at full pay (`FULL_PAY`: milk, bread, fruit, juice…)
 * any town has had: "First milk! 🥛 Ashby buys it at full pay", or null (not such a good, or not the first). `total` is how much of it every town has had in
 * all, this delivery's `n` included: the first is when they're the same. Worked out from the economy's totals (saved
 * with the world), so a reload never says it twice.
 */
export function firstFoodNews(kind: CargoKind, n: number, total: number, town: string): string | null {
  if (!FULL_PAY.has(kind) || n <= 0 || total !== n) return null;
  const label = CARGO[kind].label.toLowerCase();
  // (Bricks and cars are counted things: "buys them".)
  return `First ${label}! ${GOODS_ICON[kind]} ${town} buys ${label.endsWith("s") ? "them" : "it"} at full pay`;
}

/**
 * The game's tables in words, shared by the web wiki's pages (`pages.ts`) and the in-game help (`src/ui/help.ts`), so
 * both say the same thing: "6 planks + 120 coins", "1 load of planks every 8 seconds, from 1 load of logs".
 */
import { CARGO } from "../economy/cargo";
import type { Recipe } from "../economy/economy";
import type { Cost } from "./data";

export const goodName = (kind: string): string => (CARGO as Record<string, { label: string } | undefined>)[kind]?.label ?? kind;
export const goodWord = (kind: string): string => goodName(kind).toLowerCase();

export const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;

/** A cost in words: "6 planks + 120 coins" (or "free"). */
export function costWords(c: Cost): string {
  const parts = c.goods.map((g) => `${g.n} ${goodWord(g.kind)}`);
  if (c.coins) parts.push(`${c.coins} coins`);
  return parts.join(" + ") || "free";
}

/** "1 load of planks every 8 seconds, from 1 load of logs": an industry's recipe in words, or null (it makes nothing). */
export function cycleWords(recipe: Recipe | undefined): string | null {
  const c = recipe?.cycle;
  if (!c || Object.keys(c.makes).length === 0) return null;
  const bag = (b: Readonly<Record<string, number | undefined>>) =>
    Object.entries(b)
      .map(([k, n]) => `${n} ${n === 1 ? "load" : "loads"} of ${goodWord(k)}`)
      .join(" and ");
  const uses = Object.keys(c.uses).length ? `from ${bag(c.uses)}` : "from nothing but the land around it";
  return `${bag(c.makes)} every ${c.seconds} seconds, ${uses}`;
}

/** An engine's number against the classic engine's: "the same as the classic engine", "1.5× the classic engine's". */
export const times = (x: number): string => (x === 1 ? "the same as the classic engine" : `${x}× the classic engine's`);

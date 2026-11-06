import { CARGO, GOODS_ICON, type CargoKind } from "../economy";
import type { StopPlan } from "./route-plan-text";

/** A good in a sentence: its icon and lower-case name ("🪵 logs"). */
export const goodWords = (k: CargoKind): string => `${GOODS_ICON[k]} ${CARGO[k].label.toLowerCase()}`;

/**
 * What an open stop does, as sentences for the line sheet: "Drops 🪵 logs from Forest yard 2" (the nearest stop before
 * it, round the line, that picks them up) and "Picks up planks for Workshop" (the nearest after it that drops them).
 * One sentence a good. `names` are the stops' names, in order; `plans` the line's plan (`Economy.routePlan`).
 */
export function stopSentences(k: number, plans: readonly StopPlan[], names: readonly string[]): { drops: string[]; picks: string[] } {
  const n = plans.length;
  const p = plans[k];
  if (!p) return { drops: [], picks: [] };
  const look = (good: CargoKind, step: 1 | -1, has: (q: StopPlan) => readonly CargoKind[]): string | null => {
    for (let i = 1; i < n; i++) {
      const j = (((k + step * i) % n) + n) % n;
      if (j !== k && has(plans[j]).includes(good)) return names[j];
    }
    return null;
  };
  const drops = p.drops.map((g) => {
    const from = look(g, -1, (q) => q.picks);
    return from && from !== names[k] ? `Drops ${goodWords(g)} from ${from}` : `Drops ${goodWords(g)}`;
  });
  const picks = p.picks.map((g) => {
    const to = look(g, 1, (q) => q.drops);
    return to && to !== names[k] ? `Picks up ${goodWords(g)} for ${to}` : `Picks up ${goodWords(g)}`;
  });
  return { drops, picks };
}

/** What a stop is set to do, as the sheet's two ticks: Drop and Pick up ("auto" and old saves' "both": both). */
export function ticksOf(action: "auto" | "both" | "drop" | "pick"): { drop: boolean; pick: boolean } {
  return { drop: action !== "pick", pick: action !== "drop" };
}

/** The action two ticks mean; null for neither (the stop passes by, as a via point). */
export function actionOf(drop: boolean, pick: boolean): "auto" | "drop" | "pick" | null {
  if (drop && pick) return "auto";
  if (drop) return "drop";
  if (pick) return "pick";
  return null;
}

/** A line's stops, short, for the Lines list: "Forest yard 2 → Sawmill 2 → Workshop"; a long line "A → B → … → F (6 stops)". */
export function stopsLine(names: readonly string[]): string {
  if (names.length <= 4) return names.join(" → ");
  return `${names[0]} → ${names[1]} → … → ${names.at(-1)} (${names.length} stops)`;
}

/** Loads a month, in words: "18 loads a month", "1 load a month", "" for none. */
export function loadsWords(n: number): string {
  if (n <= 0) return "";
  return n === 1 ? "1 load a month" : `${n} loads a month`;
}

/** WCAG contrast ratio of two "#rrggbb" colours (1 to 21). */
export function contrastRatio(a: string, b: string): number {
  const lum = (hex: string) => {
    const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  };
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

/** Ink for a number on a line's colour: white where it holds 4.5:1 or more, else the darker of the two (DESIGN.md). */
export function inkOn(colour: string): string {
  const white = contrastRatio("#ffffff", colour);
  return white >= 4.5 || white >= contrastRatio("#2b2118", colour) ? "#ffffff" : "#2b2118";
}

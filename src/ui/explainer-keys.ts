import { trayKey, type TrayItem } from "./tray-catalogue";

/**
 * Which things have a "Learn more" explainer (explainers.ts): their ids and titles, and the tray items that lead to
 * them. Small, and loaded with the HUD; the explainers' words and pictures, and the sheet, are loaded the first time one
 * is opened.
 */

/** The explainers there are, with their titles (for the Learn more link's label). */
export const EXPLAINER_TITLES = { signals: "Signals", routes: "Routes" } as const;

export type ExplainerId = keyof typeof EXPLAINER_TITLES;

/** Which tray items have an explainer, by `trayKey` ("signal", "piece:switch", …). Add a line for another. */
const FOR_ITEM: Readonly<Record<string, ExplainerId>> = {
  signal: "signals",
  // (The old signal piece, still on a few saves' trays and maps.)
  "piece:signal": "signals",
};

/** A tray item's explainer, or null if it has none (then no Learn more is shown). */
export function explainerIdFor(item: TrayItem): ExplainerId | null {
  return FOR_ITEM[trayKey(item)] ?? null;
}

/** Every tray key with an explainer (for tests). */
export const explainedKeys = (): readonly string[] => Object.keys(FOR_ITEM);

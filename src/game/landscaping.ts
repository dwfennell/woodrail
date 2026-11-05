import { LAND_MESSAGES, type LandEditor } from "../landscape/edit";
import type { Landscape } from "../landscape/generate";
import { BANK_SHARE } from "./places";

/**
 * Landscaping (Game mode, a research): lower a hill a step at a time, for coins. One square, one level per use; the
 * Sandbox land editor's rules decide where (`LandEditor.check`: grass only, nothing standing on it, no track or road
 * beside it, not a station's way in, no slope steeper than a step, no town or depot cut off). Dear on purpose: a
 * deliberate choice, not routine, and dearer the higher the hill.
 */
export const LANDSCAPING = "landscaping";

/** Coins to lower a square a step from `height` (1 to 3): 200, 300, 400; with a bank on the map (`bank`), a quarter less. */
export function lowerPrice(height: number, bank = false): number {
  const price = 100 + 100 * height;
  return bank ? Math.round(price * BANK_SHARE) : price;
}

/** Why square `i` can't be lowered a step now (in words), or null if it can. */
export function lowerRefusal(land: Landscape, editor: LandEditor, i: number, coins: number, bank = false): string | null {
  const h = land.grid.height[i];
  if (h <= 0) return "That's flat already: tap a hill";
  const why = editor.check(i, -1);
  if (why) return LAND_MESSAGES[why];
  const price = lowerPrice(h, bank);
  if (coins < price) return `Lowering this costs ${price} coins: you have ${coins}`;
  return null;
}

/** The card's question for a square that can be lowered. */
export function lowerQuestion(height: number, coins: number, bank = false): string {
  return `Lower this hill a step, from level ${height} to ${height - 1}? It costs ${lowerPrice(height, bank)} coins (you have ${coins}).`;
}

/** A car as it shows on screen: its two ends (px). */
export interface CarOnScreen {
  id: number;
  ax: number;
  ay: number;
  bx: number;
  by: number;
}

/**
 * The car a fingertip at (x, y) means: the one whose line end to end on screen passes nearest the tap, if that's within
 * `slack` px; else −1. (Cars at the default zoom are only 10–20 px long, so a tap meant for one often misses it.)
 */
export function carNearTap(x: number, y: number, cars: readonly CarOnScreen[], slack: number): number {
  let best = -1;
  let bestD = slack * slack;
  for (const c of cars) {
    const dx = c.bx - c.ax;
    const dy = c.by - c.ay;
    const len = dx * dx + dy * dy;
    const t = len > 0 ? Math.min(1, Math.max(0, ((x - c.ax) * dx + (y - c.ay) * dy) / len)) : 0;
    const ex = c.ax + t * dx - x;
    const ey = c.ay + t * dy - y;
    const d = ex * ex + ey * ey;
    if (d <= bestD) {
      bestD = d;
      best = c.id;
    }
  }
  return best;
}

/**
 * Whether a car within a fingertip of a tap wins over what's exactly under it (`kind`, or null for nothing): over track,
 * a road, a town's footprint (its padded pick) or bare floor, yes; over something solid of its own (a depot's buildings,
 * cargo, a prop, a switch lever) or a car tapped exactly, no.
 */
export function nearCarWins(under: "piece" | "road" | "station" | "car" | "depot" | "cargo" | "prop" | "lever" | null): boolean {
  return under === null || under === "piece" || under === "road" || under === "station";
}

/**
 * A tap that finds a car whose train stands still wholly on a turntable's deck (`deck`, its piece; else −1): is it the
 * deck's (its piece id), or the car's (−1)? The deck's if what's exactly under the tap is that deck (the car came by a
 * fingertip's slack), or is the car itself with that turntable selected (the player is working it: a tap anywhere on
 * the deck turns it). Else the car's: with the turntable not selected, a tap on the engine still takes the engine.
 */
export function deckTapWins(deck: number, exact: { kind: string; pieceId?: number; deck?: boolean } | null, selectedPiece: number): number {
  if (deck === -1 || !exact) return -1;
  if (exact.kind === "piece" && exact.deck && exact.pieceId === deck) return deck;
  if (exact.kind === "car" && selectedPiece === deck) return deck;
  return -1;
}

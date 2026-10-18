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

/** A train lift's platform, in its piece's frame (see `liftTap`): how far either side of the line it reaches (its guard rails). */
const LIFT_PLATFORM_HALF = 27;
/** How high over its floor the platform reaches (its guard rails' tops), and how far under its floor a tap still finds it. */
const LIFT_PLATFORM_TOP = 40;
const LIFT_PLATFORM_UNDER = 4;
/** A lift's own parts reach this far past its ends (its tower's posts, its stop boards): a few mm. */
const LIFT_END_SLACK = 4;

/**
 * A tap whose ray met a train lift's piece (its platform, its tower or frame, or the unseen track it's picked by) at
 * piece-local (t along it from its low end, l across, y up from its base), its platform's floor at `platformY`
 * (`Sim.liftPosition` × its rise: between its ends while it rides), `length` its platform's length. On the platform
 * (its floor and rails, up to its guard rails): "send" (a tap sends it, as a tap on a turntable's deck turns it); on
 * its tower, frame or base: "select" (its piece's card); past its ends (the unseen track runs on under the next
 * piece's end): "pass" (to what's behind). Down, the platform's floor and the felt-level track it's picked by lie at
 * the same height, so which mesh the ray met first was a coin toss: the point decides, not the mesh.
 */
export function liftTap(t: number, l: number, y: number, platformY: number, length: number): "send" | "select" | "pass" {
  if (t < -LIFT_END_SLACK || t > length + LIFT_END_SLACK) return "pass";
  const on = t >= 0 && t <= length && Math.abs(l) <= LIFT_PLATFORM_HALF && y >= platformY - LIFT_PLATFORM_UNDER && y <= platformY + LIFT_PLATFORM_TOP;
  return on ? "send" : "select";
}

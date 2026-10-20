/** A car as it shows on screen: its two ends (px). */
export interface CarOnScreen {
  id: number;
  ax: number;
  ay: number;
  bx: number;
  by: number;
}

/**
 * The thing on screen (a car end to end, a lever or post base to top) whose line passes nearest a fingertip at (x, y),
 * if that's within `slack` px: its id and how far (px); else id −1.
 */
export function nearestOnScreen(x: number, y: number, things: readonly CarOnScreen[], slack: number): { id: number; d: number } {
  let best = -1;
  let bestD = slack * slack;
  for (const c of things) {
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
  return { id: best, d: best === -1 ? Infinity : Math.sqrt(bestD) };
}

/**
 * The car a fingertip at (x, y) means: the one whose line end to end on screen passes nearest the tap, if that's within
 * `slack` px; else −1. (Cars at the default zoom are only 10–20 px long, so a tap meant for one often misses it.)
 */
export function carNearTap(x: number, y: number, cars: readonly CarOnScreen[], slack: number): number {
  return nearestOnScreen(x, y, cars, slack).id;
}

/** A tap on touch takes a lever or semaphore post this near it on screen (px): half a 44 px target. */
export const LEVER_SLACK_PX = 22;
/** …but over its own switch's track (a tap there selects the piece), only this near: the lever's own few pixels. */
export const LEVER_ON_TRACK_PX = 8;

/**
 * Whether a lever or semaphore post `d` px from a tap (the nearest: `nearestOnScreen`) takes it over what's exactly
 * under the tap (`under`, null for nothing; `ownPiece`: that's the lever's own switch piece). Over bare floor or a road,
 * within `LEVER_SLACK_PX` (QA N2: an exact hit was a 14×24 px target at the default zoom); over its own switch's track,
 * only within `LEVER_ON_TRACK_PX` (a tap on the track still selects the piece); over anything else (other track, a car,
 * a building, a prop), never. Never while drawing (a stroke may start on the ground beside a lever) or planning a route
 * (a lever does nothing then).
 */
export function nearLeverWins(under: TapUnder, d: number, ownPiece: boolean, drawingOrPlanning: boolean): boolean {
  if (drawingOrPlanning) return false;
  if (under === null || under === "road") return d <= LEVER_SLACK_PX;
  if (under === "piece" && ownPiece) return d <= LEVER_ON_TRACK_PX;
  return false;
}

/** What a tap meant, on touch: what's exactly under it, or a car or a lever within a fingertip's slack (the nearer). */
export function fingertipWinner(car: { id: number; d: number } | null, lever: { id: number; d: number } | null): "car" | "lever" | "exact" {
  const c = car && car.id !== -1 ? car.d : Infinity;
  const l = lever && lever.id !== -1 ? lever.d : Infinity;
  if (c === Infinity && l === Infinity) return "exact";
  return l < c ? "lever" : "car";
}

/** What's exactly under a tap, as far as a fingertip's slack cares (null: nothing, bare floor). */
export type TapUnder = "piece" | "road" | "station" | "car" | "depot" | "cargo" | "prop" | "lever" | null;

/**
 * Whether a car within a fingertip of a tap wins over what's exactly under it (`kind`, or null for nothing): over track,
 * a road, a town's footprint (its padded pick) or bare floor, yes; over something solid of its own (a depot's buildings,
 * cargo, a prop, a switch lever) or a car tapped exactly, no.
 */
export function nearCarWins(under: TapUnder): boolean {
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

/**
 * A tap's ray through a train lift: what each of its parts the ray meets says (`liftTap`, nearest first). The first
 * part met that isn't past its ends decides: a post or brace of its tower in front of the platform takes the tap (its
 * card), so one tap never both opens its card and sends it, and a tap anywhere on its model is the lift's.
 */
export function liftTapAlong(along: Iterable<"send" | "select" | "pass">): "send" | "select" | "pass" {
  for (const at of along) if (at !== "pass") return at;
  return "pass";
}

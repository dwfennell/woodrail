import { CARGO } from "../economy/cargo";
import type { Progress } from "./progress";
import { coinsShort } from "./research";
import type { World } from "./world";

/**
 * The paint shop (spec 2026-11-04-civic-leisure-design.md §4): an engine painted in a livery of your choosing, from its
 * card. Liveries open as your towns grow (the biggest town's level: `Progress.bestLevel`); looks only, never pay.
 * A livery is a body and a trim colour swapped onto the engine's modelled ones (`liveryRecolor`, render/train-models).
 */

/**
 * A painted stripe along an engine's sides (`stripeColours`, drawn by render/train-models' `addStripes`): a thin
 * lining in one colour, or a rainbow band.
 */
export type Stripe = "lining" | "rainbow";

/** A rainbow band's colours, top to bottom. */
export const RAINBOW: readonly string[] = ["#d8453a", "#e8892e", "#e6c02c", "#3f9a4c", "#2f6db5", "#7a4fa0"];
/** A lining stripe's colour: gold leaf. */
export const LINING = "#e6b52c";

/** The colours of a stripe, top to bottom. */
export const stripeColours = (s: Stripe): readonly string[] => (s === "rainbow" ? RAINBOW : [LINING]);

export interface Livery {
  readonly id: string;
  readonly label: string;
  readonly body: string;
  readonly trim: string;
  /** A painted stripe along its sides (none: plain). */
  readonly stripe?: Stripe;
  readonly price: number;
  /** The biggest town's level that opens it (2 a town, 3 a city, 4 City ★, 5 City ★★). */
  readonly level: number;
}

/** The paint shop opens with the first Town. */
export const PAINT_OPEN_LEVEL = 2;

export const LIVERIES: readonly Livery[] = [
  { id: "red", label: "Red", body: "#c8442f", trim: "#2a2b2e", price: 60, level: 2 },
  { id: "green", label: "Green", body: "#2d6b3f", trim: "#e6b52c", price: 60, level: 2 },
  { id: "royal", label: "Royal", body: "#1f5aa6", trim: "#c8442f", price: 60, level: 2 },
  { id: "yellow", label: "Yellow", body: "#e6b52c", trim: "#1f3f73", price: 60, level: 2 },
  { id: "plum", label: "Plum", body: "#6b3b7a", trim: "#f0ebe0", price: 60, level: 3 },
  { id: "black", label: "Black", body: "#2a2b2e", trim: "#c8442f", price: 60, level: 3 },
  // The engine's own green and red, lined in gold along its sides (spec 2026-11-04-civic-leisure §4: City, 80🪙).
  { id: "lining", label: "Lined", body: "#2d6b3f", trim: "#c8442f", stripe: "lining", price: 80, level: 3 },
  { id: "gold", label: "Gold", body: "#d9a93a", trim: "#7a2a3a", price: 400, level: 4 },
  { id: "starlight", label: "Starlight", body: "#1f3f73", trim: "#f3d27a", price: 600, level: 5 },
  // Cream, with a rainbow band along each side (City ★★, 600🪙).
  { id: "rainbow", label: "Rainbow", body: "#f6f3ec", trim: "#2f6db5", stripe: "rainbow", price: 600, level: 5 },
];

const BY_ID = new Map(LIVERIES.map((l) => [l.id, l]));
export const liveryById = (id: string): Livery | undefined => BY_ID.get(id);

/** A car's livery colours from its saved id ("" or unknown: none, as it came; `custom:…`: your own colours). */
export function liveryOf(id: string): LiveryLook | null {
  const own = id ? ownColours(id) : null;
  if (own) return { id, ...own };
  const l = id ? BY_ID.get(id) : undefined;
  return l ? { id: l.id, body: l.body, trim: l.trim, ...(l.stripe ? { stripes: stripeColours(l.stripe) } : {}) } : null;
}

/** What a painted engine looks like: its body and trim colours, and its stripe's colours (top to bottom) if it has one. */
export interface LiveryLook {
  readonly id: string;
  readonly body: string;
  readonly trim: string;
  readonly stripes?: readonly string[];
}

/*
 * Your own colours (late-game spec, paint: the user's ask of 2026-11-05). Once Paint your trains is learned (after the
 * Dye works), the paint shop's sheet has a wide grid of colours: a body and a trim, for an engine and, if you like, its
 * wagons. Each car painted is a coat, and a coat takes a pot of paint from a workshop's yard (the dye works' good: the
 * workshop takes up to `PAINT_KEPT` once it's learned). Looks only, never pay.
 */

/** Pots of paint a workshop keeps for coats, once Paint your trains is learned. */
export const PAINT_KEPT = 6;

/** The colours on the grid: the toy box's lacquers, light to dark, warm to cool. */
export const PAINT_COLOURS: readonly string[] = [
  "#f6f3ec", "#f0ebe0", "#f3d27a", "#e6b52c", "#e07a2e", "#c8442f", "#b0303f", "#7a2a3a",
  "#e98aa8", "#6b3b7a", "#7fb7e0", "#2f6db5", "#1f5aa6", "#1f3f73", "#2a8c8c", "#3c8f4e",
  "#2d6b3f", "#1f4a2e", "#a8c66c", "#7a4a2a", "#d9a93a", "#8d8f93", "#4a4b4e", "#2a2b2e",
];

/** Has the paint shop your own colours (Paint your trains learned)? */
export const ownColoursOpen = (p: Pick<Progress, "learned">): boolean => p.learned.has("paint-trains");

/** A livery id for your own colours (body, trim: "#rrggbb"). */
export const ownLivery = (body: string, trim: string): string => `custom:${body.slice(1)}:${trim.slice(1)}`;

/** Your own colours from a livery id, or null if it isn't one. */
export function ownColours(id: string): { body: string; trim: string } | null {
  const m = /^custom:([0-9a-f]{6}):([0-9a-f]{6})$/i.exec(id);
  return m ? { body: `#${m[1].toLowerCase()}`, trim: `#${m[2].toLowerCase()}` } : null;
}

/** Pots of paint in the workshops' yards. */
export function paintPots(world: Pick<World, "economy" | "layout">): number {
  let n = 0;
  for (const d of world.economy.allDepots()) if (d.role === "workshop") n += d.piles[CARGO.paint.index];
  return n;
}

/** Why cars can't be painted in your own colours now, or null if they can (`coats`: cars to paint). */
export function coatWhy(p: Pick<Progress, "learned">, world: Pick<World, "economy" | "layout">, coats: number): string | null {
  if (!ownColoursOpen(p)) return "Learn Paint your trains first";
  const pots = paintPots(world);
  if (pots < coats) return `Needs ${coats} paint at the workshop: it has ${pots}`;
  return null;
}

/**
 * Paint cars `carIds` in your own colours: a pot of paint a car, from the workshops' yards. True if it did (nothing is
 * taken if there isn't enough for every car).
 */
export function paintOwn(p: Pick<Progress, "learned">, world: Pick<World, "economy" | "layout">, sim: { setLivery(carId: number, id: string): void }, carIds: readonly number[], body: string, trim: string): boolean {
  if (carIds.length === 0 || coatWhy(p, world, carIds.length) !== null) return false;
  let left = carIds.length;
  for (const d of world.economy.allDepots()) {
    if (left <= 0) break;
    if (d.role !== "workshop") continue;
    const take = Math.min(left, d.piles[CARGO.paint.index]);
    d.piles[CARGO.paint.index] -= take;
    left -= take;
  }
  const id = ownLivery(body, trim);
  for (const c of carIds) sim.setLivery(c, id);
  return true;
}

export type PaintState = "have" | "paint" | "short" | "saving" | "locked";

/** What a swatch says for an engine now in livery `current` ("" as it came). */
export function paintState(p: Progress, livery: Livery, current: string): PaintState {
  if (livery.id === current) return "have";
  if (p.bestLevel < livery.level) return "locked";
  if (coinsShort(p) > 0) return "saving";
  if (p.coins < livery.price) return "short";
  return "paint";
}

/** Is the paint shop open (a Town on the map)? */
export const paintOpen = (p: Progress): boolean => p.bestLevel >= PAINT_OPEN_LEVEL;

/**
 * Paint engine `carId` (`""`: back as it came, free). Pays and sets the livery when its swatch says Paint; returns
 * whether it did.
 */
export function paint(p: Progress, sim: { liveryOf(carId: number): string; setLivery(carId: number, id: string): void }, carId: number, id: string): boolean {
  if (id === "") {
    sim.setLivery(carId, "");
    return true;
  }
  const l = liveryById(id);
  if (!l || paintState(p, l, sim.liveryOf(carId)) !== "paint") return false;
  p.coins -= l.price;
  sim.setLivery(carId, id);
  return true;
}

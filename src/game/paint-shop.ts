import type { Progress } from "./progress";
import { coinsShort } from "./research";

/**
 * The paint shop (spec 2026-11-04-civic-leisure-design.md §4): an engine painted in a livery of your choosing, from its
 * card. Liveries open as your towns grow (the biggest town's level: `Progress.bestLevel`); looks only, never pay.
 * A livery is a body and a trim colour swapped onto the engine's modelled ones (`liveryRecolor`, render/train-models).
 */

export interface Livery {
  readonly id: string;
  readonly label: string;
  readonly body: string;
  readonly trim: string;
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
  { id: "gold", label: "Gold", body: "#d9a93a", trim: "#7a2a3a", price: 400, level: 4 },
  { id: "starlight", label: "Starlight", body: "#1f3f73", trim: "#f3d27a", price: 600, level: 5 },
];

const BY_ID = new Map(LIVERIES.map((l) => [l.id, l]));
export const liveryById = (id: string): Livery | undefined => BY_ID.get(id);

/** A car's livery colours from its saved id ("" or unknown: none, as it came). */
export function liveryOf(id: string): { id: string; body: string; trim: string } | null {
  const l = id ? BY_ID.get(id) : undefined;
  return l ? { id: l.id, body: l.body, trim: l.trim } : null;
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

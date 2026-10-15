import type { CargoKind } from "../economy";

/** A turned log: length along x, lying on its side. */
export const LOG_LENGTH = 54;
export const LOG_RADIUS = 5.5;
/** A strapped bundle of three boards, length along x. */
export const BUNDLE_LENGTH = 32;
export const BUNDLE_WIDTH = 12;
export const BUNDLE_HEIGHT = 7.5;
/** A sack (grain, flour), length along x. */
export const SACK_LENGTH = 14;
export const SACK_WIDTH = 9;
export const SACK_HEIGHT = 6;
/** A cut stone block: a sack's footprint, a little taller. */
export const STONE_HEIGHT = 8;

export interface Slot {
  /** Along the unit's length (x), up (y), across (z). */
  x: number;
  y: number;
  z: number;
}

/** Size of one unit (length, height, width), for overlap checks. */
export function unitSize(kind: CargoKind): { x: number; y: number; z: number } {
  if (kind === "log") return { x: LOG_LENGTH, y: LOG_RADIUS * 2, z: LOG_RADIUS * 2 };
  if (kind === "planks") return { x: BUNDLE_LENGTH, y: BUNDLE_HEIGHT, z: BUNDLE_WIDTH };
  // Iron bars come in bundles the size of a planks bundle (they ride flatbeds like planks).
  if (kind === "iron") return { x: BUNDLE_LENGTH, y: 7.5, z: BUNDLE_WIDTH };
  if (kind === "stone" || kind === "coal" || kind === "ore") return { x: SACK_LENGTH, y: STONE_HEIGHT, z: SACK_WIDTH };
  return { x: SACK_LENGTH, y: SACK_HEIGHT, z: SACK_WIDTH };
}

/**
 * Where the k-th unit (from 0) sits in a pile `across` units wide and `rows` long, relative to the pile's centre on
 * the ground: rows fill across, then along, then stack upward. Logs lie side by side; bundles in neat columns.
 */
export function pileSlot(kind: CargoKind, k: number, across: number, rows = 1): Slot {
  const perLayer = across * rows;
  const col = k % across;
  const row = Math.floor(k / across) % rows;
  const layer = Math.floor(k / perLayer);
  const size = unitSize(kind);
  const pitch = size.z + 0.6;
  return { x: (row - (rows - 1) / 2) * (size.x + 0.6), y: size.y / 2 + layer * size.y, z: (col - (across - 1) / 2) * pitch };
}

/** Where the k-th unit rides on a timber wagon's deck, relative to the deck's centre. */
export function wagonSlot(kind: CargoKind, k: number): Slot {
  if (kind === "log") {
    // Two side by side, the third resting in the groove on top.
    if (k < 2) return { x: 0, y: LOG_RADIUS, z: (k === 0 ? -1 : 1) * (LOG_RADIUS + 0.3) };
    if (k === 2) return { x: 0, y: LOG_RADIUS + LOG_RADIUS * 1.75, z: 0 };
    // A heavy wagon's fourth and fifth: on top, either side of the third.
    return { x: (k === 3 ? -1 : 1) * (LOG_LENGTH / 4), y: LOG_RADIUS + LOG_RADIUS * 3.5, z: 0 };
  }
  if (kind === "planks") return { x: 0, y: BUNDLE_HEIGHT / 2 + k * BUNDLE_HEIGHT, z: 0 };
  // Iron bundles stack like planks.
  if (kind === "iron") return { x: 0, y: 7.5 / 2 + k * 7.5, z: 0 };
  // Sacks: in a row along the wagon; a heavy wagon's fourth and fifth on top.
  if (k < 3) return { x: (k - 1) * (SACK_LENGTH + 1), y: SACK_HEIGHT / 2, z: 0 };
  return { x: (k - 3.5) * (SACK_LENGTH + 1), y: SACK_HEIGHT * 1.5, z: 0 };
}

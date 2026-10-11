import type { CargoKind } from "../economy";

/** A turned log: length along x, lying on its side. */
export const LOG_LENGTH = 54;
export const LOG_RADIUS = 5.5;
/** A strapped bundle of three boards, length along x. */
export const BUNDLE_LENGTH = 32;
export const BUNDLE_WIDTH = 12;
export const BUNDLE_HEIGHT = 7.5;

export interface Slot {
  /** Along the unit's length (x), up (y), across (z). */
  x: number;
  y: number;
  z: number;
}

/** Size of one unit (length, height, width), for overlap checks. */
export function unitSize(kind: CargoKind): { x: number; y: number; z: number } {
  return kind === "log" ? { x: LOG_LENGTH, y: LOG_RADIUS * 2, z: LOG_RADIUS * 2 } : { x: BUNDLE_LENGTH, y: BUNDLE_HEIGHT, z: BUNDLE_WIDTH };
}

/**
 * Where the k-th unit (from 0) sits in a pile `across` units wide, relative to the pile's centre on the ground:
 * rows fill across, then stack upward. Logs lie side by side; bundles in neat columns.
 */
export function pileSlot(kind: CargoKind, k: number, across: number): Slot {
  const col = k % across;
  const layer = Math.floor(k / across);
  const size = unitSize(kind);
  const pitch = size.z + 0.6;
  return { x: 0, y: size.y / 2 + layer * size.y, z: (col - (across - 1) / 2) * pitch };
}

/** Where the k-th unit rides on a timber wagon's deck, relative to the deck's centre. */
export function wagonSlot(kind: CargoKind, k: number): Slot {
  if (kind === "log") {
    // Two side by side, the third resting in the groove on top.
    if (k < 2) return { x: 0, y: LOG_RADIUS, z: (k === 0 ? -1 : 1) * (LOG_RADIUS + 0.3) };
    return { x: 0, y: LOG_RADIUS + LOG_RADIUS * 1.75, z: 0 };
  }
  return { x: 0, y: BUNDLE_HEIGHT / 2 + k * BUNDLE_HEIGHT, z: 0 };
}

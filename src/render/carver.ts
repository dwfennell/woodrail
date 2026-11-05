import type { BufferGeometry } from "three";
import type { PieceDef } from "../track";

/**
 * Carving track pieces on the main thread (CSG, `piece-carve.ts`: about 130 KB with its libraries), loaded on its own,
 * not in the first download. The piece workers carve nearly everything; the main thread carves only a join piece (made
 * when first used), or where no worker can run. `TrackView` asks for it as loading starts, and shows a stand-in for
 * anything wanted before it's in. Tests load it in their setup (`src/test-setup.ts`).
 */
export interface Carver {
  buildPieceGeometry(def: PieceDef, levels?: number, floors?: readonly number[] | null): BufferGeometry;
}

let carver: Carver | null = null;
let loading: Promise<void> | null = null;
const waiting: (() => void)[] = [];

/** The carver, if it's in (else null: `loadCarver`). */
export const carverNow = (): Carver | null => carver;

/** Load the carver (once). */
export function loadCarver(): Promise<void> {
  return (loading ??= import("./piece-carve").then((m) => setCarver(m)));
}

/** Carve with this from now on (the real one, as loaded; a test's quicker stand-in). */
export function setCarver(c: Carver): void {
  carver = c;
  loading ??= Promise.resolve();
  for (const f of waiting.splice(0)) f();
}

/** Call `f` when the carver comes in (now, if it's in). */
export function whenCarver(f: () => void): void {
  if (carver) f();
  else waiting.push(f);
}

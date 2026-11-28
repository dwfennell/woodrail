import type { AmbientEye } from "../render/ambient";

/** What makes a sound that follows the view: each kind's world size (mm), judged by how big it is drawn. */
export type SoundKind = "car" | "crane" | "crossing" | "lift" | "sawmill" | "station";

/** The world size of each kind of sound source, mm. */
export const SOUND_SIZE_MM: Record<SoundKind, number> = {
  car: 60,
  crane: 120,
  crossing: 80,
  lift: 150,
  sawmill: 120,
  station: 150,
};

/** On-screen size (CSS px) of a source: under `silent` it is inaudible, at `clear` and over it full volume. */
export const HEAR_PX = { silent: 4, clear: 14 } as const;

/** The loudest a source can be heard (a clear one): near the old synth levels, which fell off with distance. */
export const HEAR_GAIN = 0.6;

/** 0 at or under `HEAR_PX.silent`, 1 at or over `HEAR_PX.clear`, linear between. */
export function audibility(px: number): number {
  if (px <= HEAR_PX.silent) return 0;
  if (px >= HEAR_PX.clear) return 1;
  return (px - HEAR_PX.silent) / (HEAR_PX.clear - HEAR_PX.silent);
}

/** How loud a source of `kind` at (x, y, z) is from this frame's view: 0 off screen (a little past the edge counts), `HEAR_GAIN` at most. */
export function hear(
  eye: Pick<AmbientEye, "sees" | "pixels">,
  kind: SoundKind,
  x: number,
  y: number,
  z: number,
): number {
  const size = SOUND_SIZE_MM[kind];
  if (!eye.sees(x, y, z, size, 0, size * 2)) return 0;
  return HEAR_GAIN * audibility(eye.pixels(x, y, z, size));
}

/**
 * How dark shadows are: one setting for the sun's shadow, the sky's fill, the soft contact blobs under scenery and
 * road vehicles, and ambient occlusion. The sun is turned down by the fill added, so lit surfaces stay about as bright.
 *
 * - `before`: as it was (full-strength sun shadow, little fill): shadows read very dark.
 * - `bit`, `lighter`, `much`: a bit lighter, lighter, much lighter.
 */
export type ShadowStrength = "before" | "bit" | "lighter" | "much";

export interface ShadowLook {
  /** The sun's shadow: 1 blocks all its light, less lets some through (three's `shadow.intensity`). */
  readonly sunShadow: number;
  /** The hemisphere (sky) light's intensity: the fill that lights what's in shadow. */
  readonly fill: number;
  /** The sun's intensity, lowered by the fill added so lit surfaces stay about the same. */
  readonly sun: number;
  /** Multiplies the contact blobs' opacity and ambient occlusion's strength. */
  readonly contact: number;
}

const BASE_SUN = 5.4;
const BASE_FILL = 0.12;
const look = (
  sunShadow: number,
  fill: number,
  contact: number,
): ShadowLook => ({
  sunShadow,
  fill,
  sun: BASE_SUN - (fill - BASE_FILL),
  contact,
});

export const SHADOW_LOOKS: Record<ShadowStrength, ShadowLook> = {
  before: look(1, BASE_FILL, 1),
  bit: look(0.86, 0.22, 0.88),
  lighter: look(0.74, 0.32, 0.76),
  much: look(0.62, 0.42, 0.64),
};

/** The strength the game uses. */
export const SHADOW_STRENGTH: ShadowStrength = "lighter";

/** The look in use: `SHADOW_STRENGTH`, or in a dev server `?shadows=<strength>` (for comparing them). */
export function shadowLook(): ShadowLook {
  if (import.meta.env?.DEV && typeof location !== "undefined") {
    const asked = new URLSearchParams(location.search).get("shadows");
    if (asked && asked in SHADOW_LOOKS)
      return SHADOW_LOOKS[asked as ShadowStrength];
  }
  return SHADOW_LOOKS[SHADOW_STRENGTH];
}

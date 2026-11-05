/**
 * How much depth of field (the bokeh pass's blur on what's off focus, high tier only):
 *
 * - `today`: as it was: near and far both blur, up to `maxblur` of the screen.
 * - `half`: half the aperture and half the most blur.
 * - `tilt`: a tilt-shift hint: nothing nearer than the focus blurs, nor anything within `dead` × the focus distance
 *   beyond it; only the far edge of the view softens, a little.
 * - `off`: no depth-of-field pass at all.
 */
export type DofLevel = "today" | "half" | "tilt" | "off";

export interface DofLook {
  /** Multiplies the aperture (`apertureFor`). 0: no pass. */
  readonly aperture: number;
  /** The most blur, as a fraction of the screen's width. */
  readonly maxblur: number;
  /** How much what's nearer than the focus blurs (1: as much as what's beyond it). */
  readonly near: number;
  /** A sharp band beyond the focus, as a fraction of the focus distance. */
  readonly dead: number;
}

export const DOF_LOOKS: Record<DofLevel, DofLook> = {
  today: { aperture: 1, maxblur: 0.006, near: 1, dead: 0 },
  half: { aperture: 0.5, maxblur: 0.003, near: 1, dead: 0 },
  tilt: { aperture: 1, maxblur: 0.0025, near: 0, dead: 0.45 },
  off: { aperture: 0, maxblur: 0, near: 0, dead: 0 },
};

/** The level the game uses. */
export const DOF_LEVEL: DofLevel = "today";

/** The look in use: `DOF_LEVEL`, or in a dev server `?dof=<level>` (for comparing them). */
export function dofLook(): DofLook {
  if (import.meta.env?.DEV && typeof location !== "undefined") {
    const asked = new URLSearchParams(location.search).get("dof");
    if (asked && asked in DOF_LOOKS) return DOF_LOOKS[asked as DofLevel];
  }
  return DOF_LOOKS[DOF_LEVEL];
}

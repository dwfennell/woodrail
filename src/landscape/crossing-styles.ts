import type { LevelCrossing } from "./crossings";
import { CELL } from "./grid";

/**
 * Level crossings' styles. Crossings are derived (`findCrossings`: wherever track meets a road); a crossing prop dropped
 * on one (the catalogue's level crossing or gated crossing) sets its style. The prop stays a prop, saved and undone as
 * any is, linked to its crossing by where it stands: it styles the crossing whose middle is nearest it, within
 * `STYLE_REACH`, and while it does, it isn't drawn itself (`CrossingsView` draws the style's barriers or gates there).
 * A crossing without one looks as crossings always have.
 */
export type CrossingStyle = "barriers" | "gates";

/** The props that style a crossing, by catalogue asset. */
export const CROSSING_STYLES: Readonly<Record<string, CrossingStyle>> = {
  // Striped booms with twin red lamps, flashing while they're down.
  "mech-level-crossing": "barriers",
  // White field gates that swing shut across the road while a train passes.
  "mech-gated-crossing": "gates",
};

/** The style this asset sets on a crossing, if it's a crossing prop. */
export const crossingStyleOf = (asset: string): CrossingStyle | undefined => CROSSING_STYLES[asset];

/** How near a crossing's middle a crossing prop must stand to style it (mm): within its square. */
export const STYLE_REACH = CELL;

/** A crossing with its style, if a prop sets one. */
export interface StyledCrossing extends LevelCrossing {
  readonly style?: CrossingStyle;
  /** The prop that sets it. */
  readonly styleProp?: number;
}

/** The crossing whose middle is nearest (x, z), within `reach` (the first, of two as near); −1 if none. */
export function nearestCrossing(crossings: readonly LevelCrossing[], x: number, z: number, reach = STYLE_REACH): number {
  let best = -1;
  let bestD = Infinity;
  crossings.forEach((c, i) => {
    const d = Math.hypot(c.x - x, c.z - z);
    if (d <= reach && d < bestD) {
      best = i;
      bestD = d;
    }
  });
  return best;
}

/**
 * Each crossing's style, from the crossing props among `props` (all but `hidden`, one in the hand): each prop styles
 * the crossing nearest it within reach; of several on one crossing, the nearest wins. Also which props are linked
 * (drawn as their crossing's style, not as props). Worked out when the props, track or roads change, never per frame:
 * a pass over the props, and over the crossings for each crossing prop.
 */
export function styleCrossings(
  crossings: readonly LevelCrossing[],
  props: Iterable<{ readonly id: number; readonly asset: string; readonly x: number; readonly z: number }>,
  hidden = -1,
): { crossings: StyledCrossing[]; linked: Set<number> } {
  const pick = new Map<number, { prop: number; style: CrossingStyle; d: number }>();
  for (const p of props) {
    const style = crossingStyleOf(p.asset);
    if (!style || p.id === hidden) continue;
    const i = nearestCrossing(crossings, p.x, p.z);
    // (A crossing with nowhere for a barrier, track all round it, can't take a style: the prop stays as it is.)
    if (i === -1 || crossings[i].gates.length === 0) continue;
    const d = Math.hypot(crossings[i].x - p.x, crossings[i].z - p.z);
    const had = pick.get(i);
    if (!had || d < had.d || (d === had.d && p.id < had.prop)) pick.set(i, { prop: p.id, style, d });
  }
  const linked = new Set<number>();
  const out = crossings.map((c, i): StyledCrossing => {
    const s = pick.get(i);
    if (!s) return c;
    linked.add(s.prop);
    return { ...c, style: s.style, styleProp: s.prop };
  });
  return { crossings: out, linked };
}

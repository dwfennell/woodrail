import { normalizeAngle, type Pose } from "./math";

/**
 * A path through a piece, in piece-local coordinates. Height eases from y0 to y0 + rise
 * along a smoothstep so trains meet ramps without a kink.
 * Arcs: positive sweep turns toward +heading (left), negative toward -heading (right).
 */
export type PathGeom =
  | { readonly kind: "line"; readonly start: Pose; readonly length: number; readonly y0: number; readonly rise: number }
  | {
      readonly kind: "arc";
      readonly start: Pose;
      readonly radius: number;
      readonly sweep: number;
      readonly y0: number;
      readonly rise: number;
    };

export interface PathSample {
  x: number;
  z: number;
  y: number;
  /** Direction of travel for increasing distance. */
  heading: number;
  /** dy/ds — positive is uphill when travelling forward. */
  slope: number;
}

export function createSample(): PathSample {
  return { x: 0, z: 0, y: 0, heading: 0, slope: 0 };
}

export function pathLength(g: PathGeom): number {
  return g.kind === "line" ? g.length : g.radius * Math.abs(g.sweep);
}

/** Closed-form sample at distance s (clamped to [0, length]). Writes into and returns `out`. No allocation. */
export function samplePath(g: PathGeom, s: number, out: PathSample): PathSample {
  const len = pathLength(g);
  const d = s < 0 ? 0 : s > len ? len : s;
  const t = len > 0 ? d / len : 0;
  out.y = g.y0 + g.rise * t * t * (3 - 2 * t);
  out.slope = len > 0 ? (g.rise * 6 * t * (1 - t)) / len : 0;

  const h0 = g.start.heading;
  if (g.kind === "line") {
    out.x = g.start.x + Math.cos(h0) * d;
    out.z = g.start.z + Math.sin(h0) * d;
    out.heading = h0;
    return out;
  }

  const sign = g.sweep >= 0 ? 1 : -1;
  const r = g.radius;
  const cx = g.start.x - sign * r * Math.sin(h0);
  const cz = g.start.z + sign * r * Math.cos(h0);
  const h = h0 + (sign * d) / r;
  out.x = cx + sign * r * Math.sin(h);
  out.z = cz - sign * r * Math.cos(h);
  out.heading = normalizeAngle(h);
  return out;
}

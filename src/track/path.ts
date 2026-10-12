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
    }
  /**
   * An S: an arc of `sweep` (signed as for arcs), then the same arc bending back the other way, ending on the start's
   * heading but shifted sideways.
   */
  | {
      readonly kind: "s";
      readonly start: Pose;
      readonly radius: number;
      readonly sweep: number;
      readonly y0: number;
      readonly rise: number;
    }
  /**
   * A balloon loop: an arc of `sweep` (signed as for arcs) peeling off the line, a big circle of `loopRadius` the
   * other way round, then the first arc again, arriving back where it started, facing back the way it came.
   */
  | {
      readonly kind: "loop";
      readonly start: Pose;
      readonly radius: number;
      readonly sweep: number;
      readonly loopRadius: number;
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
  if (g.kind === "line") return g.length;
  if (g.kind === "loop") return 2 * g.radius * Math.abs(g.sweep) + g.loopRadius * (Math.PI + 2 * Math.abs(g.sweep));
  return g.radius * Math.abs(g.sweep) * (g.kind === "s" ? 2 : 1);
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

  if (g.kind === "arc") return arcAt(g.start.x, g.start.z, h0, g.radius, g.sweep >= 0 ? 1 : -1, d, out);
  if (g.kind === "loop") {
    // Peel off, round the big circle the other way, then the first arc again back onto the line.
    const sign = g.sweep >= 0 ? 1 : -1;
    const peel = g.radius * Math.abs(g.sweep);
    const round = g.loopRadius * (Math.PI + 2 * Math.abs(g.sweep));
    if (d <= peel) return arcAt(g.start.x, g.start.z, h0, g.radius, sign, d, out);
    arcAt(g.start.x, g.start.z, h0, g.radius, sign, peel, out);
    if (d <= peel + round) return arcAt(out.x, out.z, out.heading, g.loopRadius, -sign, d - peel, out);
    arcAt(out.x, out.z, out.heading, g.loopRadius, -sign, round, out);
    return arcAt(out.x, out.z, out.heading, g.radius, sign, d - peel - round, out);
  }
  // An S: the first arc, then from its end the second, bending back.
  const half = len / 2;
  const sign = g.sweep >= 0 ? 1 : -1;
  if (d <= half) return arcAt(g.start.x, g.start.z, h0, g.radius, sign, d, out);
  arcAt(g.start.x, g.start.z, h0, g.radius, sign, half, out);
  return arcAt(out.x, out.z, out.heading, g.radius, -sign, d - half, out);
}

/** A point `d` along an arc of radius `r` from (x, z) heading `h0`, turning left (`sign` 1) or right (−1). Sets x, z, heading. */
function arcAt(x: number, z: number, h0: number, r: number, sign: number, d: number, out: PathSample): PathSample {
  const cx = x - sign * r * Math.sin(h0);
  const cz = z + sign * r * Math.cos(h0);
  const h = h0 + (sign * d) / r;
  out.x = cx + sign * r * Math.sin(h);
  out.z = cz - sign * r * Math.cos(h);
  out.heading = normalizeAngle(h);
  return out;
}

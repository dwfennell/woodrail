import { angleDiff, createSample, getPieceDef, normalizeAngle, pathLength, samplePath, type Layout, type PathGeom } from "../track";
import type { Cursor } from "./cursor";

export interface NearestTrack {
  cursor: Cursor;
  /** Plan distance from the query point to the track centre line (mm). */
  distance: number;
}

const sample = createSample();

/** Closest distance along a path (piece-local) to a local point. */
function closestS(g: PathGeom, lx: number, lz: number): number {
  const len = pathLength(g);
  const h0 = g.start.heading;
  if (g.kind === "line") {
    const s = (lx - g.start.x) * Math.cos(h0) + (lz - g.start.z) * Math.sin(h0);
    return s < 0 ? 0 : s > len ? len : s;
  }
  const sign = g.sweep >= 0 ? 1 : -1;
  const cx = g.start.x - sign * g.radius * Math.sin(h0);
  const cz = g.start.z + sign * g.radius * Math.cos(h0);
  const theta = Math.atan2(sign * (lx - cx), -sign * (lz - cz));
  const s = normalizeAngle(sign * (theta - h0)) * g.radius;
  if (s >= 0 && s <= len) return s;
  // Outside the arc: pick the nearer end.
  samplePath(g, 0, sample);
  const d0 = Math.hypot(sample.x - lx, sample.z - lz);
  samplePath(g, len, sample);
  const d1 = Math.hypot(sample.x - lx, sample.z - lz);
  return d0 <= d1 ? 0 : len;
}

/**
 * The nearest point on any track path within `maxDistance` of (x, z), as a cursor travelling in the direction
 * closest to `heading`. Not a hot path: scans every piece.
 */
export function nearestCursor(layout: Layout, x: number, z: number, maxDistance: number, heading: number): NearestTrack | null {
  let best: NearestTrack | null = null;
  for (const id of layout.pieceIds()) {
    const piece = layout.getPiece(id)!;
    const dx = x - piece.pose.x;
    const dz = z - piece.pose.z;
    const c = Math.cos(piece.pose.heading);
    const s = Math.sin(piece.pose.heading);
    const lx = dx * c + dz * s;
    const lz = -dx * s + dz * c;
    const paths = getPieceDef(piece.type, piece.flipped).paths;
    for (let i = 0; i < paths.length; i++) {
      const g = paths[i].geom;
      const along = closestS(g, lx, lz);
      samplePath(g, along, sample);
      const distance = Math.hypot(sample.x - lx, sample.z - lz);
      if (distance > maxDistance || (best && distance >= best.distance)) continue;
      const worldHeading = piece.pose.heading + sample.heading;
      const reversed = angleDiff(worldHeading, heading) > Math.PI / 2;
      best = {
        cursor: { pieceId: id, pathIndex: i, reversed, s: reversed ? pathLength(g) - along : along },
        distance,
      };
    }
  }
  return best;
}

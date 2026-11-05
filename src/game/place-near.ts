/**
 * Which place a train is "by", for a card ("the train parked by the oil well"): the nearest of some places (a stop's or a
 * town station's stretch of track, from end `a` to end `b`), measured to the nearest point of each stretch. Across the
 * train's own line counts double: a stop on the line it stands on is where the player looks, before a town across the
 * field (QA 2026-11-05 #2: a crane train beside the oil well was "parked by Elderwick", 234 mm across a field).
 */
export interface Place {
  name: string;
  a: { x: number; z: number };
  b: { x: number; z: number };
}

/** Across the train's line counts this many times along it. */
export const ACROSS_WEIGHT = 2;

/**
 * The name of the place nearest `at` (a car, heading `heading` in radians, its +x along the track) within `near` (mm,
 * the weighted distance), or "" when none is that near. Names longer than `longest` are passed over.
 */
export function placeNear(at: { x: number; z: number }, heading: number, places: readonly Place[], near: number, longest = Infinity): string {
  const ux = Math.cos(heading);
  const uz = Math.sin(heading);
  let best = "";
  let bestD = near * near;
  for (const p of places) {
    if (p.name.length > longest) continue;
    // The nearest point of the stretch.
    const sx = p.b.x - p.a.x;
    const sz = p.b.z - p.a.z;
    const len2 = sx * sx + sz * sz;
    const f = len2 > 0 ? Math.max(0, Math.min(1, ((at.x - p.a.x) * sx + (at.z - p.a.z) * sz) / len2)) : 0;
    const dx = p.a.x + sx * f - at.x;
    const dz = p.a.z + sz * f - at.z;
    const along = dx * ux + dz * uz;
    const across = (dz * ux - dx * uz) * ACROSS_WEIGHT;
    const d = along * along + across * across;
    if (d < bestD) {
      bestD = d;
      best = p.name;
    }
  }
  return best;
}

/** Plan-view pose. heading is measured from +x toward +z; direction = (cos heading, sin heading). */
export interface Pose {
  x: number;
  z: number;
  heading: number;
}

export const TAU = Math.PI * 2;

/** Normalise to (-π, π]. */
export function normalizeAngle(a: number): number {
  let r = a % TAU;
  if (r <= -Math.PI) r += TAU;
  else if (r > Math.PI) r -= TAU;
  return r;
}

/** Smallest absolute angle between a and b, in [0, π]. */
export function angleDiff(a: number, b: number): number {
  return Math.abs(normalizeAngle(a - b));
}

/** World pose of `local` expressed in `parent`'s frame. Writes into and returns `out`. */
export function transformPose(parent: Pose, local: Pose, out: Pose): Pose {
  const c = Math.cos(parent.heading);
  const s = Math.sin(parent.heading);
  const x = parent.x + local.x * c - local.z * s;
  const z = parent.z + local.x * s + local.z * c;
  out.x = x;
  out.z = z;
  out.heading = normalizeAngle(parent.heading + local.heading);
  return out;
}

/** The parent pose for which transformPose(parent, local) === world. Writes into and returns `out`. */
export function solveParentPose(local: Pose, world: Pose, out: Pose): Pose {
  const h = normalizeAngle(world.heading - local.heading);
  const c = Math.cos(h);
  const s = Math.sin(h);
  out.x = world.x - (local.x * c - local.z * s);
  out.z = world.z - (local.x * s + local.z * c);
  out.heading = h;
  return out;
}

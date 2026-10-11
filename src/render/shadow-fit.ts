import { Vector3, type PerspectiveCamera } from "three";

/** Fitting the sun's shadow frustum to what the camera sees, so shadows stay crisp up close. */

const MIN_RADIUS = 500;
const MAX_RADIUS = 3200;

/** Whether the shadow frustum should be refitted: the view has panned or zoomed enough to matter. */
export function shouldRefit(current: { x: number; z: number; radius: number }, x: number, z: number, radius: number): boolean {
  const moved = Math.hypot(x - current.x, z - current.z);
  return moved > current.radius * 0.1 || Math.abs(radius - current.radius) > current.radius * 0.1;
}

const near = new Vector3();
const far = new Vector3();
const SAMPLES = [
  [-1, -1], [1, -1], [-1, 1], [1, 1], [0, 1], [0, -1], [-1, 0], [1, 0],
] as const;

/**
 * Shadow frustum half-size (mm) that covers the ground the camera can actually see: the farthest point, from the
 * target, where the view's corner and edge rays meet the floor. A view reaching the horizon gets the whole mat.
 */
export function shadowRadiusForView(camera: PerspectiveCamera, target: Vector3): number {
  let r = 0;
  for (const [x, y] of SAMPLES) {
    near.set(x, y, -1).unproject(camera);
    far.set(x, y, 1).unproject(camera).sub(near);
    // Rays that never come down to the floor see all the way to the horizon.
    if (far.y > -1e-6) return MAX_RADIUS;
    const t = -near.y / far.y;
    r = Math.max(r, Math.hypot(near.x + far.x * t - target.x, near.z + far.z * t - target.z));
  }
  return Math.min(MAX_RADIUS, Math.max(MIN_RADIUS, r * 1.05));
}

/** Fitting the sun's shadow frustum to what the camera sees, so shadows stay crisp up close. */

const MIN_RADIUS = 500;
const MAX_RADIUS = 2200;

/** Shadow frustum half-size (mm) for a camera this far from its target. */
export function shadowRadiusFor(cameraDistance: number): number {
  return Math.min(MAX_RADIUS, Math.max(MIN_RADIUS, cameraDistance * 0.9));
}

/** Whether the shadow frustum should be refitted: the view has panned or zoomed enough to matter. */
export function shouldRefit(current: { x: number; z: number; radius: number }, x: number, z: number, radius: number): boolean {
  const moved = Math.hypot(x - current.x, z - current.z);
  return moved > current.radius * 0.1 || Math.abs(radius - current.radius) > current.radius * 0.1;
}

import { Frustum, Matrix4, Sphere, Vector3, type Camera, type PerspectiveCamera } from "three";

/**
 * Ambient motion (an industry's saw or axe, a boat sailing in, a lorry on a road): things that move for looks while the
 * game is otherwise still. Each asks for frames only while it's on screen *and* big enough there to see it move, so a
 * zoomed-out map with a dozen busy industries stays still and costs nothing. One `AmbientEye`, set once a frame from the
 * camera (`set`: a matrix product and six planes), answers for all of them (`sees`: a sphere test and a division).
 *
 * The size test: a thing `size` mm across, `d` mm from the eye, is `size * pxPerMm / d` pixels on screen
 * (`pxPerMm`: the drawing's height over the view's height at 1 mm). Below `minPx` its motion is a pixel's flicker.
 */
export class AmbientEye {
  private readonly frustum = new Frustum();
  private readonly viewProjection = new Matrix4();
  private readonly eye = new Vector3();
  private readonly sphere = new Sphere();
  /** Pixels per mm at 1 mm from the eye (0 until `set`: nothing is seen). */
  private pxPerMm = 0;

  /** Take this frame's view: `camera` (its matrices up to date) and the drawing's height in CSS pixels. */
  set(camera: Camera, viewH: number): void {
    this.viewProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.viewProjection);
    this.eye.setFromMatrixPosition(camera.matrixWorld);
    const fov = (camera as PerspectiveCamera).isPerspectiveCamera ? (camera as PerspectiveCamera).fov : 45;
    this.pxPerMm = viewH / (2 * Math.tan((fov * Math.PI) / 360));
  }

  /** How many pixels across a thing `size` mm across at (x, y, z) is drawn. */
  pixels(x: number, y: number, z: number, size: number): number {
    const d = Math.max(1, Math.hypot(x - this.eye.x, y - this.eye.y, z - this.eye.z));
    return (size * this.pxPerMm) / d;
  }

  /**
   * Is a moving thing `size` mm across at (x, y, z) worth a frame: within `reach` mm of there is in view (default: its
   * size; a mote that wanders, or a shadow it casts, may want more), and it's drawn at least `minPx` pixels across.
   */
  sees(x: number, y: number, z: number, size: number, minPx: number, reach = size): boolean {
    if (this.pixels(x, y, z, size) < minPx) return false;
    this.sphere.center.set(x, y, z);
    this.sphere.radius = reach;
    return this.frustum.intersectsSphere(this.sphere);
  }
}

/**
 * How big (px across on screen) an ambient motion must be drawn to ask for frames. Below it, what moves is too small to
 * see moving, so it stands where it was until the view comes closer (a camera move draws anyway, and the next frame
 * poses it). CSS pixels. Measured on a 390×844 phone (fov 30°, tools/perf/ambient.mjs): a sawmill's 22 mm saw is 11 px
 * at 3 m and 7 at 5 m, an axe 8 px at 3 m; a mill's 72 mm sails 25 px at 5 m. So from about 3 m out only the big
 * wheels and sails turn, and from about 8 m nothing (the cranes' parts are culled there too).
 */
export const AMBIENT_MIN_PX = {
  /** A sawmill's saw, a mill's sails, a mine's or power station's wheel (by its diameter). */
  blade: 12,
  /** A yard's little movers: the woodcutter's axe, the pigs, the quarry's tub (by their length). */
  mote: 8,
  /** A boat sailing in or out (by its length). */
  boat: 8,
  /** A road vehicle (by its length). */
  vehicle: 6,
} as const;

/**
 * The most often ambient motion alone is drawn (ms between frames): when nothing but ambient motion moves (no train, no
 * camera move, no change), every other of the game's 30 a second (`FRAME_MS`), so 15 a second; trains and the camera
 * keep the full 30.
 */
export const AMBIENT_FRAME_MS = 1000 / 15;

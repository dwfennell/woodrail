import { Spherical, Vector3, type PerspectiveCamera } from "three";
import type { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { damp, easeInOutCubic } from "../lib/tween";

/** Camera distance at which a sphere of `radius` just fits the view (the narrower of the two fovs decides). */
export function frameDistance(radius: number, fovDeg: number, aspect: number): number {
  const vHalf = (fovDeg * Math.PI) / 360;
  const hHalf = Math.atan(Math.tan(vHalf) * aspect);
  return radius / Math.sin(Math.min(vHalf, hHalf));
}

/**
 * A view of some places (on the ground, mm) with the two furthest apart along the screen's long side (up the screen on
 * a phone held upright, across it on a wide one): where to look, how far back, and which way to face (`theta`, as
 * three's Spherical has it). `margin` is room round the places. With one place, `theta` is null (face as before).
 */
export function frameAlong(
  points: readonly { x: number; z: number }[],
  fovDeg: number,
  aspect: number,
  margin: number,
): { x: number; z: number; distance: number; theta: number | null } {
  let a = points[0];
  let b = points[0];
  let far = 0;
  if (points.length <= 16) {
    for (const p of points) {
      for (const q of points) {
        const d = Math.hypot(p.x - q.x, p.z - q.z);
        if (d > far) {
          far = d;
          a = p;
          b = q;
        }
      }
    }
  } else {
    // Many places (a big layout's track): the two furthest along its bounding box's longer side, near enough.
    const xs0 = points.reduce((m, p) => (p.x < m.x ? p : m));
    const xs1 = points.reduce((m, p) => (p.x > m.x ? p : m));
    const zs0 = points.reduce((m, p) => (p.z < m.z ? p : m));
    const zs1 = points.reduce((m, p) => (p.z > m.z ? p : m));
    [a, b] = xs1.x - xs0.x >= zs1.z - zs0.z ? [xs0, xs1] : [zs0, zs1];
    far = Math.hypot(a.x - b.x, a.z - b.z);
  }
  const xs = points.map((p) => p.x);
  const zs = points.map((p) => p.z);
  const x = (Math.min(...xs) + Math.max(...xs)) / 2;
  const z = (Math.min(...zs) + Math.max(...zs)) / 2;
  const vHalf = (fovDeg * Math.PI) / 360;
  const hHalf = Math.atan(Math.tan(vHalf) * aspect);
  const long = Math.max(vHalf, hHalf);
  const short = Math.min(vHalf, hHalf);
  // The span fits the long side, and the places' own surroundings the short one.
  const distance = Math.max((far / 2 + margin) / Math.sin(long), margin / Math.sin(short));
  if (far < 1) return { x, z, distance, theta: null };
  // The camera stands back along `theta`: facing along the span puts it up the screen.
  const along = Math.atan2(b.x - a.x, b.z - a.z);
  return { x, z, distance, theta: aspect < 1 ? along : along + Math.PI / 2 };
}

/**
 * Near clipping plane for a camera `distance` from what it looks at. Depth precision falls with the square of
 * distance over the near plane, so a fixed close plane makes the felt's hem, the rivers and the blocks' painted tops
 * shimmer against what's under them in wide views. Scaling it with distance keeps that steady while staying well
 * short of anything in view (the camera is never steeper than its polar limit above the ground).
 */
export function nearPlaneFor(distance: number): number {
  return Math.max(5, distance / 30);
}

const sph = new Spherical();
const off = new Vector3();

/** Keep the camera within its distance range and above the polar limit (in place). */
export function clampView(target: Vector3, position: Vector3, minDist: number, maxDist: number, maxPolar: number): void {
  off.subVectors(position, target);
  sph.setFromVector3(off);
  sph.radius = Math.min(maxDist, Math.max(minDist, sph.radius));
  sph.phi = Math.min(maxPolar, Math.max(0.05, sph.phi));
  position.copy(target).add(off.setFromSpherical(sph));
}

/** A rectangle the camera may look at (world mm). */
export interface ViewBounds {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
}

/** Keep the look-at point within the bounds (over the land), moving the camera by the same amount (in place). */
export function clampTarget(target: Vector3, position: Vector3, b: ViewBounds): void {
  const x = Math.min(b.x1, Math.max(b.x0, target.x));
  const z = Math.min(b.z1, Math.max(b.z0, target.z));
  position.x += x - target.x;
  position.z += z - target.z;
  target.x = x;
  target.z = z;
}

/**
 * How hard to pan when the pointer is near a screen edge: −1..1 per axis, zero outside a `zone`-pixel band,
 * ramping in quadratically.
 */
export function edgePan(x: number, y: number, w: number, h: number, zone: number, out: { dx: number; dy: number }): void {
  const ramp = (v: number, size: number) => {
    if (v < zone) return -(((zone - Math.max(0, v)) / zone) ** 2);
    if (v > size - zone) return ((Math.min(size, v) - (size - zone)) / zone) ** 2;
    return 0;
  };
  out.dx = ramp(x, w);
  out.dy = ramp(y, h);
}

export interface TapRecord {
  t: number;
  x: number;
  y: number;
}

export function isDoubleTap(prev: TapRecord | null, now: TapRecord, maxMs = 300, maxPx = 24): boolean {
  return !!prev && now.t - prev.t <= maxMs && Math.hypot(now.x - prev.x, now.y - prev.y) <= maxPx;
}

/** Interpolate between angles the short way round. */
export function lerpAngle(a: number, b: number, t: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

interface Shot {
  fromTarget: Vector3;
  toTarget: Vector3;
  from: Spherical;
  to: Spherical;
  elapsed: number;
  duration: number;
  delay: number;
  /** Keep the destination on something moving (writes into the given vector; false when it's gone). */
  track?: (out: Vector3) => boolean;
}

const EDGE_PAN_SPEED = 0.9; // view distances per second at full push

/**
 * On touch, panning while placing waits and creeps (QA: the view ran off with the target mid-drag): the finger must stay
 * in a narrow band at the edge for EDGE_TOUCH_DWELL seconds before the view moves, then it eases in over
 * EDGE_TOUCH_RAMP seconds to EDGE_TOUCH_SPEED of the mouse's speed. A finger passing through the band, or resting
 * near the edge to place something there, leaves the view be.
 */
export const EDGE_TOUCH_ZONE = 36;
export const EDGE_TOUCH_DWELL = 0.5;
export const EDGE_TOUCH_RAMP = 0.3;
export const EDGE_TOUCH_SPEED = 0.5;

/**
 * How much of its speed an edge pan has, `held` seconds after the pointer came into the band (0 while waiting). A mouse
 * pans at once and in full; a finger waits, then eases in, and goes at most half as fast.
 */
export function edgeDwell(held: number, touch: boolean): number {
  if (!touch) return 1;
  if (held < EDGE_TOUCH_DWELL) return 0;
  return EDGE_TOUCH_SPEED * Math.min(1, (held - EDGE_TOUCH_DWELL) / EDGE_TOUCH_RAMP);
}
const ZOOM_RATE = 0.0026;
const ZOOM_LAMBDA = 22;
const FOLLOW_LAMBDA = 5;

/**
 * Moves the camera on the game's behalf: eased glides (fly-in, focus), smooth zoom toward the pointer, edge panning
 * while dragging, and following a train. Any direct camera input from the player cancels a glide.
 */
export class CameraDirector {
  private shot: Shot | null = null;
  private zoomGoal = -1;
  private readonly zoomAnchor = new Vector3();
  private followed: (() => Vector3 | null) | null = null;
  private readonly edge = { dx: 0, dy: 0 };
  private edgePointer: { x: number; y: number; zone: number; bottom?: number; touch: boolean } | null = null;
  /** A drag that asked to wait hasn't yet left the edge band: no panning until it does. */
  private edgeWaiting = false;
  /** How long (s) the pointer has been in the edge band (see `edgeDwell`). */
  private edgeHeld = 0;
  private readonly tmp = new Vector3();
  private readonly tmp2 = new Vector3();
  private readonly right = new Vector3();
  private readonly forward = new Vector3();
  /** Half extents of the area the camera may look at (the mat). */
  bounds: ViewBounds = { x0: -Infinity, z0: -Infinity, x1: Infinity, z1: Infinity };

  constructor(
    private readonly camera: PerspectiveCamera,
    private readonly controls: OrbitControls,
  ) {
    controls.addEventListener("start", () => this.cancel());
  }

  /** True while a glide is running. */
  get busy(): boolean {
    return this.shot !== null;
  }

  /** Stop any glide or pending zoom where it is. */
  cancel(): void {
    this.shot = null;
    this.zoomGoal = -1;
  }

  /** Glide to look at `target` from `distance`, at polar angle `phi` (keeps the current heading unless given). */
  glideTo(
    target: Vector3,
    distance: number,
    opts: { phi?: number; theta?: number; duration?: number; delay?: number; track?: (out: Vector3) => boolean } = {},
  ): void {
    const c = this.controls;
    const from = new Spherical().setFromVector3(this.tmp.subVectors(this.camera.position, c.target));
    const to = new Spherical(distance, opts.phi ?? from.phi, opts.theta ?? from.theta);
    to.radius = Math.min(c.maxDistance, Math.max(c.minDistance, to.radius));
    to.phi = Math.min(c.maxPolarAngle, Math.max(0.05, to.phi));
    this.zoomGoal = -1;
    this.shot = { fromTarget: c.target.clone(), toTarget: this.onMat(target.clone()), from, to, elapsed: 0, duration: opts.duration ?? 0.7, delay: opts.delay ?? 0, track: opts.track };
  }

  /** Frame a point of interest of the given radius, keeping the viewing direction. Never zooms out. */
  focus(point: Vector3, radius: number): void {
    const current = this.camera.position.distanceTo(this.controls.target);
    const d = Math.min(frameDistance(radius, this.camera.fov, this.camera.aspect), current * 0.7);
    this.glideTo(point, d, { duration: 0.75 });
  }

  /** Follow a moving object (or stop following with null), easing to a lower, closer angle. */
  follow(position: (() => Vector3 | null) | null): void {
    this.followed = position;
    if (!position) return;
    const p = position();
    if (p) this.glideTo(p, 420, { phi: 1.08, duration: 0.9 });
  }

  get following(): boolean {
    return this.followed !== null;
  }

  /** Wheel zoom: ease toward a new distance, keeping the ground point under the pointer fixed on screen. */
  zoomAt(anchor: Vector3 | null, deltaY: number): void {
    const c = this.controls;
    this.shot = null;
    const current = this.camera.position.distanceTo(c.target);
    const base = this.zoomGoal > 0 ? this.zoomGoal : current;
    this.zoomGoal = Math.min(c.maxDistance, Math.max(c.minDistance, base * Math.exp(deltaY * ZOOM_RATE)));
    // A pointer out over the scenery anchors at the nearest point on the mat, where the view is allowed to go.
    this.onMat(this.zoomAnchor.copy(anchor ?? c.target));
  }

  /** Move a point onto the area the camera may look at (in place). */
  private onMat(p: Vector3): Vector3 {
    p.x = Math.min(this.bounds.x1, Math.max(this.bounds.x0, p.x));
    p.z = Math.min(this.bounds.z1, Math.max(this.bounds.z0, p.z));
    return p;
  }

  /**
   * While dragging a piece: pan when the pointer nears a screen edge (null when not dragging). `bottom` is where the
   * usable view ends (the top of the tray), so the bottom edge zone sits just above it. With `waitForExit`, a pointer
   * that arrives inside the band (a drag coming up out of the tray) doesn't pan until it has left the band once.
   * `zone` overrides the band's width (px).
   */
  setEdgePointer(p: { x: number; y: number; touch: boolean; bottom?: number; waitForExit?: boolean; zone?: number } | null): void {
    if (p && !this.edgePointer) this.edgeWaiting = !!p.waitForExit;
    if (!p) this.edgeHeld = 0;
    this.edgePointer = p ? { x: p.x, y: p.y, zone: p.zone ?? (p.touch ? EDGE_TOUCH_ZONE : 48), bottom: p.bottom, touch: p.touch } : null;
  }

  /** True when the last update panned the view (dragged things under the pointer need re-placing). */
  edgePanning = false;

  update(dt: number, viewW: number, viewH: number): void {
    const c = this.controls;
    const cam = this.camera;
    this.edgePanning = false;

    if (this.shot) {
      const s = this.shot;
      if (s.track && !s.track(s.toTarget)) s.track = undefined;
      this.onMat(s.toTarget);
      if (s.delay > 0) s.delay -= dt;
      else {
        s.elapsed += dt;
        const k = easeInOutCubic(s.elapsed / s.duration);
        c.target.lerpVectors(s.fromTarget, s.toTarget, k);
        sph.radius = s.from.radius + (s.to.radius - s.from.radius) * k;
        sph.phi = s.from.phi + (s.to.phi - s.from.phi) * k;
        sph.theta = lerpAngle(s.from.theta, s.to.theta, k);
        cam.position.copy(c.target).add(off.setFromSpherical(sph));
        if (s.elapsed >= s.duration) this.shot = null;
      }
    } else if (this.zoomGoal > 0) {
      // Scale the view about the anchor: the anchor stays put on screen while the camera closes in.
      const d = cam.position.distanceTo(c.target);
      const next = damp(d, this.zoomGoal, ZOOM_LAMBDA, dt);
      const k = next / d;
      c.target.sub(this.zoomAnchor).multiplyScalar(k).add(this.zoomAnchor);
      cam.position.sub(this.zoomAnchor).multiplyScalar(k).add(this.zoomAnchor);
      if (Math.abs(next - this.zoomGoal) < 0.5) this.zoomGoal = -1;
    }

    if (this.followed && !this.shot) {
      const p = this.followed();
      if (!p) this.followed = null;
      else {
        this.tmp2.copy(c.target);
        c.target.set(damp(c.target.x, p.x, FOLLOW_LAMBDA, dt), damp(c.target.y, p.y, FOLLOW_LAMBDA, dt), damp(c.target.z, p.z, FOLLOW_LAMBDA, dt));
        cam.position.add(this.tmp.subVectors(c.target, this.tmp2));
      }
    } else if (this.followed && this.shot) {
      // Keep the glide's destination on the moving train.
      const p = this.followed();
      if (p) this.onMat(this.shot.toTarget.copy(p));
    }

    if (this.edgePointer) {
      edgePan(this.edgePointer.x, this.edgePointer.y, viewW, this.edgePointer.bottom ?? viewH, this.edgePointer.zone, this.edge);
      const inBand = this.edge.dx !== 0 || this.edge.dy !== 0;
      if (!inBand) this.edgeWaiting = false;
      this.edgeHeld = inBand && !this.edgeWaiting ? this.edgeHeld + dt : 0;
      const push = edgeDwell(this.edgeHeld, this.edgePointer.touch);
      if (inBand && !this.edgeWaiting && push > 0) {
        const dist = cam.position.distanceTo(c.target);
        cam.getWorldDirection(this.forward);
        this.forward.y = 0;
        this.forward.normalize();
        this.right.set(-this.forward.z, 0, this.forward.x);
        const step = EDGE_PAN_SPEED * push * dist * dt;
        this.tmp.copy(this.right).multiplyScalar(this.edge.dx * step).addScaledVector(this.forward, -this.edge.dy * step);
        c.target.add(this.tmp);
        cam.position.add(this.tmp);
        this.edgePanning = true;
      }
    }

    this.constrain();
  }

  /** Pull the view back within bounds: target over the mat, distance and tilt within limits. */
  constrain(): void {
    const c = this.controls;
    clampTarget(c.target, this.camera.position, this.bounds);
    clampView(c.target, this.camera.position, c.minDistance, c.maxDistance, c.maxPolarAngle);
  }
}

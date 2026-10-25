import { Plane, Raycaster, Spherical, Vector2, Vector3, type PerspectiveCamera } from "three";

/** Pan momentum after a fling fades with this time constant (s): long enough to glide, short enough to stop. */
export const PAN_GLIDE = 0.45;
/** Twist momentum fades faster. */
export const SPIN_GLIDE = 0.25;
/** A fling only carries on if the finger was still moving within this long (s) of lifting. */
const FLING_WINDOW = 0.08;
/** Tilt per pixel of a two-finger vertical drag (radians). */
const TILT_RATE = 0.006;
/** Movement (px) before a two-finger gesture commits to tilting or to pan/pinch/twist. */
const DECIDE_PX = 16;
const MIN_POLAR = 0.12;

export interface TouchCameraLimits {
  minDistance: number;
  maxDistance: number;
  maxPolarAngle: number;
  /** The steepest the view may look down (the game's pitch cap: see `MIN_PITCH` in game.ts). */
  minPolarAngle: number;
}

type Point = { x: number; y: number };

/**
 * Touch camera gestures, Maps-style, where the ground under the fingers stays under the fingers:
 * - one finger drags the ground, and a fling glides on, slowing smoothly;
 * - two fingers pan with their midpoint, pinch to zoom and twist to turn, all about the ground under the midpoint;
 * - two fingers dragged up or down together tilt the view.
 * Works on a camera looking at `target` (the orbit target); no DOM here, so it can be driven by tests.
 */
export class TouchGestures {
  private readonly raycaster = new Raycaster();
  private readonly plane = new Plane(new Vector3(0, 1, 0), 0);
  private readonly ndc = new Vector2();
  private readonly a = new Vector3();
  private readonly b = new Vector3();
  private readonly sph = new Spherical();
  private readonly off = new Vector3();

  /** Ground point held under one finger, or under two fingers' midpoint. */
  private anchor: Vector3 | null = null;
  private prev: Point[] = [];
  private twoMode: "undecided" | "tilt" | "transform" = "undecided";
  private travel = 0;
  /** Recent pan velocity (world mm/s) and twist rate (rad/s), for flings. */
  readonly panVelocity = new Vector3();
  spinVelocity = 0;
  private lastMoveAt = 0;
  private spinAnchor = new Vector3();
  private readonly gp0 = new Vector3();
  private readonly gp1 = new Vector3();
  private readonly gq0 = new Vector3();
  private readonly gq1 = new Vector3();
  private readonly pivot = new Vector3();
  private readonly goal = new Vector3();

  constructor(
    private readonly camera: PerspectiveCamera,
    private readonly target: Vector3,
    private readonly limits: TouchCameraLimits,
  ) {}

  /** The ground point under a screen point (px within a view of the given size), on the target's level. */
  groundAt(p: Point, view: { width: number; height: number }, out: Vector3): Vector3 | null {
    this.ndc.set((p.x / view.width) * 2 - 1, -(p.y / view.height) * 2 + 1);
    this.camera.updateMatrixWorld();
    this.raycaster.setFromCamera(this.ndc, this.camera);
    this.plane.constant = -this.target.y;
    const hit = this.raycaster.ray.intersectPlane(this.plane, out);
    // Points out near the horizon move the view by absurd amounts: ignore them.
    if (!hit || hit.distanceTo(this.camera.position) > this.camera.position.distanceTo(this.target) * 8) return null;
    return hit;
  }

  /** Fingers changed (one went down or up): restart from where they are now, keeping no stale momentum. */
  begin(points: readonly Point[], view: { width: number; height: number }): void {
    this.prev = points.map((p) => ({ x: p.x, y: p.y }));
    this.twoMode = "undecided";
    this.travel = 0;
    this.panVelocity.set(0, 0, 0);
    this.spinVelocity = 0;
    const c = midpoint(points);
    this.anchor = c ? this.groundAt(c, view, new Vector3()) : null;
  }

  /** Fingers moved to `points` (same fingers, same order as `begin`), `time` in seconds. */
  move(points: readonly Point[], view: { width: number; height: number }, time: number): void {
    if (points.length !== this.prev.length || points.length === 0) return this.begin(points, view);
    const dt = Math.max(1e-3, time - this.lastMoveAt);
    this.lastMoveAt = time;
    const before = this.a.copy(this.target);

    if (points.length >= 2) {
      const [p0, p1] = this.prev;
      const [q0, q1] = points;
      // (While undecided, `prev` is still where the fingers went down, so this is the distance moved so far.)
      if (this.twoMode === "undecided") this.travel = Math.hypot(q0.x - p0.x, q0.y - p0.y) + Math.hypot(q1.x - p1.x, q1.y - p1.y);
      if (this.twoMode === "undecided" && this.travel > DECIDE_PX) this.twoMode = isTilt(p0, p1, q0, q1) ? "tilt" : "transform";
      if (this.twoMode === "tilt") {
        const dy = (q0.y - p0.y + (q1.y - p1.y)) / 2;
        this.tilt(-dy * TILT_RATE);
      } else if (this.twoMode === "transform") {
        // Exact on the ground: the turn, scale and shift (about the ground) that take what's under the fingers now
        // back to what was under them a moment ago. Moving the camera by that keeps both points under both fingers.
        const gp0 = this.groundAt(p0, view, this.gp0);
        const gp1 = gp0 && this.groundAt(p1, view, this.gp1);
        const gq0 = gp1 && this.groundAt(q0, view, this.gq0);
        const gq1 = gq0 && this.groundAt(q1, view, this.gq1);
        if (gp0 && gp1 && gq0 && gq1) {
          const turn = angleBetween(Math.atan2(gq1.z - gq0.z, gq1.x - gq0.x), Math.atan2(gp1.z - gp0.z, gp1.x - gp0.x));
          const scale = Math.hypot(gp1.x - gp0.x, gp1.z - gp0.z) / Math.max(1e-6, Math.hypot(gq1.x - gq0.x, gq1.z - gq0.z));
          const pivot = this.pivot.addVectors(gq0, gq1).multiplyScalar(0.5);
          const goal = this.goal.addVectors(gp0, gp1).multiplyScalar(0.5);
          this.turnAbout(pivot, turn);
          this.zoomAbout(pivot, scale);
          this.off.subVectors(goal, pivot);
          this.off.y = 0;
          this.target.add(this.off);
          this.camera.position.add(this.off);
          this.spinVelocity = this.spinVelocity * 0.5 + (turn / dt) * 0.5;
          this.spinAnchor.copy(goal);
        }
      }
    } else if (this.anchor) {
      this.holdUnder(this.anchor, points[0], view);
    }

    // Pan velocity from how far the target moved (smoothed).
    const v = this.b.subVectors(this.target, before).divideScalar(dt);
    this.panVelocity.lerp(v, 0.6);
    // Until two fingers commit to a gesture, measure from where they started, so nothing is lost when it does.
    if (!(points.length >= 2 && this.twoMode === "undecided")) this.prev = points.map((p) => ({ x: p.x, y: p.y }));
  }

  /** All fingers lifted at `time`: keep momentum only if they were still moving. */
  end(time: number): void {
    if (time - this.lastMoveAt > FLING_WINDOW) {
      this.panVelocity.set(0, 0, 0);
      this.spinVelocity = 0;
    }
    this.anchor = null;
    this.prev = [];
  }

  /** Stop any glide (another camera move took over). */
  stop(): void {
    this.panVelocity.set(0, 0, 0);
    this.spinVelocity = 0;
  }

  /** Carry flings on between gestures, slowing smoothly. True while still moving. */
  glide(dt: number): boolean {
    let moving = false;
    if (this.panVelocity.lengthSq() > 1) {
      this.off.copy(this.panVelocity).multiplyScalar(dt);
      this.off.y = 0;
      this.target.add(this.off);
      this.camera.position.add(this.off);
      this.panVelocity.multiplyScalar(Math.exp(-dt / PAN_GLIDE));
      moving = true;
    } else this.panVelocity.set(0, 0, 0);
    if (Math.abs(this.spinVelocity) > 0.02) {
      this.turnAbout(this.spinAnchor, this.spinVelocity * dt);
      this.spinVelocity *= Math.exp(-dt / SPIN_GLIDE);
      moving = true;
    } else this.spinVelocity = 0;
    return moving;
  }

  /** Move camera and target together so ground point `anchor` lies under screen point `p`. */
  private holdUnder(anchor: Vector3, p: Point, view: { width: number; height: number }): void {
    const under = this.groundAt(p, view, this.b);
    if (!under) return;
    this.off.subVectors(anchor, under);
    this.off.y = 0;
    this.target.add(this.off);
    this.camera.position.add(this.off);
  }

  /** Turn camera and target about a vertical axis through `pivot` by `angle` (plan angle, as atan2(z, x)). */
  private turnAbout(pivot: Vector3, angle: number): void {
    if (angle === 0) return;
    rotateAboutY(this.target, pivot, angle);
    rotateAboutY(this.camera.position, pivot, angle);
    this.camera.lookAt(this.target);
  }

  /** Scale the view about `pivot`: k < 1 closes in. Keeps within the zoom limits (then the fit is only near). */
  private zoomAbout(pivot: Vector3, k: number): void {
    const d = this.camera.position.distanceTo(this.target);
    const next = Math.min(this.limits.maxDistance, Math.max(this.limits.minDistance, d * k));
    const s = next / d;
    if (s === 1) return;
    this.target.sub(pivot).multiplyScalar(s).add(pivot);
    this.camera.position.sub(pivot).multiplyScalar(s).add(pivot);
  }

  /** Tilt the view about the target: positive looks more toward the horizon. */
  private tilt(dPhi: number): void {
    this.off.subVectors(this.camera.position, this.target);
    this.sph.setFromVector3(this.off);
    this.sph.phi = Math.min(this.limits.maxPolarAngle, Math.max(MIN_POLAR, this.limits.minPolarAngle, this.sph.phi + dPhi));
    this.camera.position.copy(this.target).add(this.off.setFromSpherical(this.sph));
    this.camera.lookAt(this.target);
  }
}

function midpoint(points: readonly Point[]): Point | null {
  if (points.length === 0) return null;
  if (points.length === 1) return points[0];
  return { x: (points[0].x + points[1].x) / 2, y: (points[0].y + points[1].y) / 2 };
}

/** Signed smallest difference b − a between two angles. */
function angleBetween(a: number, b: number): number {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

/**
 * A two-finger tilt: the fingers moving up or down together, more than they move apart, together or round each other
 * (one finger may lag the other a little), and side by side or on a slant rather than one above the other.
 */
export function isTilt(p0: Point, p1: Point, q0: Point, q1: Point): boolean {
  const d0x = q0.x - p0.x;
  const d0y = q0.y - p0.y;
  const d1x = q1.x - p1.x;
  const d1y = q1.y - p1.y;
  // Shared movement, and how the fingers moved relative to each other (pinching or twisting).
  const cx = (d0x + d1x) / 2;
  const cy = (d0y + d1y) / 2;
  const apart = Math.hypot(d1x - d0x, d1y - d0y);
  const vertical = Math.abs(cy) > Math.abs(cx) * 1.5;
  const together = apart < Math.abs(cy);
  const sideBySide = Math.abs(p1.x - p0.x) > Math.abs(p1.y - p0.y) * 0.6;
  return vertical && together && sideBySide;
}

/** Rotate point `p` about the vertical axis through `pivot` by `angle` (in place). */
function rotateAboutY(p: Vector3, pivot: Vector3, angle: number): void {
  const x = p.x - pivot.x;
  const z = p.z - pivot.z;
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  p.x = pivot.x + x * c - z * s;
  p.z = pivot.z + x * s + z * c;
}

/**
 * Wires `TouchGestures` to touch pointers on the canvas. Only touches that start on the canvas count, and the camera
 * only moves while `enabled()` (the interaction turns that off while a finger is busy with a piece, a car or cargo).
 */
export class TouchCamera {
  readonly gestures: TouchGestures;
  private readonly fingers = new Map<number, Point>();
  private readonly order: number[] = [];
  private active = false;
  private readonly points: Point[] = [];

  constructor(
    private readonly canvas: HTMLCanvasElement,
    camera: PerspectiveCamera,
    target: Vector3,
    limits: TouchCameraLimits,
    private readonly enabled: () => boolean,
    /** Called when a gesture takes the camera (stop glides, unfollow…). */
    private readonly onStart: () => void,
  ) {
    this.gestures = new TouchGestures(camera, target, limits);
    // Fingers, and the mouse's left button (a one-finger pan, gliding on after a flick).
    const handled = (e: PointerEvent) => e.pointerType === "touch" || (e.pointerType === "mouse" && e.button === 0);
    canvas.addEventListener("pointerdown", (e) => {
      if (!handled(e)) return;
      this.fingers.set(e.pointerId, this.local(e));
      this.order.push(e.pointerId);
      this.restart(e.timeStamp);
    });
    window.addEventListener("pointermove", (e) => {
      if (!this.fingers.has(e.pointerId)) return;
      this.fingers.set(e.pointerId, this.local(e));
      if (!this.enabled()) {
        this.active = false;
        return;
      }
      // The interaction may hand the fingers over mid-gesture (a second finger cancels a drag): pick up from here.
      if (!this.active) return this.restart(e.timeStamp);
      this.gestures.move(this.current(), this.view(), e.timeStamp / 1000);
    });
    const lift = (e: PointerEvent) => {
      if (!this.fingers.delete(e.pointerId)) return;
      this.order.splice(this.order.indexOf(e.pointerId), 1);
      if (this.fingers.size === 0) {
        if (this.active) this.gestures.end(e.timeStamp / 1000);
        this.active = false;
      } else this.restart(e.timeStamp);
    };
    window.addEventListener("pointerup", lift);
    window.addEventListener("pointercancel", lift);
  }

  /** True while any finger (or the mouse's left button) is down on the canvas. */
  get touching(): boolean {
    return this.fingers.size > 0;
  }

  private restart(timeStamp: number): void {
    // (Runs after the interaction's own pointerdown handler, which turns `enabled` off for a press on an object.)
    if (!this.enabled()) {
      this.active = false;
      this.gestures.stop();
      return;
    }
    if (!this.active) this.onStart();
    this.active = true;
    this.gestures.begin(this.current(), this.view());
    void timeStamp;
  }

  private current(): Point[] {
    this.points.length = 0;
    for (const id of this.order) {
      const p = this.fingers.get(id);
      if (p) this.points.push(p);
      if (this.points.length === 2) break;
    }
    return this.points;
  }

  private local(e: PointerEvent): Point {
    const r = this.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  private view(): { width: number; height: number } {
    return { width: this.canvas.clientWidth, height: this.canvas.clientHeight };
  }
}

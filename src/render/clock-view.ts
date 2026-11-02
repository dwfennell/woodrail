import { Frustum, Group, Matrix4, Quaternion, Sphere, Vector3, type Camera, type PerspectiveCamera } from "three";
import type { PropStore } from "../props/store";
import { partsOf, type PropLibrary } from "./props/library";
import { modelKey } from "./props/library";
import type { MotionParts } from "./kit-motions";

/** The prop whose hands show the time: the player's own, real local time. */
export const CLOCK_ASSET = "bldg-station-clock";

/**
 * A clock's hands, as angles (radians, clockwise from twelve) for a local time of day: the minute hand on its minute,
 * the hour hand on its hour and the minutes past it (at half past two, halfway from two to three).
 */
export function handAngles(hours: number, minutes: number): { hour: number; minute: number } {
  const m = Math.floor(minutes) % 60;
  return { hour: (((hours % 12) + m / 60) / 12) * Math.PI * 2, minute: (m / 60) * Math.PI * 2 };
}

/** How long (ms) from `now` to the start of the next minute (a whole minute when it's exactly on one). */
export function msToNextMinute(now: Date): number {
  return 60_000 - (now.getSeconds() * 1000 + now.getMilliseconds());
}

/** The local minute of the day a time is in (what the hands show), for telling when it's changed. */
const minuteOf = (d: Date): number => d.getHours() * 60 + d.getMinutes();

interface Clock {
  readonly group: Group;
  readonly parts: MotionParts;
}

const frustum = new Frustum();
const viewProjection = new Matrix4();
const sphere = new Sphere(new Vector3(), 40);
/**
 * How far (mm) the minute hand's tip moves in a minute: a station clock's face is 8.6 mm across its radius, its
 * minute hand about 0.8 of that (tools/blender/bldg_parts.py `clock`), and a minute is a sixtieth of a turn.
 */
const MINUTE_TIP_MOVE = (2 * Math.PI * 8.6 * 0.8) / 60;
const X_AXIS = new Vector3(1, 0, 0);
const turn = new Quaternion();

/**
 * The station clocks' hands, showing the player's real local time: each clock prop is drawn by `PropsView` bare of its
 * hands, and its hands here, a small group of their own. Nothing looks at them frame by frame: `start` sets a timer for
 * the next minute's start (and then each minute's after it), which turns the hands and asks for one frame if a clock
 * is in view; while the page is hidden there's no timer at all, and on its showing again the hands are set at once.
 */
export class ClockView {
  readonly group = new Group();
  private readonly clocks = new Map<number, Clock>();
  private propsVersion = -1;
  private hidden = -1;
  /** The local minute of the day the hands show (−1: not set yet), and that time. */
  private minute = -1;
  private time = new Date();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private stopWatching: (() => void) | undefined;

  constructor(private readonly library: PropLibrary) {
    this.group.name = "clocks";
  }

  /** How many clocks there are (the frame loop looks at none while there are none). */
  get count(): number {
    return this.clocks.size;
  }

  /** Bring the clocks up to date with the props (`hidden`: one being moved by hand, drawn by the hand). */
  sync(props: PropStore, hidden = -1, force = false): void {
    if (props.version === this.propsVersion && hidden === this.hidden && !force) return;
    this.propsVersion = props.version;
    this.hidden = hidden;
    const seen = new Set<number>();
    for (const p of props.all()) {
      if (p.asset !== CLOCK_ASSET) continue;
      let c = this.clocks.get(p.id);
      if (!c) {
        // The time the hands show may be old (with no clocks, the timer sets none): a new one comes in at the time now.
        this.catchUp();
        const key = modelKey(p.asset, p.variant);
        const template = this.library.livePartsOf(key);
        // Not built yet: asked for, and drawn once it is (the library's onLoaded syncs again, forced).
        if (!template) {
          this.library.load(key).catch(() => {});
          continue;
        }
        const group = template.clone(true);
        // The hands cast no shadow: a millimetre off the face, theirs is only a grey smudge beside each hand that
        // blurs the time at the usual zoom (and two fewer casters for the shadow map).
        group.traverse((o) => (o.castShadow = false));
        c = { group, parts: partsOf(group) };
        this.clocks.set(p.id, c);
        this.group.add(group);
        this.setHands(c);
      }
      seen.add(p.id);
      c.group.position.set(p.x, p.y, p.z);
      c.group.rotation.set(0, -p.heading, 0);
      c.group.visible = p.id !== hidden;
    }
    for (const [id, c] of this.clocks)
      if (!seen.has(id)) {
        this.group.remove(c.group);
        this.clocks.delete(id);
      }
  }

  /**
   * Keep the hands to the time: set them now, then at the start of each minute (one timer, aligned to the minute: a
   * timer's lateness doesn't add up), and at once whenever the page shows again (a hidden page's timers are held back,
   * so it has none). `show` is called when they moved and a clock is in view (draw a frame), with `camera` and the
   * drawing's height in pixels (`viewH`) as they are then. Started once; `dispose` stops it.
   */
  start(camera: Camera, viewH: () => number, show: () => void, doc: Pick<Document, "hidden" | "addEventListener" | "removeEventListener"> = document): void {
    if (this.stopWatching) return;
    const now = () => {
      if (this.clocks.size > 0 && this.tick(new Date(), camera, viewH())) show();
    };
    const schedule = () => {
      clearTimeout(this.timer);
      this.timer = undefined;
      if (doc.hidden) return;
      this.timer = setTimeout(() => {
        now();
        schedule();
        // (A little past the minute's start: a timer may come a millisecond or two early by `Date`'s reckoning.)
      }, msToNextMinute(new Date()) + 20);
    };
    const onVisibility = () => {
      if (!doc.hidden) now();
      schedule();
    };
    doc.addEventListener("visibilitychange", onVisibility);
    this.stopWatching = () => {
      doc.removeEventListener("visibilitychange", onVisibility);
      clearTimeout(this.timer);
      this.timer = undefined;
    };
    now();
    schedule();
  }

  /**
   * The time is `time`: if that's a new minute, the hands are set, and true if a clock is in the camera's view near
   * enough that the move shows (draw a frame for it). A clock out of view, or too far off for a minute's move to show
   * (the map view), shows the right time when it's next drawn. `viewH`: the drawing's height in pixels.
   */
  tick(time: Date, camera: Camera, viewH: number): boolean {
    const minute = minuteOf(time);
    if (minute === this.minute) return false;
    this.minute = minute;
    this.time = time;
    for (const c of this.clocks.values()) this.setHands(c);
    camera.updateMatrixWorld();
    frustum.setFromProjectionMatrix(viewProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
    // Beyond this, a minute's move of the minute hand's tip is under half a pixel.
    const fov = (camera as PerspectiveCamera).isPerspectiveCamera ? (camera as PerspectiveCamera).fov : 45;
    const far = (MINUTE_TIP_MOVE * viewH) / (2 * Math.tan((fov * Math.PI) / 360) * 0.5);
    for (const c of this.clocks.values()) {
      if (!c.group.visible) continue;
      sphere.center.copy(c.group.position);
      if (frustum.intersectsSphere(sphere) && camera.position.distanceTo(sphere.center) < far) return true;
    }
    return false;
  }

  /**
   * Turn a clock's hands to the time. Each turns about its own face's axis (its local x, as `clock` in
   * tools/blender/bldg_parts.py builds it, before the face is turned to look its way): its rest turn, then that.
   */
  /** If the minute's changed since the hands were last set, set every clock's to the time now. */
  private catchUp(): void {
    const t = new Date();
    if (minuteOf(t) === this.minute) return;
    this.minute = minuteOf(t);
    this.time = t;
    for (const c of this.clocks.values()) this.setHands(c);
  }

  private setHands(c: Clock): void {
    const a = handAngles(this.time.getHours(), this.time.getMinutes());
    for (const [name, angle] of [
      ["hour", a.hour],
      ["minute", a.minute],
    ] as const) {
      for (const h of c.parts.get(name)) {
        const rest = (h.userData.rest ??= h.quaternion.clone()) as Quaternion;
        h.quaternion.copy(rest).multiply(turn.setFromAxisAngle(X_AXIS, -angle));
      }
    }
  }

  /** The angles the hands show now (for tests and e2e checks). */
  get shown(): { hour: number; minute: number } {
    return handAngles(this.time.getHours(), this.time.getMinutes());
  }

  dispose(): void {
    this.stopWatching?.();
    this.stopWatching = undefined;
    this.group.clear();
    this.clocks.clear();
  }
}

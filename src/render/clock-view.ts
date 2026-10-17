import { Frustum, Group, Matrix4, Quaternion, Sphere, Vector3, type Camera } from "three";
import type { PropStore } from "../props/store";
import { partsOf, type PropLibrary } from "./props/library";
import { modelKey } from "./props/library";
import type { MotionParts } from "./kit-motions";

/** The prop whose hands show the game's time. */
export const CLOCK_ASSET = "bldg-station-clock";

/** The game starts at eight in the morning. */
const START_MINUTE = 8 * 60;

/** A clock's hands, as angles (radians, clockwise from twelve) for a time in game seconds (a game minute a minute). */
export function handAngles(seconds: number): { hour: number; minute: number } {
  const total = START_MINUTE + Math.floor(seconds / 60);
  const minute = total % 60;
  const hour = (total / 60) % 12;
  return { hour: (hour / 12) * Math.PI * 2, minute: (minute / 60) * Math.PI * 2 };
}

interface Clock {
  readonly group: Group;
  readonly parts: MotionParts;
}

const frustum = new Frustum();
const viewProjection = new Matrix4();
const sphere = new Sphere(new Vector3(), 40);
const X_AXIS = new Vector3(1, 0, 0);
const turn = new Quaternion();

/**
 * The station clocks' hands, showing the game's time: each clock prop is drawn by `PropsView` bare of its hands, and
 * its hands here, a small group of their own. They're set only when the game's minute changes (`tick`: one number
 * compared a frame while there are clocks, nothing at all while there are none), and a frame is drawn for it only
 * when a clock is in view.
 */
export class ClockView {
  readonly group = new Group();
  private readonly clocks = new Map<number, Clock>();
  private propsVersion = -1;
  private hidden = -1;
  /** The game minute the hands show (−1: not set yet). */
  private minute = -1;
  private seconds = 0;

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
        const key = modelKey(p.asset, p.variant);
        const template = this.library.livePartsOf(key);
        // Not built yet: asked for, and drawn once it is (the library's onLoaded syncs again, forced).
        if (!template) {
          this.library.load(key).catch(() => {});
          continue;
        }
        const group = template.clone(true);
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
   * The game's time moved on to `seconds`: if that's a new minute, the hands are set, and true if a clock is in the
   * camera's view (draw a frame for it). A clock out of view shows the right time when it comes into view.
   */
  tick(seconds: number, camera: Camera): boolean {
    this.seconds = seconds;
    const minute = Math.floor(seconds / 60);
    if (minute === this.minute) return false;
    this.minute = minute;
    for (const c of this.clocks.values()) this.setHands(c);
    camera.updateMatrixWorld();
    frustum.setFromProjectionMatrix(viewProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
    for (const c of this.clocks.values()) {
      if (!c.group.visible) continue;
      sphere.center.copy(c.group.position);
      if (frustum.intersectsSphere(sphere)) return true;
    }
    return false;
  }

  /**
   * Turn a clock's hands to the time. Each turns about its own face's axis (its local x, as `clock` in
   * tools/blender/bldg_parts.py builds it, before the face is turned to look its way): its rest turn, then that.
   */
  private setHands(c: Clock): void {
    const a = handAngles(this.seconds);
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

  dispose(): void {
    this.group.clear();
    this.clocks.clear();
  }
}

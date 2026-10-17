import type { Object3D } from "three";
import { lerpAngle } from "../game/camera-director";
import { easeInOutCubic, easeOutCubic, Spring } from "../lib/tween";

/** A short cosmetic animation. `update` returns false when finished; `dispose` runs exactly once afterwards. */
export interface Flourish {
  update(dt: number): boolean;
  dispose(): void;
}

/** Runs flourishes each frame. Layout state never waits on them: they only move stand-in meshes. */
export class Flourishes {
  private list: Flourish[] = [];
  private clearing = false;

  add(f: Flourish): void {
    // A flourish chained from one being cleared finishes at once too.
    if (this.clearing) f.dispose();
    else this.list.push(f);
  }

  update(dt: number): void {
    if (this.list.length === 0) return;
    let w = 0;
    for (let i = 0; i < this.list.length; i++) {
      const f = this.list[i];
      if (f.update(dt)) this.list[w++] = f;
      else f.dispose();
    }
    this.list.length = w;
  }

  /** Finish everything immediately (new map, undo while animating). */
  clear(): void {
    const list = this.list;
    this.list = [];
    this.clearing = true;
    for (const f of list) f.dispose();
    this.clearing = false;
  }

  get count(): number {
    return this.list.length;
  }
}

export interface PiecePose {
  x: number;
  y: number;
  z: number;
  heading: number;
}

function apply(obj: Object3D, x: number, y: number, z: number, heading: number): void {
  obj.matrixAutoUpdate = true;
  obj.position.set(x, y, z);
  obj.rotation.set(0, -heading, 0);
}

function once(done: () => void): () => void {
  let called = false;
  return () => {
    if (called) return;
    called = true;
    done();
  };
}

/** Put a held piece down: slide into place, then drop with a small springy bounce. */
export function settle(obj: Object3D, from: PiecePose, to: PiecePose, done: () => void): Flourish {
  const spring = new Spring(900, 36);
  spring.reset(from.y - to.y);
  let t = 0;
  const finish = once(() => {
    apply(obj, to.x, to.y, to.z, to.heading);
    done();
  });
  return {
    update(dt) {
      t += dt;
      const k = easeOutCubic(t / 0.12);
      const y = spring.step(0, dt);
      apply(obj, from.x + (to.x - from.x) * k, to.y + y, from.z + (to.z - from.z) * k, lerpAngle(from.heading, to.heading, k));
      return !(t >= 0.12 && spring.settled(0, 0.05));
    },
    dispose: finish,
  };
}

/** A refused drop: shake "no", then float back to where the piece came from. */
export function wobbleBack(obj: Object3D, from: PiecePose, to: PiecePose, done: () => void): Flourish {
  const WOBBLE = 0.3;
  const GLIDE = 0.4;
  let t = 0;
  const finish = once(() => {
    apply(obj, to.x, to.y, to.z, to.heading);
    done();
  });
  return {
    update(dt) {
      t += dt;
      if (t < WOBBLE) {
        const decay = 1 - t / WOBBLE;
        apply(obj, from.x, from.y, from.z, from.heading + 0.08 * Math.sin(t * Math.PI * 2 * 4) * decay);
        return true;
      }
      const k = easeInOutCubic((t - WOBBLE) / GLIDE);
      const arc = Math.sin(Math.PI * k) * 16;
      apply(obj, from.x + (to.x - from.x) * k, from.y + (to.y - from.y) * k + arc, from.z + (to.z - from.z) * k, lerpAngle(from.heading, to.heading, k));
      return t < WOBBLE + GLIDE;
    },
    dispose: finish,
  };
}

/** Rotate or flip in place: a quick eased turn to the new heading. */
export function turn(obj: Object3D, from: PiecePose, to: PiecePose, done: () => void): Flourish {
  let t = 0;
  const finish = once(() => {
    apply(obj, to.x, to.y, to.z, to.heading);
    done();
  });
  return {
    update(dt) {
      t += dt;
      const k = easeOutCubic(t / 0.14);
      const lift = Math.sin(Math.PI * Math.min(1, t / 0.14)) * 4;
      apply(obj, from.x + (to.x - from.x) * k, to.y + lift, from.z + (to.z - from.z) * k, lerpAngle(from.heading, to.heading, k));
      return t < 0.14;
    },
    dispose: finish,
  };
}

/** Lift and shrink away to nothing (deleted, or back into the box). */
export function shrinkAway(obj: Object3D, done: () => void): Flourish {
  let t = 0;
  const y0 = obj.position.y;
  const finish = once(done);
  return {
    update(dt) {
      t += dt;
      const k = easeInOutCubic(t / 0.28);
      obj.matrixAutoUpdate = true;
      obj.position.y = y0 + k * 24;
      obj.scale.setScalar(Math.max(0.001, 1 - k));
      return t < 0.28;
    },
    dispose: finish,
  };
}

/** A flourish that starts after a pause (a run of pieces settling one after another). Cleared early, it runs to its end at once. */
export function delayed(seconds: number, start: () => Flourish): Flourish {
  let t = 0;
  let inner: Flourish | null = null;
  return {
    update(dt) {
      t += dt;
      if (!inner && t >= seconds) inner = start();
      return inner ? inner.update(dt) : true;
    },
    dispose() {
      (inner ??= start()).dispose();
    },
  };
}

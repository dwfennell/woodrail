import type { Object3D } from "three";

/**
 * How kit pieces' models move (`KitDef.moves`, src/track/kits.ts): for each asset that moves, the nodes that move (the
 * asset's own pivots, named as its catalogue `animate` names them: door leaves, a portcullis, a crane's trolley) and how
 * they're posed.
 *
 * `pose(parts, on, t)` sets the parts outright: `on` is how far the motion is engaged (0 at rest, easing to 1 while the
 * kit's trigger holds and back to 0 after), `t` the seconds it has run. `pose(parts, 0, t)` must be the same for every
 * t (the rest pose): the library poses the model at rest before baking it, so the static drawing and the live parts
 * agree, and `KitView` can drop the live parts once a kit is back at rest.
 *
 * A kit whose asset has `moves` but no entry here doesn't move (it's drawn static).
 */
export interface KitMotion {
  /** The moving nodes, by name (several nodes may share one: every "leafL"). Nested ones are listed too. */
  readonly parts: readonly string[];
  /** Pose them (see above). */
  pose(parts: MotionParts, on: number, t: number): void;
  /** Seconds to ease `on` from 0 to 1 or back (default 0.8). */
  readonly ease?: number;
  /**
   * A motion that cycles round to its rest pose every `period` seconds (crates on a belt): let go, it runs on at full
   * engagement to the end of its cycle, rather than easing out.
   */
  readonly period?: number;
  /**
   * At full engagement it holds still (doors open, a spout swung out): nothing to draw until it's let go. Otherwise it
   * keeps working (a crane's round) while its trigger holds.
   */
  readonly holds?: boolean;
}

/** A moving model's parts by name. */
export interface MotionParts {
  get(name: string): readonly Object3D[];
}

const each = (parts: MotionParts, name: string, f: (o: Object3D) => void) => {
  for (const o of parts.get(name)) f(o);
};

/** 0 → 1 → 0 smoothly every `period` seconds. */
const wave = (t: number, period: number) => 0.5 - 0.5 * Math.cos((t / period) * Math.PI * 2);

/** A clamshell crane's or a slewing crane's swing: out and back, `period` seconds round. */
const swing = (t: number, period: number) => Math.sin((t / period) * Math.PI * 2);

export const KIT_MOTIONS: Readonly<Record<string, KitMotion>> = {
  // Doors swing open as a train comes in, and close behind it.
  "bldg-engine-shed": {
    parts: ["leafL", "leafR"],
    holds: true,
    pose: (p, on) => {
      each(p, "leafL", (o) => (o.rotation.y = on * 1.5));
      each(p, "leafR", (o) => (o.rotation.y = -on * 1.5));
    },
  },
  // The roundhouse's stall doors open (out toward the turntable) while an engine is on its roads.
  "bldg-roundhouse-segment": {
    parts: ["stallL", "stallR"],
    holds: true,
    pose: (p, on) => {
      each(p, "stallL", (o) => (o.rotation.y = -on * 1.5));
      each(p, "stallR", (o) => (o.rotation.y = on * 1.5));
    },
  },
  // The portcullis rises as a train comes, and drops behind it.
  "bldg-castle-gate": {
    parts: ["portcullis"],
    holds: true,
    // Up clear of an engine's chimney (63 mm).
    pose: (p, on) => each(p, "portcullis", (o) => (o.position.y = on * 64)),
    ease: 0.7,
  },
  // Engine services: the spout or chute swings over the engine while it stands there.
  "bldg-water-tower": { parts: ["spout"], holds: true, pose: (p, on) => each(p, "spout", (o) => (o.rotation.y = on * (Math.PI / 2))) },
  "bldg-coal-stage": { parts: ["chute"], holds: true, pose: (p, on) => each(p, "chute", (o) => (o.rotation.x = 0.2 + on * 0.5)) },
  "mech-water-crane": { parts: ["arm"], holds: true, pose: (p, on) => each(p, "arm", (o) => (o.rotation.y = (-Math.PI / 2) * on)) },
  "mech-coaling-crane": {
    parts: ["slew", "grab", "jawA", "jawB"],
    pose: (p, on, t) => {
      each(p, "slew", (o) => (o.rotation.y = on * 0.6 * swing(t, 6)));
      const open = on * 0.6 * wave(t, 2);
      each(p, "jawA", (o) => (o.rotation.x = open));
      each(p, "jawB", (o) => (o.rotation.x = -open));
    },
  },
  "mech-coal-chute": { parts: ["chute"], holds: true, pose: (p, on) => each(p, "chute", (o) => (o.rotation.x = 0.15 + on * 0.6)) },
  "mech-fuel-station": {
    parts: ["arm", "needle"],
    pose: (p, on, t) => {
      // The hose arm swings out from where it rests (as the catalogue shows it at first) over the engine.
      each(p, "arm", (o) => (o.rotation.y = 1.3 * (1 - on) + on * 0.1 * swing(t, 3)));
      each(p, "needle", (o) => (o.rotation.z = -1.2 + 2.4 * on));
    },
  },
  // Cargo machines: their cranes work while a wagon stands under them.
  "mech-gantry-crane": {
    parts: ["trolley", "cable", "hook"],
    pose: (p, on, t) => {
      each(p, "trolley", (o) => (o.position.z = on * 30 * swing(t, 8)));
      const len = 50 + on * 18 * wave(t, 4);
      each(p, "cable", (o) => (o.scale.y = len));
      each(p, "hook", (o) => (o.position.y = -len));
    },
  },
  "mech-harbour-crane": { parts: ["slew"], pose: (p, on, t) => each(p, "slew", (o) => (o.rotation.y = on * 1.2 * swing(t, 9))) },
  "mech-magnet-crane": {
    parts: ["slew", "lift", "cable", "magnet"],
    pose: (p, on, t) => {
      each(p, "slew", (o) => (o.rotation.y = on * 0.9 * swing(t, 10)));
      const len = 30 + on * 22 * wave(t, 5);
      each(p, "cable", (o) => (o.scale.y = len));
      each(p, "magnet", (o) => (o.position.y = -len));
    },
  },
  "mech-log-loader": { parts: ["boom"], pose: (p, on, t) => each(p, "boom", (o) => (o.rotation.y = 0.9 + on * 0.9 * swing(t, 10))) },
  "mech-grain-elevator": { parts: ["spout"], pose: (p, on, t) => each(p, "spout", (o) => (o.rotation.y = on * 0.5 * swing(t, 8))) },
  "mech-cargo-conveyor": {
    parts: ["c0", "c1", "c2", "c3"],
    pose: (p, _on, t) => {
      const angle = Math.atan2(58, 160);
      for (let i = 0; i < 4; i++) {
        const f = (t / 4 + i / 4) % 1;
        each(p, `c${i}`, (o) => {
          o.position.set(-86 + 152 * f, 16 + 55 * f, 0);
          o.rotation.z = angle;
        });
      }
    },
    // The belt goes round in 4 s (each crate back where it started).
    period: 4,
  },
  "mech-tipping-dump": { parts: ["tilt"], pose: (p, on, t) => each(p, "tilt", (o) => (o.rotation.x = on * 0.25 * wave(t, 3))) },
  "mech-drop-hopper": {
    parts: ["doorA", "doorB", "stream"],
    holds: true,
    pose: (p, on) => {
      each(p, "doorA", (o) => (o.rotation.z = -1.3 * on));
      each(p, "doorB", (o) => (o.rotation.z = 1.3 * on));
      each(p, "stream", (o) => (o.visible = on > 0.6));
    },
  },
  "bldg-goods-shed": {
    parts: ["door", "jib"],
    pose: (p, on, t) => {
      each(p, "door", (o) => (o.position.x = on * 34));
      each(p, "jib", (o) => (o.rotation.y = on * 1.4 * swing(t, 12)));
    },
  },
  // The weighbridge's dial swings round while a train crawls over it.
  "mech-weighbridge": {
    parts: ["needle"],
    pose: (p, on, t) => each(p, "needle", (o) => (o.rotation.z = 2 - on * (2.2 + 0.08 * Math.sin(t * 9)))),
  },
};

/** The motion of a kit's asset, if it has one. */
export const motionOf = (asset: string): KitMotion | undefined => KIT_MOTIONS[asset];

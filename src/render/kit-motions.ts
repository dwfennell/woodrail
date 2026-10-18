import type { Object3D } from "three";
import { LIFT_RISE } from "../track/kits";

/** A lift's platform this close (mm) to an end counts as there, for its stop boards (it's eased in: exactly, at its end). */
const LIFT_STOP_SLACK = 1e-3;

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
  /**
   * A kit that moves with its state (`moves: "state"`: a turntable's deck, a transfer table's): its parts stand as its
   * piece's switch state says, gliding from one to the next when it changes. Its `pose` is the rest pose (state 0).
   */
  readonly state?: KitStateMotion;
}

/** How a kit's parts follow its piece's state (see `KitMotion.state`). */
export interface KitStateMotion {
  /** Where its parts stand for state `k` (an angle, a distance: what `pose` takes). */
  value(k: number): number;
  /**
   * Values this far apart look the same (a turntable's deck turned half round lies along the same road): it keeps
   * turning the same way, round and round, rather than back. Omit for a deck that slides back and forth.
   */
  readonly round?: number;
  pose(parts: MotionParts, value: number): void;
  /**
   * What the state is: the piece's switch state ("switches", the default: a deck's road, changing with
   * `Layout.switchesVersion`), or its signals' aspects ("signals": a signal skin's, `Sim.redSignals`, a bit for each
   * road at red, changing with `Sim.signalsVersion`), or where a ride has carried it ("ride": a lift's platform,
   * `Sim.liftPosition`, 0 to 1 and between, changing only as the sim ticks a ride, with `Sim.ridesVersion`; give it
   * `glide: 0`, as the sim's ride is the glide).
   */
  readonly source?: "switches" | "signals" | "ride";
  /** Seconds to glide from one state's value to the next (default `DECK_GLIDE_S`, the deck's); 0: at once (a lamp). */
  readonly glide?: number;
}

/** A moving model's parts by name. */
export interface MotionParts {
  get(name: string): readonly Object3D[];
}

const each = (parts: MotionParts, name: string, f: (o: Object3D) => void) => {
  for (const o of parts.get(name)) f(o);
};

/** A motion that follows a kit's state, its rest pose that of state 0. */
const stateMotion = (parts: readonly string[], state: KitStateMotion): KitMotion => ({ parts, state, pose: (p) => state.pose(p, state.value(0)) });

/** How far a semaphore's arm is raised at clear (radians, as the catalogue model's arm rises). */
const SEMAPHORE_CLEAR = 0.7;

/** The signal gantry's heads (as the model names them) and the roads they stand over, once it's on its piece. */
const GANTRY_HEADS = [
  [1, 0],
  [0, 1],
] as const;

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
  // The train wash: its brushes spin and its sprays drip while a train goes through (at rest: still, and dry).
  // The deck turns to the road its state picks (an eighth of a turn apart), always the same way round.
  "mech-turntable": stateMotion(["deck"], {
    value: (k) => (k * Math.PI) / 4,
    round: Math.PI,
    // (A model's turn is the other way to a piece's heading.)
    pose: (p, a) => each(p, "deck", (o) => (o.rotation.y = -a)),
  }),
  // The deck slides across to the road its state picks: the middle, the left, the right (60 apart).
  "mech-transfer-table": stateMotion(["deck"], {
    value: (k) => [0, 60, -60][k] ?? 0,
    pose: (p, l) => each(p, "deck", (o) => (o.position.z = l)),
  }),
  // The train lift's platform stands where the sim's ride has carried it (0 down, 1 up, between while it rises or
  // falls: `Sim.liftPosition`), its counterweights going the other way and its winding gear turning.
  // Its stop boards show at each end the platform's away from (both while it moves), where trains are held: a
  // visibility set as it poses, which is only while it rides (a still lift poses nothing).
  "mech-train-lift": stateMotion(["lift", "cw0", "cw1", "gear", "stop0", "stop1"], {
    source: "ride",
    glide: 0,
    value: (k) => k * LIFT_RISE,
    pose: (p, y) => {
      each(p, "lift", (o) => (o.position.y = y));
      each(p, "cw0", (o) => (o.position.y = -y));
      each(p, "cw1", (o) => (o.position.y = -y));
      each(p, "gear", (o) => (o.rotation.z = y / 8));
      each(p, "stop0", (o) => (o.visible = y > LIFT_STOP_SLACK));
      each(p, "stop1", (o) => (o.visible = y < LIFT_RISE - LIFT_STOP_SLACK));
    },
  }),
  "mech-train-wash": {
    parts: ["brushL", "brushR", "brushTop", "drops"],
    pose: (p, on, t) => {
      // The brushes turn once a second (a round ends where it started, so let go they stop at rest); water drips on.
      const turn = on > 0 ? (t % 1) * Math.PI * 2 : 0;
      each(p, "brushL", (o) => (o.rotation.y = turn));
      each(p, "brushR", (o) => (o.rotation.y = -turn));
      each(p, "brushTop", (o) => (o.rotation.z = turn));
      each(p, "drops", (o) => (o.visible = on > 0.5 && Math.floor(t * 4) % 2 === 0));
    },
    period: 1,
    ease: 0.4,
  },
  // Signal skins: their parts show their signals' aspects (state 0, at rest, is all clear). The semaphore's arm rises
  // to clear and drops level at red.
  "mech-semaphore-signal": stateMotion(["arm"], {
    source: "signals",
    glide: 0.5,
    value: (k) => (k % 2 === 1 ? 0 : SEMAPHORE_CLEAR),
    pose: (p, a) => each(p, "arm", (o) => (o.rotation.x = a)),
  }),
  // The colour light shows green at clear and red at red, switched at once.
  "mech-colour-light-signal": stateMotion(["red", "amber", "green"], {
    source: "signals",
    glide: 0,
    value: (k) => k % 2,
    pose: (p, red) => {
      each(p, "red", (o) => (o.visible = red >= 0.5));
      each(p, "amber", (o) => (o.visible = false));
      each(p, "green", (o) => (o.visible = red < 0.5));
    },
  }),
  // The gantry's two heads, one over each road, each showing its road's aspect (the state's bit for it). Turned round
  // onto its piece, the model's head 1 is over road 0, and its head 0 over road 1.
  "mech-signal-gantry": stateMotion(["r0", "g0", "r1", "g1"], {
    source: "signals",
    glide: 0,
    value: (k) => k,
    pose: (p, bits) => {
      const red = Math.round(bits);
      for (const [head, road] of GANTRY_HEADS) {
        const atRed = Math.floor(red / 2 ** road) % 2 === 1;
        each(p, `r${head}`, (o) => (o.visible = atRed));
        each(p, `g${head}`, (o) => (o.visible = !atRed));
      }
    },
  }),
  // The buffer stop's lamp lights while a train stands against it (on its piece).
  "mech-buffer-stop-lamp": { parts: ["lamp"], holds: true, ease: 0.3, pose: (p, on) => each(p, "lamp", (o) => (o.visible = on > 0.5)) },
  // The weighbridge's dial swings round while a train crawls over it.
  "mech-weighbridge": {
    parts: ["needle"],
    pose: (p, on, t) => each(p, "needle", (o) => (o.rotation.z = 2 - on * (2.2 + 0.08 * Math.sin(t * 9)))),
  },
};

/** The motion of a kit's asset, if it has one. */
export const motionOf = (asset: string): KitMotion | undefined => KIT_MOTIONS[asset];

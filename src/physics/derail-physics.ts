import type RAPIER_NS from "@dimforge/rapier3d-compat";
import { Euler, Quaternion, Vector3 } from "three";
import type { Slab } from "../landscape";
import { CAR_SPECS, type Train } from "../sim";
import { createSample, getPieceDef, pathLength, RISER_HEIGHT, samplePath, TRACK_THICKNESS, TRACK_WIDTH, type Layout, type PlacedPiece } from "../track";

type Rapier = typeof RAPIER_NS;

/** Physics runs in metres; the game is in millimetres. */
const MM = 0.001;
const STEP = 1 / 60;
const CAR_BOTTOM = TRACK_THICKNESS + 0.5; // collider sits just above the rail surface, wheels are visual only
const CAR_HEIGHT = 34;
const MAGNET_RANGE = 22; // mm: magnets pull within this gap
const MAGNET_FORCE = 0.18; // N at contact — enough to drag a wagon along, weak enough to let go in a tumble
const MOTOR_FORCE = 0.35; // N: a derailed engine's wheels keep pushing for a moment
const MOTOR_SECONDS = 2.5;
const WOOD_DENSITY = 650; // kg/m³

interface CarBody {
  body: RAPIER_NS.RigidBody;
  trainId: number;
  carIndex: number;
  /** Local offset from the body centre to the model origin (track base under the car centre). */
  baseOffset: number;
  length: number;
  /** Engines: +1/-1 along the body's x axis while the motor still pushes, else 0. */
  drive: number;
  driveTime: number;
}

export interface CarPose {
  position: Vector3;
  quaternion: Quaternion;
}

/**
 * Rigid-body tumbling for derailed trains (Rapier, loaded on first use). Track pieces become static colliders;
 * each derailed car is a dynamic rounded box; magnets pull neighbouring cars together within a short range.
 */
export class DerailPhysics {
  private rapier: Rapier | null = null;
  private loading: Promise<void> | null = null;
  private world: RAPIER_NS.World | null = null;
  private trackColliders: RAPIER_NS.Collider[] = [];
  private trackDirty = true;
  private readonly cars = new Map<number, CarBody>();
  private slabs: readonly Slab[] = [];
  private readonly pending: Train[] = [];
  private accumulator = 0;
  failed = false;

  /** How many riser heights a bridge's arches reach below its deck. */
  bridgeLevels: (piece: PlacedPiece) => number = () => 0;

  constructor(private layout: Layout) {}

  setLayout(layout: Layout): void {
    this.layout = layout;
    this.clear();
    this.trackDirty = true;
  }

  get active(): boolean {
    return this.cars.size > 0;
  }

  /** Hill blocks of the current map: static colliders so tumbling cars land on them. */
  setSlabs(slabs: readonly Slab[]): void {
    this.slabs = slabs;
    this.trackDirty = true;
  }

  /** Track changed: rebuild static colliders before the next step. */
  markTrackDirty(): void {
    this.trackDirty = true;
  }

  /** Hand a just-derailed train to physics. */
  derail(train: Train): void {
    if (this.failed) return;
    if (!this.world) {
      this.pending.push(train);
      void this.load();
      return;
    }
    this.spawn(train);
  }

  private load(): Promise<void> {
    if (!this.loading) {
      this.loading = import("@dimforge/rapier3d-compat")
        .then(async (mod) => {
          const R = (mod.default ?? mod) as Rapier;
          await R.init();
          this.rapier = R;
          this.world = new R.World({ x: 0, y: -9.81, z: 0 });
          this.world.timestep = STEP;
          const floor = R.ColliderDesc.cuboid(50, 0.05, 50).setTranslation(0, -0.05, 0).setFriction(0.9).setRestitution(0.1);
          this.world.createCollider(floor);
          for (const t of this.pending.splice(0)) this.spawn(t);
        })
        .catch((e: unknown) => {
          // Physics is optional: without it derailed trains just stop where they are.
          console.warn("Woodrail: physics unavailable", e);
          this.failed = true;
        });
    }
    return this.loading;
  }

  private rebuildTrack(): void {
    const R = this.rapier!;
    const world = this.world!;
    for (const c of this.trackColliders) world.removeCollider(c, false);
    this.trackColliders = [];
    const s = createSample();
    const half = TRACK_WIDTH / 2;
    const add = (desc: RAPIER_NS.ColliderDesc) => this.trackColliders.push(world.createCollider(desc.setFriction(0.6).setRestitution(0.15)));
    for (const slab of this.slabs) {
      const hx = (slab.x1 - slab.x0) / 2;
      const hz = (slab.z1 - slab.z0) / 2;
      add(
        R.ColliderDesc.cuboid(hx * MM, (RISER_HEIGHT / 2) * MM, hz * MM).setTranslation(
          (slab.x0 + hx) * MM,
          ((slab.level - 0.5) * RISER_HEIGHT) * MM,
          (slab.z0 + hz) * MM,
        ),
      );
    }
    for (const id of this.layout.pieceIds()) {
      if (this.layout.isLifted(id)) continue;
      const p = this.layout.getPiece(id)!;
      const def = getPieceDef(p.type, p.flipped);
      const ch = Math.cos(p.pose.heading);
      const sh = Math.sin(p.pose.heading);
      if (def.paths.length === 0) {
        const q = new Quaternion().setFromEuler(new Euler(0, -p.pose.heading, 0));
        add(R.ColliderDesc.cuboid(23 * MM, (RISER_HEIGHT / 2) * MM, 23 * MM).setTranslation(p.pose.x * MM, (p.y + RISER_HEIGHT / 2) * MM, p.pose.z * MM).setRotation(q));
        continue;
      }
      const arches = this.bridgeLevels(p) * RISER_HEIGHT;
      for (const path of def.paths) {
        const len = pathLength(path.geom);
        const n = Math.max(1, Math.ceil(len / 24));
        for (let i = 0; i < n; i++) {
          samplePath(path.geom, (len * i) / n, s);
          const ax = s.x;
          const az = s.z;
          const ay = s.y;
          samplePath(path.geom, (len * (i + 1)) / n, s);
          const mx = (ax + s.x) / 2;
          const mz = (az + s.z) / 2;
          const my = (ay + s.y) / 2;
          const segLen = Math.hypot(s.x - ax, s.z - az, s.y - ay);
          const yaw = p.pose.heading + Math.atan2(s.z - az, s.x - ax);
          const pitch = Math.atan2(s.y - ay, Math.hypot(s.x - ax, s.z - az));
          const wx = p.pose.x + mx * ch - mz * sh;
          const wz = p.pose.z + mx * sh + mz * ch;
          const q = new Quaternion().setFromEuler(new Euler(0, -yaw, pitch, "YZX"));
          add(
            R.ColliderDesc.cuboid((segLen / 2 + 1) * MM, (TRACK_THICKNESS / 2) * MM, half * MM)
              .setTranslation(wx * MM, (p.y + my + TRACK_THICKNESS / 2) * MM, wz * MM)
              .setRotation(q),
          );
          // A bridge's viaduct, under the deck down to the ground.
          if (arches > 0) {
            add(
              R.ColliderDesc.cuboid((segLen / 2) * MM, ((my + arches) / 2) * MM, (half - 2) * MM)
                .setTranslation(wx * MM, (p.y + (my - arches) / 2) * MM, wz * MM)
                .setRotation(new Quaternion().setFromEuler(new Euler(0, -yaw, 0))),
            );
          }
        }
      }
    }
    this.trackDirty = false;
  }

  private spawn(train: Train): void {
    const R = this.rapier!;
    const world = this.world!;
    if (this.trackDirty) this.rebuildTrack();
    train.cars.forEach((car, i) => {
      if (this.cars.has(car.id)) return;
      const spec = CAR_SPECS[car.kind];
      const f = train.world[2 * i];
      const r = train.world[2 * i + 1];
      const cx = (f.x + r.x) / 2;
      const cz = (f.z + r.z) / 2;
      const base = (f.y + r.y) / 2;
      const yaw = Math.atan2(f.z - r.z, f.x - r.x);
      const pitch = Math.atan2(f.y - r.y, Math.hypot(f.x - r.x, f.z - r.z));
      const q = new Quaternion().setFromEuler(new Euler(0, -yaw, pitch, "YZX"));
      const centreLift = CAR_BOTTOM + CAR_HEIGHT / 2;
      const up = new Vector3(0, centreLift, 0).applyQuaternion(q);
      const body = world.createRigidBody(
        R.RigidBodyDesc.dynamic()
          .setTranslation((cx + up.x) * MM, (base + up.y) * MM, (cz + up.z) * MM)
          .setRotation(q)
          .setLinearDamping(0.05)
          .setAngularDamping(0.2)
          .setCcdEnabled(true),
      );
      const speed = train.speed * MM;
      body.setLinvel({ x: Math.cos(f.heading) * speed, y: f.slope * speed, z: Math.sin(f.heading) * speed }, true);
      // A small random-ish spin so tumbles look different (deterministic per car).
      body.setAngvel({ x: ((car.id * 37) % 7) * 0.08 - 0.24, y: 0, z: 0 }, true);
      world.createCollider(
        R.ColliderDesc.roundCuboid((spec.length / 2 - 3) * MM, (CAR_HEIGHT / 2 - 3) * MM, (spec.width / 2 - 3) * MM, 3 * MM)
          .setDensity(WOOD_DENSITY * (car.kind === "engine" ? 1.6 : 1))
          .setFriction(0.3)
          .setRestitution(0.25),
        body,
      );
      const drive = car.kind === "engine" ? car.lever * car.facing : 0;
      this.cars.set(car.id, { body, trainId: train.id, carIndex: i, baseOffset: centreLift, length: spec.length, drive, driveTime: MOTOR_SECONDS });
    });
  }

  /** Remove bodies for cars that are no longer derailed (re-railed, picked up, removed). */
  retain(isDerailedCar: (carId: number) => boolean): void {
    for (const [id, c] of this.cars) {
      if (!isDerailedCar(id)) {
        this.world?.removeRigidBody(c.body);
        this.cars.delete(id);
      }
    }
  }

  clear(): void {
    for (const c of this.cars.values()) this.world?.removeRigidBody(c.body);
    this.cars.clear();
    this.pending.length = 0;
  }

  step(dt: number): void {
    if (!this.world || this.cars.size === 0) return;
    if (this.trackDirty) this.rebuildTrack();
    this.accumulator += dt;
    let steps = 0;
    while (this.accumulator >= STEP && steps < 4) {
      this.applyMagnets();
      this.applyMotors();
      this.world.step();
      this.accumulator -= STEP;
      steps++;
    }
    if (steps === 4) this.accumulator = 0;
  }

  /** A derailed engine's motor keeps pushing briefly, so it drives itself off an edge like the real toy. */
  private applyMotors(): void {
    const q = new Quaternion();
    for (const c of this.cars.values()) {
      if (c.drive === 0 || c.driveTime <= 0) continue;
      c.driveTime -= STEP;
      const r = c.body.rotation();
      q.set(r.x, r.y, r.z, r.w);
      const up = new Vector3(0, 1, 0).applyQuaternion(q);
      if (up.y < 0.6) continue; // on its side or back: the wheels spin in the air
      const dir = new Vector3(c.drive, 0, 0).applyQuaternion(q);
      const k = MOTOR_FORCE * STEP;
      c.body.applyImpulse({ x: dir.x * k, y: 0, z: dir.z * k }, true);
    }
  }

  /** Neighbouring cars of the same derailed train attract at their facing magnet ends. */
  private applyMagnets(): void {
    const byTrain = new Map<number, CarBody[]>();
    for (const c of this.cars.values()) {
      let list = byTrain.get(c.trainId);
      if (!list) byTrain.set(c.trainId, (list = []));
      list[c.carIndex] = c;
    }
    const tmpQ = new Quaternion();
    const endPoint = (c: CarBody, sign: number) => {
      const t = c.body.translation();
      const r = c.body.rotation();
      tmpQ.set(r.x, r.y, r.z, r.w);
      return new Vector3(sign * (c.length / 2) * MM, (-CAR_HEIGHT / 2 + 8) * MM, 0).applyQuaternion(tmpQ).add(new Vector3(t.x, t.y, t.z));
    };
    for (const list of byTrain.values()) {
      for (let i = 0; i + 1 < list.length; i++) {
        const a = list[i];
        const b = list[i + 1];
        if (!a || !b) continue;
        const pa = endPoint(a, -1);
        const pb = endPoint(b, 1);
        const d = pa.distanceTo(pb) / MM;
        if (d > MAGNET_RANGE || d < 0.5) continue;
        const strength = (MAGNET_FORCE * (1 - d / MAGNET_RANGE)) * STEP;
        const dir = pb.clone().sub(pa).normalize().multiplyScalar(strength);
        a.body.applyImpulse({ x: dir.x, y: dir.y, z: dir.z }, true);
        b.body.applyImpulse({ x: -dir.x, y: -dir.y, z: -dir.z }, true);
      }
    }
  }

  /** Model pose (origin at the track base under the car) for a car in physics, or null. */
  poseOf(carId: number, out: CarPose): CarPose | null {
    const c = this.cars.get(carId);
    if (!c) return null;
    const t = c.body.translation();
    const r = c.body.rotation();
    out.quaternion.set(r.x, r.y, r.z, r.w);
    const down = new Vector3(0, -c.baseOffset, 0).applyQuaternion(out.quaternion);
    out.position.set(t.x / MM + down.x, t.y / MM + down.y, t.z / MM + down.z);
    return out;
  }

  /** Plan position of a car body (mm), for re-railing near where it came to rest. */
  restingPoint(carId: number): { x: number; z: number } | null {
    const c = this.cars.get(carId);
    if (!c) return null;
    const t = c.body.translation();
    return { x: t.x / MM, z: t.z / MM };
  }
}

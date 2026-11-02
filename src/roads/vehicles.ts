/**
 * Road vehicles (roads spec §3): vans and buses, cheap. No physics: each is a distance along a cached polyline
 * (`t += v·dt`), posed from it. No collisions between vehicles (each runs on its own trip). Ticked in the economy's
 * update (`Economy.tick`), never the render loop, so a headless run (the balance harness) moves them the same way; the
 * view (`RoadVehiclesView`) only reads their poses, and only when `version` changed.
 *
 * Nothing when idle: a parked vehicle isn't ticked at all (`moving` is 0, and `tick` returns at once).
 */

export type VehicleKind = "van" | "bus";

/**
 * Where a vehicle is in its trip: parked at home, loading at home (about to leave: a timer, no moving), driving out,
 * standing at the far end, or driving back.
 */
export type Leg = "home" | "loading" | "out" | "there" | "back";

/** A crossing on a path: where a vehicle stops short of it while it's shut (distance along), and its first square. */
export interface PathHold {
  readonly at: number;
  readonly square: number;
}

/** A road path: the squares it runs over, as a polyline (x, y, z per point) with each point's distance along it. */
export interface RoadPath {
  readonly squares: readonly number[];
  readonly pts: Float32Array;
  readonly at: Float32Array;
  readonly length: number;
  readonly holds: readonly PathHold[];
}

export interface RoadVehicle {
  readonly id: number;
  readonly kind: VehicleKind;
  leg: Leg;
  /** The path it's on (out, or back), or null while parked. */
  path: RoadPath | null;
  /** The way back, kept while out (and standing there). */
  back: RoadPath | null;
  /** Distance along `path` (mm). */
  t: number;
  /** Seconds left standing at the far end (or loading at home). */
  dwell: number;
  /** Waiting at a crossing's edge (it's shut). */
  holding: boolean;
  /** The polyline segment it's on (a cursor: a vehicle only ever goes forward along its path). */
  seg: number;
  /** Its pose: where it stands, on the road's top, and which way it faces (about y; 0 faces +x), and its pitch. */
  x: number;
  y: number;
  z: number;
  heading: number;
  pitch: number;
  /** What the game hangs on it (a van's load, its station). */
  data: unknown;
}

/** mm per second: a little slower than a train (`ENGINE_SPEED` 120). */
export const VEHICLE_SPEED: Record<VehicleKind, number> = { van: 90, bus: 80 };
/** Most vehicles of each kind on a map (spec §3: one InstancedMesh each, whatever the number). */
export const VEHICLE_CAP: Record<VehicleKind, number> = { van: 8, bus: 4 };
/** Seconds a vehicle stands at the far end before coming back. */
export const DWELL = 1.5;

export class RoadVehicles {
  readonly list: RoadVehicle[] = [];
  /** Goes up whenever a vehicle's pose changes, or one is added or removed (the view redraws only then). */
  version = 0;
  /** Is road square `square`'s crossing shut (a train near)? Set by the game from `CrossingsView`; null: never. */
  shut: ((square: number) => boolean) | null = null;
  /** Called once a tick while any vehicle moves, before it moves (the game checks its paths after a road edit). */
  beforeTick: (() => void) | null = null;
  /** A vehicle came to the far end of its way out. */
  onArrive: ((v: RoadVehicle) => void) | null = null;
  /** A vehicle came home and parked. */
  onHome: ((v: RoadVehicle) => void) | null = null;
  /** A vehicle's loading time at home ran out (see `load`): the game sends it, or parks it again. */
  onReady: ((v: RoadVehicle) => void) | null = null;
  private nextId = 1;

  /** How many are on the move (out, standing there or back). */
  get moving(): number {
    let n = 0;
    for (const v of this.list) if (v.leg !== "home" && v.leg !== "loading") n++;
    return n;
  }

  /** Start loading a parked vehicle: in `seconds` (game time, ticked here) `onReady` is called for it. */
  load(v: RoadVehicle, seconds: number): void {
    if (v.leg !== "home") return;
    v.leg = "loading";
    v.dwell = seconds;
  }

  count(kind: VehicleKind): number {
    let n = 0;
    for (const v of this.list) if (v.kind === kind) n++;
    return n;
  }

  /** A new vehicle parked at (x, y, z) facing `heading`; null at the cap. */
  add(kind: VehicleKind, x: number, y: number, z: number, heading: number, data: unknown = null): RoadVehicle | null {
    if (this.count(kind) >= VEHICLE_CAP[kind]) return null;
    const v: RoadVehicle = { id: this.nextId++, kind, leg: "home", path: null, back: null, t: 0, dwell: 0, holding: false, seg: 0, x, y, z, heading, pitch: 0, data };
    this.list.push(v);
    this.version++;
    return v;
  }

  remove(v: RoadVehicle): void {
    const k = this.list.indexOf(v);
    if (k === -1) return;
    this.list.splice(k, 1);
    this.version++;
  }

  clear(): void {
    if (this.list.length === 0) return;
    this.list.length = 0;
    this.version++;
  }

  /** Send a parked vehicle out along `out`, to stand at its end, then come back along `back` (null: set on arriving). */
  send(v: RoadVehicle, out: RoadPath, back: RoadPath | null): void {
    v.leg = "out";
    this.follow(v, out);
    v.back = back;
  }

  /** Turn a vehicle onto a new path from its start (a road edit changed its way: see `vans.ts`). */
  follow(v: RoadVehicle, path: RoadPath): void {
    v.path = path;
    v.t = 0;
    v.seg = 0;
    v.holding = false;
    poseAt(v, path, 0);
    this.version++;
  }

  /** Head home now along `back` (the way ahead went), from wherever it is. */
  turnBack(v: RoadVehicle, back: RoadPath): void {
    v.leg = "back";
    v.back = null;
    this.follow(v, back);
  }

  /** Park at once where it stands, its trip over (no road home at all). */
  park(v: RoadVehicle, x?: number, y?: number, z?: number, heading?: number): void {
    v.leg = "home";
    v.path = v.back = null;
    v.holding = false;
    if (x !== undefined) {
      v.x = x;
      v.y = y!;
      v.z = z!;
      v.heading = heading!;
      v.pitch = 0;
    }
    this.version++;
  }

  /** Move every vehicle on the move by `dt` seconds. Nothing at all while all are parked. */
  tick(dt: number): void {
    if (this.list.length === 0) return;
    let any = false;
    for (const v of this.list) if (v.leg !== "home") any = true;
    if (!any) return;
    this.beforeTick?.();
    for (const v of this.list) {
      if (v.leg === "home") continue;
      if (v.leg === "loading") {
        v.dwell -= dt;
        if (v.dwell > 0) continue;
        v.leg = "home";
        this.onReady?.(v);
        continue;
      }
      if (v.leg === "there") {
        v.dwell -= dt;
        if (v.dwell > 0) continue;
        v.leg = "back";
        const back = v.back;
        v.back = null;
        if (back) this.follow(v, back);
        else {
          // (No way back: its trip ends where it stands.)
          this.park(v);
          this.onHome?.(v);
        }
        continue;
      }
      const path = v.path;
      if (!path) continue;
      let next = v.t + VEHICLE_SPEED[v.kind] * dt;
      // A shut crossing ahead: stop at its edge (never on the crossing: one already on it carries on).
      const hold = holdAhead(path, v.t, next);
      if (hold && this.shut?.(hold.square)) {
        next = hold.at;
        if (!v.holding) {
          v.holding = true;
          if (next !== v.t) {
            v.t = next;
            v.seg = poseAt(v, path, next, v.seg);
            this.version++;
          }
        }
        continue;
      }
      v.holding = false;
      if (next >= path.length) {
        v.t = path.length;
        v.seg = poseAt(v, path, path.length, v.seg);
        this.version++;
        if (v.leg === "out") {
          v.leg = "there";
          v.dwell = DWELL;
          v.path = null;
          this.onArrive?.(v);
        } else {
          this.park(v);
          this.onHome?.(v);
        }
        continue;
      }
      v.t = next;
      v.seg = poseAt(v, path, next, v.seg);
      this.version++;
    }
  }
}

/** The first hold point between distances `from` (exclusive of ones already passed) and `to`, if any. */
function holdAhead(path: RoadPath, from: number, to: number): PathHold | null {
  for (const h of path.holds) if (h.at >= from && h.at < to + 0.001) return h;
  return null;
}

/** Pose `v` at distance `t` along `path`, searching on from segment `seg`; returns the segment it's on. */
export function poseAt(v: { x: number; y: number; z: number; heading: number; pitch: number }, path: RoadPath, t: number, seg = 0): number {
  const { pts, at } = path;
  const last = at.length - 1;
  if (last < 1) {
    v.x = pts[0];
    v.y = pts[1];
    v.z = pts[2];
    return 0;
  }
  let k = Math.min(Math.max(0, seg), last - 1);
  while (k < last - 1 && at[k + 1] < t) k++;
  while (k > 0 && at[k] > t) k--;
  const span = at[k + 1] - at[k];
  const f = span > 0 ? Math.min(1, Math.max(0, (t - at[k]) / span)) : 0;
  const a = k * 3;
  const b = a + 3;
  const dx = pts[b] - pts[a];
  const dy = pts[b + 1] - pts[a + 1];
  const dz = pts[b + 2] - pts[a + 2];
  v.x = pts[a] + dx * f;
  v.y = pts[a + 1] + dy * f;
  v.z = pts[a + 2] + dz * f;
  if (dx !== 0 || dz !== 0) {
    v.heading = Math.atan2(-dz, dx);
    v.pitch = Math.atan2(dy, Math.hypot(dx, dz));
  }
  return k;
}

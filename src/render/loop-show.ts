import { CatmullRomCurve3, CylinderGeometry, Frustum, Group, Matrix4, Mesh, MeshStandardMaterial, Quaternion, Sphere, Vector3, type Camera, type Object3D } from "three";
import { CAR_KINDS, CAR_SPECS, type SimSnapshot } from "../sim";
import { kitOf, kitPlace, type Layout } from "../track";
import { AXLE_HEIGHT, WHEEL_RADIUS } from "./train-models";

/**
 * The loop-the-loop's show (`KitDef.show: "loop"`, src/track/kits.ts): drawn only, nothing in the sim changes. The kit
 * is a 216 straight trains crawl over, its model's loop standing beside the line. When an engine runs onto it, a toy
 * copy of it (the same model and colours) takes its place where it stands, and hops off the line onto the loop's
 * start, sliding across and up and shrinking to `LOOP_SCALE` as it goes (the engine's own model hidden); it runs round
 * the loop, upside down over the top, and at the far end hops back down onto the line, growing, to land just where the
 * engine is as it reaches the piece's far end, and the engine shows again. The cars coupled to it coast on behind (or
 * ahead) as the sim has them, on a tow rope to the copy: the engine's detour through the loop. A tap on the copy is a
 * tap on the engine.
 *
 * The copy's place is driven by how far the engine is across the piece (not by a clock of its own): it meets the engine
 * at the far end whatever the train's speed, holds still while the game is paused or the train stands, and costs no
 * frames then. One show per kit at a time: another engine coming on during a show just crawls through. An engine that
 * backs up mid-show (or comes off, or is taken away, or the kit is taken up) calls it off at once; only the drawing
 * eases, the copy going back to the engine over `LOOP_CANCEL_S` (a few frames, then still again).
 */

// ——— The path: authored to match the catalogue model (mech-loop-the-loop, src/catalogue/assets/mechanisms.ts) ———

/** The radius of the ring's inside, where the copy's wheels run (the model's R), and the hub's height (12 + R). */
export const LOOP_RADIUS = 54;
export const LOOP_HUB = 66;
/** The toy copy's size against the engine's (an engine is 96 long: whole, it wouldn't fit the loop). */
export const LOOP_SCALE = 0.6;
/** How far across the ring (z) the copy drifts going round, from −DRIFT to +DRIFT: in by one side, out by the other. */
const LOOP_DRIFT = 8;
/** How far round (radians) before the ring's bottom the copy starts, and after it ends. */
const LOOP_LEAD = 0.3;
/** Points in the authored table, and samples along the spline through them (by arc length). */
const LOOP_POINTS = 25;
const SAMPLES = 160;
/** Over the top the copy goes this much slower (as a coaster does: 0 the same speed as at the bottom). */
const TOP_SLOWING = 0.5;

/** The copy's origin's distance from the hub: its wheels (axles `AXLE_HALF` either side of it) on the ring's inside. */
const AXLE_HALF = CAR_SPECS.engine.length / 2 - CAR_SPECS.engine.bogieInset;
const WHEEL_FOOT = AXLE_HEIGHT - WHEEL_RADIUS;
const ORIGIN_RADIUS = Math.sqrt(LOOP_RADIUS ** 2 - (AXLE_HALF * LOOP_SCALE) ** 2) + WHEEL_FOOT * LOOP_SCALE;

/**
 * The table the copy's spline goes through, in the model's own frame (x along the track, y up, z across; the loop in
 * its x/y plane round the hub at (0, `LOOP_HUB`)): from just before the ring's bottom, once round, to just after it,
 * drifting across the ring as it goes. Its first and last points are a step beyond those ends: guides for the
 * spline's heading there, not on the path.
 */
export function loopTable(): Vector3[] {
  const out: Vector3[] = [];
  const span = 2 * Math.PI + 2 * LOOP_LEAD;
  for (let i = -1; i <= LOOP_POINTS; i++) {
    const f = i / (LOOP_POINTS - 1);
    const a = -LOOP_LEAD + f * span;
    out.push(new Vector3(ORIGIN_RADIUS * Math.sin(a), LOOP_HUB - ORIGIN_RADIUS * Math.cos(a), -LOOP_DRIFT + 2 * LOOP_DRIFT * f));
  }
  return out;
}

/** The copy's path sampled by arc length: where its origin is, and how it's turned (x along, y its up), at each. */
export interface LoopPath {
  /** Its length (mm). */
  readonly length: number;
  readonly points: readonly Vector3[];
  readonly tangents: readonly Vector3[];
  /** Its up at each sample: toward the hub's axis, square to the tangent (it never flips). */
  readonly normals: readonly Vector3[];
  readonly quats: readonly Quaternion[];
  /** The share of the run's time taken to reach each sample (0 to 1): slower over the top. */
  readonly timing: Float32Array;
}

let cached: LoopPath | null = null;

/** The loop's path (built once, for every loop-the-loop). */
export function loopPath(): LoopPath {
  if (cached) return cached;
  // Through the whole table, but the path is only the stretch between its guides (see `loopTable`).
  const table = loopTable();
  const n = table.length;
  const curve = new CatmullRomCurve3(table, false, "centripetal");
  // Resampled by arc length: the spline's own parameter goes evenly by points, not by distance.
  const fine = SAMPLES * 8;
  const from = 1 / (n - 1);
  const to = (n - 2) / (n - 1);
  const at = (i: number) => from + ((to - from) * i) / fine;
  const lengths = [0];
  let prev = curve.getPoint(at(0));
  for (let i = 1; i <= fine; i++) {
    const p = curve.getPoint(at(i));
    lengths.push(lengths[i - 1] + p.distanceTo(prev));
    prev = p;
  }
  const length = lengths[fine];
  const points: Vector3[] = [];
  const tangents: Vector3[] = [];
  for (let i = 0, j = 0; i <= SAMPLES; i++) {
    const want = (length * i) / SAMPLES;
    while (j < fine - 1 && lengths[j + 1] < want) j++;
    const u = at(j + Math.min(1, (want - lengths[j]) / (lengths[j + 1] - lengths[j] || 1)));
    points.push(curve.getPoint(u));
    tangents.push(curve.getTangent(u).normalize());
  }
  // Up: toward the hub's axis (square to the tangent), so the wheels stay on the ring and the copy never leans or
  // flips. (A rotation-minimising frame would lean ~8° by the end, carried round by the drift across the ring.) The
  // axis is never along the tangent, so it turns smoothly all the way round.
  const toAxis = new Vector3();
  const normals = points.map((p, i) => {
    toAxis.set(-p.x, LOOP_HUB - p.y, 0);
    return toAxis.clone().sub(tangents[i].clone().multiplyScalar(toAxis.dot(tangents[i]))).normalize();
  });
  const basis = new Matrix4();
  const quats = points.map((_, i) => new Quaternion().setFromRotationMatrix(basis.makeBasis(tangents[i], normals[i], tangents[i].clone().cross(normals[i]))));
  // Time to each sample: the copy slows as it climbs (as a coaster's car would), fastest at the bottom.
  let low = Infinity;
  let high = -Infinity;
  for (const p of points) {
    low = Math.min(low, p.y);
    high = Math.max(high, p.y);
  }
  const timing = new Float32Array(SAMPLES + 1);
  for (let i = 1; i <= SAMPLES; i++) {
    const h = ((points[i].y + points[i - 1].y) / 2 - low) / (high - low);
    timing[i] = timing[i - 1] + 1 / Math.sqrt(1 - TOP_SLOWING * h);
  }
  for (let i = 1; i <= SAMPLES; i++) timing[i] /= timing[SAMPLES];
  cached = { length, points, tangents, normals, quats, timing };
  return cached;
}

/** Where along the path (0 to 1, by arc length) the copy is when `run` (0 to 1) of the run's time has gone. */
export function pathAt(path: LoopPath, run: number): number {
  const t = path.timing;
  if (run <= 0) return 0;
  if (run >= 1) return 1;
  let lo = 0;
  let hi = t.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (t[mid] <= run) lo = mid;
    else hi = mid;
  }
  return (lo + (run - t[lo]) / (t[hi] - t[lo])) / (t.length - 1);
}

const qa = new Quaternion();

/** The copy's origin and turn at `s` along the path (0 to 1, by arc length), in the model's frame. */
export function poseAt(path: LoopPath, s: number, position: Vector3, quaternion: Quaternion): void {
  const f = Math.min(Math.max(s, 0), 1) * (path.points.length - 1);
  const i = Math.min(Math.floor(f), path.points.length - 2);
  const u = f - i;
  position.lerpVectors(path.points[i], path.points[i + 1], u);
  quaternion.copy(path.quats[i]);
  qa.copy(path.quats[i + 1]);
  quaternion.slerp(qa, u);
}

/** The share of the engine's way across in which it hops off the line onto the ring, and back on, at each end. */
export const LOOP_SWAP = 0.1;
/** How high (mm) the engine hops on its way between the line and the ring, at the hop's middle. */
export const LOOP_HOP = 16;
/** How long (s) the engine takes to come back to the line when a show is called off (drawn only: the logic's at once). */
export const LOOP_CANCEL_S = 0.3;

const smooth = (u: number) => u * u * (3 - 2 * u);
const clamp01 = (u: number) => Math.min(1, Math.max(0, u));

/**
 * The show at `u` of the engine's way across (0 to 1): `grow`, how far through its hop between the line and the ring
 * the engine is (0: on the line, whole, where the sim has it; 1: on the ring, at `LOOP_SCALE`), and `run`, how much of
 * its run round the loop it has done (0 to 1, by time: see `pathAt`).
 */
export function showAt(u: number): { grow: number; run: number } {
  const grow = smooth(clamp01(Math.min(u / LOOP_SWAP, (1 - u) / LOOP_SWAP)));
  const w = clamp01((u - LOOP_SWAP) / (1 - 2 * LOOP_SWAP));
  // Half eased: the copy pulls away and comes in gently, but doesn't dawdle.
  return { grow, run: 0.5 * w + 0.5 * smooth(w) };
}

/** How high (mm) the hop lifts the engine `grow` of the way between the line and the ring (see `showAt`). */
export const hopAt = (grow: number): number => LOOP_HOP * Math.sin(Math.PI * clamp01(grow));

// ——— The view ———

/** An engine counts as on the kit's line within this far across it, and this far above or below it (mm). */
const ON_LINE = 14;
const ON_LEVEL = 30;
/** How far either side of the piece engines are watched coming (mm): an engine moves far less in a frame. */
const WATCH = 120;
/** An engine this far back from the furthest it got across (mm) is backing up: the show is off. */
const BACKING = 0.5;
/** Room round the loop's middle for the whole model and the copy, when asking if it's in view (mm). */
const SHOW_REACH = 220;
/** The tow rope from the engine's coupled cars to it while it's off the line: its radius, and how much it sags (mm). */
const ROPE_RADIUS = 1.3;
const ROPE_SAG = 0.08;
/** A show ended or called off with the copy this little way through its hop (or less) just ends: nothing to see. */
const HOP_SEEN = 0.02;

/** The cars drawn (TrainView): the engine's model, which the copy is cloned from and which is hidden for the show. */
export interface CarObjects {
  carObject(carId: number): Object3D | undefined;
}

interface Show {
  readonly engine: number;
  /** The engine's model (TrainView's), hidden while the copy stands in for it. */
  readonly obj: Object3D;
  /** Which way it crosses: +1 from the piece's first end, −1 from its second. */
  readonly dir: 1 | -1;
  /** The copy: in `placed` (the model's frame: x along the track, the line at z −`LOOP_BESIDE`), in `anchor`. */
  readonly anchor: Group;
  readonly placed: Group;
  readonly copy: Group;
  /** The copy's turn inside it, undone (to set the copy where the engine is). */
  readonly unturn: Matrix4;
  /** The world to `placed`. */
  readonly toPlaced: Matrix4;
  /** The tow ropes (two lengths each, to its sag), up to one to each car coupled to the engine. */
  readonly ropes: Group;
  /** The furthest it got across (mm), and the share of the way across last drawn (−1: not yet). */
  furthest: number;
  drawn: number;
  /** How far through its hop the copy was when last drawn (see `showAt`). */
  grow: number;
  /** The engine's place in the snapshot on the last update. */
  index: number;
}

/** A show called off: the copy goes back to the engine (or, the engine gone, shrinks away) over `LOOP_CANCEL_S`. */
interface Ease {
  readonly kit: LoopKit;
  readonly show: Show;
  readonly from: { position: Vector3; quaternion: Quaternion; scale: number };
  t: number;
}

interface LoopKit {
  readonly id: number;
  readonly x: number;
  readonly z: number;
  readonly y: number;
  readonly heading: number;
  readonly length: number;
  readonly place: { t: number; l: number; turn: number };
  /** The loop's middle, in the world (for the view test). */
  readonly centre: Vector3;
  show: Show | null;
  /** Engines near its line on the last update, and how far along it each was (mm), to see one come on. */
  near: Map<number, number>;
  next: Map<number, number>;
}

const frustum = new Frustum();
const viewProjection = new Matrix4();
const sphere = new Sphere();
const m4 = new Matrix4();
const va = new Vector3();
const vb = new Vector3();
const vc = new Vector3();
const vd = new Vector3();
const vs = new Vector3();
const UP = new Vector3(0, 1, 0);

let ropeParts: { geometry: CylinderGeometry; material: MeshStandardMaterial } | null = null;
/** The rope's one geometry (a unit length up +y from its foot) and material, shared by every show. */
function rope(): { geometry: CylinderGeometry; material: MeshStandardMaterial } {
  if (ropeParts) return ropeParts;
  const geometry = new CylinderGeometry(1, 1, 1, 6, 1, true);
  geometry.translate(0, 0.5, 0);
  const material = new MeshStandardMaterial({ color: 0x8a6a42, roughness: 0.95 });
  ropeParts = { geometry, material };
  return ropeParts;
}

/**
 * Draws the loop-the-loops' shows (see the note at the top). Kept up to date with the layout by `sync` (the loop kits,
 * a short list); `update` is asked only on frames where trains moved, or while it's `busy` (a show on: a comparison
 * when nothing changed; or one called off, easing back for `LOOP_CANCEL_S`). "moving" while a show in or near the
 * view moved on (draw, and redraw shadows); one out of view keeps count of its engine unseen and draws nothing, and a
 * camera move bringing it into view draws it, the next update posing it.
 */
export class LoopShowView {
  readonly group = new Group();
  private readonly kits = new Map<number, LoopKit>();
  private readonly eases: Ease[] = [];
  private layout: Layout | null = null;
  private key = "";

  constructor() {
    this.group.name = "loop-shows";
  }

  /** How many loop-the-loops are on the layout (none: nothing to update, unless it's `busy`). */
  get count(): number {
    return this.kits.size;
  }

  /** Is a show on now? */
  get running(): boolean {
    for (const k of this.kits.values()) if (k.show) return true;
    return false;
  }

  /** Is `update` wanted whether trains moved or not: a show on, or one called off still easing its engine back? */
  get busy(): boolean {
    return this.eases.length > 0 || this.running;
  }

  /**
   * Bring the loop kits up to date with the layout: one pass over the pieces, work only when a loop kit was added,
   * moved, taken up or put down (its show, if one was on, is called off).
   */
  sync(layout: Layout, hidden: (id: number) => boolean = () => false): void {
    let key = "";
    for (const id of layout.pieceIds()) {
      const p = layout.getPiece(id)!;
      if (kitOf(p.type)?.show !== "loop" || layout.isLifted(id) || hidden(id)) continue;
      key += `${id}:${p.pose.x}:${p.pose.z}:${p.pose.heading}:${p.y};`;
    }
    if (key === this.key && layout === this.layout) return;
    this.key = key;
    const sameLayout = layout === this.layout;
    this.layout = layout;
    const seen = new Set<number>();
    for (const id of layout.pieceIds()) {
      const p = layout.getPiece(id)!;
      const kit = kitOf(p.type);
      if (kit?.show !== "loop" || layout.isLifted(id) || hidden(id)) continue;
      const old = this.kits.get(id);
      if (sameLayout && old && old.x === p.pose.x && old.z === p.pose.z && old.heading === p.pose.heading && old.y === p.y) {
        seen.add(id);
        continue;
      }
      if (old) this.stop(old, true);
      seen.add(id);
      const place = kitPlace(kit);
      const geom = kit.track.paths[0].geom;
      const length = geom.kind === "line" ? geom.length : 216;
      const c = Math.cos(p.pose.heading);
      const s = Math.sin(p.pose.heading);
      const centre = new Vector3(p.pose.x + place.t * c - place.l * s, p.y + LOOP_HUB, p.pose.z + place.t * s + place.l * c);
      this.kits.set(id, { id, x: p.pose.x, z: p.pose.z, y: p.y, heading: p.pose.heading, length, place, centre, show: null, near: new Map(), next: new Map() });
    }
    for (const [id, k] of this.kits)
      if (!seen.has(id)) {
        this.stop(k, true);
        this.kits.delete(id);
      }
  }

  /**
   * Move the shows on with the trains (`snap`, as just written): start one for an engine coming onto a loop kit with
   * none on, follow each engine across, end it at the far end, call it off if the engine backs up or is gone (its
   * engine eased back over `LOOP_CANCEL_S` of `dt`, the frame's time, s). "moving" when a show in view moved, or one
   * called off eases back; "changed" when one in view started or ended (draw once); "still" otherwise.
   */
  update(snap: SimSnapshot, cars: CarObjects, camera: Camera | null = null, dt = 1 / 60): "moving" | "changed" | "still" {
    let moved = false;
    let changed = false;
    if (camera) frustum.setFromProjectionMatrix(viewProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
    const inView = (k: LoopKit): boolean => {
      if (!camera) return true;
      sphere.center.copy(k.centre);
      sphere.radius = SHOW_REACH;
      return frustum.intersectsSphere(sphere);
    };
    const engine = CAR_SPECS.engine.index;
    for (const k of this.kits.values()) {
      const c = Math.cos(k.heading);
      const s = Math.sin(k.heading);
      const next = k.next;
      next.clear();
      let showAlong = Number.NaN;
      for (let i = 0; i < snap.count; i++) {
        if (snap.kinds[i] !== engine) continue;
        const o = i * 6;
        const dx = snap.transforms[o] - k.x;
        const dz = snap.transforms[o + 2] - k.z;
        const t = dx * c + dz * s;
        const l = -dx * s + dz * c;
        const on = !snap.derailed[i] && Math.abs(l) < ON_LINE && Math.abs(snap.transforms[o + 1] - k.y) < ON_LEVEL && t > -WATCH && t < k.length + WATCH;
        const id = snap.ids[i];
        if (k.show?.engine === id) {
          if (on) {
            showAlong = t;
            k.show.index = i;
          }
          continue;
        }
        if (!on) continue;
        next.set(id, t);
        // An engine coming on from either end, with no show on: its show starts.
        const was = k.near.get(id);
        if (k.show || was === undefined) continue;
        const dir = was < 0 && t >= 0 ? 1 : was > k.length && t <= k.length ? -1 : 0;
        if (dir === 0) continue;
        const heading = snap.transforms[o + 3];
        // Which way the engine's own front faces, against the way it's crossing.
        const ahead = Math.cos(heading - k.heading) * dir >= 0;
        if (!this.start(k, id, i, dir, ahead, cars)) continue;
        showAlong = t;
        next.delete(id);
        if (inView(k)) changed = true;
      }
      k.next = k.near;
      k.near = next;
      const show = k.show;
      if (!show) continue;
      // Its engine gone, off the line, or its model not the one we hid: off.
      if (Number.isNaN(showAlong) || cars.carObject(show.engine) !== show.obj) {
        this.stop(k, inView(k));
        if (inView(k)) changed = true;
        continue;
      }
      const along = show.dir === 1 ? showAlong : k.length - showAlong;
      if (along < show.furthest - BACKING) {
        // Backing up: the show's off (at once), the engine eased back onto the line.
        this.stop(k, inView(k));
        if (inView(k)) changed = true;
        continue;
      }
      show.furthest = Math.max(show.furthest, along);
      if (along >= k.length) {
        this.stop(k, inView(k));
        if (inView(k)) changed = true;
        continue;
      }
      const u = Math.max(0, along / k.length);
      // Out of view it moves on unseen (nothing posed, nothing drawn).
      if (u === show.drawn || !inView(k)) continue;
      this.pose(show, u, snap);
      moved = true;
    }
    // Shows called off, easing back (one out of view just ends).
    for (let i = this.eases.length - 1; i >= 0; i--) {
      const e = this.eases[i];
      e.t += dt;
      if (e.t >= LOOP_CANCEL_S || !inView(e.kit)) {
        this.finish(e.show);
        this.eases.splice(i, 1);
      } else this.ease(e, cars);
      moved = true;
    }
    return moved ? "moving" : changed ? "changed" : "still";
  }

  /** A show starts: the copy, cloned from the engine's model (sharing its geometry and materials), where the engine is. */
  private start(k: LoopKit, engine: number, index: number, dir: 1 | -1, ahead: boolean, cars: CarObjects): boolean {
    const obj = cars.carObject(engine);
    if (!obj) return false;
    // Still easing back from a show called off a moment ago: that's over.
    for (let i = this.eases.length - 1; i >= 0; i--)
      if (this.eases[i].show.obj === obj) {
        this.finish(this.eases[i].show);
        this.eases.splice(i, 1);
      }
    const model = obj.clone(true);
    // Not its selection shells (TrainView's: see `makeShells`).
    const shells: Object3D[] = [];
    model.traverse((o) => {
      if (typeof o.userData.ring === "boolean") shells.push(o);
    });
    for (const o of shells) o.removeFromParent();
    model.position.set(0, 0, 0);
    model.rotation.set(0, 0, 0);
    model.scale.set(1, 1, 1);
    model.visible = true;
    // Facing the way it runs round: the path's way (+x) crossing from the first end, back along it from the second;
    // turned round if the engine runs backwards.
    if ((dir === 1) !== ahead) model.rotation.y = Math.PI;
    model.updateMatrix();
    const copy = new Group();
    copy.name = "loop-copy";
    // A tap on it is a tap on the engine (`engineAt`).
    copy.userData.loopEngine = engine;
    copy.add(model);
    copy.visible = false;
    const placed = new Group();
    placed.position.set(k.place.t, 0, k.place.l);
    placed.rotation.y = k.place.turn;
    placed.add(copy);
    const ropes = new Group();
    ropes.name = "loop-ropes";
    placed.add(ropes);
    const anchor = new Group();
    anchor.position.set(k.x, k.y, k.z);
    anchor.rotation.y = -k.heading;
    anchor.add(placed);
    anchor.updateMatrix();
    placed.updateMatrix();
    const toPlaced = new Matrix4().multiplyMatrices(anchor.matrix, placed.matrix).invert();
    this.group.add(anchor);
    k.show = { engine, obj, dir, anchor, placed, copy, unturn: model.matrix.clone().invert(), toPlaced, ropes, furthest: 0, drawn: -1, grow: 0, index };
    return true;
  }

  private readonly position = new Vector3();
  private readonly turn = new Quaternion();
  private readonly linePosition = new Vector3();
  private readonly lineTurn = new Quaternion();

  /**
   * Where the copy would stand to cover the engine's model exactly (its place, turn and size, in `placed`), from the
   * engine's model as TrainView last set it.
   */
  private onLine(show: Show, position: Vector3, quaternion: Quaternion): number {
    show.obj.updateWorldMatrix(true, false);
    m4.multiplyMatrices(show.toPlaced, show.obj.matrixWorld).multiply(show.unturn);
    m4.decompose(position, quaternion, vs);
    return vs.x;
  }

  /**
   * The copy where `u` of the way across says (see `showAt`): hopping between where the engine is on the line and the
   * loop's start (or end), shrinking to `LOOP_SCALE` on the way; on round the loop between. The engine's model is hidden
   * all the while (the copy stands in for it), and the coupled cars are on a tow rope to it.
   */
  private pose(show: Show, u: number, snap: SimSnapshot): void {
    show.drawn = u;
    const { grow, run } = showAt(u);
    show.grow = grow;
    const path = loopPath();
    const s = pathAt(path, run);
    poseAt(path, show.dir === 1 ? s : 1 - s, this.position, this.turn);
    let scale = LOOP_SCALE;
    if (grow < 1) {
      const whole = this.onLine(show, this.linePosition, this.lineTurn);
      this.position.lerpVectors(this.linePosition, this.position, grow);
      this.position.y += hopAt(grow);
      this.turn.slerpQuaternions(this.lineTurn, this.turn, grow);
      scale = whole + (LOOP_SCALE - whole) * grow;
    }
    show.copy.position.copy(this.position);
    show.copy.quaternion.copy(this.turn);
    show.copy.scale.setScalar(scale);
    show.copy.visible = true;
    show.obj.visible = false;
    this.tow(show, snap);
  }

  /**
   * The tow ropes: from each car coupled to the engine (the snapshot's neighbours in its train), from its end toward
   * the engine, to the copy's end toward it (its back for a car behind, its front for one pushed ahead), sagging a
   * little. While the copy is on the line they're the coupling's few mm, and not drawn.
   */
  private tow(show: Show, snap: SimSnapshot): void {
    const i = show.index;
    const train = snap.trainIds[i];
    const ex = snap.transforms[i * 6];
    const ez = snap.transforms[i * 6 + 2];
    // The engine's place along the model's x (on the line, in `placed`).
    const engineX = vd.set(ex, snap.transforms[i * 6 + 1], ez).applyMatrix4(show.toPlaced).x;
    show.copy.updateMatrix();
    const half = CAR_SPECS.engine.length / 2;
    let used = 0;
    for (const j of [i - 1, i + 1]) {
      if (j < 0 || j >= snap.count || snap.trainIds[j] !== train) continue;
      const o = j * 6;
      const h = snap.transforms[o + 3];
      const len = CAR_SPECS[CAR_KINDS[snap.kinds[j]]].length / 2;
      // The car's end nearer the engine.
      const sign = (snap.transforms[o] - ex) * Math.cos(h) + (snap.transforms[o + 2] - ez) * Math.sin(h) < 0 ? 1 : -1;
      va.set(snap.transforms[o] + sign * Math.cos(h) * len, snap.transforms[o + 1] + AXLE_HEIGHT, snap.transforms[o + 2] + sign * Math.sin(h) * len).applyMatrix4(show.toPlaced);
      // Behind the engine (the way it crosses), or ahead of it: the copy's end that way, in its own frame (x the way
      // the path runs: the way it travels crossing from the first end).
      const behind = va.x * show.dir < engineX * show.dir;
      vb.set((behind ? -1 : 1) * show.dir * half, AXLE_HEIGHT, 0).applyMatrix4(show.copy.matrix);
      const length = va.distanceTo(vb);
      if (length < 3) continue;
      // Two lengths, to the sag in the middle.
      vc.addVectors(va, vb).multiplyScalar(0.5);
      vc.y -= ROPE_SAG * length;
      this.ropeLength(show, used++, va, vc);
      this.ropeLength(show, used++, vc, vb);
    }
    for (let k = used; k < show.ropes.children.length; k++) show.ropes.children[k].visible = false;
  }

  private ropeLength(show: Show, n: number, from: Vector3, to: Vector3): void {
    let mesh = show.ropes.children[n] as Mesh | undefined;
    if (!mesh) {
      const parts = rope();
      mesh = new Mesh(parts.geometry, parts.material);
      mesh.name = "loop-rope";
      mesh.castShadow = false;
      mesh.raycast = () => {};
      show.ropes.add(mesh);
    }
    mesh.visible = true;
    mesh.position.copy(from);
    vs.subVectors(to, from);
    const length = vs.length();
    mesh.quaternion.setFromUnitVectors(UP, vs.divideScalar(length || 1));
    mesh.scale.set(ROPE_RADIUS, length, ROPE_RADIUS);
  }

  /** A show called off eases on: the copy part way back to the engine (or, gone, part way to nothing). */
  private ease(e: Ease, cars: CarObjects): void {
    const k = smooth(Math.min(1, e.t / LOOP_CANCEL_S));
    const show = e.show;
    const there = cars.carObject(show.engine) === show.obj;
    let scale = 0;
    if (there) scale = this.onLine(show, this.linePosition, this.lineTurn);
    else {
      this.linePosition.copy(e.from.position);
      this.lineTurn.copy(e.from.quaternion);
    }
    show.copy.position.lerpVectors(e.from.position, this.linePosition, k);
    show.copy.quaternion.slerpQuaternions(e.from.quaternion, this.lineTurn, k);
    show.copy.scale.setScalar(Math.max(e.from.scale + (scale - e.from.scale) * k, 1e-3));
    // (The ropes go at once: the train's already on its way.)
    show.ropes.visible = false;
  }

  /** A show over (or called off, at once in logic): with `eased` and its copy off the line, the engine eases back. */
  private stop(k: LoopKit, eased = false): void {
    const show = k.show;
    if (!show) return;
    k.show = null;
    if (eased && show.copy.visible && show.grow > HOP_SEEN) {
      show.ropes.visible = false;
      this.eases.push({ kit: k, show, from: { position: show.copy.position.clone(), quaternion: show.copy.quaternion.clone(), scale: show.copy.scale.x }, t: 0 });
      return;
    }
    this.finish(show);
  }

  /** The copy goes, and the engine shows again. */
  private finish(show: Show): void {
    show.obj.visible = true;
    this.group.remove(show.anchor);
  }

  /** The engine a show's copy (or a part of it) stands in for, if `object` is one (a tap on it is the engine's); else −1. */
  engineAt(object: Object3D): number {
    for (let o: Object3D | null = object; o; o = o.parent) if (typeof o.userData.loopEngine === "number") return o.userData.loopEngine as number;
    return -1;
  }

  /** Is a show on at this kit piece, and for which engine (−1: none)? For tests and the e2e. */
  showing(pieceId: number): number {
    return this.kits.get(pieceId)?.show?.engine ?? -1;
  }

  /** How far across its engine was when the show at this kit piece was last drawn (0 to 1; −1: no show, or not yet). */
  progress(pieceId: number): number {
    return this.kits.get(pieceId)?.show?.drawn ?? -1;
  }

  /** A show's copy, if one is on at this kit piece (for tests and the e2e). */
  copyAt(pieceId: number): Group | undefined {
    return this.kits.get(pieceId)?.show?.copy;
  }

  /** The tow ropes drawn at this kit piece's show (for tests and the e2e): each length's ends, in the world. */
  ropesAt(pieceId: number): { from: Vector3; to: Vector3 }[] {
    const show = this.kits.get(pieceId)?.show;
    if (!show) return [];
    show.anchor.updateMatrixWorld(true);
    return show.ropes.children
      .filter((m) => m.visible)
      .map((m) => {
        m.updateWorldMatrix(true, false);
        return { from: new Vector3(0, 0, 0).applyMatrix4(m.matrixWorld), to: new Vector3(0, 1, 0).applyMatrix4(m.matrixWorld) };
      });
  }

  dispose(): void {
    for (const k of this.kits.values()) this.stop(k);
    for (const e of this.eases) this.finish(e.show);
    this.eases.length = 0;
    this.kits.clear();
    this.key = "";
    this.layout = null;
  }
}

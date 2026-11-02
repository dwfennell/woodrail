import { BoxGeometry, ConeGeometry, CylinderGeometry, ExtrudeGeometry, Frustum, Shape, Group, InstancedMesh, Matrix4, Quaternion, SphereGeometry, Vector3, type BufferGeometry, type Camera } from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import type { Landscape, Town } from "../landscape";
import type { SimSnapshot } from "../sim/sim";
import { kidSpot, levelBySize, nameHash, townTouches, Wave, type FirstTrainMark, type TouchSpot } from "../game/touches";
import { Batcher } from "./dressing/batcher";
import { setCullBox, tileAt } from "./dressing/tiles";
import type { Materials } from "./materials";

/** Touches are drawn only this near the camera (mm): further off they're too small to see. */
const TOUCH_REACH = 9000;

const CAT_COATS = ["#2a2b2e", "#e08a3c", "#fbf6ec", "#e08a3c"];
const CLOTHES = ["#c8442f", "#2f6db5", "#fbf6ec", "#e6b52c", "#3c8f4e", "#e35a8c"];
const COATS = ["#c8442f", "#2f6db5", "#3c8f4e", "#e6b52c", "#7a3b6e"];
const SKIN = "#e8c39e";

/** A part placer in a touch's own frame: x along its heading, z toward the town (or the child's right), y up. */
type Put = (colour: string, g: BufferGeometry, x: number, y: number, z: number) => void;

const _m = new Matrix4();
const _r = new Matrix4();
const _q = new Quaternion();
const _v = new Vector3();
const _s = new Vector3(1, 1, 1);
const _x = new Vector3(1, 0, 0);
const _up = new Vector3(0, 1, 0);
const _frustum = new Frustum();
const _vp = new Matrix4();

/** One town's child: where, its wave, its arm's instance. */
interface Kid {
  readonly townId: number;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly heading: number;
  readonly wave: Wave;
}

/**
 * Small touches of life, drawn (see `game/touches.ts` for where they go): the towns' cats, washing and benches, and
 * each town's child at the end of its platform (static, batched per tile, culled as the depots are, rebuilt only when
 * the towns, the land or the track change); the children's arms (one `InstancedMesh`), raised for a wave as a train
 * goes by; and the first train's marker.
 */
export class TouchesView {
  readonly group = new Group();
  private statics: Group[] = [];
  private kids: Kid[] = [];
  private arms: InstancedMesh;
  private mark: Group | null = null;
  private markAt: FirstTrainMark | null = null;
  /** The key of what the statics were built from (see `sync`). */
  private builtFrom = "";
  /** The touches as last placed (for tests and the e2e). */
  spots: TouchSpot[] = [];

  /** Asked for less motion (`prefers-reduced-motion`): the children don't wave. */
  calm = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

  constructor(private readonly mats: Materials) {
    this.arms = new InstancedMesh(new BoxGeometry(1.3, 5.6, 1.3).translate(0, -2.6, 0), mats.lacquer(SKIN), 64);
    this.arms.count = 0;
    this.arms.castShadow = true;
    this.arms.frustumCulled = false;
    this.group.add(this.arms);
    if (typeof matchMedia === "function") matchMedia("(prefers-reduced-motion: reduce)").addEventListener?.("change", (e) => (this.calm = e.matches));
  }

  /**
   * Place the touches for this land, if `key` (whatever they're placed from: the towns, the land, the track, the
   * levels) differs from the last time. `levelOf`: a town's level (none: by its size); `blocked`: something of the
   * player's at x, z (track near, a prop). Returns true if it rebuilt.
   */
  sync(land: Landscape, key: string, levelOf: ((town: Town) => number) | null, blocked: (x: number, z: number) => boolean): boolean {
    if (key === this.builtFrom) return false;
    this.builtFrom = key;
    for (const g of this.statics) {
      this.group.remove(g);
      g.traverse((o) => (o as { geometry?: BufferGeometry }).geometry?.dispose());
    }
    this.statics = [];
    const tiles = new Map<number, { b: Batcher; at: { x: number; z: number }[] }>();
    const tileOf = (x: number, z: number) => {
      const k = tileAt(x, z);
      let t = tiles.get(k);
      if (!t) tiles.set(k, (t = { b: new Batcher(this.mats.paint), at: [] }));
      t.at.push({ x, z });
      return t.b;
    };
    this.spots = [];
    const waves = new Map(this.kids.map((k) => [k.townId, k.wave]));
    this.kids = [];
    for (const town of land.towns) {
      for (const spot of townTouches(land, town, levelOf ? levelOf(town) : levelBySize(town), blocked)) {
        this.spots.push(spot);
        const put = placer(this.mats, tileOf(spot.x, spot.z), spot.x, spot.y, spot.z, spot.heading);
        if (spot.kind === "cat") cat(put, spot.variant);
        else if (spot.kind === "washing") washing(put, spot.variant);
        else bench(put, spot.variant);
      }
      // (A station upgraded to a big station's kit has a platform of its own: no child there.)
      if (town.upgraded) continue;
      const k = kidSpot(town);
      kid(placer(this.mats, tileOf(k.x, k.z), k.x, k.y, k.z, k.heading), nameHash(town.name));
      this.kids.push({ townId: town.id, ...k, wave: waves.get(town.id) ?? new Wave() });
    }
    for (const { b, at } of tiles.values()) {
      const g = new Group();
      b.build(g);
      g.traverse((o) => {
        o.castShadow = true;
        o.receiveShadow = true;
      });
      setCullBox(g, at, 40);
      g.userData.maxDistance = TOUCH_REACH;
      this.group.add(g);
      this.statics.push(g);
    }
    if (this.arms.instanceMatrix.count < this.kids.length) {
      this.group.remove(this.arms);
      this.arms.dispose();
      this.arms = new InstancedMesh(this.arms.geometry, this.arms.material, this.kids.length + 16);
      this.arms.castShadow = true;
      this.arms.frustumCulled = false;
      this.group.add(this.arms);
    }
    this.arms.count = this.kids.length;
    for (let i = 0; i < this.kids.length; i++) this.poseArm(i);
    this.arms.instanceMatrix.needsUpdate = true;
    // Drawn only when a child may be in view: a sphere round them all, and an arm's reach.
    if (this.kids.length > 0) {
      this.arms.computeBoundingSphere();
      this.arms.boundingSphere!.radius += 12;
      this.arms.frustumCulled = true;
    }
    return true;
  }

  /** The first train's marker: shown where it is (null: none yet). Built once, when it's set. */
  setMark(mark: FirstTrainMark | null | undefined, groundY: (x: number, z: number) => number): void {
    const same = mark && this.markAt && mark.x === this.markAt.x && mark.z === this.markAt.z;
    if (same || (!mark && !this.markAt)) return;
    if (this.mark) {
      this.group.remove(this.mark);
      this.mark.traverse((o) => (o as { geometry?: BufferGeometry }).geometry?.dispose());
      this.mark = null;
    }
    this.markAt = mark ? { ...mark } : null;
    if (!mark) return;
    const b = new Batcher(this.mats.paint);
    marker(placer(this.mats, b, mark.x, groundY(mark.x, mark.z), mark.z, mark.heading));
    const g = new Group();
    b.build(g);
    g.traverse((o) => (o.castShadow = true));
    g.name = "first-train-mark";
    this.mark = g;
    this.group.add(g);
  }

  /** Where the first train's marker is drawn (null: none; for tests and the e2e). */
  get marked(): FirstTrainMark | null {
    return this.markAt;
  }

  /**
   * The children wave at trains going by: called on frames where trains moved, or while one is waving (`waving`).
   * Returns true while an arm in view moves (a frame is wanted).
   */
  update(snap: SimSnapshot, dt: number, camera: Camera): boolean {
    if (this.kids.length === 0) return false;
    _vp.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    _frustum.setFromProjectionMatrix(_vp);
    let moving = false;
    for (let i = 0; i < this.kids.length; i++) {
      const k = this.kids[i];
      let near = Infinity;
      for (let c = 0; c < snap.count; c++) {
        const o = c * 6;
        const d = Math.hypot(snap.transforms[o] - k.x, snap.transforms[o + 2] - k.z);
        if (d < near) near = d;
      }
      const was = k.wave.waving;
      k.wave.update(this.calm ? Infinity : near, dt);
      if (!was && !k.wave.waving) continue;
      this.poseArm(i);
      this.arms.instanceMatrix.needsUpdate = true;
      if (_frustum.containsPoint(_v.set(k.x, k.y + 8, k.z)) && camera.position.distanceTo(_v) < TOUCH_REACH) moving = true;
    }
    return moving;
  }

  /** Is any child waving now (frames are wanted for it, in view)? */
  get waving(): boolean {
    for (const k of this.kids) if (k.wave.waving) return true;
    return false;
  }

  /** The children's waves, by town (for tests and the e2e). */
  wavesOf(): Map<number, Wave> {
    return new Map(this.kids.map((k) => [k.townId, k.wave]));
  }

  private poseArm(i: number): void {
    const k = this.kids[i];
    const { lift, swing } = k.wave.arm();
    // Down by the side at rest; raised out to the side and up for a wave, swinging to and fro.
    _q.setFromAxisAngle(_up, -k.heading);
    _m.compose(_v.set(k.x, k.y, k.z), _q, _s);
    _r.makeTranslation(0, 9.2, 2.6);
    _m.multiply(_r);
    _r.makeRotationAxis(_x, -(lift * 2.6 + swing));
    _m.multiply(_r);
    this.arms.setMatrixAt(i, _m);
  }
}

/** Parts placed in a touch's frame (at x, y, z, its x along `heading`) into a batch. */
function placer(mats: Materials, b: Batcher, x: number, y: number, z: number, heading: number): Put {
  return (colour, g, lx, ly, lz) => b.add(mats.lacquer(colour), g.translate(lx, ly, lz).rotateY(-heading).translate(x, y, z));
}

/** A cat sitting on a low garden wall. */
function cat(put: Put, v: number): void {
  put("#d8d2c4", new RoundedBoxGeometry(28, 7, 5, 1, 1), 0, 3.5, 0);
  const coat = CAT_COATS[v % CAT_COATS.length];
  const x = (v >> 3) % 2 ? 6 : -6;
  put(coat, new SphereGeometry(2.9, 10, 8).scale(1, 1.25, 1), x, 10.4, 0);
  put(coat, new SphereGeometry(2.2, 10, 8), x, 14.6, -0.5);
  for (const s of [-1, 1]) put(coat, new ConeGeometry(0.8, 1.8, 5), x + s * 1.2, 16.6, -0.5);
  // Its tail hanging down the wall.
  put(coat, new CylinderGeometry(0.55, 0.55, 7, 6), x + 2.6, 5.6, -2.8);
}

/** Washing on a line between two posts. */
function washing(put: Put, v: number): void {
  for (const s of [-1, 1]) put("#c99a5b", new BoxGeometry(1.2, 18, 1.2), s * 13, 9, 0);
  put("#fbf6ec", new BoxGeometry(26, 0.35, 0.35), 0, 17, 0);
  const n = 3 + (v % 2);
  for (let k = 0; k < n; k++) {
    const colour = CLOTHES[(v + k * 5) % CLOTHES.length];
    const wide = k % 2 ? 4.4 : 5.6;
    const tall = k % 2 ? 6.5 : 5;
    put(colour, new BoxGeometry(wide, tall, 0.5), -9 + (18 * k) / (n - 1), 16.8 - tall / 2, 0);
  }
}

/** A bench at the town's edge, its back to the town, someone on it reading. */
function bench(put: Put, v: number): void {
  const wood = "#a0612e";
  put(wood, new RoundedBoxGeometry(18, 1.4, 5, 1, 0.5), 0, 5, 0);
  put(wood, new RoundedBoxGeometry(18, 4.5, 1.1, 1, 0.4), 0, 8.6, 2.4);
  for (const s of [-1, 1]) put("#3a3a3e", new BoxGeometry(1.2, 5, 4.4), s * 7.5, 2.4, 0);
  const x = (v >> 2) % 2 ? 3.5 : -3.5;
  put(COATS[v % COATS.length], new CylinderGeometry(2.1, 2.6, 8, 10), x, 9.6, 0.6);
  put(SKIN, new SphereGeometry(2.3, 10, 8), x, 15.4, 0.6);
  // The paper they're reading, held up in front.
  put("#fbf6ec", new BoxGeometry(5.4, 4.2, 0.4).rotateX(0.35), x, 11.8, -2.2);
}

/** A child at the end of the platform, facing the track (the arm that waves is drawn apart). */
function kid(put: Put, v: number): void {
  const coat = COATS[(v >> 4) % COATS.length];
  put(coat, new CylinderGeometry(2, 2.5, 8.5, 10), 0, 4.25, 0);
  put(SKIN, new SphereGeometry(2.4, 10, 8), 0, 11, 0);
  put(COATS[(v >> 7) % COATS.length], new CylinderGeometry(1.7, 2.5, 1.4, 10), 0, 13.1, 0);
  // The other arm, down by its side.
  put(SKIN, new BoxGeometry(1.3, 5.6, 1.3), 0, 6.4, -2.6);
}

/** The first train's marker: a painted wooden token lying by the track, a yellow star on red, in a beech rim. */
function marker(put: Put): void {
  put("#c99a5b", new CylinderGeometry(8, 8.4, 1.6, 24), 0, 0.8, 0);
  put("#c8442f", new CylinderGeometry(6.6, 6.6, 0.6, 24), 0, 1.8, 0);
  const star = new Shape();
  for (let k = 0; k < 10; k++) {
    const r = k % 2 ? 2.2 : 5;
    const a = (k / 10) * Math.PI * 2 + Math.PI / 2;
    if (k === 0) star.moveTo(Math.cos(a) * r, Math.sin(a) * r);
    else star.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  // (Its points toward the way the train went.)
  put("#f2c94c", new ExtrudeGeometry(star, { depth: 0.5, bevelEnabled: false }).rotateX(-Math.PI / 2).rotateY(-Math.PI / 2), 0, 2.1, 0);
}


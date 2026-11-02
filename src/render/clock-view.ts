import { BatchedMesh, Frustum, Group, Matrix4, Quaternion, Sphere, Vector3, type BufferGeometry, type Camera, type Material, type PerspectiveCamera } from "three";
import type { PropStore } from "../props/store";
import { angleOf, CLOCK_ASSETS, handAngles, handMatrix, type ClockHand, type ClockHands } from "./clock-hands";
import { modelKey } from "./props/library";

export { handAngles, msToNextMinute } from "./clock-hands";

/** The prop whose hands show the time (the first clock that did; every model in `CLOCK_ASSETS` does now). */
export const CLOCK_ASSET = "bldg-station-clock";

/** The local minute of the day a time is in (what the hands show), for telling when it's changed. */
const minuteOf = (d: Date): number => d.getHours() * 60 + d.getMinutes();

/** A clock to draw hands for: its model's hands (by key) and where its model stands (model frame to world). */
export interface ClockAt {
  /** Its hands' key: `handsOf(key)` gives them (a prop's `modelKey`, a kit's `kitModelKey(type)`, a map part's). */
  readonly key: string;
  readonly matrix: Matrix4;
  /** False while it's hidden (a prop in the hand, drawn by the hand). */
  readonly visible?: boolean;
}

/** A clock as drawn: its hands' instances. */
interface Placed {
  key: string;
  readonly matrix: Matrix4;
  visible: boolean;
  readonly hands: readonly ClockHand[];
  readonly instances: { batch: Batch; id: number; hand: ClockHand }[];
  /** Where its first face's pivot is (world), and how far its minute hand's tip moves in a minute there (mm). */
  readonly centre: Vector3;
  tipMove: number;
}

/** Every hand part in one material: each hand shape stored once, an instance for each clock's hand. */
interface Batch {
  readonly mesh: BatchedMesh;
  readonly geometryOf: Map<BufferGeometry, number>;
  vertices: number;
  count: number;
}

const START_INSTANCES = 32;
const START_VERTICES = 1 << 12;

const frustum = new Frustum();
const viewProjection = new Matrix4();
const sphere = new Sphere(new Vector3(), 40);
const m = new Matrix4();
const q = new Quaternion();
const up = new Vector3(0, 1, 0);
const pos = new Vector3();
const scale = new Vector3();
const tip = new Vector3();

/**
 * Every clock's hands, showing the player's real local time: the props' (a station clock, a town hall, ...), the kits'
 * (a terminus, a busy platform) and the map's (the station house's). Each clock's model is drawn bare of its hands by
 * its own view; the hands are drawn here, all of them in one `BatchedMesh` per material (one, the paint: a single draw
 * call however many clocks), each hand shape stored once and each clock's hand an instance of it.
 *
 * Each view hands its clocks over as they change (`setClocks`, keyed by its own ids: a diff, so moving one clock moves
 * only its hands). Nothing looks at them frame by frame: `start` sets a timer for the next minute's start (and then each
 * minute's after it), which turns the hands and asks for one frame if a clock is in view; while the page is hidden
 * there's no timer at all, and on its showing again the hands are set at once.
 */
export class ClockView {
  readonly group = new Group();
  /** The clocks drawn, by source (`setClocks`) and the source's id. */
  private readonly sources = new Map<string, Map<number | string, Placed>>();
  private readonly batches = new Map<Material, Batch>();
  private propsVersion = -1;
  private hidden = -1;
  /** The local minute of the day the hands show (−1: not set yet), and that time. */
  private minute = -1;
  private time = new Date();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private stopWatching: (() => void) | undefined;

  /** `handsOf(key)`: a clock model's hands (null: none; undefined: not loaded yet, asked for: set the clocks again). */
  constructor(private readonly handsOf: (key: string) => ClockHands | null | undefined) {
    this.group.name = "clocks";
  }

  /** How many clocks there are (the timer looks at none while there are none). */
  get count(): number {
    let n = 0;
    for (const s of this.sources.values()) n += s.size;
    return n;
  }

  /** The props' clocks (`CLOCK_ASSETS`), up to date with the store (`hidden`: one being moved by hand, drawn by the hand). */
  sync(props: Pick<PropStore, "version" | "all">, hidden = -1, force = false): void {
    if (props.version === this.propsVersion && hidden === this.hidden && !force) return;
    this.propsVersion = props.version;
    this.hidden = hidden;
    const out: [number, ClockAt][] = [];
    for (const p of props.all()) {
      if (!CLOCK_ASSETS.has(p.asset)) continue;
      const matrix = new Matrix4().compose(pos.set(p.x, p.y, p.z), q.setFromAxisAngle(up, -p.heading), scale.setScalar(p.scale ?? 1));
      out.push([p.id, { key: modelKey(p.asset, p.variant, p.storeys), matrix, visible: p.id !== hidden }]);
    }
    this.setClocks("props", out);
  }

  /**
   * A source's clocks are these now (all of them, by its own ids): new ones get hands, moved ones' hands follow, gone
   * ones' go. One whose hands aren't loaded yet is left out (asked for: its source sets its clocks again once it's in).
   * True if anything changed.
   */
  setClocks(source: string, clocks: Iterable<readonly [number | string, ClockAt]>): boolean {
    let placed = this.sources.get(source);
    if (!placed) this.sources.set(source, (placed = new Map()));
    const seen = new Set<number | string>();
    const touched = new Set<Batch>();
    for (const [id, at] of clocks) {
      let c = placed.get(id);
      if (c && c.key !== at.key) {
        this.remove(c, touched);
        placed.delete(id);
        c = undefined;
      }
      if (!c) {
        const hands = this.handsOf(at.key);
        if (!hands) continue;
        // The time the hands show may be old (with no clocks, the timer sets none): a new one comes in at the time now.
        this.catchUp();
        c = { key: at.key, matrix: at.matrix.clone(), visible: true, hands: hands.hands, instances: [], centre: new Vector3(), tipMove: 0 };
        for (const hand of hands.hands)
          for (const part of hand.parts) {
            const batch = this.batchFor(part.material);
            c.instances.push({ batch, id: this.addInstance(batch, part.geometry), hand });
          }
        placed.set(id, c);
        this.place(c, touched);
      } else if (!c.matrix.equals(at.matrix)) {
        c.matrix.copy(at.matrix);
        this.place(c, touched);
      }
      seen.add(id);
      const visible = at.visible ?? true;
      if (visible !== c.visible) {
        c.visible = visible;
        for (const inst of c.instances) {
          inst.batch.mesh.setVisibleAt(inst.id, visible);
          touched.add(inst.batch);
        }
      }
    }
    for (const [id, c] of placed)
      if (!seen.has(id)) {
        this.remove(c, touched);
        placed.delete(id);
      }
    for (const b of touched) b.mesh.computeBoundingSphere();
    return touched.size > 0;
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
      if (this.count > 0 && this.tick(new Date(), camera, viewH())) show();
    };
    const schedule = () => {
      clearTimeout(this.timer);
      this.timer = undefined;
      if (doc.hidden) return;
      this.timer = setTimeout(() => {
        now();
        schedule();
        // (A little past the minute's start: a timer may come a millisecond or two early by `Date`'s reckoning.)
      }, msToNext(new Date()) + 20);
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
    this.setAll();
    camera.updateMatrixWorld();
    frustum.setFromProjectionMatrix(viewProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
    // Beyond `far`, a minute's move of a minute hand's tip is under half a pixel.
    const fov = (camera as PerspectiveCamera).isPerspectiveCamera ? (camera as PerspectiveCamera).fov : 45;
    const perMm = viewH / (2 * Math.tan((fov * Math.PI) / 360) * 0.5);
    for (const s of this.sources.values())
      for (const c of s.values()) {
        if (!c.visible) continue;
        sphere.center.copy(c.centre);
        sphere.radius = Math.max(10, c.tipMove * 12);
        if (frustum.intersectsSphere(sphere) && camera.position.distanceTo(c.centre) < c.tipMove * perMm) return true;
      }
    return false;
  }

  /** The angles the hands show now (for tests and e2e checks). */
  get shown(): { hour: number; minute: number } {
    return handAngles(this.time.getHours(), this.time.getMinutes());
  }

  /**
   * The angle each drawn hand shows (clockwise from twelve), read back from its instance's matrix, by source (for tests
   * and e2e checks: what's drawn, not what was meant).
   */
  drawnAngles(): Record<string, { hour: number[]; minute: number[] }> {
    const out: Record<string, { hour: number[]; minute: number[] }> = {};
    const rest = new Matrix4();
    const drawn = new Matrix4();
    for (const [name, s] of this.sources) {
      const r = (out[name] = { hour: [] as number[], minute: [] as number[] });
      for (const c of s.values())
        for (const inst of c.instances) {
          inst.batch.mesh.getMatrixAt(inst.id, drawn);
          // Its rest matrix's inverse, then the drawn: a turn about x by −angle.
          rest.multiplyMatrices(c.matrix, inst.hand.base).invert().multiply(drawn);
          const e = rest.elements;
          r[inst.hand.kind].push(-Math.atan2(e[6], e[5]));
        }
    }
    return out;
  }

  /** How many clocks each source has (for checks). */
  counts(): Record<string, number> {
    return Object.fromEntries([...this.sources].map(([k, s]) => [k, s.size]));
  }

  /** Draw calls: one per material with hands in it. */
  get drawCalls(): number {
    let n = 0;
    for (const b of this.batches.values()) if (b.count > 0) n++;
    return n;
  }

  dispose(): void {
    this.stopWatching?.();
    this.stopWatching = undefined;
    for (const b of this.batches.values()) b.mesh.dispose();
    this.batches.clear();
    this.sources.clear();
    this.group.clear();
    this.propsVersion = -1;
  }

  /** If the minute's changed since the hands were last set, set every clock's to the time now. */
  private catchUp(): void {
    const t = new Date();
    if (minuteOf(t) === this.minute) return;
    this.minute = minuteOf(t);
    this.time = t;
    this.setAll();
  }

  private setAll(): void {
    const touched = new Set<Batch>();
    for (const s of this.sources.values()) for (const c of s.values()) this.place(c, touched);
    for (const b of touched) b.mesh.computeBoundingSphere();
  }

  /** Set a clock's hands where it stands, at the time shown. */
  private place(c: Placed, touched: Set<Batch>): void {
    const a = handAngles(this.time.getHours(), this.time.getMinutes());
    for (const inst of c.instances) {
      inst.batch.mesh.setMatrixAt(inst.id, handMatrix(c.matrix, inst.hand, angleOf(inst.hand.kind, a), m));
      touched.add(inst.batch);
    }
    // Its first hand's pivot, and its minute hand's reach there (its rest frame's scale times the hand's length).
    const first = c.hands[0];
    m.multiplyMatrices(c.matrix, first.base);
    c.centre.setFromMatrixPosition(m);
    const minute = c.hands.find((h) => h.kind === "minute") ?? first;
    m.multiplyMatrices(c.matrix, minute.base);
    let reach = 0;
    for (const p of minute.parts) {
      if (!p.geometry.boundingBox) p.geometry.computeBoundingBox();
      reach = Math.max(reach, p.geometry.boundingBox!.max.y);
    }
    c.tipMove = (2 * Math.PI * reach * tip.setFromMatrixScale(m).x) / 60;
  }

  private remove(c: Placed, touched: Set<Batch>): void {
    for (const inst of c.instances) {
      inst.batch.mesh.deleteInstance(inst.id);
      inst.batch.count--;
      touched.add(inst.batch);
    }
  }

  private addInstance(batch: Batch, geometry: BufferGeometry): number {
    const mesh = batch.mesh;
    let gid = batch.geometryOf.get(geometry);
    if (gid === undefined) {
      const need = geometry.getAttribute("position").count;
      if (mesh.unusedVertexCount < need) {
        batch.vertices = Math.max(batch.vertices * 2, batch.vertices + need);
        mesh.setGeometrySize(batch.vertices, batch.vertices * 2);
      }
      gid = mesh.addGeometry(geometry);
      batch.geometryOf.set(geometry, gid);
    }
    if (mesh.instanceCount >= mesh.maxInstanceCount) mesh.setInstanceCount(mesh.maxInstanceCount * 2);
    batch.count++;
    return mesh.addInstance(gid);
  }

  private batchFor(material: Material): Batch {
    let batch = this.batches.get(material);
    if (!batch) {
      const mesh = new BatchedMesh(START_INSTANCES, START_VERTICES, START_VERTICES * 2, material);
      // The hands cast no shadow: a millimetre off the face, theirs is only a grey smudge beside each hand that blurs
      // the time at the usual zoom.
      mesh.castShadow = false;
      mesh.receiveShadow = true;
      mesh.name = "clock hands";
      this.group.add(mesh);
      batch = { mesh, geometryOf: new Map(), vertices: START_VERTICES, count: 0 };
      this.batches.set(material, batch);
    }
    return batch;
  }
}

function msToNext(now: Date): number {
  return 60_000 - (now.getSeconds() * 1000 + now.getMilliseconds());
}

import { Frustum, Group, Matrix4, Mesh, Sphere, type Camera, type Object3D } from "three";
import { modelKey, type PropLibrary } from "./props/library";

/** The boat that calls at harbours (a catalogue model; Asset Gen's own boats can take over later). */
const BOAT_ASSET = "veh-rowing-boat";
/** How high a boat floats: its hull sits in the felt water (1.6 thick). */
const FLOAT_Y = 0.6;
/** Room round a boat's middle for the whole of it (and its shadow) when asking if it's in view. */
const BOAT_REACH = 120;

type Point = { readonly x: number; readonly z: number };

/** A boat on the move: along `way` over `seconds` from `start` (performance.now), then `done`. */
interface Sailing {
  boat: Object3D;
  way: readonly Point[];
  at: number[];
  seconds: number;
  leaving: boolean;
  start: number;
  done: () => void;
  /** Was it in view at the last frame (so its leaving the view is drawn too)? */
  seen: boolean;
}

const frustum = new Frustum();
const viewProj = new Matrix4();
const sphere = new Sphere();

/**
 * Boats calling at harbours (Game mode): one sails in along its way, stays tied up at the quay (drawn once), and
 * sails out the same way backwards. Moving boats are placed by the clock every frame, but ask for a frame to be drawn
 * only while one is in view.
 */
export class BoatsView {
  readonly group = new Group();
  /** Each harbour's boat that's in (sailing in, or tied up), by depot id. */
  private readonly docked = new Map<number, Object3D>();
  private readonly sailing: Sailing[] = [];
  /** Each harbour's boat still loading, by a token that a later arrive, a remove or a clear makes stale. */
  private readonly pending = new Map<number, number>();
  private token = 0;

  constructor(
    private readonly library: PropLibrary,
    private readonly invalidate: () => void,
  ) {
    this.group.name = "boats";
  }

  /** A boat sails in to depot `depotId`'s quay along `way` (`seconds` long), and stays there. */
  arrive(depotId: number, way: readonly Point[], seconds: number): void {
    this.remove(depotId);
    if (way.length < 2) return;
    const token = ++this.token;
    this.pending.set(depotId, token);
    void this.boat().then((boat) => {
      // Gone, or another boat called, or a new map, while the model loaded.
      if (this.pending.get(depotId) !== token) return;
      this.pending.delete(depotId);
      if (!boat) return;
      this.docked.set(depotId, boat);
      this.group.add(boat);
      this.sail(boat, way, seconds, false, () => this.invalidate());
    });
  }

  /** The boat at depot `depotId` sails away (back along `way`), and is gone. */
  leave(depotId: number, way: readonly Point[], seconds: number): void {
    this.pending.delete(depotId);
    const boat = this.docked.get(depotId);
    this.docked.delete(depotId);
    if (!boat) return;
    this.stop(boat);
    if (way.length < 2) {
      this.dispose(boat);
      return;
    }
    this.sail(boat, [...way].reverse(), seconds, true, () => this.dispose(boat));
  }

  /** The boat at depot `depotId` is gone at once (its harbour was taken up, or moved). */
  remove(depotId: number): void {
    this.pending.delete(depotId);
    const b = this.docked.get(depotId);
    this.docked.delete(depotId);
    if (!b) return;
    this.stop(b);
    this.dispose(b);
  }

  /** Every boat gone at once (a new map). */
  clear(): void {
    this.pending.clear();
    this.docked.clear();
    this.sailing.length = 0;
    this.group.clear();
  }

  /** How many boats there are (tied up, or sailing in or out). */
  get count(): number {
    return this.group.children.length;
  }

  /** Move the boats on (by the clock): true if one moved in view, so a frame should be drawn. */
  update(camera: Camera): boolean {
    if (this.sailing.length === 0) return false;
    viewProj.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    frustum.setFromProjectionMatrix(viewProj);
    const now = performance.now();
    let draw = false;
    for (let i = this.sailing.length - 1; i >= 0; i--) {
      const s = this.sailing[i];
      const t = Math.min(s.seconds, (now - s.start) / 1000);
      const u = t / s.seconds;
      // Ease in when arriving (slowing to the quay), out when leaving (getting going).
      place(s, s.leaving ? u * u : 1 - (1 - u) * (1 - u));
      sphere.center.copy(s.boat.position);
      sphere.radius = BOAT_REACH;
      const seen = frustum.intersectsSphere(sphere);
      if (seen || s.seen) draw = true;
      s.seen = seen;
      if (t >= s.seconds) {
        this.sailing.splice(i, 1);
        s.done();
      }
    }
    return draw;
  }

  private sail(boat: Object3D, way: readonly Point[], seconds: number, leaving: boolean, done: () => void): void {
    // Distances along the way, to move at an even speed.
    const at: number[] = [0];
    for (let k = 1; k < way.length; k++) at.push(at[k - 1] + Math.hypot(way[k].x - way[k - 1].x, way[k].z - way[k - 1].z));
    // By the clock, not by frames: a slow device's frames (whose steps the game caps) don't leave the boat behind
    // its harbour's timetable.
    const s: Sailing = { boat, way, at, seconds, leaving, start: performance.now(), done, seen: true };
    place(s, 0);
    this.sailing.push(s);
    this.invalidate();
  }

  /** Stop moving `boat` (where it is). */
  private stop(boat: Object3D): void {
    const i = this.sailing.findIndex((s) => s.boat === boat);
    if (i !== -1) this.sailing.splice(i, 1);
  }

  private dispose(boat: Object3D): void {
    this.group.remove(boat);
    this.invalidate();
  }

  private async boat(): Promise<Object3D | null> {
    const model = await this.library.load(modelKey(BOAT_ASSET)).catch(() => null);
    if (!model) return null;
    const g = new Group();
    for (const part of model.parts) {
      const m = new Mesh(part.geometry, part.material);
      // The library owns the geometry.
      m.userData.sharedGeometry = true;
      m.castShadow = true;
      g.add(m);
    }
    g.position.y = FLOAT_Y;
    return g;
  }
}

/** Put a sailing boat `u` (0–1) of the way along its way, facing the way it goes. */
function place(s: Sailing, u: number): void {
  const { way, at, boat } = s;
  const d = u * (at[at.length - 1] || 1);
  let k = 0;
  while (k < way.length - 2 && at[k + 1] < d) k++;
  const a = way[k];
  const b = way[k + 1];
  const f = (d - at[k]) / Math.max(1e-6, at[k + 1] - at[k]);
  boat.position.x = a.x + (b.x - a.x) * f;
  boat.position.z = a.z + (b.z - a.z) * f;
  boat.rotation.y = -Math.atan2(b.z - a.z, b.x - a.x);
}

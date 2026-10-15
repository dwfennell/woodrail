import { Group, Mesh, type Object3D } from "three";
import type { Flourish } from "./flourishes";
import { modelKey, type PropLibrary } from "./props/library";

/** The boat that calls at harbours (a catalogue model; Asset Gen's own boats can take over later). */
const BOAT_ASSET = "veh-rowing-boat";
/** How high a boat floats: its hull sits in the felt water (1.6 thick). */
const FLOAT_Y = 0.6;

type Point = { readonly x: number; readonly z: number };

/**
 * Boats calling at harbours (Game mode): one sails in along its way while it moves (a flourish, so frames are drawn
 * only then), stays tied up at the quay (drawn once), and sails out the same way backwards.
 */
export class BoatsView {
  readonly group = new Group();
  /** Each harbour's boat that's in (sailing in, or tied up), by depot id. */
  private readonly docked = new Map<number, Object3D>();

  constructor(
    private readonly library: PropLibrary,
    private readonly flourish: (f: Flourish) => void,
    private readonly invalidate: () => void,
  ) {
    this.group.name = "boats";
  }

  /** A boat sails in to depot `depotId`'s quay along `way` (`seconds` long), and stays there. */
  arrive(depotId: number, way: readonly Point[], seconds: number): void {
    this.remove(depotId);
    void this.boat().then((boat) => {
      if (!boat || way.length < 2) return;
      this.docked.set(depotId, boat);
      this.group.add(boat);
      this.flourish(sail(boat, way, seconds, false, () => this.invalidate()));
    });
  }

  /** The boat at depot `depotId` sails away (back along `way`), and is gone. */
  leave(depotId: number, way: readonly Point[], seconds: number): void {
    const boat = this.docked.get(depotId);
    this.docked.delete(depotId);
    if (!boat) return;
    if (way.length < 2) {
      this.dispose(boat);
      return;
    }
    const back = [...way].reverse();
    this.flourish(sail(boat, back, seconds, true, () => this.dispose(boat)));
  }

  /** Every boat gone at once (a new map). */
  clear(): void {
    for (const id of [...this.docked.keys()]) this.remove(id);
    this.group.clear();
  }

  private remove(depotId: number): void {
    const b = this.docked.get(depotId);
    if (b) this.dispose(b);
    this.docked.delete(depotId);
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

/** Move `boat` along `way` over `seconds`, eased at both ends, facing the way it goes; `done` when it gets there. */
function sail(boat: Object3D, way: readonly Point[], seconds: number, leaving: boolean, done: () => void): Flourish {
  // Distances along the way, to move at an even speed.
  const at: number[] = [0];
  for (let k = 1; k < way.length; k++) at.push(at[k - 1] + Math.hypot(way[k].x - way[k - 1].x, way[k].z - way[k - 1].z));
  const total = at[at.length - 1] || 1;
  let t = 0;
  let k = 0;
  const place = (u: number) => {
    const d = u * total;
    while (k < way.length - 2 && at[k + 1] < d) k++;
    while (k > 0 && at[k] > d) k--;
    const a = way[k];
    const b = way[k + 1];
    const f = (d - at[k]) / Math.max(1e-6, at[k + 1] - at[k]);
    boat.position.x = a.x + (b.x - a.x) * f;
    boat.position.z = a.z + (b.z - a.z) * f;
    boat.rotation.y = -Math.atan2(b.z - a.z, b.x - a.x);
  };
  place(0);
  let finished = false;
  // By the clock, not by frames: a slow device's frames (whose steps the game caps) don't leave the boat behind its
  // harbour's timetable.
  const start = performance.now();
  return {
    update(): boolean {
      t = Math.min(seconds, (performance.now() - start) / 1000);
      const u = t / seconds;
      // Ease in when arriving (slowing to the quay), out when leaving (getting going).
      place(leaving ? u * u : 1 - (1 - u) * (1 - u));
      if (t >= seconds && !finished) {
        finished = true;
        done();
        return false;
      }
      return true;
    },
    dispose(): void {
      if (!finished) {
        finished = true;
        place(1);
        done();
      }
    },
  };
}

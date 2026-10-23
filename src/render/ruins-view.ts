import { BoxGeometry, Group, Mesh, type BufferGeometry, type Material, type Object3D } from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import type { MapSite } from "../landscape";
import type { Pose } from "../track";
import { Batcher } from "./dressing/batcher";
import { setCullBox, tileAt } from "./dressing/tiles";
import type { DepotView } from "./depot-view";
import type { Materials } from "./materials";

/** A ruin to draw: an old industry's site, and whether its stub is drawn here (on land not yet bought, it isn't track). */
export interface ShownRuin {
  site: MapSite;
  /** Its stub drawn as part of the ruin (on the land around: no track piece there). */
  stub: boolean;
}

/** The ruins' one colour: weathered, unpainted grey. */
const GREY = "#bcb6ab";
/** Fence and sign: old wood, and a faded sign board. */
const FENCE = "#9c8466";
const SIGN = "#e9dfc8";
const SIGN_EDGE = "#b8644f";

/** The yard's fence runs round its far sides (depot coordinates: t along the stub, l out across the yard). */
const FENCE_T0 = 6;
const FENCE_T1 = 210;
const FENCE_L0 = 30;
const FENCE_L1 = 118;
const POST_EVERY = 34;

/**
 * Old industries' ruins (map sites, step 1): each a greyed, fenced yard of its industry's model (`DepotView`'s own
 * parts, all in one grey), a small sign by the stub, and on the land around (not yet bought) the stub itself. Batched
 * per tile (2 × 2 plots) into one merged mesh, static, casting shadows; built only when the ruins shown change
 * (`sync`: a tile is rebuilt only if its ruins did), never per frame. Its tiles are culled with the depots'.
 */
export class RuinsView {
  readonly group = new Group();
  private readonly tiles = new Map<number, { key: string; group: Group }>();
  /** Every ruin's look built again (the industries' models arrived): see `sync`'s `force`. */
  private built = 0;
  /** How long the last tile built took (ms), and how many tiles the last `sync` built. */
  lastBuildMs = 0;
  lastBuilt = 0;

  constructor(
    private readonly mats: Materials,
    private readonly depots: DepotView,
  ) {
    this.group.name = "ruins";
  }

  /**
   * Show these ruins. Each tile's are rebuilt only if they changed (or with `force`: the industries' models have
   * arrived, and every ruin's look with them). True if anything was rebuilt.
   */
  sync(ruins: readonly ShownRuin[], force = false): boolean {
    if (force) this.built++;
    const byTile = new Map<number, ShownRuin[]>();
    for (const r of ruins) {
      const key = tileAt(r.site.centre.x, r.site.centre.z);
      let list = byTile.get(key);
      if (!list) byTile.set(key, (list = []));
      list.push(r);
    }
    let changed = false;
    this.lastBuilt = 0;
    for (const [tile, have] of this.tiles) {
      if (byTile.has(tile)) continue;
      this.drop(have.group);
      this.tiles.delete(tile);
      changed = true;
    }
    for (const [tile, list] of byTile) {
      const key = `${this.built}|` + list.map((r) => `${r.site.role}@${r.site.centre.x},${r.site.centre.z},${r.site.piece.heading.toFixed(3)}${r.stub ? "+" : ""}`).sort().join(";");
      const have = this.tiles.get(tile);
      if (have?.key === key) continue;
      if (have) this.drop(have.group);
      const t0 = performance.now();
      const group = this.build(list);
      this.lastBuildMs = performance.now() - t0;
      this.lastBuilt++;
      this.group.add(group);
      this.tiles.set(tile, { key, group });
      changed = true;
    }
    return changed;
  }

  /** Is this object (a ray's hit) one of the ruins? */
  isRuin(object: Object3D): boolean {
    for (let o: Object3D | null = object; o; o = o.parent) if (o.userData.ruins) return true;
    return false;
  }

  dispose(): void {
    for (const t of this.tiles.values()) this.drop(t.group);
    this.tiles.clear();
  }

  private drop(group: Group): void {
    this.group.remove(group);
    group.traverse((o) => {
      if (o instanceof Mesh) o.geometry.dispose();
    });
  }

  /** A tile's ruins, merged: the paint (every grey part, the fence and the sign) is one mesh. */
  private build(list: readonly ShownRuin[]): Group {
    const mats = this.mats;
    const grey = mats.lacquer(GREY);
    const fence = mats.lacquer(FENCE);
    const b = new Batcher(mats.paint);
    const points: { x: number; z: number }[] = [];
    for (const { site, stub } of list) {
      const pose: Pose = site.piece;
      this.depots.staticParts(site.role, pose, (_m, g) => b.add(grey, g));
      const place = (g: BufferGeometry, t: number, l: number, y: number, m: Material) => {
        const c = Math.cos(pose.heading);
        const s = Math.sin(pose.heading);
        g.rotateY(-pose.heading);
        g.translate(pose.x + c * t - s * l, y, pose.z + s * t + c * l);
        b.add(m, g);
      };
      // The fence round the yard's far sides: posts, and a rail along their tops (a gap by the stub, for the way in).
      const rail = (t0: number, l0: number, t1: number, l1: number) => {
        const len = Math.hypot(t1 - t0, l1 - l0);
        const g = new BoxGeometry(len, 2.4, 2.4);
        if (l1 !== l0) g.rotateY(-Math.PI / 2);
        place(g, (t0 + t1) / 2, (l0 + l1) / 2, 11, fence);
      };
      for (let t = FENCE_T0; t <= FENCE_T1; t += POST_EVERY) place(new BoxGeometry(3, 14, 3), t, FENCE_L1, 7, fence);
      for (let l = FENCE_L0; l < FENCE_L1; l += POST_EVERY) {
        place(new BoxGeometry(3, 14, 3), FENCE_T0, l, 7, fence);
        place(new BoxGeometry(3, 14, 3), FENCE_T1, l, 7, fence);
      }
      rail(FENCE_T0, FENCE_L1, FENCE_T1, FENCE_L1);
      rail(FENCE_T0, FENCE_L0, FENCE_T0, FENCE_L1);
      rail(FENCE_T1, FENCE_L0, FENCE_T1, FENCE_L1);
      // A small sign by the stub's near end: two posts and a faded board, edged in red, facing the track.
      for (const t of [6, 34]) place(new BoxGeometry(3, 40, 3), t, 36, 20, fence);
      place(new RoundedBoxGeometry(38, 22, 2.5, 1, 0.8), 20, 34, 40, mats.lacquer(SIGN));
      place(new RoundedBoxGeometry(40, 3.5, 3, 1, 0.8), 20, 34, 52, mats.lacquer(SIGN_EDGE));
      // On the land around, its stub: grey planks where the track would be.
      if (stub) place(new RoundedBoxGeometry(216, 6, 40, 1, 1.5), 108, 0, 3, grey);
      points.push({ x: site.centre.x, z: site.centre.z });
    }
    const group = new Group();
    group.userData.ruins = true;
    b.build(group);
    // Yards reach about 250 mm from their stub's middle.
    setCullBox(group, points.flatMap((p) => [{ x: p.x - 260, z: p.z - 260 }, { x: p.x + 260, z: p.z + 260 }]), 160);
    return group;
  }
}

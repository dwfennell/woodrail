import { BoxGeometry, ConeGeometry, CylinderGeometry, Group, InstancedMesh, Matrix4, Mesh, Object3D, Quaternion, Vector3, type BufferGeometry, type Material } from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { CARGO, CARGO_KINDS, type CargoKind, type CargoSlot, type CraneMove, type DepotRole, type DepotState, type Economy } from "../economy";
import type { Layout, Pose } from "../track";
import { TRACK_WIDTH } from "../track";
import { STATION_CRANE_AT } from "../game/world";
import { BUNDLE_HEIGHT, BUNDLE_LENGTH, BUNDLE_WIDTH, LOG_LENGTH, LOG_RADIUS, pileSlot, SACK_HEIGHT, SACK_LENGTH, SACK_WIDTH, unitSize, wagonSlot } from "./cargo-layout";
import { Batcher } from "./dressing/batcher";
import { setCullBox, tileAt } from "./dressing/tiles";
import type { Materials } from "./materials";
import { TIMBER_DECK } from "./train-models";

/** A pile's place in depot coordinates: `t` along the depot track from its socket end, `l` across (yard side +). */
interface PileSpot {
  t: number;
  l: number;
  /** Ground height under the pile. */
  y: number;
  across: number;
  /** Units lie along the track (t) or across it (l). */
  axis: "t" | "l";
}

interface CraneSpec {
  kind: "jib" | "gantry";
  /** Jib: the mast; gantry: the beam's middle. */
  t: number;
  l: number;
  /** Height the hook travels at (jib arm / gantry beam underside). */
  height: number;
}

interface DepotLayout {
  pad: { t: number; l: number; w: number; d: number } | null;
  crane: CraneSpec;
  piles: Partial<Record<CargoKind, PileSpot>>;
  /** Where wagons stop, along the track. */
  trackT: number;
}

const SIDE = TRACK_WIDTH / 2;
const PAD_H = 4;

/** Where everything stands at each kind of depot (depot coordinates; see PileSpot). */
export const DEPOT_LAYOUT: Record<DepotRole, DepotLayout> = {
  forest: {
    pad: { t: 108, l: 72, w: 196, d: 84 },
    // Crane arms that swing over the track clear the engine's chimney (63 mm).
    crane: { kind: "jib", t: 108, l: 40, height: 72 },
    piles: { log: { t: 108, l: 82, y: PAD_H, across: 4, axis: "t" } },
    trackT: 108,
  },
  sawmill: {
    pad: { t: 108, l: 72, w: 196, d: 84 },
    crane: { kind: "gantry", t: 108, l: 45, height: 66 },
    piles: {
      log: { t: 108, l: 52, y: PAD_H, across: 3, axis: "t" },
      planks: { t: 108, l: 96, y: PAD_H, across: 2, axis: "t" },
    },
    trackT: 108,
  },
  workshop: {
    pad: { t: 108, l: 72, w: 196, d: 84 },
    crane: { kind: "jib", t: 60, l: 40, height: 72 },
    piles: { planks: { t: 60, l: 84, y: PAD_H, across: 2, axis: "t" } },
    trackT: 60,
  },
  // The farm chain: a farm yard (grain from the fields) and a mill (grain into flour), laid out like the others.
  farm: {
    pad: { t: 108, l: 72, w: 196, d: 84 },
    crane: { kind: "jib", t: 108, l: 40, height: 72 },
    piles: { grain: { t: 100, l: 76, y: PAD_H, across: 3, axis: "t" } },
    trackT: 108,
  },
  mill: {
    pad: { t: 108, l: 72, w: 196, d: 84 },
    crane: { kind: "gantry", t: 108, l: 45, height: 66 },
    piles: {
      grain: { t: 108, l: 54, y: PAD_H, across: 3, axis: "t" },
      flour: { t: 108, l: 92, y: PAD_H, across: 3, axis: "t" },
    },
    trackT: 108,
  },
  town: {
    pad: null,
    // Above the chimney, below the station canopy (76 mm).
    crane: { kind: "jib", t: 46, l: SIDE + 12, height: 66 },
    // On the platform's goods corner, bundles lying across it.
    piles: { planks: { t: 20.5, l: SIDE + 23, y: 14, across: 2, axis: "l" } },
    trackT: STATION_CRANE_AT,
  },
};

/** Where a hopper's load sits (car-local y): in the top of its bin. A guess until the grain heap model comes. */
const HOPPER_LOAD = TIMBER_DECK + 8;

/** Gantry legs stand this far out on each side of the beam's middle. */
const GANTRY_HALF = 70;
const JIB_ARM = 46;
/** Height of the hook's travel above the top of what it carries. */
const HOOK_DROP = 6;

/** Depot coordinates → world (y is passed through). */
/** Cranes' moving parts are drawn only this near the camera (mm): further off they're too small to see work. */
const CRANE_REACH = 8000;

/** A depot's frame: its piece's pose, and the height its track stands at (a level up on a raised square). */
type SitePose = Pose & { readonly y?: number };

function toWorld(pose: SitePose, t: number, l: number, y: number, out: Vector3): Vector3 {
  const c = Math.cos(pose.heading);
  const s = Math.sin(pose.heading);
  return out.set(pose.x + c * t - s * l, y + (pose.y ?? 0), pose.z + s * t + c * l);
}

/** Rotation that turns a unit's length (x) along depot axis `axis`. */
function axisYaw(pose: Pose, axis: "t" | "l"): number {
  return axis === "t" ? -pose.heading : -pose.heading - Math.PI / 2;
}

interface CraneParts {
  /** Jib: turns about the mast; gantry: unused (the trolley moves). */
  arm: Group | null;
  trolley: Group;
  rope: Mesh;
  /** Hook position and arm angle kept between frames, so the crane stays where it last worked. */
  hook: Vector3;
}

interface Site {
  depot: DepotState;
  pose: SitePose;
  layout: DepotLayout;
  crane: CraneParts;
  blade: Mesh | null;
  /** This frame's crane move (scratch, reused), and whether there is one. */
  readonly move: CraneMove;
  moving: boolean;
  /** Picking owners for this depot's piles, made once. */
  readonly pileOwners: Record<CargoKind, CargoSlot>;
}

/** One kind of goods as drawn: its parts (instanced, a unit per instance), who each drawn unit belongs to, and the copy a crane or a hand carries. */
interface UnitMeshes {
  readonly parts: InstancedMesh[];
  readonly owners: CargoSlot[];
  readonly carried: Group;
  /** Units drawn so far this frame, and last frame. */
  n: number;
  last: number;
}
const ease = (x: number) => x * x * (3 - 2 * x);

const _m = new Matrix4();
const _q = new Quaternion();
const _v = new Vector3();
const _a = new Vector3();
const _b = new Vector3();
const _s = new Vector3(1, 1, 1);
const _up = new Vector3(0, 1, 0);

/**
 * Depots as toys: the static yards, sheds and cranes (batched), the moving crane parts, the piles, and the cargo
 * riding on every timber wagon. Updated every frame from the economy.
 */
export class DepotView {
  readonly group = new Group();
  private sites: Site[] = [];
  /** Each kind of goods' meshes (logs, plank bundles, sacks). */
  private readonly units: Record<CargoKind, UnitMeshes>;
  private static readonly MAX_UNITS = 2048;
  /** A unit being carried by hand: one fewer is drawn at its source. */
  dragging: CargoSlot | null = null;
  /** Picking owners for wagon loads by car id, made once per car. */
  private readonly carOwners = new Map<number, CargoSlot>();
  private readonly cargoMeshes: InstancedMesh[];

  constructor(private readonly mats: Materials) {
    const log = new CylinderGeometry(LOG_RADIUS, LOG_RADIUS, LOG_LENGTH, 14).rotateZ(Math.PI / 2);
    const boards = mergeGeometries(
      [0, 1, 2].map((k) => new RoundedBoxGeometry(BUNDLE_LENGTH, BUNDLE_HEIGHT / 3 - 0.3, BUNDLE_WIDTH, 1, 0.5).translate(0, -BUNDLE_HEIGHT / 3 + (k * BUNDLE_HEIGHT) / 3, 0).toNonIndexed()),
    )!;
    const strap = new BoxGeometry(2.4, BUNDLE_HEIGHT + 0.4, BUNDLE_WIDTH + 0.4);
    const logMat = mats.lacquer("#a8743f");
    const strapMat = mats.lacquer("#c8442f");
    // A sack (grain golden, flour white) with a tie at its neck; stand-ins until the models come.
    const sack = new RoundedBoxGeometry(SACK_LENGTH, SACK_HEIGHT, SACK_WIDTH, 2, 2.4);
    const tie = new CylinderGeometry(1.6, 2.2, 2.4, 10).rotateZ(Math.PI / 2).translate(SACK_LENGTH / 2 + 0.6, 0, 0);
    const looks: Record<CargoKind, [BufferGeometry, Material][]> = {
      log: [[log, logMat]],
      planks: [
        [boards, mats.naturalWood],
        [strap, strapMat],
      ],
      grain: [
        [sack, mats.lacquer("#d9a441")],
        [tie, strapMat],
      ],
      flour: [
        [sack, mats.lacquer("#f1ebdd")],
        [tie, mats.lacquer("#2f6db5")],
      ],
    };
    const units = {} as Record<CargoKind, UnitMeshes>;
    for (const kind of CARGO_KINDS) {
      const parts = looks[kind].map(([g, m]) => this.instanced(g, m));
      this.group.add(...parts);
      // The unit on the crane hook (one of each kind, shown as needed).
      const carried = new Group().add(...looks[kind].map(([g, m]) => new Mesh(g, m)));
      carried.traverse((o) => (o.castShadow = true));
      carried.visible = false;
      this.group.add(carried);
      units[kind] = { parts, owners: [], carried, n: 0, last: 0 };
    }
    this.units = units;
    this.cargoMeshes = CARGO_KINDS.flatMap((k) => units[k].parts);
  }

  private instanced(g: BufferGeometry, m: Material): InstancedMesh {
    const mesh = new InstancedMesh(g, m, DepotView.MAX_UNITS);
    mesh.count = 0;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    return mesh;
  }

  /** Rebuild for a world: one site per economy depot. */
  setWorld(economy: Economy, layout: Layout): void {
    for (const child of [...this.group.children]) {
      if (!child.userData.depotStatic && !child.userData.depotMoving) continue;
      this.group.remove(child);
      child.traverse((o) => {
        if (o instanceof Mesh) o.geometry.dispose();
      });
    }
    this.sites = [];
    this.carOwners.clear();
    // Static parts batched per tile (see `tiles.ts`), so those out of view are skipped.
    const tiles = new Map<number, { b: Batcher; at: { x: number; z: number }[] }>();
    for (const depot of economy.allDepots()) {
      const piece = layout.getPiece(depot.pieceId);
      // A depot piece being carried shows its buildings in the hand instead (see `model`).
      if (!piece || layout.isLifted(depot.pieceId)) continue;
      const spec = DEPOT_LAYOUT[depot.role];
      const pose: SitePose = { ...piece.pose, y: piece.y };
      const site: Site = {
        depot,
        pose: pose,
        layout: spec,
        crane: this.buildCrane(pose, spec.crane),
        blade: null,
        move: { kind: "log", toPile: false, carId: -1, phase: 0 },
        moving: false,
        pileOwners: Object.fromEntries(CARGO_KINDS.map((k) => [k, { kind: "pile", depotId: depot.id, cargo: k }])) as Record<CargoKind, CargoSlot>,
      };
      const at = toWorld(pose, spec.trackT, 0, 0, new Vector3());
      const key = tileAt(at.x, at.z);
      let tile = tiles.get(key);
      if (!tile) tiles.set(key, (tile = { b: new Batcher(this.mats.paint), at: [] }));
      tile.at.push({ x: at.x, z: at.z });
      this.buildStatic(site, tile.b);
      if (depot.role === "sawmill") site.blade = this.buildBlade(pose);
      if (depot.role === "mill") site.blade = this.buildSails(pose);
      // The crane's moving parts are small: drawn only within `CRANE_REACH` of the camera.
      for (const o of [site.crane.arm, site.crane.trolley, site.crane.rope, site.blade]) {
        if (!o) continue;
        setCullBox(o, [{ x: at.x, z: at.z }], 160);
        o.userData.maxDistance = CRANE_REACH;
      }
      // Park the hook over the track.
      toWorld(pose, spec.trackT, 0, spec.crane.height - 14, site.crane.hook);
      this.sites.push(site);
    }
    for (const { b, at } of tiles.values()) {
      const statics = new Group();
      statics.userData.depotStatic = true;
      b.build(statics);
      // Yards reach about 250 mm from their track's middle.
      setCullBox(statics, at.flatMap((p) => [{ x: p.x - 260, z: p.z - 260 }, { x: p.x + 260, z: p.z + 260 }]), 160);
      this.group.add(statics);
    }
  }

  /**
   * A depot's yard and buildings in its piece's own frame (the piece at the origin, heading 0), as one group: shown
   * with the piece while it's held, and in the tray's picture. The caller disposes its geometry.
   */
  model(role: DepotRole): Group {
    const site = { depot: { role }, pose: { x: 0, z: 0, heading: 0 }, layout: DEPOT_LAYOUT[role] } as unknown as Site;
    const b = new Batcher(this.mats.paint);
    this.buildStatic(site, b);
    const out = new Group();
    b.build(out);
    return out;
  }

  /** Static parts: yard pad, crane mast or gantry frame, and the sawmill's shed and saw table. */
  private buildStatic(site: Site, b: Batcher): void {
    const { pose, layout } = site;
    const mats = this.mats;
    const place = (g: BufferGeometry, t: number, l: number, y: number) => {
      g.rotateY(-pose.heading);
      toWorld(pose, t, l, y, _v);
      return g.translate(_v.x, _v.y, _v.z);
    };
    if (layout.pad) b.add(mats.blockWood, place(new RoundedBoxGeometry(layout.pad.w, PAD_H, layout.pad.d, 2, 1.5), layout.pad.t, layout.pad.l, PAD_H / 2));
    const c = layout.crane;
    const base = layout.pad ? PAD_H : 14;
    if (c.kind === "jib") {
      b.add(mats.naturalWood, place(new RoundedBoxGeometry(14, 6, 14, 1, 1.5), c.t, c.l, base + 3));
      b.add(mats.naturalWood, place(new CylinderGeometry(2.8, 3.2, c.height + 4 - base, 12), c.t, c.l, (base + c.height + 4) / 2));
      b.add(mats.lacquer("#c8442f"), place(new CylinderGeometry(4.2, 4.2, 3, 14), c.t, c.l, c.height + 5));
    } else {
      // Gantry: two legs either side of the track and yard, and a beam across, at the depot's middle.
      for (const l of [c.l - GANTRY_HALF, c.l + GANTRY_HALF]) {
        b.add(mats.lacquer("#2f6db5"), place(new RoundedBoxGeometry(6, c.height + 6, 6, 1, 1.2), c.t, l, (c.height + 6) / 2));
      }
      b.add(mats.lacquer("#2f6db5"), place(new RoundedBoxGeometry(6, 5, GANTRY_HALF * 2 + 6, 1, 1.2), c.t, c.l, c.height + 6.5));
    }
    if (site.depot.role === "sawmill") {
      // The saw shed: an open-sided shed over the track and the saw table at the socket end of the yard, so the
      // track runs through it while the gantry and piles stay in the open where you can watch them.
      const near = -SIDE - 8;
      const far = 104;
      const shedL = (near + far) / 2;
      // Each post stops under the sloping roof (ridge 84 mm up, falling 0.33 per mm out from it).
      for (const t of [16, 74]) {
        for (const l of [near, far]) {
          const h = 84 - Math.abs(l - shedL) * Math.tan(0.32) - 2;
          b.add(mats.lacquer("#f0ebe0"), place(new CylinderGeometry(2.4, 2.4, h, 10), t, l, h / 2));
        }
      }
      const span = far - near + 14;
      // Gable roof, ridge along the track.
      for (const side of [-1, 1]) {
        const slope = new RoundedBoxGeometry(70, 3.5, span / 2 + 4, 1, 1.2);
        slope.translate(0, 0, (side * (span / 2 + 4)) / 2);
        slope.rotateX(side * 0.32);
        b.add(mats.lacquer("#c8442f"), place(slope, 45, shedL, 84));
      }
      // Saw table at the socket end of the yard.
      b.add(mats.naturalWood, place(new RoundedBoxGeometry(44, 14, 26, 2, 2), 44, 74, PAD_H + 7));
    }
    if (site.depot.role === "workshop") {
      // The workshop: a long beech shed with a blue roof and big red doors, at the far end of the yard.
      b.add(mats.blockWood, place(new RoundedBoxGeometry(84, 40, 54, 2, 3), 156, 84, PAD_H + 20));
      for (const side of [-1, 1]) {
        const slope = new RoundedBoxGeometry(92, 4, 34, 1, 1.5);
        slope.translate(0, 0, (side * 30) / 2);
        slope.rotateX(side * 0.42);
        b.add(mats.lacquer("#2f6db5"), place(slope, 156, 84, PAD_H + 46));
      }
      // Doors on the track side, and a printed sky-blue window either side of them.
      b.add(mats.lacquer("#c8442f"), place(new RoundedBoxGeometry(30, 28, 3, 1, 1), 156, 56, PAD_H + 14));
      for (const t of [126, 186]) b.add(mats.lacquer("#bfe0f2"), place(new RoundedBoxGeometry(14, 10, 2, 1, 0.8), t, 56.5, PAD_H + 26));
    }
    if (site.depot.role === "farm") {
      // A round silo with a red cap, and a little barn, at the far end of the yard.
      b.add(mats.lacquer("#f0ebe0"), place(new CylinderGeometry(13, 13, 56, 18), 184, 66, PAD_H + 28));
      b.add(mats.lacquer("#c8442f"), place(new CylinderGeometry(4, 14, 10, 18), 184, 66, PAD_H + 61));
      b.add(mats.blockWood, place(new RoundedBoxGeometry(36, 26, 30, 2, 2.5), 176, 98, PAD_H + 13));
      for (const side of [-1, 1]) {
        const slope = new RoundedBoxGeometry(40, 3.5, 20, 1, 1.2);
        slope.translate(0, 0, (side * 18) / 2);
        slope.rotateX(side * 0.5);
        b.add(mats.lacquer("#c8442f"), place(slope, 176, 98, PAD_H + 30));
      }
    }
    if (site.depot.role === "mill") {
      // A windmill: a beech tower with a blue cap (its sails turn while it grinds; see `buildSails`).
      b.add(mats.blockWood, place(new CylinderGeometry(13, 17, 62, 16), 34, 92, PAD_H + 31));
      b.add(mats.lacquer("#2f6db5"), place(new ConeGeometry(16, 16, 16), 34, 92, PAD_H + 70));
      b.add(mats.lacquer("#c8442f"), place(new RoundedBoxGeometry(10, 14, 2, 1, 0.8), 34, 74.5, PAD_H + 7));
    }
    if (site.depot.role === "forest") {
      // A small beech hut with a green roof at the far end of the yard.
      b.add(mats.blockWood, place(new RoundedBoxGeometry(30, 26, 24, 2, 2.5), 186, 96, PAD_H + 13));
      b.add(mats.lacquer("#3c8f4e"), place(new RoundedBoxGeometry(36, 4, 30, 1, 1.5), 186, 96, PAD_H + 28));
    }
  }

  private buildCrane(pose: SitePose, c: CraneSpec): CraneParts {
    const mats = this.mats;
    const trolley = new Group();
    trolley.add(new Mesh(new RoundedBoxGeometry(7, 4, 7, 1, 1.2), mats.lacquer("#2a2b2e")));
    const rope = new Mesh(new CylinderGeometry(0.5, 0.5, 1, 6).translate(0, -0.5, 0), mats.lacquer("#2a2b2e"));
    let arm: Group | null = null;
    if (c.kind === "jib") {
      arm = new Group();
      toWorld(pose, c.t, c.l, c.height, arm.position);
      // Arm along +x from the mast, painted red with a cream tip.
      arm.add(new Mesh(new RoundedBoxGeometry(JIB_ARM, 4, 4, 1, 1.2).translate(JIB_ARM / 2 - 4, 2, 0), mats.lacquer("#c8442f")));
      arm.add(new Mesh(new RoundedBoxGeometry(5, 4.4, 4.4, 1, 1.2).translate(JIB_ARM - 4, 2, 0), mats.lacquer("#fbf6ec")));
      arm.userData.depotMoving = true;
      this.group.add(arm);
    }
    for (const o of [trolley, rope]) o.userData.depotMoving = true;
    trolley.traverse((o) => (o.castShadow = true));
    this.group.add(trolley, rope);
    return { arm, trolley, rope, hook: new Vector3() };
  }

  private buildBlade(pose: SitePose): Mesh {
    const blade = new Mesh(new CylinderGeometry(11, 11, 1.4, 28).rotateX(Math.PI / 2), this.mats.magnet);
    toWorld(pose, 44, 74, PAD_H + 14 + 4, blade.position);
    blade.rotation.y = -pose.heading;
    blade.castShadow = true;
    blade.userData.depotMoving = true;
    this.group.add(blade);
    return blade;
  }

  /** A windmill's sails, on the tower's track side; they turn (like the saw) while the mill grinds. */
  private buildSails(pose: SitePose): Mesh {
    const arm = new RoundedBoxGeometry(4, 34, 1.4, 1, 0.5).translate(0, 17, 0);
    const blades = mergeGeometries([0, 1, 2, 3].map((k) => arm.clone().rotateZ((k * Math.PI) / 2)))!;
    const sails = new Mesh(blades, this.mats.lacquer("#f1ebdd"));
    toWorld(pose, 34, 74, PAD_H + 58, sails.position);
    sails.rotation.y = -pose.heading;
    sails.castShadow = true;
    sails.userData.depotMoving = true;
    this.group.add(sails);
    return sails;
  }

  /** World pose of pile unit k (its centre), written to `pos`; returns its yaw. */
  private pileUnit(site: Site, kind: CargoKind, k: number, pos: Vector3): number {
    const spot = site.layout.piles[kind]!;
    const slot = pileSlot(kind, k, spot.across);
    // Pile-local: x along the unit, z across. Turn into depot axes.
    const t = spot.axis === "t" ? spot.t + slot.x : spot.t + slot.z;
    const l = spot.axis === "t" ? spot.l + slot.z : spot.l + slot.x;
    toWorld(site.pose, t, l, spot.y + slot.y, pos);
    return axisYaw(site.pose, spot.axis);
  }

  /** World matrix of wagon unit k on car `car` (its model root). */
  private wagonUnit(car: Object3D, kind: CargoKind, k: number, out: Matrix4): Matrix4 {
    car.updateWorldMatrix(true, false);
    const slot = wagonSlot(kind, k);
    const deck = car.userData.carKind === "hopper" ? HOPPER_LOAD : TIMBER_DECK;
    return out.makeTranslation(slot.x, deck + slot.y, slot.z).premultiply(car.matrixWorld);
  }

  /** Draw one unit of cargo this frame. */
  private put(kind: CargoKind, m: Matrix4, owner: CargoSlot): void {
    const u = this.units[kind];
    if (u.n >= DepotView.MAX_UNITS) return;
    u.owners[u.n] = owner;
    for (const part of u.parts) part.setMatrixAt(u.n, m);
    u.n++;
  }

  /** Is a crane lifting a unit off this car right now? */
  private liftedOff(carId: number): number {
    for (const site of this.sites) if (site.moving && site.move.toPile && site.move.carId === carId) return 1;
    return 0;
  }

  private carOwner(carId: number): CargoSlot {
    let o = this.carOwners.get(carId);
    if (!o) this.carOwners.set(carId, (o = { kind: "car", carId }));
    return o;
  }

  /**
   * Draw piles, wagon loads and cranes for this frame. Allocation-free. Returns "moving" while something here is
   * animating (a crane working, the saw turning, a unit in a hand), "changed" when a pile or load just grew or shrank
   * (one new frame shows it), else "still".
   */
  update(economy: Economy, carIds: ArrayLike<number>, carCount: number, carObject: (id: number) => Object3D | undefined, dt: number): "moving" | "changed" | "still" {
    let busy = this.dragging !== null;
    for (const kind of CARGO_KINDS) {
      const u = this.units[kind];
      u.last = u.n;
      u.n = 0;
      u.carried.visible = false;
    }
    const drag = this.dragging;

    // Which unit (if any) is on each crane's hook, so it isn't also drawn on its pile or wagon.
    for (const site of this.sites) {
      site.moving = economy.craneMove(site.depot.id, site.move);
      if (site.moving) busy = true;
    }

    // Piles.
    for (const site of this.sites) {
      for (const kind of CARGO_KINDS) {
        if (!site.layout.piles[kind]) continue;
        let count = site.depot.piles[CARGO[kind].index];
        if (site.moving && !site.move.toPile && site.move.kind === kind) count--; // being lifted off this pile
        if (drag?.kind === "pile" && drag.depotId === site.depot.id && drag.cargo === kind) count--; // in a hand
        const owner = site.pileOwners[kind];
        for (let k = 0; k < count; k++) {
          const yaw = this.pileUnit(site, kind, k, _v);
          _q.setFromAxisAngle(_up, yaw);
          this.put(kind, _m.compose(_v, _q, _s), owner);
        }
      }
    }

    // Wagon loads.
    for (let i = 0; i < carCount; i++) {
      const id = carIds[i];
      const cargo = economy.cargoOf(id);
      if (!cargo.kind || cargo.count === 0) continue;
      const car = carObject(id);
      if (!car) continue;
      const count = cargo.count - this.liftedOff(id) - (drag?.kind === "car" && drag.carId === id ? 1 : 0);
      const owner = this.carOwner(id);
      for (let k = 0; k < count; k++) this.put(cargo.kind, this.wagonUnit(car, cargo.kind, k, _m), owner);
    }

    // Cranes.
    for (const site of this.sites) this.updateCrane(site, economy, carObject);

    // The saw spins while the sawmill is cutting.
    for (const site of this.sites) {
      if (site.blade && economy.working(site.depot)) {
        site.blade.rotateZ(dt * (site.depot.role === "mill" ? 2.5 : 14));
        busy = true;
      }
    }

    let changed = false;
    for (const kind of CARGO_KINDS) {
      const u = this.units[kind];
      for (const part of u.parts) part.count = u.n;
      if (u.n !== u.last) changed = true;
    }
    for (const m of this.cargoMeshes) {
      m.instanceMatrix.needsUpdate = true;
      // Units move every frame: let the next raycast recompute the bounds it tests first.
      m.boundingSphere = null;
      m.boundingBox = null;
    }
    return busy ? "moving" : changed ? "changed" : "still";
  }

  /** World centre of the k-th unit on a car (or over the depot track if the car's model is missing). */
  private onCar(site: Site, car: Object3D | undefined, kind: CargoKind, k: number, out: Vector3): Vector3 {
    if (car) return out.setFromMatrixPosition(this.wagonUnit(car, kind, Math.max(0, k), _m));
    return toWorld(site.pose, site.layout.trackT, 0, 30, out);
  }

  private updateCrane(site: Site, economy: Economy, carObject: (id: number) => Object3D | undefined): void {
    const { crane, pose, layout } = site;
    const move = site.moving ? site.move : null;
    // The unit hangs well clear below the arm or beam while it travels.
    const travelY = layout.crane.height - 14 + (pose.y ?? 0);
    let unitYaw = -pose.heading;
    if (move) {
      // Source and destination centres of the unit being moved.
      const car = carObject(move.carId);
      const cargo = economy.cargoOf(move.carId);
      const pileCount = site.depot.piles[CARGO[move.kind].index];
      let pileYaw: number;
      if (move.toPile) {
        this.onCar(site, car, move.kind, cargo.count - 1, _a);
        pileYaw = this.pileUnit(site, move.kind, pileCount, _b);
      } else {
        pileYaw = this.pileUnit(site, move.kind, Math.max(0, pileCount - 1), _a);
        this.onCar(site, car, move.kind, cargo.count, _b);
      }
      // Lift (first quarter), travel (middle half), lower (last quarter).
      const p = move.phase;
      const lift = Math.min(1, p / 0.25);
      const travel = Math.min(1, Math.max(0, (p - 0.25) / 0.5));
      const lower = Math.max(0, (p - 0.75) / 0.25);
      const startY = _a.y;
      const endY = _b.y;
      const y = p < 0.25 ? startY + (travelY - startY) * ease(lift) : p < 0.75 ? travelY : travelY + (endY - travelY) * ease(lower);
      if (layout.crane.kind === "jib") {
        // Swing about the mast, easing the angle and reach.
        toWorld(pose, layout.crane.t, layout.crane.l, 0, _v);
        const a0 = Math.atan2(_a.z - _v.z, _a.x - _v.x);
        const a1 = Math.atan2(_b.z - _v.z, _b.x - _v.x);
        let da = a1 - a0;
        while (da > Math.PI) da -= Math.PI * 2;
        while (da < -Math.PI) da += Math.PI * 2;
        const r0 = Math.hypot(_a.x - _v.x, _a.z - _v.z);
        const r1 = Math.hypot(_b.x - _v.x, _b.z - _v.z);
        const a = a0 + da * ease(travel);
        const r = r0 + (r1 - r0) * ease(travel);
        crane.hook.set(_v.x + Math.cos(a) * r, y, _v.z + Math.sin(a) * r);
      } else {
        crane.hook.set(_a.x + (_b.x - _a.x) * ease(travel), y, _a.z + (_b.z - _a.z) * ease(travel));
      }
      // The unit turns from its source's lie to its destination's (wagons lie along the track, so does a t-pile).
      const carYaw = -pose.heading;
      const from = move.toPile ? carYaw : pileYaw;
      const to = move.toPile ? pileYaw : carYaw;
      unitYaw = from + (to - from) * ease(travel);
      const unit = this.units[move.kind].carried;
      unit.visible = true;
      unit.position.copy(crane.hook);
      unit.rotation.set(0, unitYaw, 0);
    }
    // Arm toward the hook (jib), trolley over the hook, rope from trolley down to the unit's top.
    const hook = crane.hook;
    const topY = move ? hook.y + unitSize(move.kind).y / 2 : hook.y;
    if (crane.arm) {
      const dx = hook.x - crane.arm.position.x;
      const dz = hook.z - crane.arm.position.z;
      crane.arm.rotation.y = -Math.atan2(dz, dx);
      const reach = Math.min(JIB_ARM - 6, Math.hypot(dx, dz));
      const ang = Math.atan2(dz, dx);
      crane.trolley.position.set(crane.arm.position.x + Math.cos(ang) * reach, crane.arm.position.y - 2, crane.arm.position.z + Math.sin(ang) * reach);
    } else {
      crane.trolley.position.set(hook.x, layout.crane.height + 1, hook.z);
    }
    const ropeLen = Math.max(0.5, crane.trolley.position.y - topY - (move ? 0 : HOOK_DROP));
    crane.rope.position.copy(crane.trolley.position);
    crane.rope.scale.set(1, ropeLen, 1);
  }

  /** The pile or wagon a picked cargo unit belongs to, or null. */
  cargoAt(object: Object3D, instanceId: number | undefined): CargoSlot | null {
    if (instanceId === undefined) return null;
    for (const kind of CARGO_KINDS) {
      const u = this.units[kind];
      if (u.parts.includes(object as InstancedMesh)) return u.owners[instanceId] ?? null;
    }
    return null;
  }

  /** Is this object part of a depot (building, crane or cargo)? */
  isDepotPart(object: Object3D): boolean {
    for (let o: Object3D | null = object; o; o = o.parent) if (o === this.group) return true;
    return false;
  }

  /** The depot (economy id) whose yard is nearest a ground point, within `range` mm; −1 if none. */
  depotNear(x: number, z: number, range = 140): number {
    let best = -1;
    let bestD = range;
    for (const site of this.sites) {
      const c = site.layout.crane;
      const pile = Object.values(site.layout.piles)[0]!;
      for (const [t, l] of [[c.t, c.l], [pile.t, pile.l], [site.layout.trackT, 0]]) {
        toWorld(site.pose, t, l, 0, _v);
        const d = Math.hypot(_v.x - x, _v.z - z);
        if (d < bestD) {
          bestD = d;
          best = site.depot.id;
        }
      }
    }
    return best;
  }

  /** Every pile in the world (economy depot id, cargo, ground centre), for dropping cargo by hand. */
  piles(): { depotId: number; cargo: CargoKind; x: number; z: number }[] {
    const out: { depotId: number; cargo: CargoKind; x: number; z: number }[] = [];
    for (const site of this.sites) {
      for (const kind of CARGO_KINDS) {
        const spot = site.layout.piles[kind];
        if (!spot) continue;
        toWorld(site.pose, spot.t, spot.l, 0, _v);
        out.push({ depotId: site.depot.id, cargo: kind, x: _v.x, z: _v.z });
      }
    }
    return out;
  }

  /** A loose copy of a unit for the hand to carry. */
  makeHeld(kind: CargoKind): Group {
    const g = this.units[kind].carried.clone();
    g.visible = true;
    g.traverse((o) => (o.castShadow = true));
    return g;
  }

  dispose(): void {
    for (const m of this.cargoMeshes) m.dispose();
  }
}

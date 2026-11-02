import { BoxGeometry, CylinderGeometry, DodecahedronGeometry, Group, InstancedMesh, Matrix4, Quaternion, SphereGeometry, Vector3, type BufferGeometry } from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { DepotRole } from "../economy";
import { PAD_H, type PlaceFn } from "./industry-dressing";
import type { Materials } from "./materials";
import { nonIndexed } from "./non-indexed";

/**
 * Busy industries' small looping motions, the saw's cousins: while an industry works (it has what it uses and room for
 * what it makes: `Economy.working`), a little thing of its own moves. The woodcutter's axe chops, the farm's pigs wander
 * in their pen, the quarry's tub wagon runs along its rails, the foundry's chimney cap bobs, the smith's hammer taps
 * the anvil, the carpenter's saw works a board. (The sawmill's saw, the mill's sails and the mine's and power station's
 * wheels turn as before: `DepotView`.) Idle, they stand still where they stopped.
 *
 * Cheap with many industries: every mote of a kind, at every industry, is one instance of one `InstancedMesh` per
 * colour; each is posed by a pure function of the one game clock (`moteMatrix`), only at industries working and in
 * view, and only on frames that are drawn. Nothing is allocated per frame.
 *
 * Coordinates are depot coordinates (see depot-view.ts): `t` along the track, `l` across (yard side +), `y` up.
 */

export type MoteKind = "axe" | "pig" | "tub" | "cap" | "hammer" | "saw";

/** One moving thing at an industry: what it is, where its anchor stands (depot frame), and its own offset in the loop. */
export interface MoteSpec {
  readonly kind: MoteKind;
  readonly t: number;
  readonly l: number;
  readonly y: number;
  /** Seconds added to the clock for this one (two pigs don't walk in step). */
  readonly offset?: number;
  /** Alive (a pig, a woodcutter's arm): left off an old industry's ruin, which keeps only its machines. */
  readonly living?: true;
}

/** The pigs' pen on the farm: between the grain pile and the barn, clear of the hay bales and the tractor's spot. */
const PEN = { t0: 122, t1: 148, l0: 56, l1: 80 } as const;
/** How far a pig wanders from the pen's middle (mm), along t and along l: it stays inside the rails. */
export const PIG_REACH = { t: (PEN.t1 - PEN.t0) / 2 - 6, l: (PEN.l1 - PEN.l0) / 2 - 5 } as const;
/** The quarry's tub wagon runs this far each way of its rails' middle (t 172; rails 140–204, a buffer at 206). */
export const TUB_RUN = 22;

/** Each industry's motes. Roles not listed have none (or turn something of their own: the saw, sails, wheels). */
export const INDUSTRY_MOTES: Partial<Record<DepotRole, readonly MoteSpec[]>> = {
  // The woodcutter beside the hut's chopping block (block at t 158–169, l 82–93, 10 high; the hut's model).
  forest: [{ kind: "axe", t: 148, l: 87.5, y: PAD_H + 13, living: true }],
  farm: [
    { kind: "pig", t: (PEN.t0 + PEN.t1) / 2, l: (PEN.l0 + PEN.l1) / 2, y: PAD_H, living: true },
    { kind: "pig", t: (PEN.t0 + PEN.t1) / 2, l: (PEN.l0 + PEN.l1) / 2, y: PAD_H, offset: 7.3, living: true },
  ],
  quarry: [{ kind: "tub", t: 172, l: 64, y: PAD_H }],
  // On top of the furnace's chimney (the model's: its rim at t 179–188, l 97–106, 72 up).
  foundry: [{ kind: "cap", t: 183.5, l: 101.5, y: 72 }],
  // The smith beside the anvil (the model's: its face at t 128–140, l 74–78, 16 up).
  smithy: [{ kind: "hammer", t: 146, l: 76, y: PAD_H + 16, living: true }],
  // Over the board on the near trestles (the model's: t 88–118, l 78–88, 12 up).
  carpenter: [{ kind: "saw", t: 110, l: 83, y: 12 }],
};

/** The furthest (mm) any mote goes from where it was placed, for the meshes' bounds (the tub: its run each way). */
const MOTE_ROAM = 2 * TUB_RUN + 10;

/** Each mote kind's loop (s): the clock goes round it. */
export const MOTE_PERIOD: Record<MoteKind, number> = { axe: 1.4, pig: 40 * Math.PI, tub: 9, cap: 1.25, hammer: 0.8, saw: 0.7 };

const smooth = (x: number) => x * x * (3 - 2 * x);
const _q = new Quaternion();
const _p = new Vector3();
const _s = new Vector3(1, 1, 1);
const _up = new Vector3(0, 1, 0);
const _z = new Vector3(0, 0, 1);
const _x = new Vector3(1, 0, 0);

/**
 * Where a mote is at game time `time` (s), relative to its anchor (x along t, z along l, y up): a pure function of
 * the clock, so any number of them share it and a paused game holds them where they are. Written to `out`.
 */
export function moteMatrix(kind: MoteKind, time: number, out: Matrix4): Matrix4 {
  switch (kind) {
    case "axe": {
      // Raised slowly, brought down fast onto the block.
      const p = (time / MOTE_PERIOD.axe) % 1;
      const a = p < 0.7 ? -0.35 + 1.65 * smooth(p / 0.7) : 1.3 - 1.65 * smooth((p - 0.7) / 0.3);
      return out.makeRotationAxis(_z, a);
    }
    case "pig": {
      // A slow wander round the pen (two sines that never quite repeat), facing the way it goes, trotting.
      const x = PIG_REACH.t * Math.sin(0.31 * time);
      const z = PIG_REACH.l * Math.sin(0.23 * time + 1.1);
      const vx = PIG_REACH.t * 0.31 * Math.cos(0.31 * time);
      const vz = PIG_REACH.l * 0.23 * Math.cos(0.23 * time + 1.1);
      _q.setFromAxisAngle(_up, Math.atan2(-vz, vx));
      return out.compose(_p.set(x, Math.abs(Math.sin(time * 9)) * 0.7, z), _q, _s);
    }
    case "tub": {
      // Along the rails and back, waiting a moment at each end.
      const p = ((time % MOTE_PERIOD.tub) + MOTE_PERIOD.tub) % MOTE_PERIOD.tub;
      const s = p < 1 ? 0 : p < 4 ? smooth((p - 1) / 3) : p < 5.5 ? 1 : p < 8.5 ? 1 - smooth((p - 5.5) / 3) : 0;
      return out.makeTranslation(-TUB_RUN + 2 * TUB_RUN * s, 0, 0);
    }
    case "cap": {
      // A little hop, landing with a wobble.
      const p = (time / MOTE_PERIOD.cap) % 1;
      const h = Math.sin(Math.PI * Math.min(1, p / 0.45));
      _q.setFromAxisAngle(_x, 0.18 * Math.sin(p * Math.PI * 4) * (1 - h));
      return out.compose(_p.set(0, 3.2 * h, 0), _q, _s);
    }
    case "hammer": {
      // Up, then down onto the anvil.
      const p = (time / MOTE_PERIOD.hammer) % 1;
      const a = p < 0.65 ? 0.32 - 1.2 * smooth(p / 0.65) : -0.88 + 1.2 * smooth((p - 0.65) / 0.35);
      return out.makeRotationAxis(_z, a);
    }
    case "saw": {
      // To and fro across the board, a little down on each stroke.
      const w = Math.sin((time / MOTE_PERIOD.saw) * Math.PI * 2);
      return out.makeTranslation(0, -0.8 * Math.abs(w), 5 * w);
    }
  }
}

/** A mote's parts at rest, about its anchor (x along t, z along l, y up), each with its colour. */
function moteParts(kind: MoteKind): [BufferGeometry, string][] {
  switch (kind) {
    case "axe":
      // From the woodcutter's shoulder: a beech handle reaching +t, an iron head at its end.
      return [
        [new BoxGeometry(15, 1.3, 1.3).translate(7.5, 0, 0), "#c99a5b"],
        [new RoundedBoxGeometry(3, 5, 1.4, 1, 0.4).translate(15, -1, 0), "#8d9096"],
      ];
    case "pig":
      // Facing +x: a round pink body, a snout, two ears, a curl of tail; legs are stubs under it.
      return [
        [mergeGeometries([new RoundedBoxGeometry(10, 6, 6, 2, 2.6).translate(0, 4.6, 0), new SphereGeometry(3.1, 10, 8).translate(5.2, 5.6, 0)].map(nonIndexed))!, "#f2a7b5"],
        [
          mergeGeometries(
            [
              new CylinderGeometry(1.5, 1.5, 1.4, 10).rotateZ(Math.PI / 2).translate(8.6, 5.2, 0),
              new BoxGeometry(1.4, 1.8, 1.4).translate(5, 8.6, 1.6),
              new BoxGeometry(1.4, 1.8, 1.4).translate(5, 8.6, -1.6),
              new SphereGeometry(0.9, 6, 4).translate(-5.3, 6.4, 0),
              ...[-3, 3].flatMap((x) => [-1.8, 1.8].map((z) => new CylinderGeometry(0.9, 0.9, 2, 6).translate(x, 1, z))),
            ].map(nonIndexed),
          )!,
          "#e5899f",
        ],
      ];
    case "tub":
      // An iron box on four wheels, heaped with stone (as the quarry's dressing drew it, now on the move).
      return [
        [new RoundedBoxGeometry(18, 9, 12, 1, 1.5).translate(0, 9, 0), "#4f6f8f"],
        [mergeGeometries([-6, 6].flatMap((dt) => [-1, 1].map((s) => nonIndexed(new CylinderGeometry(2.6, 2.6, 1.6, 10).rotateX(Math.PI / 2).translate(dt, 4, s * 5.4)))))!, "#2f2f33"],
        [
          mergeGeometries(
            ([[-4, -2, 3.2], [3, 2, 3.6], [0, -1, 2.8]] as const).map(([dt, dl, r]) => nonIndexed(new DodecahedronGeometry(r, 0).translate(dt, 14, dl))),
          )!,
          "#c6c3ba",
        ],
      ];
    case "cap":
      // A toy chimney hat: a yellow disc with a little cone on it (bright against the brick).
      return [[mergeGeometries([new CylinderGeometry(5.6, 5.6, 1.4, 14).translate(0, 0.7, 0), new CylinderGeometry(0.8, 4.2, 3.4, 14).translate(0, 3.1, 0)].map(nonIndexed))!, "#e6b52c"]];
    case "hammer":
      // From the smith's shoulder: a handle reaching −t, a head at its end.
      return [
        [new BoxGeometry(11, 1.2, 1.2).translate(-5.5, 0, 0), "#c99a5b"],
        [new RoundedBoxGeometry(2.6, 4.4, 3, 1, 0.4).translate(-11, 0, 0), "#3a3a3e"],
      ];
    case "saw":
      // A hand saw across the board (along l), its handle out to the yard side.
      return [
        [new BoxGeometry(0.5, 4.4, 14).translate(0, 2.2, 0), "#c9ccd2"],
        [new RoundedBoxGeometry(1.6, 4.6, 4, 1, 0.5).translate(0, 3, 9), "#c8442f"],
      ];
  }
}

/** What stands still beside a yard's motes (the pen, the woodcutter, the smith), drawn with its static parts. */
export function moteStatics(role: DepotRole, add: PlaceFn, mats: Materials, living: boolean): void {
  if (!living) return;
  if (role === "farm") {
    // The pen: white posts and two rails round it.
    const paint = mats.lacquer("#f0ebe0");
    const { t0, t1, l0, l1 } = PEN;
    for (const t of [t0, (t0 + t1) / 2, t1]) for (const l of [l0, l1]) add(paint, new BoxGeometry(1.8, 9, 1.8), t, l, PAD_H + 4.5);
    for (const t of [t0, t1]) add(paint, new BoxGeometry(1.8, 9, 1.8), t, (l0 + l1) / 2, PAD_H + 4.5);
    for (const y of [3.5, 7.5]) {
      for (const l of [l0, l1]) add(paint, new BoxGeometry(t1 - t0, 1.2, 0.9), (t0 + t1) / 2, l, PAD_H + y);
      for (const t of [t0, t1]) add(paint, new BoxGeometry(0.9, 1.2, l1 - l0), t, (l0 + l1) / 2, PAD_H + y);
    }
    // A trough.
    add(mats.lacquer("#8a5a33"), new RoundedBoxGeometry(10, 3, 4, 1, 0.8), t0 + 7, l1 - 4, PAD_H + 1.5);
  }
  if (role === "forest") pegDoll(add, mats, 144, 87.5, "#3c8f4e", "#c8442f");
  if (role === "smithy") pegDoll(add, mats, 150, 76, "#5a524a", "#2a2b2e");
}

/** A peg-doll worker standing at t, l: a turned body in its colour, a beech head, a hat. */
function pegDoll(add: PlaceFn, mats: Materials, t: number, l: number, coat: string, hat: string): void {
  add(mats.lacquer(coat), new CylinderGeometry(2.6, 3.4, 12, 12), t, l, PAD_H + 6);
  add(mats.lacquer("#e8c39e"), new SphereGeometry(3, 12, 10), t, l, PAD_H + 15);
  add(mats.lacquer(hat), new CylinderGeometry(2.4, 3.2, 2.4, 12), t, l, PAD_H + 18);
}

/** A yard's motes at rest, drawn with its static parts: for a still picture of it (the piece in a hand, the tray's). */
export function bakeMotes(role: DepotRole, add: PlaceFn, mats: Materials, living: boolean): void {
  const m = new Matrix4();
  for (const spec of INDUSTRY_MOTES[role] ?? []) {
    if (spec.living && !living) continue;
    moteMatrix(spec.kind, spec.offset ?? 0, m);
    for (const [g, colour] of moteParts(spec.kind)) add(mats.lacquer(colour), g.applyMatrix4(m), spec.t, spec.l, spec.y);
  }
}

/** One mote placed at a site: its kind's meshes, its instance, its anchor in the world, its clock offset. */
interface Placed {
  readonly kind: MoteKind;
  readonly meshes: InstancedMesh[];
  readonly index: number;
  readonly anchor: Matrix4;
  readonly offset: number;
}

const _m = new Matrix4();
const _w = new Matrix4();

/**
 * Every industry's motes as instances: one `InstancedMesh` per mote kind and colour, for the whole map. `place` them
 * for a world's sites; `pose` a site's at a time (only while it works and is in view); `flush` once a frame if any
 * moved.
 */
export class IndustryMotes {
  readonly group = new Group();
  private meshes = new Map<MoteKind, InstancedMesh[]>();
  private dirty = new Set<InstancedMesh>();

  constructor(private readonly mats: Materials) {}

  /**
   * Make the instances for a world: for each site (its role and pose), the handles of its motes (none: an empty list).
   * Each starts at rest. `heading` turns the depot frame as `DepotView` does (t along `heading`).
   */
  place(sites: readonly { role: DepotRole; x: number; y: number; z: number; heading: number }[]): Placed[][] {
    for (const list of this.meshes.values()) for (const mesh of list) mesh.dispose();
    this.group.clear();
    this.meshes.clear();
    this.dirty.clear();
    const count = new Map<MoteKind, number>();
    for (const s of sites) for (const spec of INDUSTRY_MOTES[s.role] ?? []) count.set(spec.kind, (count.get(spec.kind) ?? 0) + 1);
    for (const [kind, n] of count) {
      const list = moteParts(kind).map(([g, colour]) => {
        const mesh = new InstancedMesh(g, this.mats.lacquer(colour), n);
        mesh.count = 0;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        // (Culled by a sphere round all its instances, set below: skipped when none is in view.)
        mesh.frustumCulled = false;
        mesh.userData.mote = kind;
        this.group.add(mesh);
        return mesh;
      });
      this.meshes.set(kind, list);
    }
    const placed = sites.map((s) => {
      const c = Math.cos(s.heading);
      const sn = Math.sin(s.heading);
      return (INDUSTRY_MOTES[s.role] ?? []).map((spec) => {
        const meshes = this.meshes.get(spec.kind)!;
        const index = meshes[0].count;
        for (const mesh of meshes) mesh.count++;
        const anchor = new Matrix4().makeRotationY(-s.heading).setPosition(s.x + c * spec.t - sn * spec.l, s.y + spec.y, s.z + sn * spec.t + c * spec.l);
        // Each industry's own place in the loop, from where it stands (and the mote's own offset).
        const offset = (spec.offset ?? 0) + (((Math.abs(Math.round(s.x * 0.37 + s.z * 0.61)) % 997) / 997) * MOTE_PERIOD[spec.kind]);
        const placed: Placed = { kind: spec.kind, meshes, index, anchor, offset };
        this.pose(placed, 0);
        return placed;
      });
    });
    // Drawn only when one of its instances may be in view (or casting a shadow into it): a sphere round them all, as
    // they stand, and as far again as any moves from its rest.
    for (const list of this.meshes.values())
      for (const mesh of list) {
        mesh.computeBoundingSphere();
        mesh.boundingSphere!.radius += MOTE_ROAM;
        mesh.frustumCulled = true;
      }
    return placed;
  }

  /** Pose one mote at game time `time`. */
  pose(p: Placed, time: number): void {
    moteMatrix(p.kind, time + p.offset, _m);
    _w.multiplyMatrices(p.anchor, _m);
    for (const mesh of p.meshes) {
      mesh.setMatrixAt(p.index, _w);
      this.dirty.add(mesh);
    }
  }

  /** Send the posed instances to the GPU (once a frame, only if something moved). */
  flush(): void {
    if (this.dirty.size === 0) return;
    for (const mesh of this.dirty) mesh.instanceMatrix.needsUpdate = true;
    this.dirty.clear();
  }

  /** Instances in use, by kind (for tests). */
  counts(): Partial<Record<MoteKind, number>> {
    return Object.fromEntries([...this.meshes].map(([k, list]) => [k, list[0].count]));
  }

  /** A mote's world matrix now (for tests). */
  matrixOf(p: Placed, out: Matrix4): Matrix4 {
    p.meshes[0].getMatrixAt(p.index, out);
    return out;
  }
}

export type MoteHandle = Placed;

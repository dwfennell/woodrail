import { BoxGeometry, ConeGeometry, CylinderGeometry, Group, InstancedMesh, Matrix4, Mesh, Object3D, Plane, Quaternion, Vector3, type Ray, type BufferGeometry, type Material } from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { CARGO, CARGO_KINDS, WAGON_CAPACITY, type CargoKind, type CargoSlot, type CraneMove, type DepotRole, type DepotState, type Economy } from "../economy";
import type { Layout, Pose } from "../track";
import { kitOf, TRACK_WIDTH } from "../track";
import { STATION_CRANE_AT } from "../game/world";
import { BUNDLE_HEIGHT, BUNDLE_LENGTH, BUNDLE_WIDTH, CRATE_HEIGHT, LOG_LENGTH, LOG_RADIUS, pileSlot, SACK_HEIGHT, SACK_LENGTH, SACK_WIDTH, STONE_HEIGHT, TOOLBOX_PITCH, unitSize, wagonSlot } from "./cargo-layout";
import { addPart, hasPart, partPieces } from "./blender-models";
import { Batcher } from "./dressing/batcher";
import { setCullBox, tileAt } from "./dressing/tiles";
import type { Materials } from "./materials";
import { TIMBER_DECK } from "./train-models";
import { dressIndustry, PAD_H, PALLET_H, pallet } from "./industry-dressing";
import { nonIndexed } from "./non-indexed";

/** A pile's place in depot coordinates: `t` along the depot track from its socket end, `l` across (yard side +). */
interface PileSpot {
  t: number;
  l: number;
  /** Ground height under the pile. */
  y: number;
  across: number;
  /** Units lie along the track (t) or across it (l). */
  axis: "t" | "l";
  /** Rows of units end to end along their length, before they stack (default 1): a lower, wider pile. */
  rows?: number;
  /** Draw at most this many (a warehouse's piles hold more than look right stacked). */
  show?: number;
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
/** Where a yard's piles stand: on their pallets, on the pad. */
const YARD = PAD_H + PALLET_H;

/** A kit piece's depot (a Sandbox loader or unloader): nothing of its own drawn here, its kit's model does that. */
const KIT_DEPOT: DepotLayout = { pad: null, crane: { kind: "jib", t: 108, l: 40, height: 72 }, piles: {}, trackT: 108 };

/** Where everything stands at each kind of depot (depot coordinates; see PileSpot). */
export const DEPOT_LAYOUT: Record<DepotRole, DepotLayout> = {
  forest: {
    pad: { t: 108, l: 72, w: 196, d: 84 },
    // Crane arms that swing over the track clear the engine's chimney (63 mm).
    crane: { kind: "jib", t: 108, l: 40, height: 72 },
    piles: { log: { t: 108, l: 82, y: YARD, across: 4, axis: "t" } },
    trackT: 108,
  },
  sawmill: {
    pad: { t: 108, l: 72, w: 196, d: 84 },
    crane: { kind: "gantry", t: 108, l: 45, height: 66 },
    piles: {
      log: { t: 108, l: 52, y: YARD, across: 3, axis: "t" },
      planks: { t: 108, l: 96, y: YARD, across: 2, axis: "t" },
    },
    trackT: 108,
  },
  workshop: {
    pad: { t: 108, l: 72, w: 196, d: 84 },
    crane: { kind: "jib", t: 60, l: 40, height: 72 },
    // (Its yard holds up to WORKSHOP_CAP: the pile shows as many as it always has.)
    piles: { planks: { t: 60, l: 84, y: YARD, across: 2, axis: "t", show: 12 } },
    trackT: 60,
  },
  // The farm chain: a farm yard (grain from the fields) and a mill (grain into flour), laid out like the others.
  farm: {
    pad: { t: 108, l: 72, w: 196, d: 84 },
    crane: { kind: "jib", t: 108, l: 40, height: 72 },
    piles: { grain: { t: 100, l: 76, y: YARD, across: 3, rows: 2, axis: "t" } },
    trackT: 108,
  },
  warehouse: {
    pad: { t: 108, l: 72, w: 196, d: 84 },
    crane: { kind: "jib", t: 60, l: 40, height: 72 },
    // A pile of each good in a row along the track, each one unit wide (a warehouse holds 24 of each).
    piles: {
      log: { t: 24, l: 58, y: YARD, across: 1, axis: "l", show: 6 },
      planks: { t: 42, l: 58, y: YARD, across: 1, axis: "l", show: 6 },
      grain: { t: 60, l: 62, y: YARD, across: 1, axis: "l", show: 6 },
      flour: { t: 76, l: 62, y: YARD, across: 1, axis: "l", show: 6 },
      stone: { t: 92, l: 62, y: YARD, across: 1, axis: "l", show: 6 },
    },
    trackT: 60,
  },
  quarry: {
    pad: { t: 108, l: 72, w: 196, d: 84 },
    crane: { kind: "gantry", t: 108, l: 45, height: 66 },
    piles: { stone: { t: 105, l: 67, y: YARD, across: 3, rows: 2, axis: "t" } },
    trackT: 108,
  },
  // Mining and iron (Phase C): a mine's coal and ore piles under a gantry; a foundry's inputs and its iron.
  mine: {
    pad: { t: 108, l: 72, w: 196, d: 84 },
    crane: { kind: "gantry", t: 108, l: 45, height: 66 },
    piles: {
      coal: { t: 92, l: 60, y: YARD, across: 2, rows: 2, axis: "t" },
      ore: { t: 124, l: 60, y: YARD, across: 2, rows: 2, axis: "t" },
    },
    trackT: 108,
  },
  foundry: {
    pad: { t: 108, l: 72, w: 196, d: 84 },
    crane: { kind: "gantry", t: 60, l: 45, height: 66 },
    piles: {
      coal: { t: 44, l: 60, y: YARD, across: 2, rows: 2, axis: "t" },
      ore: { t: 76, l: 60, y: YARD, across: 2, rows: 2, axis: "t" },
      iron: { t: 34, l: 96, y: YARD, across: 2, axis: "t" },
    },
    trackT: 60,
  },
  // Made goods and power (Phase C): the carpenter's planks and furniture, the smithy's iron and tools, the power
  // station's coal.
  carpenter: {
    pad: { t: 108, l: 72, w: 196, d: 84 },
    crane: { kind: "jib", t: 60, l: 40, height: 72 },
    piles: {
      planks: { t: 44, l: 66, y: YARD, across: 2, axis: "t" },
      furniture: { t: 80, l: 64, y: YARD, across: 2, rows: 2, axis: "t" },
    },
    trackT: 60,
  },
  smithy: {
    pad: { t: 108, l: 72, w: 196, d: 84 },
    crane: { kind: "jib", t: 60, l: 40, height: 72 },
    piles: {
      iron: { t: 40, l: 66, y: YARD, across: 2, axis: "t" },
      tools: { t: 80, l: 64, y: YARD, across: 2, rows: 2, axis: "t" },
    },
    trackT: 60,
  },
  power: {
    pad: { t: 108, l: 72, w: 196, d: 84 },
    crane: { kind: "gantry", t: 60, l: 45, height: 66 },
    piles: { coal: { t: 60, l: 62, y: YARD, across: 3, rows: 2, axis: "t" } },
    trackT: 60,
  },
  // A harbour (Phase D): a pile of each good along the quay, waiting for the boats; the water is past the yard's far
  // side (l > 114), where the boats tie up.
  // A school (Game mode's research): goods are set down at its door and go into the research (it keeps no piles: one
  // drop spot for every good, no pallets). The schoolhouse stands at the far end of the yard.
  school: {
    pad: { t: 108, l: 72, w: 196, d: 84 },
    crane: { kind: "jib", t: 60, l: 40, height: 72 },
    piles: Object.fromEntries(CARGO_KINDS.map((k) => [k, { t: 60, l: 80, y: PAD_H, across: 1, axis: "t", show: 0 }])),
    trackT: 60,
  },
  harbour: {
    pad: { t: 108, l: 72, w: 196, d: 84 },
    crane: { kind: "jib", t: 60, l: 40, height: 72 },
    piles: Object.fromEntries(CARGO_KINDS.map((k, i) => [k, { t: 22 + i * 17.5, l: 62, y: YARD, across: 1, axis: "l", show: 4 }])),
    trackT: 60,
  },
  mill: {
    pad: { t: 108, l: 72, w: 196, d: 84 },
    // The gantry spans the piles at the near end; the windmill stands at the far end (t 160).
    crane: { kind: "gantry", t: 60, l: 45, height: 66 },
    piles: {
      grain: { t: 60, l: 65, y: YARD, across: 3, rows: 2, axis: "t" },
      flour: { t: 60, l: 98, y: YARD, across: 2, rows: 2, axis: "t" },
    },
    trackT: 60,
  },
  town: {
    pad: null,
    // Above the chimney, below the station canopy (76 mm).
    crane: { kind: "jib", t: 46, l: SIDE + 12, height: 66 },
    // On the platform's goods corner, bundles lying across it.
    piles: {
      planks: { t: 20.5, l: SIDE + 23, y: 14, across: 2, axis: "l" },
      // Flour sacks beside the planks, short of the crane's mast.
      flour: { t: 34, l: SIDE + 23, y: 14, across: 2, axis: "l" },
      // Stone past the crane's mast.
      stone: { t: 57, l: SIDE + 23, y: 14, across: 2, axis: "l" },
    },
    trackT: STATION_CRANE_AT,
  },
  // Sandbox's cargo machines are kit pieces: their models do the drawing (KitView), not this view (see `setWorld`).
  "loader-log": KIT_DEPOT,
  "loader-grain": KIT_DEPOT,
  "loader-coal": KIT_DEPOT,
  "loader-planks": KIT_DEPOT,
  unloader: KIT_DEPOT,
};

/** Each industry's buildings as a Blender part (tools/blender/dressing.py), with its colours. */
/**
 * Where an upgrade's machine stands in its yard (depot frame: t along the track, l out from it), for Game mode's
 * upgrades (Harvesters II and the like; models in dressing.glb, from Asset Gen).
 */
/** Goods a hopper carries as a heap in its bin. */
const HEAP_KINDS = ["grain", "stone", "coal", "ore"] as const;
type HeapKind = (typeof HEAP_KINDS)[number];
const isHeap = (k: CargoKind | null): k is HeapKind => (HEAP_KINDS as readonly string[]).includes(k ?? "");

const UPGRADE_SPOTS: Record<string, { t: number; l: number; turn?: number }> = {
  // Forest yard: the free end beyond the hut's far side, booms reaching away from the track (turned so the model's +x
  // runs out across the yard), clear of the log pile and the jib.
  "upgrade-log-loader": { t: 40, l: 66, turn: -Math.PI / 2 },
  "upgrade-steam-log-crane": { t: 40, l: 66, turn: -Math.PI / 2 },
  // Sawmill: the far end, past the plank pile and the gantry.
  "upgrade-saw-bench": { t: 176, l: 72 },
  "upgrade-steam-saw-house": { t: 172, l: 92 },
  // Farm yard: the open ground between the grain pile and the barn, off the crop beds.
  "upgrade-tractor": { t: 136, l: 46 },
  // Mill: beside the flour sacks, between the piles and the windmill.
  "upgrade-millstones": { t: 112, l: 96 },
  // Quarry: between the tool shed and the stone pile, its chute toward the track.
  "upgrade-stone-crusher": { t: 68, l: 92 },
};

const INDUSTRY_MODELS: Partial<Record<DepotRole, { part: string; slots: Record<string, string> }>> = {
  workshop: { part: "industry-workshop", slots: { roof: "#2f6db5", doors: "#c8442f", sign: "#e6b52c" } },
  sawmill: { part: "industry-sawmill-shed", slots: { roof: "#c8442f" } },
  forest: { part: "industry-forest-hut", slots: { roof: "#3c8f4e" } },
  farm: { part: "industry-farm", slots: { silo: "#f0ebe0", roof: "#c8442f" } },
  mill: { part: "industry-mill", slots: { cap: "#2f6db5" } },
  quarry: { part: "industry-quarry", slots: { roof: "#c8442f" } },
  // (In the goods-shed kit's look and colours, bldg-goods-shed: no slots.)
  warehouse: { part: "industry-warehouse", slots: {} },
  mine: { part: "industry-mine", slots: {} },
  carpenter: { part: "industry-carpenter", slots: {} },
  smithy: { part: "industry-smithy", slots: {} },
  power: { part: "industry-power", slots: {} },
  harbour: { part: "industry-harbour", slots: { roof: "#2f6fb0" } },
  foundry: { part: "industry-foundry", slots: {} },
};

/** Where a hopper's grain heap sits (car-local y): the top of its bin (Asset Gen: hopper-classic). */
const HOPPER_HEAP = 43;
/** A unit of grain lifted to or from a hopper is held about here (car-local y). */
const HOPPER_LOAD = HOPPER_HEAP + 2;

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

/**
 * A town station's whole footprint in its own frame (t along the 216 mm piece, l across): the canopy over the track,
 * the platform, and the station house behind it.
 */
const STATION_T = 216;
const STATION_L_MIN = -(TRACK_WIDTH / 2 + 6);
const STATION_L_MAX = TRACK_WIDTH / 2 + 73;
/** Height (mm above the piece) the tap ray is tested at: between the platform (14) and the canopy (76). */
const STATION_TAP_Y = 45;

/** Is a ground point on a town station at `pose`, or within `margin` mm of its footprint? */
export function inStationFootprint(pose: Pose, x: number, z: number, margin: number): boolean {
  const c = Math.cos(pose.heading);
  const s = Math.sin(pose.heading);
  const dx = x - pose.x;
  const dz = z - pose.z;
  const t = c * dx + s * dz;
  const l = -s * dx + c * dz;
  return t >= -margin && t <= STATION_T + margin && l >= STATION_L_MIN - margin && l <= STATION_L_MAX + margin;
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
  /** What turns while it works: a sawmill's saw, a mill's sails. */
  blade: Object3D | null;
  /** This frame's crane move (scratch, reused), and whether there is one. */
  readonly move: CraneMove;
  moving: boolean;
  /** Its piles as last drawn (a signature of their counts), so a change is drawn only if it's in view. */
  piles: number;
  /** Picking owners for this depot's piles, made once. */
  readonly pileOwners: Record<CargoKind, CargoSlot>;
}

/** One kind of goods as drawn: its parts (instanced, a unit per instance), who each drawn unit belongs to, and the copy a crane or a hand carries. */
interface UnitMeshes {
  readonly parts: InstancedMesh[];
  readonly owners: CargoSlot[];
  readonly carried: Group;
  /** Units drawn so far this frame. */
  n: number;
}
const ease = (x: number) => x * x * (3 - 2 * x);

const _m = new Matrix4();
const _q = new Quaternion();
const _v = new Vector3();
const _a = new Vector3();
const _b = new Vector3();
const _s = new Vector3(1, 1, 1);
const _up = new Vector3(0, 1, 0);
const _plane = new Plane();

/**
 * Depots as toys: the static yards, sheds and cranes (batched), the moving crane parts, the piles, and the cargo
 * riding on every timber wagon. Updated every frame from the economy.
 */
export class DepotView {
  readonly group = new Group();
  private sites: Site[] = [];
  /** Each kind of goods' meshes (logs, plank bundles, sacks). */
  private units!: Record<CargoKind, UnitMeshes>;
  /** Heaps in hoppers (one per loaded hopper), by what they hold. */
  private heaps!: Record<HeapKind, UnitMeshes>;
  /** Every kind's meshes and the heaps, to loop over without allocating. */
  private allUnits: UnitMeshes[] = [];
  private static readonly MAX_UNITS = 2048;
  /** A unit being carried by hand: one fewer is drawn at its source. */
  dragging: CargoSlot | null = null;
  /** Picking owners for wagon loads by car id, made once per car. */
  private readonly carOwners = new Map<number, CargoSlot>();
  private cargoMeshes: InstancedMesh[] = [];
  /** The game time (s) at the last `update`: what turns, turns by the game time gone since. */
  private simSeen = -1;
  /** The wagon loads as last drawn (a signature: cars, kinds, counts). */
  private wagonsSeen = -1;

  constructor(private readonly mats: Materials) {
    this.rebuildUnits();
  }

  /**
   * (Re)make the goods' and heaps' meshes from the parts loaded now: the modelled sacks, blocks, loads and heaps where
   * they're in, stand-ins where not. Call again once Game mode's parts arrive (`loadGameModels`), then `setWorld`.
   */
  rebuildUnits(): void {
    const mats = this.mats;
    for (const u of this.allUnits) {
      for (const m of u.parts) {
        this.group.remove(m);
        m.dispose();
      }
      if (u.carried.parent) this.group.remove(u.carried);
    }
    const log = new CylinderGeometry(LOG_RADIUS, LOG_RADIUS, LOG_LENGTH, 14).rotateZ(Math.PI / 2);
    const boards = mergeGeometries(
      [0, 1, 2].map((k) => nonIndexed(new RoundedBoxGeometry(BUNDLE_LENGTH, BUNDLE_HEIGHT / 3 - 0.3, BUNDLE_WIDTH, 1, 0.5).translate(0, -BUNDLE_HEIGHT / 3 + (k * BUNDLE_HEIGHT) / 3, 0))),
    )!;
    const strap = new BoxGeometry(2.4, BUNDLE_HEIGHT + 0.4, BUNDLE_WIDTH + 0.4);
    const logMat = mats.lacquer("#a8743f");
    const strapMat = mats.lacquer("#c8442f");
    // A sack (grain golden, flour white) with a tie at its neck; stand-ins until the models come.
    const sack = new RoundedBoxGeometry(SACK_LENGTH, SACK_HEIGHT, SACK_WIDTH, 2, 2.4);
    const tie = new CylinderGeometry(1.6, 2.2, 2.4, 10).rotateZ(Math.PI / 2).translate(SACK_LENGTH / 2 + 0.6, 0, 0);
    // Coal and ore: lumps in a little heap; iron: bars in a bundle (stand-ins until the models come).
    const lumps = (color: string): [BufferGeometry, Material][] => [[new RoundedBoxGeometry(SACK_LENGTH, STONE_HEIGHT, SACK_WIDTH, 2, 3.2), mats.lacquer(color)]];
    const bars = mergeGeometries([0, 1, 2].map((k) => nonIndexed(new RoundedBoxGeometry(SACK_LENGTH, STONE_HEIGHT / 2 - 0.3, SACK_WIDTH / 3 - 0.4, 1, 0.5).translate(0, -STONE_HEIGHT / 4, (k - 1) * (SACK_WIDTH / 3)))).concat([nonIndexed(new RoundedBoxGeometry(SACK_LENGTH * 0.9, STONE_HEIGHT / 2 - 0.3, SACK_WIDTH / 2, 1, 0.5).translate(0, STONE_HEIGHT / 4, 0))]))!;
    const looks: Record<Exclude<CargoKind, "stone">, [BufferGeometry, Material][]> & { stone?: [BufferGeometry, Material][] } = {
      coal: hasPart("load-coal") ? partPieces(mats, "load-coal").map(([g, m]) => [g.translate(0, -STONE_HEIGHT / 2, 0), m]) : lumps("#2a2b2e"),
      ore: hasPart("load-ore") ? partPieces(mats, "load-ore").map(([g, m]) => [g.translate(0, -STONE_HEIGHT / 2, 0), m]) : lumps("#9a4f2c"),
      furniture: hasPart("load-furniture") ? partPieces(mats, "load-furniture").map(([g, m]) => [g.translate(0, -CRATE_HEIGHT / 2, 0), m]) : [[sack, mats.lacquer("#a0612e")], [tie, strapMat]],
      tools: hasPart("load-tools") ? partPieces(mats, "load-tools").map(([g, m]) => [g.translate(0, -TOOLBOX_PITCH / 2, 0), m]) : [[sack, mats.lacquer("#8a5a2b")], [tie, mats.lacquer("#7d8a98")]],
      iron: hasPart("load-iron") ? partPieces(mats, "load-iron").map(([g, m]) => [g.translate(0, -7.5 / 2, 0), m]) : [[bars, mats.lacquer("#7d8a98")]],
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
    // The modelled sack when it's loaded (its base at y 0: units are placed by their centre).
    if (hasPart("load-flour-sack")) looks.flour = partPieces(mats, "load-flour-sack").map(([g, m]) => [g.translate(0, -SACK_HEIGHT / 2, 0), m]);
    // Cut stone: grey blocks (the modelled block when it's loaded).
    looks.stone = hasPart("load-stone-block")
      ? partPieces(mats, "load-stone-block").map(([g, m]) => [g.translate(0, -STONE_HEIGHT / 2, 0), m])
      : [[new RoundedBoxGeometry(SACK_LENGTH, STONE_HEIGHT, SACK_WIDTH, 2, 1.6), mats.lacquer("#b9b4aa")]];
    // A hopper's load: one heap filling its bin, raised by how full it is (in place of the coal it's modelled with).
    const heapOf = (part: string, color: string): [BufferGeometry, Material][] =>
      hasPart(part) ? partPieces(mats, part) : [[new RoundedBoxGeometry(59, 8, 25, 2, 3).translate(0, 4, 0), mats.lacquer(color)]];
    const heapUnit = (looksOf: [BufferGeometry, Material][]): UnitMeshes => {
      const parts = looksOf.map(([g, m]) => this.instanced(g, m));
      this.group.add(...parts);
      return { parts, owners: [], carried: new Group(), n: 0 };
    };
    this.heaps = {
      grain: heapUnit(heapOf("load-grain-heap", "#d9a441")),
      stone: heapUnit(heapOf("load-stone-heap", "#a9a49a")),
      coal: heapUnit(heapOf("load-coal-heap", "#2a2b2e")),
      ore: heapUnit(heapOf("load-ore-heap", "#9a4f2c")),
    };
    const units = {} as Record<CargoKind, UnitMeshes>;
    for (const kind of CARGO_KINDS) {
      const look = looks[kind]!;
      const parts = look.map(([g, m]) => this.instanced(g, m));
      this.group.add(...parts);
      // The unit on the crane hook (one of each kind, shown as needed).
      const carried = new Group().add(...look.map(([g, m]) => new Mesh(g, m)));
      carried.traverse((o) => (o.castShadow = true));
      carried.visible = false;
      this.group.add(carried);
      units[kind] = { parts, owners: [], carried, n: 0 };
    }
    this.units = units;
    this.allUnits = [...CARGO_KINDS.map((k) => units[k]), ...HEAP_KINDS.map((k) => this.heaps[k])];
    this.cargoMeshes = this.allUnits.flatMap((u) => u.parts);
  }

  private instanced(g: BufferGeometry, m: Material): InstancedMesh {
    const mesh = new InstancedMesh(g, m, DepotView.MAX_UNITS);
    mesh.count = 0;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    return mesh;
  }

  /**
   * Extra machines in a kind of yard (Game mode's upgrades: part ids from `UPGRADE_SPOTS`). Null: none. Set it, then
   * `setWorld` to draw them.
   */
  extras: ((role: DepotRole) => readonly string[]) | null = null;

  /**
   * A catalogue building for a yard (Game mode: a school's schoolhouse, or the college or library it grew into with its
   * town), as baked parts in its own frame, drawn at `scale` (1 if none) so it fits the yard; null or none: a stand-in
   * is drawn. `depot` is the yard's (only `role` for the held piece's model). Set it, then `setWorld` to draw it.
   */
  building: ((role: DepotRole, depot?: DepotState) => { parts: readonly { geometry: BufferGeometry; material: Material }[]; scale?: number } | null | undefined) | null = null;

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
      // A depot piece being carried shows its buildings in the hand instead (see `model`). A kit piece's depot (a
      // Sandbox loader or unloader) is drawn by its kit's model, its own crane working (KitView).
      if (!piece || layout.isLifted(depot.pieceId) || kitOf(piece.type)) continue;
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
        piles: -1,
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
      if (depot.role === "mine") site.blade = this.buildWheel(pose, "industry-mine-wheel", 112, 96, 66);
      if (depot.role === "power") site.blade = this.buildWheel(pose, "industry-power-wheel", 112, 72, 22);
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
    // The yard: an industry's own ground and props, or the plain beech pad; then a pallet under each pile.
    const add = (m: Material, g: BufferGeometry, t: number, l: number, y: number) => b.add(m, place(g, t, l, y));
    if (layout.pad && !dressIndustry(site.depot.role, add, mats)) b.add(mats.blockWood, place(new RoundedBoxGeometry(layout.pad.w, PAD_H, layout.pad.d, 2, 1.5), layout.pad.t, layout.pad.l, PAD_H / 2));
    if (layout.pad && site.depot.role !== "school") {
      for (const kind of CARGO_KINDS) {
        const spot = layout.piles[kind];
        if (!spot) continue;
        const size = unitSize(kind);
        const len = size.x * (spot.rows ?? 1) + 0.6 * ((spot.rows ?? 1) - 1) + 3;
        const wide = spot.across * (size.z + 0.6) + 2.4;
        if (spot.axis === "t") pallet(add, mats, kind, spot.t, spot.l, len, wide);
        else pallet(add, mats, kind, spot.t, spot.l, wide, len);
      }
    }
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
    for (const id of this.extras?.(site.depot.role) ?? []) {
      const spot = UPGRADE_SPOTS[id];
      if (spot && hasPart(id)) addPart(b, mats, id, (g) => place(spot.turn ? g.rotateY(spot.turn) : g, spot.t, spot.l, PAD_H));
    }
    // A harbour's dock sheds along its quay (Asset Gen's shed, or a stand-in).
    for (let k = 0; k < (site.depot.role === "harbour" ? site.depot.sheds : 0); k++) {
      const t = 55 + k * 50;
      if (hasPart("industry-dock-shed")) addPart(b, mats, "industry-dock-shed", (g) => place(g, t, 100, PAD_H), { roof: "#7a5a3a", doors: "#2f6fb0" });
      else {
        b.add(mats.blockWood, place(new RoundedBoxGeometry(30, 18, 20, 2, 2), t, 100, PAD_H + 9));
        b.add(mats.lacquer("#7a5a3a"), place(new RoundedBoxGeometry(34, 3, 24, 1, 1.2), t, 100, PAD_H + 19));
      }
    }
    if (site.depot.role === "school") {
      // The school's building (the catalogue's model, when the game has it built: a schoolhouse, or the college or
      // library it grew into), its front to the track, at the yard's far end; else a stand-in.
      const house = this.building?.("school", site.depot.id === undefined ? undefined : site.depot);
      if (house) {
        const k = house.scale ?? 1;
        for (const p of house.parts) b.add(p.material, place(p.geometry.clone().scale(k, k, k).rotateY(Math.PI / 2), 150, 80, PAD_H));
        return;
      }
      b.add(mats.lacquer("#e6b52c"), place(new RoundedBoxGeometry(70, 34, 40, 2, 3), 150, 84, PAD_H + 17));
      for (const side of [-1, 1]) {
        const slope = new RoundedBoxGeometry(76, 4, 26, 1, 1.5);
        slope.translate(0, 0, (side * 22) / 2);
        slope.rotateX(side * 0.45);
        b.add(mats.lacquer("#c8442f"), place(slope, 150, 84, PAD_H + 40));
      }
      b.add(mats.blockWood, place(new RoundedBoxGeometry(12, 14, 12, 1, 1.5), 150, 84, PAD_H + 52));
      b.add(mats.lacquer("#2f6db5"), place(new RoundedBoxGeometry(14, 22, 3, 1, 1), 150, 63.5, PAD_H + 11));
      return;
    }
    const model = INDUSTRY_MODELS[site.depot.role];
    if (model && hasPart(model.part)) {
      // The industry's buildings, modelled in Blender in this depot frame (tools/blender/dressing.py, "Industries").
      addPart(b, mats, model.part, (g) => g.rotateY(-pose.heading).translate(pose.x, pose.y ?? 0, pose.z), model.slots);
      // The harbour's derrick: its jib reaches out over the water (a part of its own, so it could swing one day).
      if (site.depot.role === "harbour" && hasPart("industry-harbour-jib")) addPart(b, mats, "industry-harbour-jib", (g) => place(g, 199, 105, 62));
      return;
    }
    // Stand-ins drawn from code (unit tests, where the models aren't loaded).
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
    if (site.depot.role === "warehouse") {
      // A brown goods shed with a red roof and a loading dock toward the track, at the far end of the yard.
      b.add(mats.lacquer("#7a4a2a"), place(new RoundedBoxGeometry(90, 38, 40, 2, 3), 154, 92, PAD_H + 19));
      b.add(mats.lacquer("#c8442f"), place(new RoundedBoxGeometry(95, 5, 45, 1, 2), 154, 92, PAD_H + 40));
      b.add(mats.naturalWood, place(new RoundedBoxGeometry(100, 12, 18, 1, 1.2), 154, 62, PAD_H + 6));
    }
    if (site.depot.role === "quarry") {
      // A rock face of grey blocks stepping up at the far side of the yard.
      for (const [t, l, w, h] of [[140, 104, 40, 30], [178, 104, 36, 46], [160, 96, 30, 16]] as const) b.add(mats.lacquer("#a9a49a"), place(new RoundedBoxGeometry(w, h, 18, 2, 3), t, l, PAD_H + h / 2));
    }
    if (site.depot.role === "mine") {
      // A winding tower (two posts and a wheel) over the shaft, and an engine house with a chimney.
      for (const l of [86, 106]) b.add(mats.lacquer("#5a4a3a"), place(new RoundedBoxGeometry(4, 70, 4, 1, 1), 172, l, PAD_H + 35));
      b.add(mats.lacquer("#c8442f"), place(new CylinderGeometry(12, 12, 3, 20).rotateX(Math.PI / 2), 172, 96, PAD_H + 70));
      b.add(mats.blockWood, place(new RoundedBoxGeometry(34, 26, 26, 2, 2.5), 136, 98, PAD_H + 13));
      b.add(mats.lacquer("#8a4b3a"), place(new CylinderGeometry(3.5, 4, 30, 10), 128, 104, PAD_H + 41));
    }
    if (site.depot.role === "foundry") {
      // A brick furnace with a tall chimney and a casting shed.
      b.add(mats.lacquer("#9a4f3a"), place(new RoundedBoxGeometry(36, 34, 30, 2, 3), 160, 96, PAD_H + 17));
      b.add(mats.lacquer("#7a3f30"), place(new CylinderGeometry(4.5, 5.5, 60, 12), 172, 104, PAD_H + 50));
      b.add(mats.lacquer("#ffb347"), place(new RoundedBoxGeometry(10, 8, 2, 1, 0.8), 160, 80.5, PAD_H + 10));
      b.add(mats.blockWood, place(new RoundedBoxGeometry(40, 24, 26, 2, 2.5), 116, 100, PAD_H + 12));
    }
    if (site.depot.role === "carpenter") {
      // A workshop shed with a red roof, a bench out front.
      b.add(mats.blockWood, place(new RoundedBoxGeometry(60, 30, 30, 2, 3), 160, 96, PAD_H + 15));
      b.add(mats.lacquer("#c8442f"), place(new RoundedBoxGeometry(66, 4, 36, 1, 1.5), 160, 96, PAD_H + 32));
      b.add(mats.naturalWood, place(new RoundedBoxGeometry(24, 10, 10, 1, 1), 124, 76, PAD_H + 5));
    }
    if (site.depot.role === "smithy") {
      // A stone forge with a chimney and a glowing hearth; an anvil.
      b.add(mats.lacquer("#8f8a80"), place(new RoundedBoxGeometry(40, 28, 30, 2, 3), 160, 96, PAD_H + 14));
      b.add(mats.lacquer("#5a524a"), place(new CylinderGeometry(4, 5, 34, 10), 174, 104, PAD_H + 40));
      b.add(mats.lacquer("#ffb347"), place(new RoundedBoxGeometry(12, 8, 2, 1, 0.8), 156, 80.5, PAD_H + 9));
      b.add(mats.lacquer("#3a3a3e"), place(new RoundedBoxGeometry(12, 8, 6, 1, 1), 124, 80, PAD_H + 4));
    }
    if (site.depot.role === "harbour") {
      // Timber quay edging along the water side, a few bollards, and a little harbour office at the far end.
      b.add(mats.naturalWood, place(new RoundedBoxGeometry(196, 6, 8, 1, 1.5), 108, 112, PAD_H - 1));
      for (const t of [30, 80, 130, 180]) b.add(mats.lacquer("#3a3a3e"), place(new CylinderGeometry(2.5, 3, 7, 10), t, 110, PAD_H + 3.5));
      b.add(mats.lacquer("#e9e1cf"), place(new RoundedBoxGeometry(26, 24, 22, 2, 2.5), 184, 92, PAD_H + 12));
      b.add(mats.lacquer("#2f6fb0"), place(new RoundedBoxGeometry(30, 4, 26, 1, 1.5), 184, 92, PAD_H + 26));
    }
    if (site.depot.role === "power") {
      // A brick turbine hall with two tall chimneys.
      b.add(mats.lacquer("#9a4f3a"), place(new RoundedBoxGeometry(70, 40, 34, 2, 3), 150, 94, PAD_H + 20));
      for (const t of [130, 170]) b.add(mats.lacquer("#7a3f30"), place(new CylinderGeometry(4.5, 5.5, 70, 12), t, 108, PAD_H + 35));
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

  private buildBlade(pose: SitePose): Object3D {
    const blade = hasPart("industry-saw-blade") ? this.partObject("industry-saw-blade") : new Mesh(new CylinderGeometry(11, 11, 1.4, 28).rotateX(Math.PI / 2), this.mats.magnet);
    toWorld(pose, 44, 74, PAD_H + 14 + 4, blade.position);
    return this.addMoving(blade, pose);
  }

  /** A windmill's sails, facing the track; they turn (like the saw) while the mill grinds. */
  /**
   * A wheel turning while its yard works, its hub at `t`, `l` and height `h` in the depot's frame (the model's x, z
   * and y): the mine's winding wheel, the power station's flywheel (Asset Gen's parts; none without the models).
   */
  private buildWheel(pose: SitePose, part: string, t: number, l: number, h: number): Object3D | null {
    if (!hasPart(part)) return null;
    const wheel = this.partObject(part, {});
    toWorld(pose, t, l, h, wheel.position);
    return this.addMoving(wheel, pose);
  }

  private buildSails(pose: SitePose): Object3D {
    if (hasPart("industry-mill-sails")) {
      const sails = this.partObject("industry-mill-sails", { sails: "#f1ebdd" });
      toWorld(pose, 160, 64, 60, sails.position);
      return this.addMoving(sails, pose);
    }
    const arm = new RoundedBoxGeometry(4, 34, 1.4, 1, 0.5).translate(0, 17, 0);
    const sails = new Mesh(mergeGeometries([0, 1, 2, 3].map((k) => arm.clone().rotateZ((k * Math.PI) / 2)))!, this.mats.lacquer("#f1ebdd"));
    toWorld(pose, 34, 74, PAD_H + 58, sails.position);
    return this.addMoving(sails, pose);
  }

  /** A part as an object of its own (to move), its pieces as meshes. */
  private partObject(name: string, slots: Readonly<Record<string, string>> = {}): Object3D {
    const g = new Group();
    for (const [geometry, material] of partPieces(this.mats, name, slots)) g.add(new Mesh(geometry, material));
    return g;
  }

  /** Something of a depot's that moves on its own, turned to the depot and added to the view. */
  private addMoving(o: Object3D, pose: SitePose): Object3D {
    o.rotation.y = -pose.heading;
    o.traverse((m) => (m.castShadow = true));
    o.userData.depotMoving = true;
    this.group.add(o);
    return o;
  }

  /** World pose of pile unit k (its centre), written to `pos`; returns its yaw. */
  private pileUnit(site: Site, kind: CargoKind, k: number, pos: Vector3): number {
    const spot = site.layout.piles[kind]!;
    const slot = pileSlot(kind, k, spot.across, spot.rows);
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

  /** Show or hide a hopper model's coal (its `coal…` nodes, found once per model). */
  private showCoal(car: Object3D, on: boolean): void {
    let coal = this.coalOf.get(car);
    if (!coal) {
      coal = [];
      car.traverse((o) => {
        if (o.name.startsWith("coal")) coal!.push(o);
      });
      this.coalOf.set(car, coal);
    }
    for (const o of coal) o.visible = on;
  }
  private readonly coalOf = new WeakMap<Object3D, Object3D[]>();

  /** A hopper's heap (grain or stone), in the top of its bin, as high as it is full. */
  private putHeap(kind: HeapKind, car: Object3D, count: number, owner: CargoSlot): void {
    const u = this.heaps[kind];
    if (u.n >= DepotView.MAX_UNITS) return;
    car.updateWorldMatrix(true, false);
    _s.set(1, Math.min(1, Math.max(0.25, count / WAGON_CAPACITY)), 1);
    _m.compose(_v.set(0, HOPPER_HEAP, 0), _q.identity(), _s).premultiply(car.matrixWorld);
    _s.set(1, 1, 1);
    u.owners[u.n] = owner;
    for (const part of u.parts) part.setMatrixAt(u.n, _m);
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
   * animating in or near the view (a crane working, the saw turning, a unit in a hand), "changed" when a pile in view or
   * a load just grew or shrank (one new frame shows it), else "still".
   *
   * What turns (a saw, sails, a wheel) turns by `simSeconds`, the game's time: paused, it holds still, and on resuming
   * it carries on from there. Paused, or out of view (its moving parts culled by `cullTiles`, whose boxes reach a
   * little past the view), a working depot asks for no frames: a camera move draws anyway, and the next frame sees it
   * in view.
   */
  update(economy: Economy, carIds: ArrayLike<number>, carCount: number, carObject: (id: number) => Object3D | undefined, simSeconds: number, paused: boolean): "moving" | "changed" | "still" {
    let busy = this.dragging !== null;
    const ran = this.simSeen < 0 ? 0 : Math.max(0, simSeconds - this.simSeen);
    this.simSeen = simSeconds;
    for (const k of HEAP_KINDS) {
      const h = this.heaps[k];
      h.n = 0;
    }
    for (const kind of CARGO_KINDS) {
      const u = this.units[kind];
      u.n = 0;
      u.carried.visible = false;
    }
    const drag = this.dragging;

    // Which unit (if any) is on each crane's hook, so it isn't also drawn on its pile or wagon.
    for (const site of this.sites) {
      site.moving = economy.craneMove(site.depot.id, site.move);
      // (Paused, its crane holds where it is; out of view, it works on unseen.)
      if (site.moving && !paused && site.crane.trolley.visible) busy = true;
    }

    // Piles.
    let changed = false;
    for (const site of this.sites) {
      let sig = 0;
      for (const kind of CARGO_KINDS) {
        if (!site.layout.piles[kind]) continue;
        let count = Math.min(site.depot.piles[CARGO[kind].index], site.layout.piles[kind]!.show ?? Infinity);
        if (site.moving && !site.move.toPile && site.move.kind === kind) count--; // being lifted off this pile
        if (drag?.kind === "pile" && drag.depotId === site.depot.id && drag.cargo === kind) count--; // in a hand
        sig = sig * 257 + count + 1;
        const owner = site.pileOwners[kind];
        for (let k = 0; k < count; k++) {
          const yaw = this.pileUnit(site, kind, k, _v);
          _q.setFromAxisAngle(_up, yaw);
          this.put(kind, _m.compose(_v, _q, _s), owner);
        }
      }
      // A pile out of view changed: nothing to draw now (a camera move bringing it into view draws it).
      if (sig !== site.piles) {
        site.piles = sig;
        if (site.crane.trolley.visible) changed = true;
      }
    }

    // Wagon loads.
    let wagons = carCount;
    for (let i = 0; i < carCount; i++) {
      const id = carIds[i];
      const cargo = economy.cargoOf(id);
      const car = carObject(id);
      wagons = (Math.imul(wagons, 31) + id * 977 + (cargo.kind ? CARGO[cargo.kind].index + 1 : 0) * 61 + cargo.count - this.liftedOff(id) - (drag?.kind === "car" && drag.carId === id ? 1 : 0)) | 0;
      // A hopper is modelled with coal in it: hidden while it carries a load (its heap fills the bin instead).
      if (car && car.userData.carKind === "hopper") this.showCoal(car, !cargo.kind || cargo.count === 0);
      if (!cargo.kind || cargo.count === 0) continue;
      if (!car) continue;
      const count = cargo.count - this.liftedOff(id) - (drag?.kind === "car" && drag.carId === id ? 1 : 0);
      const owner = this.carOwner(id);
      if (isHeap(cargo.kind) && car.userData.carKind === "hopper") {
        if (count > 0) this.putHeap(cargo.kind, car, count, owner);
        continue;
      }
      for (let k = 0; k < count; k++) this.put(cargo.kind, this.wagonUnit(car, cargo.kind, k, _m), owner);
    }

    // Cranes.
    for (const site of this.sites) this.updateCrane(site, economy, carObject);

    if (wagons !== this.wagonsSeen) {
      this.wagonsSeen = wagons;
      changed = true;
    }

    // The saw spins while the sawmill is cutting (by the game's time: paused, it stops where it is).
    if (ran > 0)
      for (const site of this.sites) {
        if (site.blade && economy.working(site.depot)) {
          site.blade.rotateZ(ran * (site.depot.role === "mill" ? 2.5 : site.depot.role === "mine" ? 3 : site.depot.role === "power" ? 5 : 14));
          if (site.blade.visible) busy = true;
        }
      }

    for (const u of this.allUnits) for (const part of u.parts) part.count = u.n;
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
      // (No higher than the pile is drawn: a warehouse or workshop holds more than it shows.)
      const pileCount = Math.min(site.depot.piles[CARGO[move.kind].index], layout.piles[move.kind]?.show ?? Infinity);
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
    for (const u of this.allUnits) if (u.parts.includes(object as InstancedMesh)) return u.owners[instanceId] ?? null;
    return null;
  }

  /** Is this object part of a depot (building, crane or cargo)? */
  isDepotPart(object: Object3D): boolean {
    for (let o: Object3D | null = object; o; o = o.parent) if (o === this.group) return true;
    return false;
  }

  /**
   * The depot (economy id) whose yard a ground point is on (a little past its edge counts), −1 if none: what a tap on
   * a depot's building or yard means. By the yard itself, not by nearness to its crane or piles: those sit at one end,
   * and a tap on a workshop's far end went to the town's station beside it (QA). The nearest yard's middle wins.
   */
  depotAt(x: number, z: number, edge = 8): number {
    let best = -1;
    let bestD = Infinity;
    for (const site of this.sites) {
      const pad = site.layout.pad;
      if (!pad) continue;
      const c = Math.cos(site.pose.heading);
      const s = Math.sin(site.pose.heading);
      const dx = x - site.pose.x;
      const dz = z - site.pose.z;
      const t = c * dx + s * dz - pad.t;
      const l = -s * dx + c * dz - pad.l;
      if (Math.abs(t) > pad.w / 2 + edge || Math.abs(l) > pad.d / 2 + edge) continue;
      const d = Math.hypot(t, l);
      if (d < bestD) {
        bestD = d;
        best = site.depot.id;
      }
    }
    return best;
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

  /**
   * The town (depot id) whose station is under a tap ray: the platform, canopy or station house, `margin` mm of slack
   * all round for a fingertip. Cheap: one plane test per town. −1 if none.
   */
  stationUnder(ray: Ray, margin: number): number {
    for (const site of this.sites) {
      if (site.depot.role !== "town") continue;
      _plane.set(_up, -((site.pose.y ?? 0) + STATION_TAP_Y));
      if (!ray.intersectPlane(_plane, _v)) continue;
      if (inStationFootprint(site.pose, _v.x, _v.z, margin)) return site.depot.id;
    }
    return -1;
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

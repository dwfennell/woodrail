import {
  BufferAttribute,
  BackSide,
  BoxGeometry,
  Box3,
  BufferGeometry,
  Color,
  MeshBasicMaterial,
  Vector3,
  CylinderGeometry,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  Object3D,
  SphereGeometry,
  type Material,
} from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { canStandOnArches, connectorRef, flipSwapsEnds, getPieceDef, isBridge, indexOfRef, isJoin, kitOf, pathLength, pieceOfRef, RISER_HEIGHT, TRACK_THICKNESS, TRACK_WIDTH, type Layout, type PieceDef, type PieceTypeId, type PlacedPiece } from "../track";
import { MAX_BRIDGE_LEVELS } from "../landscape";
import type { Materials } from "./materials";
import { rng } from "./textures";
import { SHADOW_PROXY_LAYER } from "./dressing/blocks";
import { BUFFER_EXTRA, buildBufferBlockGeometry, buildPieceGeometry, buildPieceShadowCaster, buildPieceStandIn, buildPegGeometry, buildScaffold, compactPiece, pegMatrix, SLOT_CUT, withPegs } from "./track-geometry";
import type { PieceJob, PieceResult } from "./piece-worker";
import { loadCached, saveCached } from "./piece-cache";
import { drainQueue } from "./worker-queue";

const geometryCache = new Map<string, BufferGeometry>();
/** Selection outline colours: selected, about to join track, can't go there. */
export const OUTLINE_TONES = { select: "#ffe489", snap: "#86ec7a", blocked: "#ff7461" } as const;
export type OutlineTone = keyof typeof OUTLINE_TONES;
/** Picked pieces' tint (multiplies the wood): golden, green when they'll join track, red when they can't go there. */
const PICK_TINTS: Record<OutlineTone, string> = { select: "#ffd36b", snap: "#9be38a", blocked: "#ff8f7d" };

/** The one peg shape, shared by every TrackView. */
let sharedPeg: BufferGeometry | null = null;
const bufferBlockCache = new Map<string, BufferGeometry | null>();
/** A piece worker that hasn't answered in this long (ms) is given up, and what it had left is carved here. */
const WORKER_PATIENCE_MS = 20_000;
/** Pieces carved here (no worker any more) go one at a time, this far apart (ms): a frame or so for everything else. */
const LOCAL_CARVE_GAP_MS = 20;

/**
 * Track pieces are carved (CSG) in background workers: those the opening map needs while loading, the rest (every
 * kind, then the taller arches bridges and raised ramps stand on) after the title's up. A piece wanted before its turn
 * goes to the front of the queue and is drawn meanwhile as a stand-in (its plain body, or its lowest arches); when
 * the real one comes, `onPiecesBuilt` listeners swap it in. If a worker gives up (fails, or goes silent), what's left
 * is carved here, one a frame, stand-ins still shown till each is done. Where no worker can run at all, pieces are
 * carved when first wanted, as before.
 */
const carving = {
  /** Background carving under way (from loading on): pieces not carved yet get stand-ins. */
  started: false,
  /** No worker to be had: carve when wanted. */
  broken: typeof Worker === "undefined",
  queue: [] as PieceJob[],
  running: 0,
  /** Workers gave up: carve here, one a frame. */
  local: false,
  localQueue: [] as PieceJob[],
  localScheduled: false,
  /** Shown as stand-ins, or waited for (`whenBuilt`): keys as in the geometry cache. */
  wanted: new Map<string, (() => void)[]>(),
  /** Kinds of piece moved up the queue (with their other heights). */
  hurried: new Set<PieceTypeId>(),
  /** Carved in workers this visit (with those loaded from the last), kept for the next. */
  pieces: [] as PieceResult[],
  arches: [] as PieceResult[],
  listeners: new Set<() => void>(),
  notifyScheduled: false,
};
const standIns = new Map<string, BufferGeometry>();

/** Call `f` whenever pieces shown as stand-ins have been carved (to swap them in). */
export function onPiecesBuilt(f: () => void): () => void {
  carving.listeners.add(f);
  return () => carving.listeners.delete(f);
}

/** The arch heights every piece of this kind has from the start (a bridge's one level; none for a ramp). */
const baseLevels = (type: PieceTypeId) => (isBridge(type) ? 1 : 0);
/** Kinds carved in the background (join pieces, dozens of sizes, are cheap enough to make when first used). */
const carvedInBackground = (type: PieceTypeId) => !isJoin(type);

/** The job that carves this piece (a mirrored piece is made here from the plain one; a flip that swaps ends is carved). */
function jobFor(type: PieceTypeId, flipped: boolean, levels: number, floors: readonly number[] | null = null): PieceJob {
  const job: PieceJob = flipped && getPieceDef(type, true) !== getPieceDef(type, false) && flipSwapsEnds(type) ? { type, levels, flipped: true } : { type, levels };
  if (floors) job.floors = floors;
  return job;
}

/** A key's part for arch floors (none where every opening reaches all the way down). */
const floorsKey = (floors: readonly number[] | null | undefined): string => (floors ? `/${floors.join(",")}` : "");

/** Carved (by a worker, or here): into the cache, anyone waiting told (swaps batched to once a tick). */
function built(key: string, g: BufferGeometry): void {
  if (!geometryCache.has(key)) geometryCache.set(key, g);
  const waiting = carving.wanted.get(key);
  if (!waiting) return;
  carving.wanted.delete(key);
  for (const f of waiting) f();
  if (carving.notifyScheduled) return;
  carving.notifyScheduled = true;
  setTimeout(() => {
    carving.notifyScheduled = false;
    for (const f of carving.listeners) f();
  }, 0);
}

function startWorkers(count: number): void {
  for (let i = 0; i < count && !carving.local && carving.queue.length > 0; i++) {
    let worker: Worker;
    try {
      worker = new Worker(new URL("./piece-worker.ts", import.meta.url), { type: "module" });
    } catch {
      // No module workers here after all.
      if (carving.running === 0) goLocal();
      return;
    }
    carving.running++;
    void drainQueue<PieceJob, PieceResult>(
      worker,
      carving.queue,
      (r) => {
        const key = resultKey(r);
        (r.levels > baseLevels(r.type) ? carving.arches : carving.pieces).push(r);
        if (!geometryCache.has(key)) built(key, geometryOf(r));
      },
      WORKER_PATIENCE_MS,
      // Carved here meanwhile: not needed.
      (job) => geometryCache.has(resultKey(job)),
    ).then((finished) => {
      carving.running--;
      // Given up: the rest (and the job it had) is carved here.
      if (!finished) goLocal();
      if (carving.running > 0) return;
      // All done: anything still waited for (a job lost with a worker) is carved here; what was made is kept.
      for (const key of carving.wanted.keys()) if (!geometryCache.has(key)) localJob(jobOfKey(key), false);
      if (!carving.local) {
        void saveCached("pieces", __BUILD_ID__, carving.pieces);
        void saveCached("arches", __BUILD_ID__, carving.arches);
      }
    });
  }
}

/** Carve here from now on, one a frame: the queue moves over, what's waited for first. */
function goLocal(): void {
  carving.local = true;
  const queue = carving.queue.splice(0);
  for (const j of queue) if (carving.wanted.has(resultKey(j))) localJob(j, false);
  for (const j of queue) if (!carving.wanted.has(resultKey(j))) localJob(j, false);
  for (const key of carving.wanted.keys()) if (!geometryCache.has(key)) localJob(jobOfKey(key), false);
}

function localJob(job: PieceJob, first: boolean): void {
  const key = resultKey(job);
  const q = carving.localQueue;
  const at = q.findIndex((j) => resultKey(j) === key);
  if (at >= 0 && !first) return;
  if (at >= 0) q.splice(at, 1);
  if (first) q.unshift(job);
  else q.push(job);
  carveSoon();
}

function carveSoon(): void {
  if (carving.localScheduled || carving.localQueue.length === 0) return;
  carving.localScheduled = true;
  setTimeout(() => {
    carving.localScheduled = false;
    let job = carving.localQueue.shift();
    while (job && geometryCache.has(resultKey(job))) job = carving.localQueue.shift();
    if (job) built(resultKey(job), compactPiece(buildPieceGeometry(getPieceDef(job.type, !!job.flipped), job.levels, job.floors ?? null)));
    carveSoon();
  }, LOCAL_CARVE_GAP_MS);
}

const jobOfKey = (key: string): PieceJob => {
  const [type, side, rest] = key.split(":");
  const [levels, floors] = rest.split("/");
  const job: PieceJob = side === "f" ? { type: type as PieceTypeId, levels: Number(levels), flipped: true } : { type: type as PieceTypeId, levels: Number(levels) };
  if (floors) job.floors = floors.split(",").map(Number);
  return job;
};

/** Wanted now: first in line (with that kind's other heights after it, nearest first, in case it's lifted). */
function hurry(job: PieceJob, then?: () => void): void {
  const key = resultKey(job);
  const waiting = carving.wanted.get(key) ?? [];
  if (then) waiting.push(then);
  carving.wanted.set(key, waiting);
  if (carving.local) return localJob(job, true);
  const q = carving.queue;
  if (!carving.hurried.has(job.type)) {
    carving.hurried.add(job.type);
    q.sort((a, b) => Number(b.type === job.type) - Number(a.type === job.type) || (a.type === job.type ? Math.abs(a.levels - job.levels) - Math.abs(b.levels - job.levels) : 0));
  }
  const at = q.findIndex((j) => resultKey(j) === key);
  if (at !== 0) q.unshift(at > 0 ? q.splice(at, 1)[0] : job);
  if (carving.running === 0) startWorkers(1);
}

/**
 * Drawn while a piece is carved: its lowest arches if those are ready, else its plain body; standing on wooden
 * scaffolding where it's lifted higher than that reaches.
 */
function standIn(type: PieceTypeId, levels: number, def: PieceDef): BufferGeometry {
  const side = def === getPieceDef(type, false) ? "n" : "f";
  const lowest = geometryCache.get(`${type}:${side}:${baseLevels(type)}`);
  const plainKey = `${type}:${side}`;
  let plain = standIns.get(plainKey);
  if (!lowest && !plain) standIns.set(plainKey, (plain = buildPieceStandIn(def)));
  const shown = lowest ?? plain!;
  if (levels <= baseLevels(type)) return shown;
  // Scaffolding from the ground up to where what's shown stops (the lowest arches' feet, or the deck).
  const key = `${type}:${side}:${levels}:${lowest ? "arches" : "plain"}`;
  let g = standIns.get(key);
  if (!g) standIns.set(key, (g = onScaffolding(shown, def, -levels * RISER_HEIGHT, lowest ? -baseLevels(type) * RISER_HEIGHT : 0)));
  return g;
}

/** `shown` with scaffolding under it, from `bottom` to `top`, in the darker wood. */
function onScaffolding(shown: BufferGeometry, def: PieceDef, bottom: number, top: number): BufferGeometry {
  const built = buildScaffold(def, bottom, top);
  if (!built) return shown;
  const scaffold = shown.index ? built : built.toNonIndexed();
  const merged = mergeGeometries([shown, scaffold]);
  if (!merged) return shown;
  merged.clearGroups();
  for (const gr of shown.groups) merged.addGroup(gr.start, gr.count, gr.materialIndex);
  const count = (g: BufferGeometry) => (g.index ? g.index.count : g.attributes.position.count);
  merged.addGroup(count(shown), count(scaffold), SLOT_CUT);
  merged.computeBoundingBox();
  merged.computeBoundingSphere();
  return merged;
}

/** Lone pieces' geometry with their own pegs on, by the carved geometry (or stand-in) they were made from. */
const peggedCache = new WeakMap<BufferGeometry, BufferGeometry>();

/**
 * A lone piece's geometry, as it comes, with a peg in each of its peg ends (a held piece, a piece settling, the tray's
 * picture); `levels` is how many riser heights a bridge's arches reach below its deck, and `floors` how far down each
 * arch's opening reaches where that's less (a bridge over a hill's edge: see `archFloors`). Track in a layout is drawn
 * from `carvedGeometry`, with TrackView putting in the pegs where it's joined.
 */
export function pieceGeometry(type: PieceTypeId, flipped: boolean, levels = 0, floors: readonly number[] | null = null): BufferGeometry {
  const carved = carvedGeometry(type, flipped, levels, floors);
  let g = peggedCache.get(carved);
  if (!g) peggedCache.set(carved, (g = withPegs(carved, getPieceDef(type, flipped))));
  return g;
}

/** A piece's geometry with a hole at every end (or its stand-in while it's carved). */
function carvedGeometry(type: PieceTypeId, flipped: boolean, levels = 0, floors: readonly number[] | null = null): BufferGeometry {
  const def = getPieceDef(type, flipped);
  const plain = def === getPieceDef(type, false);
  const key = `${type}:${plain ? "n" : "f"}:${levels}${floorsKey(floors)}`;
  let g = geometryCache.get(key);
  if (!g && carving.started && !carving.broken && carvedInBackground(type)) {
    // Not carved yet: next in line, and a stand-in meanwhile. (A mirrored piece is made here once the plain one's in.)
    const job = jobFor(type, flipped, levels, floors);
    if (!geometryCache.has(resultKey(job))) {
      hurry(job);
      // Arches over a hill's edge: the bridge with its arches all the way down meanwhile (or its own stand-in).
      return floors ? carvedGeometry(type, flipped, levels) : standIn(type, levels, def);
    }
  }
  if (!g) {
    // A mirrored piece is its plain shape reflected across its centre line: no need to carve it again.
    // A piece whose flip swaps its ends' peg and hole is carved as it is.
    g = plain || flipSwapsEnds(type) ? compactPiece(buildPieceGeometry(def, levels, floors)) : mirrored(carvedGeometry(type, false, levels, floors));
    geometryCache.set(key, g);
  }
  return g;
}

/** A copy of a piece's geometry reflected in z (across its centre line), its faces turned to keep facing out. */
function mirrored(source: BufferGeometry): BufferGeometry {
  const g = source.clone();
  g.applyMatrix4(new Matrix4().makeScale(1, 1, -1));
  // Reflection reverses each triangle's winding: swap two corners back.
  if (g.index) {
    const idx = g.index.array;
    for (let i = 0; i < idx.length; i += 3) [idx[i + 1], idx[i + 2]] = [idx[i + 2], idx[i + 1]];
    g.index.needsUpdate = true;
  } else {
    for (const attr of Object.values(g.attributes)) {
      const a = attr.array;
      const n = attr.itemSize;
      for (let i = 0; i < attr.count; i += 3) {
        for (let k = 0; k < n; k++) {
          const t = a[(i + 1) * n + k];
          a[(i + 1) * n + k] = a[(i + 2) * n + k];
          a[(i + 2) * n + k] = t;
        }
      }
      attr.needsUpdate = true;
    }
  }
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}

function bufferBlock(type: PieceTypeId): BufferGeometry | null {
  if (!bufferBlockCache.has(type)) bufferBlockCache.set(type, buildBufferBlockGeometry(getPieceDef(type, false)));
  return bufferBlockCache.get(type)!;
}

const BUFFER_RED = new Color("#c8442f");
const TURNBACK_YELLOW = new Color("#e6b52c");

function turnbackFlagParts(): { pole: BufferGeometry; flag: BufferGeometry } {
  const def = getPieceDef("buffer-turnback", false);
  const len = pathLength(def.paths[0].geom);
  // On top of the buffer block (see buildBufferBlockGeometry), toward its back edge.
  const x = len + BUFFER_EXTRA - 6;
  const y = TRACK_THICKNESS + 25;
  const pole = new CylinderGeometry(1.4, 1.4, 30, 8).translate(x, y + 15, 12);
  const flag = new BoxGeometry(12, 8, 1.2).translate(x - 6.5, y + 26, 12);
  return { pole, flag };
}

/** Arch floors back from a mesh key's part ("" for none). */
const floorsOf = (part: string): number[] | null => (part ? part.split(",").map(Number) : null);

/** Matrix placing piece-local geometry at a plan pose (plan x/z → world x/z; heading h → rotation.y = -h). */
export function pieceMatrix(x: number, y: number, z: number, heading: number, out = new Matrix4()): Matrix4 {
  return out.makeRotationY(-heading).setPosition(x, y, z);
}

/** How far past a free end (mm) its end board stands: clear of a peg standing out of it. */
const END_BOARD_OUT = 24;

/**
 * An end board on its own (as TrackView stands past free ends), its own geometry: for a held piece's end that will be
 * left open (a ghost showing the gap it leaves). In an end's frame: x outward.
 */
export function endBoardModel(mats: Materials): Group {
  const board = new Mesh(new RoundedBoxGeometry(3, 14, 22, 1, 1).translate(END_BOARD_OUT, 9, 0), mats.lacquer("#c8442f"));
  const stripe = new Mesh(new BoxGeometry(3.4, 3.5, 22.4).translate(END_BOARD_OUT, 9, 0), mats.lacquer("#f6f1e6"));
  return new Group().add(board, stripe);
}

const SWITCH_LEVER_OFFSET = TRACK_WIDTH / 2 + 9;
const SIGNAL_HEIGHT = 54;
/** Arm angle above level when the switch is set to its branch. */
const SIGNAL_RAISED = 0.75;

/** Lever beside the trunk of a switch, leaning toward the selected route. Tap target for flipping. */
function switchLeverGeometry(): BufferGeometry {
  const base = new CylinderGeometry(6, 7, 6, 20);
  base.translate(0, 3, 0);
  const stick = new CylinderGeometry(1.8, 1.8, 26, 12);
  stick.translate(0, 13 + 4, 0);
  const knob = new SphereGeometry(5, 20, 14);
  knob.translate(0, 31, 0);
  return mergeGeometries([base.toNonIndexed(), stick.toNonIndexed(), knob.toNonIndexed()].map((g) => {
    g.deleteAttribute("uv");
    return g;
  }));
}

/** Shadow casters, one for each kind of piece, shared by every piece of that kind (see `buildPieceShadowCaster`). */
const casters = new Map<string, BufferGeometry>();

/**
 * What a kind of piece casts its shadow with, or null to cast with the piece itself: bridges and ramps do (their
 * arches' and supports' shadows are their own), and risers.
 */
function casterGeometry(type: PieceTypeId, flipped: boolean): BufferGeometry | null {
  const def = getPieceDef(type, flipped);
  if (def.supportHeight > 0 || def.paths.length === 0) return null;
  const key = `${type}|${flipped ? 1 : 0}`;
  let g = casters.get(key);
  if (!g) casters.set(key, (g = buildPieceShadowCaster(def)));
  return g;
}

/**
 * Draws a Layout with one InstancedMesh per piece variant. Call `sync()` after the layout changes.
 * Picking: `pieceAt(object, instanceId)` maps a raycast hit back to a piece id.
 */
export class TrackView {
  readonly group = new Group();
  private meshes = new Map<string, { mesh: InstancedMesh; ids: number[] }>();
  /** The shadow casters' material (never drawn to the screen: the shadow map draws depth only). */
  private readonly casterMaterial = new MeshBasicMaterial();
  private bufferMesh: { mesh: InstancedMesh; ids: number[] } | null = null;
  private flagMeshes: InstancedMesh[] = [];
  private flagIds: number[] = [];
  /** The pegs: one at each joint (in the hole of one of its two pieces) and in each free peg end. */
  private pegMesh: InstancedMesh | null = null;
  /** Each peg's piece and end, by instance. */
  private pegOwners: number[] = [];
  private pegEnds: number[] = [];
  /** Turnback flag: a pole standing on the buffer block and a pennant, in piece-local space. */
  private readonly flagParts = turnbackFlagParts();
  private levers = new Map<number, Mesh>();
  /** Is this spot on a road (or lane)? A switch's lever and signal stand clear of roads where there's room. */
  onRoad: ((x: number, z: number) => boolean) | null = null;
  /** A toy semaphore signal beside each switch: arm level for the straight route, raised for the branch. */
  private signals = new Map<number, { root: Group; arm: Group }>();
  private readonly signalParts = {
    base: new CylinderGeometry(5, 6, 3, 16).translate(0, 1.5, 0),
    post: new CylinderGeometry(1.7, 1.9, SIGNAL_HEIGHT, 10).translate(0, SIGNAL_HEIGHT / 2, 0),
    cap: new SphereGeometry(2.6, 14, 10).translate(0, SIGNAL_HEIGHT + 1, 0),
    arm: new RoundedBoxGeometry(4.5, 3, 24, 1, 1).translate(0, 0, 12),
    stripe: new BoxGeometry(4.8, 3.3, 3).translate(0, 0, 19),
  };
  private readonly tints = new Map<number, Color>();
  private highlighted: readonly number[] = [];
  /** Pieces drawn elsewhere for now (stand-in meshes animating in their place), with how many stand-ins each. */
  private readonly hidden = new Map<number, number>();
  private readonly leverGeometry = switchLeverGeometry();
  /**
   * Track that just stops: a little red end board stands past each end joined to nothing, so a gap (one hidden under a
   * station, say) is plain to see. All of them while building (`showAllEnds`); else only where a train has turned back.
   */
  private endBoards: InstancedMesh[] = [];
  private allEnds = false;
  /** Ends (connector refs) a train has turned back at, still free. */
  private readonly stuckEnds = new Set<number>();
  private readonly endParts = {
    board: new RoundedBoxGeometry(3, 14, 22, 1, 1).translate(END_BOARD_OUT, 9, 0),
    stripe: new BoxGeometry(3.4, 3.5, 22.4).translate(END_BOARD_OUT, 9, 0),
  };

  constructor(
    private readonly layout: Layout,
    private readonly mats: Materials,
    /** How many riser heights a placed bridge's arches reach down (from the ground under it). */
    private readonly bridgeLevels: (piece: PlacedPiece) => number = () => 0,
    /** How far down each of a placed bridge's arch openings reaches, where less than all its levels (`archFloors`). */
    private readonly archFloors: (piece: PlacedPiece, levels: number) => number[] | null = () => null,
  ) {}

  /** A piece's colour: its own slight tint, or the selection's while it's picked. */
  private colourOf(id: number): Color {
    return this.tinted && this.highlighted.includes(id) ? this.toneColour : this.tintFor(id);
  }

  private readonly toneColour = new Color(PICK_TINTS.select);
  private tone: OutlineTone = "select";
  private tinted = false;

  /** Recolour these pieces' instances (picked or not any more). */
  private recolour(ids: Iterable<number>): void {
    for (const id of ids) {
      for (const entry of this.meshes.values()) {
        const i = entry.ids.indexOf(id);
        if (i === -1) continue;
        entry.mesh.setColorAt(i, this.colourOf(id));
        if (entry.mesh.instanceColor) entry.mesh.instanceColor.needsUpdate = true;
      }
      const pegs = this.pegMesh;
      if (!pegs) continue;
      this.pegOwners.forEach((owner, i) => owner === id && pegs.setColorAt(i, this.colourOf(id)));
      if (pegs.instanceColor) pegs.instanceColor.needsUpdate = true;
    }
  }

  private tintFor(id: number): Color {
    let c = this.tints.get(id);
    if (!c) {
      const r = rng(id * 7919);
      const v = 0.86 + r() * 0.14;
      c = new Color(v, v * (0.97 + r() * 0.03), v * (0.93 + r() * 0.05));
      this.tints.set(id, c);
    }
    return c;
  }

  sync(): void {
    for (const { mesh } of this.meshes.values()) {
      this.group.remove(mesh);
      mesh.dispose();
    }
    this.meshes.clear();
    if (this.bufferMesh) {
      this.group.remove(this.bufferMesh.mesh);
      this.bufferMesh.mesh.dispose();
      this.bufferMesh = null;
    }
    for (const f of this.flagMeshes) {
      this.group.remove(f);
      f.dispose();
    }
    this.flagMeshes = [];
    this.flagIds = [];

    const groups = new Map<string, number[]>();
    for (const id of this.layout.pieceIds()) {
      if (this.layout.isLifted(id) || this.hidden.has(id)) continue;
      const p = this.layout.getPiece(id)!;
      const def = getPieceDef(p.type, p.flipped);
      const levels = this.bridgeLevels(p);
      const key = `${p.type}|${def === getPieceDef(p.type, false) ? 0 : 1}|${levels}|${this.archFloors(p, levels)?.join(",") ?? ""}`;
      let list = groups.get(key);
      if (!list) groups.set(key, (list = []));
      list.push(id);
    }

    const m = new Matrix4();
    const bufferIds: number[] = [];
    for (const [key, ids] of groups) {
      const [type, flipped, levels, floors] = key.split("|") as [PieceTypeId, string, string, string];
      const mesh = new InstancedMesh(carvedGeometry(type, flipped === "1", Number(levels), floorsOf(floors)), [this.mats.track, this.mats.trackCut, this.mats.bridgePaint], ids.length);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      ids.forEach((id, i) => {
        const p = this.layout.getPiece(id)!;
        mesh.setMatrixAt(i, pieceMatrix(p.pose.x, p.y, p.pose.z, p.pose.heading, m));
        mesh.setColorAt(i, this.colourOf(id));
      });
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.computeBoundingSphere();
      mesh.userData.kind = "track";
      // Shadows from a plain block in each piece's place (half or less of its triangles; the shadow map draws every
      // piece again): the same instances, seen by the shadow camera only.
      const caster = Number(levels) === 0 ? casterGeometry(type, flipped === "1") : null;
      if (caster) {
        mesh.castShadow = false;
        const shadow = new InstancedMesh(caster, this.casterMaterial, ids.length);
        shadow.instanceMatrix = mesh.instanceMatrix;
        shadow.boundingSphere = mesh.boundingSphere;
        shadow.castShadow = true;
        shadow.layers.set(SHADOW_PROXY_LAYER);
        shadow.raycast = () => {};
        mesh.add(shadow);
      }
      this.group.add(mesh);
      this.meshes.set(key, { mesh, ids });
      // (A kit's model draws its own buffer stops, where its roads end.)
      if (bufferBlock(type) && !kitOf(type)) bufferIds.push(...ids);
    }

    if (bufferIds.length > 0) {
      // Plain buffers are red; turnback buffers yellow, each with a red flag on a white pole.
      const turnback = (id: number) => this.layout.getPiece(id)!.type === "buffer-turnback";
      const colours = bufferIds.map((id) => (turnback(id) ? TURNBACK_YELLOW : BUFFER_RED));
      const mesh = new InstancedMesh(bufferBlock("buffer")!, this.mats.lacquer("#ffffff"), bufferIds.length);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      bufferIds.forEach((id, i) => {
        const p = this.layout.getPiece(id)!;
        mesh.setMatrixAt(i, pieceMatrix(p.pose.x, p.y, p.pose.z, p.pose.heading, m));
        mesh.setColorAt(i, colours[i]);
      });
      mesh.userData.kind = "track";
      this.group.add(mesh);
      this.bufferMesh = { mesh, ids: bufferIds };

      const flagIds = bufferIds.filter(turnback);
      if (flagIds.length > 0) {
        const pole = new InstancedMesh(this.flagParts.pole, this.mats.lacquer("#f6f1e6"), flagIds.length);
        const flag = new InstancedMesh(this.flagParts.flag, this.mats.lacquer("#c8442f"), flagIds.length);
        flagIds.forEach((id, i) => {
          const p = this.layout.getPiece(id)!;
          pieceMatrix(p.pose.x, p.y, p.pose.z, p.pose.heading, m);
          pole.setMatrixAt(i, m);
          flag.setMatrixAt(i, m);
        });
        for (const f of [pole, flag]) {
          f.castShadow = true;
          f.userData.kind = "track";
          this.group.add(f);
        }
        this.flagMeshes = [pole, flag];
        this.flagIds = flagIds;
      }
    }

    this.syncPegs();
    this.syncLevers();
    this.syncEndBoards();
    this.syncOutline();
  }

  /** Joints were made or parted without the pieces changing (a group taken up to drag): redo the pegs and end boards. */
  jointsChanged(): void {
    this.syncPegs();
    this.syncEndBoards();
  }

  /** Show every free end's board (building), or only those where a train has turned back. */
  showAllEnds(on: boolean): void {
    if (on === this.allEnds) return;
    this.allEnds = on;
    this.syncEndBoards();
  }

  /** A train turned back at this end of track (a connector ref): its board shows from now on, while it's free. */
  markTurnedBack(ref: number): boolean {
    if (this.stuckEnds.has(ref) || this.layout.joinedConnector(ref) !== -1) return false;
    this.stuckEnds.add(ref);
    this.syncEndBoards();
    return true;
  }

  private syncEndBoards(): void {
    for (const b of this.endBoards) {
      this.group.remove(b);
      b.dispose();
    }
    this.endBoards = [];
    const ends: { id: number; i: number }[] = [];
    for (const ref of this.stuckEnds) if (this.layout.joinedConnector(ref) !== -1 || !this.layout.getPiece(pieceOfRef(ref))) this.stuckEnds.delete(ref);
    for (const id of this.layout.pieceIds()) {
      if (this.layout.isLifted(id) || this.hidden.has(id)) continue;
      const p = this.layout.getPiece(id)!;
      if (p.type === "joiner") continue;
      getPieceDef(p.type, p.flipped).connectors.forEach((_, i) => {
        const ref = connectorRef(id, i);
        if (this.layout.joinedConnector(ref) !== -1) return;
        if (this.allEnds || this.stuckEnds.has(ref)) ends.push({ id, i });
      });
    }
    this.endList = ends;
    if (ends.length === 0) return;
    for (const [geometry, colour] of [[this.endParts.board, "#c8442f"], [this.endParts.stripe, "#f6f1e6"]] as const) {
      const mesh = new InstancedMesh(geometry, this.mats.lacquer(colour), ends.length);
      mesh.castShadow = true;
      // Not something to pick: a tap there is a tap on the ground (or the track's end).
      mesh.raycast = () => {};
      mesh.computeBoundingSphere();
      this.group.add(mesh);
      this.endBoards.push(mesh);
    }
    this.placeEndBoards(null);
  }

  /** The free ends with boards (piece, end), in instance order. */
  private endList: { id: number; i: number }[] = [];

  /** Stand the end boards at their ends (only those of the pieces in `ids`, or all). */
  private placeEndBoards(ids: ReadonlySet<number> | null): void {
    if (this.endBoards.length === 0) return;
    const m = new Matrix4();
    const local = new Matrix4();
    let moved = false;
    this.endList.forEach(({ id, i }, k) => {
      if (ids && !ids.has(id)) return;
      const p = this.layout.getPiece(id);
      if (!p) return;
      const c = getPieceDef(p.type, p.flipped).connectors[i];
      pieceMatrix(p.pose.x, p.y, p.pose.z, p.pose.heading, m).multiply(pieceMatrix(c.pose.x, c.y, c.pose.z, c.pose.heading, local));
      for (const mesh of this.endBoards) mesh.setMatrixAt(k, m);
      moved = true;
    });
    if (!moved) return;
    for (const mesh of this.endBoards) {
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
    }
  }

  /**
   * One peg at each joint, standing in the hole of the piece whose end is a peg end (where both ends are pegs or both
   * holes, the first piece's), and one in each free peg end. A joiner brings its own. An end joined to a piece that
   * isn't drawn (lifted, or a stand-in animating in its place) counts as free.
   */
  private syncPegs(): void {
    const owners: number[] = [];
    const ends: number[] = [];
    const drawn = (id: number) => !this.layout.isLifted(id) && !this.hidden.has(id);
    for (const id of this.layout.pieceIds()) {
      if (!drawn(id)) continue;
      const p = this.layout.getPiece(id)!;
      if (p.type === "joiner") continue;
      const def = getPieceDef(p.type, p.flipped);
      def.connectors.forEach((c, i) => {
        const ref = connectorRef(id, i);
        const other = this.layout.joinedConnector(ref);
        const op = other >= 0 && drawn(pieceOfRef(other)) ? this.layout.getPiece(pieceOfRef(other)) : undefined;
        if (op?.type === "joiner") return;
        const oc = op && getPieceDef(op.type, op.flipped).connectors[indexOfRef(other)];
        const mine = !oc ? c.kind === "peg" : c.kind !== oc.kind ? c.kind === "peg" : ref < other;
        if (!mine) return;
        owners.push(id);
        ends.push(i);
      });
    }
    this.pegOwners = owners;
    this.pegEnds = ends;
    // The mesh is kept while it has room (a sync on every edit needn't make a new one), with some to spare when it grows.
    let mesh = this.pegMesh;
    if (!mesh || mesh.instanceMatrix.count < owners.length) {
      if (mesh) {
        this.group.remove(mesh);
        mesh.dispose();
      }
      mesh = new InstancedMesh((sharedPeg ??= buildPegGeometry()), this.mats.track, Math.max(16, Math.ceil(owners.length * 1.5)));
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.userData.kind = "track";
      this.pegMesh = mesh;
      this.group.add(mesh);
    }
    mesh.count = owners.length;
    mesh.visible = owners.length > 0;
    owners.forEach((id, i) => mesh.setColorAt(i, this.colourOf(id)));
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    this.placePegs(null);
  }

  /** Put the pegs where their pieces are (only those of `ids`, or all). */
  private placePegs(ids: ReadonlySet<number> | null): void {
    const mesh = this.pegMesh;
    if (!mesh) return;
    const m = new Matrix4();
    const local = new Matrix4();
    let moved = false;
    this.pegOwners.forEach((id, i) => {
      if (ids && !ids.has(id)) return;
      const p = this.layout.getPiece(id);
      if (!p) return;
      const c = getPieceDef(p.type, p.flipped).connectors[this.pegEnds[i]];
      mesh.setMatrixAt(i, pieceMatrix(p.pose.x, p.y, p.pose.z, p.pose.heading, m).multiply(pegMatrix(c, local)));
      moved = true;
    });
    if (!moved) return;
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
  }

  /** Pieces carved in the background: those showing a stand-in take theirs (no rebuild of the rest). */
  piecesBuilt(): void {
    for (const [key, { mesh }] of this.meshes) {
      const [type, flipped, levels, floors] = key.split("|") as [PieceTypeId, string, string, string];
      const g = carvedGeometry(type, flipped === "1", Number(levels), floorsOf(floors));
      if (mesh.geometry !== g) {
        mesh.geometry = g;
        mesh.computeBoundingSphere();
      }
    }
    this.syncOutline();
  }

  private readonly outlines: Mesh[] = [];
  private readonly outlineMaterial = new MeshBasicMaterial({ color: new Color(OUTLINE_TONES.select), side: BackSide, transparent: true, opacity: 0.85, depthWrite: false });

  /**
   * Selected pieces get a soft light outline: each one's own shape drawn back-faces-only, a little larger, so only a
   * rim shows around the edges.
   */
  private syncOutline(): void {
    let n = 0;
    for (const id of this.highlighted) {
      const p = this.hidden.has(id) ? undefined : this.layout.getPiece(id);
      if (!p || this.layout.isLifted(id)) continue;
      const levels = this.bridgeLevels(p);
      const geometry = carvedGeometry(p.type, p.flipped, levels, this.archFloors(p, levels));
      let outline = this.outlines[n];
      if (!outline) {
        outline = new Mesh(geometry, this.outlineMaterial);
        outline.matrixAutoUpdate = false;
        outline.renderOrder = 2;
        this.group.add(outline);
        this.outlines.push(outline);
      }
      n++;
      outline.geometry = geometry;
      outline.visible = true;
      geometry.computeBoundingBox();
      const box = geometry.boundingBox ?? new Box3();
      const size = box.getSize(new Vector3());
      const centre = box.getCenter(new Vector3());
      const grow = 2.4;
      // Scale about the piece's own centre so the shell stands evenly proud of every side.
      const scale = new Matrix4().makeTranslation(centre.x, centre.y, centre.z)
        .multiply(new Matrix4().makeScale((size.x + grow * 2) / size.x, (size.y + grow) / size.y, (size.z + grow * 2) / size.z))
        .multiply(new Matrix4().makeTranslation(-centre.x, -centre.y, -centre.z));
      outline.matrix.copy(pieceMatrix(p.pose.x, p.y, p.pose.z, p.pose.heading)).multiply(scale);
    }
    // Spare outlines are kept for the next selection, hidden.
    for (let i = n; i < this.outlines.length; i++) this.outlines[i].visible = false;
  }

  /** Gentle breathing of the selection outline (call per frame with elapsed seconds). */
  pulse(time: number): void {
    if (this.outlines[0]?.visible) this.outlineMaterial.opacity = 0.62 + 0.28 * Math.sin(time * 3.2);
  }

  private syncLevers(): void {
    const live = new Set<number>();
    for (const id of this.layout.pieceIds()) {
      const p = this.layout.getPiece(id)!;
      const def = getPieceDef(p.type, p.flipped);
      if (this.layout.isLifted(id) || this.hidden.has(id)) continue;
      if (def.signal) {
        live.add(id);
        // A signal piece: its post beside the far end on the right of the way it guards (clear of a road where
        // there's room), the arm up at clear and level at red.
        const signal = this.signalPost(id);
        const post = signal.root.children[0];
        const along = Math.abs(def.connectors[1].pose.x);
        post.position.set(this.clearX(p, [along - 20, along - 44, along - 68], SWITCH_LEVER_OFFSET + 4), 0, SWITCH_LEVER_OFFSET + 4);
        post.rotation.y = 0;
        signal.arm.rotation.x = this.signalClear?.(id) === false ? 0 : -SIGNAL_RAISED;
        signal.root.matrix.copy(pieceMatrix(p.pose.x, p.y, p.pose.z, p.pose.heading));
        signal.root.updateMatrixWorld(true);
        continue;
      }
      if (!def.isSwitch) continue;
      live.add(id);
      let lever = this.levers.get(id);
      if (!lever) {
        lever = new Mesh(this.leverGeometry, this.mats.lacquer("#e6b52c"));
        lever.castShadow = true;
        lever.userData = { kind: "switch-lever", pieceId: id };
        this.group.add(lever);
        this.levers.set(id, lever);
      }
      // Lever stands beside the trunk on the side opposite the branch, leaning toward the active route: near the
      // trunk end, or further along where that's on a road (a switch over a level crossing).
      const branchSide = Math.sign(def.connectors[2].pose.z) || 1;
      const trunk = Math.abs(def.connectors[1].pose.x);
      const local = new Object3D();
      local.position.set(this.clearX(p, [30, 60, 90, 120, 150, 180, 6].filter((x) => x < trunk - 10), -branchSide * SWITCH_LEVER_OFFSET), 0, -branchSide * SWITCH_LEVER_OFFSET);
      // Two-way: leans toward the route set. Three-way: upright for straight on, leaning toward a curve.
      const state = this.layout.switchState(id);
      const lean = def.paths.filter((p) => p.from === 0).length === 3 ? (state === 0 ? 0 : state === 1 ? 1 : -1) * branchSide : (state === 1 ? 1 : -1) * branchSide;
      local.rotation.x = lean * 0.45;
      local.updateMatrix();
      lever.matrixAutoUpdate = false;
      lever.matrix.copy(pieceMatrix(p.pose.x, p.y, p.pose.z, p.pose.heading)).multiply(local.matrix);

      // Signal at the trunk end on the lever's side, its arm reaching away from the track.
      const signal = this.signalPost(id);
      const post = signal.root.children[0];
      post.position.set(this.clearX(p, [6, 54, 84, 114, 144].filter((x) => x < trunk - 10), -branchSide * (SWITCH_LEVER_OFFSET + 4)), 0, -branchSide * (SWITCH_LEVER_OFFSET + 4));
      // Arm geometry points along +z; turn it to reach away from the track, then raise it for the branch.
      post.rotation.y = branchSide > 0 ? Math.PI : 0;
      signal.arm.rotation.x = this.layout.switchState(id) !== 0 ? -SIGNAL_RAISED : 0;
      signal.root.matrix.copy(pieceMatrix(p.pose.x, p.y, p.pose.z, p.pose.heading));
      signal.root.updateMatrixWorld(true);
    }
    for (const [id, lever] of this.levers) {
      if (!live.has(id)) {
        this.group.remove(lever);
        this.levers.delete(id);
      }
    }
    for (const [id, signal] of this.signals) {
      if (!live.has(id)) {
        this.group.remove(signal.root);
        this.signals.delete(id);
      }
    }
  }

  /** A piece's semaphore (a switch's, or a signal piece's), made the first time it's wanted. */
  private signalPost(id: number): { root: Group; arm: Group } {
    let signal = this.signals.get(id);
    if (signal) return signal;
    const root = new Group();
    root.matrixAutoUpdate = false;
    const parts = this.signalParts;
    const post = new Group();
    post.add(this.part(parts.base, this.mats.naturalWood, id), this.part(parts.post, this.mats.lacquer("#f6f1e6"), id), this.part(parts.cap, this.mats.magnet, id));
    const arm = new Group();
    arm.position.y = SIGNAL_HEIGHT - 8;
    arm.add(this.part(parts.arm, this.mats.lacquer("#c8442f"), id), this.part(parts.stripe, this.mats.lacquer("#f6f1e6"), id));
    post.add(arm);
    root.add(post);
    this.group.add(root);
    signal = { root, arm };
    this.signals.set(id, signal);
    return signal;
  }

  /** A signal piece's semaphore on its own, as it stands on the piece (arm up): for the tray's picture. */
  signalModel(): Group {
    const parts = this.signalParts;
    const post = new Group();
    for (const [g, m] of [
      [parts.base, this.mats.naturalWood],
      [parts.post, this.mats.lacquer("#f6f1e6")],
      [parts.cap, this.mats.magnet],
    ] as const)
      post.add(new Mesh(g, m));
    const arm = new Group();
    arm.position.y = SIGNAL_HEIGHT - 8;
    arm.add(new Mesh(parts.arm, this.mats.lacquer("#c8442f")), new Mesh(parts.stripe, this.mats.lacquer("#f6f1e6")));
    arm.rotation.x = -SIGNAL_RAISED;
    post.add(arm);
    post.position.set(124, 0, SWITCH_LEVER_OFFSET + 4);
    return new Group().add(post);
  }

  /** Is this signal piece at clear (its arm up)? Set by the game from the sim's block working. */
  signalClear: ((pieceId: number) => boolean) | null = null;

  /** The first of `xs` (along the piece, at `z` across it) that isn't on a road; the first if all are. */
  private clearX(p: PlacedPiece, xs: readonly number[], z: number): number {
    const onRoad = this.onRoad;
    if (!onRoad) return xs[0];
    const c = Math.cos(p.pose.heading);
    const s = Math.sin(p.pose.heading);
    return xs.find((x) => !onRoad(p.pose.x + c * x - s * z, p.pose.z + s * x + c * z)) ?? xs[0];
  }

  /** A signal part; tapping it flips the switch, like the lever (a signal piece's: holds it at red, or lets it go). */
  private part(geometry: BufferGeometry, material: Material, pieceId: number): Mesh {
    const m = new Mesh(geometry, material);
    m.castShadow = true;
    m.userData = { kind: "switch-lever", pieceId };
    return m;
  }

  /**
   * Hide a piece while a stand-in animates in its place, and show it again when that's done. Counted, so two
   * overlapping animations (rotate twice quickly) keep it hidden until both finish. Re-syncs on change.
   */
  setHidden(id: number, hidden: boolean): void {
    const n = (this.hidden.get(id) ?? 0) + (hidden ? 1 : -1);
    if (n > 0) this.hidden.set(id, n);
    else this.hidden.delete(id);
    if ((n > 0) !== (n - (hidden ? 1 : -1) > 0)) {
      this.sync();
      this.onHidden?.();
    }
  }

  /** Is this piece hidden for now (a stand-in animating in its place)? */
  isHidden(id: number): boolean {
    return this.hidden.has(id);
  }

  /** Called when a piece is hidden or shown again (what's drawn with pieces follows: the kits' models). */
  onHidden: (() => void) | null = null;

  /**
   * Redraw pieces where they now are, their instances only (a run of track being pulled along: called on pointer
   * moves, so no rebuild). Pieces not drawn (lifted, hidden) are skipped.
   */
  moveInstances(ids: Iterable<number>): void {
    const m = new Matrix4();
    const moved = new Set(ids);
    this.placeEndBoards(moved);
    for (const id of moved) {
      const p = this.layout.getPiece(id);
      if (!p) continue;
      for (const entry of [...this.meshes.values(), ...(this.bufferMesh ? [this.bufferMesh] : [])]) {
        const i = entry.ids.indexOf(id);
        if (i === -1) continue;
        entry.mesh.setMatrixAt(i, pieceMatrix(p.pose.x, p.y, p.pose.z, p.pose.heading, m));
        entry.mesh.instanceMatrix.needsUpdate = true;
        entry.mesh.computeBoundingSphere();
      }
    }
    this.placePegs(moved);
    this.syncOutline();
  }

  /** Refresh only switch levers (after a switch flips). */
  syncSwitches(): void {
    this.syncLevers();
  }

  setHighlight(pieceId: number): void {
    this.setHighlights(pieceId === -1 ? [] : [pieceId], "select", false);
  }

  /** Outline these pieces (`tint`: and tint them: picked several), in a tone: selected, about to join track (`snap`), or can't go (`blocked`). */
  setHighlights(ids: Iterable<number>, tone: OutlineTone = "select", tint = true): void {
    const list = [...ids];
    const same = list.length === this.highlighted.length && list.every((id, i) => id === this.highlighted[i]);
    if (same && tone === this.tone && tint === this.tinted) return;
    this.tinted = tint;
    this.tone = tone;
    this.outlineMaterial.color.set(OUTLINE_TONES[tone]);
    this.toneColour.set(PICK_TINTS[tone]);
    // Several picked pieces are tinted too (an outline alone is hard to see from above).
    const was = this.highlighted;
    this.highlighted = list;
    this.recolour(new Set([...was, ...list]));
    if (!same) this.syncOutline();
  }

  /** Map a raycast hit to a piece id, or -1. */
  pieceAt(object: Object3D, instanceId: number | undefined): number {
    if (object.userData.kind === "switch-lever") return object.userData.pieceId as number;
    for (const { mesh, ids } of this.meshes.values()) if (mesh === object && instanceId !== undefined) return ids[instanceId];
    if (this.bufferMesh && this.bufferMesh.mesh === object && instanceId !== undefined) return this.bufferMesh.ids[instanceId];
    if (this.flagMeshes.includes(object as InstancedMesh) && instanceId !== undefined) return this.flagIds[instanceId];
    if (this.pegMesh && this.pegMesh === object && instanceId !== undefined) return this.pegOwners[instanceId];
    return -1;
  }

  /** Free this view's GPU buffers (piece geometry is a shared cache and is kept). */
  dispose(): void {
    for (const { mesh } of this.meshes.values()) mesh.dispose();
    this.meshes.clear();
    this.bufferMesh?.mesh.dispose();
    this.bufferMesh = null;
    this.pegMesh?.dispose();
    this.pegMesh = null;
    this.leverGeometry.dispose();
    this.outlineMaterial.dispose();
  }

  /**
   * Build every piece type's geometry in background workers, several at once (call during loading, before
   * `prebuild`, which then finds them ready). Resolves when all are in, or straight away where workers can't run.
   */
  /**
   * Start carving every kind of piece in background workers, largest first, then the taller arches; pieces saved
   * from an earlier visit to this build aren't carved again. Resolves once they're under way: `whenBuilt` waits for
   * (and hurries) the ones wanted now.
   */
  static async carveInBackground(types: readonly PieceTypeId[]): Promise<void> {
    for (const [store, list] of [["pieces", carving.pieces], ["arches", carving.arches]] as const) {
      for (const r of (await loadCached<PieceResult[]>(store, __BUILD_ID__)) ?? []) {
        if (!geometryCache.has(resultKey(r))) geometryCache.set(resultKey(r), geometryOf(r));
        list.push(r);
      }
    }
    // No workers: pieces are carved when first wanted (as before).
    if (carving.broken) return;
    const kinds = types.filter(carvedInBackground);
    const cost = (t: PieceTypeId) => getPieceDef(t, false).paths.reduce((n, p) => n + pathLength(p.geom), 0) * getPieceDef(t, false).paths.length;
    const jobs: PieceJob[] = kinds.map((t) => ({ type: t, levels: baseLevels(t) })).sort((a, b) => cost(b.type) - cost(a.type));
    for (const t of kinds) {
      if (!canStandOnArches(t)) continue;
      for (let levels = baseLevels(t) + 1; levels <= MAX_BRIDGE_LEVELS; levels++) {
        jobs.push({ type: t, levels });
        // Mirrored pieces are cheap to make from the plain one; a flip that swaps the ends is carved afresh.
        if (flipSwapsEnds(t)) jobs.push({ type: t, levels, flipped: true });
      }
    }
    carving.queue.push(...jobs.filter((j) => !geometryCache.has(resultKey(j))));
    carving.started = true;
    startWorkers(Math.max(1, Math.min((navigator.hardwareConcurrency || 4) - 1, 6)));
  }

  /** Resolves once this kind of piece is carved (not a stand-in): for pictures of it. */
  static whenBuilt(type: PieceTypeId): Promise<void> {
    const job = { type, levels: baseLevels(type) };
    if (geometryCache.has(resultKey(job)) || !carving.started || carving.broken || !carvedInBackground(type)) return Promise.resolve();
    return new Promise((resolve) => hurry(job, resolve));
  }

  /** Make sure these kinds of piece (both ways round) are ready, or waiting for their turn with a stand-in shown. */
  static prebuild(types: readonly PieceTypeId[]): void {
    for (const t of types) {
      const levels = baseLevels(t);
      carvedGeometry(t, false, levels);
      carvedGeometry(t, true, levels);
    }
  }
}

/** A piece's geometry built in a worker (or saved from an earlier visit). */
function geometryOf(r: PieceResult): BufferGeometry {
  const g = new BufferGeometry();
  for (const a of r.attributes) g.setAttribute(a.name, new BufferAttribute(a.array, a.itemSize));
  if (r.index) g.setIndex(new BufferAttribute(r.index, 1));
  for (const gr of r.groups) g.addGroup(gr.start, gr.count, gr.materialIndex);
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}

const resultKey = (r: PieceJob): string => `${r.type}:${r.flipped ? "f" : "n"}:${r.levels}${floorsKey(r.floors)}`;

/** A stand-in mesh for a piece (held, settling, shrinking away). Pass [face, groove] materials for real wood. */
export function ghostMesh(type: PieceTypeId, flipped: boolean, material: Material | Material[], levels = 0, floors: readonly number[] | null = null): Mesh {
  const mesh = new Mesh(pieceGeometry(type, flipped, levels, floors), material);
  mesh.renderOrder = 10;
  return mesh;
}

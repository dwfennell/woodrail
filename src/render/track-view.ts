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
import { canStandOnArches, flipSwapsEnds, getPieceDef, isBridge, pathLength, TRACK_THICKNESS, TRACK_WIDTH, type Layout, type PieceTypeId, type PlacedPiece } from "../track";
import { MAX_BRIDGE_LEVELS } from "../landscape";
import type { Materials } from "./materials";
import { rng } from "./textures";
import { BUFFER_EXTRA, buildBufferBlockGeometry, buildPieceGeometry, compactPiece } from "./track-geometry";
import type { PieceJob, PieceResult } from "./piece-worker";
import { loadCached, saveCached } from "./piece-cache";
import { drainQueue } from "./worker-queue";

const geometryCache = new Map<string, BufferGeometry>();
/** Selection outline colours: selected, about to join track, can't go there. */
const OUTLINE_TONES = { select: "#ffe489", snap: "#86ec7a", blocked: "#ff7461" } as const;
export type OutlineTone = keyof typeof OUTLINE_TONES;
/** Picked pieces' tint (multiplies the wood): golden, green when they'll join track, red when they can't go there. */
const PICK_TINTS: Record<OutlineTone, string> = { select: "#ffd36b", snap: "#9be38a", blocked: "#ff8f7d" };

const bufferBlockCache = new Map<string, BufferGeometry | null>();
/** A piece worker that hasn't answered in this long (ms) is given up, and what it had left is carved here. */
const WORKER_PATIENCE_MS = 20_000;

/**
 * The taller arches (bridges lifted higher, ramps raised) are carved in a background worker: all of them after
 * loading (`warmBridges`), and any wanted before then at the front of its queue. Until one's ready, a piece shows its
 * lowest arches; when it comes, `onArchesBuilt` listeners swap it in. Where no worker can run (or one has gone
 * silent), they're carved here when wanted, as before.
 */
const arches = {
  queue: [] as PieceJob[],
  /** Asked for and not yet come (keys as in the cache). */
  pending: new Set<string>(),
  running: false,
  /** No worker to be had: carve here. */
  broken: typeof Worker === "undefined",
  /** Kinds of piece taken in hand: their arches were moved up the queue. */
  hurried: new Set<PieceTypeId>(),
  /** Everything carved this visit, kept for the next (see `warmBridges`). */
  results: [] as PieceResult[],
  listeners: new Set<() => void>(),
};

/** Call `f` whenever arches asked for come from the worker (to swap them in for the stand-ins shown meanwhile). */
export function onArchesBuilt(f: () => void): () => void {
  arches.listeners.add(f);
  return () => arches.listeners.delete(f);
}

/** The arch heights every piece of this kind has from loading (a bridge's one level; none for a ramp). */
const baseLevels = (type: PieceTypeId) => (isBridge(type) ? 1 : 0);

function runArches(): void {
  if (arches.running || arches.broken || arches.queue.length === 0) return;
  let worker: Worker;
  try {
    worker = new Worker(new URL("./piece-worker.ts", import.meta.url), { type: "module" });
  } catch {
    arches.broken = true;
    return archesSettled();
  }
  arches.running = true;
  void drainQueue<PieceJob, PieceResult>(
    worker,
    arches.queue,
    (r) => {
      const key = resultKey(r);
      if (!geometryCache.has(key)) takeResult(r);
      arches.results.push(r);
      if (arches.pending.delete(key)) for (const f of arches.listeners) f();
    },
    WORKER_PATIENCE_MS,
    // Built here meanwhile: not needed.
    (job) => geometryCache.has(resultKey(job)),
  ).then(() => {
    arches.running = false;
    // Stopped with work left (it failed, or went silent): carve here from now on.
    if (arches.queue.length > 0 || arches.pending.size > 0) arches.broken = true;
    archesSettled();
  });
}

/** The worker's done (or gone): keep what it made for next time; anything still waited for is carved when next asked. */
function archesSettled(): void {
  if (!arches.broken) void saveCached("arches", __BUILD_ID__, arches.results);
  arches.queue.length = 0;
  if (arches.pending.size === 0) return;
  arches.pending.clear();
  for (const f of arches.listeners) f();
}

/** Arches wanted now: first in the worker's queue (with the rest of that kind's, nearest heights first, after it). */
function hurryArches(job: PieceJob): void {
  const key = resultKey(job);
  const q = arches.queue;
  if (!arches.hurried.has(job.type)) {
    arches.hurried.add(job.type);
    q.sort((a, b) => Number(b.type === job.type) - Number(a.type === job.type) || (a.type === job.type ? Math.abs(a.levels - job.levels) - Math.abs(b.levels - job.levels) : 0));
  }
  const at = q.findIndex((j) => resultKey(j) === key);
  if (at !== 0) q.unshift(at > 0 ? q.splice(at, 1)[0] : job);
  arches.pending.add(key);
  runArches();
}

/** A piece's geometry; `levels` is how many riser heights a bridge's arches reach below its deck. */
export function pieceGeometry(type: PieceTypeId, flipped: boolean, levels = 0): BufferGeometry {
  const def = getPieceDef(type, flipped);
  const plain = def === getPieceDef(type, false);
  const key = `${type}:${plain ? "n" : "f"}:${levels}`;
  let g = geometryCache.get(key);
  if (!g && !arches.broken && levels > baseLevels(type) && canStandOnArches(type)) {
    // Taller arches not carved yet: the worker does them (this one next) while the piece shows its lowest. (A mirrored
    // piece is made here from the plain one once that's come.)
    const job: PieceJob = !plain && flipSwapsEnds(type) ? { type, levels, flipped: true } : { type, levels };
    if (!geometryCache.has(resultKey(job))) {
      hurryArches(job);
      return pieceGeometry(type, flipped, baseLevels(type));
    }
  }
  if (!g) {
    // A mirrored piece is its plain shape reflected across its centre line: no need to carve it again.
    // A piece whose flip swaps its ends' peg and hole is carved as it is.
    g = def === getPieceDef(type, false) || flipSwapsEnds(type) ? compactPiece(buildPieceGeometry(def, levels)) : mirrored(pieceGeometry(type, false, levels));
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

/** Matrix placing piece-local geometry at a plan pose (plan x/z → world x/z; heading h → rotation.y = -h). */
export function pieceMatrix(x: number, y: number, z: number, heading: number, out = new Matrix4()): Matrix4 {
  return out.makeRotationY(-heading).setPosition(x, y, z);
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

/**
 * Draws a Layout with one InstancedMesh per piece variant. Call `sync()` after the layout changes.
 * Picking: `pieceAt(object, instanceId)` maps a raycast hit back to a piece id.
 */
export class TrackView {
  readonly group = new Group();
  private meshes = new Map<string, { mesh: InstancedMesh; ids: number[] }>();
  private bufferMesh: { mesh: InstancedMesh; ids: number[] } | null = null;
  private flagMeshes: InstancedMesh[] = [];
  private flagIds: number[] = [];
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

  constructor(
    private readonly layout: Layout,
    private readonly mats: Materials,
    /** How many riser heights a placed bridge's arches reach down (from the ground under it). */
    private readonly bridgeLevels: (piece: PlacedPiece) => number = () => 0,
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
      const key = `${p.type}|${def === getPieceDef(p.type, false) ? 0 : 1}|${this.bridgeLevels(p)}`;
      let list = groups.get(key);
      if (!list) groups.set(key, (list = []));
      list.push(id);
    }

    const m = new Matrix4();
    const bufferIds: number[] = [];
    for (const [key, ids] of groups) {
      const [type, flipped, levels] = key.split("|") as [PieceTypeId, string, string];
      const mesh = new InstancedMesh(pieceGeometry(type, flipped === "1", Number(levels)), [this.mats.track, this.mats.trackCut, this.mats.bridgePaint], ids.length);
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
      this.group.add(mesh);
      this.meshes.set(key, { mesh, ids });
      if (bufferBlock(type)) bufferIds.push(...ids);
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

    this.syncLevers();
    this.syncOutline();
  }

  /** Arches have come from the worker: pieces showing a stand-in take theirs (no rebuild of the rest). */
  archesBuilt(): void {
    for (const [key, { mesh }] of this.meshes) {
      const [type, flipped, levels] = key.split("|") as [PieceTypeId, string, string];
      const g = pieceGeometry(type, flipped === "1", Number(levels));
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
      const geometry = pieceGeometry(p.type, p.flipped, this.bridgeLevels(p));
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
    if ((n > 0) !== (n - (hidden ? 1 : -1) > 0)) this.sync();
  }

  /**
   * Redraw pieces where they now are, their instances only (a run of track being pulled along: called on pointer
   * moves, so no rebuild). Pieces not drawn (lifted, hidden) are skipped.
   */
  moveInstances(ids: Iterable<number>): void {
    const m = new Matrix4();
    for (const id of ids) {
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
    return -1;
  }

  /** Free this view's GPU buffers (piece geometry is a shared cache and is kept). */
  dispose(): void {
    for (const { mesh } of this.meshes.values()) mesh.dispose();
    this.meshes.clear();
    this.bufferMesh?.mesh.dispose();
    this.bufferMesh = null;
    this.leverGeometry.dispose();
    this.outlineMaterial.dispose();
  }

  /**
   * Build every piece type's geometry in background workers, several at once (call during loading, before
   * `prebuild`, which then finds them ready). Resolves when all are in, or straight away where workers can't run.
   */
  static async prebuildInWorkers(types: readonly PieceTypeId[], onProgress?: (done: number, total: number) => void): Promise<void> {
    if (typeof Worker === "undefined") return;
    const results: PieceResult[] = [];
    const take = (r: PieceResult) => {
      takeResult(r);
      results.push(r);
    };
    // Saved from an earlier visit to this same build: nothing to carve.
    for (const r of (await loadCached<PieceResult[]>("pieces", __BUILD_ID__)) ?? []) take(r);
    const jobs: PieceJob[] = types.filter((t) => !geometryCache.has(`${t}:n:${isBridge(t) ? 1 : 0}`)).map((t) => ({ type: t, levels: isBridge(t) ? 1 : 0 }));
    if (jobs.length === 0) return;
    const total = jobs.length;
    let done = 0;
    onProgress?.(0, total);
    // Largest first, so the slow ones don't finish last on their own.
    const cost = (t: PieceTypeId) => getPieceDef(t, false).paths.reduce((n, p) => n + pathLength(p.geom), 0) * getPieceDef(t, false).paths.length;
    jobs.sort((a, b) => cost(b.type) - cost(a.type));
    const count = Math.max(1, Math.min(jobs.length, (navigator.hardwareConcurrency || 4) - 1, 6));
    // A worker that fails, or goes silent, leaves its pieces to be built on the main thread (`prebuild`): loading
    // never waits on it for ever.
    const run = (worker: Worker) =>
      drainQueue<PieceJob, PieceResult>(worker, jobs, (r) => {
        take(r);
        onProgress?.(++done, total);
      }, WORKER_PATIENCE_MS);
    try {
      await Promise.all(Array.from({ length: count }, () => run(new Worker(new URL("./piece-worker.ts", import.meta.url), { type: "module" }))));
    } catch {
      // No module workers here: `prebuild` does it all.
      return;
    }
    // Keep them for next time (in the background: the game needn't wait for the save).
    if (results.length === types.length) void saveCached("pieces", __BUILD_ID__, results);
  }

  /** Warm the CSG geometry cache for every piece type (call during loading). */
  static prebuild(types: readonly PieceTypeId[]): void {
    for (const t of types) {
      const levels = isBridge(t) ? 1 : 0;
      pieceGeometry(t, false, levels);
      pieceGeometry(t, true, levels);
    }
  }

  /**
   * Build the taller bridges' (and raised ramps') arches after loading, so lifting a bridge higher never stalls: in one
   * background worker (the carving would otherwise keep the main thread busy for seconds after start-up), kept for the
   * next visit to this build. Where workers can't run, they're built when first wanted.
   */
  static async warmBridges(types: readonly PieceTypeId[]): Promise<void> {
    if (arches.broken) return;
    for (const r of (await loadCached<PieceResult[]>("arches", __BUILD_ID__)) ?? []) {
      if (!geometryCache.has(resultKey(r))) takeResult(r);
      arches.results.push(r);
    }
    const queued = new Set(arches.queue.map(resultKey));
    const want = (job: PieceJob) => {
      if (!geometryCache.has(resultKey(job)) && !queued.has(resultKey(job))) arches.queue.push(job);
    };
    for (const t of types) {
      if (!canStandOnArches(t)) continue;
      for (let levels = baseLevels(t) + 1; levels <= MAX_BRIDGE_LEVELS; levels++) {
        want({ type: t, levels });
        // Mirrored pieces are cheap to make from the plain one; a flip that swaps the ends is carved afresh.
        if (flipSwapsEnds(t)) want({ type: t, levels, flipped: true });
      }
    }
    runArches();
  }

}

/** A piece's geometry built in a worker (or saved from an earlier visit), into the cache. */
function takeResult(r: PieceResult): void {
  const g = new BufferGeometry();
  for (const a of r.attributes) g.setAttribute(a.name, new BufferAttribute(a.array, a.itemSize));
  if (r.index) g.setIndex(new BufferAttribute(r.index, 1));
  for (const gr of r.groups) g.addGroup(gr.start, gr.count, gr.materialIndex);
  g.computeBoundingBox();
  g.computeBoundingSphere();
  geometryCache.set(resultKey(r), g);
}

const resultKey = (r: PieceJob): string => `${r.type}:${r.flipped ? "f" : "n"}:${r.levels}`;

/** A stand-in mesh for a piece (held, settling, shrinking away). Pass [face, groove] materials for real wood. */
export function ghostMesh(type: PieceTypeId, flipped: boolean, material: Material | Material[], levels = 0): Mesh {
  const mesh = new Mesh(pieceGeometry(type, flipped, levels), material);
  mesh.renderOrder = 10;
  return mesh;
}

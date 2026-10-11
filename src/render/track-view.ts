import {
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
import { getPieceDef, TRACK_THICKNESS, TRACK_WIDTH, type Layout, type PieceTypeId } from "../track";
import type { Materials } from "./materials";
import { rng } from "./textures";
import { buildBufferBlockGeometry, buildPieceGeometry } from "./track-geometry";

const geometryCache = new Map<string, BufferGeometry>();
const bufferBlockCache = new Map<string, BufferGeometry | null>();

export function pieceGeometry(type: PieceTypeId, flipped: boolean): BufferGeometry {
  const def = getPieceDef(type, flipped);
  const key = `${type}:${def === getPieceDef(type, false) ? "n" : "f"}`;
  let g = geometryCache.get(key);
  if (!g) {
    g = buildPieceGeometry(def);
    geometryCache.set(key, g);
  }
  return g;
}

function bufferBlock(type: PieceTypeId): BufferGeometry | null {
  if (!bufferBlockCache.has(type)) bufferBlockCache.set(type, buildBufferBlockGeometry(getPieceDef(type, false)));
  return bufferBlockCache.get(type)!;
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
  private levers = new Map<number, Mesh>();
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
  private highlighted = -1;
  /** Pieces drawn elsewhere for now (stand-in meshes animating in their place), with how many stand-ins each. */
  private readonly hidden = new Map<number, number>();
  private readonly leverGeometry = switchLeverGeometry();

  constructor(
    private readonly layout: Layout,
    private readonly mats: Materials,
  ) {}

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

    const groups = new Map<string, number[]>();
    for (const id of this.layout.pieceIds()) {
      if (this.layout.isLifted(id) || this.hidden.has(id)) continue;
      const p = this.layout.getPiece(id)!;
      const def = getPieceDef(p.type, p.flipped);
      const key = `${p.type}|${def === getPieceDef(p.type, false) ? 0 : 1}`;
      let list = groups.get(key);
      if (!list) groups.set(key, (list = []));
      list.push(id);
    }

    const m = new Matrix4();
    const bufferIds: number[] = [];
    for (const [key, ids] of groups) {
      const [type, flipped] = key.split("|") as [PieceTypeId, string];
      const mesh = new InstancedMesh(pieceGeometry(type, flipped === "1"), [this.mats.track, this.mats.trackCut, this.mats.bridgePaint], ids.length);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      ids.forEach((id, i) => {
        const p = this.layout.getPiece(id)!;
        mesh.setMatrixAt(i, pieceMatrix(p.pose.x, p.y, p.pose.z, p.pose.heading, m));
        mesh.setColorAt(i, this.tintFor(id));
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
      const mesh = new InstancedMesh(bufferBlock("buffer")!, this.mats.lacquer("#c8442f"), bufferIds.length);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      bufferIds.forEach((id, i) => {
        const p = this.layout.getPiece(id)!;
        mesh.setMatrixAt(i, pieceMatrix(p.pose.x, p.y, p.pose.z, p.pose.heading, m));
      });
      mesh.userData.kind = "track";
      this.group.add(mesh);
      this.bufferMesh = { mesh, ids: bufferIds };
    }

    this.syncLevers();
    this.syncOutline();
  }

  private outline: Mesh | null = null;
  private readonly outlineMaterial = new MeshBasicMaterial({ color: new Color("#fff1c2"), side: BackSide, transparent: true, opacity: 0.85, depthWrite: false });

  /**
   * The selected piece gets a soft light outline: its own shape drawn back-faces-only, a little larger, so only a
   * rim shows around the edges.
   */
  private syncOutline(): void {
    const p = this.highlighted === -1 || this.hidden.has(this.highlighted) ? undefined : this.layout.getPiece(this.highlighted);
    if (!p || this.layout.isLifted(this.highlighted)) {
      if (this.outline) this.outline.visible = false;
      return;
    }
    const geometry = pieceGeometry(p.type, p.flipped);
    if (!this.outline) {
      this.outline = new Mesh(geometry, this.outlineMaterial);
      this.outline.matrixAutoUpdate = false;
      this.outline.renderOrder = 2;
      this.group.add(this.outline);
    }
    this.outline.geometry = geometry;
    this.outline.visible = true;
    geometry.computeBoundingBox();
    const box = geometry.boundingBox ?? new Box3();
    const size = box.getSize(new Vector3());
    const centre = box.getCenter(new Vector3());
    const grow = 2.4;
    // Scale about the piece's own centre so the shell stands evenly proud of every side.
    const scale = new Matrix4().makeTranslation(centre.x, centre.y, centre.z)
      .multiply(new Matrix4().makeScale((size.x + grow * 2) / size.x, (size.y + grow) / size.y, (size.z + grow * 2) / size.z))
      .multiply(new Matrix4().makeTranslation(-centre.x, -centre.y, -centre.z));
    this.outline.matrix.copy(pieceMatrix(p.pose.x, p.y, p.pose.z, p.pose.heading)).multiply(scale);
  }

  /** Gentle breathing of the selection outline (call per frame with elapsed seconds). */
  pulse(time: number): void {
    if (this.outline?.visible) this.outlineMaterial.opacity = 0.62 + 0.28 * Math.sin(time * 3.2);
  }

  private syncLevers(): void {
    const live = new Set<number>();
    for (const id of this.layout.pieceIds()) {
      const p = this.layout.getPiece(id)!;
      const def = getPieceDef(p.type, p.flipped);
      if (!def.isSwitch || this.layout.isLifted(id) || this.hidden.has(id)) continue;
      live.add(id);
      let lever = this.levers.get(id);
      if (!lever) {
        lever = new Mesh(this.leverGeometry, this.mats.lacquer("#e6b52c"));
        lever.castShadow = true;
        lever.userData = { kind: "switch-lever", pieceId: id };
        this.group.add(lever);
        this.levers.set(id, lever);
      }
      // Lever stands beside the trunk on the side opposite the branch, leaning toward the active route.
      const branchSide = Math.sign(def.connectors[2].pose.z) || 1;
      const local = new Object3D();
      local.position.set(30, TRACK_THICKNESS * 0 + 0, -branchSide * SWITCH_LEVER_OFFSET);
      local.rotation.x = (this.layout.switchState(id) === 1 ? 1 : -1) * branchSide * 0.45;
      local.updateMatrix();
      lever.matrixAutoUpdate = false;
      lever.matrix.copy(pieceMatrix(p.pose.x, p.y, p.pose.z, p.pose.heading)).multiply(local.matrix);

      // Signal at the trunk end on the lever's side, its arm reaching away from the track.
      let signal = this.signals.get(id);
      if (!signal) {
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
      }
      const post = signal.root.children[0];
      post.position.set(6, 0, -branchSide * (SWITCH_LEVER_OFFSET + 4));
      // Arm geometry points along +z; turn it to reach away from the track, then raise it for the branch.
      post.rotation.y = branchSide > 0 ? Math.PI : 0;
      signal.arm.rotation.x = this.layout.switchState(id) === 1 ? -SIGNAL_RAISED : 0;
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

  /** A signal part; tapping it flips the switch, like the lever. */
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

  /** Refresh only switch levers (after a switch flips). */
  syncSwitches(): void {
    this.syncLevers();
  }

  setHighlight(pieceId: number): void {
    if (this.highlighted === pieceId) return;
    this.highlighted = pieceId;
    this.syncOutline();
  }

  /** Map a raycast hit to a piece id, or -1. */
  pieceAt(object: Object3D, instanceId: number | undefined): number {
    if (object.userData.kind === "switch-lever") return object.userData.pieceId as number;
    for (const { mesh, ids } of this.meshes.values()) if (mesh === object && instanceId !== undefined) return ids[instanceId];
    if (this.bufferMesh && this.bufferMesh.mesh === object && instanceId !== undefined) return this.bufferMesh.ids[instanceId];
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

  /** Warm the CSG geometry cache for every piece type (call during loading). */
  static prebuild(types: readonly PieceTypeId[]): void {
    for (const t of types) {
      pieceGeometry(t, false);
      pieceGeometry(t, true);
    }
  }
}

/** A stand-in mesh for a piece (held, settling, shrinking away). Pass [face, groove] materials for real wood. */
export function ghostMesh(type: PieceTypeId, flipped: boolean, material: Material | Material[]): Mesh {
  const mesh = new Mesh(pieceGeometry(type, flipped), material);
  mesh.renderOrder = 10;
  return mesh;
}

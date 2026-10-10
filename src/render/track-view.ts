import {
  BufferGeometry,
  Color,
  CylinderGeometry,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  Object3D,
  SphereGeometry,
  type Material,
} from "three";
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
  private readonly tints = new Map<number, Color>();
  private highlighted = -1;
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
      const mesh = new InstancedMesh(pieceGeometry(type, flipped === "1"), [this.mats.track, this.mats.trackCut], ids.length);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      ids.forEach((id, i) => {
        const p = this.layout.getPiece(id)!;
        mesh.setMatrixAt(i, pieceMatrix(p.pose.x, p.y, p.pose.z, p.pose.heading, m));
        mesh.setColorAt(i, id === this.highlighted ? new Color(1.25, 1.12, 0.85) : this.tintFor(id));
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
  }

  private syncLevers(): void {
    const live = new Set<number>();
    for (const id of this.layout.pieceIds()) {
      const p = this.layout.getPiece(id)!;
      const def = getPieceDef(p.type, p.flipped);
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
      // Lever stands beside the trunk on the side opposite the branch, leaning toward the active route.
      const branchSide = Math.sign(def.connectors[2].pose.z) || 1;
      const local = new Object3D();
      local.position.set(30, TRACK_THICKNESS * 0 + 0, -branchSide * SWITCH_LEVER_OFFSET);
      local.rotation.x = (this.layout.switchState(id) === 1 ? 1 : -1) * branchSide * 0.45;
      local.updateMatrix();
      lever.matrixAutoUpdate = false;
      lever.matrix.copy(pieceMatrix(p.pose.x, p.y, p.pose.z, p.pose.heading)).multiply(local.matrix);
    }
    for (const [id, lever] of this.levers) {
      if (!live.has(id)) {
        this.group.remove(lever);
        this.levers.delete(id);
      }
    }
  }

  /** Refresh only switch levers (after a switch flips). */
  syncSwitches(): void {
    this.syncLevers();
  }

  setHighlight(pieceId: number): void {
    if (this.highlighted === pieceId) return;
    this.highlighted = pieceId;
    this.sync();
  }

  /** Map a raycast hit to a piece id, or -1. */
  pieceAt(object: Object3D, instanceId: number | undefined): number {
    if (object.userData.kind === "switch-lever") return object.userData.pieceId as number;
    for (const { mesh, ids } of this.meshes.values()) if (mesh === object && instanceId !== undefined) return ids[instanceId];
    if (this.bufferMesh && this.bufferMesh.mesh === object && instanceId !== undefined) return this.bufferMesh.ids[instanceId];
    return -1;
  }

  /** Warm the CSG geometry cache for every piece type (call during loading). */
  static prebuild(types: readonly PieceTypeId[]): void {
    for (const t of types) {
      pieceGeometry(t, false);
      pieceGeometry(t, true);
    }
  }
}

/** A translucent preview of a piece while dragging. */
export function ghostMesh(type: PieceTypeId, flipped: boolean, material: Material): Mesh {
  const mesh = new Mesh(pieceGeometry(type, flipped), material);
  mesh.renderOrder = 10;
  return mesh;
}

import { CanvasTexture, Euler, Frustum, Group, InstancedMesh, Matrix4, MeshBasicMaterial, PlaneGeometry, Quaternion, Sphere, Vector3, type Camera } from "three";
import { VEHICLE_CAP, type RoadVehicles, type VehicleKind } from "../roads/vehicles";
import { modelKey, type PropLibrary } from "./props/library";

/** The catalogue models (they face +x and stand on y = 0, about 70–85 mm long: drawn at `SCALE`). */
export const VEHICLE_ASSET: Record<VehicleKind, string> = { van: "veh-delivery-van", bus: "veh-town-bus" };
/** Drawn at about half the catalogue's size: a van fits its side of a road (felt 56 mm wide). */
const SCALE = 0.5;
/** Room round a vehicle's middle for the whole of it, asking if it's in view. */
const REACH = 60;
const KINDS: readonly VehicleKind[] = ["van", "bus"];
const CAP = VEHICLE_CAP.van + VEHICLE_CAP.bus;

const m4 = new Matrix4();
const q = new Quaternion();
const e = new Euler(0, 0, 0, "YZX");
const p = new Vector3();
const s = new Vector3();
const frustum = new Frustum();
const viewProj = new Matrix4();
const sphere = new Sphere();

function blobTexture(): CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, 64, 64);
  const g = ctx.createRadialGradient(32, 32, 6, 32, 32, 32);
  g.addColorStop(0, "#fff");
  g.addColorStop(0.6, "#9a9a9a");
  g.addColorStop(1, "#000");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  return new CanvasTexture(c);
}

interface Model {
  meshes: InstancedMesh[];
  /** Half its length and width on the ground, drawn (for its blob shadow). */
  hl: number;
  hw: number;
}

/**
 * Road vehicles drawn (roads spec §3): one `InstancedMesh` per model part (the van's and the bus's, each one draw call
 * however many there are), and one more for every vehicle's baked blob shadow under it. They cast no shadows (never a
 * shadow pass for a moving van). Poses are written only when `RoadVehicles.version` changed, and a frame is asked for
 * only while a vehicle in view moves: a parked van is a still instance, costing nothing.
 */
export class RoadVehiclesView {
  readonly group = new Group();
  private readonly models = new Map<VehicleKind, Model | null>();
  private readonly blobs: InstancedMesh;
  private seen = -1;
  private seenList: RoadVehicles | null = null;
  /** A moving vehicle was in view at the last update (its leaving the view is drawn too). */
  private wasInView = false;
  /** Where each vehicle was when last posed (x, z, heading). */
  private readonly drawnAt = new WeakMap<object, [number, number, number]>();

  constructor(
    private readonly library: PropLibrary,
    private readonly invalidate: () => void,
  ) {
    this.group.name = "road-vehicles";
    const plane = new PlaneGeometry(2, 2).rotateX(-Math.PI / 2);
    const material = new MeshBasicMaterial({ color: 0x000000, alphaMap: blobTexture(), transparent: true, opacity: 0.42, depthWrite: false });
    this.blobs = new InstancedMesh(plane, material, CAP);
    this.blobs.count = 0;
    this.blobs.visible = false;
    this.blobs.renderOrder = 1;
    this.blobs.frustumCulled = false;
    this.blobs.castShadow = false;
    this.blobs.receiveShadow = false;
    this.group.add(this.blobs);
  }

  /** Draw calls this costs now (for measuring): one per model part shown, and the blobs'. */
  get drawCalls(): number {
    let n = this.blobs.visible ? 1 : 0;
    for (const m of this.models.values()) for (const mesh of m?.meshes ?? []) if (mesh.visible) n++;
    return n;
  }

  private load(kind: VehicleKind): void {
    if (this.models.has(kind)) return;
    this.models.set(kind, null);
    void this.library.load(modelKey(VEHICLE_ASSET[kind])).then((model) => {
      if (!model) return;
      const meshes = model.parts.map((part) => {
        const mesh = new InstancedMesh(part.geometry, part.material, VEHICLE_CAP[kind]);
        mesh.count = 0;
        mesh.visible = false;
        mesh.frustumCulled = false;
        mesh.castShadow = false;
        mesh.receiveShadow = true;
        this.group.add(mesh);
        return mesh;
      });
      const f = model.footprint;
      this.models.set(kind, { meshes, hl: f.hw * SCALE, hw: f.hd * SCALE });
      this.seen = -1;
      this.invalidate();
    });
  }

  /**
   * Pose the vehicles if any moved (or came or went) since the last call. True while a moving one is in view (keep
   * drawing frames), or once when the drawn set changed.
   */
  update(vehicles: RoadVehicles, camera: Camera): boolean {
    if (vehicles === this.seenList && vehicles.version === this.seen) return false;
    this.seenList = vehicles;
    this.seen = vehicles.version;
    for (const v of vehicles.list) this.load(v.kind);
    let changed = false;
    let blob = 0;
    for (const kind of KINDS) {
      const model = this.models.get(kind);
      let n = 0;
      for (const v of vehicles.list) {
        if (v.kind !== kind) continue;
        e.set(0, v.heading, v.pitch);
        q.setFromEuler(e);
        m4.compose(p.set(v.x, v.y, v.z), q, s.set(SCALE, SCALE, SCALE));
        if (model) for (const mesh of model.meshes) mesh.setMatrixAt(n, m4);
        n++;
        if (model) {
          m4.compose(p.set(v.x, v.y + 0.3, v.z), q, s.set(model.hl + 3, 1, model.hw + 3));
          this.blobs.setMatrixAt(blob++, m4);
        }
      }
      if (!model) continue;
      for (const mesh of model.meshes) {
        if (mesh.count !== n) changed = true;
        mesh.count = n;
        mesh.visible = n > 0;
        mesh.instanceMatrix.needsUpdate = true;
      }
    }
    if (this.blobs.count !== blob) changed = true;
    this.blobs.count = blob;
    this.blobs.visible = blob > 0;
    this.blobs.instanceMatrix.needsUpdate = true;
    // In view? Only a vehicle that moved since it was last drawn asks for a frame (one out of view moves on unseen).
    viewProj.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    frustum.setFromProjectionMatrix(viewProj);
    let inView = false;
    for (const v of vehicles.list) {
      const was = this.drawnAt.get(v);
      if (was && was[0] === v.x && was[1] === v.z && was[2] === v.heading) continue;
      this.drawnAt.set(v, [v.x, v.z, v.heading]);
      if (!inView && frustum.intersectsSphere(sphere.set(p.set(v.x, v.y, v.z), REACH))) inView = true;
    }
    const draw = inView || this.wasInView || changed;
    this.wasInView = inView;
    return draw;
  }

  dispose(): void {
    for (const m of this.models.values()) for (const mesh of m?.meshes ?? []) mesh.dispose();
    this.blobs.dispose();
    (this.blobs.material as MeshBasicMaterial).alphaMap?.dispose();
    (this.blobs.material as MeshBasicMaterial).dispose();
  }
}

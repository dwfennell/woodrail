import { DoubleSide, Group, InstancedMesh, Matrix4, MeshBasicMaterial, Quaternion, RingGeometry, Vector3 } from "three";

/**
 * While a route is planned, a soft cream ring round each place a route can stop at (an industry's yard, a town's
 * station), so it's plain what a tap on the map can pick (the user, 2026-11-06: "click on the town/mill/etc"). Two
 * instanced meshes, one ring and its thin dark edge for the beech and the grass: two draws while planning, none else.
 * Built only when the places change (`show` compares a key); still, so it asks for no frames of its own.
 */
export class PlaceRings {
  readonly group = new Group();
  private readonly ringGeo = new RingGeometry(0.88, 1, 48, 1);
  private readonly edgeGeo = new RingGeometry(1, 1.07, 48, 1);
  private readonly ringMat = new MeshBasicMaterial({ color: 0xfff4d6, transparent: true, opacity: 0.85, depthWrite: false, side: DoubleSide });
  private readonly edgeMat = new MeshBasicMaterial({ color: 0x5e4128, transparent: true, opacity: 0.45, depthWrite: false, side: DoubleSide });
  private meshes: InstancedMesh[] = [];
  private key = "";

  constructor() {
    this.group.name = "place-rings";
    this.group.visible = false;
    this.group.renderOrder = 2;
  }

  /** Rings at these spots (ground point and radius, mm); an empty list hides them. True if anything changed. */
  show(spots: readonly { x: number; y: number; z: number; r: number }[]): boolean {
    const key = spots.map((s) => `${Math.round(s.x)},${Math.round(s.y)},${Math.round(s.z)},${Math.round(s.r)}`).join(";");
    if (key === this.key) return false;
    this.key = key;
    this.clear();
    if (spots.length === 0) return true;
    const flat = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), -Math.PI / 2);
    const m = new Matrix4();
    for (const [geo, mat] of [
      [this.ringGeo, this.ringMat],
      [this.edgeGeo, this.edgeMat],
    ] as const) {
      const mesh = new InstancedMesh(geo, mat, spots.length);
      spots.forEach((s, i) => mesh.setMatrixAt(i, m.compose(new Vector3(s.x, s.y + 3, s.z), flat, new Vector3(s.r, s.r, s.r))));
      mesh.instanceMatrix.needsUpdate = true;
      mesh.frustumCulled = false;
      mesh.renderOrder = 2;
      this.meshes.push(mesh);
      this.group.add(mesh);
    }
    this.group.visible = true;
    return true;
  }

  private clear(): void {
    for (const mesh of this.meshes) {
      this.group.remove(mesh);
      mesh.dispose();
    }
    this.meshes = [];
    this.group.visible = false;
  }

  dispose(): void {
    this.clear();
    this.ringGeo.dispose();
    this.edgeGeo.dispose();
    this.ringMat.dispose();
    this.edgeMat.dispose();
  }
}

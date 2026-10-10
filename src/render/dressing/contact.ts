import { CanvasTexture, InstancedMesh, Matrix4, MeshBasicMaterial, PlaneGeometry, Quaternion, Vector3 } from "three";

export interface Footprint {
  x: number;
  z: number;
  /** Ground height the object stands on. */
  y: number;
  /** Half extents of the soft shadow (mm) and its heading. */
  rx: number;
  rz: number;
  heading: number;
  strength: number;
}

function blobTexture(): CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const ctx = c.getContext("2d")!;
  // Alpha maps read brightness: white = opaque shadow at the centre, fading to black.
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, 64, 64);
  const g = ctx.createRadialGradient(32, 32, 4, 32, 32, 32);
  g.addColorStop(0, "#fff");
  g.addColorStop(0.55, "#8c8c8c");
  g.addColorStop(1, "#000");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  return new CanvasTexture(c);
}

/**
 * Soft dark blobs on the ground under objects: cheap contact shadows that settle scenery into the felt on devices
 * without screen-space ambient occlusion. One instanced draw call.
 */
export function buildContactShadows(prints: readonly Footprint[]): InstancedMesh {
  const plane = new PlaneGeometry(2, 2);
  plane.rotateX(-Math.PI / 2);
  const material = new MeshBasicMaterial({ color: 0x000000, alphaMap: blobTexture(), transparent: true, opacity: 0.38, depthWrite: false });
  const mesh = new InstancedMesh(plane, material, Math.max(1, prints.length));
  mesh.count = prints.length;
  mesh.renderOrder = 1;
  const m = new Matrix4();
  const q = new Quaternion();
  const up = new Vector3(0, 1, 0);
  const p = new Vector3();
  const s = new Vector3();
  prints.forEach((f, i) => {
    q.setFromAxisAngle(up, -f.heading);
    // Weaker shadows are also smaller.
    const k = 0.6 + 0.4 * f.strength;
    m.compose(p.set(f.x, f.y + 0.35, f.z), q, s.set(f.rx * k, 1, f.rz * k));
    mesh.setMatrixAt(i, m);
  });
  return mesh;
}

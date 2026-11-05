import { BufferGeometry, DoubleSide, Float32BufferAttribute, Group, Mesh, MeshBasicMaterial } from "three";
import { connectorRef, createSample, getPieceDef, pathLength, pieceOfRef, samplePath, TUNNEL_COVER, type Layout } from "../track";

/** The line drawn this wide (mm), this far over the ground, in the metro's blue. */
const WIDTH = 9;
const LIFT = 6;
const STEP = 12;

/**
 * A metro stop's line, shown through the ground (its card's Show the line): the track two levels under the felt that
 * joins it, followed from the stop along its joints (and the tunnel mouths at its ends), drawn as a blue ribbon over
 * everything for a few seconds. Built when asked, one mesh; nothing per frame.
 */
export class MetroLineView {
  readonly group = new Group();
  private readonly material = new MeshBasicMaterial({ color: "#2f6db5", transparent: true, opacity: 0.85, depthTest: false, depthWrite: false, side: DoubleSide });
  private mesh: Mesh | null = null;
  /** The pieces last drawn (tests, the pictures). */
  pieces: number[] = [];

  constructor() {
    this.group.renderOrder = 20;
  }

  /** Draw the line through the stop on piece `pieceId`. */
  show(layout: Layout, pieceId: number): void {
    this.hide();
    this.pieces = lineOf(layout, pieceId);
    const pos: number[] = [];
    const a = createSample();
    const b = createSample();
    for (const id of this.pieces) {
      const p = layout.getPiece(id)!;
      const c = Math.cos(p.pose.heading);
      const s = Math.sin(p.pose.heading);
      for (const path of getPieceDef(p.type, p.flipped).paths) {
        const len = pathLength(path.geom);
        for (let d = 0; d < len; d += STEP) {
          samplePath(path.geom, d, a);
          samplePath(path.geom, Math.min(len, d + STEP), b);
          const ax = p.pose.x + c * a.x - s * a.z;
          const az = p.pose.z + s * a.x + c * a.z;
          const bx = p.pose.x + c * b.x - s * b.z;
          const bz = p.pose.z + s * b.x + c * b.z;
          const dx = bx - ax;
          const dz = bz - az;
          const l = Math.hypot(dx, dz) || 1;
          const nx = (-dz / l) * (WIDTH / 2);
          const nz = (dx / l) * (WIDTH / 2);
          // (On the felt over it, whatever its depth: read from above as the line's way across the town.)
          pos.push(ax + nx, LIFT, az + nz, ax - nx, LIFT, az - nz, bx + nx, LIFT, bz + nz, bx + nx, LIFT, bz + nz, ax - nx, LIFT, az - nz, bx - nx, LIFT, bz - nz);
        }
      }
    }
    const g = new BufferGeometry();
    g.setAttribute("position", new Float32BufferAttribute(pos, 3));
    this.mesh = new Mesh(g, this.material);
    this.mesh.renderOrder = 20;
    this.group.add(this.mesh);
  }

  hide(): void {
    if (!this.mesh) return;
    this.group.remove(this.mesh);
    this.mesh.geometry.dispose();
    this.mesh = null;
  }

  get shown(): boolean {
    return this.mesh !== null;
  }
}

/** The pieces of a metro line: from the stop, along joints, every piece under the felt and the mouths down to it. */
export function lineOf(layout: Layout, pieceId: number): number[] {
  const seen = new Set<number>();
  const todo = [pieceId];
  while (todo.length > 0) {
    const id = todo.pop()!;
    if (seen.has(id)) continue;
    const p = layout.getPiece(id);
    if (!p) continue;
    const def = getPieceDef(p.type, p.flipped);
    // (Under the felt: the line's own. A piece reaching the felt (a mouth) is its end: drawn, not gone past.)
    const lowest = Math.min(...def.connectors.map((c) => p.y + c.y));
    if (lowest > -TUNNEL_COVER + 0.5) continue;
    seen.add(id);
    const deep = def.connectors.every((c) => p.y + c.y <= -TUNNEL_COVER + 0.5);
    if (!deep && id !== pieceId) continue;
    for (let k = 0; k < def.connectors.length; k++) {
      const other = layout.joinedConnector(connectorRef(id, k));
      if (other !== -1) todo.push(pieceOfRef(other));
    }
  }
  return [...seen];
}

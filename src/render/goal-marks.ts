import { Color, DoubleSide, Group, Mesh, MeshBasicMaterial, RingGeometry, type Scene } from "three";
import type { Flourish } from "./flourishes";

/** How long the marks pulse (s). */
const LIFE = 3.2;
/** Ring radius (mm): about a station's half length, so it reads round a depot or a train. */
const RADIUS = 190;
/** A square's ring: round one new building. */
export const SQUARE_RING = 60;

/**
 * "Show me": rings on the ground that ripple out from each place a goal points at, three times, then fade. Built on
 * demand and thrown away afterwards, so they cost nothing when not showing.
 */
export function goalMarks(scene: Scene, points: readonly { x: number; y: number; z: number }[], radius = RADIUS): Flourish | null {
  if (points.length === 0) return null;
  const geometry = new RingGeometry(radius * 0.7, radius, 48);
  geometry.rotateX(-Math.PI / 2);
  const material = new MeshBasicMaterial({ color: new Color("#ffcf6b"), transparent: true, depthWrite: false, side: DoubleSide });
  const group = new Group();
  const rings: Mesh[] = [];
  for (const p of points) {
    for (let k = 0; k < 2; k++) {
      const ring = new Mesh(geometry, k === 0 ? material : material.clone());
      ring.position.set(p.x, p.y + 4, p.z);
      ring.renderOrder = 10;
      rings.push(ring);
      group.add(ring);
    }
  }
  scene.add(group);
  let t = 0;
  return {
    update(dt) {
      t += dt;
      const fade = Math.min(1, (LIFE - t) / 0.6);
      for (let i = 0; i < rings.length; i++) {
        // Two rings per place, half a beat apart: one ripple after another.
        const beat = ((t / 1.05 + (i % 2) * 0.5) % 1 + 1) % 1;
        rings[i].scale.setScalar(0.45 + beat * 1.1);
        (rings[i].material as MeshBasicMaterial).opacity = Math.max(0, (1 - beat) * 0.9 * fade);
      }
      return t < LIFE;
    },
    dispose() {
      scene.remove(group);
      geometry.dispose();
      const mats = new Set(rings.map((r) => r.material as MeshBasicMaterial));
      for (const m of mats) m.dispose();
    },
  };
}

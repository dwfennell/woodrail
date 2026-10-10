import { AdditiveBlending, BufferAttribute, BufferGeometry, CanvasTexture, Points, PointsMaterial, type Scene } from "three";
import type { Flourish } from "./flourishes";

let sprite: CanvasTexture | null = null;
function dustSprite(): CanvasTexture {
  if (sprite) return sprite;
  const c = document.createElement("canvas");
  c.width = c.height = 32;
  const ctx = c.getContext("2d")!;
  const g = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
  g.addColorStop(0, "rgba(255,248,232,0.9)");
  g.addColorStop(1, "rgba(255,248,232,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 32, 32);
  sprite = new CanvasTexture(c);
  return sprite;
}

const COUNT = 12;

/** A faint puff of felt fluff where a piece seats: a dozen motes drift out and up, then fade. */
export function dustPuff(scene: Scene, x: number, y: number, z: number): Flourish {
  const pos = new Float32Array(COUNT * 3);
  const vel = new Float32Array(COUNT * 3);
  for (let i = 0; i < COUNT; i++) {
    const a = (i / COUNT) * Math.PI * 2 + Math.random() * 0.5;
    const s = 40 + Math.random() * 50;
    pos.set([x, y + 1, z], i * 3);
    vel.set([Math.cos(a) * s, 18 + Math.random() * 30, Math.sin(a) * s], i * 3);
  }
  const geometry = new BufferGeometry();
  const attr = new BufferAttribute(pos, 3);
  geometry.setAttribute("position", attr);
  const material = new PointsMaterial({ size: 5, map: dustSprite(), transparent: true, depthWrite: false, opacity: 0.8, blending: AdditiveBlending, color: 0xb8ab94 });
  const points = new Points(geometry, material);
  points.frustumCulled = false;
  scene.add(points);
  let t = 0;
  return {
    update(dt) {
      t += dt;
      const drag = Math.exp(-6 * dt);
      for (let i = 0; i < COUNT * 3; i++) {
        pos[i] += vel[i] * dt;
        vel[i] *= drag;
      }
      attr.needsUpdate = true;
      material.opacity = 0.8 * (1 - t / 0.55);
      return t < 0.55;
    },
    dispose() {
      scene.remove(points);
      geometry.dispose();
      material.dispose();
    },
  };
}

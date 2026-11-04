import { BoxGeometry, Mesh, type BufferGeometry, type Material } from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { LEVER_PROPS, TELEGRAPH_POLE, wiredPoles } from "../game/lineside";
import type { PropStore } from "../props/store";

/** How high the wires hang (mm above a pole's foot): its top cross-arm's insulators. */
export const WIRE_HEIGHT = 81;
/** Where they meet a signal box or lever frame (mm above its foot). */
const BOX_WIRE_HEIGHT = 40;
/** The two wires either side of a pole (mm across). */
const WIRE_APART = 10;
const WIRE_THICK = 0.9;

/**
 * The Telegraph's wires (tech tree 4): from each signal box or lever frame along the telegraph poles wired to it
 * (`wiredPoles`), so a player sees which far points a box works. One mesh in one of the game's own paints (no draw call
 * or material of its own per wire), built again only when the props change or the Telegraph comes or goes (`sync`: two
 * compares a frame otherwise). Static: it asks for no frames.
 */
export class TelegraphWires {
  readonly mesh: Mesh;
  private propsVersion = -1;
  private on = false;

  constructor(material: Material) {
    this.mesh = new Mesh(undefined, material);
    this.mesh.name = "telegraph-wires";
    this.mesh.visible = false;
    this.mesh.matrixAutoUpdate = false;
  }

  /** Bring the wires up to date: `on` while the Telegraph's learned (Sandbox: always). Returns whether they changed. */
  sync(props: PropStore, on: boolean): boolean {
    if (props.version === this.propsVersion && on === this.on) return false;
    const was = this.mesh.visible;
    this.propsVersion = props.version;
    this.on = on;
    const parts = on ? wireParts(props) : [];
    this.mesh.geometry.dispose();
    if (parts.length === 0) {
      this.mesh.visible = false;
      return was;
    }
    this.mesh.geometry = mergeGeometries(parts)!;
    for (const g of parts) g.dispose();
    this.mesh.visible = true;
    return true;
  }
}

/** Each wire's span, as a thin box from one end to the other (world space). */
export function wireParts(props: PropStore): BufferGeometry[] {
  const out: BufferGeometry[] = [];
  const span = (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) => {
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const len = Math.hypot(dx, dz);
    if (len < 1) return;
    const heading = Math.atan2(dz, dx);
    for (const side of [-1, 1]) {
      const g = new BoxGeometry(len, WIRE_THICK, WIRE_THICK);
      // (Sloped to the far end's height, then laid along the span, a wire either side.)
      g.rotateZ(Math.atan2(b.y - a.y, len));
      g.translate(0, 0, (side * WIRE_APART) / 2);
      g.rotateY(-heading);
      g.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
      out.push(g);
    }
  };
  const poles = new Map<string, number>();
  for (const p of props.all()) if (p.asset === TELEGRAPH_POLE) poles.set(`${p.x},${p.z}`, p.y);
  if (poles.size === 0) return out;
  const done = new Set<string>();
  for (const box of props.all()) {
    if (!LEVER_PROPS.has(box.asset)) continue;
    // The chain from the box: each pole wired to the nearest of the box and the poles wired before it.
    const reached: { x: number; y: number; z: number }[] = [{ x: box.x, y: box.y + BOX_WIRE_HEIGHT, z: box.z }];
    for (const pole of wiredPoles(props, box.x, box.z)) {
      const at = { x: pole.x, y: (poles.get(`${pole.x},${pole.z}`) ?? 0) + WIRE_HEIGHT, z: pole.z };
      let from = reached[0];
      for (const r of reached) if (Math.hypot(r.x - at.x, r.z - at.z) < Math.hypot(from.x - at.x, from.z - at.z)) from = r;
      const key = [`${from.x},${from.z}`, `${at.x},${at.z}`].sort().join("|");
      if (!done.has(key)) {
        done.add(key);
        span(from, at);
      }
      reached.push(at);
    }
  }
  return out;
}

import { BufferGeometry, Float32BufferAttribute, LineBasicMaterial, LineLoop } from "three";
import type { Footprint } from "../../props/placement";

/** A rectangle drawn on the ground round a prop's footprint: where it is selected, or where a held one would go. */
export class FootprintOutline {
  readonly line: LineLoop;
  private readonly material = new LineBasicMaterial({ color: "#fff2d8", transparent: true, opacity: 0.9, depthTest: false });

  constructor() {
    this.line = new LineLoop(new BufferGeometry(), this.material);
    this.line.renderOrder = 10;
    this.line.visible = false;
  }

  /** Show it round `fp` placed at (x, y, z) turned to `heading`, in a colour (or hide it with null). */
  show(fp: Footprint | null, x: number, y: number, z: number, heading: number, color = "#fff2d8"): void {
    if (!fp) {
      this.line.visible = false;
      return;
    }
    const m = 4;
    const x0 = fp.cx - fp.hw - m;
    const x1 = fp.cx + fp.hw + m;
    const z0 = fp.cz - fp.hd - m;
    const z1 = fp.cz + fp.hd + m;
    this.line.geometry.setAttribute("position", new Float32BufferAttribute([x0, 0, z0, x1, 0, z0, x1, 0, z1, x0, 0, z1], 3));
    this.line.position.set(x, y + 0.6, z);
    this.line.rotation.set(0, -heading, 0);
    this.material.color.set(color);
    this.line.visible = true;
  }

  hide(): void {
    this.line.visible = false;
  }
}

import { BufferGeometry, Float32BufferAttribute, LineBasicMaterial, LineLoop, Mesh, MeshBasicMaterial, PlaneGeometry } from "three";
import type { Footprint } from "../../props/placement";

/** How far (mm) a filled outline's wash reaches past the outline. */
const FILL_MARGIN = 8;

/** A rectangle drawn on the ground round a prop's footprint: where it is selected, or where a held one would go. */
export class FootprintOutline {
  readonly line: LineLoop;
  private readonly material = new LineBasicMaterial({ color: "#fff2d8", transparent: true, opacity: 0.9, depthTest: false });

  /** A wash of the outline's colour over the ground inside it (`filled`): a line is a pixel wide, faint on a phone. */
  private readonly fill: Mesh | null;

  constructor(filled = false) {
    this.line = new LineLoop(new BufferGeometry(), this.material);
    this.line.renderOrder = 10;
    this.line.visible = false;
    this.fill = filled ? new Mesh(new PlaneGeometry(1, 1).rotateX(-Math.PI / 2), new MeshBasicMaterial({ transparent: true, opacity: 0.32, depthWrite: false, depthTest: false })) : null;
    if (this.fill) {
      this.fill.renderOrder = 9;
      this.line.add(this.fill);
    }
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
    if (this.fill) {
      // (A little wider than the outline, so it shows round a model that fills its footprint: a red-roofed house.)
      this.fill.position.set(fp.cx, 0, fp.cz);
      this.fill.scale.set(x1 - x0 + 2 * FILL_MARGIN, 1, z1 - z0 + 2 * FILL_MARGIN);
      (this.fill.material as MeshBasicMaterial).color.set(color);
    }
    this.line.visible = true;
  }

  hide(): void {
    this.line.visible = false;
  }
}

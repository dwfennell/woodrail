import { BufferAttribute, BufferGeometry, DoubleSide, Mesh, MeshBasicMaterial, type Scene } from "three";
import type { Landscape } from "../landscape";

/** The ring's width (mm), inward from the reach: about two squares, fading toward the town. */
const WIDTH = 150;
/** Points round each ring: smooth at any zoom, a few thousand triangles for a map's towns. */
const SEGMENTS = 128;
/** Above the ground (mm), so it isn't lost in the grass. */
const LIFT = 3;
/** A warm gold (as "Show me"'s rings), apart from the pale lanes and roads. */
const COLOUR = [1, 0.6, 0.08, 1];
/** Across the ring, from inside out: how far in from the reach (× `WIDTH`, negative is past it) and how opaque. */
const BANDS: readonly [number, number][] = [
  [1, 0],
  [0.25, 0.6],
  [0, 0.95],
  [-0.1, 0],
];

/**
 * Game mode's halt reach: a soft ring on the ground round each town, `reach` from its middle, shown while a halt is held
 * (a halt's platform must stand inside one to be that town's stop). All the towns' rings are one mesh, one draw call,
 * built when first shown and again only when the towns or the land under them change; showing and hiding it is all a
 * drag does (nothing per pointer move).
 */
export class HaltReachView {
  private mesh: Mesh<BufferGeometry, MeshBasicMaterial> | null = null;
  private key = "";
  private land: Landscape | null = null;
  /** How many times the rings were built (for tests: show and hide never rebuild). */
  builds = 0;

  constructor(
    private readonly scene: Scene,
    private readonly reach: number,
  ) {}

  get showing(): boolean {
    return this.mesh?.visible === true;
  }

  /** Show the rings round `land`'s towns (built first if the towns or the ground changed since). */
  show(land: Landscape): void {
    const key = `${land.towns.length}:${land.grid.revision}:${land.towns.map((t) => `${t.centre.x},${t.centre.z}`).join(";")}`;
    if (!this.mesh || land !== this.land || key !== this.key) this.build(land, key);
    this.mesh!.visible = true;
  }

  hide(): void {
    if (this.mesh) this.mesh.visible = false;
  }

  dispose(): void {
    if (!this.mesh) return;
    this.scene.remove(this.mesh);
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
    this.mesh = null;
  }

  private build(land: Landscape, key: string): void {
    this.land = land;
    this.key = key;
    this.builds++;
    const grid = land.grid;
    const rows = BANDS.length;
    const perTown = SEGMENTS * rows;
    const pos = new Float32Array(land.towns.length * perTown * 3);
    const col = new Float32Array(land.towns.length * perTown * 4);
    const index: number[] = [];
    land.towns.forEach((t, k) => {
      const base = k * perTown;
      for (let s = 0; s < SEGMENTS; s++) {
        const a = (s / SEGMENTS) * Math.PI * 2;
        const c = Math.cos(a);
        const sn = Math.sin(a);
        for (let b = 0; b < rows; b++) {
          const [inward, alpha] = BANDS[b];
          const r = this.reach - inward * WIDTH;
          const x = t.centre.x + c * r;
          const z = t.centre.z + sn * r;
          // On the ground of the square under it (off the map: at sea level).
          const cell = grid.cellAtWorld(x, z);
          const v = base + s * rows + b;
          pos.set([x, (cell === -1 ? 0 : grid.groundY(cell)) + LIFT, z], v * 3);
          col.set(COLOUR, v * 4);
          col[v * 4 + 3] = alpha;
        }
        const next = (s + 1) % SEGMENTS;
        for (let b = 0; b < rows - 1; b++) {
          const p = base + s * rows + b;
          const q = base + next * rows + b;
          index.push(p, q, p + 1, p + 1, q, q + 1);
        }
      }
    });
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new BufferAttribute(pos, 3));
    geometry.setAttribute("color", new BufferAttribute(col, 4));
    geometry.setIndex(index);
    geometry.computeBoundingSphere();
    if (this.mesh) {
      this.mesh.geometry.dispose();
      this.mesh.geometry = geometry;
      return;
    }
    const material = new MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    // Seen from above or below the ground's tilt alike.
    material.side = DoubleSide;
    this.mesh = new Mesh(geometry, material);
    this.mesh.renderOrder = 5;
    this.mesh.visible = false;
    this.mesh.name = "halt-reach";
    this.scene.add(this.mesh);
  }
}

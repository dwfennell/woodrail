import {
  ACESFilmicToneMapping,
  Box3,
  CircleGeometry,
  Color,
  DirectionalLight,
  Group,
  HemisphereLight,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PerspectiveCamera,
  Scene,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
  type Object3D,
} from "three";
import { shownModel } from "../render/blender-models";
import { createMaterials, type Materials } from "../render/materials";

/**
 * The shelves, top to bottom, stepped like a toy shop's display: the train (coupled up), the platform's folk, the
 * street's furniture. Each is sized to the train's width: grown up to `grow`, and shrunk to fit. `gap`: room between
 * toys (mm, the models' own scale); `sway`: how far they turn back and forth (radians); `turn`: which way they face (the
 * train's models face +x, so it's turned round to lead off from the left); `slot`: the height kept for the shelf from
 * the start (as drawn, mm: about what its toys come to), so the shelves don't shift as each fills.
 */
const SHELVES = {
  train: { gap: 3, sway: 0.08, grow: 1, turn: Math.PI, slot: 60 },
  folk: { gap: 14, sway: 0.35, grow: 2.4, turn: 0, slot: 50 },
  street: { gap: 16, sway: 0.3, grow: 2.4, turn: 0, slot: 98 },
};
export type Shelf = keyof typeof SHELVES;
const ORDER = Object.keys(SHELVES) as Shelf[];
/** Room between shelves, and how far each steps forward of the one above (mm). */
const SHELF_GAP = 14;
const SHELF_STEP = 50;
/** How long a toy takes to hop in (ms). */
const HOP_MS = 650;

interface Toy {
  root: Object3D;
  /** Its shelf, and its place along it (centre, mm). */
  shelf: Shelf;
  x: number;
  born: number;
}

/**
 * Toys hopping onto the loading screen as their models arrive: a small stage of its own under the title, drawn only
 * while the loading screen shows, and freed when it goes (`stop`).
 */
export class LoadingToys {
  private readonly renderer: WebGLRenderer;
  private readonly mats: Materials;
  private readonly lamp = new MeshStandardMaterial({ color: new Color("#ffcf6b"), emissive: new Color("#ffaa33"), emissiveIntensity: 0.3, roughness: 0.3 });
  private readonly scene = new Scene();
  private readonly rows = ORDER.map(() => new Group());
  private readonly camera = new PerspectiveCamera(26, 1, 5, 4000);
  private readonly toys: Toy[] = [];
  private readonly calm = matchMedia("(prefers-reduced-motion: reduce)").matches;
  /** How long each shelf's row is so far, and its tallest toy. */
  private readonly widths = ORDER.map(() => 0);
  private readonly heights = ORDER.map(() => 0);
  private frame = 0;
  private stopped = false;
  /** Only the train shows (loading done: it stays under the title), standing still. */
  private trainOnly = false;

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(2, devicePixelRatio || 1));
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.mats = createMaterials(this.renderer.capabilities.getMaxAnisotropy());
    this.scene.add(new HemisphereLight(new Color("#fff6e6"), new Color("#8a7a5c"), 1.4));
    const sun = new DirectionalLight(new Color("#fff1dc"), 2.2);
    sun.position.set(-60, 160, 120);
    this.scene.add(sun, ...this.rows);
    // A lost context draws as a white box (the browser may take it back while the game builds): hide it, don't flash.
    canvas.addEventListener("webglcontextlost", () => (canvas.style.visibility = "hidden"));
  }

  /** Put a model at the end of a shelf (it hops in). `slots`: colours for its slots (a coat, a hat). */
  add(model: Object3D, shelf: Shelf, slots: Readonly<Record<string, string>> = {}): void {
    this.place(model, shelf, slots, performance.now());
  }

  /**
   * Fill a shelf at once, held back (unseen) until `release`: each toy is in its final place from the start (the row
   * is laid out whole), so nothing shifts along as the others arrive.
   */
  addRow(shelf: Shelf, toys: readonly { model: Object3D; slots?: Readonly<Record<string, string>> }[]): void {
    for (const t of toys) this.place(t.model, shelf, t.slots ?? {}, Infinity);
    // Laid out after the release (its models were slow): it hops in now.
    if (this.released !== null) this.release(this.released);
  }

  /** Set once the held toys have been let go (their stagger). */
  private released: number | null = null;

  /** The held toys hop in, in the order they were added, `stagger` ms apart. */
  release(stagger: number): void {
    this.released = stagger;
    const now = performance.now();
    let k = 0;
    for (const t of this.toys) if (t.born === Infinity) t.born = now + k++ * stagger;
    this.refresh();
  }

  /** Loading's done: just the train stays, still (the other shelves go). */
  showTrainOnly(): void {
    this.trainOnly = true;
    this.refresh();
  }

  private place(model: Object3D, shelf: Shelf, slots: Readonly<Record<string, string>>, born: number): void {
    if (this.stopped) return;
    const root = new Group();
    const toy = shownModel(model, this.mats, this.lamp, slots);
    const row = ORDER.indexOf(shelf);
    toy.rotation.y = SHELVES[shelf].turn;
    root.add(toy);
    const box = new Box3().setFromObject(toy);
    const size = box.getSize(new Vector3());
    // A soft round shadow under each toy, so it sits on the shelf.
    const shadow = new Mesh(new CircleGeometry(Math.max(size.x, size.z) * 0.55, 32), new MeshBasicMaterial({ color: "#7a5a32", transparent: true, opacity: 0.18, depthWrite: false }));
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.2;
    shadow.scale.set(1, size.z / Math.max(size.x, size.z), 1);
    root.add(shadow);
    const half = size.x / 2;
    const x = this.widths[row] + (this.widths[row] ? SHELVES[shelf].gap : 0) + half;
    this.widths[row] = x + half;
    this.heights[row] = Math.max(this.heights[row], size.y);
    root.position.x = x;
    this.rows[row].add(root);
    root.scale.setScalar(0.001);
    this.toys.push({ root, shelf, x, born });
    this.start();
  }

  /** Stop drawing and free the stage (its own WebGL context). */
  stop(): void {
    this.stopped = true;
    this.canvas.style.visibility = "hidden";
    cancelAnimationFrame(this.frame);
    this.renderer.dispose();
    this.renderer.forceContextLoss();
  }

  /** When the last toy will have finished hopping in (ms, `performance.now()` time; 0 with none). */
  get doneAt(): number {
    return this.toys.reduce((t, toy) => (toy.born === Infinity ? t : Math.max(t, toy.born + HOP_MS)), 0);
  }

  /** Where the train's shelf is on screen (client px, from the top), as last drawn; null before it has a car. */
  trainSpan: { top: number; bottom: number } | null = null;

  private rowSpan(i: number): { top: number; bottom: number } | null {
    const row = this.rows[i];
    if (!this.widths[i]) return null;
    const box = new Box3().setFromObject(row);
    const r = this.canvas.getBoundingClientRect();
    let top = Infinity;
    let bottom = -Infinity;
    const v = new Vector3();
    for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) {
      v.set(x, y, z).project(this.camera);
      const sy = r.top + ((1 - v.y) / 2) * r.height;
      top = Math.min(top, sy);
      bottom = Math.max(bottom, sy);
    }
    return { top, bottom };
  }

  /** Draw again (its canvas changed size). */
  refresh(): void {
    if (!this.stopped) this.start();
  }

  private start(): void {
    if (!this.frame) this.frame = requestAnimationFrame(this.draw);
  }

  private readonly draw = (now: number): void => {
    this.frame = 0;
    if (this.stopped) return;
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    if (this.canvas.width !== Math.round(w * this.renderer.getPixelRatio())) this.renderer.setSize(w, h, false);
    // Each shelf keeps its row centred and about as wide as the train's, and keeps its height from the start (empty or
    // not, so nothing moves up or down as they fill); the camera backs off to keep them all in view.
    const wide = Math.max(240, this.widths[ORDER.indexOf("train")]);
    let busy = false;
    let y = 0;
    let top = 0;
    let shelves = 0;
    const ease = this.calm ? 1 : 0.12;
    this.rows.forEach((g, i) => {
      // Once loading's done the other shelves go, but keep their room: the train doesn't move.
      g.visible = !this.trainOnly || ORDER[i] === "train";
      const scale = this.widths[i] ? Math.min(SHELVES[ORDER[i]].grow, wide / this.widths[i]) : 1;
      const height = Math.max(this.heights[i] * scale, SHELVES[ORDER[i]].slot);
      if (shelves++) y -= height + SHELF_GAP;
      else top = height;
      const target = (-this.widths[i] / 2) * scale;
      const z = (shelves - 1) * SHELF_STEP;
      // A shelf's first toy puts it straight in its place; after that it eases as others come and go.
      const k = g.userData.placed ? ease : 1;
      if (this.widths[i]) g.userData.placed = true;
      g.position.set(g.position.x + (target - g.position.x) * k, g.position.y + (y - g.position.y) * k, g.position.z + (z - g.position.z) * k);
      g.scale.setScalar(g.scale.x + (scale - g.scale.x) * k);
      if (Math.abs(target - g.position.x) > 0.1 || Math.abs(y - g.position.y) > 0.1 || Math.abs(z - g.position.z) > 0.1 || Math.abs(scale - g.scale.x) > 0.001) busy = true;
    });
    const bottom = y;
    const middle = { y: (top + bottom) / 2, z: (Math.max(0, shelves - 1) * SHELF_STEP) / 2 };
    this.camera.aspect = w / Math.max(1, h);
    const tan = Math.tan((this.camera.fov * Math.PI) / 360);
    const dist = Math.max((wide * 0.56) / tan / this.camera.aspect, ((top - bottom) * 0.62) / tan) + 40;
    this.camera.position.set(0, middle.y + dist * 0.32, middle.z + dist);
    this.camera.lookAt(0, middle.y, middle.z);
    this.camera.updateProjectionMatrix();
    for (const t of this.toys) {
      if (now < t.born) {
        // Not its turn yet (or held back till released).
        t.root.scale.setScalar(0.001);
        if (t.born !== Infinity) busy = true;
        continue;
      }
      const age = Math.min(1, (now - t.born) / HOP_MS);
      // A hop: up out of nothing, a little overshoot, settle (easeOutBack).
      const k = this.calm ? 1 : 1 + 2.7 * (age - 1) ** 3 + 1.7 * (age - 1) ** 2;
      t.root.scale.setScalar(Math.max(0.001, k));
      t.root.position.y = this.calm ? 0 : Math.sin(Math.PI * age) * 10;
      if (this.trainOnly) {
        // Swaying to rest (not snapping straight), then still.
        t.root.rotation.y *= 0.85;
        if (Math.abs(t.root.rotation.y) > 0.0005) busy = true;
        else t.root.rotation.y = 0;
      } else if (!this.calm) t.root.rotation.y = Math.sin(now / 1400 + t.x / 40) * SHELVES[t.shelf].sway;
      if (age < 1) busy = true;
    }
    this.renderer.render(this.scene, this.camera);
    // Keep drawing while anything moves (the toys sway while loading, unless motion is reduced; the train left under the
    // title stands still, so it costs nothing).
    if (busy || !(this.calm || this.trainOnly)) this.start();
    this.trainSpan = this.rowSpan(ORDER.indexOf("train"));
  };
}

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
 * The shelves, stepped like a toy shop's display: the train on the top shelf, coupled up; the folk and the furniture on
 * the shelves below, each grown (up to `grow`) to be as wide as the train. `gap`: room between toys (mm, the models'
 * own scale); `sway`: how far they turn back and forth (radians).
 */
const SHELVES = [
  { gap: 3, sway: 0.08, grow: 1 },
  { gap: 14, sway: 0.35, grow: 2.4 },
  { gap: 16, sway: 0.3, grow: 2.4 },
];
/** Room between shelves, and how far each steps forward of the one above (mm). */
const SHELF_GAP = 14;
const SHELF_STEP = 50;
/** How long a toy takes to hop in (ms). */
const HOP_MS = 650;

interface Toy {
  root: Object3D;
  /** Its shelf, and its place along it (centre, mm). */
  row: number;
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
  private readonly rows = SHELVES.map(() => new Group());
  private readonly camera = new PerspectiveCamera(26, 1, 5, 4000);
  private readonly toys: Toy[] = [];
  private readonly calm = matchMedia("(prefers-reduced-motion: reduce)").matches;
  /** How long each shelf's row is so far, and its tallest toy. */
  private readonly widths = SHELVES.map(() => 0);
  private readonly heights = SHELVES.map(() => 0);
  private frame = 0;
  private stopped = false;

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
  }

  /** Put a model at the end of a shelf (it hops in). `slots`: colours for its slots (a coat, a hat). */
  add(model: Object3D, slots: Readonly<Record<string, string>> = {}, row = 0): void {
    if (this.stopped) return;
    const root = new Group();
    const toy = shownModel(model, this.mats, this.lamp, slots);
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
    const x = this.widths[row] + (this.widths[row] ? SHELVES[row].gap : 0) + half;
    this.widths[row] = x + half;
    this.heights[row] = Math.max(this.heights[row], size.y);
    root.position.x = x;
    this.rows[row].add(root);
    this.toys.push({ root, row, x, born: performance.now() });
    this.start();
  }

  /** Stop drawing and free the stage (its own WebGL context). */
  stop(): void {
    this.stopped = true;
    cancelAnimationFrame(this.frame);
    this.renderer.dispose();
    this.renderer.forceContextLoss();
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
    // Each shelf keeps its row centred and as wide as the train's; the camera backs off to keep them all in view.
    const wide = Math.max(240, this.widths[0]);
    let busy = false;
    let y = 0;
    let bottom = 0;
    const ease = this.calm ? 1 : 0.12;
    this.rows.forEach((g, i) => {
      const scale = this.widths[i] ? Math.min(SHELVES[i].grow, wide / this.widths[i]) : 1;
      const target = (-this.widths[i] / 2) * scale;
      if (i) y -= this.heights[i] * scale + SHELF_GAP;
      if (this.widths[i]) bottom = y;
      g.position.set(g.position.x + (target - g.position.x) * ease, g.position.y + (y - g.position.y) * ease, i * SHELF_STEP);
      g.scale.setScalar(g.scale.x + (scale - g.scale.x) * ease);
      if (Math.abs(target - g.position.x) > 0.1 || Math.abs(y - g.position.y) > 0.1 || Math.abs(scale - g.scale.x) > 0.001) busy = true;
    });
    const top = this.heights[0];
    const middle = { y: (top + bottom) / 2, z: ((this.rows.length - 1) * SHELF_STEP) / 2 };
    this.camera.aspect = w / Math.max(1, h);
    const tan = Math.tan((this.camera.fov * Math.PI) / 360);
    const dist = Math.max((wide * 0.56) / tan / this.camera.aspect, ((top - bottom) * 0.62) / tan) + 40;
    this.camera.position.set(0, middle.y + dist * 0.32, middle.z + dist);
    this.camera.lookAt(0, middle.y, middle.z);
    this.camera.updateProjectionMatrix();
    for (const t of this.toys) {
      const age = Math.min(1, (now - t.born) / HOP_MS);
      // A hop: up out of nothing, a little overshoot, settle (easeOutBack).
      const k = this.calm ? 1 : 1 + 2.7 * (age - 1) ** 3 + 1.7 * (age - 1) ** 2;
      t.root.scale.setScalar(Math.max(0.001, k));
      t.root.position.y = this.calm ? 0 : Math.sin(Math.PI * age) * 10;
      if (!this.calm) t.root.rotation.y = Math.sin(now / 1400 + t.x / 40) * SHELVES[t.row].sway;
      if (age < 1) busy = true;
    }
    this.renderer.render(this.scene, this.camera);
    // Keep drawing while anything moves (the toys sway until the loading screen goes, unless motion is reduced).
    if (busy || !this.calm) this.start();
  };
}

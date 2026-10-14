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

/** Room between toys on the shelf (mm, the models' own scale). */
const GAP = 14;
/** How long a toy takes to hop in (ms). */
const HOP_MS = 650;
/** How far the shelf turns its toys, back and forth (radians). */
const SWAY = 0.35;

interface Toy {
  root: Object3D;
  /** Its place along the row (centre, mm) and half its length. */
  x: number;
  half: number;
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
  private readonly row = new Group();
  private readonly camera = new PerspectiveCamera(26, 1, 5, 4000);
  private readonly toys: Toy[] = [];
  private readonly calm = matchMedia("(prefers-reduced-motion: reduce)").matches;
  private width = 0;
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
    this.scene.add(sun, this.row);
  }

  /** Put a model on the shelf (it hops in). `slots`: colours for its slots (a coat, a hat). */
  add(model: Object3D, slots: Readonly<Record<string, string>> = {}): void {
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
    const x = this.width + (this.toys.length ? GAP : 0) + half;
    this.width = x + half;
    root.position.x = x;
    this.row.add(root);
    this.toys.push({ root, x, half, born: performance.now() });
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
    // The row stays centred as it grows, and the camera backs off to keep it all in view.
    const target = -this.width / 2;
    this.row.position.x += (target - this.row.position.x) * (this.calm ? 1 : 0.12);
    const reach = Math.max(60, this.width * 0.62);
    this.camera.aspect = w / Math.max(1, h);
    const dist = reach / Math.tan((this.camera.fov * Math.PI) / 360) / Math.max(1, this.camera.aspect) + 40;
    this.camera.position.set(0, dist * 0.42, dist);
    this.camera.lookAt(0, 16, 0);
    this.camera.updateProjectionMatrix();
    let busy = Math.abs(target - this.row.position.x) > 0.1;
    for (const t of this.toys) {
      const age = Math.min(1, (now - t.born) / HOP_MS);
      // A hop: up out of nothing, a little overshoot, settle (easeOutBack).
      const k = this.calm ? 1 : 1 + 2.7 * (age - 1) ** 3 + 1.7 * (age - 1) ** 2;
      t.root.scale.setScalar(Math.max(0.001, k));
      t.root.position.y = this.calm ? 0 : Math.sin(Math.PI * age) * 10;
      if (!this.calm) t.root.rotation.y = Math.sin(now / 1400 + t.x / 40) * SWAY;
      if (age < 1) busy = true;
    }
    this.renderer.render(this.scene, this.camera);
    // Keep drawing while anything moves (the toys sway until the loading screen goes, unless motion is reduced).
    if (busy || !this.calm) this.start();
  };
}

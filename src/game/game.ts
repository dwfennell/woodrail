import {
  ACESFilmicToneMapping,
  Clock,
  PCFShadowMap,
  PerspectiveCamera,
  Scene,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
} from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { createMaterials, type Materials } from "../render/materials";
import { createPost, type Post } from "../render/post";
import { detectQuality, type QualitySettings } from "../render/quality";
import { createRoom, type Room } from "../render/room";
import { TrackView } from "../render/track-view";
import { TrainView } from "../render/train-view";
import { createSnapshot, SIM_DT, type Sim, type SimSnapshot } from "../sim";
import { PIECE_TYPES, type Layout } from "../track";

const MAX_STEPS_PER_FRAME = 8;

export interface GameWorld {
  layout: Layout;
  sim: Sim;
}

/** Owns the renderer, scene, camera and frame loop. Input and UI attach to it. */
export class Game {
  readonly renderer: WebGLRenderer;
  readonly scene = new Scene();
  readonly camera: PerspectiveCamera;
  readonly controls: OrbitControls;
  readonly quality: QualitySettings;
  readonly mats: Materials;
  readonly room: Room;
  readonly trackView: TrackView;
  readonly trainView: TrainView;
  readonly post: Post;
  readonly snapshot: SimSnapshot = createSnapshot();
  layout: Layout;
  sim: Sim;
  paused = false;
  /** Called once per frame after the simulation steps, before rendering. */
  onFrame: ((dt: number) => void) | null = null;
  /** Milliseconds spent simulating in the last frame (for the perf overlay). */
  simMs = 0;
  private readonly clock = new Clock();
  private accumulator = 0;
  private followCarId = -1;

  constructor(
    readonly canvas: HTMLCanvasElement,
    world: GameWorld,
  ) {
    this.layout = world.layout;
    this.sim = world.sim;
    this.quality = detectQuality();

    this.renderer = new WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, this.quality.maxPixelRatio));
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.95;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = PCFShadowMap;

    this.camera = new PerspectiveCamera(30, 1, 5, 40000);
    this.camera.position.set(700, 620, 1050);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.target.set(0, 0, 0);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.minDistance = 120;
    this.controls.maxDistance = 7000;
    this.controls.maxPolarAngle = 1.42;
    this.controls.screenSpacePanning = false;

    this.mats = createMaterials(this.renderer.capabilities.getMaxAnisotropy(), this.quality.textureSize);
    this.room = createRoom(this.scene, this.renderer, this.mats, this.quality);
    TrackView.prebuild(PIECE_TYPES);
    this.trackView = new TrackView(this.layout, this.mats);
    this.scene.add(this.trackView.group);
    this.trackView.sync();
    this.trainView = new TrainView(this.mats);
    this.scene.add(this.trainView.group);
    this.post = createPost(this.renderer, this.scene, this.camera, this.quality);

    window.addEventListener("resize", () => this.resize());
    this.resize();
  }

  /** Swap in a different layout and simulation (new game, load). */
  setWorld(world: GameWorld): void {
    this.layout = world.layout;
    this.sim = world.sim;
    this.scene.remove(this.trackView.group);
    (this as { trackView: TrackView }).trackView = new TrackView(this.layout, this.mats);
    this.scene.add(this.trackView.group);
    this.trackView.sync();
  }

  follow(carId: number): void {
    this.followCarId = carId;
  }

  get following(): number {
    return this.followCarId;
  }

  resize(): void {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    const pr = this.renderer.getPixelRatio();
    this.post.setSize(w * pr, h * pr);
  }

  start(): void {
    this.renderer.setAnimationLoop(() => this.frame());
  }

  private frame(): void {
    const dt = Math.min(this.clock.getDelta(), 0.1);
    const t0 = performance.now();
    if (!this.paused) {
      this.accumulator += dt;
      let steps = 0;
      while (this.accumulator >= SIM_DT && steps < MAX_STEPS_PER_FRAME) {
        this.sim.tick();
        this.accumulator -= SIM_DT;
        steps++;
      }
      if (steps === MAX_STEPS_PER_FRAME) this.accumulator = 0;
    }
    this.simMs = performance.now() - t0;
    this.sim.writeSnapshot(this.snapshot);
    this.trainView.update(this.snapshot, dt);
    this.updateFollow();
    this.onFrame?.(dt);
    this.controls.update(dt);
    this.post.setFocus(this.camera.position.distanceTo(this.controls.target));
    this.post.render(this.clock.elapsedTime);
  }

  private updateFollow(): void {
    if (this.followCarId === -1) return;
    const obj = this.trainView.carObject(this.followCarId);
    if (!obj) {
      this.followCarId = -1;
      return;
    }
    const target = new Vector3(obj.position.x, obj.position.y + 20, obj.position.z);
    const delta = target.clone().sub(this.controls.target);
    this.controls.target.add(delta.multiplyScalar(0.12));
    this.camera.position.add(delta);
  }
}

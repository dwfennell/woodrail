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
import { LandscapeView } from "../render/landscape-view";
import { createMaterials, type Materials } from "../render/materials";
import { Flourishes } from "../render/flourishes";
import { createPost, type Post } from "../render/post";
import { detectQuality, type QualitySettings } from "../render/quality";
import { createStage, type Stage } from "../render/stage";
import { shadowRadiusForView, shouldRefit } from "../render/shadow-fit";
import { TrackView } from "../render/track-view";
import { TrainView } from "../render/train-view";
import type { Economy } from "../economy";
import { CrossingsView } from "../render/crossings-view";
import { DepotView } from "../render/depot-view";
import { DerailPhysics } from "../physics/derail-physics";
import { createSnapshot, SIM_DT, type Sim, type SimEvent, type SimSnapshot } from "../sim";
import { bridgeLevels, findCrossings, hillSlabs, MAT_DEPTH, MAT_WIDTH, type Landscape } from "../landscape";
import { PIECE_TYPES, type Layout, type PlacedPiece } from "../track";
import { CameraDirector, nearPlaneFor } from "./camera-director";
import { TouchCamera } from "./touch-camera";
import type { World } from "./world";

const MAX_STEPS_PER_FRAME = 8;

export type GameWorld = World;

/** Owns the renderer, scene, camera and frame loop. Input and UI attach to it. */
export class Game {
  readonly renderer: WebGLRenderer;
  readonly scene = new Scene();
  readonly camera: PerspectiveCamera;
  readonly controls: OrbitControls;
  readonly director: CameraDirector;
  readonly touchCamera: TouchCamera;
  /** Short cosmetic animations (pieces settling, wobbling back, shrinking away, dust). */
  readonly flourishes = new Flourishes();
  readonly quality: QualitySettings;
  readonly mats: Materials;
  readonly stage: Stage;
  readonly trackView: TrackView;
  landscapeView: LandscapeView;
  readonly trainView: TrainView;
  readonly crossingsView: CrossingsView;
  readonly depotView: DepotView;
  readonly post: Post;
  readonly snapshot: SimSnapshot = createSnapshot();
  readonly physics: DerailPhysics;
  /** Simulation events from the latest frame (derailments, couplings, …). */
  events: SimEvent[] = [];
  layout: Layout;
  sim: Sim;
  landscape: Landscape;
  stations: Map<number, number>;
  depots: Map<number, number>;
  economy: Economy;
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
    this.landscape = world.landscape;
    this.stations = world.stations;
    this.depots = world.depots;
    this.economy = world.economy;
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
    // Mouse drags glide on a little after release (touch has its own gestures and glide: see TouchCamera).
    this.controls.dampingFactor = 0.05;
    this.controls.minDistance = 120;
    this.controls.maxDistance = 14000;
    this.controls.maxPolarAngle = 1.42;
    this.controls.screenSpacePanning = false;
    this.director = new CameraDirector(this.camera, this.controls);
    this.director.bounds = { halfW: MAT_WIDTH / 2, halfD: MAT_DEPTH / 2 };
    this.touchCamera = new TouchCamera(canvas, this.camera, this.controls.target, this.controls, () => this.controls.enabled, () => {
      // Same as the controls starting a drag: any glide or eased zoom gives way to the fingers.
      this.controls.dispatchEvent({ type: "start" });
    });

    this.mats = createMaterials(this.renderer.capabilities.getMaxAnisotropy());
    this.stage = createStage(this.scene, this.renderer, this.quality);
    TrackView.prebuild(PIECE_TYPES);
    TrackView.warmBridges(PIECE_TYPES);
    this.landscapeView = new LandscapeView(this.landscape, this.mats, !this.quality.ambientOcclusion);
    this.scene.add(this.landscapeView.group);
    this.trackView = new TrackView(this.layout, this.mats, this.bridgeLevelsOf);
    this.scene.add(this.trackView.group);
    this.trackView.sync();
    this.physics = new DerailPhysics(this.layout);
    this.physics.bridgeLevels = this.bridgeLevelsOf;
    this.physics.setSlabs(hillSlabs(this.landscape.grid));
    this.trainView = new TrainView(this.mats);
    this.scene.add(this.trainView.group);
    this.depotView = new DepotView(this.mats);
    this.scene.add(this.depotView.group);
    this.depotView.setWorld(this.economy, this.layout);
    this.crossingsView = new CrossingsView(this.mats);
    this.scene.add(this.crossingsView.group);
    this.crossingsView.setCrossings(findCrossings(this.landscape, this.layout));
    this.post = createPost(this.renderer, this.scene, this.camera, this.quality);

    window.addEventListener("resize", () => this.resize());
    this.resize();
    this.frameLayout();
  }

  /** Swap in a different layout and simulation (new game, load). */
  setWorld(world: GameWorld): void {
    this.flourishes.clear();
    this.layout = world.layout;
    this.sim = world.sim;
    this.landscape = world.landscape;
    this.stations = world.stations;
    this.depots = world.depots;
    this.economy = world.economy;
    this.scene.remove(this.landscapeView.group);
    this.landscapeView.dispose();
    this.landscapeView = new LandscapeView(this.landscape, this.mats, !this.quality.ambientOcclusion);
    this.scene.add(this.landscapeView.group);
    this.scene.remove(this.trackView.group);
    this.trackView.dispose();
    (this as { trackView: TrackView }).trackView = new TrackView(this.layout, this.mats, this.bridgeLevelsOf);
    this.scene.add(this.trackView.group);
    this.trackView.sync();
    this.physics.setLayout(this.layout);
    this.physics.setSlabs(hillSlabs(this.landscape.grid));
    this.crossingsView.setCrossings(findCrossings(this.landscape, this.layout));
    this.depotView.setWorld(this.economy, this.layout);
  }

  /** How many riser heights a placed bridge's arches reach down to the ground (0 for other pieces). */
  readonly bridgeLevelsOf = (p: PlacedPiece): number => bridgeLevels(this.landscape, p.type, p.flipped, p.pose, p.y);

  get world(): World {
    return { layout: this.layout, sim: this.sim, landscape: this.landscape, stations: this.stations, depots: this.depots, economy: this.economy };
  }

  /** Call after any layout edit. */
  trackChanged(): void {
    this.trackView.sync();
    this.economy.prune();
    this.crossingsView.setCrossings(findCrossings(this.landscape, this.layout));
    this.physics.markTrackDirty();
  }

  /** Re-rail a derailed train near where its lead car came to rest. Returns the new train id or -1. */
  rerail(trainId: number): number {
    const t = this.sim.getTrain(trainId);
    if (!t) return -1;
    const rest = this.physics.restingPoint(t.cars[0].id);
    return this.sim.rerail(trainId, 150, rest ?? undefined);
  }

  /** Point the camera at the layout from the current viewing direction, fitting it on screen. */
  frameLayout(): void {
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (const id of this.layout.pieceIds()) {
      const p = this.layout.getPiece(id)!;
      minX = Math.min(minX, p.pose.x);
      maxX = Math.max(maxX, p.pose.x);
      minZ = Math.min(minZ, p.pose.z);
      maxZ = Math.max(maxZ, p.pose.z);
    }
    // Always include the felt mat.
    minX = Math.min(minX, -MAT_WIDTH / 2);
    maxX = Math.max(maxX, MAT_WIDTH / 2);
    minZ = Math.min(minZ, -MAT_DEPTH / 2);
    maxZ = Math.max(maxZ, MAT_DEPTH / 2);
    const cx = (minX + maxX) / 2;
    const cz = (minZ + maxZ) / 2;
    const radius = Math.hypot(maxX - minX, maxZ - minZ) / 2;
    const fov = (this.camera.fov * Math.PI) / 180;
    const fit = radius / Math.tan(fov / 2) / Math.min(1, this.camera.aspect);
    const dir = this.camera.position.clone().sub(this.controls.target).normalize();
    this.controls.target.set(cx, 0, cz);
    this.camera.position.set(cx, 0, cz).addScaledVector(dir, Math.min(fit * 0.62, this.controls.maxDistance));
    this.controls.update();
  }

  /** Follow a car with the camera (or stop following with −1). */
  follow(carId: number): void {
    this.followCarId = carId;
    const at = new Vector3();
    this.director.follow(
      carId === -1
        ? null
        : () => {
            if (this.followCarId !== carId) return null;
            const obj = this.trainView.carObject(carId);
            if (!obj) {
              this.followCarId = -1;
              return null;
            }
            return at.set(obj.position.x, obj.position.y + 20, obj.position.z);
          },
    );
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
        this.economy.tick();
        this.accumulator -= SIM_DT;
        steps++;
      }
      if (steps === MAX_STEPS_PER_FRAME) this.accumulator = 0;
    }
    this.events = this.sim.drainEvents();
    for (const e of this.events) {
      if (e.kind === "derailed") {
        const t = this.sim.getTrain(e.trainId);
        if (t) this.physics.derail(t);
      }
    }
    this.sim.writeSnapshot(this.snapshot);
    const derailedCars = new Set<number>();
    for (let i = 0; i < this.snapshot.count; i++) if (this.snapshot.derailed[i]) derailedCars.add(this.snapshot.ids[i]);
    this.physics.retain((id) => derailedCars.has(id));
    if (!this.paused) this.physics.step(dt);
    this.simMs = performance.now() - t0;
    this.trainView.update(this.snapshot, dt, (id, out) => this.physics.poseOf(id, out));
    this.crossingsView.update(this.snapshot, dt);
    this.depotView.update(this.economy, this.snapshot.ids, this.snapshot.count, (id) => this.trainView.carObject(id), dt);
    this.onFrame?.(dt);
    this.flourishes.update(dt);
    // A finger fling glides on between touches (a director glide or zoom takes over from it).
    if (this.director.busy) this.touchCamera.gestures.stop();
    else if (!this.touchCamera.touching) this.touchCamera.gestures.glide(dt);
    this.director.update(dt, this.canvas.clientWidth, this.canvas.clientHeight);
    this.controls.update(dt);
    // After the controls' own pan, so the view never renders past the mat's edge.
    this.director.constrain();
    const t = this.controls.target;
    const dist = this.camera.position.distanceTo(t);
    const near = nearPlaneFor(dist);
    if (Math.abs(near - this.camera.near) > 0.5) {
      this.camera.near = near;
      this.camera.updateProjectionMatrix();
    }
    const radius = shadowRadiusForView(this.camera, t);
    if (shouldRefit(this.stage.shadowFit, t.x, t.z, radius)) this.stage.fitShadow(t.x, t.z, radius);
    this.stage.update(this.camera);
    this.post.setFocus(dist);
    this.post.render(this.clock.elapsedTime);
  }
}

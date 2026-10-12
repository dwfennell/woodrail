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
import { cutColumn } from "../render/dressing/hill-cuts";
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
import { bridgeLevels, findCrossings, syncCuttings, type HeldPiece, hillPieces, hillsOf, MAT_DEPTH, MAT_WIDTH, type Landscape } from "../landscape";
import { PIECE_TYPES, type Layout, type PlacedPiece } from "../track";
import { CameraDirector, nearPlaneFor } from "./camera-director";
import { TouchCamera } from "./touch-camera";
import type { World } from "./world";

const MAX_STEPS_PER_FRAME = 8;

export type GameWorld = World;

/** Owns the renderer, scene, camera and frame loop. Input and UI attach to it. */
/** Seconds to keep drawing after the last change on screen, for anything easing to rest. */
const IDLE_TAIL = 1;
/**
 * Frame-rate cap (ms between frames). A high-refresh display would otherwise draw every vsync (120 Hz on ProMotion),
 * which keeps the GPU flat out and the fans spinning.
 */
const FRAME_MS = 1000 / 30;
/** Vsync timestamps jitter: a frame due within this much of its slot still runs. */
const FRAME_SLACK_MS = 2;

/** Keys that pan the view, and which way. */
const PAN_KEYS: Record<string, "f" | "b" | "l" | "r" | "fast"> = {
  w: "f",
  s: "b",
  a: "l",
  d: "r",
  arrowup: "f",
  arrowdown: "b",
  arrowleft: "l",
  arrowright: "r",
  shift: "fast",
};
/** Key panning covers this many camera-distances a second (so it feels the same at any zoom), easing in this long (s). */
const KEY_PAN_SPEED = 0.9;
const KEY_PAN_EASE = 0.12;

/** Is the user typing into a text field (where keys aren't for the game)? */
function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);
}

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

    // No MSAA on the canvas: the scene is drawn into the composer's (non-multisampled) targets, so it would only
    // multisample the final full-screen copy.
    this.renderer = new WebGLRenderer({ canvas, antialias: false, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, this.quality.maxPixelRatio));
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.95;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = PCFShadowMap;
    // Redrawn only when something casting a shadow moves (see frame): not for a camera move alone.
    this.renderer.shadowMap.autoUpdate = false;

    this.camera = new PerspectiveCamera(30, 1, 5, 40000);
    this.camera.position.set(700, 620, 1050);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.target.set(0, 0, 0);
    this.controls.enableDamping = true;
    // Right-drag turns settle quickly after release (panning, by touch or the left button, has its own glide: see
    // TouchCamera).
    this.controls.dampingFactor = 0.2;
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
    syncCuttings(this.landscape, this.layout);
    this.landscapeView.syncTrees(this.layout);
    this.trackView = new TrackView(this.layout, this.mats, this.bridgeLevelsOf);
    this.scene.add(this.trackView.group);
    this.trackView.sync();
    this.physics = new DerailPhysics(this.layout);
    this.physics.bridgeLevels = this.bridgeLevelsOf;
    this.hillsFor = null;
    this.syncHillPhysics();
    this.trainView = new TrainView(this.mats);
    this.trainView.lookOf = (id) => this.sim.lookOf(id);
    this.scene.add(this.trainView.group);
    this.depotView = new DepotView(this.mats);
    this.scene.add(this.depotView.group);
    this.depotView.setWorld(this.economy, this.layout);
    this.crossingsView = new CrossingsView(this.mats);
    this.scene.add(this.crossingsView.group);
    this.crossingsView.setCrossings(findCrossings(this.landscape, this.layout));
    this.post = createPost(this.renderer, this.scene, this.camera, this.quality);

    window.addEventListener("resize", () => this.resize());
    // Any input may change what's drawn, and set things easing (a held piece after the finger, a selection).
    for (const type of ["pointerdown", "pointermove", "pointerup", "wheel", "keydown"]) window.addEventListener(type, () => (this.woken = true), { passive: true });
    // WASD / arrow keys pan the view (desktop).
    window.addEventListener("keydown", (e) => {
      const key = PAN_KEYS[e.key.toLowerCase()];
      if (!key || e.ctrlKey || e.metaKey || e.altKey || isTyping(e.target)) return;
      e.preventDefault(); // arrows would scroll the page
      this.panKeys.add(key);
      if (this.followCarId !== -1) this.follow(-1);
    });
    window.addEventListener("keyup", (e) => {
      const key = PAN_KEYS[e.key.toLowerCase()];
      if (key) this.panKeys.delete(key);
    });
    window.addEventListener("blur", () => this.panKeys.clear());
    this.resize();
    this.frameLayout();
  }

  /** Swap in a different layout and simulation (new game, load). */
  setWorld(world: GameWorld): void {
    this.invalidate();
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
    syncCuttings(this.landscape, this.layout);
    this.landscapeView.syncTrees(this.layout);
    this.scene.remove(this.trackView.group);
    this.trackView.dispose();
    (this as { trackView: TrackView }).trackView = new TrackView(this.layout, this.mats, this.bridgeLevelsOf);
    this.scene.add(this.trackView.group);
    this.trackView.sync();
    this.physics.setLayout(this.layout);
    this.hillsFor = null;
    this.syncHillPhysics();
    this.crossingsView.setCrossings(findCrossings(this.landscape, this.layout));
    this.depotView.setWorld(this.economy, this.layout);
  }

  /** How many riser heights a placed bridge's arches reach down to the ground (0 for other pieces). */
  readonly bridgeLevelsOf = (p: PlacedPiece): number => bridgeLevels(this.landscape, p.type, p.flipped, p.pose, p.y);

  get world(): World {
    return { layout: this.layout, sim: this.sim, landscape: this.landscape, stations: this.stations, depots: this.depots, economy: this.economy };
  }

  /** What the hills' colliders were last built for (the cut blocks and what cuts them). */
  private hillsFor: string | null = null;

  /** Hills as derailed cars find them: blocks cut by cuttings as their cut shape. Call after `syncCuttings`. */
  private syncHillPhysics(): void {
    const grid = this.landscape.grid;
    const cut = hillsOf(grid).cutBlocks();
    const key = cut.map((b) => `${b.col},${b.row},${b.level}:${b.key}`).join(";");
    if (key === this.hillsFor) return;
    this.hillsFor = key;
    const ids = new Set(cut.map((b) => `${b.col},${b.row},${b.level}`));
    const pieces = hillPieces(grid, (c, r, level) => ids.has(`${c},${r},${level}`));
    const columns = cut.map((b) => {
      const { body, paint } = cutColumn(grid, b);
      const soup = body.getAttribute("position").array as Float32Array;
      body.dispose();
      paint.dispose();
      return soup;
    });
    this.physics.setSlabs(pieces.slabs, pieces.round, columns);
  }

  /** Call after any layout edit. */
  trackChanged(): void {
    this.invalidate();
    this.trackView.sync();
    // Ramps cut into the hills (before anything asks the ground, trees included).
    syncCuttings(this.landscape, this.layout);
    const hop = this.landscapeView.syncTrees(this.layout, true);
    if (hop) this.flourishes.add(hop);
    this.syncHillPhysics();
    this.economy.prune();
    this.crossingsView.setCrossings(findCrossings(this.landscape, this.layout));
    this.physics.markTrackDirty();
  }

  /**
   * Trees hop aside for a piece held over the mat (null: nothing held, they go back). Without `retarget` this only
   * forgets the held piece, for the layout change that follows a drop to settle the trees.
   */
  previewTrees(held: HeldPiece | null, retarget = true): void {
    if (!retarget) {
      this.landscapeView.forgetHeld();
      return;
    }
    const hop = this.landscapeView.previewTrees(held);
    if (hop) this.flourishes.add(hop);
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
    this.invalidate();
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    const pr = this.renderer.getPixelRatio();
    this.post.setSize(Math.floor(w * pr), Math.floor(h * pr));
  }

  start(): void {
    this.renderer.setAnimationLoop((time) => {
      if (time - this.lastFrameAt < FRAME_MS - FRAME_SLACK_MS) return;
      this.lastFrameAt = time;
      this.frame();
    });
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
    const derailedCars = this.derailedCars;
    derailedCars.clear();
    for (let i = 0; i < this.snapshot.count; i++) if (this.snapshot.derailed[i]) derailedCars.add(this.snapshot.ids[i]);
    this.physics.retain((id) => derailedCars.has(id));
    if (!this.paused) this.physics.step(dt);
    this.simMs = performance.now() - t0;
    this.trainView.update(this.snapshot, dt, (id, out) => this.physics.poseOf(id, out));
    let active = this.crossingsView.update(this.snapshot, dt);
    const depots = this.depotView.update(this.economy, this.snapshot.ids, this.snapshot.count, (id) => this.trainView.carObject(id), dt);
    if (depots === "moving") active = true;
    else if (depots === "changed") this.invalidate();
    if (this.trainsChanged() || this.physics.moving || this.flourishes.count > 0) active = true;
    // Things casting shadows have moved (the camera alone doesn't change the shadow map).
    const shadowsMoved = active || this.shadowsMoving;
    this.shadowsMoving = false;
    this.onFrame?.(dt);
    this.flourishes.update(dt);
    // A finger fling glides on between touches (a director glide or zoom takes over from it).
    if (this.director.busy) this.touchCamera.gestures.stop();
    else if (!this.touchCamera.touching) this.touchCamera.gestures.glide(dt);
    this.keyPan(dt);
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
    if (this.cameraMoved() || this.woken) active = true;
    this.woken = false;
    // Draw only while something on screen is changing (and a moment after, for anything easing to rest): a still
    // scene stays on screen without being drawn again, so an idle game costs next to nothing.
    const now = this.clock.elapsedTime;
    // Something easing or moving keeps drawing for a moment after; a one-off change (invalidate) draws one frame.
    if (active) this.lastActive = now;
    const once = this.dirty;
    this.dirty = false;
    if (!once && now - this.lastActive > IDLE_TAIL) return;
    const radius = shadowRadiusForView(this.camera, t);
    const refit = shouldRefit(this.stage.shadowFit, t.x, t.z, radius);
    if (refit) this.stage.fitShadow(t.x, t.z, radius);
    if (shadowsMoved || once || refit) this.renderer.shadowMap.needsUpdate = true;
    this.stage.update(this.camera);
    this.post.setFocus(dist);
    this.post.render(now);
  }

  /** Pan keys held now (forward, back, left, right), and the pan's current velocity (world mm/s). */
  private readonly panKeys = new Set<"f" | "b" | "l" | "r" | "fast">();
  private readonly panVelocity = new Vector3();
  private readonly panDir = new Vector3();
  private readonly panSide = new Vector3();

  /** Move the view along the ground with the pan keys: easing up to speed and back to rest, faster zoomed out. */
  private keyPan(dt: number): void {
    const k = this.panKeys;
    const forward = (k.has("f") ? 1 : 0) - (k.has("b") ? 1 : 0);
    const side = (k.has("r") ? 1 : 0) - (k.has("l") ? 1 : 0);
    if (forward === 0 && side === 0 && this.panVelocity.lengthSq() < 1) {
      this.panVelocity.set(0, 0, 0);
      return;
    }
    if (forward !== 0 || side !== 0) this.director.cancel();
    // Forward is the way the camera looks, flattened onto the ground.
    this.camera.getWorldDirection(this.panDir);
    this.panDir.y = 0;
    if (this.panDir.lengthSq() < 1e-6) this.panDir.set(0, 0, -1);
    this.panDir.normalize();
    this.panSide.set(-this.panDir.z, 0, this.panDir.x);
    const speed = KEY_PAN_SPEED * this.camera.position.distanceTo(this.controls.target) * (k.has("fast") ? 2.5 : 1);
    const goalX = (this.panDir.x * forward + this.panSide.x * side) * speed;
    const goalZ = (this.panDir.z * forward + this.panSide.z * side) * speed;
    const ease = 1 - Math.exp(-dt / KEY_PAN_EASE);
    this.panVelocity.x += (goalX - this.panVelocity.x) * ease;
    this.panVelocity.z += (goalZ - this.panVelocity.z) * ease;
    const dx = this.panVelocity.x * dt;
    const dz = this.panVelocity.z * dt;
    this.controls.target.x += dx;
    this.controls.target.z += dz;
    this.camera.position.x += dx;
    this.camera.position.z += dz;
  }

  /** Something changed that the frame loop can't see (track, scenery, a selection, a resize): draw it (once). */
  invalidate(): void {
    this.dirty = true;
  }

  /** Something casting a shadow moved this frame that the frame loop can't see (a held piece): redraw shadows. */
  moveShadows(): void {
    this.shadowsMoving = true;
  }

  private readonly derailedCars = new Set<number>();
  private dirty = true;
  /** Input arrived: keep drawing for a moment, for whatever it set easing (a held piece, a selection). */
  private woken = false;
  private lastActive = 0;
  private lastFrameAt = -Infinity;
  private shadowsMoving = false;
  private readonly lastCamera = new Float64Array(12);

  /**
   * Has the camera moved, turned or zoomed since the last frame? Compares the camera's own settings, not its matrices
   * (rendering may adjust those for a frame). Damped controls creep ever closer to rest without arriving: changes too
   * small to see don't count, and the reference only moves on when a change counts, so a slow creep still adds up.
   */
  private cameraMoved(): boolean {
    const c = this.camera;
    const now = [c.position.x, c.position.y, c.position.z, c.quaternion.x, c.quaternion.y, c.quaternion.z, c.quaternion.w, c.fov, c.aspect, c.near, c.far, c.zoom];
    const last = this.lastCamera;
    let moved = false;
    for (let i = 0; i < now.length; i++) if (Math.abs(last[i] - now[i]) > (i < 3 ? 0.01 : 1e-6 * Math.max(1, Math.abs(now[i])))) moved = true;
    if (moved) for (let i = 0; i < now.length; i++) last[i] = now[i];
    return moved;
  }

  private lastTrains = new Float32Array(0);
  private lastTrainCount = -1;

  /** Has any car moved, a lever changed or a train come off since the last frame? */
  private trainsChanged(): boolean {
    const snap = this.snapshot;
    const n = snap.count * 6;
    if (this.lastTrains.length < n + snap.count) this.lastTrains = new Float32Array((n + snap.count) * 2);
    const last = this.lastTrains;
    let changed = snap.count !== this.lastTrainCount;
    this.lastTrainCount = snap.count;
    for (let i = 0; i < n; i++) {
      if (last[i] !== snap.transforms[i]) changed = true;
      last[i] = snap.transforms[i];
    }
    for (let i = 0; i < snap.count; i++) {
      const v = snap.levers[i] * 2 + snap.derailed[i] + snap.ids[i] * 4;
      if (last[n + i] !== v) changed = true;
      last[n + i] = v;
    }
    return changed;
  }
}

import type { Footprint } from "../props/placement";
import type { SignBadge } from "../render/landscape-view";
import type { PropStore } from "../props/store";
import { PropLibrary } from "../render/props/library";
import { BoatsView } from "../render/boats-view";
import { PropsView } from "../render/props/props-view";
import { KitView } from "../render/kit-view";
import { ClockView } from "../render/clock-view";
import {
  ACESFilmicToneMapping,
  Clock,
  type Fog,
  PCFShadowMap,
  PerspectiveCamera,
  Scene,
  SRGBColorSpace,
  Spherical,
  Vector3,
  WebGLRenderer,
} from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { LandscapeView, type AroundPlot } from "../render/landscape-view";
import { pulseBeacons } from "../render/dressing/roads";
import { createMaterials, type Materials } from "../render/materials";
import { Flourishes } from "../render/flourishes";
import { createPost, type Post } from "../render/post";
import { ResolutionGovernor } from "../render/resolution";
import { detectQuality, type QualitySettings } from "../render/quality";
import { createStage, type Stage } from "../render/stage";
import { shadowRadiusForView, shouldRefit } from "../render/shadow-fit";
import { onPiecesBuilt, TrackView } from "../render/track-view";
import { TrainView } from "../render/train-view";
import type { Economy } from "../economy";
import { CrossingsView } from "../render/crossings-view";
import { DepotView } from "../render/depot-view";
import { createSnapshot, SIM_DT, type Sim, type SimEvent, type SimSnapshot } from "../sim";
import { archFloors, bridgeLevels, findCrossings, SURF_LANE, syncCuttings, type HeldPiece, PLOT_DEPTH, type Landscape } from "../landscape";
import { setHazeLand, setHazeReach } from "../render/haze";
import { cullTiles, detailReach, viewReach } from "../render/dressing/tiles";
import { connectorRef, getPieceDef, pathLength, type KitDef, type Layout, type PlacedPiece } from "../track";
import { CameraDirector, nearPlaneFor } from "./camera-director";
import { TouchCamera } from "./touch-camera";
import { hasLandForSale, landForSale, plotsAround, unlockPlot, type World } from "./world";

const MAX_STEPS_PER_FRAME = 8;
/**
 * How far the camera may pull back: the same however big the land grows, so (with the view's reach: see `viewReach`)
 * only so much of the world is ever drawn.
 */
const MAX_DISTANCE = 14000;

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
type PanKey = "f" | "b" | "l" | "r" | "ccw" | "cw" | "up" | "down" | "fast";

const PAN_KEYS: Record<string, PanKey> = {
  w: "f",
  s: "b",
  a: "l",
  d: "r",
  arrowup: "f",
  arrowdown: "b",
  arrowleft: "l",
  arrowright: "r",
  // Q and E turn the view round the point it looks at.
  q: "ccw",
  e: "cw",
  // R and F tilt it (when they aren't turning or flipping a selected piece: see `keysTaken`).
  r: "up",
  f: "down",
  shift: "fast",
};
/** Camera distance (mm) beyond which wood and paint drop the grain, bumps and clear coat too small to see. */
const FAR_DETAIL = 1800;

/** Key panning covers this many camera-distances a second (so it feels the same at any zoom), easing in this long (s). */
const KEY_PAN_SPEED = 0.9;
const KEY_PAN_EASE = 0.12;
/** Q / E turning speed (radians per second; Shift for faster). */
const KEY_TURN_SPEED = 1.6;
/** R / F tilting speed (radians per second), and the most top-down it goes (as a finger tilt). */
const KEY_TILT_SPEED = 0.8;
const KEY_TILT_MIN = 0.12;

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
  /** Simulation events from the latest frame (derailments, couplings, …). */
  events: SimEvent[] = [];
  layout: Layout;
  sim: Sim;
  landscape: Landscape;
  stations: Map<number, number>;
  depots: Map<number, number>;
  economy: Economy;
  props: PropStore;
  /** Builds catalogue models on first use (see `PropLibrary`). */
  readonly propLibrary: PropLibrary;
  /** Boats calling at harbours (Game mode). */
  readonly boats: BoatsView;
  readonly propsView: PropsView;
  /** The kit pieces' models, drawn where their pieces stand (see `KitView`). */
  readonly kitView: KitView;
  /** Station clocks' hands, showing the game's time (see `ClockView`). */
  readonly clockView: ClockView;
  /** A prop being moved by hand: not drawn where it stood. */
  private hiddenProp = -1;
  paused = false;
  /** Seconds the world has run (it stops while paused): game time, for "2 min ago". */
  simSeconds = 0;
  /** Called once per frame after the simulation steps, before rendering. */
  onFrame: ((dt: number) => void) | null = null;
  /** Milliseconds spent simulating in the last frame (for the perf overlay). */
  simMs = 0;
  private readonly clock = new Clock();
  /** Drawing materials without their fine detail (zoomed far out). */
  private farDetail = false;
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
    this.watchSwitches();
    this.props = world.props;
    this.quality = detectQuality();

    // No MSAA on the canvas: the scene is drawn into the composer's (non-multisampled) targets, so it would only
    // multisample the final full-screen copy.
    this.renderer = new WebGLRenderer({ canvas, antialias: false, powerPreference: "high-performance" });
    this.resolution = new ResolutionGovernor(window.devicePixelRatio, this.quality.maxPixelRatio, this.quality.minPixelRatio);
    this.renderer.setPixelRatio(this.resolution.current);
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
    this.controls.maxDistance = MAX_DISTANCE;
    this.controls.maxPolarAngle = 1.42;
    this.controls.screenSpacePanning = false;
    this.director = new CameraDirector(this.camera, this.controls);
    this.touchCamera = new TouchCamera(canvas, this.camera, this.controls.target, this.controls, () => this.controls.enabled, () => {
      // Same as the controls starting a drag: any glide or eased zoom gives way to the fingers.
      this.controls.dispatchEvent({ type: "start" });
    });

    this.mats = createMaterials(this.renderer.capabilities.getMaxAnisotropy());
    this.stage = createStage(this.scene, this.renderer, this.quality);
    // The kinds of piece this railway has (carved while loading; any other kind is carved in the background, and shown
    // as a stand-in for a moment if it's wanted before its turn).
    TrackView.prebuild([...new Set([...this.layout.pieceIds()].map((id) => this.layout.getPiece(id)!.type))]);
    // Pieces carved in the background swap in for their stand-ins.
    onPiecesBuilt(() => {
      this.trackView.piecesBuilt();
      this.invalidate();
    });
    this.landscapeView = new LandscapeView(this.landscape, this.mats, !this.quality.ambientOcclusion);
    this.scene.add(this.landscapeView.group);
    syncCuttings(this.landscape, this.layout);
    this.landscapeView.syncTrees(this.layout);
    this.trackView = new TrackView(this.layout, this.mats, this.bridgeLevelsOf, this.archFloorsOf);
    this.trackView.onRoad = this.onRoad;
    this.trackView.signalClear = (id) => this.sim.signalClear(id);
    this.scene.add(this.trackView.group);
    this.trackView.sync();
    this.trainView = new TrainView(this.mats);
    this.trainView.lookOf = (id) => this.sim.lookOf(id);
    this.scene.add(this.trainView.group);
    this.depotView = new DepotView(this.mats);
    this.scene.add(this.depotView.group);
    this.depotView.setWorld(this.economy, this.layout);
    this.crossingsView = new CrossingsView(this.mats);
    this.scene.add(this.crossingsView.group);
    this.crossingsView.setCrossings(findCrossings(this.landscape, this.layout));
    this.propLibrary = new PropLibrary(this.mats);
    this.propsView = new PropsView(this.propLibrary);
    this.scene.add(this.propsView.group);
    this.kitView = new KitView(this.propLibrary);
    this.scene.add(this.kitView.group);
    this.clockView = new ClockView(this.propLibrary);
    this.scene.add(this.clockView.group);
    // A model arriving (its code fetched and built) draws the props (and kits) that were waiting for it.
    this.propLibrary.onLoaded = (key) => {
      if (key.startsWith("kit:")) this.syncKits(true);
      else {
        this.propsView.sync(this.props, this.hiddenProp, true);
        this.clockView.sync(this.props, this.hiddenProp, true);
      }
      this.invalidate();
    };
    this.propsView.sync(this.props);
    this.clockView.sync(this.props);
    this.watchHidden();
    this.syncKits();
    this.boats = new BoatsView(this.propLibrary, () => this.invalidate());
    this.scene.add(this.boats.group);
    this.post = createPost(this.renderer, this.scene, this.camera, this.quality);

    this.landChanged();

    window.addEventListener("resize", () => this.resize());
    // Any input may change what's drawn, and set things easing (a held piece after the finger, a selection).
    for (const type of ["pointerdown", "pointermove", "pointerup", "wheel", "keydown"]) window.addEventListener(type, () => (this.woken = true), { passive: true });
    // WASD / arrow keys pan the view (desktop).
    window.addEventListener("keydown", (e) => {
      const key = PAN_KEYS[e.key.toLowerCase()];
      if (!key || e.ctrlKey || e.metaKey || e.altKey || isTyping(e.target)) return;
      if ((key === "up" || key === "down") && this.keysTaken()) return;
      e.preventDefault(); // arrows would scroll the page
      this.panKeys.add(key);
      // Panning leaves a followed train; turning keeps following it.
      if (this.followCarId !== -1 && (key === "f" || key === "b" || key === "l" || key === "r")) this.follow(-1);
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
    this.boats.clear();
    this.layout = world.layout;
    this.sim = world.sim;
    this.landscape = world.landscape;
    this.stations = world.stations;
    this.depots = world.depots;
    this.economy = world.economy;
    this.watchSwitches();
    this.props = world.props;
    this.hiddenProp = -1;
    this.trackVersion++;
    this.propsView.sync(this.props, -1, true);
    this.clockView.sync(this.props, -1, true);
    this.scene.remove(this.landscapeView.group);
    this.landscapeView.dispose();
    this.landscapeView = new LandscapeView(this.landscape, this.mats, !this.quality.ambientOcclusion);
    this.scene.add(this.landscapeView.group);
    syncCuttings(this.landscape, this.layout);
    this.landscapeView.syncTrees(this.layout);
    this.scene.remove(this.trackView.group);
    this.trackView.dispose();
    (this as { trackView: TrackView }).trackView = new TrackView(this.layout, this.mats, this.bridgeLevelsOf, this.archFloorsOf);
    this.trackView.onRoad = this.onRoad;
    this.trackView.signalClear = (id) => this.sim.signalClear(id);
    this.trackView.showAllEnds(this.allEnds);
    this.scene.add(this.trackView.group);
    this.trackView.sync();
    this.watchHidden();
    this.syncKits(true);
    this.crossingsView.setCrossings(findCrossings(this.landscape, this.layout));
    this.depotView.setWorld(this.economy, this.layout);
    this.landChanged();
  }

  /**
   * Buy a plot beside the land (see `unlockPlot`): it joins the world and is drawn, with its towns' stations and its
   * depots. Returns what it brought, or null if it can't be bought.
   */
  unlockPlot(px: number, pz: number): ReturnType<typeof unlockPlot> {
    const bought = unlockPlot(this.world, px, pz);
    if (!bought) return null;
    this.invalidate();
    const t0 = performance.now();
    this.landscapeView.addPlots(bought.slots, this.aroundReady());
    this.trackChanged();
    this.depotView.setWorld(this.economy, this.layout);
    this.landChanged();
    // The new towns' buildings are catalogue models (props).
    this.propsChanged();
    this.lastUnlockMs = performance.now() - t0;
    return bought;
  }

  /** How long the last plot took to add (ms), for the perf readout. */
  lastUnlockMs = 0;

  /**
   * The land grew (or a new world): the camera may look a little past its edge (half a plot, so the land around can
   * be seen and bought), the haze sits round it, and the land around it is made ready.
   */
  private landChanged(): void {
    const e = this.landscape.grid.extent();
    const m = PLOT_DEPTH / 2;
    this.director.bounds = { x0: e.x0 - m, z0: e.z0 - m, x1: e.x1 + m, z1: e.z1 + m };
    setHazeLand(this.scene.fog as Fog, e);
    this.prepareAround();
  }

  private aroundToken = 0;
  /** How far preparing the land around has got, once every plot is ready: backdrop, felt (in steps), scenery. */
  private aroundStep = 0;

  /** The land around that has been generated already, to show around the world. */
  private aroundReady(): AroundPlot[] {
    const land = this.landscape;
    return plotsAround(land)
      .filter((p) => hasLandForSale(land, p.px, p.pz))
      .map((p) => ({ ...p, land: landForSale(land, p.px, p.pz) }));
  }

  /**
   * Generate the land around the world that isn't yet, a plot at a time between frames (so nothing stalls), then show
   * it. Does nothing more once it's all there.
   */
  private prepareAround(): void {
    const land = this.landscape;
    const token = ++this.aroundToken;
    // One piece of work per slice: generate a plot, make its scenery, make the countryside beyond; then show them.
    const step = () => {
      if (token !== this.aroundToken || land !== this.landscape) return;
      const wanted = plotsAround(land);
      const next = wanted.find((p) => !hasLandForSale(land, p.px, p.pz));
      if (next) {
        landForSale(land, next.px, next.pz);
        setTimeout(step, 16);
        return;
      }
      const around = this.aroundReady();
      if (this.landscapeView.showsAround(around)) return;
      const unmade = around.find((a) => !this.landscapeView.aroundReady(a.px, a.pz));
      if (unmade) {
        this.landscapeView.prepareAround(unmade);
        setTimeout(step, 16);
        return;
      }
      // Then the countryside beyond, the felt and the merged scenery, a slice each; then swap them in.
      const steps = ["river", "roads", "felt", "scenery"] as const;
      if (this.aroundStep <= steps.length) {
        if (this.aroundStep === 0) this.landscapeView.prepareBackdrop(around);
        else this.landscapeView.prepareShow(around, steps[this.aroundStep - 1]);
        this.aroundStep++;
        setTimeout(step, 16);
        return;
      }
      this.landscapeView.setAround(around);
      this.invalidate();
    };
    this.aroundStep = 0;
    setTimeout(step, 16);
  }

  /** How many riser heights a placed bridge's arches reach down to the ground (0 for other pieces). */
  readonly bridgeLevelsOf = (p: PlacedPiece): number => bridgeLevels(this.landscape, p.type, p.flipped, p.pose, p.y);
  /** How far down a placed bridge's arch openings reach, over a hill's edge (null: all its levels). */
  readonly archFloorsOf = (p: PlacedPiece, levels = this.bridgeLevelsOf(p)): number[] | null => archFloors(this.landscape, p.type, p.flipped, p.pose, p.y, levels);

  get world(): World {
    return { layout: this.layout, sim: this.sim, landscape: this.landscape, stations: this.stations, depots: this.depots, economy: this.economy, props: this.props };
  }

  private allEnds = false;
  /** Building (the Track tab open): every free end of track shows its end board, not just those trains turn back at. */
  showAllEnds(on: boolean): void {
    this.allEnds = on;
    this.trackView.showAllEnds(on);
    this.invalidate();
  }

  /** The free end of track a train's front stands at, marked as one trains turn back at. True if newly marked. */
  private markOpenEnd(trainId: number): boolean {
    const front = this.sim.getTrain(trainId)?.bogies[0];
    const piece = front && this.layout.getPiece(front.pieceId);
    if (!front || !piece) return false;
    const path = getPieceDef(piece.type, piece.flipped).paths[front.pathIndex];
    const end = front.reversed ? path?.from : path?.to;
    // A buffer's end, or a train met head on in the middle of a piece: not open track.
    if (end === null || end === undefined) return false;
    const toEnd = front.reversed ? front.s : pathLength(path.geom) - front.s;
    if (toEnd > 60) return false;
    return this.trackView.markTurnedBack(connectorRef(front.pieceId, end));
  }

  /** Call after any layout edit. */
  /** Goes up whenever the track changes (or a new world is shown), for caches keyed by it (the whistle posts' near track). */
  trackVersion = 0;

  trackChanged(): void {
    this.trackVersion++;
    this.invalidate();
    // Ramps cut into the hills, before anything asks the ground: the track's arches (how far down a bridge reaches),
    // trees.
    syncCuttings(this.landscape, this.layout);
    this.trackView.sync();
    this.syncKits();
    const hop = this.landscapeView.syncTrees(this.layout, true);
    if (hop) this.flourishes.add(hop);
    this.economy.prune();
    this.crossingsView.setCrossings(findCrossings(this.landscape, this.layout));
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

  /** The kits' models follow the layout (a diff: only kits added, moved, taken up or put down are touched). */
  syncKits(force = false): void {
    if (this.kitView.sync(this.layout, (id) => this.trackView.isHidden(id), force)) this.invalidate();
  }

  /** A piece hidden while its stand-in settles hides its kit model too. */
  private watchHidden(): void {
    this.trackView.onHidden = () => this.syncKits();
  }

  /** Re-rail a derailed train near where its lead car came to rest. Returns the new train id or -1. */
  rerail(trainId: number): number {
    const t = this.sim.getTrain(trainId);
    if (!t) return -1;
    return this.sim.rerail(trainId, 150);
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
    // Always include the land.
    const e = this.landscape.grid.extent();
    minX = Math.min(minX, e.x0);
    maxX = Math.max(maxX, e.x1);
    minZ = Math.min(minZ, e.z0);
    maxZ = Math.max(maxZ, e.z1);
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

  /**
   * Put the camera straight onto a view (no glide): looking at `target` from `distance`, tilted `phi` from straight
   * down, from the side it's on now.
   */
  lookAt(target: Vector3, distance: number, phi: number, theta: number | null = null): void {
    const dir = this.camera.position.clone().sub(this.controls.target);
    dir.y = 0;
    if (theta !== null) dir.set(Math.sin(theta), 0, Math.cos(theta));
    if (dir.lengthSq() < 1e-6) dir.set(0, 0, 1);
    dir.normalize();
    this.controls.target.copy(target);
    this.camera.position.set(target.x + dir.x * Math.sin(phi) * distance, target.y + Math.cos(phi) * distance, target.z + dir.z * Math.sin(phi) * distance);
    this.controls.update();
    this.director.constrain();
    this.invalidate();
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

  /** Frames drawn since start (for tests and measuring: an idle game should add none). */
  framesDrawn = 0;
  /** Those waiting for the scene to be still: how many ticks in a row each still wants, and how many it's seen. */
  private settling: { ticks: number; still: number; done: () => void }[] = [];

  /**
   * Resolves once the scene has been still (nothing drawn) for `ticks` ticks in a row, counted from now: for tests,
   * in place of waiting a fixed time for animations and camera moves to end.
   */
  settled(ticks = 5): Promise<void> {
    return new Promise((done) => this.settling.push({ ticks, still: 0, done }));
  }

  private settleWaiters(drew: boolean): void {
    this.settling = this.settling.filter((w) => {
      w.still = drew ? 0 : w.still + 1;
      if (w.still < w.ticks) return true;
      w.done();
      return false;
    });
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
        this.simSeconds += SIM_DT;
        this.accumulator -= SIM_DT;
        steps++;
      }
      if (steps === MAX_STEPS_PER_FRAME) this.accumulator = 0;
    }
    // Station clocks show the game's time: their hands are set when its minute changes (drawn if one's in view).
    if (this.clockView.count > 0 && this.clockView.tick(this.simSeconds, this.camera)) this.invalidate();
    // A signal changed aspect: its arm moves (nothing else is redrawn).
    if (this.sim.signalsVersion !== this.signalsShown) {
      this.signalsShown = this.sim.signalsVersion;
      this.trackView.syncSwitches();
      this.invalidate();
    }
    this.events = this.sim.drainEvents();
    // A train turned back where the track just stops: that end's board shows (a gap is plain to see).
    for (const e of this.events) if (e.kind === "buffer" && this.markOpenEnd(e.trainId)) this.invalidate();
    this.sim.writeSnapshot(this.snapshot);
    this.simMs = performance.now() - t0;
    const tipping = this.trainView.update(this.snapshot, dt);
    let active = this.crossingsView.update(this.snapshot, dt);
    const depots = this.depotView.update(this.economy, this.snapshot.ids, this.snapshot.count, (id) => this.trainView.carObject(id), dt);
    if (depots === "moving") active = true;
    else if (depots === "changed") this.invalidate();
    const trainsMoved = this.trainsChanged();
    if (trainsMoved || tipping || this.flourishes.count > 0) active = true;
    // Kits' moving parts (doors, cranes, spouts): looked at only on frames where trains moved or one halted, or while
    // one is still moving. Idle, this is a couple of comparisons.
    if (this.kitView.hasMovers && (trainsMoved || this.kitView.animating || this.economy.halts !== this.haltsSeen)) {
      this.haltsSeen = this.economy.halts;
      const kits = this.kitView.update(this.kitTriggered, dt);
      if (kits === "moving") active = true;
      else if (kits === "changed") this.invalidate();
    }
    // Boats sailing in view (one out of view moves on unseen, drawing nothing).
    if (this.boats.update(this.camera)) active = true;
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
    // Far out, materials drop detail too small to see (with a margin, so hovering at the edge doesn't flip-flop).
    const far = dist > (this.farDetail ? FAR_DETAIL - 200 : FAR_DETAIL);
    if (far !== this.farDetail) {
      this.farDetail = far;
      this.mats.setFar(far);
      this.dirty = true;
    }
    const near = nearPlaneFor(dist);
    if (Math.abs(near - this.camera.near) > 0.5) {
      this.camera.near = near;
      this.camera.updateProjectionMatrix();
    }
    if (this.cameraMoved() || this.woken) {
      active = true;
      // A boat moved unseen: its shadow may still be drawn where it was, now coming into view.
      if (this.boats.shadowsStale) {
        this.boats.shadowsStale = false;
        this.shadowsMoving = true;
        this.invalidate();
      }
    }
    this.woken = false;
    // Draw only while something on screen is changing (and a moment after, for anything easing to rest): a still
    // scene stays on screen without being drawn again, so an idle game costs next to nothing.
    const now = this.clock.elapsedTime;
    // Something easing or moving keeps drawing for a moment after; a one-off change (invalidate) draws one frame.
    if (active) this.lastActive = now;
    const once = this.dirty;
    this.dirty = false;
    if (!once && now - this.lastActive > IDLE_TAIL) {
      this.drewLastTick = false;
      if (this.settling.length > 0) this.settleWaiters(false);
      return;
    }
    if (this.settling.length > 0) this.settleWaiters(true);
    const radius = shadowRadiusForView(this.camera, t);
    const refit = shouldRefit(this.stage.shadowFit, t.x, t.z, radius);
    if (refit) this.stage.fitShadow(t.x, t.z, radius);
    // Only the parts of the world in view are drawn; parts coming into view bring their shadows.
    this.camera.updateMatrixWorld();
    const reach = viewReach(dist);
    setHazeReach(this.scene.fog as Fog, reach);
    const detail = detailReach(dist);
    const landCulled = this.landscapeView.cull(this.camera, reach, detail);
    const culled = cullTiles([this.depotView.group], this.camera, reach, detail) || landCulled;
    if (shadowsMoved || once || refit || culled) this.renderer.shadowMap.needsUpdate = true;
    this.stage.update(this.camera);
    pulseBeacons(this.mats, now);
    this.post.setFocus(dist);
    this.post.render(now);
    this.framesDrawn++;
    // A picture of this frame wanted (a debug report): taken now, while the drawing buffer still holds it.
    if (this.grabFrame) {
      const take = this.grabFrame;
      this.grabFrame = null;
      take(this.canvas);
    }
    // Too slow at this resolution: step down (the next frame draws at the new size).
    const ratio = this.resolution.frameDrawn(this.lastFrameAt, this.drewLastTick);
    this.drewLastTick = true;
    if (ratio !== null) {
      this.renderer.setPixelRatio(ratio);
      this.resize();
    }
  }

  /** Give the drawing resolution a rest from judging frame times for a while (see `ResolutionGovernor.rest`). */
  settleResolution(ms = 3000): void {
    this.resolution.rest(performance.now() + ms);
  }

  private grabFrame: ((canvas: HTMLCanvasElement) => void) | null = null;

  /** A picture of the next frame drawn (it's drawn at once), as a WebP or PNG. */
  capture(): Promise<Blob | null> {
    return new Promise((resolve) => {
      this.grabFrame = (canvas) => {
        // Copied out synchronously: the drawing buffer is cleared once this task ends.
        const copy = document.createElement("canvas");
        copy.width = canvas.width;
        copy.height = canvas.height;
        copy.getContext("2d")?.drawImage(canvas, 0, 0);
        copy.toBlob((b) => resolve(b), "image/webp", 0.85);
      };
      this.invalidate();
    });
  }

  /** Pan keys held now (forward, back, left, right), and the pan's current velocity (world mm/s). */
  private readonly panKeys = new Set<PanKey>();
  private turnVelocity = 0;
  private tiltVelocity = 0;
  /** Are R and F wanted for something else just now (a selected or held piece)? Set by the app. */
  keysTaken: () => boolean = () => false;
  private readonly panVelocity = new Vector3();
  private readonly panDir = new Vector3();
  private readonly panSide = new Vector3();

  /** Move the view along the ground with the pan keys: easing up to speed and back to rest, faster zoomed out. */
  private keyPan(dt: number): void {
    this.keyTurn(dt);
    this.keyTilt(dt);
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

  /** Turn the view round the point it looks at with Q and E, easing up to speed and back to rest. */
  private keyTurn(dt: number): void {
    const k = this.panKeys;
    const turn = (k.has("cw") ? 1 : 0) - (k.has("ccw") ? 1 : 0);
    if (turn === 0 && Math.abs(this.turnVelocity) < 1e-3) {
      this.turnVelocity = 0;
      return;
    }
    if (turn !== 0) this.director.cancel();
    const goal = turn * KEY_TURN_SPEED * (k.has("fast") ? 2 : 1);
    this.turnVelocity += (goal - this.turnVelocity) * (1 - Math.exp(-dt / KEY_PAN_EASE));
    const a = this.turnVelocity * dt;
    const t = this.controls.target;
    const dx = this.camera.position.x - t.x;
    const dz = this.camera.position.z - t.z;
    const c = Math.cos(a);
    const s = Math.sin(a);
    this.camera.position.x = t.x + dx * c + dz * s;
    this.camera.position.z = t.z - dx * s + dz * c;
    this.camera.lookAt(t);
  }

  /** Tilt the view with R (toward looking straight down) and F (toward the horizon), within the camera's limits. */
  private keyTilt(dt: number): void {
    const k = this.panKeys;
    const tilt = (k.has("down") ? 1 : 0) - (k.has("up") ? 1 : 0);
    if (tilt === 0 && Math.abs(this.tiltVelocity) < 1e-3) {
      this.tiltVelocity = 0;
      return;
    }
    if (tilt !== 0) this.director.cancel();
    const goal = tilt * KEY_TILT_SPEED * (k.has("fast") ? 2 : 1);
    this.tiltVelocity += (goal - this.tiltVelocity) * (1 - Math.exp(-dt / KEY_PAN_EASE));
    const t = this.controls.target;
    this.tiltOffset.subVectors(this.camera.position, t);
    this.tiltSph.setFromVector3(this.tiltOffset);
    this.tiltSph.phi = Math.min(this.controls.maxPolarAngle, Math.max(KEY_TILT_MIN, this.tiltSph.phi + this.tiltVelocity * dt));
    this.tiltOffset.setFromSpherical(this.tiltSph);
    this.camera.position.copy(t).add(this.tiltOffset);
    this.camera.lookAt(t);
  }
  private readonly tiltOffset = new Vector3();
  private readonly tiltSph = new Spherical();

  /** Something changed that the frame loop can't see (track, scenery, a selection, a resize): draw it (once). */
  /** Squares' heights changed in these plots (land editing): redraw them, and re-fit cuttings and trees. */
  editLand(slots: readonly number[]): void {
    for (const s of slots) this.landscape.grid.touch(s);
    this.landscapeView.landEdited(slots);
    this.trackChanged();
    this.invalidate();
  }

  /** A catalogue model's footprint, once its model has loaded (for keeping things clear of placed models). */
  footprintOf(asset: string): Footprint | undefined {
    return this.propLibrary.footprint(asset);
  }

  /** How many people wait on a town's platform (Game mode's passengers; null: its usual few). Cheap when unchanged. */
  setWaiting(townId: number, count: number | null): void {
    if (this.landscapeView.setWaiting(townId, count)) this.invalidate();
  }

  /** What a town's sign shows beside its name (Game mode: what it wants; see `SignBadge`). */
  setSignBadge(townId: number, badge: SignBadge | null): void {
    this.landscapeView.setSignBadge(townId, badge);
  }

  /**
   * Road pieces changed in these plots: redraw the roads (only the tiles whose squares changed rebuild), the trees if
   * any were cleared or brought back, and the level crossings.
   */
  roadsEdited(slots: readonly number[], trees: boolean): void {
    for (const s of slots) this.landscape.grid.touch(s);
    this.landscapeView.roadsEdited(trees);
    this.crossingsView.setCrossings(findCrossings(this.landscape, this.layout));
    // Switch levers stand clear of the roads.
    this.trackView.syncSwitches();
    this.invalidate();
  }

  /** Props were added, moved or removed (or one is being held: `hidden`, −1 for none): redraw them. */
  propsChanged(hidden = this.hiddenProp): void {
    this.hiddenProp = hidden;
    this.clockView.sync(this.props, hidden);
    if (this.propsView.sync(this.props, hidden)) this.invalidate();
  }

  /** The sim's signal aspects last drawn (see `Sim.signalsVersion`). */
  private signalsShown = -1;

  /** Is this spot on a road or lane (switch levers stand clear of them)? */
  private readonly onRoad = (x: number, z: number): boolean => {
    const g = this.landscape.grid;
    const i = g.cellAtWorld(x, z);
    return i !== -1 && (g.surface[i] === SURF_LANE || g.road[i] !== 0);
  };

  /** A train's route sets switches as it goes: show their levers where they now point. */
  private watchSwitches(): void {
    this.economy.onSwitch = () => {
      this.trackView.syncSwitches();
      this.invalidate();
    };
  }

    invalidate(): void {
    this.dirty = true;
  }

  /** Something casting a shadow moved this frame that the frame loop can't see (a held piece): redraw shadows. */
  moveShadows(): void {
    this.shadowsMoving = true;
  }

  private dirty = true;
  /** Input arrived: keep drawing for a moment, for whatever it set easing (a held piece, a selection). */
  private woken = false;
  private lastActive = 0;
  private lastFrameAt = -Infinity;
  /** Was a frame drawn on the last tick of the loop (so the time since is a frame's)? */
  private drewLastTick = false;
  /** Picks the drawing resolution (see `resolution.ts`). */
  private readonly resolution: ResolutionGovernor;
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
  /** `Economy.halts` as last seen (a train halting at a kit starts its moving parts). */
  private haltsSeen = 0;

  /** Does a kit's trigger for its moving parts hold (`KitDef.moves`): a train on it, or one standing at it? */
  private readonly kitTriggered = (pieceId: number, kit: KitDef): boolean =>
    kit.moves === "occupied" ? this.sim.pieceOccupied(pieceId) : kit.moves === "stopped" ? this.economy.standingAt(pieceId) : false;

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

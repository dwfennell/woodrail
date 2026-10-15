import { Euler, Group, Matrix4, MOUSE, Plane, Raycaster, Vector2, Vector3, Mesh, type Object3D, type TOUCH } from "three";
import { Editor, pieceCentre, poseForCentre, type RiserAt } from "../editor/editor";
import { buildCarModel, carVariant, disposeObject } from "../render/train-models";
import { dustPuff } from "../render/dust";
import { settle, shrinkAway, turn, wobbleBack, type Flourish, type PiecePose } from "../render/flourishes";
import { setRim } from "../render/materials";
import { ghostMesh, pieceGeometry, type OutlineTone } from "../render/track-view";
import { damp } from "../lib/tween";
import { ADV_OK, advanceCursor, CAR_SPECS, COUPLER_GAP, createAdvance, createWorldSample, cursorWorld, nearestCursor, type CarKind, type CarLook, type Cursor } from "../sim";
import { BLOCK_MESSAGES, bridgeLevels, CELL, MAX_HEIGHT, hillsOf, type Landscape, cutUndermines, checkPlacement, checkSupport, looseHeight, riserStackAt, type BlockReason } from "../landscape";
import { connectorRef, findLowCrossing, findOverlap, findSnap, flipSwapsEnds, findSnapAtPoint, normalizeAngle, pieceOfRef, type WorldConnector, fitAutoStraight, canStandOnArches, getPieceDef, isBridge, RISER_HEIGHT, SNAP_CAPTURE_RADIUS, type PieceTypeId, type PlacedPiece, type Pose, type SnapResult } from "../track";
import type { Hud, TrayItem } from "../ui/hud";
import { trayKey } from "../ui/tray-catalogue";
import { checkProp, pieceHitsProp, propsInRect, PROP_MESSAGES, TrackIndex, type PropBlock } from "../props/placement";
import { buildingCells, findBuilding, releaseBuilding } from "../props/towns";
import { LAND_MESSAGES, LandEditor, moveScenery, plotSlotOf, removeScenery, restore, sceneryAt, sceneryCells, snapshot, type LandBlock, type Scenery } from "../landscape/edit";
import { placeOn } from "../props/kinds";
import type { PropPose } from "../props/store";
import { FootprintOutline } from "../render/props/outline";
import { modelKey } from "../render/props/library";
import { isDoubleTap, type TapRecord } from "./camera-director";
import { dropOutcome } from "./drop";
import type { Game } from "./game";
import { DEPOT_NAMES, INDUSTRY_ROLE } from "./world";
import { RoadHand, type RoadDrag } from "./road-hand";
import { DrawHand } from "./draw-hand";
import { cargoDropTarget } from "./cargo-drop";
import { capOf, CARGO, pilesOf, RECIPES, type CargoKind, type CargoSlot } from "../economy";

/** On touch, held things float this far (px) above the finger so it doesn't hide them. */
const TOUCH_LIFT_PX = 60;
/** Loose pieces snap to this grid (mm): a quarter of a landscape square, the step between straight lengths. */
const PLACE_GRID = CELL / 4;
/** A train dropped this far (mm) beyond half its own length from another's end couples on to it. */
const JOIN_REACH = 80;

/** Along-track distance from the first car's leading axle to car `index`'s leading axle (see `Sim.addTrain`). */
function trainSpan(cars: readonly { kind: CarKind }[], index: number): number {
  let d = 0;
  for (let i = 0; i < index; i++) {
    const spec = CAR_SPECS[cars[i].kind];
    const next = CAR_SPECS[cars[i + 1].kind];
    d += spec.length - spec.bogieInset + COUPLER_GAP + next.bogieInset;
  }
  return d;
}
/**
 * Placed track can be picked up when it looks big enough on screen to take hold of: a medium straight (144 mm) at
 * least this many pixels long. Zoomed out further, a press on track pans the view like the floor.
 */
const GRAB_MIN_PX = 54;
const GRAB_PIECE_MM = 144;
const DRAG_THRESHOLD = 6;
/** How far (mm) a picked group's free end reaches for a free end of other track to click onto, and how far off facing. */
const GROUP_SNAP_REACH = 30;
const GROUP_SNAP_ANGLE = (8 * Math.PI) / 180;
/** A ready piece put down with a tap seats on a free track end this far (mm) from the finger (the end itself is track). */
const TAP_REACH = 80;
/** How high a held piece floats above where it would land (mm). */
const HOLD_LIFT = 12;
/** An OrbitControls touch mapping that does nothing (it falls through to "no gesture"). */
const NO_TOUCH = -1 as unknown as TOUCH;
const NO_MOUSE = -1 as unknown as MOUSE;
const MAX_TILT = (2 * Math.PI) / 180;
const TRAIN_DROP_RANGE = 70;

/** Why a piece can't go somewhere: the track's own reasons, or a mode's rule ("site", with its own message). */
type PlaceBlock = BlockReason | "site";

type Press =
  | { kind: "car"; carId: number }
  | { kind: "lever"; pieceId: number }
  | { kind: "piece"; pieceId: number }
  /** A depot's yard, building or crane (economy depot id). */
  | { kind: "depot"; depotId: number }
  /** A log or plank bundle on a pile or wagon. */
  | { kind: "cargo"; slot: CargoSlot; cargo: CargoKind }
  /** A placed prop (catalogue model). */
  | { kind: "prop"; propId: number }
  /** A road piece the player laid (on square `cell`). */
  | { kind: "road"; cell: number };

/** A car held in the hand: what it is, which way it faces, its lever, and (when picked up) its id and load. */
type HeldCar = { kind: CarKind; facing: 1 | -1; lever: -1 | 0 | 1; id?: number; look?: CarLook; cargo?: { kind: CargoKind; count: number } };

type Mode =
  | { kind: "idle" }
  /** `add`: Shift was held (a tap picks the piece, along with any already picked). */
  | { kind: "press"; press: Press; pointerId: number; x: number; y: number; ground: Vector3; add: boolean }
  | {
      /** The picked pieces dragged together, rigidly (with the risers under them). */
      kind: "drag-group";
      pointerId: number;
      /** Where it was taken hold of, at the height of the piece pressed. */
      grab: Vector3;
      ids: number[];
      members: Set<number>;
      /** Where they were, and the joints to other track parted for the drag (seated again if it's put back). */
      before: Map<number, Pose>;
      parted: number[];
      /** The group's free ends, where they were. */
      ends: WorldConnector[];
      /** How far it has moved (snapped). */
      dx: number;
      dz: number;
      snapped: boolean;
      blocked: PlaceBlock | null;
      /** The last move drawn (skip a pointer move that lands on the same spot). */
      key: string;
    }
  | {
      kind: "drag-piece";
      pointerId: number;
      type: PieceTypeId;
      /** As drawn and placed: may be mirrored from `heldFlipped` while snapped, to fit the connector it meets. */
      flipped: boolean;
      /** Mirrored or not, as the player chose. */
      heldFlipped: boolean;
      heading: number;
      /** Existing piece being moved, or -1 for a new piece from the tray. */
      pieceId: number;
      /** The tray item a new piece came from (it stays ready for the next, once placed). */
      tray?: TrayItem;
      /** Put down with a tap (not held): it seats on a free end this far (mm) from the finger. */
      tapReach?: number;
      /** The auto straight: held as a long straight, it takes the length that meets a free end along its line. */
      auto?: boolean;
      from: { pose: Pose; y: number } | null;
      offset: { x: number; z: number };
      ghost: Mesh;
      snap: SnapResult;
      pose: Pose;
      /** Base height for a loose (unsnapped) drop: high enough to rest on what's under its ends. */
      looseY: number;
      blocked: PlaceBlock | null;
      /** Risers to put under the piece's ends that are in the air (added with it). */
      risers: RiserAt[];
      overTray: boolean;
      /** Where the held piece is heading (snapped or loose, plus the lift)… */
      goal: PiecePose;
      /** …and where it's drawn: it trails the goal slightly, for weight. */
      shown: PiecePose & { scale: number; tiltX: number; tiltZ: number };
      /** True until the piece has been drawn once (new pieces appear in place rather than flying in). */
      fresh: boolean;
    }
  | {
      kind: "drag-cargo";
      pointerId: number;
      from: CargoSlot;
      cargo: CargoKind;
      ghost: Group;
      overTray: boolean;
    }
  | {
      kind: "drag-prop";
      pointerId: number;
      asset: string;
      /** Prop being moved, or −1 for a new one from the tray. */
      propId: number;
      /** Where a moved prop stood (to put it back). */
      from: PropPose | null;
      heading: number;
      /** From the grab point to the prop's origin, so it doesn't jump under the finger. */
      offset: { x: number; z: number };
      ghost: Group;
      pose: PropPose;
      blocked: PropBlock | null;
      overTray: boolean;
      /** The track, sampled once for the drag (it doesn't change meanwhile). */
      track: TrackIndex;
    }
  | { kind: "drag-road"; pointerId: number; drag: RoadDrag; overTray: boolean }
  /** Drawing a line of track (the Draw chip on): see `DrawHand`. */
  | { kind: "draw-track"; pointerId: number }
  | {
      kind: "drag-scenery";
      pointerId: number;
      scenery: Scenery;
      /** The square it was taken hold of by. */
      grab: { col: number; row: number };
      /** How far it would move, in squares. */
      dc: number;
      dr: number;
      blocked: LandBlock | null;
      editor: LandEditor;
    }
  | {
      kind: "drag-train";
      pointerId: number;
      cars: HeldCar[];
      /** Where it came from, to put it back if the drop misses the track. */
      origin: Cursor | null;
      ghost: Group;
      target: Cursor | null;
      overTray: boolean;
    };

/** Signed shortest turn from angle a to angle b. */
function angleDelta(a: number, b: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

/** Pointer, touch and keyboard input: the object under the pointer decides what a gesture does. */
export class Interaction {
  /** Called after a piece is put down; `snapped` when its peg seated. */
  onPlaced: ((snapped: boolean) => void) | null = null;
  /** Called when a piece is picked up off the mat. */
  onPickup: (() => void) | null = null;
  /** Called when a drop, rotate or flip is refused by the landscape. */
  onRefused: (() => void) | null = null;
  /** Called when a placed piece is rotated or flipped. */
  onTurned: (() => void) | null = null;
  /** An engine was set going from a standstill. */
  onDepart: (() => void) | null = null;
  /** A switch was thrown (it's saved; nothing else changed). */
  onSwitched: (() => void) | null = null;
  /**
   * A tap on empty ground (where it landed, and where on screen): true if it was taken (then it doesn't count toward
   * a double tap).
   */
  onFloorTap: ((ground: Vector3, x: number, y: number) => boolean) | null = null;
  private mode: Mode = { kind: "idle" };
  private selectedPiece = -1;
  /** Picking several pieces (see `selectMore`): which are picked. */
  private picking = false;
  private readonly picked = new Set<number>();
  private selectedProp = -1;
  /** Round the selected prop, or under the held one (green where it can go, red where it can't). */
  private readonly propOutline = new FootprintOutline();
  /** Round the square under the pointer while land editing (`landCursor`). */
  private readonly squareOutline = new FootprintOutline();
  /** Land editing: show the square under the mouse (its colour), or null for none. */
  landCursor: string | null = null;
  /** Land editing's Move tool: the map's scenery (trees, fields, the shed) can be selected and moved. */
  landMove = false;
  /** Props can be selected and moved (Sandbox); in Game mode the town's houses stay put. */
  propsEditable = true;
  private selectedScenery: Scenery | null = null;
  /** Round the selected scenery, or where it would go. */
  private readonly sceneryOutline = new FootprintOutline();
  private selectedCar = -1;
  /** Laying road pieces, and the selected one. */
  private readonly roads: RoadHand;
  /** Drawing lines of track. */
  readonly draw: DrawHand;
  /** The Draw chip is on: a drag on the ground, or from a free end of track, draws track. */
  private drawing = false;
  /** Called when drawing is switched on or off (Esc, another tab). */
  onDrawing: ((on: boolean) => void) | null = null;
  /** A new ghost joined the line being drawn. */
  onDrawGrow: (() => void) | null = null;
  /** A drawn line's piece went down (`i` from the line's start). */
  onDrawLaid: ((i: number) => void) | null = null;
  private readonly raycaster = new Raycaster();
  private readonly ndc = new Vector2();
  private readonly floor = new Plane(new Vector3(0, 1, 0), 0);
  /** A level plane at some height, for seeing where the pointer points up off the ground. */
  private readonly level = new Plane(new Vector3(0, 1, 0), 0);

  constructor(
    private readonly game: Game,
    private readonly hud: Hud,
    private readonly editor: () => Editor,
    private readonly changed: () => void,
  ) {
    const canvas = game.canvas;
    const c = game.controls;
    game.scene.add(this.propOutline.line, this.squareOutline.line, this.sceneryOutline.line);
    this.roads = new RoadHand(game, hud, editor, () => this.onRefused?.(), () => this.onPlaced?.(false));
    this.draw = new DrawHand(game, editor, {
      placement: (type, flipped, pose, y) => this.placement(type, flipped, pose, y, -1),
      message: (reason) => (reason === "site" ? this.siteWhy : (BLOCK_MESSAGES[reason as BlockReason] ?? reason)),
      planeAt: (x, y, h) => this.planeAt(x, y, h),
      toScreen: (v) => {
        const p = v.clone().project(game.camera);
        if (p.z > 1) return null;
        const r = game.canvas.getBoundingClientRect();
        return { x: r.left + ((p.x + 1) / 2) * r.width, y: r.top + ((1 - p.y) / 2) * r.height };
      },
      toast: (text) => hud.toast(text),
      onGrow: () => this.onDrawGrow?.(),
      onPlaced: (i) => this.onDrawLaid?.(i),
    });
    // A left drag pans through TouchCamera, like one finger (the ground stays under the pointer); OrbitControls keeps
    // the right button (turn and tilt) and the middle (zoom).
    c.mouseButtons = { LEFT: NO_MOUSE, MIDDLE: MOUSE.DOLLY, RIGHT: MOUSE.ROTATE };
    // Touch moves the camera through TouchCamera (Maps-style gestures).
    c.touches = { ONE: NO_TOUCH, TWO: NO_TOUCH };
    window.addEventListener("pointerdown", (e) => this.notePointer(e), { capture: true });
    const lift = (e: PointerEvent) => this.touches.delete(e.pointerId);
    window.addEventListener("pointerup", lift, { capture: true });
    window.addEventListener("pointercancel", lift, { capture: true });
    canvas.addEventListener("pointerdown", (e) => this.onCanvasDown(e), { capture: true });
    window.addEventListener("pointermove", (e) => this.onMove(e));
    window.addEventListener("pointerup", (e) => this.onUp(e));
    window.addEventListener("pointercancel", (e) => {
      if (this.mode.kind !== "idle" && this.mode.pointerId === e.pointerId) this.cancel();
    });
    window.addEventListener("keydown", (e) => this.onKey(e));
    // Cmd (Mac) or Ctrl tapped on its own flips the piece in hand: on release, unless another key went with it
    // (Ctrl+Z is undo, not a flip).
    window.addEventListener("keyup", (e) => {
      if ((e.key === "Meta" || e.key === "Control") && this.modTapped) this.flipSelected();
      this.modTapped = false;
    });
    window.addEventListener("blur", () => (this.modTapped = false));
    window.addEventListener("pointerdown", () => (this.modTapped = false), { capture: true });
    canvas.addEventListener("contextmenu", (e) => e.preventDefault());
    // Wheel zoom is ours (eased, toward the pointer): stop it before OrbitControls sees it. Pinch stays with them.
    window.addEventListener(
      "wheel",
      (e) => {
        if (e.target !== canvas) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        const lines = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
        game.director.zoomAt(this.groundAt(e.clientX, e.clientY), Math.max(-240, Math.min(240, e.deltaY * lines)));
      },
      { capture: true, passive: false },
    );
  }

  /** Per frame: keep a dragged piece under the pointer while the view edge-pans, and animate the held piece. */
  tick(dt: number): void {
    this.time += dt;
    this.game.trackView.pulse(this.time);
    const m = this.mode;
    // Held things cast shadows.
    if (m.kind === "drag-piece" || m.kind === "drag-train" || m.kind === "drag-cargo" || m.kind === "drag-prop") this.game.moveShadows();
    if ((m.kind === "drag-piece" || m.kind === "drag-train" || m.kind === "drag-prop" || m.kind === "drag-group") && this.game.director.edgePanning) this.updateDrag(this.lastX, this.lastY);
    if (m.kind === "draw-track" && this.game.director.edgePanning) this.updateDraw(this.lastX, this.lastY);
    if (m.kind === "drag-piece" && dt > 0) {
      const s = m.shown;
      const px = s.x;
      const pz = s.z;
      const lambda = m.snap.kind === "snapped" ? 40 : 26;
      s.x = damp(s.x, m.goal.x, lambda, dt);
      s.z = damp(s.z, m.goal.z, lambda, dt);
      s.y = damp(s.y, m.goal.y, 18, dt);
      s.heading = damp(s.heading, s.heading + angleDelta(s.heading, m.goal.heading), 30, dt);
      s.scale = damp(s.scale, 1, 16, dt);
      // Lean a degree or two into the direction of travel, like a toy held loosely in the fingers.
      const vx = (s.x - px) / dt;
      const vz = (s.z - pz) / dt;
      const clampTilt = (v: number) => Math.max(-MAX_TILT, Math.min(MAX_TILT, v * 0.00004));
      s.tiltX = damp(s.tiltX, clampTilt(vz), 12, dt);
      s.tiltZ = damp(s.tiltZ, clampTilt(-vx), 12, dt);
      const mat = m.ghost.matrix;
      mat.makeRotationY(-s.heading);
      mat.premultiply(this.tiltMatrix.makeRotationFromEuler(this.tiltEuler.set(s.tiltX, 0, s.tiltZ)));
      mat.scale(this.scaleVec.setScalar(s.scale));
      mat.setPosition(s.x, s.y, s.z);
    }
  }

  private time = 0;
  private readonly tiltMatrix = new Matrix4();
  private readonly tiltEuler = new Euler();
  private readonly scaleVec = new Vector3();

  // ---- tray -------------------------------------------------------------------------------------------------

  startTrayDrag(item: TrayItem, e: PointerEvent): void {
    this.hidePreview();
    this.cancel();
    // Something else taken from the tray: the ready piece is put away (a piece dragged out is ready once placed).
    if ((this.armed && trayKey(this.armed) !== trayKey(item)) || this.roadReady) this.arm(null);
    this.clearSelection();
    // The last piece's card would cover the bottom of the view, where this one may be going.
    this.hud.hideCards();
    if (item.kind === "piece") this.mode = this.pieceFromTray(item, e.pointerId);
    else if (item.kind === "road") {
      // Comes out turned as set in the tray.
      this.mode = { kind: "drag-road", pointerId: e.pointerId, drag: this.roads.begin(item.piece, this.trayHeld(), item.auto), overTray: true };
    } else if (item.kind === "prop") {
      this.mode = this.propDrag(item.asset, -1, e.pointerId, this.nextPropHeading(), null, { x: 0, z: 0 });
    } else if (item.kind === "train") {
      // Ids now, so the train in the hand wears the colours it will have on the track.
      const ids = this.game.sim.newCarIds(item.cars.length);
      const cars = item.cars.map((kind, i) => ({ kind, facing: 1 as const, lever: 0 as const, id: ids[i], look: item.looks?.[i] ?? ("classic" as const) }));
      this.mode = { kind: "drag-train", pointerId: e.pointerId, cars, origin: null, ghost: this.trainGhost(cars), target: null, overTray: true };
    }
  }

  /** A new piece taken from the tray, held (not yet drawn: the first pointer move places it). */
  private pieceFromTray(item: Extract<TrayItem, { kind: "piece" }>, pointerId: number): Extract<Mode, { kind: "drag-piece" }> {
    {
      // Comes out turned and flipped as set in the tray.
      const flipped = this.trayFlipped && getPieceDef(item.type, false).flippable;
      const ghost = this.heldMesh(item.type, flipped);
      ghost.visible = false;
      return {
        kind: "drag-piece",
        pointerId,
        type: item.type,
        flipped,
        heldFlipped: flipped,
        heading: this.cameraHeading() + (this.trayTurns * Math.PI) / 4,
        pieceId: -1,
        tray: item,
        auto: item.auto,
        from: null,
        offset: { x: 0, z: 0 },
        ghost,
        snap: { kind: "none" },
        pose: { x: 0, z: 0, heading: 0 },
        looseY: 0,
        blocked: null,
        risers: [],
        overTray: true,
        goal: { x: 0, y: 0, z: 0, heading: 0 },
        shown: { x: 0, y: 0, z: 0, heading: 0, scale: 0.6, tiltX: 0, tiltZ: 0 },
        fresh: true,
      };
    }
  }

  /**
   * The tray piece ready to add with a tap: the last one put down from the tray, waiting (a ghost) at the free end of
   * the piece just placed. A tap on the ghost puts it down there; a tap anywhere else puts it away (panning and
   * zooming keep it). Null when none is.
   */
  private armed: TrayItem | null = null;
  /** Called when the ready tray piece changes. */
  onArmed: ((item: TrayItem | null) => void) | null = null;

  /** Switch drawing track on or off (the tray's Draw chip). */
  setDrawing(on: boolean): void {
    if (on === this.drawing) return;
    this.drawing = on;
    if (on) {
      this.arm(null);
      this.clearSelection();
      this.hud.hideCards();
      if (!this.drawHinted) {
        this.drawHinted = true;
        this.hud.toast("Draw from the end of a track, or anywhere on the ground · two fingers move the view", false, 3600);
      }
    } else if (this.mode.kind === "draw-track") this.cancel();
    this.onDrawing?.(on);
  }

  get isDrawing(): boolean {
    return this.drawing;
  }

  private drawHinted = false;

  arm(item: TrayItem | null): void {
    // A road is laid where the map is clicked (see `readyRoad`); anything else puts a ready road away.
    if (item?.kind === "road") {
      this.readyRoad(item);
      return;
    }
    this.readyRoad(null);
    if (item && item.kind !== "piece") item = null;
    if (item === this.armed || (item && this.armed && trayKey(item) === trayKey(this.armed))) return;
    const first = item !== null && this.armed === null && !this.armHinted;
    this.armed = item;
    this.hidePreview();
    this.onArmed?.(item);
    if (first) {
      this.armHinted = true;
      this.hud.toast("Tap the piece waiting at the end to add it · tap anywhere else to stop", false, 3200);
    }
  }

  private armHinted = false;

  /**
   * A road ready to lay (a road tapped in the tray): its outline follows the mouse over the map, and each click (or tap)
   * on the map lays one there, without its card, ready for the next. Tapping it in the tray again, Esc, or taking
   * something else from the tray puts it away. A drag on the map still moves the camera.
   */
  private roadReady: { item: Extract<TrayItem, { kind: "road" }>; drag: RoadDrag } | null = null;
  private roadHinted = false;

  private readyRoad(item: Extract<TrayItem, { kind: "road" }> | null): void {
    if (this.roadReady) {
      this.roads.cancel(this.roadReady.drag);
      this.roadReady = null;
      if (!item) this.onArmed?.(null);
    }
    if (!item) return;
    if (this.armed) {
      this.armed = null;
      this.hidePreview();
    }
    this.clearSelection();
    this.hud.hideCards();
    this.roadReady = { item, drag: this.roads.begin(item.piece, this.trayHeld(), item.auto) };
    this.onArmed?.(item);
    if (!this.roadHinted) {
      this.roadHinted = true;
      this.hud.toast("Click the map to lay it · tap it in the tray again to stop", false, 3200);
    }
  }

  /** Tray tap: a road is made ready to lay (or put away, if it already is); the ready piece is put away. */
  tapTrayPiece(item: TrayItem): void {
    if (item.kind === "road") {
      this.arm(this.roadReady && trayKey(this.roadReady.item) === trayKey(item) ? null : item);
      return;
    }
    if (this.armed && trayKey(this.armed) === trayKey(item)) this.arm(null);
  }

  /** Quarter turns a road comes out of the tray at: as set in the tray, from facing away from the camera. */
  private trayHeld(): number {
    return Math.round(this.cameraHeading() / (Math.PI / 2)) + Math.floor(this.trayTurns / 2);
  }

  /**
   * Put the ready piece down at screen point x, y (where its ghost waits), as if dragged there from the tray and let
   * go: onto the free end there. True if one was tried (placed, or refused with the reason shown).
   */
  private placeArmedAt(x: number, y: number): boolean {
    const item = this.armed;
    if (!item) return false;
    this.startTrayDrag(item, { pointerId: -1 } as PointerEvent);
    const m = this.mode;
    if (m.kind !== "drag-piece") return false;
    m.tapReach = TAP_REACH;
    // A tap puts it where the finger is, not above it (as a held piece floats).
    const touch = this.lastPointerWasTouch;
    this.lastPointerWasTouch = false;
    this.updateDrag(x, y);
    this.lastPointerWasTouch = touch;
    m.overTray = false;
    if (!m.ghost.visible) {
      this.cancel();
      return false;
    }
    this.dropPiece(m);
    return true;
  }

  /** The ready piece shown where it would go (as if held there): waiting at the free end of the piece just put down. */
  private preview: Extract<Mode, { kind: "drag-piece" }> | null = null;

  private showPreview(x: number, y: number, touch = false, anywhere = false): void {
    const item = this.armed;
    // Over track (or a train, a model) a click selects what's there, so nothing is shown: the piece appears only where
    // a click would put it down.
    if (!item || item.kind !== "piece" || this.mode.kind !== "idle" || this.picking || this.somethingSelected() || this.pick(x, y)) {
      this.hidePreview();
      return;
    }
    const m = (this.preview ??= { ...this.pieceFromTray(item, -2), tapReach: TAP_REACH });
    // Worked out exactly as a held piece is, then drawn where it would land (no trailing: it's not in a hand).
    const wasTouch = this.lastPointerWasTouch;
    this.lastPointerWasTouch = touch;
    this.mode = m;
    this.updateDrag(x, y);
    this.mode = { kind: "idle" };
    this.lastPointerWasTouch = wasTouch;
    this.game.director.setEdgePointer(null);
    m.overTray = !anywhere && this.hud.isOverTray(x, y);
    if (m.overTray) m.ghost.visible = false;
    const mat = m.ghost.matrix;
    mat.makeRotationY(-m.goal.heading);
    mat.setPosition(m.goal.x, m.goal.y, m.goal.z);
    this.game.moveShadows();
    this.game.invalidate();
  }

  private hidePreview(): void {
    const m = this.preview;
    if (!m) return;
    this.preview = null;
    this.previewAt = null;
    this.game.scene.remove(m.ghost);
    this.treeKey = "";
    this.game.previewTrees(null);
    this.game.invalidate();
  }

  /** Where (world) the ghost was shown from: a tap on the ghost puts the piece down there. */
  private previewAt: Vector3 | null = null;

  /** True if screen point x, y is on the waiting ghost (or close by: it's a small thing to hit with a finger). */
  private onPreview(x: number, y: number): boolean {
    const m = this.preview;
    if (!m || !m.ghost.visible || !this.previewAt) return false;
    const r = this.game.canvas.getBoundingClientRect();
    const at = (v: Vector3) => ({ x: r.left + ((v.x + 1) / 2) * r.width, y: r.top + ((1 - v.y) / 2) * r.height });
    // Near its middle, or near where it was shown from (the free end's side of it).
    const mid = at(new Vector3(m.goal.x, m.goal.y, m.goal.z).project(this.game.camera));
    const from = at(this.previewAt.clone().project(this.game.camera));
    const reach = 44;
    return Math.hypot(x - mid.x, y - mid.y) < reach || Math.hypot(x - from.x, y - from.y) < reach;
  }

  /** After a ready piece goes down: show the next one waiting at the piece's free end (or, with none in view, put it away). */
  private previewNextAt(pieceId: number): void {
    const g = this.game;
    const p = g.layout.getPiece(pieceId);
    if (!p) return;
    const w: WorldConnector = { x: 0, z: 0, heading: 0, y: 0, kind: "socket" };
    const count = getPieceDef(p.type, p.flipped).connectors.length;
    const r = g.canvas.getBoundingClientRect();
    // A free end in view (clear of the tray) if there is one; else one out of view, waiting there till you pan to it.
    for (const inView of [true, false]) {
      for (let i = 0; i < count; i++) {
        const ref = connectorRef(pieceId, i);
        if (g.layout.joinedConnector(ref) !== -1) continue;
        g.layout.worldConnector(ref, w);
        // A little beyond the end, clear of the track (a tap there puts it down; one on the track selects that).
        const at = new Vector3(w.x + Math.cos(w.heading) * 60, w.y, w.z + Math.sin(w.heading) * 60);
        const v = at.clone().project(g.camera);
        if (v.z > 1) continue;
        const sx = r.left + ((v.x + 1) / 2) * r.width;
        const sy = r.top + ((1 - v.y) / 2) * r.height;
        if (inView && (Math.abs(v.x) > 0.95 || Math.abs(v.y) > 0.95 || this.hud.isOverTray(sx, sy))) continue;
        this.showPreview(sx, sy, false, !inView);
        if (this.preview?.ghost.visible) {
          this.previewAt = at;
          return;
        }
        this.hidePreview();
      }
    }
    this.arm(null);
  }

  /** How pieces come out of the tray: eighth turns from facing away from the camera, and mirrored or not. */
  trayTurns = 0;
  trayFlipped = false;

  /**
   * Which way the next model from the tray faces (its front, world heading): the way the last one placed or turned
   * faced, so a row of houses comes out alike; at first, toward the camera.
   */
  propHeading: number | null = null;

  nextPropHeading(): number {
    return this.propHeading ?? this.cameraHeading() + Math.PI;
  }

  /**
   * The tray's Turn arrow, as seen on screen (degrees clockwise from straight up = away from the camera): which way
   * the next model faces (`props`), or the next piece runs.
   */
  trayArrow(props: boolean): number {
    const d = new Vector3();
    this.game.camera.getWorldDirection(d);
    const heading = props ? this.nextPropHeading() : this.cameraHeading() + (this.trayTurns * Math.PI) / 4;
    const a = ((heading - Math.atan2(d.z, d.x)) * 180) / Math.PI;
    return ((a % 360) + 540) % 360 - 180;
  }

  /** Tray "Turn": turns the piece in hand (if any) and every piece taken out after it (`props`: every model). */
  turnTrayPiece(props = false): void {
    if (props || this.mode.kind === "drag-prop") {
      if (this.mode.kind === "drag-prop") this.rotateSelected();
      else this.propHeading = this.nextPropHeading() + Math.PI / 4;
      return;
    }
    if (this.mode.kind === "drag-piece") this.rotateSelected();
    if (this.mode.kind === "drag-road") this.roads.turnHeld(this.mode.drag);
    else if (this.roadReady) this.roads.turnHeld(this.roadReady.drag);
    this.trayTurns = (this.trayTurns + 1) % 8;
    this.onTurned?.();
  }

  /** Tray "Flip": mirrors the piece in hand (if any) and every piece taken out after it. */
  flipTrayPiece(): void {
    if (this.mode.kind === "drag-piece") this.flipSelected();
    this.trayFlipped = !this.trayFlipped;
    this.onTurned?.();
  }

  // ---- pointer ----------------------------------------------------------------------------------------------

  private onCanvasDown(e: PointerEvent): void {
    // Two fingers always move the camera: a second touch abandons any press or drag in progress.
    if (e.pointerType === "touch" && this.touches.size > 1) {
      this.cancel();
      // A pinch is never a tap, nor half of a double tap.
      this.floorDown = null;
      this.lastTap = null;
      return;
    }
    if (this.mode.kind !== "idle") return;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    // Finish any settle/turn first: animating pieces are hidden from picking until their stand-in is done.
    this.game.flourishes.clear();
    // Selected scenery (land editing's Move tool) is taken hold of on any of its squares.
    if (this.landMove && this.selectedScenery) {
      const i = this.squareAt(e.clientX, e.clientY);
      const s = this.selectedScenery;
      if (i !== -1 && sceneryCells(this.game.landscape, s).includes(i)) {
        const g = this.game.landscape.grid;
        this.game.controls.enabled = false;
        this.mode = { kind: "drag-scenery", pointerId: e.pointerId, scenery: s, grab: { col: g.colOf(i), row: g.rowOf(i) }, dc: 0, dr: 0, blocked: null, editor: this.landEditor() };
        return;
      }
    }
    // A ready road: a tap lays it there (handled as a floor tap, so a drag still pans).
    if (this.roadReady && this.touches.size <= 1) {
      this.floorDown = { id: e.pointerId, x: e.clientX, y: e.clientY, t: e.timeStamp, road: true };
      return;
    }
    // The ready piece's ghost: a tap on it puts it down (handled as a floor tap, so a drag from it still pans).
    if (this.armed && this.touches.size <= 1 && this.onPreview(e.clientX, e.clientY)) {
      this.floorDown = { id: e.pointerId, x: e.clientX, y: e.clientY, t: e.timeStamp, ghost: true };
      return;
    }
    // Drawing: from a free end, or on empty ground, a drag draws track (two fingers still move the view).
    if (this.drawing && this.touches.size <= 1 && (this.draw.nearFreeEnd(e.clientX, e.clientY) || !this.pick(e.clientX, e.clientY))) {
      if (this.draw.begin(e.clientX, e.clientY)) {
        this.game.controls.enabled = false;
        this.mode = { kind: "draw-track", pointerId: e.pointerId };
        return;
      }
    }
    let hit = this.pick(e.clientX, e.clientY);
    // Pressing on anything else puts the ready piece away.
    if (hit && this.armed) this.arm(null);
    // Track can only be picked up from close by, so a pan over a zoomed-out map never drags a piece away.
    // (While picking several, any track in view can be tapped.)
    if (hit?.kind === "piece" && !this.picking && !this.withinReach(hit.pieceId)) hit = null;
    if (hit?.kind === "prop" && (!this.propsEditable || !this.propWithinReach(hit.propId))) hit = null;
    if (hit?.kind === "road" && !this.roadWithinReach(hit.cell)) hit = null;
    const ground = this.groundAt(e.clientX, e.clientY) ?? new Vector3();
    if (!hit) {
      // Empty floor: the camera pans; a tap here deselects (but not the pieces being picked: Done lets them go), and a
      // double tap focuses on that spot.
      if (!this.picking) {
        this.hud.hideCards();
        this.clearSelection();
      }
      this.floorDown = this.touches.size <= 1 ? { id: e.pointerId, x: e.clientX, y: e.clientY, t: e.timeStamp } : null;
      return;
    }
    this.game.controls.enabled = false;
    this.mode = { kind: "press", press: hit, pointerId: e.pointerId, x: e.clientX, y: e.clientY, ground, add: e.shiftKey };
  }

  private onMove(e: PointerEvent): void {
    const m = this.mode;
    if (m.kind === "idle" && this.landCursor && e.pointerType === "mouse" && e.target === this.game.canvas) this.showSquare(this.squareAt(e.clientX, e.clientY));
    // A ready road's outline follows the mouse (not while the camera's being dragged).
    if (m.kind === "idle" && this.roadReady && e.pointerType === "mouse" && !this.floorDown) {
      const off = e.target !== this.game.canvas || this.hud.isOverTray(e.clientX, e.clientY);
      this.roads.update(this.roadReady.drag, off ? -1 : this.squareAt(e.clientX, e.clientY), off);
    }
    if (m.kind === "idle" || m.pointerId !== e.pointerId) return;
    if (m.kind === "draw-track") {
      this.updateDraw(e.clientX, e.clientY);
      return;
    }
    if (m.kind === "press") {
      if (Math.hypot(e.clientX - m.x, e.clientY - m.y) < DRAG_THRESHOLD) return;
      if ((m.press.kind === "prop" && m.press.propId !== this.selectedProp) || (m.press.kind === "road" && m.press.cell !== this.roads.selected)) {
        // Select first: a drag that starts on a prop not selected pans the view, like the floor (so panning over a
        // busy town never moves a house by accident). The camera picks the gesture up from here.
        this.mode = { kind: "idle" };
        this.game.controls.enabled = true;
        return;
      }
      if (m.press.kind === "piece" && this.fixedLabel(m.press.pieceId)) {
        // Stations and depots are part of the map and stay put.
        this.mode = { kind: "idle" };
        this.game.controls.enabled = true;
        return;
      }
      if (m.press.kind === "piece" && this.picking) {
        // Picking: a drag on a picked piece moves them all; anywhere else it pans (so a pan never breaks the group).
        if (this.picked.has(m.press.pieceId)) this.beginGroupMove(m.press.pieceId, m.pointerId, m.x, m.y);
        else {
          this.mode = { kind: "idle" };
          this.game.controls.enabled = true;
          return;
        }
      } else if (m.press.kind === "piece") this.beginPieceMove(m.press.pieceId, m.pointerId, m.ground);
      else if (m.press.kind === "depot" && this.movableIndustry(m.press.depotId) !== -1) this.beginPieceMove(this.movableIndustry(m.press.depotId), m.pointerId, m.ground);
      else if (m.press.kind === "cargo") this.beginCargoDrag(m.press.slot, m.press.cargo, m.pointerId);
      else if (m.press.kind === "prop") this.beginPropMove(m.press.propId, m.pointerId, m.ground);
      else if (m.press.kind === "road") {
        const drag = this.roads.pickUp(m.press.cell);
        if (!drag) {
          this.mode = { kind: "idle" };
          this.game.controls.enabled = true;
          return;
        }
        this.mode = { kind: "drag-road", pointerId: m.pointerId, drag, overTray: false };
        this.onPickup?.();
      }
      else if (m.press.kind === "car") {
        this.beginTrainPickup(m.press.carId, m.pointerId);
        if (this.mode.kind === "idle") return;
      }
      else {
        this.mode = { kind: "idle" };
        this.game.controls.enabled = true;
        return;
      }
    }
    this.updateDrag(e.clientX, e.clientY);
  }

  private onUp(e: PointerEvent): void {
    const f = this.floorDown;
    if (f && f.id === e.pointerId) {
      this.floorDown = null;
      if (Math.hypot(e.clientX - f.x, e.clientY - f.y) < DRAG_THRESHOLD && e.timeStamp - f.t < 300 && this.touches.size <= 1) {
        const ground = this.groundAt(e.clientX, e.clientY);
        if (f.road && this.roadReady) {
          const r = this.roadReady;
          this.roads.update(r.drag, this.squareAt(e.clientX, e.clientY), false);
          this.roads.drop(r.drag, false);
          r.drag = this.roads.begin(r.item.piece, r.drag.held, r.item.auto);
          this.lastTap = null;
          return;
        }
        if (f.ghost) {
          // On the waiting piece: put it down where it waits.
          const at = this.previewAt?.clone().project(this.game.camera);
          const r = this.game.canvas.getBoundingClientRect();
          this.hidePreview();
          if (at) this.placeArmedAt(r.left + ((at.x + 1) / 2) * r.width, r.top + ((1 - at.y) / 2) * r.height);
          this.lastTap = null;
          return;
        }
        // Anywhere else: the ready piece is put away (that's all the tap does, if one was ready).
        if (this.armed) {
          this.arm(null);
          this.lastTap = null;
        } else if (ground && this.onFloorTap?.(ground, e.clientX, e.clientY)) this.lastTap = null;
        else if (this.noteTap(e) && ground) this.game.director.focus(ground, 260);
      } else this.lastTap = null;
    }
    const m = this.mode;
    if (m.kind === "idle" || m.pointerId !== e.pointerId) return;
    this.game.controls.enabled = true;
    if (m.kind === "press") {
      this.mode = { kind: "idle" };
      // (Cargo is tapped again and again, a unit a tap: never a double tap.)
      if (m.press.kind !== "lever" && m.press.kind !== "cargo" && this.noteTap(e)) this.focusOn(m.press);
      else this.tap(m.press, m.add);
      return;
    }
    if (m.kind === "draw-track") {
      this.game.director.setEdgePointer(null);
      this.mode = { kind: "idle" };
      this.draw.end();
    } else if (m.kind === "drag-piece") this.dropPiece(m);
    else if (m.kind === "drag-group") this.dropGroup(m);
    else if (m.kind === "drag-prop") this.dropProp(m);
    else if (m.kind === "drag-road") {
      this.game.director.setEdgePointer(null);
      this.mode = { kind: "idle" };
      this.roads.drop(m.drag);
    } else if (m.kind === "drag-scenery") this.dropScenery(m);
    else if (m.kind === "drag-cargo") this.dropCargo(m, e.clientX, e.clientY);
    else this.dropTrain(m);
  }

  private floorDown: { id: number; x: number; y: number; t: number; ghost?: boolean; road?: boolean } | null = null;

  private somethingSelected(): boolean {
    return this.selectedPiece !== -1 || this.selectedProp !== -1 || this.selectedCar !== -1 || this.selectedDepot !== -1 || this.selectedScenery !== null;
  }
  private lastTap: TapRecord | null = null;

  /** Record a tap; true when it completes a double tap (which then starts afresh). */
  private noteTap(e: PointerEvent): boolean {
    const now = { t: e.timeStamp, x: e.clientX, y: e.clientY };
    const double = isDoubleTap(this.lastTap, now);
    this.lastTap = double ? null : now;
    return double;
  }

  /** Double tap on a piece or car: glide the camera to frame it. */
  private focusOn(p: Press): void {
    const g = this.game;
    if (p.kind === "piece") {
      const c = pieceCentre(g.layout, p.pieceId);
      const piece = g.layout.getPiece(p.pieceId);
      g.director.focus(new Vector3(c.x, piece?.y ?? 0, c.z), 180);
    } else if (p.kind === "prop") {
      const prop = g.props.get(p.propId);
      if (prop) g.director.focus(new Vector3(prop.x, prop.y, prop.z), 160);
    } else if (p.kind === "car") {
      const obj = g.trainView.carObject(p.carId);
      if (obj) g.director.focus(obj.position.clone(), 160);
    }
  }

  private cancel(): void {
    this.game.director.setEdgePointer(null);
    const m = this.mode;
    this.game.controls.enabled = true;
    if (m.kind === "drag-piece") {
      this.dropHeld(m.ghost);
      if (m.pieceId !== -1 && m.from) this.game.layout.dropPiece(m.pieceId, m.from.pose, m.from.y);
      if (INDUSTRY_ROLE[m.type]) this.game.depotView.setWorld(this.game.economy, this.game.layout);
      this.treeKey = "";
      this.game.previewTrees(null);
      this.changed();
    } else if (m.kind === "drag-train") {
      this.game.scene.remove(m.ghost);
      disposeObject(m.ghost);
      if (m.origin) this.placeTrain(m.cars, m.origin);
    } else if (m.kind === "drag-cargo") {
      this.game.scene.remove(m.ghost);
      this.game.depotView.dragging = null;
    } else if (m.kind === "drag-prop") {
      this.game.scene.remove(m.ghost);
      this.propOutline.hide();
      this.game.propsChanged(-1);
    } else if (m.kind === "drag-scenery") {
      this.outlineScenery(m.scenery, 0, 0);
    } else if (m.kind === "drag-group") {
      this.putGroupBack(m);
    } else if (m.kind === "drag-road") this.roads.cancel(m.drag);
    else if (m.kind === "draw-track") this.draw.cancel();
    this.mode = { kind: "idle" };
  }

  /** Drawing: the finger moved (or the view edge-panned under it). */
  private updateDraw(x: number, y: number): void {
    this.lastX = x;
    this.lastY = y;
    const r = this.game.canvas.getBoundingClientRect();
    const trayTop = this.hud.tray.getBoundingClientRect().top - r.top;
    // A line started near the screen's edge doesn't pan the view until the finger has been clear of the edge once.
    this.game.director.setEdgePointer({ x: x - r.left, y: y - r.top, touch: this.lastPointerWasTouch, bottom: trayTop, waitForExit: true });
    this.draw.move(x, y);
  }

  // ---- taps -------------------------------------------------------------------------------------------------

  private tap(p: Press, add = false): void {
    const g = this.game;
    if (p.kind === "lever") {
      // Only the points move: redrawn and saved, nothing else rebuilt (no geometry changed).
      g.sim.toggleSwitch(p.pieceId);
      g.trackView.syncSwitches();
      g.invalidate();
      this.onSwitched?.();
      return;
    }
    if (p.kind === "piece") {
      const depot = g.economy.depotAtPiece(p.pieceId);
      if (depot) this.openDepot(depot.id);
      else if (this.fixedLabel(p.pieceId)) this.hud.toast(this.fixedLabel(p.pieceId)!);
      else if (this.picking || add) this.togglePick(p.pieceId);
      else this.selectPiece(p.pieceId);
      return;
    }
    if (p.kind === "depot") {
      this.openDepot(p.depotId);
      return;
    }
    if (p.kind === "prop") {
      this.selectProp(p.propId);
      return;
    }
    if (p.kind === "road") {
      this.clearSelection();
      this.roads.select(p.cell);
      return;
    }
    if (p.kind === "cargo") {
      // A tap on cargo moves it, if it can go somewhere by itself: from a pile onto a wagon standing beside it, or
      // from a wagon onto the pile of the depot it's at. Else it opens whatever it's on: its depot, or its wagon.
      const to = g.economy.tapTarget(p.slot);
      if (to && g.economy.moveCargo(p.slot, to)) {
        this.onPlaced?.(true);
        this.changed();
        return;
      }
      if (p.slot.kind === "pile") this.openDepot(p.slot.depotId);
      else this.tap({ kind: "car", carId: p.slot.carId });
      return;
    }
    const found = g.sim.findCar(p.carId);
    if (!found) return;
    if (found.train.derailed) {
      const back = g.rerail(found.train.id);
      this.hud.toast(back === -1 ? "No track nearby to put it back on" : "Back on the rails");
      this.changed();
      return;
    }
    this.clearSelection();
    this.selectedCar = p.carId;
    const car = found.train.cars[found.index];
    if (car.kind === "engine") this.hud.showEngineCard(car.lever, g.following === p.carId);
    else this.hud.showCarCard();
  }

  private selectPiece(id: number): void {
    this.clearSelection();
    this.selectedPiece = id;
    this.game.trackView.setHighlight(id);
    const p = this.game.layout.getPiece(id)!;
    this.hud.showPieceCard(getPieceDef(p.type, false).flippable, "Track piece", true, true, true);
  }

  clearSelection(): void {
    if (this.selectedPiece !== -1 || this.picking) {
      this.game.trackView.setHighlight(-1);
      this.game.invalidate();
    }
    this.picking = false;
    this.picked.clear();
    if (this.selectedProp !== -1) this.propOutline.hide();
    this.roads.clear();
    if (this.selectedScenery) {
      this.sceneryOutline.hide();
      this.game.invalidate();
    }
    this.selectedScenery = null;
    this.selectedProp = -1;
    this.selectedPiece = -1;
    this.selectedCar = -1;
    this.selectedDepot = -1;
  }

  // ---- depots and cargo -------------------------------------------------------------------------------------

  /** The engine whose card is open, or −1. */
  get openEngineCarId(): number {
    return this.hud.engineCardOpen ? this.selectedCar : -1;
  }

  /** Economy depot whose card is open, or −1. */
  private selectedDepot = -1;
  /** The depot whose card is open, or −1. */
  get openDepotId(): number {
    return this.hud.depotCardOpen ? this.selectedDepot : -1;
  }
  /** What the open depot card last showed. */
  private readonly shownDepot = { id: -1, piles: -1, auto: false, wait: false, delivered: -1 };

  private depotTitle(depotId: number): string {
    const d = this.game.economy.depot(depotId);
    if (!d) return "";
    if (d.role === "town") return `${this.game.landscape.towns.find((t) => t.id === d.townId)?.name ?? ""} goods`;
    return DEPOT_NAMES[d.role];
  }

  private openDepot(depotId: number): void {
    this.clearSelection();
    this.selectedDepot = depotId;
    this.shownDepot.id = -1;
    this.hud.showDepotCard(this.depotTitle(depotId));
    this.refreshDepotCard();
  }

  /** Keep the open depot card's pile counts current (call every frame). */
  refreshDepotCard(): void {
    if (this.selectedDepot === -1 || !this.hud.depotCardOpen) return;
    const d = this.game.economy.depot(this.selectedDepot);
    if (!d) return;
    // Only redraw the card when something on it changed (this runs every frame).
    const delivered0 = d.role === "town" ? this.game.economy.delivered.get(d.townId) ?? 0 : 0;
    const shown = this.shownDepot;
    // Every pile's count in one number (piles hold at most 12): no allocation on this per-frame check.
    let pileKey = 0;
    for (let k = 0; k < d.piles.length; k++) pileKey = pileKey * 16 + d.piles[k];
    if (shown.id === d.id && shown.piles === pileKey && shown.auto === d.auto && shown.wait === d.waitFull && shown.delivered === delivered0) return;
    shown.id = d.id;
    shown.piles = pileKey;
    shown.auto = d.auto;
    shown.wait = d.waitFull;
    shown.delivered = delivered0;
    const piles = pilesOf(d.role).map((kind) => ({ label: CARGO[kind].label, count: d.piles[CARGO[kind].index], cap: capOf(d.role) }));
    const delivered = d.role === "town" ? this.game.economy.delivered.get(d.townId) ?? 0 : 0;
    this.hud.updateDepotCard(piles, d.auto, RECIPES[d.role].gives.length > 0 ? d.waitFull : null, d.role === "town" ? `Delivered ${delivered}` : "");
  }

  toggleDepotAuto(): void {
    const d = this.game.economy.depot(this.selectedDepot);
    if (!d) return;
    this.game.economy.setAuto(d.id, !d.auto);
    this.hud.toast(d.auto ? "The crane works trains by itself" : "Trains run straight through; move cargo by hand");
    this.refreshDepotCard();
    this.changed();
  }

  toggleDepotWaitFull(): void {
    const d = this.game.economy.depot(this.selectedDepot);
    if (!d) return;
    this.game.economy.setWaitFull(d.id, !d.waitFull);
    this.refreshDepotCard();
    this.changed();
  }

  private beginCargoDrag(from: CargoSlot, cargo: CargoKind, pointerId: number): void {
    this.clearSelection();
    this.hud.hideCards();
    const ghost = this.game.depotView.makeHeld(cargo);
    this.game.scene.add(ghost);
    this.game.depotView.dragging = from;
    this.onPickup?.();
    this.mode = { kind: "drag-cargo", pointerId, from, cargo, ghost, overTray: false };
  }

  private dropCargo(m: Extract<Mode, { kind: "drag-cargo" }>, x: number, y: number): void {
    const g = this.game;
    g.director.setEdgePointer(null);
    g.scene.remove(m.ghost);
    g.depotView.dragging = null;
    this.mode = { kind: "idle" };
    const ground = m.overTray ? null : this.groundAt(x, y);
    const under = this.pick(x, y);
    const carId = under?.kind === "car" ? under.carId : under?.kind === "cargo" && under.slot.kind === "car" ? under.slot.carId : -1;
    const to = ground
      ? cargoDropTarget({
          kind: m.cargo,
          from: m.from,
          x: ground.x,
          z: ground.z,
          carId,
          piles: g.depotView.piles(),
          carAccepts: (id, kind) => g.economy.carAccepts(id, kind),
          pileAccepts: (id, kind) => {
            const d = g.economy.depot(id);
            return !!d && g.economy.pileAccepts(d, kind);
          },
        })
      : null;
    if (to && g.economy.moveCargo(m.from, to)) {
      this.onPlaced?.(true);
      this.changed();
    } else {
      this.onRefused?.();
      this.hud.toast(m.cargo === "log" ? "Logs go on a timber wagon or the sawmill's log pile" : "Planks go on a timber wagon or a station's goods pile");
    }
  }

  // ---- card actions -----------------------------------------------------------------------------------------

  setLever(v: -1 | 0 | 1): void {
    if (this.selectedCar === -1) return;
    const was = this.game.sim.findCar(this.selectedCar);
    if (was && was.train.cars[was.index].lever === 0 && v !== 0) this.onDepart?.();
    this.game.sim.setLever(this.selectedCar, v);
    this.hud.updateEngineCard(v, this.game.following === this.selectedCar);
    this.changed();
  }

  toggleFollow(): void {
    if (this.selectedCar === -1) return;
    this.game.follow(this.game.following === this.selectedCar ? -1 : this.selectedCar);
    const found = this.game.sim.findCar(this.selectedCar);
    if (found) this.hud.updateEngineCard(found.train.cars[found.index].lever, this.game.following === this.selectedCar);
  }

  turnSelectedCar(): void {
    if (this.selectedCar === -1) return;
    this.game.sim.flipCar(this.selectedCar);
    const found = this.game.sim.findCar(this.selectedCar);
    if (found) this.hud.updateEngineCard(found.train.cars[found.index].lever, this.game.following === this.selectedCar);
    this.changed();
  }

  removeSelectedTrain(): void {
    const found = this.selectedCar === -1 ? undefined : this.game.sim.findCar(this.selectedCar);
    if (!found) return;
    this.game.sim.removeTrain(found.train.id);
    this.hud.hideCards();
    this.clearSelection();
    this.changed();
  }

  rotateSelected(): void {
    if (this.mode.kind === "drag-road") {
      this.roads.turnHeld(this.mode.drag);
      return;
    }
    if (this.roadReady) {
      this.roads.turnHeld(this.roadReady.drag);
      return;
    }
    if (this.roads.selected !== -1) {
      this.roads.turnSelected();
      this.onTurned?.();
      return;
    }
    if (this.mode.kind === "drag-piece") {
      this.mode.heading += Math.PI / 4;
      return;
    }
    if (this.mode.kind === "drag-prop") {
      this.mode.heading += Math.PI / 4;
      this.propHeading = this.mode.heading;
      this.updateDrag(this.lastX, this.lastY);
      return;
    }
    if (this.selectedProp !== -1) {
      this.turnProp(this.selectedProp);
      return;
    }
    if (this.picking) {
      this.turnPicked();
      return;
    }
    const id = this.selectedPiece;
    const p = id === -1 ? undefined : this.game.layout.getPiece(id);
    if (!p) return;
    const c = pieceCentre(this.game.layout, id);
    const pose = poseForCentre(p.type, p.flipped, c.x, c.z, p.pose.heading + Math.PI / 4);
    if (!this.allowed(id, p.type, p.flipped, pose, p.y)) {
      this.onRefused?.();
      return;
    }
    const before = { x: p.pose.x, y: p.y, z: p.pose.z, heading: p.pose.heading };
    if (this.editor().rotate(id, Math.PI / 4)) this.animateChange(id, (mesh, after, done) => turn(mesh, before, after, done));
  }

  /**
   * Show an edit to a placed piece as a little animation: a stand-in mesh moves from the old look to the new while
   * the real piece (already changed in the layout) is hidden.
   */
  private animateChange(id: number, make: (mesh: Mesh, after: PiecePose, done: () => void) => Flourish): void {
    const g = this.game;
    const p = g.layout.getPiece(id);
    if (!p) return;
    const mesh = ghostMesh(p.type, p.flipped, [g.mats.track, g.mats.trackCut, g.mats.bridgePaint], g.bridgeLevelsOf(p));
    mesh.castShadow = true;
    g.scene.add(mesh);
    g.trackView.setHidden(id, true);
    g.flourishes.add(
      make(mesh, { x: p.pose.x, y: p.y, z: p.pose.z, heading: p.pose.heading }, () => {
        g.scene.remove(mesh);
        g.trackView.setHidden(id, false);
      }),
    );
    this.onTurned?.();
  }

  /** Why a piece can't go here (the landscape, or another piece in the way), or null when it can. */
  private blockedBy(type: PieceTypeId, flipped: boolean, pose: Pose, y: number, ignoreId: number): BlockReason | null {
    const c = checkPlacement(this.game.landscape, type, flipped, pose, y);
    if (c.kind === "blocked") return c.reason;
    // Bridges' and raised ramps' arches are solid down to the ground (but for their openings).
    const g = this.game;
    const arches = { mine: bridgeLevels(g.landscape, type, flipped, pose, y) * RISER_HEIGHT, of: (p: PlacedPiece) => g.bridgeLevelsOf(p) * RISER_HEIGHT };
    if (findOverlap(g.layout, type, flipped, pose, y, ignoreId, arches) !== -1) return "piece";
    if (findLowCrossing(g.layout, type, flipped, pose, y, ignoreId) !== -1) return "headroom";
    if (pieceHitsProp(g.props, g.propLibrary.footprint, type, flipped, pose)) return "prop";
    // A ramp cutting into a hill mustn't take the ground from under other track.
    return cutUndermines(g.landscape, g.layout, type, flipped, pose, y, ignoreId) === -1 ? null : "undercut";
  }

  /**
   * Can a piece go here, and what holds it up: null and the risers to add under ends in the air, or why not (the
   * landscape, another piece, nothing under an end, or no room for its risers).
   */
  private placement(type: PieceTypeId, flipped: boolean, pose: Pose, y: number, ignoreId: number): { reason: PlaceBlock | null; risers: RiserAt[] } {
    const reason = this.blockedBy(type, flipped, pose, y, ignoreId);
    if (reason) return { reason, risers: [] };
    const s = checkSupport(this.game.landscape, this.game.layout, type, flipped, pose, y, ignoreId);
    if (s.kind === "unsupported") return { reason: "unsupported", risers: [] };
    for (const r of s.risers) {
      const why = this.blockedBy("riser", false, r.pose, r.y, ignoreId);
      if (why) return { reason: why, risers: [] };
    }
    const site = this.siteRule?.(type, pose) ?? null;
    if (site) {
      this.siteWhy = site;
      return { reason: "site", risers: [] };
    }
    return { reason: null, risers: s.risers };
  }

  /**
   * A mode's own rule for where a piece may go, beyond the track's (Game mode: an industry stands near its resource),
   * as the message to show, or null. Runs on every move while a piece is held: keep it cheap.
   */
  siteRule: ((type: PieceTypeId, pose: Pose) => string | null) | null = null;
  /** The message for the last "site" refusal. */
  private siteWhy = "";

  private blockMessage(reason: PlaceBlock): string {
    return reason === "site" ? this.siteWhy : BLOCK_MESSAGES[reason];
  }

  /** Check a would-be position for piece `id` (turned or flipped in place: no risers are added), explaining a refusal. */
  private allowed(id: number, type: PieceTypeId, flipped: boolean, pose: Pose, y: number): boolean {
    const p = this.placement(type, flipped, pose, y, id);
    const reason = p.reason ?? (p.risers.length > 0 ? "unsupported" : null);
    if (reason) this.hud.toast(this.blockMessage(reason));
    return reason === null;
  }

  /** Is a placed piece close enough to pick up (big enough on screen to take hold of)? */
  private withinReach(pieceId: number): boolean {
    const g = this.game;
    const p = g.layout.getPiece(pieceId);
    if (!p) return false;
    const c = pieceCentre(g.layout, pieceId);
    const distance = Math.hypot(c.x - g.camera.position.x, p.y - g.camera.position.y, c.z - g.camera.position.z);
    // Screen pixels per mm at that distance.
    const pxPerMm = g.canvas.clientHeight / (2 * distance * Math.tan((g.camera.fov * Math.PI) / 360));
    return GRAB_PIECE_MM * pxPerMm >= GRAB_MIN_PX;
  }

  /** The piece of an industry you placed (a drag on its yard or buildings moves it), or −1 (a map's own depot). */
  private movableIndustry(depotId: number): number {
    const d = this.game.economy.depot(depotId);
    const p = d && this.game.layout.getPiece(d.pieceId);
    if (!d || !p || !INDUSTRY_ROLE[p.type] || this.fixedLabel(d.pieceId) || this.game.sim.pieceOccupied(d.pieceId)) return -1;
    return d.pieceId;
  }

  /** The name of a fixed piece (a town's station or a depot), or null for ordinary track. */
  private fixedLabel(pieceId: number): string | null {
    for (const [townId, stationId] of this.game.stations) {
      if (stationId === pieceId) {
        const name = this.game.landscape.towns.find((t) => t.id === townId)?.name;
        return name ? `${name} station` : null;
      }
    }
    for (const [depotId, id] of this.game.depots) {
      if (id === pieceId) {
        const depot = this.game.landscape.depots.find((d) => d.id === depotId);
        return depot ? DEPOT_NAMES[depot.kind] : null;
      }
    }
    return null;
  }

  flipSelected(): void {
    if (this.mode.kind === "drag-piece") {
      const m = this.mode;
      if (!getPieceDef(m.type, false).flippable) return;
      m.heldFlipped = !m.heldFlipped;
      m.flipped = m.heldFlipped;
      const visible = m.ghost.visible;
      this.dropHeld(m.ghost);
      m.ghost = this.heldMesh(m.type, m.flipped);
      m.ghost.visible = visible;
      return;
    }
    const id = this.selectedPiece;
    const p = id === -1 ? undefined : this.game.layout.getPiece(id);
    if (!p) return;
    const pose = this.editor().flippedPose(id) ?? p.pose;
    if (!this.allowed(id, p.type, !p.flipped, pose, p.y)) {
      this.onRefused?.();
      return;
    }
    // Flipped: hop up and drop back down as the mirror image.
    if (this.editor().flip(id)) this.animateChange(id, (mesh, after, done) => settle(mesh, { ...after, y: after.y + 10 }, after, done));
  }

  deleteSelected(): void {
    if (this.roads.selected !== -1) {
      this.roads.removeSelected();
      return;
    }
    if (this.selectedScenery) {
      const s = this.selectedScenery;
      this.clearSelection();
      this.hud.hideCards();
      this.removeSelectedScenery(s);
      return;
    }
    if (this.selectedProp !== -1) {
      const id = this.selectedProp;
      this.clearSelection();
      this.hud.hideCards();
      this.removeProp(id);
      return;
    }
    if (this.picking) {
      this.deletePicked();
      return;
    }
    if (this.selectedPiece === -1) return;
    const id = this.selectedPiece;
    this.clearSelection();
    this.hud.hideCards();
    const p = this.game.layout.getPiece(id);
    if (!this.editor().remove(id) || !p) return;
    // A stand-in lifts and shrinks away where the piece was.
    const g = this.game;
    const mesh = ghostMesh(p.type, p.flipped, [g.mats.track, g.mats.trackCut, g.mats.bridgePaint], g.bridgeLevelsOf(p));
    mesh.castShadow = true;
    mesh.position.set(p.pose.x, p.y, p.pose.z);
    mesh.rotation.y = -p.pose.heading;
    g.scene.add(mesh);
    g.flourishes.add(shrinkAway(mesh, () => g.scene.remove(mesh)));
  }

  // ---- dragging pieces --------------------------------------------------------------------------------------

  // ---- picking several pieces --------------------------------------------------------------------------------

  /** Piece card "Select more": the selected piece is the first picked, and taps on track pick more. */
  selectMore(): void {
    this.arm(null);
    const first = this.selectedPiece;
    this.clearSelection();
    this.picking = true;
    if (first !== -1) this.picked.add(first);
    this.showPicked();
  }

  /** Group card "Done": let the picked pieces go. */
  doneSelecting(): void {
    this.clearSelection();
    this.hud.hideCards();
  }

  /** Can this piece be picked to move with others? Not stations and depots, nor track a train stands on. */
  private pickable(id: number): boolean {
    return this.game.layout.getPiece(id) !== undefined && this.fixedLabel(id) === null && !this.game.sim.pieceOccupied(id);
  }

  /** Tap while picking (or Shift+click): pick a piece, or put it back. */
  private togglePick(id: number): void {
    if (!this.picking) {
      const first = this.selectedPiece;
      this.clearSelection();
      this.picking = true;
      if (first !== -1) this.picked.add(first);
    }
    if (this.picked.has(id)) this.picked.delete(id);
    else if (this.game.sim.pieceOccupied(id)) this.hud.toast("A train is on that track");
    else if (this.pickable(id)) this.picked.add(id);
    this.showPicked();
  }

  /** Group card "Joined track": pick all the track joined to the picked pieces (up to stations, depots and trains). */
  selectJoined(): void {
    for (const id of this.joinedTrack()) this.picked.add(id);
    this.showPicked();
  }

  /** The pickable track joined (through any number of joints) to the picked pieces, not yet picked. */
  private joinedTrack(limit = Infinity): number[] {
    const layout = this.game.layout;
    const seen = new Set(this.picked);
    const queue = [...this.picked];
    const found: number[] = [];
    while (queue.length > 0 && found.length < limit) {
      const id = queue.pop()!;
      const p = layout.getPiece(id);
      if (!p) continue;
      const count = getPieceDef(p.type, p.flipped).connectors.length;
      for (let i = 0; i < count; i++) {
        const other = layout.joinedConnector(connectorRef(id, i));
        if (other === -1) continue;
        const next = pieceOfRef(other);
        if (seen.has(next)) continue;
        seen.add(next);
        if (!this.pickable(next)) continue;
        found.push(next);
        queue.push(next);
      }
    }
    return found;
  }

  private showPicked(tone: OutlineTone = "select"): void {
    this.game.trackView.setHighlights(this.picked, tone);
    this.hud.showGroupCard(this.picked.size, this.joinedTrack(1).length > 0);
    this.game.invalidate();
  }

  /**
   * The picked pieces and the risers that hold only them up (a raised run takes its stands along; a riser under a
   * joint to track left behind stays with that track).
   */
  private pickedWithRisers(): number[] {
    const layout = this.game.layout;
    const ids = [...this.picked].filter((id) => layout.getPiece(id));
    const members = new Set(ids);
    const ends: { x: number; z: number; y: number; mine: boolean }[] = [];
    const w: WorldConnector = { x: 0, z: 0, heading: 0, y: 0, kind: "socket" };
    for (const id of layout.pieceIds()) {
      const p = layout.getPiece(id)!;
      if (p.type === "riser") continue;
      const count = getPieceDef(p.type, p.flipped).connectors.length;
      for (let i = 0; i < count; i++) {
        layout.worldConnector(connectorRef(id, i), w);
        ends.push({ x: w.x, z: w.z, y: w.y, mine: members.has(id) });
      }
    }
    for (const id of layout.pieceIds()) {
      const r = layout.getPiece(id)!;
      if (r.type !== "riser" || members.has(id)) continue;
      const over = ends.filter((e) => Math.hypot(e.x - r.pose.x, e.z - r.pose.z) < 6 && e.y > r.y);
      if (over.length > 0 && over.every((e) => e.mine)) ids.push(id);
    }
    return ids;
  }

  /** Why the group can't stand where it now is in the layout (each piece, and what holds it up), or null. */
  private groupBlocked(ids: readonly number[], members: ReadonlySet<number>): BlockReason | null {
    const g = this.game;
    const hills = hillsOf(g.landscape.grid);
    for (const id of ids) {
      const p = g.layout.getPiece(id)!;
      const why = this.blockedBy(p.type, p.flipped, p.pose, p.y, id);
      if (why) return why;
      if (p.type === "riser") {
        // A stand rests on the ground, or on another stand that came along.
        const onGround = Math.abs(hills.groundAt(p.pose.x, p.pose.z) - p.y) <= 1;
        const onStand = ids.some((o) => {
          const q = g.layout.getPiece(o)!;
          return members.has(o) && q.type === "riser" && Math.hypot(q.pose.x - p.pose.x, q.pose.z - p.pose.z) < 2 && Math.abs(q.y + RISER_HEIGHT - p.y) <= 1;
        });
        if (!onGround && !onStand) return "unsupported";
        continue;
      }
      const s = checkSupport(g.landscape, g.layout, p.type, p.flipped, p.pose, p.y, id);
      if (s.kind === "unsupported" || s.risers.length > 0) return "unsupported";
    }
    return null;
  }

  /** The group's poses turned an eighth about its middle. */
  private turnedPoses(ids: readonly number[]): Map<number, Pose> {
    const layout = this.game.layout;
    let cx = 0;
    let cz = 0;
    for (const id of this.picked) {
      const c = pieceCentre(layout, id);
      cx += c.x / this.picked.size;
      cz += c.z / this.picked.size;
    }
    const a = Math.PI / 4;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    const out = new Map<number, Pose>();
    for (const id of ids) {
      const p = layout.getPiece(id)!.pose;
      const x = p.x - cx;
      const z = p.z - cz;
      out.set(id, { x: cx + x * ca - z * sa, z: cz + x * sa + z * ca, heading: p.heading + a });
    }
    return out;
  }

  /** Turn the picked pieces together, an eighth about their middle (one undo step). */
  private turnPicked(): void {
    const g = this.game;
    if (this.picked.size === 0) return;
    const ids = this.pickedWithRisers();
    const members = new Set(ids);
    const before = new Map(ids.map((id) => [id, { ...g.layout.getPiece(id)!.pose }]));
    const after = this.turnedPoses(ids);
    // Try it in place, then put it back for the editor to do as one step.
    const parted = g.layout.partFrom(members);
    g.layout.nudgePieces(after);
    const blocked = this.groupBlocked(ids, members);
    g.layout.nudgePieces(before);
    for (const ref of parted) g.layout.seatFree(ref);
    if (blocked) {
      this.hud.toast(this.blockMessage(blocked));
      this.onRefused?.();
      return;
    }
    this.editor().moveGroup(before, after);
    g.trackView.sync();
    this.showPicked();
    this.onTurned?.();
  }

  /** Take up all the picked pieces (and the stands under them), as one undo step. */
  private deletePicked(): void {
    const g = this.game;
    const ids = this.pickedWithRisers();
    if (ids.length === 0) return;
    const pieces = ids.map((id) => g.layout.getPiece(id)!);
    this.clearSelection();
    this.hud.hideCards();
    if (!this.editor().removeGroup(ids)) return;
    // Stand-ins lift and shrink away where the pieces were (a few, for a big group).
    for (const p of pieces.slice(0, 24)) {
      const mesh = ghostMesh(p.type, p.flipped, [g.mats.track, g.mats.trackCut, g.mats.bridgePaint], g.bridgeLevelsOf(p));
      mesh.position.set(p.pose.x, p.y, p.pose.z);
      mesh.rotation.y = -p.pose.heading;
      g.scene.add(mesh);
      g.flourishes.add(shrinkAway(mesh, () => g.scene.remove(mesh)));
    }
  }

  /** A picked piece taken hold of: all the picked pieces come along, parted from the track around them. */
  private beginGroupMove(pieceId: number, pointerId: number, x: number, y: number): void {
    const g = this.game;
    const held = g.layout.getPiece(pieceId);
    const grab = held && this.planeAt(x, y, held.y);
    if (!held || !grab) return;
    const ids = this.pickedWithRisers();
    const members = new Set(ids);
    const before = new Map(ids.map((id) => [id, { ...g.layout.getPiece(id)!.pose }]));
    const parted = g.layout.partFrom(members);
    g.sim.trackChanged();
    const ends: WorldConnector[] = [];
    for (const id of ids) {
      const p = g.layout.getPiece(id)!;
      const count = getPieceDef(p.type, p.flipped).connectors.length;
      for (let i = 0; i < count; i++) {
        const ref = connectorRef(id, i);
        if (g.layout.joinedConnector(ref) === -1) ends.push({ ...g.layout.worldConnector(ref, { x: 0, z: 0, heading: 0, y: 0, kind: "socket" }) });
      }
    }
    this.mode = { kind: "drag-group", pointerId, grab, ids, members, before, parted, ends, dx: 0, dz: 0, snapped: false, blocked: null, key: "" };
    this.onPickup?.();
  }

  private readonly nearEnds: number[] = [];
  private readonly otherEnd: WorldConnector = { x: 0, z: 0, heading: 0, y: 0, kind: "socket" };

  private updateGroup(m: Extract<Mode, { kind: "drag-group" }>, x: number, y: number): void {
    const g = this.game;
    const at = this.planeAt(x, y, m.grab.y);
    if (!at) return;
    let dx = at.x - m.grab.x;
    let dz = at.z - m.grab.z;
    // A free end of the group near a free end of other track (the other kind, facing it, level with it): click on.
    let best = GROUP_SNAP_REACH;
    let sx = 0;
    let sz = 0;
    for (const e of m.ends) {
      const ex = e.x + dx;
      const ez = e.z + dz;
      const n = g.layout.queryFreeConnectors(ex, ez, GROUP_SNAP_REACH, this.nearEnds);
      for (let k = 0; k < n; k++) {
        const ref = this.nearEnds[k];
        if (m.members.has(pieceOfRef(ref))) continue;
        const o = g.layout.worldConnector(ref, this.otherEnd);
        if (o.kind === e.kind || Math.abs(o.y - e.y) > 2 || Math.abs(normalizeAngle(o.heading - e.heading - Math.PI)) > GROUP_SNAP_ANGLE) continue;
        const d = Math.hypot(o.x - ex, o.z - ez);
        if (d >= best) continue;
        best = d;
        sx = o.x - ex;
        sz = o.z - ez;
      }
    }
    m.snapped = best < GROUP_SNAP_REACH;
    dx += sx;
    dz += sz;
    const key = `${Math.round(dx * 4)},${Math.round(dz * 4)}`;
    if (key === m.key) return;
    m.key = key;
    m.dx = dx;
    m.dz = dz;
    const poses = new Map<number, Pose>();
    for (const [id, p] of m.before) poses.set(id, { x: p.x + dx, z: p.z + dz, heading: p.heading });
    g.layout.nudgePieces(poses);
    g.trackView.moveInstances(m.ids);
    const blocked = this.groupBlocked(m.ids, m.members);
    if (blocked && blocked !== m.blocked) this.hud.toast(this.blockMessage(blocked));
    m.blocked = blocked;
    g.trackView.setHighlights(this.picked, m.blocked ? "blocked" : m.snapped ? "snap" : "select");
    g.moveShadows();
    g.invalidate();
  }

  /** Back where the group was taken from, joined as it was. */
  private putGroupBack(m: Extract<Mode, { kind: "drag-group" }>): void {
    const g = this.game;
    g.layout.nudgePieces(m.before);
    for (const ref of m.parted) g.layout.seatFree(ref);
    g.trackView.moveInstances(m.ids);
    g.trackView.setHighlights(this.picked);
    g.sim.trackChanged();
    g.moveShadows();
    g.invalidate();
  }

  private dropGroup(m: Extract<Mode, { kind: "drag-group" }>): void {
    const g = this.game;
    this.mode = { kind: "idle" };
    g.director.setEdgePointer(null);
    const after = new Map(m.ids.map((id) => [id, { ...g.layout.getPiece(id)!.pose }]));
    // Put back as it was: the editor then moves it, as one undo step.
    this.putGroupBack(m);
    if (Math.hypot(m.dx, m.dz) < 0.5) return;
    if (m.blocked) {
      this.onRefused?.();
      return;
    }
    this.editor().moveGroup(m.before, after);
    g.trackView.sync();
    this.showPicked();
    this.onPlaced?.(m.snapped);
  }

  private beginPieceMove(pieceId: number, pointerId: number, ground: Vector3): void {
    const layout = this.game.layout;
    const p = layout.getPiece(pieceId);
    if (!p) return;
    this.clearSelection();
    this.hud.hideCards();
    const from = { pose: { ...p.pose }, y: p.y };
    layout.liftPiece(pieceId);
    // An industry's yard goes up with it (drawn in the hand, not where it stood).
    if (INDUSTRY_ROLE[p.type]) this.game.depotView.setWorld(this.game.economy, layout);
    this.game.sim.trackChanged();
    this.changed();
    const ghost = this.heldMesh(p.type, p.flipped);
    const centre = poseForCentre(p.type, p.flipped, 0, 0, p.pose.heading);
    // offset from the grab point to the piece centre, so the piece doesn't jump under the finger
    const cx = p.pose.x - centre.x;
    const cz = p.pose.z - centre.z;
    this.mode = {
      kind: "drag-piece",
      pointerId,
      type: p.type,
      flipped: p.flipped,
      heldFlipped: p.flipped,
      heading: p.pose.heading,
      pieceId,
      from,
      offset: { x: cx - ground.x, z: cz - ground.z },
      ghost,
      snap: { kind: "none" },
      pose: { ...p.pose },
      looseY: p.y,
      blocked: null,
      risers: [],
      overTray: false,
      goal: { x: p.pose.x, y: p.y + HOLD_LIFT, z: p.pose.z, heading: p.pose.heading },
      // Starts exactly where the piece lay, then lifts.
      shown: { x: p.pose.x, y: p.y, z: p.pose.z, heading: p.pose.heading, scale: 1, tiltX: 0, tiltZ: 0 },
      fresh: false,
    };
    this.onPickup?.();
  }

  /** A held piece: the real wooden piece (not a see-through ghost), with a rim glow for snap / blocked. */
  private heldMesh(type: PieceTypeId, flipped: boolean): Mesh {
    const mats = this.game.mats;
    setRim(mats.held, "#ffffff", 0);
    const mesh = ghostMesh(type, flipped, [mats.held, mats.trackCut, mats.held]);
    mesh.castShadow = true;
    mesh.renderOrder = 0;
    mesh.matrixAutoUpdate = false;
    // An industry comes with its yard and buildings.
    const role = INDUSTRY_ROLE[type];
    if (role) mesh.add(this.game.depotView.model(role));
    this.game.scene.add(mesh);
    return mesh;
  }

  /** Put a held piece's stand-in away (and its buildings, which are its own). */
  private dropHeld(mesh: Mesh): void {
    this.game.scene.remove(mesh);
    for (const child of [...mesh.children]) {
      mesh.remove(child);
      disposeObject(child);
    }
  }

  private updateDrag(x: number, y: number): void {
    const m = this.mode;
    if (m.kind === "drag-group") {
      this.lastX = x;
      this.lastY = y;
      const r = this.game.canvas.getBoundingClientRect();
      const trayTop = this.hud.tray.getBoundingClientRect().top - r.top;
      this.game.director.setEdgePointer({ x: x - r.left, y: y - r.top, touch: this.lastPointerWasTouch, bottom: trayTop, waitForExit: false });
      this.updateGroup(m, x, y);
      return;
    }
    if (m.kind === "drag-scenery") {
      this.updateSceneryDrag(m, x, y);
      return;
    }
    if (m.kind !== "drag-piece" && m.kind !== "drag-train" && m.kind !== "drag-cargo" && m.kind !== "drag-prop" && m.kind !== "drag-road") return;
    this.lastX = x;
    this.lastY = y;
    m.overTray = this.hud.isOverTray(x, y);
    const r = this.game.canvas.getBoundingClientRect();
    const trayTop = this.hud.tray.getBoundingClientRect().top - r.top;
    // A drag coming up out of the tray passes through the bottom band: only pan once it has left the band.
    this.game.director.setEdgePointer(m.overTray ? null : { x: x - r.left, y: y - r.top, touch: this.lastPointerWasTouch, bottom: trayTop, waitForExit: true });
    const ground = this.groundAt(x, y);
    if (m.kind === "drag-prop") {
      this.updatePropDrag(m, x, y);
      return;
    }
    if (m.kind === "drag-road") {
      // On touch, the square a little above the finger, so the piece can be seen.
      this.roads.update(m.drag, this.squareAt(x, this.lastPointerWasTouch ? y - TOUCH_LIFT_PX : y), m.overTray);
      return;
    }
    if (m.kind === "drag-cargo") {
      m.ghost.visible = !m.overTray && !!ground;
      if (!ground) return;
      // Held above the ground (and, on touch, a little ahead of the finger so it can be seen).
      const at = (this.lastPointerWasTouch ? this.touchLift(x, y) : null) ?? ground;
      m.ghost.position.set(at.x, 34, at.z);
      return;
    }
    if (m.kind === "drag-piece") {
      m.ghost.visible = !m.overTray && !!ground;
      if (!ground) return;
      // On touch the piece floats a little above the finger so it isn't hidden.
      const sy = this.lastPointerWasTouch ? y - TOUCH_LIFT_PX : y;
      // Where the piece would be held at a given height: under the finger as seen at that height (a raised end shows
      // well in front of the ground under it).
      // The auto straight is held, and seeks a seat, as the long straight it starts as.
      const holdType: PieceTypeId = m.auto ? "straight-216" : m.type;
      const heldAt = (height: number): Pose | null => {
        const p = this.planeAt(x, sy, height);
        return p && poseForCentre(holdType, m.heldFlipped, p.x + m.offset.x, p.z + m.offset.z, m.heading);
      };
      // Loose, a piece's first end lands on a quarter-square grid, so square-laid track lines up with the squares and
      // with other track.
      const loose = (pose: Pose): Pose => {
        pose.x = Math.round(pose.x / PLACE_GRID) * PLACE_GRID;
        pose.z = Math.round(pose.z / PLACE_GRID) * PLACE_GRID;
        return pose;
      };
      m.pose = loose(heldAt(0) ?? poseForCentre(holdType, m.heldFlipped, ground.x + m.offset.x, ground.z + m.offset.z, m.heading));
      m.looseY = looseHeight(this.game.landscape, this.game.layout, holdType, m.heldFlipped, m.pose, m.pieceId);
      // Resting up off the ground (on a hill, a riser, as a bridge), it's held where the finger points at that height.
      if (m.looseY > 0) {
        const up = heldAt(m.looseY);
        if (up) m.pose = loose(up);
      }
      // A bridge held over track stands high enough for trains to pass under it (two levels over that track).
      for (let k = 0; k < 4 && isBridge(holdType) && findLowCrossing(this.game.layout, holdType, m.heldFlipped, m.pose, m.looseY, m.pieceId) !== -1; k++) {
        m.looseY += RISER_HEIGHT;
        const up = heldAt(m.looseY);
        if (up) m.pose = loose(up);
      }
      // A riser over another riser stacks squarely on top of it.
      const stack = getPieceDef(m.type, m.heldFlipped).connectors.length === 0 ? riserStackAt(this.game.layout, m.pose.x, m.pose.z, m.pieceId) : null;
      if (stack) m.pose = { ...stack.pose };
      const capture = this.captureRadius(x, y);
      // Look for pegs on the floor, up to a few risers up, and on whatever the piece is over. Ends that don't match
      // (peg to peg, hole to hole) turn the piece round, or for a new piece mirror it, so it fits.
      // A moved piece keeps its hand (a curve stays a left or a right); a ramp may still swap its ends to fit.
      const autoFit = m.pieceId === -1 || flipSwapsEnds(holdType) ? "turn-or-mirror" : "turn";
      m.snap = { kind: "none" };
      // A free end under the finger wins: the piece goes where it's pointed. Else the nearest end to the held piece's.
      let atFinger = false;
      for (const level of new Set([0, RISER_HEIGHT, 2 * RISER_HEIGHT, 3 * RISER_HEIGHT, 4 * RISER_HEIGHT, m.looseY, m.looseY + RISER_HEIGHT])) {
        const held = heldAt(level) ?? m.pose;
        const finger = this.planeAt(x, sy, level);
        const f = finger ? findSnapAtPoint(this.game.layout, holdType, m.heldFlipped, held, level, finger, m.pieceId, Math.max(capture, m.tapReach ?? 0), autoFit) : null;
        const s = f?.kind === "snapped" ? f : findSnap(this.game.layout, holdType, m.heldFlipped, held, level, m.pieceId, capture, autoFit);
        // A bridge only joins track it can stand at (raised track, another bridge): beside track on the ground it
        // keeps to its own height, a level up.
        if (s.kind === "snapped" && isBridge(holdType) && bridgeLevels(this.game.landscape, m.type, s.flipped, s.pose, s.y) === 0) continue;
        if (s.kind !== "snapped") continue;
        const fingered = s === f;
        if (atFinger && !fingered) continue;
        if (m.snap.kind !== "snapped" || (fingered && !atFinger) || s.distance < m.snap.distance) {
          m.snap = s;
          atFinger = fingered;
        }
      }
      if (m.auto) {
        const fit = m.snap.kind === "snapped" && m.snap.connector <= 1 ? fitAutoStraight(this.game.layout, m.snap.pose, m.snap.y, m.snap.connector as 0 | 1, [m.pieceId]) : null;
        // Shrink to meet a free end along its line, or bend (a join) to meet one a little to one side.
        if (fit && m.snap.kind === "snapped") m.snap = { ...m.snap, pose: fit.pose, flipped: fit.flipped };
        const type = fit?.type ?? "straight-216";
        if (type !== m.type) {
          m.type = type;
          m.ghost.geometry = pieceGeometry(type, m.flipped);
        }
      }
      const fitFlipped = m.snap.kind === "snapped" ? m.snap.flipped : m.heldFlipped;
      if (fitFlipped !== m.flipped) {
        // Show it mirrored (or back as held) while it fits that way.
        m.flipped = fitFlipped;
        const visible = m.ghost.visible;
        this.dropHeld(m.ghost);
        m.ghost = this.heldMesh(m.type, m.flipped);
        m.ghost.visible = visible;
      }
      const pose = m.snap.kind === "snapped" ? m.snap.pose : m.pose;
      const py = m.snap.kind === "snapped" ? m.snap.y : m.looseY;
      const { reason, risers } = this.placement(m.type, m.flipped, pose, py, m.pieceId);
      // (A preview under the mouse just shows red: the reason comes if it's clicked.)
      if (reason && reason !== m.blocked && !m.overTray && m !== this.preview) this.hud.toast(this.blockMessage(reason));
      m.blocked = reason;
      m.risers = risers;
      // Trees hop out of the way of where the piece would go (and back when it moves on); a ramp shows its cutting.
      const treeKey = reason || m.overTray ? "" : `${m.type}|${m.flipped}|${Math.round(pose.x)}|${Math.round(pose.z)}|${pose.heading.toFixed(3)}|${py}`;
      if (treeKey !== this.treeKey) {
        this.treeKey = treeKey;
        this.game.previewTrees(treeKey ? { type: m.type, flipped: m.flipped, pose, y: py } : null);
      }
      if (canStandOnArches(m.type)) {
        // A bridge's arches reach down to the ground under it (one level while it can't stand here); a ramp has
        // arches only while it's up off the ground.
        const arches = bridgeLevels(this.game.landscape, m.type, m.flipped, pose, py);
        const levels = isBridge(m.type) ? Math.max(1, arches) : arches;
        const geometry = pieceGeometry(m.type, m.flipped, levels);
        if (m.ghost.geometry !== geometry) m.ghost.geometry = geometry;
      }
      const held = this.game.mats.held;
      if (reason) setRim(held, "#ff4a3a", 1.2);
      else if (m.snap.kind === "snapped") setRim(held, "#7ddc58", 0.9);
      else setRim(held, "#fff2d8", 0.12);
      m.goal.x = pose.x;
      m.goal.y = py + HOLD_LIFT;
      m.goal.z = pose.z;
      m.goal.heading = pose.heading;
      if (m.fresh && m.ghost.visible) {
        Object.assign(m.shown, m.goal);
        m.fresh = false;
      }
      return;
    }
    m.ghost.visible = !m.overTray && !!ground;
    if (!ground) return;
    const near = nearestCursor(this.game.layout, ground.x, ground.z, TRAIN_DROP_RANGE, this.cameraHeading());
    m.target = near?.cursor ?? null;
    if (near) {
      const w = cursorWorld(this.game.layout, near.cursor, createWorldSample());
      m.ghost.position.set(w.x, w.y + 4, w.z);
      m.ghost.rotation.set(0, -w.heading, 0);
    } else {
      m.ghost.position.set(ground.x, 30, ground.z);
      m.ghost.rotation.set(0, -this.cameraHeading(), 0);
    }
  }

  private lastX = 0;
  private lastY = 0;
  /** What the trees last made way for while a piece was held ("" for nothing). */
  private treeKey = "";

  private dropPiece(m: Extract<Mode, { kind: "drag-piece" }>): void {
    // Trees stay aside for a piece now placed (the layout change settles them), and go back where nothing was.
    this.treeKey = "";
    this.game.previewTrees(null, false);
    this.putDown(m);
    this.game.previewTrees(null);
  }

  private putDown(m: Extract<Mode, { kind: "drag-piece" }>): void {
    this.game.director.setEdgePointer(null);
    this.mode = { kind: "idle" };
    const g = this.game;
    const ed = this.editor();
    const pose = m.snap.kind === "snapped" ? m.snap.pose : m.pose;
    const y = m.snap.kind === "snapped" ? m.snap.y : m.looseY;
    const { reason: final, risers } = this.placement(m.type, m.flipped, pose, y, m.pieceId);
    const mesh = m.ghost;
    const shown: PiecePose = { x: m.shown.x, y: m.shown.y, z: m.shown.z, heading: m.shown.heading };
    const industry = !!INDUSTRY_ROLE[m.type];
    const discard = () => {
      this.dropHeld(mesh);
      // The yard shows where it stands again once the one in the hand has gone.
      if (industry) g.depotView.setWorld(g.economy, g.layout);
    };
    const isNew = m.pieceId === -1;
    // The stand-in stops sharing the held-piece material (the next piece picked up re-tints that): plain wood when
    // it's going down, see-through red when it's refused.
    const refused = final !== null || m.overTray;
    mesh.material = refused ? [g.mats.trackGhostBlocked, g.mats.trackGhostBlocked, g.mats.trackGhostBlocked] : [g.mats.track, g.mats.trackCut, g.mats.bridgePaint];
    switch (dropOutcome({ blocked: final !== null, overTray: m.overTray, isNew })) {
      case "place": {
        const snapped = m.snap.kind === "snapped";
        const id = isNew ? ed.place(m.type, pose, y, m.flipped, risers) : (ed.move(m.pieceId, pose, y, m.from!, risers, m.flipped), m.pieceId);
        g.trackView.setHidden(id, true);
        setRim(g.mats.held, "#ffffff", 0);
        g.flourishes.add(
          settle(mesh, shown, { x: pose.x, y, z: pose.z, heading: pose.heading }, () => {
            discard();
            g.trackView.setHidden(id, false);
          }),
        );
        if (m.snap.kind === "snapped") {
          const c = getPieceDef(m.type, m.flipped).connectors[m.snap.connector].pose;
          const ch = Math.cos(pose.heading);
          const sh = Math.sin(pose.heading);
          g.flourishes.add(dustPuff(g.scene, pose.x + c.x * ch - c.z * sh, y, pose.z + c.x * sh + c.z * ch));
        }
        this.onPlaced?.(snapped);
        // The next is likely the same kind: it stays ready, waiting at this one's free end for a tap.
        if (m.tray) {
          this.arm(m.tray);
          this.previewNextAt(id);
        }
        return;
      }
      case "return": {
        // Can't go there: float back to where it was.
        const from = m.from!;
        g.layout.dropPiece(m.pieceId, from.pose, from.y);
        g.trackView.setHidden(m.pieceId, true);
        this.changed();
        const id = m.pieceId;
        g.flourishes.add(
          wobbleBack(mesh, shown, { x: from.pose.x, y: from.y, z: from.pose.z, heading: from.pose.heading }, () => {
            discard();
            g.trackView.setHidden(id, false);
          }),
        );
        this.onRefused?.();
        return;
      }
      case "to-tray": {
        if (m.overTray || !mesh.visible) {
          // Put back in the box: nothing ready any more.
          if (m.overTray) this.arm(null);
          discard();
          return;
        }
        // A new piece that can't go there: shake "no", then back in the box.
        g.flourishes.add(wobbleBack(mesh, shown, shown, () => g.flourishes.add(shrinkAway(mesh, discard))));
        this.onRefused?.();
        return;
      }
      case "delete": {
        // Dragged back into the box: delete (undo restores it where it was).
        discard();
        g.layout.dropPiece(m.pieceId, m.from!.pose, m.from!.y);
        ed.remove(m.pieceId);
        this.hud.toast("Back in the box");
        return;
      }
    }
  }

  // ---- dragging trains --------------------------------------------------------------------------------------

  private beginTrainPickup(carId: number, pointerId: number): void {
    const sim = this.game.sim;
    const found = sim.findCar(carId);
    if (!found || found.train.derailed) {
      // Derailed cars are tapped to re-rail, not dragged.
      this.mode = { kind: "idle" };
      this.game.controls.enabled = true;
      return;
    }
    this.clearSelection();
    this.hud.hideCards();
    const t = found.train;
    // The load goes with the train in the hand, so it survives the cars being off the track for a moment.
    const cars: HeldCar[] = t.cars.map((c) => {
      const cargo = this.game.economy.cargoOf(c.id);
      return { kind: c.kind, facing: c.facing, lever: c.lever, id: c.id, look: sim.lookOf(c.id), ...(cargo.kind ? { cargo: { kind: cargo.kind, count: cargo.count } } : {}) };
    });
    const origin = t.derailed ? null : { ...t.bogies[0] };
    sim.removeTrain(t.id);
    this.changed();
    this.mode = { kind: "drag-train", pointerId, cars, origin, ghost: this.trainGhost(cars), target: null, overTray: false };
  }

  private dropTrain(m: Extract<Mode, { kind: "drag-train" }>): void {
    this.game.director.setEdgePointer(null);
    this.game.scene.remove(m.ghost);
    disposeObject(m.ghost);
    this.mode = { kind: "idle" };
    if (m.overTray) {
      if (m.origin) this.hud.toast("Back in the box");
      this.changed();
      return;
    }
    // Dropped onto or by another train: couple on to its nearer end.
    if (m.target && this.joinTrain(m.cars, m.target)) {
      this.changed();
      return;
    }
    if (m.target && this.placeTrain(m.cars, m.target, true)) {
      this.changed();
      return;
    }
    if (m.origin) this.placeTrain(m.cars, m.origin);
    this.hud.toast(m.target ? "Not enough track there" : "Drop trains onto the track");
    this.changed();
  }

  /**
   * Couple held cars on to the train nearest where they're dropped (`at`, on the track), at its nearer end, as one
   * train that keeps its place. False (nothing changed) if no train is near enough or there's no room.
   */
  private joinTrain(cars: HeldCar[], at: Cursor): boolean {
    const sim = this.game.sim;
    const drop = cursorWorld(this.game.layout, at, createWorldSample());
    // How near (mm) the drop point must be to a train's end: half the held cars' length and a hand's width more.
    const heldLength = cars.reduce((n, c) => n + CAR_SPECS[c.kind].length + COUPLER_GAP, 0);
    let best: { id: number; front: boolean; d: number } | null = null;
    // Two trains each with an engine stay two trains (each keeps its own route): wagons join a train, an engine
    // joins wagons.
    const heldEngine = cars.some((c) => c.kind === "engine");
    for (const id of sim.trainIds()) {
      const t = sim.getTrain(id)!;
      if (t.derailed || (heldEngine && t.cars.some((c) => c.kind === "engine"))) continue;
      const ends = [t.world[0], t.world[t.world.length - 1]];
      ends.forEach((w, k) => {
        const d = Math.hypot(w.x - drop.x, w.z - drop.z);
        if (Math.abs(w.y - drop.y) < 20 && d < heldLength / 2 + JOIN_REACH && (!best || d < best.d)) best = { id, front: k === 0, d };
      });
    }
    if (!best) return false;
    const { id, front } = best;
    const t = sim.getTrain(id)!;
    const theirs: HeldCar[] = t.cars.map((c) => {
      const cargo = this.game.economy.cargoOf(c.id);
      return { kind: c.kind, facing: c.facing, lever: c.lever, id: c.id, look: sim.lookOf(c.id), ...(cargo.kind ? { cargo: { kind: cargo.kind, count: cargo.count } } : {}) };
    });
    const lead = { ...t.bogies[0] };
    const together = front ? [...cars, ...theirs] : [...theirs, ...cars];
    // In front, the new lead axle is ahead of theirs by the held cars' length along the track.
    const newLead = { ...lead };
    if (front) {
      const ahead = trainSpan(together, cars.length);
      if (advanceCursor(this.game.layout, newLead, ahead, null, createAdvance()).status !== ADV_OK) return false;
    }
    sim.removeTrain(id);
    if (this.placeTrain(together, newLead)) return true;
    this.placeTrain(theirs, lead);
    return false;
  }

  /** Put a train down: exactly at `at` (back where it was picked up), or `around` it (a drop, centred on the point). */
  private placeTrain(cars: HeldCar[], at: Cursor, around = false): boolean {
    const sim = this.game.sim;
    const kinds = cars.map((c) => c.kind);
    const ids = cars.every((c) => c.id !== undefined) ? cars.map((c) => c.id!) : undefined;
    const r = around ? sim.addTrainAround(kinds, at, ids) : sim.addTrain(kinds, at, ids);
    if (r.kind !== "placed") return false;
    const t = sim.getTrain(r.trainId)!;
    t.cars.forEach((car, i) => {
      sim.setLook(car.id, cars[i].look ?? "classic");
      if (cars[i].facing === -1) sim.flipCar(car.id);
      if (car.kind === "engine") sim.setLever(car.id, cars[i].lever);
      const cargo = cars[i].cargo;
      if (cargo) this.game.economy.setCargo(car.id, cargo.kind, cargo.count);
    });
    return true;
  }

  private trainGhost(cars: { kind: CarKind; facing: 1 | -1; id?: number; look?: CarLook }[]): Group {
    const g = new Group();
    let x = 0;
    cars.forEach((c, i) => {
      const spec = CAR_SPECS[c.kind];
      if (i > 0) x -= COUPLER_GAP + spec.length / 2;
      const model = buildCarModel(c.kind, this.game.mats, carVariant(c.kind, c.id ?? i), c.look).root;
      model.position.x = x - (i === 0 ? spec.length / 2 - spec.bogieInset : 0);
      if (c.facing === -1) model.rotation.y = Math.PI;
      g.add(model);
      x = model.position.x - spec.length / 2;
    });
    // Centred between the first and last bogies, as a dropped train is placed (see `Sim.addTrainAround`).
    const span = -(x + CAR_SPECS[cars[cars.length - 1].kind].bogieInset);
    for (const m of g.children) m.position.x += span / 2;
    g.visible = false;
    this.game.scene.add(g);
    return g;
  }

  // ---- keyboard ---------------------------------------------------------------------------------------------

  /** What the hand is doing and what's selected, for a debug report. */
  debugState(): Record<string, unknown> {
    const m = this.mode as { kind: string; type?: string; asset?: string; pieceId?: number; propId?: number; blocked?: unknown; snap?: { kind: string } };
    return {
      mode: m.kind,
      held: m.type ?? m.asset,
      heldId: m.pieceId ?? m.propId,
      blocked: m.blocked ?? null,
      snap: m.snap?.kind,
      selectedPiece: this.selectedPiece,
      selectedProp: this.selectedProp,
      selectedCar: this.selectedCar,
      selectedScenery: this.selectedScenery,
      trayTurns: this.trayTurns,
      trayFlipped: this.trayFlipped,
      propHeading: this.propHeading,
    };
  }

  /** Is something selected or held that R and F act on (turn, flip)? Else they tilt the view. */
  get piecesTakeKeys(): boolean {
    const k = this.mode.kind;
    return k === "drag-piece" || k === "drag-prop" || this.selectedPiece !== -1 || this.selectedProp !== -1;
  }

  /** Cmd or Ctrl went down on its own (and nothing else since): a tap that flips. */
  private modTapped = false;

  private onKey(e: KeyboardEvent): void {
    if ((e.target as HTMLElement)?.tagName === "INPUT" || (e.target as HTMLElement)?.tagName === "TEXTAREA") return;
    this.modTapped = (e.key === "Meta" || e.key === "Control") && !e.repeat && !e.shiftKey && !e.altKey;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && this.busy && (e.key.toLowerCase() === "z" || e.key.toLowerCase() === "y")) {
      e.preventDefault();
      return;
    }
    if (mod && e.key.toLowerCase() === "z") {
      e.preventDefault();
      if (e.shiftKey) this.redo();
      else this.undo();
    } else if (mod && e.key.toLowerCase() === "y") {
      e.preventDefault();
      this.redo();
    } else if (e.key === "r" || e.key === "R") this.rotateSelected();
    else if (e.key === "f" || e.key === "F") this.flipSelected();
    else if (e.key === "Delete" || e.key === "Backspace") this.deleteSelected();
    else if (e.key === "Escape") {
      this.arm(null);
      if (this.mode.kind !== "draw-track") this.setDrawing(false);
      this.cancel();
      this.clearSelection();
      this.hud.hideCards();
    }
  }

  // ---- land ------------------------------------------------------------------------------------------------

  /** The square under a screen point, seen on the land's surface (a hill's top, not the floor under it); −1 off the land. */
  squareAt(x: number, y: number): number {
    const g = this.game.landscape.grid;
    // The first block top the ray meets, looking down from the highest the land goes: a ray through a hill's top
    // meets the ground plane beyond the hill, so going up from there would find the square behind it.
    for (let h = MAX_HEIGHT; h > 0; h--) {
      const q = this.planeAt(x, y, h * RISER_HEIGHT);
      if (!q) continue;
      const i = g.cellAtWorld(q.x, q.z);
      if (i !== -1 && g.height[i] >= h) return i;
    }
    const p = this.planeAt(x, y, 0);
    if (!p) return -1;
    return g.cellAtWorld(p.x, p.z);
  }

  /** Outline square `i` (land editing), in the land cursor's colour; −1 hides it. */
  showSquare(i: number): void {
    const g = this.game.landscape.grid;
    if (i === -1 || !this.landCursor) {
      if (this.squareOutline.line.visible) this.game.invalidate();
      this.squareOutline.hide();
      return;
    }
    const x = g.centreX(g.colOf(i));
    const z = g.centreZ(g.rowOf(i));
    this.squareOutline.show({ cx: 0, cz: 0, hw: CELL / 2 - 4, hd: CELL / 2 - 4 }, x, hillsOf(g).groundAt(x, z), z, 0, this.landCursor);
    this.game.invalidate();
  }

  /** A checker for land edits, knowing the track and the props. */
  landEditor(): LandEditor {
    const g = this.game;
    return new LandEditor(g.landscape, g.layout, { inRect: (x0, z0, x1, z1) => propsInRect(g.props, g.propLibrary.footprint, x0, z0, x1, z1) });
  }

  /** Move tool: select the scenery on the square at a screen point (or clear the selection if there's none). */
  selectSceneryAt(x: number, y: number): void {
    const i = this.squareAt(x, y);
    const s = i === -1 ? null : sceneryAt(this.game.landscape, i);
    this.clearSelection();
    this.hud.hideCards();
    if (!s) return;
    this.selectedScenery = s;
    this.outlineScenery(s, 0, 0);
    this.hud.showPieceCard(false, s.kind === "tree" ? "Tree" : s.kind === "field" ? "Field" : "Engine shed", false, false);
  }

  /** Outline scenery's squares, moved by (dc, dr), in a colour (white: selected). */
  private outlineScenery(s: Scenery, dc: number, dr: number, color = "#fff2d8"): void {
    const g = this.game.landscape.grid;
    const cells = sceneryCells(this.game.landscape, s);
    if (cells.length === 0) {
      this.sceneryOutline.hide();
      return;
    }
    const cols = cells.map((i) => g.colOf(i) + dc);
    const rows = cells.map((i) => g.rowOf(i) + dr);
    const c0 = Math.min(...cols);
    const c1 = Math.max(...cols);
    const r0 = Math.min(...rows);
    const r1 = Math.max(...rows);
    const x = (g.centreX(c0) + g.centreX(c1)) / 2;
    const z = (g.centreZ(r0) + g.centreZ(r1)) / 2;
    const fp = { cx: 0, cz: 0, hw: ((c1 - c0 + 1) * CELL) / 2 - 4, hd: ((r1 - r0 + 1) * CELL) / 2 - 4 };
    this.sceneryOutline.show(fp, x, hillsOf(g).groundAt(x, z), z, 0, color);
    this.game.invalidate();
  }

  private updateSceneryDrag(m: Extract<Mode, { kind: "drag-scenery" }>, x: number, y: number): void {
    const g = this.game.landscape.grid;
    const sy = this.lastPointerWasTouch ? y - TOUCH_LIFT_PX : y;
    const i = this.squareAt(x, sy);
    if (i === -1) return;
    const dc = g.colOf(i) - m.grab.col;
    const dr = g.rowOf(i) - m.grab.row;
    if (dc === m.dc && dr === m.dr) return;
    m.dc = dc;
    m.dr = dr;
    m.blocked = dc === 0 && dr === 0 ? null : m.editor.checkMove(m.scenery, dc, dr);
    if (m.blocked) this.hud.toast(LAND_MESSAGES[m.blocked]);
    this.outlineScenery(m.scenery, dc, dr, m.blocked ? "#ff4a3a" : dc === 0 && dr === 0 ? "#fff2d8" : "#7ddc58");
  }

  private dropScenery(m: Extract<Mode, { kind: "drag-scenery" }>): void {
    this.mode = { kind: "idle" };
    const land = this.game.landscape;
    if ((m.dc === 0 && m.dr === 0) || m.blocked) {
      if (m.blocked) this.onRefused?.();
      this.outlineScenery(m.scenery, 0, 0);
      return;
    }
    const g = land.grid;
    const from = sceneryCells(land, m.scenery);
    const to = from.map((i) => g.index(g.colOf(i) + m.dc, g.rowOf(i) + m.dr));
    const before = snapshot(land, [...from, ...to], m.scenery);
    const slots = moveScenery(land, m.scenery, m.dc, m.dr);
    const after = snapshot(land, [...from, ...to], m.scenery);
    this.game.editLand(slots);
    this.editor().recordLand({ do: () => restore(land, after), undo: () => restore(land, before), slots: () => slots });
    this.onPlaced?.(true);
    // Still selected where it now stands.
    const moved: Scenery = m.scenery.kind === "tree" ? { kind: "tree", cell: to[0] } : m.scenery;
    this.selectedScenery = moved;
    this.outlineScenery(moved, 0, 0);
  }

  private removeSelectedScenery(s: Scenery): void {
    const land = this.game.landscape;
    const cells = sceneryCells(land, s);
    const before = snapshot(land, cells, s);
    const slots = removeScenery(land, s);
    const after = snapshot(land, cells, s);
    this.game.editLand(slots);
    this.editor().recordLand({ do: () => restore(land, after), undo: () => restore(land, before), slots: () => slots });
  }

  // ---- props -----------------------------------------------------------------------------------------------

  /** A prop in the hand: its model (built when it arrives, if it isn't yet) and the drag state. */
  private propDrag(asset: string, propId: number, pointerId: number, heading: number, from: PropPose | null, offset: { x: number; z: number }, variant?: number): Extract<Mode, { kind: "drag-prop" }> {
    const g = this.game;
    const key = modelKey(asset, variant);
    const ghost = new Group();
    ghost.visible = false;
    const dress = () => {
      const model = g.propLibrary.model(key);
      if (!model) return;
      for (const part of model.parts) {
        const mesh = new Mesh(part.geometry, part.material);
        mesh.castShadow = true;
        ghost.add(mesh);
      }
    };
    if (g.propLibrary.model(key) !== undefined) dress();
    else
      g.propLibrary.load(key).then(
        () => {
          dress();
          if (this.mode.kind === "drag-prop" && this.mode.ghost === ghost) this.updateDrag(this.lastX, this.lastY);
        },
        (e: unknown) => console.warn(`Woodrail: couldn't load the model ${key}`, e),
      );
    g.scene.add(ghost);
    return { kind: "drag-prop", pointerId, asset, propId, from, heading, offset, ghost, pose: { x: 0, z: 0, heading, y: 0 }, blocked: null, overTray: true, track: new TrackIndex(g.layout) };
  }

  private beginPropMove(propId: number, pointerId: number, ground: Vector3): void {
    const g = this.game;
    const p = g.props.get(propId);
    if (!p) return;
    this.clearSelection();
    this.hud.hideCards();
    const from: PropPose = { x: p.x, z: p.z, heading: p.heading, y: p.y };
    this.mode = this.propDrag(p.asset, propId, pointerId, p.heading, from, { x: p.x - ground.x, z: p.z - ground.z }, p.variant);
    this.mode.overTray = false;
    // Drawn by the hand while it moves, not where it stood.
    g.propsChanged(propId);
    this.onPickup?.();
  }

  private updatePropDrag(m: Extract<Mode, { kind: "drag-prop" }>, x: number, y: number): void {
    const g = this.game;
    const sy = this.lastPointerWasTouch ? y - TOUCH_LIFT_PX : y;
    const hills = hillsOf(g.landscape.grid);
    // Held over the ground under the finger: on a hill, where the finger points at the hill's height.
    let at = this.planeAt(x, sy, 0);
    if (!at) {
      m.ghost.visible = false;
      this.propOutline.hide();
      return;
    }
    const h = hills.groundAt(at.x + m.offset.x, at.z + m.offset.z);
    if (h > 0) at = this.planeAt(x, sy, h) ?? at;
    const pose = { x: Math.round((at.x + m.offset.x) / 2) * 2, z: Math.round((at.z + m.offset.z) / 2) * 2, heading: m.heading };
    const fp = g.propLibrary.footprint(m.asset);
    let ground = hills.groundAt(pose.x, pose.z);
    let blocked: PropBlock | null = null;
    if (fp) {
      const own = new Set(buildingCells(g.landscape, m.propId === -1 ? undefined : g.props.get(m.propId)?.building));
      const c = checkProp({ land: g.landscape, track: m.track, props: g.props, footprint: g.propLibrary.footprint }, fp, pose, placeOn(m.asset), m.propId, own);
      if (c.kind === "clear") ground = c.y;
      else blocked = c.reason;
    }
    if (blocked && blocked !== m.blocked && !m.overTray) this.hud.toast(PROP_MESSAGES[blocked]);
    m.blocked = blocked;
    m.pose = { ...pose, y: ground };
    m.ghost.visible = !m.overTray;
    m.ghost.position.set(pose.x, ground + 6, pose.z);
    m.ghost.rotation.set(0, -pose.heading, 0);
    if (m.overTray || !fp) this.propOutline.hide();
    else this.propOutline.show(fp, pose.x, ground, pose.z, pose.heading, blocked ? "#ff4a3a" : "#7ddc58");
  }

  private dropProp(m: Extract<Mode, { kind: "drag-prop" }>): void {
    const g = this.game;
    g.director.setEdgePointer(null);
    this.mode = { kind: "idle" };
    g.scene.remove(m.ghost);
    this.propOutline.hide();
    if (m.overTray) {
      // Back in the box: a moved prop is removed (undoably), a new one never was.
      g.propsChanged(-1);
      if (m.propId !== -1) this.removeProp(m.propId);
      return;
    }
    const fp = g.propLibrary.footprint(m.asset);
    if (m.blocked || !fp) {
      this.onRefused?.();
      g.propsChanged(-1);
      // A moved prop stays where it was, still selected.
      if (m.propId !== -1) this.selectProp(m.propId);
      return;
    }
    const store = g.props;
    const pose = { ...m.pose };
    this.propHeading = pose.heading;
    let placed = m.propId;
    if (m.propId === -1) {
      let id = -1;
      this.editor().editProps({
        do: () => {
          id = store.add(m.asset, pose, id === -1 ? undefined : id).id;
        },
        undo: () => {
          store.remove(id);
        },
      });
      placed = id;
    } else {
      const id = m.propId;
      const from = m.from!;
      const building = store.get(id)?.building;
      if (building === undefined) this.editor().editProps({ do: () => store.move(id, pose), undo: () => store.move(id, from) });
      else this.moveTownProp(id, building, pose, from);
    }
    g.propsChanged(-1);
    this.onPlaced?.(false);
    // It stays selected, to nudge or turn again straight away.
    this.selectProp(placed);
  }

  private selectProp(id: number): void {
    const g = this.game;
    const p = g.props.get(id);
    if (!p) return;
    this.clearSelection();
    this.selectedProp = id;
    this.propOutline.show(g.propLibrary.footprint(p.asset) ?? null, p.x, p.y, p.z, p.heading);
    this.hud.showPieceCard(false, g.propLibrary.model(modelKey(p.asset, p.variant))?.name ?? "Model", false);
  }

  /** Turn a placed prop an eighth, if it still fits. */
  private turnProp(id: number): void {
    const g = this.game;
    const p = g.props.get(id);
    const fp = p && g.propLibrary.footprint(p.asset);
    if (!p || !fp) return;
    const from: PropPose = { x: p.x, z: p.z, heading: p.heading, y: p.y };
    const to = { x: p.x, z: p.z, heading: p.heading + Math.PI / 4 };
    const c = checkProp({ land: g.landscape, track: new TrackIndex(g.layout), props: g.props, footprint: g.propLibrary.footprint }, fp, to, placeOn(p.asset), id);
    if (c.kind === "blocked") {
      this.hud.toast(PROP_MESSAGES[c.reason]);
      this.onRefused?.();
      return;
    }
    const after = { ...to, y: c.y };
    this.propHeading = after.heading;
    this.editor().editProps({ do: () => g.props.move(id, after), undo: () => g.props.move(id, from) });
    g.propsChanged();
    this.propOutline.show(fp, after.x, after.y, after.z, after.heading);
    this.onTurned?.();
  }

  /** Take a prop away (undoably). A town building's squares become street. */
  private removeProp(id: number): void {
    const g = this.game;
    const p = g.props.get(id);
    if (!p) return;
    const pose: PropPose = { x: p.x, z: p.z, heading: p.heading, y: p.y };
    const links = { building: p.building, town: p.town, variant: p.variant };
    if (p.building === undefined) {
      this.editor().editProps({ do: () => g.props.remove(id), undo: () => g.props.add(p.asset, pose, id, links) });
      g.propsChanged();
      return;
    }
    const building = p.building;
    const land = g.landscape;
    const slots = townSlots(land, building);
    let putBack = () => {};
    const doIt = () => {
      putBack = releaseBuilding(land, building);
      g.props.remove(id);
    };
    doIt();
    g.editLand(slots);
    g.propsChanged();
    this.editor().recordLand({
      do: doIt,
      undo: () => {
        putBack();
        g.props.add(p.asset, pose, id, links);
      },
      slots: () => slots,
    });
  }

  /** Move a town building's prop: it leaves its squares (they become street) and is an ordinary prop from now on. */
  private moveTownProp(id: number, building: number, pose: PropPose, from: PropPose): void {
    const g = this.game;
    const land = g.landscape;
    const p = g.props.get(id)!;
    const links = { building: p.building, town: p.town, variant: p.variant };
    const changed = townSlots(land, building);
    let putBack = () => {};
    const doIt = () => {
      putBack = releaseBuilding(land, building);
      g.props.setLinks(id, { variant: p.variant });
      g.props.move(id, pose);
    };
    doIt();
    g.editLand(changed);
    this.editor().recordLand({
      do: doIt,
      undo: () => {
        putBack();
        g.props.setLinks(id, links);
        g.props.move(id, from);
      },
      slots: () => changed,
    });
  }

  /** Is a road piece close enough to pick up? (As for props: big enough on screen to take hold of.) */
  private roadWithinReach(cell: number): boolean {
    const g = this.game;
    const grid = g.landscape.grid;
    const distance = Math.hypot(grid.centreX(grid.colOf(cell)) - g.camera.position.x, g.camera.position.y, grid.centreZ(grid.rowOf(cell)) - g.camera.position.z);
    const pxPerMm = g.canvas.clientHeight / (2 * distance * Math.tan((g.camera.fov * Math.PI) / 360));
    return GRAB_PIECE_MM * pxPerMm >= GRAB_MIN_PX;
  }

  /** Is a prop close enough to pick up? (As for track: big enough on screen to take hold of.) */
  private propWithinReach(propId: number): boolean {
    const g = this.game;
    const p = g.props.get(propId);
    if (!p) return false;
    const distance = Math.hypot(p.x - g.camera.position.x, p.y - g.camera.position.y, p.z - g.camera.position.z);
    const pxPerMm = g.canvas.clientHeight / (2 * distance * Math.tan((g.camera.fov * Math.PI) / 360));
    return GRAB_PIECE_MM * pxPerMm >= GRAB_MIN_PX;
  }

  // ---- helpers ----------------------------------------------------------------------------------------------

  private lastPointerWasTouch = false;

  /** For touch drags: the ground point a little above the finger on screen. */
  private touchLift(x: number, y: number): Vector3 | null {
    return this.groundAt(x, y - TOUCH_LIFT_PX);
  }

  /** Where the pointer's ray meets the level plane at `height` (mm). */
  private planeAt(x: number, y: number, height: number): Vector3 | null {
    this.setNdc(x, y);
    this.level.constant = -height;
    return this.raycaster.ray.intersectPlane(this.level, new Vector3());
  }

  private setNdc(x: number, y: number): void {
    const r = this.game.canvas.getBoundingClientRect();
    this.ndc.set(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1);
    this.raycaster.setFromCamera(this.ndc, this.game.camera);
  }

  groundAt(x: number, y: number): Vector3 | null {
    this.setNdc(x, y);
    const p = new Vector3();
    return this.raycaster.ray.intersectPlane(this.floor, p);
  }

  private pick(x: number, y: number): Press | null {
    this.setNdc(x, y);
    const g = this.game;
    const hits = this.raycaster.intersectObjects([g.trainView.group, g.trackView.group, g.depotView.group, g.propsView.group], true);
    for (const h of hits) {
      const slot = g.depotView.cargoAt(h.object, h.instanceId);
      if (slot) {
        const cargo = slot.kind === "pile" ? slot.cargo : g.economy.cargoOf(slot.carId).kind;
        if (cargo) return { kind: "cargo", slot, cargo };
      }
      if (g.depotView.isDepotPart(h.object)) {
        const depotId = g.depotView.depotNear(h.point.x, h.point.z);
        if (depotId !== -1) return { kind: "depot", depotId };
        continue;
      }
      const carId = g.trainView.carAt(h.object as Object3D);
      if (carId !== -1) return { kind: "car", carId };
      if (h.object.userData.kind === "switch-lever") return { kind: "lever", pieceId: h.object.userData.pieceId as number };
      const propId = g.propsView.propAt(h.object, h.batchId);
      if (propId !== -1) return { kind: "prop", propId };
      const pieceId = g.trackView.pieceAt(h.object, h.instanceId);
      if (pieceId !== -1) return { kind: "piece", pieceId };
    }
    // Nothing standing there: a road piece the player laid, on the square under the pointer.
    const cell = this.squareAt(x, y);
    if (this.roads.pickable(cell)) return { kind: "road", cell };
    return null;
  }

  /** Snap capture in mm: about 28 screen pixels at the pointer, never less than the physical 30 mm. */
  private captureRadius(x: number, y: number): number {
    const a = this.groundAt(x, y);
    const b = this.groundAt(x + 28, y);
    if (!a || !b) return SNAP_CAPTURE_RADIUS;
    return Math.min(120, Math.max(SNAP_CAPTURE_RADIUS, a.distanceTo(b)));
  }

  /** Heading (plan) pointing away from the camera, used for new pieces and trains. */
  private cameraHeading(): number {
    const d = new Vector3();
    this.game.camera.getWorldDirection(d);
    return Math.round(Math.atan2(d.z, d.x) / (Math.PI / 4)) * (Math.PI / 4);
  }

  private readonly touches = new Set<number>();

  /** Track touch pointers (for multi-touch) and whether the latest pointer is touch (for the lifted drag offset). */
  notePointer(e: PointerEvent): void {
    this.lastPointerWasTouch = e.pointerType === "touch";
    if (e.pointerType === "touch") this.touches.add(e.pointerId);
  }

  /** Undo, finishing any piece animation first so the change shows at once. */
  undo(): void {
    if (this.busy) return;
    this.game.flourishes.clear();
    this.arm(null);
    this.editor().undo();
  }

  redo(): void {
    if (this.busy) return;
    this.game.flourishes.clear();
    this.arm(null);
    this.editor().redo();
  }

  /** True while a press or drag is in progress (undo/redo must wait). */
  get busy(): boolean {
    return this.mode.kind !== "idle";
  }
}

/** The plots a town building's squares are in (to redraw when it leaves them). */
function townSlots(land: Landscape, building: number): number[] {
  return [...new Set((findBuilding(land, building)?.building.cells ?? []).map(plotSlotOf))];
}

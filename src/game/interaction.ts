import { Euler, Group, Matrix4, MOUSE, Plane, Raycaster, Vector2, Vector3, Mesh, type Object3D, type TOUCH } from "three";
import { Editor, pieceCentre, poseCentre, poseForCentre, type Placement, type RiserAt } from "../editor/editor";
import { buildCarModel, carVariant, disposeObject } from "../render/train-models";
import { dustPuff } from "../render/dust";
import { settle, shrinkAway, turn, wobbleBack, type Flourish, type PiecePose } from "../render/flourishes";
import { setRim } from "../render/materials";
import { endBoardModel, ghostMesh, pieceGeometry, pieceMatrix, type OutlineTone } from "../render/track-view";
import { damp } from "../lib/tween";
import { ADV_OK, advanceCursor, CAR_SPECS, COUPLER_GAP, createAdvance, createWorldSample, cursorWorld, nearestCursor, type CarKind, type CarLook, type Cursor } from "../sim";
import { BLOCK_MESSAGES, hillMessage, levelsAbove, bridgeLevels, CELL, MAX_HEIGHT, hillsOf, nearestCrossing, STYLE_REACH, type Landscape, cutUndermines, checkPlacement, checkSupport, looseHeight, riserStackAt, type BlockReason } from "../landscape";
import { connectorRef, gapFill, kitOf, Layout, findLowCrossing, findSnapAhead, flipSwapsEnds, solveParentPose, findOverlap, findSnap, findSnapAtPoint, findSplice, normalizeAngle, straightLength, TRACK_WIDTH, type Ignore, pieceOfRef, type WorldConnector, fitAutoStraight, canStandOnArches, getPieceDef, isBridge, RISER_HEIGHT, SNAP_CAPTURE_RADIUS, type PieceTypeId, type PlacedPiece, type Pose, type SnapResult } from "../track";
import type { Hud, TrayItem } from "../ui/hud";
import { trayKey } from "../ui/tray-catalogue";
import { checkProp, pieceHitsProp, propsInRect, PROP_MESSAGES, standsAside, TrackIndex, type Footprint, type PropBlock } from "../props/placement";
import { buildingCells, findBuilding, releaseBuilding } from "../props/towns";
import { LAND_MESSAGES, LandEditor, moveScenery, plotSlotOf, removeScenery, restore, sceneryAt, sceneryCells, snapshot, type LandBlock, type Scenery } from "../landscape/edit";
import { placeOn } from "../props/kinds";
import type { PropPose } from "../props/store";
import { FootprintOutline } from "../render/props/outline";
import { modelKey } from "../render/props/library";
import { isDoubleTap, type TapRecord } from "./camera-director";
import { dropOutcome, heldReason } from "./drop";
import type { Game } from "./game";
import { DEPOT_NAMES, INDUSTRY_ROLE } from "./world";
import { LEVER_PROPS, leversNear, pointsWay, signalRoadAt } from "./lineside";
import { checkYard, flipHint, footprintInYards, hasFootprint, townMessage, inYardMessage, isYardBlock, placedYard, trackInYards, yardMessage, type PlacedYard, type YardBlock } from "./depot-footprint";
import { RoadHand, type RoadDrag } from "./road-hand";
import { DrawHand } from "./draw-hand";
import { warmDrawing } from "../track/draw-path";
import { dragMoves } from "./drag-rule";
import { decideHold, HOLD_MS, HOLD_SLOP, holdPicksUp, undoesHold } from "./touch-hold";
import { hintSeen, markHintSeen } from "../ui/prefs";
import { cargoDropTarget } from "./cargo-drop";
import { capAt, CARGO, GOODS_ICON, pilesOf, RECIPES, type CargoKind, type CargoSlot } from "../economy";
import { carNearTap, nearCarWins, type CarOnScreen } from "./touch-pick";

/** Where a piece at `pose` looks to be: the middle of its drawn shape (as `pieceMatrix` places it). */
function visualCentre(type: PieceTypeId, flipped: boolean, pose: Pose): { x: number; z: number } {
  const g = pieceGeometry(type, flipped);
  if (!g.boundingBox) g.computeBoundingBox();
  const b = g.boundingBox!;
  const lx = (b.min.x + b.max.x) / 2;
  const lz = (b.min.z + b.max.z) / 2;
  const c = Math.cos(pose.heading);
  const s = Math.sin(pose.heading);
  return { x: pose.x + lx * c - lz * s, z: pose.z + lx * s + lz * c };
}

/**
 * On touch, held things float this far (px) straight above the finger so it doesn't hide them: the held thing's centre,
 * the same for every piece and every zoom (QA I5: with the grab point kept, it floated 30–90 px off, by piece and zoom,
 * and every snap took corrections). About a fingertip's height: just clear of the nail.
 */
const TOUCH_LIFT_PX = 56;
/** A tap on touch takes a car this near it on screen (half a 44 px target): cars are small at the default zoom. */
const TOUCH_SLACK_PX = 22;
/** About the middle of a car's body above the rails (mm): where a finger aims at it. */
const CAR_BODY_MID_MM = 14;
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
/** A finger's tap on the ground may move this far (px) and still be a tap. */
const TOUCH_TAP_SLOP = 10;
/** A press on the ground let go within this (ms) is a tap (a long one counts: a slow phone delays the lift). */
const FLOOR_TAP_MS = 1200;
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

/**
 * Why a piece can't go somewhere: the track's own reasons, a mode's rule ("site", with its own message), a depot
 * held over a line where it can't take a straight's place ("splice-fit": no straight there its length; "splice-busy":
 * a train on it; "splice-onto": over other track, not a straight), or no room for a depot's yard beside its track
 * (`YardBlock`: something on the ground there, a hill, or water), or track run into a player's depot's yard ("in-yard").
 */
type PlaceBlock = BlockReason | YardBlock | "in-yard" | "site" | "splice-fit" | "splice-busy" | "splice-onto";

/** A crossing prop dropped this near a level crossing's middle (mm) goes onto it (see `styleCrossings`). */
const CROSSING_DROP_REACH = 2 * STYLE_REACH;

const SPLICE_MESSAGES = {
  "splice-fit": "Drop it onto a long straight",
  "splice-busy": "A train is on that straight",
  "splice-onto": "Drop it onto a straight",
} as const;

type Press =
  | { kind: "car"; carId: number }
  /** A switch's lever or a signal (`road`: which of a signal piece's signals, a gantry's road; else 0). */
  | { kind: "lever"; pieceId: number; road?: number }
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
  | {
      kind: "press";
      press: Press;
      pointerId: number;
      pointerType: string;
      x: number;
      y: number;
      ground: Vector3;
      add: boolean;
      /** Drawing, on something near a free end: a drag draws from that end, a tap is a tap on what's there. */
      draws?: boolean;
      /** On touch, a press on something not selected that a long press would pick up (see touch-hold.ts). */
      hold?: {
        timer: number;
        /** The press's timestamp (the events' clock): the hold is decided by when things happened. */
        t: number;
        /** When (ms after `t`) the finger first went past the slop, or null. */
        strayedAt: number | null;
        /** A train held: it's picked up only once the finger moves (let go, and it's just selected, still running). */
        armed?: boolean;
      };
    }
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
      /** Seated where it can't go, but turned or flipped it would: says so ("Turn it to fit"), not why it can't. */
      hint?: string | null;
      /** The auto straight meets an end two pieces off: the gap this one leaves (shown amber, its far end marked). */
      gap?: number;
      from: { pose: Pose; y: number } | null;
      offset: { x: number; z: number };
      ghost: Mesh;
      snap: SnapResult;
      pose: Pose;
      /** Base height for a loose (unsnapped) drop: high enough to rest on what's under its ends. */
      looseY: number;
      /** A depot held over a line: the straights it would take the place of (it's snapped where they are), or null. */
      covers: readonly number[] | null;
      /**
       * A depot picked up from inline (joined at both ends to plain track): the ends it was joined to, from its first
       * end's to its second's, so straights can close the gap it leaves when it goes elsewhere. Else null or absent.
       */
      leaves?: readonly [number, number] | null;
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
        // A depot can't mirror: Flip turns it right round instead, so its building is on the other side of the line.
        heading: this.cameraHeading() + (this.trayTurns * Math.PI) / 4 + (this.trayFlipped && this.splices(item.type) ? Math.PI : 0),
        pieceId: -1,
        tray: item,
        auto: item.auto,
        from: null,
        offset: { x: 0, z: 0 },
        ghost,
        snap: { kind: "none" },
        pose: { x: 0, z: 0, heading: 0 },
        looseY: 0,
        covers: null,
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
      // The first stroke shouldn't be the one the drawing code is compiled on (see `warmDrawing`): when idle, once.
      const idle = (globalThis as { requestIdleCallback?: (f: () => void) => number }).requestIdleCallback ?? ((f: () => void) => setTimeout(f, 50));
      idle(() => warmDrawing());
      this.arm(null);
      this.clearSelection();
      this.hud.hideCards();
      if (!this.drawHinted) {
        this.drawHinted = true;
        this.hud.toast("Draw from a track end · two fingers to pan", false, 3600);
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
    if (this.isArmed(item)) this.arm(null);
  }

  /** Is this tray item the ready piece (waiting to be added with a tap)? */
  isArmed(item: TrayItem): boolean {
    return this.armed !== null && trayKey(this.armed) === trayKey(item);
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
    // The ready piece comes out of the toy box like one taken from the tray (Game mode: owned, or made on the spot).
    if (this.trayAllowed && !this.trayAllowed(item)) return false;
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

  /** May this tray item come out now (Game mode: in the toy box, or made on the spot)? Null: always. */
  trayAllowed: ((item: TrayItem) => boolean) | null = null;
  /** Is there another of this tray item to put down (Game mode: in the toy box, not made on the spot)? Null: always. */
  trayHas: ((item: TrayItem) => boolean) | null = null;
  /** A train taken from the tray was put down: on the track (`placed`), or not (off it, or back over the tray). */
  onTrayTrainDropped: ((placed: boolean) => void) | null = null;

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
    const holding = this.mode.kind === "drag-piece";
    if (holding) this.rotateSelected();
    if (this.mode.kind === "drag-road") this.roads.turnHeld(this.mode.drag);
    else if (this.roadReady) this.roads.turnHeld(this.roadReady.drag);
    const was = this.cameraHeading() + (this.trayTurns * Math.PI) / 4;
    this.trayTurns = (this.trayTurns + 1) % 8;
    // Nothing in hand: the next piece shows for a moment, turning, so you see which way it'll come out.
    if (!holding && !this.roadReady && this.mode.kind !== "drag-road") this.showNextPiece(was);
    this.onTurned?.();
  }

  /** The next piece shown turning (Turn pressed with nothing in hand), and how long it has left. */
  private nextShown: { mesh: Mesh; heading: number } | null = null;

  /**
   * Show the piece the tray will give next (the ready one, else a long straight) floating in the middle of the view,
   * turning from `from` to the way it'll come out now (mirrored as it'll come out), for a second, then away.
   */
  private showNextPiece(from: number): void {
    const g = this.game;
    const r = g.canvas.getBoundingClientRect();
    const ground = this.groundAt(r.left + r.width / 2, r.top + r.height * 0.42);
    if (!ground) return;
    const item = this.armed?.kind === "piece" ? this.armed : null;
    const type: PieceTypeId = item && !item.auto ? item.type : "straight-216";
    const flipped = this.trayFlipped && getPieceDef(type, false).flippable;
    const to = this.cameraHeading() + (this.trayTurns * Math.PI) / 4;
    const old = this.nextShown;
    if (old) {
      from = old.heading;
      this.dropHeld(old.mesh);
    }
    const mesh = this.heldMesh(type, flipped);
    g.scene.add(mesh);
    const shown = { mesh, heading: to };
    this.nextShown = shown;
    // Its middle over the spot, as it's turned.
    const at = (heading: number): PiecePose => {
      const p = poseForCentre(type, flipped, ground.x, ground.z, heading);
      return { x: p.x, y: ground.y + HOLD_LIFT * 3, z: p.z, heading };
    };
    let held = 0;
    g.flourishes.add(
      turn(mesh, at(from), at(to), () => {
        if (this.nextShown !== shown) return;
        // A moment to see it, then away.
        g.flourishes.add({
          update: (dt) => (held += dt) < 1,
          dispose: () => {
            if (this.nextShown !== shown) return;
            g.flourishes.add(
              shrinkAway(mesh, () => {
                this.dropHeld(mesh);
                if (this.nextShown === shown) this.nextShown = null;
              }),
            );
          },
        });
      }),
    );
    g.invalidate();
  }

  /** Tray "Flip": mirrors the piece in hand (if any) and every piece taken out after it. */
  flipTrayPiece(): void {
    const holding = this.mode.kind === "drag-piece";
    if (holding) this.flipSelected();
    this.trayFlipped = !this.trayFlipped;
    // Nothing in hand: the next piece shows for a moment, mirrored as it'll come out.
    if (!holding && !this.roadReady && this.mode.kind !== "drag-road") this.showNextPiece(this.nextShown?.heading ?? this.cameraHeading() + (this.trayTurns * Math.PI) / 4);
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
    let drawsFromEnd = false;
    if (this.drawing && this.touches.size <= 1) {
      const atEnd = this.draw.nearFreeEnd(e.clientX, e.clientY);
      const over = this.pick(e.clientX, e.clientY, e.pointerType === "touch");
      // Near a free end but on something (a car, the line's last piece): a press there, as ever, unless it moves
      // (then it draws from the end: see the press's `draws`).
      if (atEnd && over) drawsFromEnd = true;
      else if ((atEnd || !over) && this.draw.begin(e.clientX, e.clientY)) {
        this.game.controls.enabled = false;
        this.mode = { kind: "draw-track", pointerId: e.pointerId };
        // On the ground, a tap (no line drawn) still does what a tap there does: deselect, or a double tap focuses.
        if (!atEnd) {
          this.hud.hideCards();
          this.clearSelection();
          this.floorDown = { id: e.pointerId, x: e.clientX, y: e.clientY, t: e.timeStamp };
        }
        return;
      }
    }
    let hit = this.pick(e.clientX, e.clientY, e.pointerType === "touch");
    // Pressing on anything else puts the ready piece away.
    if (hit && this.armed) this.arm(null);
    // Track can only be picked up from close by, so a pan over a zoomed-out map never drags a piece away.
    // (While picking several, any track in view can be tapped.)
    if (hit?.kind === "piece" && !this.picking && !this.withinReach(hit.pieceId)) hit = null;
    if (hit?.kind === "prop" && (!this.propsEditable || !this.propWithinReach(hit.propId))) hit = null;
    if (hit?.kind === "road" && !this.roadWithinReach(hit.cell)) hit = null;
    const ground = this.groundAt(e.clientX, e.clientY) ?? new Vector3();
    // By a free end, on nothing that can be taken hold of from here after all: it draws straight away.
    if (!hit && drawsFromEnd && this.draw.begin(e.clientX, e.clientY)) {
      this.game.controls.enabled = false;
      this.mode = { kind: "draw-track", pointerId: e.pointerId };
      return;
    }
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
    const press: Extract<Mode, { kind: "press" }> = { kind: "press", press: hit, pointerId: e.pointerId, pointerType: e.pointerType, x: e.clientX, y: e.clientY, ground, add: e.shiftKey, draws: drawsFromEnd };
    this.mode = press;
    this.armHold(press, e.timeStamp);
  }

  /**
   * Does a drag that starts on `press` move it, rather than pan the view (see `dragMoves`: on touch, only what's
   * selected)? Picking several, only a picked piece moves. Cargo is fetched from its pile with a drag either way.
   */
  private dragsWhatsPressed(press: Press, pointerType: string): boolean {
    switch (press.kind) {
      case "piece":
        if (this.picking) return this.picked.has(press.pieceId);
        return dragMoves("piece", press.pieceId === this.selectedPiece, pointerType);
      case "car":
        return dragMoves("car", this.selectedCar !== -1 && this.game.sim.findCar(press.carId)?.train === this.game.sim.findCar(this.selectedCar)?.train, pointerType);
      case "depot":
        return dragMoves("depot", press.depotId === this.selectedDepot, pointerType);
      case "prop":
        return dragMoves("prop", press.propId === this.selectedProp, pointerType);
      case "road":
        return dragMoves("road", press.cell === this.roads.selected, pointerType);
      default:
        return true;
    }
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
    if (this.vetoHold(e)) return;
    if (m.kind === "draw-track") {
      this.updateDraw(e.clientX, e.clientY);
      return;
    }
    const still = this.heldStill;
    if (still && still.pointerId === e.pointerId && Math.hypot(e.clientX - still.x, e.clientY - still.y) >= HOLD_SLOP) this.heldStill = null;
    if (m.kind === "press") {
      const travel = Math.hypot(e.clientX - m.x, e.clientY - m.y);
      if (m.hold) {
        // Waiting to see if it's a hold: by the moves' own times (a slow phone delivers them late), each one since the
        // last (the browser may have run several into this event).
        const h = m.hold;
        let at = e.timeStamp - h.t;
        for (const c of coalesced(e)) {
          at = c.timeStamp - h.t;
          if (h.strayedAt === null && Math.hypot(c.clientX - m.x, c.clientY - m.y) >= HOLD_SLOP) h.strayedAt = at;
        }
        const outcome = decideHold(h.strayedAt, at, this.touches.size);
        // Still waiting, or held and not moved yet (the timer's frame picks it up; a held train waits for a move).
        if (outcome === "wait" || (outcome === "hold" && h.strayedAt === null)) return;
        clearTimeout(h.timer);
        m.hold = undefined;
        if (outcome === "hold") {
          // Rested long enough before it moved (the timer ran late, or a held train starts moving): picked up now.
          if (!h.armed) this.holdCue();
          if (!this.startDrag(m)) return;
          this.updateDrag(e.clientX, e.clientY);
          return;
        }
      } else if (travel < DRAG_THRESHOLD) return;
      // Drawing, and it moved: a line from the free end it started by, not a drag of what's there.
      if (m.draws && this.drawing && this.draw.begin(m.x, m.y)) {
        this.game.controls.enabled = false;
        this.mode = { kind: "draw-track", pointerId: m.pointerId };
        this.updateDraw(e.clientX, e.clientY);
        return;
      }
      if (!this.dragsWhatsPressed(m.press, m.pointerType)) {
        // Select first: a drag that starts on anything placed that isn't selected (a piece, a train, an industry, a
        // prop, a road) pans the view, like the floor, so panning over a busy map never moves something by accident.
        // Tap it to select it, then drag it (or, on touch, rest a finger on it: see armHold). The camera picks the
        // gesture up from here.
        this.mode = { kind: "idle" };
        this.game.controls.enabled = true;
        return;
      }
      if (!this.startDrag(m)) return;
    }
    this.updateDrag(e.clientX, e.clientY);
  }

  /**
   * A press becomes a drag of what's pressed (a piece, the industry, a train, cargo, a prop, a road). False, and back to
   * idle with the camera free, if what's pressed doesn't move (a station, a lever, a road that won't come up).
   */
  private startDrag(m: Extract<Mode, { kind: "press" }>): boolean {
    const idle = () => {
      this.mode = { kind: "idle" };
      this.game.controls.enabled = true;
      return false;
    };
    // Stations and depots are part of the map and stay put.
    if (m.press.kind === "piece" && this.fixedLabel(m.press.pieceId)) return idle();
    if (m.press.kind === "piece" && this.picking) {
      // Picking: a drag on a picked piece moves them all; anywhere else it pans (so a pan never breaks the group).
      if (!this.picked.has(m.press.pieceId)) return idle();
      this.beginGroupMove(m.press.pieceId, m.pointerId, m.x, m.y);
    } else if (m.press.kind === "piece") this.beginPieceMove(m.press.pieceId, m.pointerId, m.ground);
    else if (m.press.kind === "depot" && this.movableIndustry(m.press.depotId) !== -1) this.beginPieceMove(this.movableIndustry(m.press.depotId), m.pointerId, m.ground);
    else if (m.press.kind === "cargo") this.beginCargoDrag(m.press.slot, m.press.cargo, m.pointerId);
    else if (m.press.kind === "prop") this.beginPropMove(m.press.propId, m.pointerId, m.ground);
    else if (m.press.kind === "road") {
      const drag = this.roads.pickUp(m.press.cell);
      if (!drag) return idle();
      this.mode = { kind: "drag-road", pointerId: m.pointerId, drag, overTray: false };
      this.onPickup?.();
    } else if (m.press.kind === "car") {
      this.beginTrainPickup(m.press.carId, m.pointerId);
      if (this.mode.kind === "idle") return false;
    } else return idle();
    return true;
  }

  /**
   * On touch, a press on something that isn't selected but a long press would pick up: wait to see whether the finger
   * rests (a hold) or moves (a pan). The cue that it's been picked up is the thing lifting under the finger, and a short
   * buzz where the phone has one.
   */
  private armHold(m: Extract<Mode, { kind: "press" }>, t: number): void {
    const target = m.press.kind === "piece" ? "piece" : m.press.kind === "car" ? "car" : m.press.kind === "depot" ? "depot" : null;
    if (!target || !holdPicksUp(target, m.pointerType) || this.dragsWhatsPressed(m.press, m.pointerType)) return;
    // Drawing is its own tool: a finger resting there neither picks anything up nor starts a line (Rail and road's).
    if (this.drawing) return;
    if (m.press.kind === "piece" && (this.picking || this.fixedLabel(m.press.pieceId))) return;
    if (m.press.kind === "depot" && this.movableIndustry(m.press.depotId) === -1) return;
    m.hold = { timer: window.setTimeout(() => this.holdFired(m), HOLD_MS), t, strayedAt: null };
  }

  /** The hold's buzz a frame on, if `still()` says the pickup still stands then. */
  private holdCueIf(still: () => boolean): void {
    requestAnimationFrame(() => {
      if (still()) this.holdCue();
    });
  }

  /** The cue that something's been taken hold of: a short buzz where the phone has one (the lift is the rest). */
  private holdCue(): void {
    try {
      navigator.vibrate?.(15);
    } catch {
      // (Some browsers refuse it without a gesture of their own: the lift is cue enough.)
    }
  }

  /** Picked up with a hold and not moved since: letting go puts it back as it was (and selects it, as a tap would). */
  private heldStill: { pointerId: number; x: number; y: number; press: Press } | null = null;

  /**
   * The hold's time is up. Not decided here and now: moves the browser has queued (a slow phone) are seen first, a
   * frame on, and they say whether the finger had already strayed (a pan) before the time was up.
   */
  private holdFired(m: Extract<Mode, { kind: "press" }>): void {
    requestAnimationFrame(() => {
      const h = m.hold;
      if (this.mode !== m || !h || h.armed) return;
      const outcome = decideHold(h.strayedAt, performance.now() - h.t, this.touches.size);
      if (outcome !== "hold") return;
      // A train is picked up once the finger moves: let go here and it's selected, still running, as it was.
      if (m.press.kind === "car") {
        h.armed = true;
        this.holdCueIf(() => this.mode === m && !!m.hold?.armed);
        return;
      }
      m.hold = undefined;
      if (!this.startDrag(m)) return;
      this.heldStill = { pointerId: m.pointerId, x: m.x, y: m.y, press: m.press };
      this.heldUnsure = { pointerId: m.pointerId, x: m.x, y: m.y, t: h.t };
      this.updateDrag(m.x, m.y);
      // (The buzz waits a frame: moves a slow phone delivers late may yet undo the pickup, and it shouldn't buzz then.)
      const drag = this.mode;
      this.holdCueIf(() => this.mode === drag);
    });
  }

  /**
   * Picked up by the hold's timer, before any move had been seen: a slow phone may deliver the moves of a pan only now.
   * If the first moves to come say the finger had strayed before the hold's time was up, it was a pan: put it back.
   * Settled (null) by the first move from after that time.
   */
  private heldUnsure: { pointerId: number; x: number; y: number; t: number } | null = null;

  /** True if the late moves undid a pickup that was really a pan (the view takes the gesture from here). */
  private vetoHold(e: PointerEvent): boolean {
    const u = this.heldUnsure;
    if (!u || u.pointerId !== e.pointerId) return false;
    for (const c of coalesced(e)) {
      const at = c.timeStamp - u.t;
      if (at >= HOLD_MS) break;
      if (undoesHold(at, Math.hypot(c.clientX - u.x, c.clientY - u.y), false)) {
        this.heldUnsure = null;
        this.heldStill = null;
        this.cancel();
        return true;
      }
    }
    if (e.timeStamp - u.t >= HOLD_MS) this.heldUnsure = null;
    return false;
  }

  private onUp(e: PointerEvent): void {
    const f = this.floorDown;
    if (f && f.id === e.pointerId) {
      this.floorDown = null;
      // A tap is a press that stays put (a finger wobbles more than a mouse), let go within FLOOR_TAP_MS: a slow phone,
      // or a careful child, takes its time.
      const still = Math.hypot(e.clientX - f.x, e.clientY - f.y) < (e.pointerType === "mouse" ? DRAG_THRESHOLD : TOUCH_TAP_SLOP);
      if (still && e.timeStamp - f.t < FLOOR_TAP_MS && this.touches.size <= 1) {
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
    const still = this.heldStill;
    const unsure = this.heldUnsure;
    this.heldStill = null;
    this.heldUnsure = null;
    if (still && unsure && unsure.pointerId === e.pointerId && undoesHold(e.timeStamp - unsure.t, 0, true) && m.kind !== "press") {
      // Picked up by the timer, but the finger was lifted before the hold's time (its lift delivered late): a tap.
      this.cancel();
      this.tap(still.press);
      return;
    }
    if (still && still.pointerId === e.pointerId && m.kind !== "press") {
      // Held and let go without moving: back where it was (a drop would snap it to the nearest free end), and selected.
      this.cancel();
      this.tap(still.press);
      return;
    }
    if (m.kind === "press") {
      if (m.hold) clearTimeout(m.hold.timer);
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
    this.hud.setRefusal(null);
    const m = this.mode;
    if (m.kind === "press" && m.hold) clearTimeout(m.hold.timer);
    this.heldStill = null;
    this.heldUnsure = null;
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
      else this.onTrayTrainDropped?.(false);
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
    // The bottom edge is the chips above the tray (Draw), not the tray: a line pulled down that far pans the view on
    // rather than ending hidden under the chips and the finger.
    const chipsTop = this.hud.chipsTop() - r.top;
    // A line started near the screen's edge doesn't pan the view until the finger has been clear of the edge once. The
    // edge band is narrower than for a held piece (a phone is narrow, and a line wants room to bend).
    this.game.director.setEdgePointer({ x: x - r.left, y: y - r.top, touch: this.lastPointerWasTouch, bottom: chipsTop, waitForExit: true, zone: this.lastPointerWasTouch ? 36 : 40 });
    this.draw.move(x, y);
  }

  // ---- taps -------------------------------------------------------------------------------------------------

  private tap(p: Press, add = false): void {
    const g = this.game;
    if (p.kind === "lever") {
      this.throwLever(p.pieceId, p.road);
      return;
    }
    if (p.kind === "piece") {
      const depot = g.economy.depotAtPiece(p.pieceId);
      // (A cargo kit's depot, Sandbox's loaders and unloaders, has nothing to set: its piece is picked, as any kit's.)
      const kitDepot = !!depot && !!kitOf(g.layout.getPiece(p.pieceId)!.type);
      if (depot && !kitDepot) this.openDepot(depot.id);
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
    // A first tap on any car takes the whole train (its engine's card); once it's taken, a tap on one of its cars
    // opens that car's own card. A train with no engine (wagons left standing) opens the car's card at once.
    const taken = this.selectedCar !== -1 && g.sim.findCar(this.selectedCar)?.train === found.train;
    const engine = found.train.cars.find((c) => c.kind === "engine");
    const car = !taken && engine ? engine : found.train.cars[found.index];
    this.clearSelection();
    this.selectedCar = car.id;
    g.trainView.setSelected(car.id);
    g.invalidate();
    if (car.kind === "engine") this.hud.showEngineCard(car.lever, g.following === car.id);
    else this.hud.showCarCard();
    // (The car tapped, kept in view: its engine's card may be what opens.)
    const tapped = found.train.cars[found.index].id;
    this.keepClearOfCard(() => g.trainView.carObject(tapped)?.getWorldPosition(new Vector3()) ?? null);
    this.hintDrag();
  }

  private selectPiece(id: number): void {
    this.clearSelection();
    this.selectedPiece = id;
    this.game.trackView.setHighlight(id);
    const p = this.game.layout.getPiece(id)!;
    this.hud.showPieceCard(getPieceDef(p.type, false).flippable, "Track piece", true, true, true);
    this.keepClearOfCard(() => this.pieceCentre(id));
    if (!this.fixedLabel(id)) this.hintDrag();
  }

  private dragHinted = hintSeen("drag-selected");

  /**
   * The first time ever (on this device) something movable is selected: it moves with a drag now (and on touch only
   * now: see `dragsWhatsPressed`). Not while drawing: a drag draws then (it's said the next time, with drawing off).
   */
  private hintDrag(): void {
    if (this.dragHinted || this.drawing) return;
    this.dragHinted = true;
    markHintSeen("drag-selected");
    this.hud.toast("Drag to move · drag elsewhere to look", false, 3600);
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
    if (this.selectedCar !== -1) {
      this.game.trainView.setSelected(-1);
      this.game.invalidate();
    }
    this.selectedCar = -1;
    this.selectedDepot = -1;
  }

  // ---- depots and cargo -------------------------------------------------------------------------------------

  /** The car whose card is open (an engine's or a wagon's), or −1. */
  get selectedCarId(): number {
    return this.selectedCar;
  }

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

  /** Counts the cards opened: a check for one that's been replaced since does nothing. */
  private cardNudge = 0;

  /** A piece's middle as it looks (not its pose, which is one of its ends: QA), at its height, or null if it's gone. */
  private pieceCentre(id: number): Vector3 | null {
    const p = this.game.layout.getPiece(id);
    if (!p) return null;
    const c = visualCentre(p.type, p.flipped, p.pose);
    return new Vector3(c.x, p.y, c.z);
  }

  /**
   * A card just opened over the thing it's for (on a phone a card covers much of the map, and the thing tapped is often
   * in the middle of it): glide the view just enough that `at` sits in the open map, above the card (or to its left, on
   * a phone on its side, where cards dock at the right). As the card settles, not per frame; nothing if it's clear
   * already, the camera is busy or following a train.
   */
  private keepClearOfCard(at: () => Vector3 | null): void {
    const token = ++this.cardNudge;
    const check = () => {
      const g = this.game;
      // (Not for a card opened since, nor under a finger that's moving the view.)
      if (token !== this.cardNudge || this.mode.kind !== "idle") return;
      const card = this.hud.openCardRect();
      const p = at();
      if (!card || !p || g.following !== -1 || g.director.busy) return;
      const r = g.canvas.getBoundingClientRect();
      const v = p.clone().project(g.camera);
      const sx = r.left + ((v.x + 1) / 2) * r.width;
      const sy = r.top + ((1 - v.y) / 2) * r.height;
      const pad = 28;
      if (sx < card.left - pad || sx > card.right + pad || sy < card.top - pad || sy > card.bottom + pad) return;
      // Docked at the right: to the middle of the room on its left. Otherwise between the top bar (and goals) and it.
      const side = card.left >= 200;
      const top = r.top + 124;
      if (!side && card.top - top < 80) return;
      // Where the screen points fall at the thing's own height (it may stand on a hill).
      const level = new Plane(new Vector3(0, 1, 0), -p.y);
      const onLevel = (x: number, y: number) => {
        this.setNdc(x, y);
        return this.raycaster.ray.intersectPlane(level, new Vector3());
      };
      const from = onLevel(sx, sy);
      const to = onLevel(side ? card.left / 2 : sx, side ? sy : (top + card.top) / 2);
      if (!from || !to) return;
      g.director.glideTo(g.controls.target.clone().add(from.sub(to)), g.camera.position.distanceTo(g.controls.target), { duration: 0.4 });
    };
    // Once the card has settled (it grows as its rows fill in, the engine card from 140 px to 225): when its size
    // stops changing for a moment.
    let settle = 0;
    const later = () => {
      clearTimeout(settle);
      settle = window.setTimeout(check, 150);
    };
    this.hud.onCardResize = later;
    later();
  }

  private openDepot(depotId: number): void {
    this.clearSelection();
    this.selectedDepot = depotId;
    this.shownDepot.id = -1;
    this.hud.showDepotCard(this.depotTitle(depotId));
    this.refreshDepotCard();
    this.keepClearOfCard(() => this.pieceCentre(this.game.economy.depot(depotId)?.pieceId ?? -1));
    // An industry the player placed moves too (select first, as anything else).
    if (this.movableIndustry(depotId) !== -1) this.hintDrag();
  }

  /** Keep the open depot card's pile counts current (call every frame). */
  refreshDepotCard(): void {
    if (this.selectedDepot === -1 || !this.hud.depotCardOpen) return;
    const d = this.game.economy.depot(this.selectedDepot);
    if (!d) return;
    // Only redraw the card when something on it changed (this runs every frame).
    // (A harbour's dock sheds change what its piles hold: they count here too.)
    const delivered0 = d.role === "town" ? this.game.economy.delivered.get(d.townId) ?? 0 : d.sheds;
    const shown = this.shownDepot;
    // Every pile's count hashed into one number (a warehouse's or harbour's piles hold more than 15): no allocation on
    // this per-frame check.
    let pileKey = 0;
    for (let k = 0; k < d.piles.length; k++) pileKey = (Math.imul(pileKey, 0x01000193) ^ (d.piles[k] + 1)) | 0;
    if (shown.id === d.id && shown.piles === pileKey && shown.auto === d.auto && shown.wait === d.waitFull && shown.delivered === delivered0) return;
    shown.id = d.id;
    shown.piles = pileKey;
    shown.auto = d.auto;
    shown.wait = d.waitFull;
    shown.delivered = delivered0;
    let piles = pilesOf(d.role).map((kind) => ({ label: `${GOODS_ICON[kind]} ${CARGO[kind].label}`, count: d.piles[CARGO[kind].index], cap: capAt(d) }));
    // A harbour's quay takes any good: it lists only what's there.
    if (d.role === "harbour") piles = piles.filter((p) => p.count > 0);
    const delivered = d.role === "town" ? this.game.economy.delivered.get(d.townId) ?? 0 : 0;
    const note = d.role === "town" ? `Delivered ${delivered}` : d.role === "harbour" && piles.length === 0 ? "Nothing on the quay: drop goods here for the boats" : "";
    this.hud.updateDepotCard(piles, d.auto, RECIPES[d.role].gives.length > 0 ? d.waitFull : null, note);
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
      this.hud.toast(m.cargo === "log" ? "Logs go on a flatbed wagon or the sawmill's log pile" : "Planks go on a flatbed wagon or a station's goods pile");
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
      // Seen at once, finger still (it snaps, or is refused, turned).
      this.updateDrag(this.lastX, this.lastY);
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
    const mesh = ghostMesh(p.type, p.flipped, [g.mats.track, g.mats.trackCut, g.mats.bridgePaint], g.bridgeLevelsOf(p), g.archFloorsOf(p));
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
  private blockedBy(type: PieceTypeId, flipped: boolean, pose: Pose, y: number, ignoreId: Ignore): BlockReason | null {
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
  private placement(type: PieceTypeId, flipped: boolean, pose: Pose, y: number, ignoreId: Ignore): { reason: PlaceBlock | null; risers: RiserAt[] } {
    const reason = this.blockedBy(type, flipped, pose, y, ignoreId);
    // A hill in the way: say how far up it is, and how to get there (only worked out when it's so).
    if (reason === "hill") this.hillWhy = hillMessage(levelsAbove(this.game.landscape, type, flipped, pose, y));
    // A depot is told it's the depot (its name, as its yard's messages say), not the track, that keeps out of town.
    if (reason === "town") this.townWhy = townMessage(type);
    if (reason) return { reason, risers: [] };
    // A depot's yard and buildings beside its track need room too; other track keeps out of a player's depot's yard.
    const yard = this.yardBlock(type, pose, y, ignoreId) ?? this.inYard(type, flipped, pose, y, ignoreId);
    if (yard) return { reason: yard, risers: [] };
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

  /**
   * Is there room beside a depot piece's track for its yard (see `checkYard`)? Null for other pieces, and for a map's
   * own depots (they stand where the map put them). While a depot is held, the last answer is kept for its pose.
   */
  private yardBlock(type: PieceTypeId, pose: Pose, y: number, ignoreId: Ignore): YardBlock | null {
    if (!hasFootprint(type)) return null;
    const own = typeof ignoreId === "number" ? ignoreId : (ignoreId.values().next().value ?? -1);
    if (own !== -1 && this.fixedLabel(own) !== null) return null;
    const g = this.game;
    const ignoreKey = typeof ignoreId === "number" ? ignoreId : [...ignoreId].join(",");
    const key = `${type}|${pose.x}|${pose.z}|${pose.heading}|${y}|${ignoreKey}|${g.layout.pieceCount}|${g.landscape.grid.revision}|${g.props.version}`;
    if (this.mode.kind === "drag-piece" && this.yardMemo?.key === key) {
      this.yardWhy = this.yardMemo.message;
      return this.yardMemo.why;
    }
    const why = checkYard({ land: g.landscape, layout: g.layout, props: g.props, footprint: g.propLibrary.footprint }, type, pose, y, ignoreId);
    if (why) this.yardWhy = yardMessage(type, why);
    this.yardMemo = this.mode.kind === "drag-piece" ? { key, why, message: this.yardWhy } : null;
    return why;
  }
  /**
   * Does a piece (not a depot: those check their own yard against others') run into a player's depot's yard? Then
   * "in-yard", saying whose. Bounding boxes first, against the few player depots.
   */
  private inYard(type: PieceTypeId, flipped: boolean, pose: Pose, y: number, ignoreId: Ignore): "in-yard" | null {
    if (INDUSTRY_ROLE[type] || hasFootprint(type)) return null;
    const yard = trackInYards(this.playerYards(), type, flipped, pose, y, ignoreId);
    if (yard) this.inYardWhy = inYardMessage(yard.type);
    return yard ? "in-yard" : null;
  }
  /** The message for the last "in-yard" refusal ("That's the workshop's yard"). */
  private inYardWhy = "";

  /**
   * The yards of the depots the player placed (not the map's own, nor one in the hand), and the ground of the kit
   * pieces on the map (also not one in the hand), with their bounding boxes: built again only when one of them is
   * placed, moved or taken up (a key of their poses: a few numbers each).
   */
  private playerYards(): readonly PlacedYard[] {
    const g = this.game;
    const layout = g.layout;
    let key = "";
    for (const d of g.economy.allDepots()) {
      const p = layout.getPiece(d.pieceId);
      if (!p || !INDUSTRY_ROLE[p.type] || layout.isLifted(d.pieceId)) continue;
      key += `${d.pieceId}:${p.pose.x}:${p.pose.z}:${p.pose.heading}:${p.y};`;
    }
    const kits = g.kitView.pieceIds();
    for (const id of kits) {
      const p = layout.getPiece(id);
      if (!p || layout.isLifted(id)) continue;
      key += `k${id}:${p.pose.x}:${p.pose.z}:${p.pose.heading}:${p.y};`;
    }
    if (this.yardsFor?.key === key) return this.yardsFor.yards;
    const fixed = new Set(g.depots.values());
    const yards: PlacedYard[] = [];
    for (const d of g.economy.allDepots()) {
      const p = layout.getPiece(d.pieceId);
      // (A kit piece that's a cargo stop has its ground with the kits, below.)
      if (!p || fixed.has(d.pieceId) || layout.isLifted(d.pieceId) || kitOf(p.type)) continue;
      const yard = placedYard(d.pieceId, p.type, p.pose, p.y);
      if (yard) yards.push(yard);
    }
    for (const id of kits) {
      const p = layout.getPiece(id);
      if (!p || layout.isLifted(id)) continue;
      const yard = placedYard(id, p.type, p.pose, p.y);
      if (yard) yards.push(yard);
    }
    this.yardsFor = { key, yards };
    return yards;
  }
  private yardsFor: { key: string; yards: PlacedYard[] } | null = null;

  /** A prop's footprint in a player's depot's yard: "yard", the message saying whose. */
  private propInYard(fp: Footprint, pose: Pick<Pose, "x" | "z" | "heading">): PropBlock | null {
    const yard = footprintInYards(this.playerYards(), fp, pose);
    if (yard) this.inYardWhy = inYardMessage(yard.type);
    return yard ? "yard" : null;
  }

  /** What to say for a prop that can't go somewhere. */
  private propMessage(reason: PropBlock): string {
    return reason === "yard" ? this.inYardWhy : PROP_MESSAGES[reason];
  }

  /** The last yard check while a depot was held, for its inputs (cleared when it's put down). */
  private yardMemo: { key: string; why: YardBlock | null; message: string } | null = null;
  /** The message for the last yard refusal ("The workshop's yard is on a hill"). */
  private yardWhy = "";

  /**
   * A depot refused for want of room for its yard: would it go turned right round (Flip), its yard on the other side
   * of the line? Worked out only while it's refused, once per spot.
   */
  private yardHint(type: PieceTypeId, flipped: boolean, pose: Pose, y: number, ignoreId: Ignore): string | null {
    const ignoreKey = typeof ignoreId === "number" ? ignoreId : [...ignoreId].join(",");
    const key = `yard|${type}|${flipped}|${pose.x}|${pose.z}|${pose.heading}|${y}|${ignoreKey}|${this.game.layout.pieceCount}`;
    if (this.hintFor?.key === key) return this.hintFor.hint;
    const memo = this.yardMemo;
    const why = this.yardWhy;
    // Turned right round on the same track (where the splice puts it held the other way), all of it checked.
    const hint = this.splices(type) ? flipHint(type, pose, (turned) => this.placement(type, flipped, turned, y, ignoreId).reason) : null;
    // (The turned-round check mustn't take the place of what's said, or remembered, for where it's held.)
    this.yardMemo = memo;
    this.yardWhy = why;
    this.hintFor = { key, hint };
    return hint;
  }

  /**
   * A piece seated on an end where it can't go: would it go there by another of its ends (turned), or the other hand
   * (flipped)? Then that's what to say, not why it can't go as it is. Kept for the seat it was worked out for (a few
   * placement checks, only while it's refused).
   */
  private fitHint(type: PieceTypeId, flipped: boolean, snap: Extract<SnapResult, { kind: "snapped" }>, pieceId: number): string | null {
    // (Seated on no end, e.g. taking straights' place: nothing to turn about.)
    if (snap.target < 0) return null;
    const key = `${type}|${flipped}|${snap.target}|${snap.connector}|${pieceId}|${this.game.layout.pieceCount}`;
    if (this.hintFor?.key === key) return this.hintFor.hint;
    const t = this.game.layout.worldConnector(snap.target, { x: 0, z: 0, heading: 0, y: 0, kind: "peg" });
    const seat = { x: t.x, z: t.z, heading: t.heading + Math.PI };
    const fits = (hand: boolean, skip: number) =>
      getPieceDef(type, hand).connectors.some((c, k) => {
        if (k === skip || Math.abs(t.y - (snap.y + c.y)) > 2) return false;
        const pose = solveParentPose(c.pose, seat, { x: 0, z: 0, heading: 0 });
        return this.placement(type, hand, pose, t.y - c.y, pieceId).reason === null;
      });
    // (A ramp's or buffer's flip only swaps its ends' peg and hole: no other shape.)
    const flippable = getPieceDef(type, false).flippable && getPieceDef(type, true) !== getPieceDef(type, false) && !flipSwapsEnds(type);
    const hint = fits(flipped, snap.connector) ? "Turn it to fit (↻\u00a0Turn)" : flippable && fits(!flipped, -1) ? "Flip it to fit (⇋\u00a0Flip)" : null;
    this.hintFor = { key, hint };
    return hint;
  }
  private hintFor: { key: string; hint: string | null } | null = null;

  /**
   * The same end, seated by another of the piece's ends, as held otherwise (not mirrored), where it can go: the one
   * turning it least from how it's held. Null if none. Worked out once per seat while it's refused.
   */
  private turnedSeat(type: PieceTypeId, flipped: boolean, snap: Extract<SnapResult, { kind: "snapped" }>, pieceId: number): Extract<SnapResult, { kind: "snapped" }> | null {
    const key = `${type}|${flipped}|${snap.target}|${snap.connector}|${pieceId}|${this.game.layout.pieceCount}`;
    if (this.turnedFor?.key === key) return this.turnedFor.seat;
    const t = this.game.layout.worldConnector(snap.target, { x: 0, z: 0, heading: 0, y: 0, kind: "peg" });
    const at = { x: t.x, z: t.z, heading: t.heading + Math.PI };
    let best: Extract<SnapResult, { kind: "snapped" }> | null = null;
    let bestTurn = Infinity;
    getPieceDef(type, flipped).connectors.forEach((c, k) => {
      if (k === snap.connector || Math.abs(t.y - (snap.y + c.y)) > 2) return;
      const pose = solveParentPose(c.pose, at, { x: 0, z: 0, heading: 0 });
      const y = t.y - c.y;
      if (this.placement(type, flipped, pose, y, pieceId).reason !== null) return;
      const turn = Math.abs(normalizeAngle(pose.heading - snap.pose.heading));
      if (turn >= bestTurn) return;
      bestTurn = turn;
      best = { ...snap, pose, y, connector: k };
    });
    this.turnedFor = { key, seat: best };
    return best;
  }
  private turnedFor: { key: string; seat: Extract<SnapResult, { kind: "snapped" }> | null } | null = null;

  /**
   * A piece held loose where it can't go: would it seat clear on an end there, turned another way (an eighth of a turn
   * at a time)? Then say "Turn it to fit". Worked out once per spot (to the nearest 12 mm) while it's refused.
   */
  private turnHint(type: PieceTypeId, flipped: boolean, pose: Pose, y: number, pieceId: number): string | null {
    const key = `loose|${type}|${flipped}|${Math.round(pose.x / 12)}|${Math.round(pose.z / 12)}|${pose.heading.toFixed(2)}|${y}|${this.game.layout.pieceCount}`;
    if (this.hintFor?.key === key) return this.hintFor.hint;
    let hint: string | null = null;
    for (let k = 1; k < 8 && !hint; k++) {
      // Turned about its middle, as Turn turns a held piece.
      const centre = poseCentre(type, flipped, pose);
      const at = poseForCentre(type, flipped, centre.x, centre.z, pose.heading + (k * Math.PI) / 4);
      const s = findSnap(this.game.layout, type, flipped, at, y, pieceId, SNAP_CAPTURE_RADIUS);
      if (s.kind === "snapped" && this.placement(type, s.flipped, s.pose, s.y, pieceId).reason === null) hint = "Turn it to fit (↻\u00a0Turn)";
    }
    this.hintFor = { key, hint };
    return hint;
  }

  private blockMessage(reason: PlaceBlock): string {
    if (reason === "hill") return this.hillWhy;
    if (reason === "town") return this.townWhy;
    if (reason === "splice-fit" || reason === "splice-busy" || reason === "splice-onto") return SPLICE_MESSAGES[reason];
    if (isYardBlock(reason)) return this.yardWhy;
    if (reason === "in-yard") return this.inYardWhy;
    return reason === "site" ? this.siteWhy : BLOCK_MESSAGES[reason];
  }

  /** The message for the last "hill" refusal (how many levels up, and how to climb it). */
  private hillWhy = BLOCK_MESSAGES.hill;
  /** The message for the last "town" refusal (what keeps out of town: the track, or a depot by name). */
  private townWhy = BLOCK_MESSAGES.town;

  /** Check a would-be position for piece `id` (turned or flipped in place: no risers are added), explaining a refusal. */
  private allowed(id: number, type: PieceTypeId, flipped: boolean, pose: Pose, y: number): boolean {
    const p = this.placement(type, flipped, pose, y, id);
    const reason = p.reason ?? (p.risers.length > 0 ? "unsupported" : null);
    if (reason) this.hud.refuse(this.blockMessage(reason));
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

  /**
   * Is this a depot piece, or a kit that splices (`KitDef.splices`), which is dropped onto a straight of a line to take
   * its place (and turns round to flip)?
   */
  private splices(type: PieceTypeId): boolean {
    return (!!INDUSTRY_ROLE[type] || !!kitOf(type)?.splices) && straightLength(type, false) > 0;
  }

  /**
   * The track ends a placed piece is joined to, from its first end's to its second's, if it's joined at both ends
   * and only to plain track (not a station or a depot); else null.
   */
  private inlineEnds(pieceId: number): [number, number] | null {
    const layout = this.game.layout;
    const ends: number[] = [];
    for (const i of [0, 1]) {
      const partner = layout.joinedConnector(connectorRef(pieceId, i));
      const q = partner === -1 ? undefined : layout.getPiece(pieceOfRef(partner));
      if (!q || q.type === "station" || INDUSTRY_ROLE[q.type] || q.type.startsWith("depot-") || kitOf(q.type) || getPieceDef(q.type, q.flipped).paths.length === 0) return null;
      ends.push(partner);
    }
    return [ends[0], ends[1]];
  }

  /**
   * Straights to close the gap a depot moved off a line leaves (see `gapFill`), or none: none unless it was inline,
   * the ends it was joined to are still free (it wasn't put back between them, nor onto them), and straights there
   * would be clear of everything, the depot where it's going and its yard included.
   */
  private fillFor(m: Extract<Mode, { kind: "drag-piece" }>, pose: Pose, y: number): Placement[] {
    if (!m.leaves || m.pieceId === -1) return [];
    const g = this.game;
    const [from, to] = m.leaves;
    // (Moved onto the straight next to where it was: that straight goes, but the depot takes its place end for end,
    // so the gap it leaves is the same, filled between the same ends.)
    const fill = gapFill(g.layout, from, to);
    if (!fill) return [];
    // The depot where it's going, by itself: the fill mustn't run into it or its yard.
    const alone = new Layout();
    alone.addPiece(m.type, pose, y, m.flipped);
    const yard = placedYard(m.pieceId, m.type, pose, y);
    const ignore = new Set([m.pieceId, ...(m.covers ?? [])]);
    for (const f of fill) {
      if (findOverlap(alone, f.type, false, f.pose, f.y, -1) !== -1) return [];
      if (yard && trackInYards([yard], f.type, false, f.pose, f.y, -1)) return [];
      const p = this.placement(f.type, false, f.pose, f.y, ignore);
      if (p.reason !== null || p.risers.length > 0) return [];
    }
    return fill.map((f) => ({ type: f.type, pose: f.pose, y: f.y }));
  }

  /** What a held piece's placement checks leave out: itself, and the straights it would take the place of. */
  private ignoreFor(m: Extract<Mode, { kind: "drag-piece" }>): Ignore {
    return m.covers ? new Set([m.pieceId, ...m.covers]) : m.pieceId;
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
      if (!getPieceDef(m.type, false).flippable) {
        // A depot turns right round: the same track, its building on the other side of the line.
        if (this.splices(m.type)) {
          m.heading += Math.PI;
          this.updateDrag(this.lastX, this.lastY);
        }
        return;
      }
      m.heldFlipped = !m.heldFlipped;
      m.flipped = m.heldFlipped;
      const visible = m.ghost.visible;
      this.dropHeld(m.ghost);
      m.ghost = this.heldMesh(m.type, m.flipped);
      m.ghost.visible = visible;
      this.updateDrag(this.lastX, this.lastY);
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
    if (!p) return;
    this.shrinkStandIn(id);
    this.editor().remove(id);
  }

  /** A stand-in for a piece about to be taken up: it lifts and shrinks away where the piece was. */
  private shrinkStandIn(id: number): void {
    const g = this.game;
    const p = g.layout.getPiece(id);
    if (!p) return;
    const mesh = ghostMesh(p.type, p.flipped, [g.mats.track, g.mats.trackCut, g.mats.bridgePaint], g.bridgeLevelsOf(p), g.archFloorsOf(p));
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
  private groupBlocked(ids: readonly number[], members: ReadonlySet<number>): PlaceBlock | null {
    const g = this.game;
    const hills = hillsOf(g.landscape.grid);
    for (const id of ids) {
      const p = g.layout.getPiece(id)!;
      const why = this.blockedBy(p.type, p.flipped, p.pose, p.y, id) ?? this.yardBlock(p.type, p.pose, p.y, id) ?? this.inYard(p.type, p.flipped, p.pose, p.y, id);
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
      this.hud.refuse(this.blockMessage(blocked));
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
      const mesh = ghostMesh(p.type, p.flipped, [g.mats.track, g.mats.trackCut, g.mats.bridgePaint], g.bridgeLevelsOf(p), g.archFloorsOf(p));
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
    // Parted from the track around it: the pegs at those joints go back to their own ends (and the ends show free).
    g.trackView.jointsChanged();
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
    g.kitView.moveInstances(g.layout, m.ids);
    const blocked = this.groupBlocked(m.ids, m.members);
    this.hud.setRefusal(blocked ? this.blockMessage(blocked) : null);
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
    g.kitView.moveInstances(g.layout, m.ids);
    g.trackView.jointsChanged();
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
    this.hud.setRefusal(null);
    if (Math.hypot(m.dx, m.dz) < 0.5) return;
    if (m.blocked) {
      this.hud.refuse(this.blockMessage(m.blocked));
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
    const leaves = this.splices(p.type) ? this.inlineEnds(pieceId) : null;
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
      leaves,
      offset: { x: cx - ground.x, z: cz - ground.z },
      ghost,
      snap: { kind: "none" },
      pose: { ...p.pose },
      looseY: p.y,
      covers: null,
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
  /** A held auto straight that leaves a gap: an end board on its far end (the end that stays open), else none. */
  private markGap(m: Extract<Mode, { kind: "drag-piece" }>): void {
    let board = m.ghost.getObjectByName("gap-board");
    if (!m.gap || m.snap.kind !== "snapped") {
      if (board) {
        m.ghost.remove(board);
        disposeObject(board);
      }
      return;
    }
    if (!board) {
      board = endBoardModel(this.game.mats);
      // Bigger than a placed end's, to be seen past the finger.
      board.scale.setScalar(1.6);
      board.name = "gap-board";
      board.matrixAutoUpdate = false;
      m.ghost.add(board);
    }
    const c = getPieceDef(m.type, m.flipped).connectors[m.snap.connector === 0 ? 1 : 0];
    board.matrix.copy(pieceMatrix(c.pose.x, c.y, c.pose.z, c.pose.heading)).scale(board.scale);
  }

  private heldMesh(type: PieceTypeId, flipped: boolean): Mesh {
    const mats = this.game.mats;
    setRim(mats.held, "#ffffff", 0);
    const mesh = ghostMesh(type, flipped, [mats.held, mats.trackCut, mats.held]);
    mesh.castShadow = true;
    mesh.renderOrder = 0;
    mesh.matrixAutoUpdate = false;
    // An industry comes with its yard and buildings; a kit with its model.
    const role = INDUSTRY_ROLE[type];
    if (role) mesh.add(this.game.depotView.model(role));
    else if (kitOf(type)) mesh.add(this.game.kitView.model(type));
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
      // On touch the piece's centre is held at the lifted point, as drawn (it hovers HOLD_LIFT over its seat): not where
      // it was grabbed, which put it a varying distance from the finger. A mouse keeps the grab point.
      const touch = this.lastPointerWasTouch;
      const heldAt = (height: number): Pose | null => {
        const p = this.planeAt(x, sy, height + (touch ? HOLD_LIFT : 0));
        if (!p) return null;
        const pose = poseForCentre(holdType, m.heldFlipped, p.x + (touch ? 0 : m.offset.x), p.z + (touch ? 0 : m.offset.z), m.heading);
        if (!touch) return pose;
        // By the piece as it looks (its middle, not the middle of its ends: a buffer's or a switch's are well apart).
        const v = visualCentre(holdType, m.heldFlipped, pose);
        pose.x += p.x - v.x;
        pose.z += p.z - v.z;
        return pose;
      };
      // Loose, a piece's first end lands on a quarter-square grid, so square-laid track lines up with the squares and
      // with other track.
      const loose = (pose: Pose): Pose => {
        pose.x = Math.round(pose.x / PLACE_GRID) * PLACE_GRID;
        pose.z = Math.round(pose.z / PLACE_GRID) * PLACE_GRID;
        return pose;
      };
      m.pose = loose(heldAt(0) ?? poseForCentre(holdType, m.heldFlipped, ground.x + (touch ? 0 : m.offset.x), ground.z + (touch ? 0 : m.offset.z), m.heading));
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
      // Look for track ends on the floor, up to a few risers up, and on whatever the piece is over. Any end joins, peg or
      // hole: the piece keeps the turn and the hand it's held with (it never turns or mirrors itself to fit).
      m.snap = { kind: "none" };
      // A free end under the finger wins: the piece goes where it's pointed. Else the nearest end to the held piece's.
      let atFinger = false;
      for (const level of new Set([0, RISER_HEIGHT, 2 * RISER_HEIGHT, 3 * RISER_HEIGHT, 4 * RISER_HEIGHT, m.looseY, m.looseY + RISER_HEIGHT])) {
        const held = heldAt(level) ?? m.pose;
        const finger = this.planeAt(x, sy, level);
        const f = finger ? findSnapAtPoint(this.game.layout, holdType, m.heldFlipped, held, level, finger, m.pieceId, Math.max(capture, m.tapReach ?? 0)) : null;
        const s = f?.kind === "snapped" ? f : findSnap(this.game.layout, holdType, m.heldFlipped, held, level, m.pieceId, capture);
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
      // Nothing in reach of its ends or under the finger, but the finger is out in front of a free end, on its line
      // (aiming into a gap, the piece held at an angle): it goes on that end.
      if (m.snap.kind !== "snapped" && getPieceDef(holdType, m.heldFlipped).connectors.length > 0) {
        for (const level of new Set([0, RISER_HEIGHT, 2 * RISER_HEIGHT, 3 * RISER_HEIGHT, 4 * RISER_HEIGHT, m.looseY])) {
          const finger = this.planeAt(x, sy, level);
          const s = finger ? findSnapAhead(this.game.layout, holdType, m.heldFlipped, heldAt(level) ?? m.pose, level, finger, m.pieceId) : null;
          if (s?.kind !== "snapped") continue;
          if (isBridge(holdType) && bridgeLevels(this.game.landscape, m.type, s.flipped, s.pose, s.y) === 0) continue;
          m.snap = s;
          break;
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
        m.gap = fit?.gap ?? 0;
      }
      // A depot held over a straight of a line takes its place (or a run of straights its length), turned along it.
      m.covers = null;
      let spliceWhy: PlaceBlock | null = null;
      if (this.splices(m.type)) {
        // Its centre as held under the finger, seen at the height of each straight it may be over (a few heights).
        const seen = new Map<number, { x: number; z: number } | null>();
        const centre = (h: number) => {
          let c = seen.get(h);
          if (c === undefined) {
            const p = this.planeAt(x, sy, h);
            c = p && { x: p.x + m.offset.x, z: p.z + m.offset.z };
            seen.set(h, c);
          }
          return c;
        };
        const sim = this.game.sim;
        const free = (id: number) => !sim.pieceOccupied(id);
        const reach = Math.max(capture, TRACK_WIDTH);
        // (Its whole track is looked along: held across a line with its middle off it, it still meets it.)
        const s = findSplice(this.game.layout, m.type, m.heldFlipped, centre, m.heading, reach, free);
        if (s.kind === "splice") {
          m.snap = { kind: "snapped", pose: s.pose, y: s.y, connector: 0, target: -1, distance: 0, flipped: m.heldFlipped };
          m.covers = s.covers;
        } else if (s.kind !== "none") spliceWhy = s.kind === "busy" ? "splice-busy" : "splice-fit";
        else spliceWhy = "splice-onto";
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
      let pose = m.snap.kind === "snapped" ? m.snap.pose : m.pose;
      let py = m.snap.kind === "snapped" ? m.snap.y : m.looseY;
      let placed = this.placement(m.type, m.flipped, pose, py, this.ignoreFor(m));
      // Seated on an end where it can't go, but seated by another of its ends there it can (a curve bending the other
      // way, clear of a house): it goes that way. (Never mirrored: that's the player's Flip.) Turn still turns it.
      // (Not a depot spliced into a straight: that snap has no end of its own.)
      if (placed.reason && m.snap.kind === "snapped" && m.snap.target >= 0 && !m.auto) {
        const turned = this.turnedSeat(m.type, m.flipped, m.snap, m.pieceId);
        if (turned) {
          m.snap = turned;
          pose = turned.pose;
          py = turned.y;
          placed = this.placement(m.type, m.flipped, pose, py, this.ignoreFor(m));
        }
      }
      // On other track but not where it can take a straight's place: say what would work. Over a straight a train
      // stands on, that's what to say, whatever else is in the way where it's held (a house it's slanting across).
      const reason = heldReason(placed.reason, spliceWhy);
      const risers = placed.risers;
      // (A preview under the mouse just shows red: the reason comes if it's clicked.)
      // While it's held where it can't go, the reason stays up (and goes once it can, or it's over the tray).
      // (Over a line, a depot's own message says what works: not the turn-to-fit hints.)
      m.hint =
        !reason || reason === spliceWhy
          ? null
          : isYardBlock(reason)
            ? this.yardHint(m.type, m.flipped, pose, py, this.ignoreFor(m))
            : m.snap.kind === "snapped"
              ? m.covers
                ? null // (taking straights' place: there's no end it's seated on to turn about)
                : this.fitHint(m.type, m.flipped, m.snap, m.pieceId)
              : this.turnHint(holdType, m.heldFlipped, m.pose, m.looseY, m.pieceId);
      if (m !== this.preview) this.hud.setRefusal(reason && !m.overTray ? (m.hint ?? this.blockMessage(reason)) : null);
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
      // Joined at one end, but leaving a gap to an end ahead (another one closes it): amber, not "joined".
      else if (m.snap.kind === "snapped" && m.gap) setRim(held, "#ff9d00", 1.8);
      else if (m.snap.kind === "snapped") setRim(held, "#7ddc58", 0.9);
      else setRim(held, "#fff2d8", 0.12);
      this.markGap(m);
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
    // On touch, a train is held (and seeks track) a little above the finger too, so it and where it'll go can be seen.
    const at = (this.lastPointerWasTouch ? this.touchLift(x, y) : null) ?? ground;
    const near = nearestCursor(this.game.layout, at.x, at.z, TRAIN_DROP_RANGE, this.cameraHeading());
    m.target = near?.cursor ?? null;
    if (near) {
      const w = cursorWorld(this.game.layout, near.cursor, createWorldSample());
      m.ghost.position.set(w.x, w.y + 4, w.z);
      m.ghost.rotation.set(0, -w.heading, 0);
    } else {
      m.ghost.position.set(at.x, 30, at.z);
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
    const { reason: final, risers } = this.placement(m.type, m.flipped, pose, y, this.ignoreFor(m));
    this.yardMemo = null;
    // The reason it couldn't go (if it can't) stays up long enough to read; else the held one goes.
    this.hud.setRefusal(null);
    if (final && !m.overTray) this.hud.refuse(m.hint ?? this.blockMessage(final === "piece" ? m.blocked ?? final : final));
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
        const covers = m.covers;
        // A depot dropped onto a line: the straights it takes the place of lift and shrink away (back in the box).
        if (covers) for (const c of covers) this.shrinkStandIn(c);
        // A depot moved off a line: straights close the gap it leaves (in the same undo step).
        const fill = this.fillFor(m, pose, y);
        const id = covers
          ? ed.replace(covers, m.type, pose, y, m.flipped, isNew ? undefined : { id: m.pieceId, from: m.from! }, fill)
          : isNew
            ? ed.place(m.type, pose, y, m.flipped, risers)
            : (ed.move(m.pieceId, pose, y, m.from!, risers, m.flipped, fill), m.pieceId);
        if (covers) this.hud.toast(covers.length === 1 ? "Straight back in the box" : `${covers.length} straights back in the box`);
        else if (fill.length > 0) this.hud.toast(fill.length === 1 ? "A straight closes the gap" : "Straights close the gap");
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
        // The next is likely the same kind: it stays ready, waiting at this one's free end for a tap. (Not while
        // drawing: a press there draws.)
        // (Game mode: not when that was the last of it in the toy box.)
        if (m.tray && !this.drawing && (this.trayHas?.(m.tray) ?? true)) {
          this.arm(m.tray);
          this.previewNextAt(id);
        } else if (m.tray && !this.drawing) this.arm(null);
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
    const fresh = !m.origin;
    if (m.overTray) {
      if (m.origin) this.hud.toast("Back in the box");
      if (fresh) this.onTrayTrainDropped?.(false);
      this.changed();
      return;
    }
    // Dropped onto or by another train: couple on to its nearer end.
    if (m.target && (this.joinTrain(m.cars, m.target) || this.placeTrain(m.cars, m.target, true))) {
      if (fresh) this.onTrayTrainDropped?.(true);
      this.changed();
      return;
    }
    if (m.origin) this.placeTrain(m.cars, m.origin);
    if (fresh) this.onTrayTrainDropped?.(false);
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
    if (standsAside(m.asset)) {
      // A crossing prop goes onto a level crossing, as its style: it snaps to the nearest one in reach (`styleCrossings`
      // links it by where it stands), and goes nowhere else.
      const crossings = g.levelCrossings;
      const i = nearestCrossing(crossings, pose.x, pose.z, CROSSING_DROP_REACH);
      const c = i === -1 ? undefined : crossings[i];
      if (!c || c.gates.length === 0) blocked = "no-crossing";
      else {
        pose.x = Math.round(c.x / 2) * 2;
        pose.z = Math.round(c.z / 2) * 2;
        ground = c.y;
        // One style to a crossing.
        for (const other of g.props.all())
          if (other.id !== m.propId && standsAside(other.asset) && nearestCrossing(crossings, other.x, other.z) === i) blocked = "prop";
      }
    } else if (fp) {
      const own = new Set(buildingCells(g.landscape, m.propId === -1 ? undefined : g.props.get(m.propId)?.building));
      const c = checkProp({ land: g.landscape, track: m.track, props: g.props, footprint: g.propLibrary.footprint }, fp, pose, placeOn(m.asset), m.propId, own);
      if (c.kind === "clear") ground = c.y;
      else blocked = c.reason;
      blocked ??= this.propInYard(fp, pose);
    }
    if (blocked && blocked !== m.blocked && !m.overTray) this.hud.toast(this.propMessage(blocked));
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
    if (LEVER_PROPS.has(p.asset)) this.showLevers(id);
    this.hintDrag();
  }

  /**
   * Throw a switch's points, or hold or let go a signal (`road`: which of a signal piece's, a gantry's road): redrawn
   * and saved, nothing else rebuilt (a signal skin's model follows its aspect: see `KIT_STATES`).
   */
  private throwLever(pieceId: number, road = 0): void {
    const g = this.game;
    const piece = g.layout.getPiece(pieceId);
    if (piece && getPieceDef(piece.type, piece.flipped).signal) g.sim.toggleSignal(pieceId, road);
    else g.sim.toggleSwitch(pieceId);
    g.trackView.syncSwitches();
    g.invalidate();
    this.onSwitched?.();
  }

  /**
   * A signal box's or lever frame's card lists the points and signals near it (worked out on the tap), each a chip
   * saying how it's set: a tap throws it, and the list says so.
   */
  private showLevers(propId: number): void {
    const g = this.game;
    const p = g.props.get(propId);
    if (!p) return;
    const levers = leversNear(g.layout, p.x, p.z);
    const counts = { points: 0, signal: 0 };
    const items = levers.map((l) => {
      const n = ++counts[l.kind];
      return l.kind === "points"
        ? { label: `Points ${n}: ${pointsWay(g.layout, l.pieceId)}`, title: "Throw these points" }
        : { label: `Signal ${n}: ${g.sim.signalHeld(l.pieceId, l.road) ? "held at red" : "free"}`, title: "Hold this signal at red, or let it go" };
    });
    this.hud.showLevers(items, (i) => {
      const l = levers[i];
      if (!g.layout.getPiece(l.pieceId) || this.selectedProp !== propId) return;
      this.throwLever(l.pieceId, l.road);
      this.showLevers(propId);
    });
  }

  /** Turn a placed prop an eighth, if it still fits. */
  private turnProp(id: number): void {
    const g = this.game;
    const p = g.props.get(id);
    const fp = p && g.propLibrary.footprint(p.asset);
    if (!p || !fp) return;
    const from: PropPose = { x: p.x, z: p.z, heading: p.heading, y: p.y };
    const to = { x: p.x, z: p.z, heading: p.heading + Math.PI / 4 };
    // (A crossing prop turns where it stands, on its crossing.)
    const aside = standsAside(p.asset);
    const c: ReturnType<typeof checkProp> = aside ? { kind: "clear", y: p.y } : checkProp({ land: g.landscape, track: new TrackIndex(g.layout), props: g.props, footprint: g.propLibrary.footprint }, fp, to, placeOn(p.asset), id);
    const why = c.kind === "blocked" ? c.reason : aside ? null : this.propInYard(fp, to);
    if (c.kind === "blocked" || why) {
      this.hud.toast(this.propMessage(why!));
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

  /**
   * What's under the pointer. On touch (`touch`), a car within a fingertip of the tap wins over track, a road, a town's
   * footprint or bare floor (see `nearCarWins`): at the default zoom a car is only 10–20 px long.
   */
  private pick(x: number, y: number, touch = false): Press | null {
    const exact = this.pickExact(x, y);
    if (!touch || !nearCarWins(exact ? (exact.kind === "depot" && exact.footprint ? "station" : exact.kind) : null)) return exact;
    const carId = carNearTap(x, y, this.carsOnScreen(), TOUCH_SLACK_PX);
    return carId !== -1 ? { kind: "car", carId } : exact;
  }

  private pickExact(x: number, y: number): (Press & { footprint?: boolean }) | null {
    this.setNdc(x, y);
    const g = this.game;
    const hits = this.raycaster.intersectObjects([g.trainView.group, g.trackView.group, g.depotView.group, g.propsView.group, g.kitView.group, g.crossingsView.group], true);
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
      // A signal skin's model is its lever (a tap holds it at red, or lets it go: a gantry's, the road it's over). Any
      // other kit's model is passed through, to the track or ground behind it.
      const kitPiece = g.kitView.pieceAt(h.object, h.batchId);
      if (kitPiece !== -1) {
        const road = signalRoadAt(g.layout, kitPiece, h.point.x, h.point.z);
        if (road !== -1) return { kind: "lever", pieceId: kitPiece, road };
        continue;
      }
      // A level crossing's style (its barriers or gates) is its prop's.
      const stylePropId = g.crossingsView.propAt(h.object);
      if (stylePropId !== -1 && g.props.get(stylePropId)) return { kind: "prop", propId: stylePropId };
      const propId = g.propsView.propAt(h.object, h.batchId);
      if (propId !== -1) return { kind: "prop", propId };
      const pieceId = g.trackView.pieceAt(h.object, h.instanceId);
      if (pieceId !== -1) return { kind: "piece", pieceId };
    }
    // Nothing solid under the tap, but it may be on a town's station (platform, canopy, house): the whole footprint
    // opens the town, with a fingertip's slack. Trains and track were tried first above, so they win.
    const town = g.depotView.stationUnder(this.raycaster.ray, this.fingerMm(x, y));
    if (town !== -1) return { kind: "depot", depotId: town, footprint: true };
    // Nothing standing there: a road piece the player laid, on the square under the pointer.
    const cell = this.squareAt(x, y);
    if (this.roads.pickable(cell)) return { kind: "road", cell };
    return null;
  }

  /** Every car's line end to end on screen (px), at about the height of its body. */
  private carsOnScreen(): CarOnScreen[] {
    const sim = this.game.sim;
    const r = this.game.canvas.getBoundingClientRect();
    const out: CarOnScreen[] = [];
    const v = new Vector3();
    const toScreen = (p: { x: number; y: number; z: number }): [number, number] => {
      v.set(p.x, p.y + CAR_BODY_MID_MM, p.z).project(this.game.camera);
      return [r.left + ((v.x + 1) / 2) * r.width, r.top + ((1 - v.y) / 2) * r.height];
    };
    for (const trainId of sim.trainIds()) {
      const t = sim.getTrain(trainId);
      if (!t) continue;
      t.cars.forEach((car, i) => {
        const a = t.world[2 * i];
        const b = t.world[2 * i + 1];
        if (!a || !b) return;
        const [ax, ay] = toScreen(a);
        const [bx, by] = toScreen(b);
        out.push({ id: car.id, ax, ay, bx, by });
      });
    }
    return out;
  }

  /** About 22 screen pixels (half a 44 px phone target) as mm on the ground at the pointer, capped at 60. */
  private fingerMm(x: number, y: number): number {
    const a = this.groundAt(x, y);
    const b = this.groundAt(x + 22, y);
    this.setNdc(x, y); // groundAt moved the ray; put it back on the pointer
    if (!a || !b) return 0;
    return Math.min(60, a.distanceTo(b));
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

  /** A piece's geometry came in (a bridge's taller arches): the piece in hand is redrawn where it is, finger still. */
  refreshHeld(): void {
    if (this.mode.kind === "drag-piece") this.updateDrag(this.lastX, this.lastY);
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

/** The moves the browser ran into this event, or the event itself (an empty list would hide a pan's moves). */
function coalesced(e: PointerEvent): readonly PointerEvent[] {
  const list = e.getCoalescedEvents?.();
  return list?.length ? list : [e];
}

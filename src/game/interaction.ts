import { Euler, Group, Matrix4, MOUSE, Plane, Raycaster, Vector2, Vector3, Mesh, type Object3D, type TOUCH } from "three";
import { Editor, pieceCentre, poseForCentre, type RiserAt } from "../editor/editor";
import { buildCarModel, carVariant, disposeObject } from "../render/train-models";
import { dustPuff } from "../render/dust";
import { settle, shrinkAway, turn, wobbleBack, type Flourish, type PiecePose } from "../render/flourishes";
import { setRim } from "../render/materials";
import { ghostMesh, pieceGeometry } from "../render/track-view";
import { damp } from "../lib/tween";
import { ADV_OK, advanceCursor, CAR_SPECS, COUPLER_GAP, createAdvance, createWorldSample, cursorWorld, nearestCursor, type CarKind, type CarLook, type Cursor } from "../sim";
import { BLOCK_MESSAGES, bridgeLevels, CELL, hillsOf, type Landscape, cutUndermines, checkPlacement, checkSupport, looseHeight, riserStackAt, type BlockReason } from "../landscape";
import { findLowCrossing, findOverlap, findSnap, findSnapAtPoint, fitAutoStraight, canStandOnArches, getPieceDef, isBridge, RISER_HEIGHT, SNAP_CAPTURE_RADIUS, type PieceTypeId, type PlacedPiece, type Pose, type SnapResult } from "../track";
import type { Hud, TrayItem } from "../ui/hud";
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
import { DEPOT_NAMES } from "./world";
import { cargoDropTarget } from "./cargo-drop";
import { CARGO, PILE_CAP, ROLE, type CargoKind, type CargoSlot } from "../economy";

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
/** How high a held piece floats above where it would land (mm). */
const HOLD_LIFT = 12;
/** An OrbitControls touch mapping that does nothing (it falls through to "no gesture"). */
const NO_TOUCH = -1 as unknown as TOUCH;
const NO_MOUSE = -1 as unknown as MOUSE;
const MAX_TILT = (2 * Math.PI) / 180;
const TRAIN_DROP_RANGE = 70;

type Press =
  | { kind: "car"; carId: number }
  | { kind: "lever"; pieceId: number }
  | { kind: "piece"; pieceId: number }
  /** A depot's yard, building or crane (economy depot id). */
  | { kind: "depot"; depotId: number }
  /** A log or plank bundle on a pile or wagon. */
  | { kind: "cargo"; slot: CargoSlot; cargo: CargoKind }
  /** A placed prop (catalogue model). */
  | { kind: "prop"; propId: number };

/** A car held in the hand: what it is, which way it faces, its lever, and (when picked up) its id and load. */
type HeldCar = { kind: CarKind; facing: 1 | -1; lever: -1 | 0 | 1; id?: number; look?: CarLook; cargo?: { kind: CargoKind; count: number } };

type Mode =
  | { kind: "idle" }
  | { kind: "press"; press: Press; pointerId: number; x: number; y: number; ground: Vector3 }
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
      /** The auto straight: held as a long straight, it takes the length that meets a free end along its line. */
      auto?: boolean;
      from: { pose: Pose; y: number } | null;
      offset: { x: number; z: number };
      ghost: Mesh;
      snap: SnapResult;
      pose: Pose;
      /** Base height for a loose (unsnapped) drop: high enough to rest on what's under its ends. */
      looseY: number;
      blocked: BlockReason | null;
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
  /**
   * A tap on empty ground (where it landed, and where on screen): true if it was taken (then it doesn't count toward
   * a double tap).
   */
  onFloorTap: ((ground: Vector3, x: number, y: number) => boolean) | null = null;
  private mode: Mode = { kind: "idle" };
  private selectedPiece = -1;
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
    if ((m.kind === "drag-piece" || m.kind === "drag-train" || m.kind === "drag-prop") && this.game.director.edgePanning) this.updateDrag(this.lastX, this.lastY);
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
    this.cancel();
    this.clearSelection();
    if (item.kind === "piece") {
      // Comes out turned and flipped as set in the tray.
      const flipped = this.trayFlipped && getPieceDef(item.type, false).flippable;
      const ghost = this.heldMesh(item.type, flipped);
      ghost.visible = false;
      this.mode = {
        kind: "drag-piece",
        pointerId: e.pointerId,
        type: item.type,
        flipped,
        heldFlipped: flipped,
        heading: this.cameraHeading() + (this.trayTurns * Math.PI) / 4,
        pieceId: -1,
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
    } else if (item.kind === "prop") {
      this.mode = this.propDrag(item.asset, -1, e.pointerId, this.nextPropHeading(), null, { x: 0, z: 0 });
    } else if (item.kind === "train") {
      // Ids now, so the train in the hand wears the colours it will have on the track.
      const ids = this.game.sim.newCarIds(item.cars.length);
      const cars = item.cars.map((kind, i) => ({ kind, facing: 1 as const, lever: 0 as const, id: ids[i], look: item.looks?.[i] ?? ("classic" as const) }));
      this.mode = { kind: "drag-train", pointerId: e.pointerId, cars, origin: null, ghost: this.trainGhost(cars), target: null, overTray: true };
    }
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
    let hit = this.pick(e.clientX, e.clientY);
    // Track can only be picked up from close by, so a pan over a zoomed-out map never drags a piece away.
    if (hit?.kind === "piece" && !this.withinReach(hit.pieceId)) hit = null;
    if (hit?.kind === "prop" && (!this.propsEditable || !this.propWithinReach(hit.propId))) hit = null;
    const ground = this.groundAt(e.clientX, e.clientY) ?? new Vector3();
    if (!hit) {
      // Empty floor: the camera pans; a tap here deselects, and a double tap focuses on that spot.
      this.hud.hideCards();
      this.clearSelection();
      this.floorDown = this.touches.size <= 1 ? { id: e.pointerId, x: e.clientX, y: e.clientY, t: e.timeStamp } : null;
      return;
    }
    this.game.controls.enabled = false;
    this.mode = { kind: "press", press: hit, pointerId: e.pointerId, x: e.clientX, y: e.clientY, ground };
  }

  private onMove(e: PointerEvent): void {
    const m = this.mode;
    if (m.kind === "idle" && this.landCursor && e.pointerType === "mouse" && e.target === this.game.canvas) this.showSquare(this.squareAt(e.clientX, e.clientY));
    if (m.kind === "idle" || m.pointerId !== e.pointerId) return;
    if (m.kind === "press") {
      if (Math.hypot(e.clientX - m.x, e.clientY - m.y) < DRAG_THRESHOLD) return;
      if (m.press.kind === "prop" && m.press.propId !== this.selectedProp) {
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
      if (m.press.kind === "piece") this.beginPieceMove(m.press.pieceId, m.pointerId, m.ground);
      else if (m.press.kind === "cargo") this.beginCargoDrag(m.press.slot, m.press.cargo, m.pointerId);
      else if (m.press.kind === "prop") this.beginPropMove(m.press.propId, m.pointerId, m.ground);
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
        if (ground && this.onFloorTap?.(ground, e.clientX, e.clientY)) this.lastTap = null;
        else if (this.noteTap(e) && ground) this.game.director.focus(ground, 260);
      } else this.lastTap = null;
    }
    const m = this.mode;
    if (m.kind === "idle" || m.pointerId !== e.pointerId) return;
    this.game.controls.enabled = true;
    if (m.kind === "press") {
      this.mode = { kind: "idle" };
      if (m.press.kind !== "lever" && this.noteTap(e)) this.focusOn(m.press);
      else this.tap(m.press);
      return;
    }
    if (m.kind === "drag-piece") this.dropPiece(m);
    else if (m.kind === "drag-prop") this.dropProp(m);
    else if (m.kind === "drag-scenery") this.dropScenery(m);
    else if (m.kind === "drag-cargo") this.dropCargo(m, e.clientX, e.clientY);
    else this.dropTrain(m);
  }

  private floorDown: { id: number; x: number; y: number; t: number } | null = null;
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
      this.game.scene.remove(m.ghost);
      if (m.pieceId !== -1 && m.from) this.game.layout.dropPiece(m.pieceId, m.from.pose, m.from.y);
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
    }
    this.mode = { kind: "idle" };
  }

  // ---- taps -------------------------------------------------------------------------------------------------

  private tap(p: Press): void {
    const g = this.game;
    if (p.kind === "lever") {
      g.sim.toggleSwitch(p.pieceId);
      g.trackView.syncSwitches();
      this.changed();
      return;
    }
    if (p.kind === "piece") {
      const depot = g.economy.depotAtPiece(p.pieceId);
      if (depot) this.openDepot(depot.id);
      else if (this.fixedLabel(p.pieceId)) this.hud.toast(this.fixedLabel(p.pieceId)!);
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
    if (p.kind === "cargo") {
      // A tap on cargo opens whatever it's on: its depot, or its wagon.
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
    this.hud.showPieceCard(getPieceDef(p.type, false).flippable);
  }

  clearSelection(): void {
    if (this.selectedPiece !== -1) this.game.trackView.setHighlight(-1);
    if (this.selectedProp !== -1) this.propOutline.hide();
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

  /** Economy depot whose card is open, or −1. */
  private selectedDepot = -1;
  /** What the open depot card last showed. */
  private readonly shownDepot = { id: -1, a: -1, b: -1, auto: false, wait: false, delivered: -1 };

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
    if (shown.id === d.id && shown.a === d.piles[0] && shown.b === d.piles[1] && shown.auto === d.auto && shown.wait === d.waitFull && shown.delivered === delivered0) return;
    shown.id = d.id;
    shown.a = d.piles[0];
    shown.b = d.piles[1];
    shown.auto = d.auto;
    shown.wait = d.waitFull;
    shown.delivered = delivered0;
    const role = ROLE[d.role];
    const piles: { label: string; count: number; cap: number }[] = [];
    for (const kind of [role.takes, role.gives]) if (kind) piles.push({ label: CARGO[kind].label, count: d.piles[CARGO[kind].index], cap: PILE_CAP });
    const delivered = d.role === "town" ? this.game.economy.delivered.get(d.townId) ?? 0 : 0;
    this.hud.updateDepotCard(piles, d.auto, role.gives ? d.waitFull : null, d.role === "town" ? `Delivered ${delivered}` : "");
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
  private placement(type: PieceTypeId, flipped: boolean, pose: Pose, y: number, ignoreId: number): { reason: BlockReason | null; risers: RiserAt[] } {
    const reason = this.blockedBy(type, flipped, pose, y, ignoreId);
    if (reason) return { reason, risers: [] };
    const s = checkSupport(this.game.landscape, this.game.layout, type, flipped, pose, y, ignoreId);
    if (s.kind === "unsupported") return { reason: "unsupported", risers: [] };
    for (const r of s.risers) {
      const why = this.blockedBy("riser", false, r.pose, r.y, ignoreId);
      if (why) return { reason: why, risers: [] };
    }
    return { reason: null, risers: s.risers };
  }

  /** Check a would-be position for piece `id` (turned or flipped in place: no risers are added), explaining a refusal. */
  private allowed(id: number, type: PieceTypeId, flipped: boolean, pose: Pose, y: number): boolean {
    const p = this.placement(type, flipped, pose, y, id);
    const reason = p.reason ?? (p.risers.length > 0 ? "unsupported" : null);
    if (reason) this.hud.toast(BLOCK_MESSAGES[reason]);
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
      this.game.scene.remove(m.ghost);
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

  private beginPieceMove(pieceId: number, pointerId: number, ground: Vector3): void {
    const layout = this.game.layout;
    const p = layout.getPiece(pieceId);
    if (!p) return;
    this.clearSelection();
    this.hud.hideCards();
    const from = { pose: { ...p.pose }, y: p.y };
    layout.liftPiece(pieceId);
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
    this.game.scene.add(mesh);
    return mesh;
  }

  private updateDrag(x: number, y: number): void {
    const m = this.mode;
    if (m.kind === "drag-scenery") {
      this.updateSceneryDrag(m, x, y);
      return;
    }
    if (m.kind !== "drag-piece" && m.kind !== "drag-train" && m.kind !== "drag-cargo" && m.kind !== "drag-prop") return;
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
      const autoFit = m.pieceId === -1 ? "turn-or-mirror" : "turn";
      m.snap = { kind: "none" };
      // A free end under the finger wins: the piece goes where it's pointed. Else the nearest end to the held piece's.
      let atFinger = false;
      for (const level of new Set([0, RISER_HEIGHT, 2 * RISER_HEIGHT, 3 * RISER_HEIGHT, 4 * RISER_HEIGHT, m.looseY, m.looseY + RISER_HEIGHT])) {
        const held = heldAt(level) ?? m.pose;
        const finger = this.planeAt(x, sy, level);
        const f = finger ? findSnapAtPoint(this.game.layout, holdType, m.heldFlipped, held, level, finger, m.pieceId, capture, autoFit) : null;
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
        this.game.scene.remove(m.ghost);
        m.ghost = this.heldMesh(m.type, m.flipped);
        m.ghost.visible = visible;
      }
      const pose = m.snap.kind === "snapped" ? m.snap.pose : m.pose;
      const py = m.snap.kind === "snapped" ? m.snap.y : m.looseY;
      const { reason, risers } = this.placement(m.type, m.flipped, pose, py, m.pieceId);
      if (reason && reason !== m.blocked && !m.overTray) this.hud.toast(BLOCK_MESSAGES[reason]);
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
    const discard = () => g.scene.remove(mesh);
    const isNew = m.pieceId === -1;
    // The stand-in stops sharing the held-piece material (the next piece picked up re-tints that): plain wood when
    // it's going down, see-through red when it's refused.
    const refused = final !== null || m.overTray;
    mesh.material = refused ? [g.mats.trackGhostBlocked, g.mats.trackGhostBlocked, g.mats.trackGhostBlocked] : [g.mats.track, g.mats.trackCut, g.mats.bridgePaint];
    switch (dropOutcome({ blocked: final !== null, overTray: m.overTray, isNew })) {
      case "place": {
        const snapped = m.snap.kind === "snapped";
        const id = isNew ? ed.place(m.type, pose, y, m.flipped, risers) : (ed.move(m.pieceId, pose, y, m.from!, risers), m.pieceId);
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
    for (const id of sim.trainIds()) {
      const t = sim.getTrain(id)!;
      if (t.derailed) continue;
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
      this.cancel();
      this.clearSelection();
      this.hud.hideCards();
    }
  }

  // ---- land ------------------------------------------------------------------------------------------------

  /** The square under a screen point, seen on the land's surface (a hill's top, not the floor under it); −1 off the land. */
  squareAt(x: number, y: number): number {
    const g = this.game.landscape.grid;
    const hills = hillsOf(g);
    let p = this.planeAt(x, y, 0);
    if (!p) return -1;
    // Up to the surface at that point, a few times over (a step up or down moves the point a little).
    for (let k = 0; k < 3; k++) {
      const q = this.planeAt(x, y, hills.groundAt(p.x, p.z));
      if (!q) break;
      p = q;
    }
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
      void g.propLibrary.load(key).then(() => {
        dress();
        if (this.mode.kind === "drag-prop" && this.mode.ghost === ghost) this.updateDrag(this.lastX, this.lastY);
      });
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
    this.editor().undo();
  }

  redo(): void {
    if (this.busy) return;
    this.game.flourishes.clear();
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

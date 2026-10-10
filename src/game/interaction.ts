import { Group, MOUSE, Plane, Raycaster, TOUCH, Vector2, Vector3, type Mesh, type Object3D } from "three";
import { Editor, poseForCentre } from "../editor/editor";
import { buildCarModel } from "../render/train-models";
import { ghostMesh, pieceMatrix } from "../render/track-view";
import { CAR_SPECS, COUPLER_GAP, createWorldSample, cursorWorld, nearestCursor, type CarKind, type Cursor } from "../sim";
import { findSnap, getPieceDef, RISER_HEIGHT, SNAP_CAPTURE_RADIUS, type PieceTypeId, type Pose, type SnapResult } from "../track";
import type { Hud, TrayItem } from "../ui/hud";
import type { Game } from "./game";

const DRAG_THRESHOLD = 6;
const TRAIN_DROP_RANGE = 70;

type Press = { kind: "car"; carId: number } | { kind: "lever"; pieceId: number } | { kind: "piece"; pieceId: number };

type Mode =
  | { kind: "idle" }
  | { kind: "press"; press: Press; pointerId: number; x: number; y: number; ground: Vector3 }
  | {
      kind: "drag-piece";
      pointerId: number;
      type: PieceTypeId;
      flipped: boolean;
      heading: number;
      /** Existing piece being moved, or -1 for a new piece from the tray. */
      pieceId: number;
      from: { pose: Pose; y: number } | null;
      offset: { x: number; z: number };
      ghost: Mesh;
      snap: SnapResult;
      pose: Pose;
      overTray: boolean;
    }
  | {
      kind: "drag-train";
      pointerId: number;
      cars: { kind: CarKind; facing: 1 | -1; lever: -1 | 0 | 1 }[];
      /** Where it came from, to put it back if the drop misses the track. */
      origin: Cursor | null;
      ghost: Group;
      target: Cursor | null;
      overTray: boolean;
    };

/** Pointer, touch and keyboard input: the object under the pointer decides what a gesture does. */
export class Interaction {
  private mode: Mode = { kind: "idle" };
  private selectedPiece = -1;
  private selectedCar = -1;
  private readonly raycaster = new Raycaster();
  private readonly ndc = new Vector2();
  private readonly floor = new Plane(new Vector3(0, 1, 0), 0);

  constructor(
    private readonly game: Game,
    private readonly hud: Hud,
    private readonly editor: () => Editor,
    private readonly changed: () => void,
  ) {
    const canvas = game.canvas;
    const c = game.controls;
    c.mouseButtons = { LEFT: MOUSE.PAN, MIDDLE: MOUSE.DOLLY, RIGHT: MOUSE.ROTATE };
    c.touches = { ONE: TOUCH.PAN, TWO: TOUCH.DOLLY_ROTATE };
    window.addEventListener("pointerdown", (e) => this.notePointer(e), { capture: true });
    canvas.addEventListener("pointerdown", (e) => this.onCanvasDown(e), { capture: true });
    window.addEventListener("pointermove", (e) => this.onMove(e));
    window.addEventListener("pointerup", (e) => this.onUp(e));
    window.addEventListener("pointercancel", () => this.cancel());
    window.addEventListener("keydown", (e) => this.onKey(e));
    canvas.addEventListener("contextmenu", (e) => e.preventDefault());
  }

  // ---- tray -------------------------------------------------------------------------------------------------

  startTrayDrag(item: TrayItem, e: PointerEvent): void {
    this.cancel();
    this.clearSelection();
    if (item.kind === "piece") {
      const ghost = ghostMesh(item.type, false, this.game.mats.trackGhost);
      ghost.visible = false;
      this.game.scene.add(ghost);
      this.mode = {
        kind: "drag-piece",
        pointerId: e.pointerId,
        type: item.type,
        flipped: false,
        heading: this.cameraHeading(),
        pieceId: -1,
        from: null,
        offset: { x: 0, z: 0 },
        ghost,
        snap: { kind: "none" },
        pose: { x: 0, z: 0, heading: 0 },
        overTray: true,
      };
    } else {
      const cars = item.cars.map((kind) => ({ kind, facing: 1 as const, lever: 0 as const }));
      this.mode = { kind: "drag-train", pointerId: e.pointerId, cars, origin: null, ghost: this.trainGhost(cars), target: null, overTray: true };
    }
  }

  // ---- pointer ----------------------------------------------------------------------------------------------

  private onCanvasDown(e: PointerEvent): void {
    if (this.mode.kind !== "idle") return;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    const hit = this.pick(e.clientX, e.clientY);
    const ground = this.groundAt(e.clientX, e.clientY) ?? new Vector3();
    if (!hit) {
      // Empty floor: the camera pans; a tap here deselects (handled on pointerup via press of nothing).
      this.hud.hideCards();
      this.clearSelection();
      return;
    }
    this.game.controls.enabled = false;
    this.mode = { kind: "press", press: hit, pointerId: e.pointerId, x: e.clientX, y: e.clientY, ground };
  }

  private onMove(e: PointerEvent): void {
    const m = this.mode;
    if (m.kind === "idle" || m.pointerId !== e.pointerId) return;
    if (m.kind === "press") {
      if (Math.hypot(e.clientX - m.x, e.clientY - m.y) < DRAG_THRESHOLD) return;
      if (m.press.kind === "piece") this.beginPieceMove(m.press.pieceId, m.pointerId, m.ground);
      else if (m.press.kind === "car") this.beginTrainPickup(m.press.carId, m.pointerId);
      else {
        this.mode = { kind: "idle" };
        this.game.controls.enabled = true;
        return;
      }
    }
    this.updateDrag(e.clientX, e.clientY);
  }

  private onUp(e: PointerEvent): void {
    const m = this.mode;
    if (m.kind === "idle" || m.pointerId !== e.pointerId) return;
    this.game.controls.enabled = true;
    if (m.kind === "press") {
      this.mode = { kind: "idle" };
      this.tap(m.press);
      return;
    }
    if (m.kind === "drag-piece") this.dropPiece(m);
    else this.dropTrain(m);
  }

  private cancel(): void {
    const m = this.mode;
    this.game.controls.enabled = true;
    if (m.kind === "drag-piece") {
      this.game.scene.remove(m.ghost);
      if (m.pieceId !== -1 && m.from) this.game.layout.dropPiece(m.pieceId, m.from.pose, m.from.y);
      this.changed();
    } else if (m.kind === "drag-train") {
      this.game.scene.remove(m.ghost);
      if (m.origin) this.placeTrain(m.cars, m.origin);
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
      this.selectPiece(p.pieceId);
      return;
    }
    const found = g.sim.findCar(p.carId);
    if (!found) return;
    if (found.train.derailed) {
      const back = g.sim.rerail(found.train.id);
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
    this.selectedPiece = -1;
    this.selectedCar = -1;
  }

  // ---- card actions -----------------------------------------------------------------------------------------

  setLever(v: -1 | 0 | 1): void {
    if (this.selectedCar === -1) return;
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
    if (this.selectedPiece !== -1) this.editor().rotate(this.selectedPiece, Math.PI / 4);
  }

  flipSelected(): void {
    if (this.mode.kind === "drag-piece") {
      const m = this.mode;
      if (!getPieceDef(m.type, false).flippable) return;
      m.flipped = !m.flipped;
      this.game.scene.remove(m.ghost);
      m.ghost = ghostMesh(m.type, m.flipped, this.game.mats.trackGhost);
      this.game.scene.add(m.ghost);
      return;
    }
    if (this.selectedPiece !== -1) this.editor().flip(this.selectedPiece);
  }

  deleteSelected(): void {
    if (this.selectedPiece === -1) return;
    const id = this.selectedPiece;
    this.clearSelection();
    this.hud.hideCards();
    this.editor().remove(id);
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
    const ghost = ghostMesh(p.type, p.flipped, this.game.mats.trackGhost);
    this.game.scene.add(ghost);
    const centre = poseForCentre(p.type, p.flipped, 0, 0, p.pose.heading);
    // offset from the grab point to the piece centre, so the piece doesn't jump under the finger
    const cx = p.pose.x - centre.x;
    const cz = p.pose.z - centre.z;
    this.mode = {
      kind: "drag-piece",
      pointerId,
      type: p.type,
      flipped: p.flipped,
      heading: p.pose.heading,
      pieceId,
      from,
      offset: { x: cx - ground.x, z: cz - ground.z },
      ghost,
      snap: { kind: "none" },
      pose: { ...p.pose },
      overTray: false,
    };
  }

  private updateDrag(x: number, y: number): void {
    const m = this.mode;
    if (m.kind !== "drag-piece" && m.kind !== "drag-train") return;
    m.overTray = this.hud.isOverTray(x, y);
    const ground = this.groundAt(x, y);
    if (m.kind === "drag-piece") {
      m.ghost.visible = !m.overTray && !!ground;
      if (!ground) return;
      // On touch the piece floats a little above the finger so it isn't hidden.
      const lift = this.lastPointerWasTouch ? this.touchLift(x, y) : null;
      const gx = (lift ?? ground).x + m.offset.x;
      const gz = (lift ?? ground).z + m.offset.z;
      m.pose = poseForCentre(m.type, m.flipped, gx, gz, m.heading);
      const capture = this.captureRadius(x, y);
      const low = findSnap(this.game.layout, m.type, m.flipped, m.pose, 0, m.pieceId, capture);
      const high = findSnap(this.game.layout, m.type, m.flipped, m.pose, RISER_HEIGHT, m.pieceId, capture);
      m.snap = low.kind === "snapped" && (high.kind !== "snapped" || low.distance <= high.distance) ? low : high;
      const pose = m.snap.kind === "snapped" ? m.snap.pose : m.pose;
      const py = m.snap.kind === "snapped" ? m.snap.y : 0;
      m.ghost.material = m.snap.kind === "snapped" ? this.game.mats.trackGhostSnap : this.game.mats.trackGhost;
      m.ghost.matrixAutoUpdate = false;
      m.ghost.matrix.copy(pieceMatrix(pose.x, py + 1.5, pose.z, pose.heading));
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

  private dropPiece(m: Extract<Mode, { kind: "drag-piece" }>): void {
    this.game.scene.remove(m.ghost);
    this.mode = { kind: "idle" };
    const ed = this.editor();
    const pose = m.snap.kind === "snapped" ? m.snap.pose : m.pose;
    const y = m.snap.kind === "snapped" ? m.snap.y : 0;
    if (m.overTray) {
      if (m.pieceId !== -1) {
        // Dragged back into the box: delete (undo restores it where it was).
        this.game.layout.dropPiece(m.pieceId, m.from!.pose, m.from!.y);
        ed.remove(m.pieceId);
        this.hud.toast("Back in the box");
      }
      return;
    }
    if (m.pieceId === -1) {
      ed.place(m.type, pose, y, m.flipped);
    } else {
      ed.move(m.pieceId, pose, y, m.from!);
    }
  }

  // ---- dragging trains --------------------------------------------------------------------------------------

  private beginTrainPickup(carId: number, pointerId: number): void {
    const sim = this.game.sim;
    const found = sim.findCar(carId);
    if (!found) return;
    this.clearSelection();
    this.hud.hideCards();
    const t = found.train;
    const cars = t.cars.map((c) => ({ kind: c.kind, facing: c.facing, lever: c.lever }));
    const origin = t.derailed ? null : { ...t.bogies[0] };
    sim.removeTrain(t.id);
    this.changed();
    this.mode = { kind: "drag-train", pointerId, cars, origin, ghost: this.trainGhost(cars), target: null, overTray: false };
  }

  private dropTrain(m: Extract<Mode, { kind: "drag-train" }>): void {
    this.game.scene.remove(m.ghost);
    this.mode = { kind: "idle" };
    if (m.overTray) {
      if (m.origin) this.hud.toast("Back in the box");
      this.changed();
      return;
    }
    if (m.target && this.placeTrain(m.cars, m.target)) {
      this.changed();
      return;
    }
    if (m.origin) this.placeTrain(m.cars, m.origin);
    this.hud.toast(m.target ? "Not enough track there" : "Drop trains onto the track");
    this.changed();
  }

  private placeTrain(cars: { kind: CarKind; facing: 1 | -1; lever: -1 | 0 | 1 }[], at: Cursor): boolean {
    const sim = this.game.sim;
    const r = sim.addTrain(
      cars.map((c) => c.kind),
      at,
    );
    if (r.kind !== "placed") return false;
    const t = sim.getTrain(r.trainId)!;
    t.cars.forEach((car, i) => {
      if (cars[i].facing === -1) sim.flipCar(car.id);
      if (car.kind === "engine") sim.setLever(car.id, cars[i].lever);
    });
    return true;
  }

  private trainGhost(cars: { kind: CarKind; facing: 1 | -1 }[]): Group {
    const g = new Group();
    let x = 0;
    cars.forEach((c, i) => {
      const spec = CAR_SPECS[c.kind];
      if (i > 0) x -= COUPLER_GAP + spec.length / 2;
      const model = buildCarModel(c.kind, this.game.mats, i).root;
      model.position.x = x - (i === 0 ? spec.length / 2 - spec.bogieInset : 0);
      if (c.facing === -1) model.rotation.y = Math.PI;
      g.add(model);
      x = model.position.x - spec.length / 2;
    });
    g.visible = false;
    this.game.scene.add(g);
    return g;
  }

  // ---- keyboard ---------------------------------------------------------------------------------------------

  private onKey(e: KeyboardEvent): void {
    if ((e.target as HTMLElement)?.tagName === "INPUT") return;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === "z") {
      e.preventDefault();
      if (e.shiftKey) this.editor().redo();
      else this.editor().undo();
    } else if (mod && e.key.toLowerCase() === "y") {
      e.preventDefault();
      this.editor().redo();
    } else if (e.key === "r" || e.key === "R") this.rotateSelected();
    else if (e.key === "f" || e.key === "F") this.flipSelected();
    else if (e.key === "Delete" || e.key === "Backspace") this.deleteSelected();
    else if (e.key === "Escape") {
      this.cancel();
      this.clearSelection();
      this.hud.hideCards();
    }
  }

  // ---- helpers ----------------------------------------------------------------------------------------------

  private lastPointerWasTouch = false;

  /** For touch drags: the ground point a little above the finger on screen. */
  private touchLift(x: number, y: number): Vector3 | null {
    return this.groundAt(x, y - 60);
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
    const hits = this.raycaster.intersectObjects([g.trainView.group, g.trackView.group], true);
    for (const h of hits) {
      const carId = g.trainView.carAt(h.object as Object3D);
      if (carId !== -1) return { kind: "car", carId };
      if (h.object.userData.kind === "switch-lever") return { kind: "lever", pieceId: h.object.userData.pieceId as number };
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

  /** Track whether the latest pointer is touch (for the lifted drag offset). */
  notePointer(e: PointerEvent): void {
    this.lastPointerWasTouch = e.pointerType === "touch";
  }
}

import { Group, Vector3, type Material, type Mesh } from "three";
import { Line2 } from "three/examples/jsm/lines/Line2.js";
import { LineGeometry } from "three/examples/jsm/lines/LineGeometry.js";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import type { Editor } from "../editor/editor";
import { CELL, looseHeight } from "../landscape";
import { dustPuff } from "../render/dust";
import { delayed, settle } from "../render/flourishes";
import { ghostMesh } from "../render/track-view";
import {
  candidatesFrom,
  createWorldConnector,
  DrawLine,
  findOverlap,
  fitAutoStraight,
  getPieceDef,
  JOINT_ANGLE_TOLERANCE,
  JOINT_POS_TOLERANCE,
  Layout,
  normalizeAngle,
  solveParentPose,
  startHeading,
  transformPose,
  type DrawCandidate,
  type DrawEnd,
  type DrawnPiece,
  type PieceTypeId,
  type Pose,
} from "../track";
import type { Game } from "./game";
import { TRACK_ITEMS } from "../ui/tray-catalogue";

/** A piece's name as the tray shows it, in lower case ("long", "curve"). */
function pieceName(type: PieceTypeId): string {
  const item = TRACK_ITEMS.find((i) => i.kind === "piece" && i.type === type && !i.auto);
  return (item?.label ?? type).toLowerCase() + (item && item.label.includes("curve") ? "s" : " pieces");
}

/** A press this close (screen px) to a free end of track continues the line from it. */
const END_REACH_PX = 44;
/** A new line's first end lands on this grid (mm), as a loose piece does. */
const START_GRID = CELL / 4;
/** A new line waits until the finger has moved this far (mm), to know which way it goes. */
const START_MOVE = 30;
/** Drawn pieces go down one after another, this far apart (seconds). */
const RIPPLE = 0.045;
/** At most this many of them click as they go down (a long line would be a drum roll). */
const CLICKS = 12;

/** Why a drawn piece can't go somewhere: the reason a held piece would give (for the toast), or "self" (the line crosses itself). */
export type DrawBlock = string;

export interface DrawHooks {
  /** Can a piece go here (a held piece's checks)? Null and the risers it'd need, or why not. */
  placement(type: PieceTypeId, flipped: boolean, pose: Pose, y: number): { reason: string | null; risers: unknown[] };
  /** The message for a reason `placement` gave. */
  message(reason: string): string;
  /** Screen point to a point at that height (mm) on the map. */
  planeAt(x: number, y: number, height: number): Vector3 | null;
  /** World point to screen point. */
  toScreen(v: Vector3): { x: number; y: number } | null;
  toast(text: string): void;
  /** A ghost was added to the line (a soft tick). */
  onGrow(): void;
  /** One of the drawn pieces went down (a click; `i` counts from the line's start). */
  onPlaced(i: number): void;
}

/**
 * Drawing track (the tray's Draw chip): a finger drawn from a free end, or across empty ground, lays a run of track
 * behind it, shown as ghosts until it's lifted. See docs/superpowers/specs/2026-10-15-draw-track-design.md.
 */
export class DrawHand {
  /** How many of each piece the line may use (Game mode: the player's stock), or null for no limit. */
  stock: ((type: PieceTypeId) => number) | null = null;
  private line: DrawLine | null = null;
  /** A new line on empty ground, before the finger has moved far enough to know which way it goes. */
  private origin: Vector3 | null = null;
  private ghosts: { mesh: Mesh; key: string }[] = [];
  /** The stroke still ahead of the line's end, drawn as a pencil line on the ground: light, with a dark edge, wide
   * enough to see beside a finger (pixels on screen, however far off the view is). */
  private readonly trail = new Group();
  private readonly trailLines: { line: Line2; material: LineMaterial }[] = [];
  private readonly trailPoints: number[] = [];
  /** The line's own pieces, as a layout, so it can't cross itself. */
  private readonly own = new Layout();
  private ownCount = -1;
  /** Ghosts are a little bolder than a held piece's preview: a line is several of them, seen from further out. */
  private readonly okMat: Material;
  private readonly blockedMat: Material;

  constructor(
    private readonly game: Game,
    private readonly editor: () => Editor,
    private readonly hooks: DrawHooks,
  ) {
    this.okMat = Object.assign(game.mats.trackGhostSnap.clone(), { opacity: 0.85 });
    this.blockedMat = Object.assign(game.mats.trackGhostBlocked.clone(), { opacity: 0.85 });
    // The dark edge under, then the light line.
    for (const [color, width, order] of [["#3a2614", 5, 20], ["#fff6e0", 3, 21]] as const) {
      const material = new LineMaterial({ color, linewidth: width, transparent: true, opacity: 0.9, depthTest: false });
      const line = new Line2(new LineGeometry(), material);
      line.renderOrder = order;
      line.frustumCulled = false;
      this.trail.add(line);
      this.trailLines.push({ line, material });
    }
    this.trail.visible = false;
    game.scene.add(this.trail);
  }

  get active(): boolean {
    return this.line !== null || this.origin !== null;
  }

  /**
   * A press at screen point (x, y): continue from a free end there, or start a new line on empty ground. False if
   * there's no ground under it.
   */
  begin(x: number, y: number): boolean {
    this.clear();
    const end = this.freeEndAt(x, y);
    if (end) {
      this.start(end);
      return true;
    }
    const ground = this.hooks.planeAt(x, y, 0);
    if (!ground) return false;
    this.origin = ground;
    return true;
  }

  /** The finger moved to screen point (x, y). */
  move(x: number, y: number): void {
    if (this.origin) {
      const p = this.hooks.planeAt(x, y, 0);
      if (!p) return;
      const dx = p.x - this.origin.x;
      const dz = p.z - this.origin.z;
      if (Math.hypot(dx, dz) < START_MOVE) return;
      // A new line: its first end on the grid, pointing the way the finger set off (in eighths of a turn).
      const heading = startHeading(dx, dz);
      const sx = Math.round(this.origin.x / START_GRID) * START_GRID;
      const sz = Math.round(this.origin.z / START_GRID) * START_GRID;
      const y0 = looseHeight(this.game.landscape, this.game.layout, "straight-54", false, { x: sx, z: sz, heading }, -1);
      this.origin = null;
      this.start({ x: sx, z: sz, heading, y: y0, kind: "peg" });
    }
    const line = this.line;
    if (!line) return;
    const p = this.hooks.planeAt(x, y, line.start.y);
    if (!p) return;
    const before = line.pieces.length;
    if (line.addPoint(p.x, p.z)) this.sync(line.pieces.length > before);
    this.drawTrail();
  }

  /** The finger lifted: the line goes down (as far as it may), one piece after another. */
  end(): void {
    const line = this.line;
    if (!line) {
      this.clear();
      return;
    }
    line.finish();
    this.sync(false);
    const pieces = line.placeable();
    const g = this.game;
    const ghosts = this.ghosts.splice(0, pieces.length);
    const blocked = line.pieces.find((p) => p.blocked)?.blocked;
    if (blocked) this.hooks.toast(blocked);
    else if (line.refused) this.hooks.toast(`No ${pieceName(line.refused)} left: the line used other pieces`);
    this.clear();
    if (pieces.length === 0) return;
    const ids = this.editor().placeRun(pieces.map((p) => ({ type: p.type, pose: p.pose, y: p.y, flipped: p.flipped })));
    pieces.forEach((p, i) => {
      const id = ids[i];
      const mesh = ghosts[i].mesh;
      mesh.material = [g.mats.track, g.mats.trackCut, g.mats.bridgePaint];
      g.trackView.setHidden(id, true);
      const to = { x: p.pose.x, y: p.y, z: p.pose.z, heading: p.pose.heading };
      const from = { ...to, y: p.y + 14 };
      g.flourishes.add(
        delayed(i * RIPPLE, () => {
          if (i < CLICKS || i === pieces.length - 1) this.hooks.onPlaced(i);
          if (i === pieces.length - 1 && line.stopped === "closed") {
            const e = p.end;
            g.flourishes.add(dustPuff(g.scene, e.x, e.y, e.z));
          }
          return settle(mesh, from, to, () => {
            g.scene.remove(mesh);
            g.trackView.setHidden(id, false);
          });
        }),
      );
    });
    g.invalidate();
  }

  /** Is there a free end of track near screen point (x, y) to draw on from? */
  nearFreeEnd(x: number, y: number): boolean {
    return this.freeEndAt(x, y) !== null;
  }

  /** Put the line away (nothing laid). */
  cancel(): void {
    this.clear();
  }

  private start(end: DrawEnd): void {
    this.ownCount = -1;
    this.line = new DrawLine(end, {
      check: (c, line) => this.check(c, line),
      allow: this.stock ? (type, line) => line.filter((p) => p.type === type).length < this.stock!(type) : undefined,
      meet: (e) => this.meet(e),
      closes: (e) => this.closes(e),
    });
  }

  /**
   * May a drawn piece go here: on the land and clear of other track (the line's own pieces too), resting on what's
   * under it? Null, or why not (as the toast says it).
   */
  private check(c: DrawCandidate, line: readonly DrawnPiece[]): string | null {
    const { reason, risers } = this.hooks.placement(c.type, c.flipped, c.pose, c.y);
    // A drawn line stays at its height: no risers are put in under it.
    const why = reason ?? (risers.length > 0 ? "unsupported" : null);
    if (why) return this.hooks.message(why);
    if (this.ownCount !== line.length) {
      for (const id of [...this.own.pieceIds()]) this.own.removePiece(id);
      for (const p of line) this.own.addPiece(p.type, p.pose, p.y, p.flipped);
      this.ownCount = line.length;
    }
    if (findOverlap(this.own, c.type, c.flipped, c.pose, c.y, -1) !== -1) return "The line would cross itself";
    return null;
  }

  /** The Auto piece's fit from the line's end onto a free end of track just ahead of it (or a little to one side). */
  private meet(e: DrawEnd): DrawCandidate | null {
    const seated = e.kind === "peg" ? 0 : 1;
    const long = getPieceDef("straight-216", false);
    const pose = solveParentPose(long.connectors[seated].pose, { x: e.x, z: e.z, heading: e.heading + Math.PI }, { x: 0, z: 0, heading: 0 });
    const fit = fitAutoStraight(this.game.layout, pose, e.y, seated, []);
    if (!fit) return null;
    const def = getPieceDef(fit.type, fit.flipped);
    if (def.connectors.length !== 2) return null;
    const exit = 1 - seated;
    const w = transformPose(fit.pose, def.connectors[exit].pose, { x: 0, z: 0, heading: 0 });
    return { type: fit.type, flipped: fit.flipped, pose: fit.pose, y: e.y, entry: seated, exit, length: fit.length, end: { x: w.x, z: w.z, heading: w.heading, y: e.y, kind: def.connectors[exit].kind } };
  }

  /** Does the line end seated on a free end of other track here (any kind: any two ends join)? */
  private closes(e: DrawEnd): boolean {
    const near: number[] = [];
    const w = createWorldConnector();
    const n = this.game.layout.queryFreeConnectors(e.x, e.z, JOINT_POS_TOLERANCE, near);
    for (let i = 0; i < n; i++) {
      this.game.layout.worldConnector(near[i], w);
      if (Math.abs(w.y - e.y) > 2) continue;
      if (Math.hypot(w.x - e.x, w.z - e.z) > JOINT_POS_TOLERANCE) continue;
      if (Math.abs(normalizeAngle(w.heading - e.heading - Math.PI)) <= JOINT_ANGLE_TOLERANCE) return true;
    }
    return false;
  }

  /** A free end of track near screen point (x, y), as the end the line goes on from. */
  private freeEndAt(x: number, y: number): DrawEnd | null {
    const g = this.game;
    const ground = this.hooks.planeAt(x, y, 0);
    if (!ground) return null;
    const near: number[] = [];
    const w = createWorldConnector();
    // Wide enough for ends up on raised track, which show nearer the camera than the ground under them.
    const n = g.layout.queryFreeConnectors(ground.x, ground.z, 400, near);
    let best: DrawEnd | null = null;
    let bestPx = END_REACH_PX;
    for (let i = 0; i < n; i++) {
      g.layout.worldConnector(near[i], w);
      // Only ends a straight could go on from (not a riser's, or the inside of a joiner's).
      if (candidatesFrom({ ...w }, ["straight-54"]).length === 0) continue;
      const s = this.hooks.toScreen(new Vector3(w.x, w.y, w.z));
      if (!s) continue;
      const d = Math.hypot(s.x - x, s.y - y);
      if (d < bestPx) {
        bestPx = d;
        best = { x: w.x, z: w.z, heading: w.heading, y: w.y, kind: w.kind };
      }
    }
    return best;
  }

  /** Bring the ghosts in line with the line's pieces: new ones added (with a tick), ones taken off removed. */
  private sync(grew: boolean): void {
    const g = this.game;
    const pieces = this.line?.pieces ?? [];
    let i = 0;
    for (; i < pieces.length; i++) {
      const p = pieces[i];
      const key = `${p.type}|${p.flipped}|${p.pose.x.toFixed(1)}|${p.pose.z.toFixed(1)}|${p.pose.heading.toFixed(3)}|${p.blocked}`;
      if (this.ghosts[i]?.key === key) continue;
      if (this.ghosts[i]) g.scene.remove(this.ghosts[i].mesh);
      const mesh = ghostMesh(p.type, p.flipped, p.blocked ? this.blockedMat : this.okMat);
      mesh.matrixAutoUpdate = false;
      mesh.matrix.makeRotationY(-p.pose.heading);
      mesh.matrix.setPosition(p.pose.x, p.y + 1, p.pose.z);
      g.scene.add(mesh);
      this.ghosts[i] = { mesh, key };
    }
    for (const gh of this.ghosts.splice(i)) g.scene.remove(gh.mesh);
    if (grew) this.hooks.onGrow();
    g.invalidate();
  }

  private drawTrail(): void {
    const line = this.line;
    if (!line) {
      this.trail.visible = false;
      return;
    }
    const n = Math.min(1024, line.ahead(this.trailPoints));
    this.trail.visible = n > 1;
    if (n > 1) {
      const y = line.start.y + 3;
      const positions = new Float32Array(3 * n);
      for (let i = 0; i < n; i++) positions.set([this.trailPoints[2 * i], y, this.trailPoints[2 * i + 1]], 3 * i);
      const canvas = this.game.canvas;
      for (const { line: l, material } of this.trailLines) {
        // A new geometry each time (a LineGeometry's buffers are sized to its points); the old one freed.
        const geometry = new LineGeometry();
        geometry.setPositions(positions);
        l.geometry.dispose();
        l.geometry = geometry;
        material.resolution.set(canvas.clientWidth, canvas.clientHeight);
      }
    }
    this.game.invalidate();
  }

  private clear(): void {
    for (const gh of this.ghosts) this.game.scene.remove(gh.mesh);
    this.ghosts = [];
    this.line = null;
    this.origin = null;
    this.trail.visible = false;
    this.game.invalidate();
  }
}

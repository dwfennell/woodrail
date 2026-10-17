import { Group, Vector3, type InterleavedBuffer, type InterleavedBufferAttribute, type Material, type Mesh } from "three";
import { Line2 } from "three/examples/jsm/lines/Line2.js";
import { LineGeometry } from "three/examples/jsm/lines/LineGeometry.js";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import type { Editor } from "../editor/editor";
import { archFloors, bridgeLevels, CELL, cutsHills, hillsOf, looseHeight, type HillCut } from "../landscape";
import { dustPuff } from "../render/dust";
import { delayed, settle } from "../render/flourishes";
import { ghostMesh } from "../render/track-view";
import {
  candidatesFrom,
  canStandOnArches,
  createWorldConnector,
  DRAW_LOOKAHEAD,
  DrawLine,
  findOverlap,
  fitAutoStraight,
  getPieceDef,
  JOINT_ANGLE_TOLERANCE,
  JOINT_POS_TOLERANCE,
  Layout,
  normalizeAngle,
  solveParentPose,
  transformPose,
  type DrawCandidate,
  type DrawCheck,
  type DrawEnd,
  type DrawnPiece,
  type PieceTypeId,
  type Pose,
} from "../track";
import type { Game } from "./game";
import { drawRefusal } from "./track-rules";
import { TRACK_ITEMS } from "../ui/tray-catalogue";

/** A piece's name as the tray shows it, in lower case ("long", "curve"). */
function pieceName(type: PieceTypeId): string {
  const item = TRACK_ITEMS.find((i) => i.kind === "piece" && i.type === type && !i.auto);
  const name = (item?.label ?? type).toLowerCase();
  return name + (name.includes("curve") ? "s" : " pieces");
}

/** The most points the pencil line ahead of the track shows. */
const TRAIL_POINTS = 1024;

/** The finger this far (mm) on with the line not growing (and nothing in its way): it's stuck, and says why. */
const STALL_MM = 2 * DRAW_LOOKAHEAD + 100;

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
  /** Game mode: what to say of a piece the player hasn't learned yet ("Ramp: not learned yet"), or null if they have. */
  unlearned: ((type: PieceTypeId) => string | null) | null = null;
  /** The ramp whose cutting shows while drawing (the line's last), as a key, or "" for none. */
  private cutKey = "";
  /** The height (mm) the finger is seen at, on the plane the stroke is drawn on: the line's end's, as of the last move. */
  private seenAt = 0;
  private line: DrawLine | null = null;
  /** This stroke's "too sharp" (or "out of") said already. */
  private toldStalled = false;
  /** How far the finger has gone (mm) since the line last grew, and where it was. */
  private sinceGrown = 0;
  private last: { x: number; z: number } | null = null;
  /** A new line on empty ground, before the finger has moved far enough to know which way it goes. */
  private origin: Vector3 | null = null;
  private ghosts: { mesh: Mesh; key: string }[] = [];
  /** The stroke still ahead of the line's end, drawn as a pencil line on the ground: light, with a dark edge, wide
   * enough to see beside a finger (pixels on screen, however far off the view is). */
  private readonly trail = new Group();
  private readonly trailLines: { line: Line2; material: LineMaterial }[] = [];
  private readonly trailGeometry = new LineGeometry();
  /** The trail's segments (start and end point each), written in place. */
  private readonly trailSegments: InterleavedBuffer;
  private readonly trailPoints: number[] = [];
  /** The line's own pieces, as a layout, so it can't cross itself. */
  private readonly own = new Layout();
  /** The pieces in `own` (the line's, as it was last asked about) and their ids there. */
  private readonly ownPieces: DrawnPiece[] = [];
  private readonly ownIds: number[] = [];
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
    // The dark edge under, then the light line: one geometry, made once for as many points as the trail can have, and
    // filled in place as the finger moves (nothing made anew on a pointer move).
    this.trailGeometry.setPositions(new Float32Array(3 * TRAIL_POINTS));
    this.trailSegments = (this.trailGeometry.getAttribute("instanceStart") as InterleavedBufferAttribute).data;
    for (const [color, width, order] of [["#3a2614", 5, 20], ["#fff6e0", 3, 21]] as const) {
      const material = new LineMaterial({ color, linewidth: width, transparent: true, opacity: 0.9, depthTest: false });
      const line = new Line2(this.trailGeometry, material);
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
      const heading = Math.round(Math.atan2(dz, dx) / (Math.PI / 4)) * (Math.PI / 4);
      const sx = Math.round(this.origin.x / START_GRID) * START_GRID;
      const sz = Math.round(this.origin.z / START_GRID) * START_GRID;
      const y0 = looseHeight(this.game.landscape, this.game.layout, "straight-54", false, { x: sx, z: sz, heading }, -1);
      this.origin = null;
      this.start({ x: sx, z: sz, heading, y: y0, kind: "peg" });
    }
    const line = this.line;
    if (!line) return;
    // Seen at the height the line has got to: up on a hill, the finger is over the hilltop. (The line went up or down
    // a level: the stroke still ahead moves to where it's seen at the new height, so it runs on without a jump.)
    if (line.end.y !== this.seenAt) {
      const was = this.hooks.planeAt(x, y, this.seenAt);
      const now = this.hooks.planeAt(x, y, line.end.y);
      if (was && now) line.shiftAhead(now.x - was.x, now.z - was.z);
      this.seenAt = line.end.y;
    }
    const p = this.hooks.planeAt(x, y, this.seenAt);
    if (!p) return;
    const before = line.pieces.length;
    if (this.last) this.sinceGrown += Math.hypot(p.x - this.last.x, p.z - this.last.z);
    this.last = { x: p.x, z: p.z };
    if (line.addPoint(p.x, p.z)) this.sync(line.pieces.length > before);
    // (Grown or taken back: not stuck. Nor while going back over the line.)
    if (line.pieces.length !== before || line.goingBack) this.sinceGrown = 0;
    // Stuck behind the finger (a corner no piece can turn, a circle too tight, or no piece left that fits): say why,
    // once a stroke, rather than the line just stopping. (Not where it's blocked: that ghost shows red.)
    const stuck = line.stalled || (this.sinceGrown > STALL_MM && !line.stopped && !line.pieces.some((q) => q.blocked));
    if (stuck && !this.toldStalled) {
      this.toldStalled = true;
      this.hooks.toast(line.refused ? this.outOf(line.refused) : "Too sharp: draw a wider bend");
    }
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
    // (A closed line has nothing past where it closed: nothing to say.)
    const blocked = line.stopped === "closed" ? null : line.pieces.find((p) => p.blocked)?.blocked;
    if (blocked) this.hooks.toast(blocked);
    else if (line.refused) this.hooks.toast(`No ${pieceName(line.refused)} left${pieces.length > 0 ? ": the line used other pieces" : ""}`);
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
    this.toldStalled = false;
    this.sinceGrown = 0;
    this.seenAt = end.y;
    this.last = null;
    const hills = hillsOf(this.game.landscape.grid);
    this.line = new DrawLine(end, {
      check: (c, line) => this.check(c, line),
      allow: this.stock ? (type, line) => line.filter((p) => p.type === type).length < this.stock!(type) : undefined,
      meet: (e) => this.meet(e),
      closes: (e) => this.closes(e),
      groundAt: (x, z) => hills.groundAt(x, z),
      outOf: (type) => this.outOf(type),
    });
  }

  /** What to say of a piece the line needed and the player has none of: not learned yet, or none left in the box. */
  private outOf(type: PieceTypeId): string {
    return this.unlearned?.(type) ?? `Out of ${pieceName(type)}`;
  }

  /**
   * May a drawn piece go here: on the land and clear of other track (the line's own pieces too), resting on what's
   * under it? Null, or why not: the reason code (so the line can tell a hill from a river, see `drawRefusal`) and the
   * message, as the toast says it.
   */
  private check(c: DrawCandidate, line: readonly DrawnPiece[]): DrawCheck | null {
    const { reason, risers } = this.hooks.placement(c.type, c.flipped, c.pose, c.y);
    // A drawn line puts in no risers under it: needing them is "unsupported".
    const why = drawRefusal(this.game.landscape, c.type, c.flipped, c.pose, c.y, reason, risers);
    if (why) return { reason: why.reason, message: this.hooks.message(why.reason), levels: why.levels };
    this.syncOwn(line);
    if (findOverlap(this.own, c.type, c.flipped, c.pose, c.y, -1) !== -1) return { reason: "self", message: "The line would cross itself" };
    return null;
  }

  /**
   * The line's own pieces so far, in a scratch layout (for crossing itself, and closing a loop on its own start). Kept
   * in step piece by piece: only those after the part it already holds come off and go on (it's asked about the line
   * with and without its last piece in turn, a few times for each piece laid).
   */
  private syncOwn(line: readonly DrawnPiece[]): void {
    const held = this.ownPieces;
    let k = 0;
    while (k < held.length && k < line.length && held[k] === line[k]) k++;
    while (held.length > k) {
      this.own.removePiece(this.ownIds.pop()!);
      held.pop();
    }
    for (let i = k; i < line.length; i++) {
      const p = line[i];
      this.ownIds.push(this.own.addPiece(p.type, p.pose, p.y, p.flipped));
      held.push(p);
    }
  }

  /** The layouts a line can close onto: the map's track, and its own (a loop back to where it started). */
  private closable(last: "with" | "without"): Layout[] {
    if (!this.line) return [this.game.layout];
    // (Asked whether the piece just laid closes the line, the line's own track is what was there before it: else
    // that piece would already be seated on the start it's meant to find free.)
    this.syncOwn(last === "with" ? this.line.pieces : this.line.pieces.slice(0, -1));
    return [this.game.layout, this.own];
  }

  /**
   * The Auto piece's fit from the line's end onto a free end of track just ahead of it (or a little to one side): one
   * that closes it (not the first of two, which would leave a gap).
   */
  private meet(e: DrawEnd): DrawCandidate | null {
    const seated = e.kind === "peg" ? 0 : 1;
    const long = getPieceDef("straight-216", false);
    const pose = solveParentPose(long.connectors[seated].pose, { x: e.x, z: e.z, heading: e.heading + Math.PI }, { x: 0, z: 0, heading: 0 });
    let fit: ReturnType<typeof fitAutoStraight> = null;
    for (const layout of this.closable("with")) {
      const f = fitAutoStraight(layout, pose, e.y, seated, []);
      if (f && !f.gap) {
        fit = f;
        break;
      }
    }
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
    for (const layout of this.closable("without")) {
      const n = layout.queryFreeConnectors(e.x, e.z, JOINT_POS_TOLERANCE, near);
      for (let i = 0; i < n; i++) {
        layout.worldConnector(near[i], w);
        if (Math.abs(w.y - e.y) > 2) continue;
        if (Math.hypot(w.x - e.x, w.z - e.z) > JOINT_POS_TOLERANCE) continue;
        // Facing it (the line's own end, where it is now, faces the same way: not that).
        if (Math.abs(normalizeAngle(w.heading - e.heading - Math.PI)) <= JOINT_ANGLE_TOLERANCE) return true;
      }
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
      const key = `${p.type}|${p.flipped}|${p.pose.x.toFixed(1)}|${p.pose.z.toFixed(1)}|${p.pose.heading.toFixed(3)}|${p.y}|${p.blocked}`;
      if (this.ghosts[i]?.key === key) continue;
      if (this.ghosts[i]) g.scene.remove(this.ghosts[i].mesh);
      // A bridge (or a ramp up off the ground) on its arches, as it will stand.
      const levels = canStandOnArches(p.type) ? bridgeLevels(g.landscape, p.type, p.flipped, p.pose, p.y) : 0;
      const floors = levels > 0 ? archFloors(g.landscape, p.type, p.flipped, p.pose, p.y, levels) : null;
      const mesh = ghostMesh(p.type, p.flipped, p.blocked ? this.blockedMat : this.okMat, levels, floors);
      mesh.matrixAutoUpdate = false;
      mesh.matrix.makeRotationY(-p.pose.heading);
      mesh.matrix.setPosition(p.pose.x, p.y + 1, p.pose.z);
      g.scene.add(mesh);
      this.ghosts[i] = { mesh, key };
    }
    for (const gh of this.ghosts.splice(i)) g.scene.remove(gh.mesh);
    this.showCut(pieces);
    if (grew) this.hooks.onGrow();
    g.invalidate();
  }

  /**
   * The cutting the line's last ramp makes, shown in the hill while drawing (as a held ramp's is), so its ghost isn't
   * hidden inside the hill. Only when that ramp changes (the hill's cut blocks are rebuilt for it).
   */
  private showCut(pieces: readonly DrawnPiece[]): void {
    let cut: HillCut | undefined;
    for (let i = pieces.length - 1; i >= 0 && !cut; i--) {
      const p = pieces[i];
      if (!p.blocked && cutsHills(p.type)) cut = { pose: { ...p.pose }, y: p.y, type: p.type, flipped: p.flipped };
    }
    const key = cut ? `${cut.pose.x}|${cut.pose.z}|${cut.pose.heading}|${cut.y}|${cut.flipped}` : "";
    if (key === this.cutKey) return;
    this.cutKey = key;
    this.game.landscapeView.previewCut(cut);
  }

  private drawTrail(): void {
    const line = this.line;
    if (!line) {
      this.trail.visible = false;
      return;
    }
    const n = Math.min(TRAIL_POINTS, line.ahead(this.trailPoints));
    this.trail.visible = n > 1;
    if (n > 1) {
      const y = line.end.y + 3;
      const a = this.trailSegments.array as Float32Array;
      const pts = this.trailPoints;
      for (let i = 0; i + 1 < n; i++) {
        const k = 6 * i;
        a[k] = pts[2 * i];
        a[k + 1] = y;
        a[k + 2] = pts[2 * i + 1];
        a[k + 3] = pts[2 * i + 2];
        a[k + 4] = y;
        a[k + 5] = pts[2 * i + 3];
      }
      this.trailSegments.needsUpdate = true;
      this.trailGeometry.instanceCount = n - 1;
      const canvas = this.game.canvas;
      for (const { material } of this.trailLines) material.resolution.set(canvas.clientWidth, canvas.clientHeight);
    }
    this.game.invalidate();
  }

  private clear(): void {
    for (const gh of this.ghosts) this.game.scene.remove(gh.mesh);
    if (this.cutKey) {
      this.cutKey = "";
      this.game.landscapeView.previewCut(undefined);
    }
    this.ghosts = [];
    this.line = null;
    this.origin = null;
    this.trail.visible = false;
    this.game.invalidate();
  }
}

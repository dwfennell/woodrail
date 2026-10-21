import { Group, Vector3, type InterleavedBuffer, type InterleavedBufferAttribute, type Material, type Mesh } from "three";
import { Line2 } from "three/examples/jsm/lines/Line2.js";
import { LineGeometry } from "three/examples/jsm/lines/LineGeometry.js";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import type { Editor } from "../editor/editor";
import { bridgeLevels, CELL, cutsHills, hillsOf, inRiver, isWater, looseHeight } from "../landscape";
import { dustPuff } from "../render/dust";
import { delayed, settle } from "../render/flourishes";
import { ghostMesh, pieceGeometry } from "../render/track-view";
import {
  candidatesFrom,
  canStandOnArches,
  connectorRef,
  createWorldConnector,
  DrawLine,
  findOverlap,
  fitAutoStraight,
  getPieceDef,
  JOINT_ANGLE_TOLERANCE,
  JOINT_POS_TOLERANCE,
  Layout,
  normalizeAngle,
  pieceOfRef,
  solveParentPose,
  transformPose,
  type DrawCandidate,
  type DrawCheck,
  type DrawEnd,
  type DrawnPiece,
  type PieceSwap,
  type PieceTypeId,
  type SwapPiece,
  type Pose,
} from "../track";
import type { Game } from "./game";
import { DrawNotice, TOO_SHARP } from "./draw-notice";
import { drawMessage, drawRefusal } from "./track-rules";
import { branchAgain, branchFrom, facingFrom, busyOn, crossingAt, junctionWhy, linePlan, mergeAt, mergePast, type JunctionRules, type Merge } from "./draw-junctions";
import { pieceName } from "./piece-name";

/** The pencil line starts at the line's end if that's this close (mm) to the stroke ahead. */
const TRAIL_JOIN = 40;
/** The most points the pencil line ahead of the track shows. */
const TRAIL_POINTS = 1024;

/** A press this close (screen px) to a free end of track continues the line from it. */
const END_REACH_PX = 44;
/** A new line's first end lands on this grid (mm), as a loose piece does. */
const START_GRID = CELL / 4;
/** A new line waits until the finger has moved this far (mm), to know which way it goes. */
const START_MOVE = 30;
/** A crossing goes in once the finger is this far (mm) past its far end (until then it may yet stop on the line: a merge). */
const CROSS_ON = 120;
/** A drawn line's end left this near (mm, and radians) a free end it faces, unjoined, says why (see `DrawNotice.unjoined`). */
const UNJOINED_REACH = 160;
const UNJOINED_ANGLE = (20 * Math.PI) / 180;
/** (Only if the finger was let go no more than this (mm) short of that end.) */
const UNJOINED_SHORT = 40;
/** Drawn pieces go down one after another, this far apart (seconds). */
const RIPPLE = 0.045;
/** At most this many of them click as they go down (a long line would be a drum roll). */
const CLICKS = 12;

/** Why a drawn piece can't go somewhere: the reason a held piece would give (for the toast), or "self" (the line crosses itself). */
export type DrawBlock = string;

export interface DrawHooks {
  /** Can a piece go here (a held piece's checks, the pieces in `ignore` left out)? Null and the risers it'd need, or why not. */
  placement(type: PieceTypeId, flipped: boolean, pose: Pose, y: number, ignore?: ReadonlySet<number>): { reason: string | null; risers: unknown[] };
  /** Is a train on this piece? */
  occupied(pieceId: number): boolean;
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
  private line: DrawLine | null = null;
  /** What the line says as it goes, and when it's lifted ("Too sharp", a piece it may not use, where it's blocked). */
  private readonly notice = new DrawNotice(
    (type) => this.outOf(type),
    pieceName,
    (type) => this.unlearned?.(type) ?? null,
  );
  /** A new line on empty ground, before the finger has moved far enough to know which way it goes. */
  private origin: Vector3 | null = null;
  /** The finger's points (on the ground) since `origin`, before the line began (see `move`). */
  private originPts: { x: number; z: number }[] = [];
  private ghosts: { mesh: Mesh; key: string }[] = [];
  /**
   * A press on a line's body (a plain straight), waiting for the finger to go off the line to know which way the
   * branch leaves: the straight, and where it was pressed (on the track, at its height).
   */
  private pending: { onto: number; press: { x: number; z: number }; y: number; way: number | null } | null = null;
  /** The press the branch was decided from (to face it the other way if the line from it laid nothing: `end`). */
  private branchStart: { onto: number; press: { x: number; z: number } } | null = null;
  /**
   * The finger's points (on the ground) since the branch was decided, while its line has laid nothing (it waits for the
   * finger to get ahead of its start, so it may have taken none): to draw it again from the other facing (`end`).
   */
  private branchStroke: { x: number; z: number }[] = [];
  /** The switch the line branches off through (swapped into the line it started on), or null. */
  private branch: PieceSwap | null = null;
  /** The switch the line would merge through if let go now (shown), or null; and its key, so it's shown afresh only when it changes. */
  private merge: Merge | null = null;
  private mergeKey = "";
  /** Ghosts of the swaps' pieces (the branch's, then the merge's), and the straights they replace (outlined). */
  private swapGhosts: Mesh[] = [];
  /**
   * What the line laid before each crossing it went on through, and the crossings with the straights either side of
   * them (the line goes on from the last one's far end, a new DrawLine): the pieces, the straights they take up, their
   * ghosts, and how many crossings of each type.
   */
  private crossed: { pieces: SwapPiece[]; covers: number[]; ghosts: Mesh[]; used: Map<PieceTypeId, number> } = { pieces: [], covers: [], ghosts: [], used: new Map() };
  private mergeGhosts: Mesh[] = [];
  /** The stroke still ahead of the line's end, drawn as a pencil line on the ground: light, with a dark edge, wide
   * enough to see beside a finger (pixels on screen, however far off the view is). */
  private readonly trail = new Group();
  private readonly trailLines: { line: Line2; material: LineMaterial }[] = [];
  private readonly trailGeometry = new LineGeometry();
  /** The trail's segments (start and end point each), written in place. */
  private readonly trailSegments: InterleavedBuffer;
  private readonly trailPoints: number[] = [];
  /** The straights a branch's switch replaces (left out of the checks), and its pieces' ids in `own`. */
  private branchCovers: ReadonlySet<number> = new Set();
  private swapIds: number[] = [];
  /** The line's own pieces, as a layout, so it can't cross itself. */
  private readonly own = new Layout();
  /** The pieces in `own` (the line's, as it was last asked about) and their ids there. */
  private readonly ownPieces: DrawnPiece[] = [];
  private readonly ownIds: number[] = [];
  /** Ghosts are a little bolder than a held piece's preview: a line is several of them, seen from further out. */
  private readonly okMat: Material;
  private readonly blockedMat: Material;
  /** The same, drawn over whatever's in front (a ramp's ghost, inside the hill it will cut into). */
  private readonly okTopMat: Material;
  private readonly blockedTopMat: Material;

  constructor(
    private readonly game: Game,
    private readonly editor: () => Editor,
    private readonly hooks: DrawHooks,
  ) {
    this.okMat = Object.assign(game.mats.trackGhostSnap.clone(), { opacity: 0.85 });
    this.blockedMat = Object.assign(game.mats.trackGhostBlocked.clone(), { opacity: 0.85 });
    this.okTopMat = Object.assign(this.okMat.clone(), { depthTest: false });
    this.blockedTopMat = Object.assign(this.blockedMat.clone(), { depthTest: false });
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
    return this.line !== null || this.origin !== null || this.pending !== null;
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

  /**
   * A press at screen point (x, y) on a line's body, plain straight `onto`, with drawing on: a branch off it, once the
   * finger has gone off the line (see `branchFrom`). False if a train is on it (and says so), or it's off the map.
   */
  beginBranch(x: number, y: number, onto: number): boolean {
    this.clear();
    const p = this.game.layout.getPiece(onto);
    const at = p && this.hooks.planeAt(x, y, p.y);
    if (!p || !at) return false;
    if (this.hooks.occupied(onto)) {
      this.hooks.toast(busyOn(p.type));
      return false;
    }
    this.pending = { onto, press: { x: at.x, z: at.z }, y: p.y, way: null };
    return true;
  }

  /** Waiting to see which way a branch leaves the line it was pressed on (see `feel`)? */
  get branchPending(): boolean {
    return this.pending !== null;
  }

  /**
   * The finger at screen point (x, y), one of the moves the browser ran together into one event, while a branch waits:
   * the first one `BRANCH_FACING` from the press sets the way the switch faces, so a stroke that has bent by the time
   * a slow phone delivers it still faces the way it set off (one plane hit; nothing else).
   */
  feel(x: number, y: number): void {
    const pending = this.pending;
    if (!pending || pending.way !== null) return;
    const f = this.hooks.planeAt(x, y, pending.y);
    if (f) pending.way = facingFrom(pending.press, [f]);
  }

  /** The rules the junctions are found by (see `JunctionRules`). */
  private readonly junctions: JunctionRules = ((self: DrawHand): JunctionRules => ({
    get layout() {
      return self.game.layout;
    },
    check: (type, flipped, pose, y, ignore) => {
      const { reason, risers } = self.hooks.placement(type, flipped, pose, y, ignore);
      const why = reason ?? (risers.length > 0 ? "unsupported" : null);
      return why ? self.hooks.message(why) : null;
    },
    occupied: (id) => self.hooks.occupied(id),
    may: (type, used) => (!self.stock || self.stock(type) > used ? null : self.outOf(type)),
  }))(this);

  /** The finger moved to screen point (x, y). */
  move(x: number, y: number): void {
    const pending = this.pending;
    if (pending) {
      const f = this.hooks.planeAt(x, y, pending.y);
      if (!f) return;
      this.feel(x, y);
      const b = branchFrom(this.junctions, pending.onto, pending.press, f, pending.way ?? undefined);
      if (b.kind === "wait") return;
      this.pending = null;
      if (b.kind === "refused") {
        this.hooks.toast(b.message);
        this.clear();
        return;
      }
      // The switch shows as a ghost over the straights it takes the place of (outlined), and the line goes on from its branch.
      this.branch = b.swap;
      this.branchStart = { onto: pending.onto, press: pending.press };
      this.swapGhosts = this.showSwap(b.swap);
      this.start(b.swap.end);
    }
    if (this.origin) {
      const p = this.hooks.planeAt(x, y, 0);
      if (!p) return;
      const dx = p.x - this.origin.x;
      const dz = p.z - this.origin.z;
      if (Math.hypot(dx, dz) < START_MOVE) {
        if (this.originPts.length < 64) this.originPts.push({ x: p.x, z: p.z });
        return;
      }
      // A new line: its first end on the grid, pointing the way the finger set off (in eighths of a turn).
      const heading = Math.round(Math.atan2(dz, dx) / (Math.PI / 4)) * (Math.PI / 4);
      const sx = Math.round(this.origin.x / START_GRID) * START_GRID;
      const sz = Math.round(this.origin.z / START_GRID) * START_GRID;
      const y0 = looseHeight(this.game.landscape, this.game.layout, "straight-54", false, { x: sx, z: sz, heading }, -1);
      this.origin = null;
      this.start({ x: sx, z: sz, heading, y: y0, kind: "peg" }, false);
      // The finger's way before the line began goes into its stroke too: so where the line begins along it (a move
      // either side of `START_MOVE`, a hair's difference in the camera after an undo) doesn't change the line (QA:
      // terrace 2 drawn again laid a long straight and then stopped short of the second level).
      for (const q of this.originPts) this.line!.addPoint(q.x, q.z);
      this.originPts = [];
    }
    const line = this.line;
    if (!line) return;
    // (Read at the height the line has got to: see `DrawLine.addSeen`.)
    const before = line.pieces.length;
    const { p, changed } = line.addSeen((h) => this.hooks.planeAt(x, y, h));
    if (!p) return;
    // (Kept only while a branch's line has laid nothing, and no more than a stroke's worth.)
    if (this.branchStart && before === 0 && this.branchStroke.length < 2048) this.branchStroke.push({ x: p.x, z: p.z });
    if (changed) this.sync(line.pieces.length > before);
    this.showMerge();
    this.goOnAcross();
    // Stuck behind the finger (a corner no piece can turn, a circle too tight, or no piece left that fits): say why,
    // once a stroke, rather than the line just stopping (see `DrawNotice`).
    const say = this.notice.moved(line, p, before);
    if (say) this.hooks.toast(say);
    this.drawTrail();
  }

  /**
   * The finger lifted: the line goes down (as far as it may), one piece after another; with the switch it branches off
   * through, and the one it merges through if it was let go on a line it comes in to at 45° (all one undo step).
   */
  end(): void {
    let line = this.line;
    if (!line) {
      this.clear();
      return;
    }
    line.finish();
    this.sync(false);
    let merge = this.mergeNow();
    // Let go a little past a line it ran into (beyond a merge's reach, short of where the stroke goes on across):
    // across it if the finger's past the crossing's far end, else in to it where the stroke meets it (QA: about 70 mm
    // past a line, it laid nothing at all).
    if (!merge && this.goOnAcross(true)) line = this.line!;
    else if (!merge) merge = this.mergeAtLine();
    // A branch faced the way the finger set off, and the finger bent back across so the line laid nothing: faced the
    // way it went instead, if a line from there lays something (QA F2: 100° then 45°, nothing laid, nothing said).
    const tried = this.branch;
    let unlaid = false;
    if (tried && this.branchStart && !merge && this.crossed.covers.length === 0 && line.placeable().length === 0) {
      const old = line;
      const pts = this.branchStroke;
      const finger = pts[pts.length - 1] ?? line.tip;
      const again = branchAgain(this.junctions, this.branchStart.onto, this.branchStart.press, finger, tried, pts, (e, swap) => {
        this.branch = swap;
        this.start(e);
        return this.line!;
      });
      if (again) {
        line = again.line;
        this.branch = again.swap;
        for (const m of this.swapGhosts) this.game.scene.remove(m);
        this.swapGhosts = [];
        this.sync(false);
        merge = this.mergeNow();
      } else {
        this.branch = tried;
        line = old;
        unlaid = true;
      }
    }
    const pieces = line.placeable();
    const g = this.game;
    const branch = this.branch;
    const plan = linePlan(branch, pieces, merge, this.crossed);
    const ghosts = this.ghosts.splice(0, merge ? merge.keep : pieces.length);
    // A train come onto the straights a switch would take the place of meanwhile: nothing goes down.
    const busy = plan.covers.some((id) => this.hooks.occupied(id));
    let say: string | null = null;
    if (busy) this.hooks.toast(busyOn(g.layout.getPiece(plan.covers.find((id) => this.hooks.occupied(id))!)?.type ?? "straight-216"));
    else {
      // (Merged, it's closed onto that line: nothing past it to say.)
      say = this.notice.lifted(line, pieces.length, !!merge);
      // Stopped by a line it met: why no junction went in there, if one was what it was after (QA sweep 4).
      const last = line.pieces[line.pieces.length - 1];
      if (say && !merge && last?.blocked === say) {
        const swaps = [...(branch?.pieces ?? []), ...this.crossed.pieces];
        say = junctionWhy(this.junctions, line.start, line.pieces, line.tip, this.taken(), (t) => swaps.filter((q) => q.type === t).length) ?? say;
      }
      // (A branch that laid nothing either way: why, rather than nothing.)
      if (!say && unlaid) say = TOO_SHARP;
    }
    this.clear();
    // A branch with no line after it (let go before a piece followed): nothing.
    if (busy || plan.pieces.length === (branch?.pieces.length ?? 0)) {
      if (say) this.hooks.toast(say);
      return;
    }
    const ids = plan.covers.length ? this.editor().replaceRun(plan.covers, plan.pieces) : this.editor().placeRun(plan.pieces);
    const closed = line.stopped === "closed" || !!merge;
    // Down, and its end left facing a station's (or other track's) end it didn't join: why, rather than buffers facing
    // each other and nothing said (QA: a line drawn into Fernhill's end stopped just short of it).
    const lastAt = plan.line + Math.min(pieces.length, merge ? merge.keep : pieces.length) - 1;
    if (!busy && !merge && lastAt >= plan.line && ids[lastAt] !== undefined) {
      const left = this.unjoined(ids[lastAt], pieces[lastAt - plan.line].exit, line.tip);
      if (left) say = this.notice.unjoined(left);
    }
    if (say) this.hooks.toast(say);
    plan.pieces.forEach((p, i) => {
      const id = ids[i];
      // The line's own ghosts settle into place; the swaps' pieces get a mesh of their own.
      const k = i - plan.line;
      const mesh = k >= 0 && k < ghosts.length ? ghosts[k].mesh : this.pieceMesh(p);
      if (!(k >= 0 && k < ghosts.length)) g.scene.add(mesh);
      mesh.material = [g.mats.track, g.mats.trackCut, g.mats.bridgePaint];
      g.trackView.setHidden(id, true);
      const to = { x: p.pose.x, y: p.y, z: p.pose.z, heading: p.pose.heading };
      const from = { ...to, y: p.y + 14 };
      const last = i === plan.pieces.length - 1;
      g.flourishes.add(
        delayed(i * RIPPLE, () => {
          if (i < CLICKS || last) this.hooks.onPlaced(i);
          if (last && closed) {
            const e = merge ? merge.swap.end : pieces[pieces.length - 1]?.end;
            if (e) g.flourishes.add(dustPuff(g.scene, e.x, e.y, e.z));
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

  /** A ghost-style mesh for a piece of a swap (a switch, the straights beside it), placed. */
  private pieceMesh(p: SwapPiece, mat: Material = this.okMat): Mesh {
    const mesh = ghostMesh(p.type, p.flipped, mat);
    mesh.matrixAutoUpdate = false;
    mesh.matrix.makeRotationY(-p.pose.heading);
    mesh.matrix.setPosition(p.pose.x, p.y + 1, p.pose.z);
    return mesh;
  }

  /** Show a swap: its pieces as ghosts, the straights it replaces outlined. The ghosts. */
  private showSwap(w: PieceSwap): Mesh[] {
    const out = w.pieces.map((p) => this.pieceMesh(p));
    for (const m of out) this.game.scene.add(m);
    this.outlineCovers();
    this.game.invalidate();
    return out;
  }

  /** Outline the straights the swaps would take the place of. */
  private outlineCovers(): void {
    this.game.trackView.setHighlights([...(this.branch?.covers ?? []), ...this.crossed.covers, ...(this.merge?.swap.covers ?? [])], "select", false);
  }

  /** The merge the line would make if let go now (see `mergeAt`), or null. */
  private mergeNow(): Merge | null {
    const line = this.line;
    if (!line || line.stopped === "closed") return null;
    const m = mergeAt(this.junctions, line.start, line.placeable(), line.tip, this.taken(), this.branch ? 1 : 0);
    if (m?.kind === "short") {
      if (!this.toldShort) this.hooks.toast(m.message);
      this.toldShort = true;
      return null;
    }
    return m;
  }

  /** Let go a little past a line it ran into: the merge where the stroke meets that line (see `mergePast`), or null. */
  private mergeAtLine(): Merge | null {
    const line = this.line;
    if (!line || line.stopped !== "blocked") return null;
    const m = mergePast(this.junctions, line.start, line.pieces, line.tip, this.taken(), this.branch ? 1 : 0);
    if (m?.kind === "short") {
      if (!this.toldShort) this.hooks.toast(m.message);
      this.toldShort = true;
      return null;
    }
    return m;
  }

  /** The straights the line's swaps take the place of so far (a branch's, and its crossings'). */
  private taken(): Set<number> {
    return new Set([...(this.branch?.covers ?? []), ...this.crossed.covers]);
  }

  /**
   * The line stopped where it ran into a plain straight's run, and the finger went on across it (`CROSS_ON` past the
   * crossing's far end): a crossing swapped in there (see `crossingAt`), the line so far kept with it, and a new line
   * drawn on from its far end. Looked for once each time the line stops so.
   */
  private goOnAcross(lifted = false): boolean {
    const line = this.line;
    const last = line?.pieces[line.pieces.length - 1];
    if (!line || line.stopped !== "blocked" || last?.blockedBy !== "piece") return false;
    if (this.crossLooked !== last) {
      this.crossLooked = last;
      const c = crossingAt(this.junctions, line.start, line.placeable(), this.taken(), (t) => this.crossed.used.get(t) ?? 0);
      if (c?.kind === "short" && !this.toldShort) {
        this.toldShort = true;
        this.hooks.toast(c.message);
      }
      this.crossing = c?.kind === "crossing" ? c : null;
    }
    const c = this.crossing;
    if (!c) return false;
    // Gone on across it, the finger well past its far end: until then, it may yet stop on the line (a merge). Let go,
    // past its far end at all.
    const ex = c.swap.exit!;
    const tip = line.tip;
    if ((tip.x - ex.x) * Math.cos(ex.heading) + (tip.z - ex.z) * Math.sin(ex.heading) < (lifted ? 0 : CROSS_ON)) return false;
    const kept = line.placeable().slice(0, c.keep);
    const ghosts = this.ghosts.splice(0, c.keep).map((g) => g.mesh);
    for (const gh of this.ghosts) this.game.scene.remove(gh.mesh);
    this.ghosts = [];
    const added = [...c.links, ...c.swap.pieces];
    const meshes = added.map((p) => this.pieceMesh(p));
    for (const m of meshes) this.game.scene.add(m);
    this.crossed.pieces.push(...kept.map((p) => ({ type: p.type, pose: p.pose, y: p.y, flipped: p.flipped })), ...added);
    this.crossed.covers.push(...c.swap.covers);
    this.crossed.ghosts.push(...ghosts, ...meshes);
    const type = c.swap.pieces[0].type;
    this.crossed.used.set(type, (this.crossed.used.get(type) ?? 0) + 1);
    this.crossing = null;
    this.crossLooked = null;
    this.outlineCovers();
    this.start(ex);
    this.hooks.onGrow();
    this.game.invalidate();
    return true;
  }

  /** The crossing the line would go on through (once the finger's past it), and the stopped piece it was looked for at. */
  private crossing: Extract<ReturnType<typeof crossingAt>, { kind: "crossing" }> | null = null;
  private crossLooked: DrawnPiece | null = null;

  /** "Out of switches" said already this stroke (a merge it couldn't make). */
  private toldShort = false;

  /** Show the merge the line would make if let go now, as ghosts, when that changes. */
  private showMerge(): void {
    const m = this.mergeNow();
    const key = m ? `${m.keep}|${m.swap.covers.join(",")}|${m.swap.pieces.map((p) => `${p.type}${p.pose.x.toFixed(0)},${p.pose.z.toFixed(0)}`).join(";")}|${m.links.map((l) => l.type).join(",")}` : "";
    if (key === this.mergeKey) return;
    this.mergeKey = key;
    this.merge = m;
    for (const g of this.mergeGhosts) this.game.scene.remove(g);
    this.mergeGhosts = m ? [...m.links, ...m.swap.pieces].map((p) => this.pieceMesh(p)) : [];
    for (const g of this.mergeGhosts) this.game.scene.add(g);
    this.outlineCovers();
    this.game.invalidate();
  }

  private warmed = false;
  /** `warm` has done all its jobs (for tests that time a first stroke). */
  ready = false;

  /**
   * Get ready for a line meeting the river or a hill, once, a job at a time when idle (`idle`): the river's outline
   * index (`inRiver`), and the geometry of the bridges and ramps on arches a level up. Otherwise the first stroke over
   * the water built them on one pointer move (2 to 7 ms each in the browser, and the move that met the river 10 ms).
   */
  warm(idle: (f: () => void) => unknown): void {
    if (this.warmed) return;
    this.warmed = true;
    const g = this.game;
    const jobs: (() => void)[] = [
      () => {
        const grid = g.landscape.grid;
        for (let i = 0; i < grid.cellCount; i++)
          if (isWater(grid.surface[i])) {
            inRiver(grid, grid.centreX(grid.colOf(i)), grid.centreZ(grid.rowOf(i)));
            return;
          }
      },
      // A crossing's pieces: a ramp up and down (on the ground, and on arches a level up), bridges a level or two up.
      // (A ramp down, flipped, was built on the move that laid it: 18 to 28 ms in QA's replay.)
      ...(
        [
          ["ramp", false, 0],
          ["ramp", true, 0],
          ["bridge", false, 1],
          ["ramp", false, 1],
          ["ramp", true, 1],
          ["bridge", false, 2],
        ] as const
      ).map(([type, flipped, levels]) => () => void pieceGeometry(type, flipped, levels)),
    ];
    const next = () => {
      const job = jobs.shift();
      if (!job) {
        this.ready = true;
        return;
      }
      job();
      idle(next);
    };
    idle(next);
  }

  /** Is there a free end of track near screen point (x, y) to draw on from? */
  nearFreeEnd(x: number, y: number): boolean {
    return this.freeEndAt(x, y) !== null;
  }

  /** Put the line away (nothing laid). */
  cancel(): void {
    this.clear();
  }

  /** A new line from `end`: on track that stays put (`held`: a free end, a switch), or on open ground. */
  private start(end: DrawEnd, held = true): void {
    this.toldShort = false;
    this.branchCovers = this.taken();
    for (const id of this.swapIds) this.own.removePiece(id);
    this.swapIds = [...(this.branch?.pieces ?? []), ...this.crossed.pieces].map((p) => this.own.addPiece(p.type, p.pose, p.y, p.flipped));
    this.notice.start();
    const hills = hillsOf(this.game.landscape.grid);
    this.line = new DrawLine(end, {
      check: (c, line) => this.check(c, line),
      allow: this.stock ? (type, line) => line.filter((p) => p.type === type).length < this.stock!(type) : undefined,
      meet: (e) => this.meet(e),
      closes: (e) => this.closes(e),
      // (Other track only: back round to its own start is `closeOnStart`'s.)
      nearTrack: (e, reach) => this.game.layout.queryFreeConnectors(e.x, e.z, reach, this.nearScratch) > 0,
      freeEnds: (e, reach, out) => this.freeEnds(e, reach, out),
      startHeld: held,
      groundAt: (x, z) => hills.groundAt(x, z),
      wet: (x, z) => inRiver(this.game.landscape.grid, x, z),
      onMap: (x, z) => this.game.landscape.grid.cellAtWorld(x, z) !== -1,
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
    // (Branching off a line, the straights the switch goes in place of aren't in the way: the switch is, in `own`.)
    const { reason, risers } = this.hooks.placement(c.type, c.flipped, c.pose, c.y, this.branchCovers.size ? this.branchCovers : undefined);
    // A drawn line puts in no risers under it: needing them is "unsupported".
    const why = drawRefusal(this.game.landscape, c.type, c.flipped, c.pose, c.y, reason, risers);
    if (why) return { reason: why.reason, message: drawMessage(why.reason, why.levels, this.hooks.message), levels: why.levels };
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

  /**
   * The drawn piece's end `exit` is free, facing a free end of other track a little way off that it didn't join
   * (`UNJOINED_REACH`), the finger let go at it or past it (`tip`): what that end is on ("the station", "the depot",
   * "the track"), or null.
   */
  private unjoined(id: number, exit: number, tip: { x: number; z: number }): string | null {
    const layout = this.game.layout;
    const ref = connectorRef(id, exit);
    if (!layout.getPiece(id) || layout.joinedConnector(ref) !== -1) return null;
    const e = layout.worldConnector(ref, createWorldConnector());
    const near: number[] = [];
    const w = createWorldConnector();
    const n = layout.queryFreeConnectors(e.x, e.z, UNJOINED_REACH, near);
    for (let i = 0; i < n; i++) {
      if (pieceOfRef(near[i]) === id) continue;
      layout.worldConnector(near[i], w);
      if (Math.abs(w.y - e.y) > 2 || Math.hypot(w.x - e.x, w.z - e.z) > UNJOINED_REACH) continue;
      // Facing it, ahead of it, and the finger drawn to it (not let go short of it).
      if (Math.abs(normalizeAngle(w.heading - e.heading - Math.PI)) > UNJOINED_ANGLE) continue;
      const ahead = (w.x - e.x) * Math.cos(e.heading) + (w.z - e.z) * Math.sin(e.heading);
      if (ahead < -JOINT_POS_TOLERANCE || (tip.x - e.x) * Math.cos(e.heading) + (tip.z - e.z) * Math.sin(e.heading) < ahead - UNJOINED_SHORT) continue;
      const type = layout.getPiece(pieceOfRef(near[i]))?.type ?? "";
      return type === "station" ? "the station" : type.startsWith("depot-") ? "the depot" : "the track";
    }
    return null;
  }

  /** (Kept for `nearTrack`'s look: nothing made on a pointer move.) */
  private readonly nearScratch: number[] = [];

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

  /**
   * The free ends of other track within `reach` (mm) of `e` that a line from it could close onto: at its height, and
   * not facing the way it goes (a piece or two from it, turning at most a quarter, faces back at them). Into `out`.
   */
  private freeEnds(e: DrawEnd, reach: number, out: DrawEnd[]): number {
    out.length = 0;
    const layout = this.game.layout;
    const w = this.freeScratch;
    const n = layout.queryFreeConnectors(e.x, e.z, reach, this.nearScratch);
    for (let i = 0; i < n; i++) {
      layout.worldConnector(this.nearScratch[i], w);
      if (Math.abs(w.y - e.y) > 2 || Math.hypot(w.x - e.x, w.z - e.z) > reach) continue;
      if (Math.cos(w.heading - e.heading - Math.PI) < -0.2) continue;
      out.push({ x: w.x, z: w.z, heading: w.heading, y: w.y, kind: w.kind });
    }
    return out.length;
  }

  private readonly freeScratch = createWorldConnector();

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
      // A bridge (or a ramp up off the ground) on its arches. (Its arches all the way down: arches cut short over a
      // hill's edge are another geometry, built on the move that needed it, up to 36 ms in QA's replay; the piece put
      // down has them.)
      const levels = canStandOnArches(p.type) ? bridgeLevels(g.landscape, p.type, p.flipped, p.pose, p.y) : 0;
      const floors = null;
      // A ramp, let into a hill, is drawn over it (its cutting isn't made till it's put down: making it on each move
      // that changed the line's last ramp took up to 118 ms on a terrace, QA N2).
      const top = cutsHills(p.type);
      const mesh = ghostMesh(p.type, p.flipped, p.blocked ? (top ? this.blockedTopMat : this.blockedMat) : top ? this.okTopMat : this.okMat, levels, floors);
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
    let n = Math.min(TRAIL_POINTS, line.ahead(this.trailPoints));
    // The pencil line is the finger's: it starts at the line's end only when that's on it (come off a river crossing,
    // which keeps to its eighth, the line's end can be well to one side, and the pencil jogged across to it).
    const tp = this.trailPoints;
    if (n > 2 && Math.hypot(tp[2] - tp[0], tp[3] - tp[1]) > TRAIL_JOIN) {
      tp.splice(0, 2);
      n--;
    }
    this.trail.visible = n > 1;
    if (n > 1) {
      const y = line.seenAt + 3;
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
    for (const m of [...this.swapGhosts, ...this.mergeGhosts, ...this.crossed.ghosts]) this.game.scene.remove(m);
    if (this.branch || this.merge || this.crossed.covers.length) this.game.trackView.setHighlights([], "select", false);
    this.crossed = { pieces: [], covers: [], ghosts: [], used: new Map() };
    this.crossing = null;
    this.crossLooked = null;
    this.swapGhosts = [];
    this.mergeGhosts = [];
    this.branch = null;
    this.merge = null;
    this.mergeKey = "";
    this.pending = null;
    this.branchStart = null;
    this.branchStroke = [];
    for (const id of this.swapIds) this.own.removePiece(id);
    this.swapIds = [];
    this.ghosts = [];
    this.line = null;
    this.origin = null;
    this.originPts = [];
    this.trail.visible = false;
    this.game.invalidate();
  }
}

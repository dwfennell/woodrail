import {
  BufferGeometry,
  CanvasTexture,
  Color,
  CylinderGeometry,
  DataTexture,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  LessDepth,
  LinearFilter,
  Mesh,
  MeshBasicMaterial,
  RGBAFormat,
  SRGBColorSpace,
  Sprite,
  SpriteMaterial,
  Vector3,
  type Material,
  type PerspectiveCamera,
} from "three";
import { createSample, getPieceDef, pathLength, samplePath, TRACK_THICKNESS, type Layout } from "../track";
import type { PathRun } from "../game/route-path";
import type { Materials } from "./materials";

export interface RibbonSpec {
  runs: readonly PathRun[];
  colour: string;
  dotted?: boolean;
}

/** A gap no track crosses, drawn as red dashes straight from where the way runs out to the stop it can't reach. */
export interface GapSpec {
  from: { x: number; y: number; z: number };
  to: { x: number; y: number; z: number };
}

/** A run of a ribbon, and whether it's drawn as a lane (its way runs over the same track the other way too). */
export interface LaneRun extends PathRun {
  lane: boolean;
}

/**
 * Each way's runs (a line's legs), split where another run of these ways goes over the same track the other way: those
 * stretches are lanes (see `LANE_WIDTH`). In order along each way, as given; pieces it splits keep their direction.
 * A path's stretches run both ways closer than `LANE_MIN` are joined (no slivers), and shorter ones are left out.
 */
export function laneRuns(ways: readonly (readonly PathRun[])[]): LaneRun[][] {
  // Each path's stretches by the way they run along it: [up (s rising), down].
  const cover = new Map<string, [number, number][][]>();
  for (const runs of ways)
    for (const r of runs) {
      if (Math.abs(r.s1 - r.s0) < 1e-3) continue;
      const key = `${r.pieceId}/${r.pathIndex}`;
      let c = cover.get(key);
      if (!c) cover.set(key, (c = [[], []]));
      c[r.s1 > r.s0 ? 0 : 1].push([Math.min(r.s0, r.s1), Math.max(r.s0, r.s1)]);
    }
  const split = (r: PathRun): LaneRun[] => {
    const up = r.s1 >= r.s0;
    const lo = Math.min(r.s0, r.s1);
    const hi = Math.max(r.s0, r.s1);
    const other = cover.get(`${r.pieceId}/${r.pathIndex}`)?.[up ? 1 : 0] ?? [];
    const iv = other
      .map(([a, b]): [number, number] => [Math.max(a, lo), Math.min(b, hi)])
      .filter(([a, b]) => b - a > 1e-3)
      .sort((x, y) => x[0] - y[0]);
    const merged: [number, number][] = [];
    for (const [a, b] of iv) {
      const last = merged[merged.length - 1];
      if (last && a <= last[1] + LANE_MIN) last[1] = Math.max(last[1], b);
      else merged.push([a, b]);
    }
    // (A gap at either end shorter than LANE_MIN joins the lane too: no sliver of full ribbon at a joint.)
    const lanes = merged.filter(([a, b]) => b - a >= LANE_MIN).map(([a, b]): [number, number] => [a - lo < LANE_MIN ? lo : a, hi - b < LANE_MIN ? hi : b]);
    if (lanes.length === 0) return [{ ...r, lane: false }];
    const seg = (a: number, b: number, lane: boolean): LaneRun => ({ pieceId: r.pieceId, pathIndex: r.pathIndex, s0: up ? a : b, s1: up ? b : a, lane });
    const out: LaneRun[] = [];
    let at = lo;
    for (const [a, b] of lanes) {
      if (a - at > 1e-3) out.push(seg(at, a, false));
      out.push(seg(a, b, true));
      at = b;
    }
    if (hi - at > 1e-3) out.push(seg(at, hi, false));
    return up ? out : out.reverse();
  };
  return ways.map((runs) => runs.map(split).flat());
}

export interface DiscSpec {
  pieceId: number;
  label: string;
  colour: string;
  state: "next" | "stop" | "unreachable";
  /** The stop it stands for (in its tag, for picking); else its place in the list given. */
  stop?: number;
  /** A via point (passed, not stopped at): a small token with a white dot, tapped as its piece. */
  via?: boolean;
}

/** The ribbon: its width (mm), how far over the track's top it lies, and how finely it follows curves. */
const RIBBON_WIDTH = 14;
const RIBBON_LIFT = 0.4;
/** The dark edge under a ribbon: how far it shows past each side (mm), and its lift (under the ribbon's). */
const EDGE_WIDTH = 4;
const EDGE_LIFT = 0.3;
/** The arrowheads showing which way a ribbon runs: every this far along it (mm), this long and wide, over it. */
const CHEVRON_GAP = 120;
/** A ribbon's flash (seconds): when its way changes under a track edit. */
const FLASH_S = 1.6;
const CHEVRON_LENGTH = 9;
const CHEVRON_WIDTH = 9;
const CHEVRON_LIFT = 0.6;
/**
 * Two-way legs (audit F8): where a line runs over the same track both ways (a shuttle, a spur in and out), each way is
 * its own thin lane, `LANE_WIDTH` wide, `LANE_OFFSET` to the left of the way it runs (as trains here keep left), with
 * its own arrows: so a shuttle reads as there and back, not one way. Their dark edges meet between them as a divider.
 * Stretches run both ways shorter than `LANE_MIN` (a train turning at the end of a stop's piece) stay one ribbon.
 */
const LANE_WIDTH = 9;
const LANE_OFFSET = 6.5;
const LANE_CHEVRON_WIDTH = 7;
export const LANE_MIN = 30;
/** How dark a ribbon's edge is: its colour (in linear light) times this. */
const EDGE_SHADE = 0.15;

/** A ribbon's edge colour: a dark shade of its own (see `EDGE_SHADE`), as "#rrggbb". */
export function ribbonEdge(colour: string): string {
  const c = new Color(colour).multiplyScalar(EDGE_SHADE);
  return `#${c.getHexString()}`;
}
/** Dashes lie a little higher, so where a dotted way runs over a solid one they show on top. */
const DOTS_LIFT = 0.7;
const STEP = 6;
/**
 * Dotted ribbons (the way a train's switches send it): small soft pills in the groove, `DOT_WIDTH` wide at the train
 * and narrowing to `DOT_TAPER` of that at the far end (so the way fades off rather than stopping), `DASH` long with
 * `GAP` between: a faint tint of the groove, not marks laid over the toy.
 */
const DASH = 16;
const GAP = 12;
const DOT_WIDTH = 6;
const DOT_TAPER = 0.45;
const DOT_OPACITY = 0.65;
/** A stretch a track edit changed the route to, lit up for `LIT_S` (s): pale, wider than the ribbon, over it. */
const LIT_S = 1.6;
const LIT_COLOUR = "#fff6d8";
const LIT_WIDTH = 22;
const LIT_LIFT = 0.9;
const LIT_OPACITY = 0.8;
/** The red dashes of a gap no track crosses. */
const GAP_COLOUR = "#d33a2c";
const GAP_WIDTH = 9;
export const RIBBON_OPACITY = 0.85;
/**
 * Stop discs keep one size on screen, as map markers do (a 22 mm token is a few pixels at the usual zoom): a fraction
 * of the view's distance, about 34 px across on a phone held upright with the game's 30° camera ("next" a little
 * bigger). They float this high (mm) over the track's top, on a post.
 */
const DISC = 0.022;
const DISC_NEXT = 0.028;
const DISC_HEIGHT = 70;
/** A via point's disc and post, against a stop's. */
const VIA_SCALE = 0.62;
const POST_RADIUS = 1.2;
/** The next stop's disc pulses for this long (s) when it becomes the next, then rests; a new disc pops this long. */
const PULSE_S = 4;
const PULSE_HZ = 1.1;
const POP_S = 0.35;
/** Discs closer than this on screen (a fraction of a disc's size) are fanned out side by side. */
const FAN_OVERLAP = 0.9;

const sample = createSample();

/**
 * A selected train's route on the track: soft coloured ribbons along the way it goes, and numbered stop discs
 * floating over the stops. Everything is built in `show()`; nothing runs per frame, and hidden (cleared) it costs
 * nothing. Discs are tagged `userData = { kind: "route-stop", pieceId, index }` for picking.
 */
export class RouteView {
  readonly group = new Group();
  private readonly ribbonMats = new Map<string, MeshBasicMaterial>();
  private readonly discMats = new Map<string, SpriteMaterial>();
  private readonly postGeom = new CylinderGeometry(POST_RADIUS, POST_RADIUS, 1, 6).translate(0, 0.5, 0);
  private edgeAlpha: DataTexture | null = null;
  private arrowMat: MeshBasicMaterial | null = null;
  /** How much wider than at the track's own size the solid ribbons are drawn (see `show`). */
  private scale = 1;
  /** The discs drawn (sprites), each with its place over its stop (`userData.base`) and size (`userData.size`). */
  private discs: Sprite[] = [];
  /** Animation: the next stop's pulse until this time, and a disc (by stop) popping in since `popAt` (seconds). */
  private pulseFrom = -Infinity;
  private popStop = -1;
  /** Or a via point's disc (by its piece) popping: its chip was picked (−1: none). */
  private popVia = -1;
  private popAt = -Infinity;
  /** The ribbon's flash, from this time (seconds; see `flash`). */
  private flashAt = -Infinity;
  /** The camera's view the discs were last fanned out for (its matrix, the view's height, its fov). */
  private fannedFor: number[] = [];

  /** The ribbons drawn last (for the e2e: what the map shows). */
  shown: readonly RibbonSpec[] = [];
  /** How much of them (mm of track, each way counted) was drawn as two lanes, run both ways (for the e2e). */
  laneLength = 0;
  /** A changed stretch lit up (`highlight`): its mesh, when it began (s), and whether it fades (no: reduced motion). */
  private lit: { mesh: Mesh; mat: MeshBasicMaterial; from: number; fade: boolean } | null = null;
  /** The runs lit last (for the e2e). */
  litRuns: readonly PathRun[] = [];

  constructor(
    private readonly layout: Layout,
    private readonly mats: Materials,
  ) {
    this.group.name = "route";
  }

  /** Draw these ribbons and discs (replacing what was drawn). Builds geometry once per call; nothing per frame. */
  show(ribbons: readonly RibbonSpec[], discs: readonly DiscSpec[], gaps: readonly GapSpec[] = [], scale = 1): void {
    this.clear(true);
    // (Wider ribbons, arrows and edges, seen from far: the Lines view's. See `ribbonScale`.)
    this.scale = scale;
    this.shown = ribbons;
    // One mesh per colour and kind: a handful of draw calls however long the route.
    const strips = new Map<string, { colour: string; dotted: boolean; pos: number[]; uv: number[] }>();
    const stripOf = (colour: string, dotted: boolean) => {
      const key = `${colour}|${dotted ? 1 : 0}`;
      let b = strips.get(key);
      if (!b) strips.set(key, (b = { colour, dotted, pos: [], uv: [] }));
      return b;
    };
    const edges = new Set(ribbons.filter((r) => !r.dotted).map((r) => ribbonEdge(r.colour)));
    // Each line's (colour's) solid ribbons, split into lanes where it runs over the same track both ways (audit F8).
    const solid = ribbons.filter((r) => !r.dotted);
    const split = new Map<RibbonSpec, LaneRun[]>();
    for (const colour of new Set(solid.map((r) => r.colour))) {
      const mine = solid.filter((r) => r.colour === colour);
      laneRuns(mine.map((r) => r.runs)).forEach((runs, i) => split.set(mine[i], runs));
    }
    let laneLength = 0;
    for (const r of ribbons) {
      if (r.dotted) {
        const b = stripOf(r.colour, true);
        this.dashes(r.runs, DOT_WIDTH, DOTS_LIFT, b.pos, b.uv);
      } else {
        const b = stripOf(r.colour, false);
        // Under it, a wider strip in a dark shade of its colour: an edge that holds 3:1 against the beech track
        // (audit F10: yellow was 1.2:1). Drawn first; the ribbon over it.
        const e = stripOf(ribbonEdge(r.colour), false);
        for (const run of split.get(r)!) {
          if (!this.layout.getPiece(run.pieceId)) continue;
          const width = run.lane ? LANE_WIDTH : RIBBON_WIDTH;
          const offset = this.laneOffset(run);
          this.span(run, run.s0, run.s1, RIBBON_LIFT, b.pos, b.uv, width * this.scale, offset);
          this.span(run, run.s0, run.s1, EDGE_LIFT, e.pos, e.uv, (width + 2 * EDGE_WIDTH) * this.scale, offset);
          if (run.lane) laneLength += Math.abs(run.s1 - run.s0);
        }
      }
    }
    this.laneLength = laneLength;
    // Which way the train runs: small arrowheads along each solid ribbon, spaced by distance along it (audit F8: a
    // shuttle and a ring looked the same). One mesh for them all, built with the ribbons.
    const arrows: number[] = [];
    for (const r of solid) this.chevrons(split.get(r)!, arrows);
    if (arrows.length > 0) {
      const g = new BufferGeometry();
      g.setAttribute("position", new Float32BufferAttribute(arrows, 3));
      g.computeBoundingSphere();
      const mesh = new Mesh(g, this.chevronMaterial());
      mesh.renderOrder = 4;
      mesh.name = "route-chevrons";
      this.group.add(mesh);
    }
    if (gaps.length > 0) {
      const red = stripOf(GAP_COLOUR, true);
      for (const gap of gaps) this.gapDashes(gap, red.pos, red.uv);
    }
    for (const b of strips.values()) {
      if (b.pos.length === 0) continue;
      const g = new BufferGeometry();
      g.setAttribute("position", new Float32BufferAttribute(b.pos, 3));
      g.setAttribute("uv", new Float32BufferAttribute(b.uv, 2));
      g.computeBoundingSphere();
      const mesh = new Mesh(g, this.ribbonMaterial(b.colour, b.dotted));
      mesh.renderOrder = edges.has(b.colour) ? 2 : 3;
      mesh.name = b.dotted ? "route-dots" : edges.has(b.colour) ? "route-edge" : "route-ribbon";
      this.group.add(mesh);
    }
    this.discs = [];
    discs.forEach((d, index) => this.disc(d, index));
    this.fannedFor = [];
  }

  /**
   * Light up a stretch of the route (a way a track edit changed it to), from `now` (seconds), over the ribbon: a pale
   * glow that fades out over `LIT_S` (one mesh, built once; `animate` sets its opacity). `fade` false (reduced motion):
   * it stays steady for that long, then goes.
   */
  highlight(runs: readonly PathRun[], now: number, fade = true): void {
    this.unlight();
    if (runs.length === 0) return;
    const pos: number[] = [];
    const uv: number[] = [];
    for (const run of runs) this.strip(run, pos, uv, LIT_WIDTH, LIT_LIFT);
    if (pos.length === 0) return;
    const g = new BufferGeometry();
    g.setAttribute("position", new Float32BufferAttribute(pos, 3));
    g.setAttribute("uv", new Float32BufferAttribute(uv, 2));
    g.computeBoundingSphere();
    const mat = new MeshBasicMaterial({ color: new Color(LIT_COLOUR), transparent: true, opacity: LIT_OPACITY, depthWrite: false, side: DoubleSide, depthFunc: LessDepth });
    const mesh = new Mesh(g, mat);
    mesh.renderOrder = 4;
    mesh.name = "route-lit";
    this.group.add(mesh);
    this.lit = { mesh, mat, from: now, fade };
    this.litRuns = runs;
  }

  private unlight(): void {
    if (!this.lit) return;
    this.group.remove(this.lit.mesh);
    this.lit.mesh.geometry.dispose();
    this.lit.mat.dispose();
    this.lit = null;
  }

  /** The next stop's disc pulses (a few beats, from `now`, seconds): it has just become the next, or the card opened. */
  pulse(now: number): void {
    this.pulseFrom = now;
  }

  /** The disc of stop `stop` pops in (just added), from `now` (seconds). */
  pop(stop: number, now: number): void {
    this.popStop = stop;
    this.popVia = -1;
    this.popAt = now;
  }

  /** The ribbon flashes (its way just changed under the track's edit: audit F14), from `now` (seconds). */
  flash(now: number): void {
    this.flashAt = now;
  }

  /** The disc of the via point on piece `pieceId` pops (its chip was picked: which one it is), from `now` (seconds). */
  popViaAt(pieceId: number, now: number): void {
    this.popStop = -1;
    this.popVia = pieceId;
    this.popAt = now;
  }

  /**
   * Size the discs for `now` (seconds): the next one's pulse, a new one's pop. True while something's still moving (the
   * caller draws another frame); false at rest, when nothing need be drawn again.
   */
  animate(now: number): boolean {
    let moving = false;
    if (this.lit) {
      const t = now - this.lit.from;
      if (t >= LIT_S || t < 0) this.unlight();
      else {
        if (this.lit.fade) this.lit.mat.opacity = LIT_OPACITY * (1 - t / LIT_S) ** 2;
        moving = true;
      }
    }
    // The ribbon's flash: three soft beats of its opacity, then back as it was.
    const f = now - this.flashAt;
    if (f >= 0 && f < FLASH_S + 0.1) {
      const k = f < FLASH_S ? 0.55 * Math.sin((f / FLASH_S) * Math.PI * 3) ** 2 : 0;
      for (const [key, m] of this.ribbonMats) if (key.endsWith("|0")) m.opacity = RIBBON_OPACITY * (1 - k) + k * 0.15;
      if (f < FLASH_S) moving = true;
      else this.flashAt = -Infinity;
    }
    for (const d of this.discs) {
      const u = d.userData as { size: number; index: number; next: boolean; kind: string; pieceId: number };
      let k = 1;
      const pulse = now - this.pulseFrom;
      if (u.next && pulse >= 0 && pulse < PULSE_S) {
        // A gentle beat, fading out over the pulse's time.
        k *= 1 + 0.14 * Math.sin(pulse * PULSE_HZ * Math.PI * 2) ** 2 * (1 - pulse / PULSE_S);
        moving = true;
      }
      const pop = now - this.popAt;
      const popping = this.popVia !== -1 ? u.kind === "route-via" && u.pieceId === this.popVia : u.index === this.popStop && u.kind !== "route-via";
      if (popping && pop >= 0 && pop < POP_S) {
        // From nothing, a little past full size, and back.
        const t = pop / POP_S;
        k *= t < 0.6 ? (t / 0.6) * 1.25 : 1.25 - 0.25 * ((t - 0.6) / 0.4);
        moving = true;
      }
      d.scale.set(u.size * k, u.size * k, 1);
    }
    return moving;
  }

  /**
   * Discs that would sit on one another on screen (stops close together, seen from far) are fanned out side by side.
   * Cheap: a few discs projected, and only when the view has changed since the last time (true then: draw again).
   */
  fan(camera: PerspectiveCamera, heightPx: number): boolean {
    if (this.discs.length < 2) return false;
    const e = camera.matrixWorld.elements;
    const f = this.fannedFor;
    let same = f.length === 18 && f[16] === heightPx && f[17] === camera.fov;
    for (let i = 0; same && i < 16; i++) same = Math.abs(f[i] - e[i]) < 1e-4;
    if (same) return false;
    this.fannedFor = [...e, heightPx, camera.fov];
    const tan = Math.tan(((camera.fov * Math.PI) / 180) / 2);
    const right = new Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
    const screen = this.discs.map((d) => {
      const base = d.userData.base as Vector3;
      const v = base.clone().project(camera);
      return { d, base, x: ((v.x + 1) / 2) * heightPx * camera.aspect, y: ((1 - v.y) / 2) * heightPx, depth: camera.position.distanceTo(base) };
    });
    const sizePx = (u: { size: number }) => (u.size * heightPx) / (2 * tan);
    const placed = new Set<number>();
    for (let i = 0; i < screen.length; i++) {
      if (placed.has(i)) continue;
      // Those within a disc of this one (and of each other, as they chain), left to right as their stops go.
      const group = [i];
      for (let j = i + 1; j < screen.length; j++) {
        if (placed.has(j)) continue;
        const near = group.some((g) => Math.hypot(screen[g].x - screen[j].x, screen[g].y - screen[j].y) < sizePx(screen[g].d.userData as { size: number }) * FAN_OVERLAP);
        if (near) group.push(j);
      }
      for (const g of group) placed.add(g);
      const n = group.length;
      group.forEach((g, k) => {
        const s = screen[g];
        const step = sizePx(s.d.userData as { size: number }) * 1.05 * ((2 * s.depth * tan) / heightPx);
        s.d.position.copy(s.base).addScaledVector(right, n > 1 ? (k - (n - 1) / 2) * step : 0);
      });
    }
    return true;
  }

  /** Take the route off the map. `keepLit`: a stretch lit up stays on till its time is up (`show` redraws under it). */
  clear(keepLit = false): void {
    if (!keepLit) this.unlight();
    const lit = this.lit?.mesh;
    for (const o of this.group.children) {
      // Ribbon geometry is the call's own; the post geometry and the materials are kept for the next show().
      if ((o as Mesh).isMesh && (o as Mesh).geometry !== this.postGeom && o !== lit) (o as Mesh).geometry.dispose();
    }
    this.group.clear();
    if (lit) this.group.add(lit);
  }

  dispose(): void {
    this.clear();
    this.postGeom.dispose();
    for (const m of this.ribbonMats.values()) m.dispose();
    for (const m of this.discMats.values()) {
      m.map?.dispose();
      m.dispose();
    }
    this.ribbonMats.clear();
    this.discMats.clear();
    this.edgeAlpha?.dispose();
    this.edgeAlpha = null;
    this.arrowMat?.dispose();
    this.arrowMat = null;
  }

  /** World point `side` mm to the left of a path's centre line at `s`, `lift` mm over the track's top. */
  private point(run: PathRun, s: number, side: number, lift: number, out: number[]): void {
    const piece = this.layout.getPiece(run.pieceId)!;
    samplePath(getPieceDef(piece.type, piece.flipped).paths[run.pathIndex].geom, s, sample);
    const h = piece.pose.heading;
    const ch = Math.cos(h);
    const sh = Math.sin(h);
    // Sideways in plan: the path's left (as for positive arc sweeps, toward +heading).
    const lx = sample.x - Math.sin(sample.heading) * side;
    const lz = sample.z + Math.cos(sample.heading) * side;
    out.push(piece.pose.x + lx * ch - lz * sh, piece.y + sample.y + TRACK_THICKNESS + lift, piece.pose.z + lx * sh + lz * ch);
  }

  /**
   * A lane's sideways offset (mm, + to the path's `point` side): to the left of the way it runs, as seen from above
   * (`point`'s positive side is the right of a way run with s rising). 0 for a run that isn't a lane.
   */
  private laneOffset(run: LaneRun): number {
    return run.lane ? (run.s1 >= run.s0 ? -1 : 1) * LANE_OFFSET * this.scale : 0;
  }

  /** A quad strip along `run` from a to b (path distances), sampled on a fixed grid so runs over the same track agree. */
  private span(run: PathRun, a: number, b: number, lift: number, pos: number[], uv: number[], width = RIBBON_WIDTH, offset = 0): void {
    const lo = Math.min(a, b);
    const hi = Math.max(a, b);
    if (hi - lo < 1e-3) return;
    const ss = [lo];
    for (let s = (Math.floor(lo / STEP) + 1) * STEP; s < hi - 0.5; s += STEP) ss.push(s);
    ss.push(hi);
    const w = width / 2;
    const l: number[] = [];
    const r: number[] = [];
    for (const s of ss) {
      this.point(run, s, offset + w, lift, l);
      this.point(run, s, offset - w, lift, r);
    }
    for (let i = 0; i + 1 < ss.length; i++) {
      const L0 = l.slice(i * 3, i * 3 + 3);
      const R0 = r.slice(i * 3, i * 3 + 3);
      const L1 = l.slice(i * 3 + 3, i * 3 + 6);
      const R1 = r.slice(i * 3 + 3, i * 3 + 6);
      // Two triangles, facing up (counter-clockwise seen from above).
      pos.push(...L0, ...R0, ...R1, ...L0, ...R1, ...L1);
      uv.push(0, 0.5, 1, 0.5, 1, 0.5, 0, 0.5, 1, 0.5, 0, 0.5);
    }
  }

  private strip(run: PathRun, pos: number[], uv: number[], width = RIBBON_WIDTH, lift = RIBBON_LIFT): void {
    if (!this.layout.getPiece(run.pieceId)) return;
    this.span(run, run.s0, run.s1, lift, pos, uv, width * this.scale);
  }

  /**
   * Arrowheads along a ribbon's runs, the way each run goes (s0 to s1, the way the train runs), every `CHEVRON_GAP`
   * of the whole way (so they run on evenly from piece to piece): a flat triangle each, over the ribbon.
   */
  private chevrons(runs: readonly LaneRun[], pos: number[]): void {
    let along = 0;
    const a: number[] = [];
    const gap = CHEVRON_GAP * this.scale;
    const len = CHEVRON_LENGTH * this.scale;
    for (const run of runs) {
      if (!this.layout.getPiece(run.pieceId)) continue;
      // (On a lane, narrower and on its lane.)
      const wide = (run.lane ? LANE_CHEVRON_WIDTH : CHEVRON_WIDTH) * this.scale;
      const off = this.laneOffset(run);
      const dir = run.s1 >= run.s0 ? 1 : -1;
      const n = Math.abs(run.s1 - run.s0);
      for (let k = Math.ceil((along - gap / 2) / gap); ; k++) {
        const d = k * gap + gap / 2 - along;
        if (d > n) break;
        // (Whole on this run: an arrow straddling a joint is left for the next.)
        if (d - len / 2 < 0 || d + len / 2 > n) continue;
        const s = run.s0 + dir * d;
        a.length = 0;
        this.point(run, s + (dir * len) / 2, off, CHEVRON_LIFT, a);
        this.point(run, s - (dir * len) / 2, off + wide / 2, CHEVRON_LIFT, a);
        this.point(run, s - (dir * len) / 2, off - wide / 2, CHEVRON_LIFT, a);
        pos.push(...a);
      }
      along += n;
    }
  }

  private chevronMaterial(): MeshBasicMaterial {
    return (this.arrowMat ??= new MeshBasicMaterial({ color: new Color("#fff6e6"), transparent: true, opacity: 0.9, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -6, side: DoubleSide, fog: false }));
  }

  /** Dashes along the runs, spaced by distance along the whole way (so they run on evenly from piece to piece). */
  private dashes(runs: readonly PathRun[], width: number, lift: number, pos: number[], uv: number[]): void {
    let along = 0;
    const period = DASH + GAP;
    const total = runs.reduce((t, run) => t + Math.abs(run.s1 - run.s0), 0);
    for (const run of runs) {
      if (!this.layout.getPiece(run.pieceId)) continue;
      const dir = run.s1 >= run.s0 ? 1 : -1;
      const n = Math.abs(run.s1 - run.s0);
      // Dash k covers [k·period + lead, k·period + lead + length) of the whole way.
      let k = Math.floor(along / period);
      for (;;) {
        const d0 = Math.max(k * period, along);
        const d1 = Math.min(k * period + DASH, along + n);
        if (d0 >= along + n) break;
        // Narrower the further along the way (each dash as wide as at its middle).
        const w = width * (1 - (1 - DOT_TAPER) * Math.min(1, (d0 + d1) / 2 / Math.max(1, total)));
        if (d1 > d0) this.span(run, run.s0 + dir * (d0 - along), run.s0 + dir * (d1 - along), lift, pos, uv, w);
        k++;
      }
      along += n;
    }
  }

  /** Red dashes straight across a gap (over the ground, a little above the higher end). */
  private gapDashes(gap: GapSpec, pos: number[], uv: number[]): void {
    const dx = gap.to.x - gap.from.x;
    const dz = gap.to.z - gap.from.z;
    const len = Math.hypot(dx, dz);
    if (len < 1) return;
    const ux = dx / len;
    const uz = dz / len;
    const w = GAP_WIDTH / 2;
    const y = Math.max(gap.from.y, gap.to.y) + DOTS_LIFT + 1;
    for (let d0 = 0; d0 < len; d0 += DASH + GAP) {
      const d1 = Math.min(d0 + DASH, len);
      const at = (d: number, side: number) => [gap.from.x + ux * d - uz * side, y, gap.from.z + uz * d + ux * side];
      const L0 = at(d0, w);
      const R0 = at(d0, -w);
      const L1 = at(d1, w);
      const R1 = at(d1, -w);
      pos.push(...L0, ...R0, ...R1, ...L0, ...R1, ...L1);
      uv.push(0, 0.5, 1, 0.5, 1, 0.5, 0, 0.5, 1, 0.5, 0, 0.5);
    }
  }

  /** Soft edges: alpha across the ribbon's width, full in the middle, fading at the sides. */
  private edges(): DataTexture {
    if (this.edgeAlpha) return this.edgeAlpha;
    const W = 16;
    const data = new Uint8Array(W * 4);
    for (let i = 0; i < W; i++) {
      const t = Math.abs((i + 0.5) / W - 0.5) * 2; // 0 middle, 1 edge
      const a = t < 0.55 ? 1 : Math.max(0, 1 - (t - 0.55) / 0.45);
      data.set([255, 255, 255, Math.round(255 * a)], i * 4);
    }
    const tex = new DataTexture(data, W, 1, RGBAFormat);
    tex.magFilter = LinearFilter;
    tex.minFilter = LinearFilter;
    tex.needsUpdate = true;
    return (this.edgeAlpha = tex);
  }

  private ribbonMaterial(colour: string, dotted: boolean): MeshBasicMaterial {
    const key = `${colour}|${dotted ? 1 : 0}`;
    let m = this.ribbonMats.get(key);
    if (!m) {
      m = new MeshBasicMaterial({
        color: new Color(colour),
        alphaMap: this.edges(),
        transparent: true,
        opacity: dotted ? DOT_OPACITY : RIBBON_OPACITY,
        // Writes depth with a strict test: where two legs run over the same track, the second doesn't darken it.
        depthWrite: true,
        depthFunc: LessDepth,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -4,
        side: DoubleSide,
        fog: false,
      });
      this.ribbonMats.set(key, m);
    }
    return m;
  }

  private discMaterial(d: DiscSpec): SpriteMaterial {
    const key = `${d.label}|${d.colour}|${d.state}|${d.via ? "v" : ""}`;
    let m = this.discMats.get(key);
    if (!m) {
      // Over everything, as the station roofs would hide it: a marker, like the plot badges.
      m = new SpriteMaterial({ map: discTexture(d), transparent: true, fog: false, depthWrite: false, depthTest: false, sizeAttenuation: false });
      this.discMats.set(key, m);
    }
    return m;
  }

  private disc(d: DiscSpec, index: number): void {
    const piece = this.layout.getPiece(d.pieceId);
    if (!piece) return;
    // The middle of the stop: its first path, halfway along.
    const geom = getPieceDef(piece.type, piece.flipped).paths[0].geom;
    samplePath(geom, pathLength(geom) / 2, sample);
    const ch = Math.cos(piece.pose.heading);
    const sh = Math.sin(piece.pose.heading);
    const x = piece.pose.x + sample.x * ch - sample.z * sh;
    const z = piece.pose.z + sample.x * sh + sample.z * ch;
    const top = piece.y + sample.y + TRACK_THICKNESS;
    const size = (d.state === "next" ? DISC_NEXT : DISC) * (d.via ? VIA_SCALE : 1);
    const tag = { kind: d.via ? "route-via" : "route-stop", pieceId: d.pieceId, index: d.stop ?? index };

    const token = new Sprite(this.discMaterial(d));
    const height = d.via ? DISC_HEIGHT * VIA_SCALE : DISC_HEIGHT;
    token.position.set(x, top + height, z);
    token.scale.set(size, size, 1);
    token.renderOrder = 4;
    token.name = "route-stop";
    token.userData = { ...tag, size, next: d.state === "next", base: token.position.clone() };
    this.group.add(token);
    this.discs.push(token);

    // A thin wooden post from the track up to the disc, so it reads as standing over the stop.
    const post = new Mesh(this.postGeom, this.mats.naturalWood as Material);
    post.position.set(x, top, z);
    post.scale.set(1, height, 1);
    post.userData = { ...tag };
    this.group.add(post);
  }
}

/**
 * A stop disc's face: a round token of the line's colour seen a little from above (its edge showing below), the
 * number in white; "next" with a white rim, "unreachable" greyed with a red "!". Null where there's no canvas (tests).
 */
function discTexture(d: DiscSpec): CanvasTexture | null {
  if (typeof document === "undefined") return null;
  const S = 128;
  const c = document.createElement("canvas");
  c.width = c.height = S;
  const g = c.getContext("2d")!;
  const grey = d.state === "unreachable";
  const face = grey ? "#a8a29a" : d.colour;
  const r = grey ? S * 0.34 : S * 0.4;
  const cx = grey ? S * 0.45 : S / 2;
  const cy = grey ? S * 0.44 : S / 2 - 3;
  const edge = new Color(face).multiplyScalar(0.62).getStyle();
  // Soft drop under the token, then its edge (the token's thickness), then the face.
  g.fillStyle = "rgba(40, 25, 10, 0.25)";
  g.beginPath();
  g.ellipse(cx, cy + 9, r + 2, r + 1, 0, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = edge;
  g.beginPath();
  g.arc(cx, cy + 6, r, 0, Math.PI * 2);
  g.fill();
  const shade = g.createRadialGradient(cx - r * 0.35, cy - r * 0.45, r * 0.1, cx, cy, r);
  shade.addColorStop(0, new Color(face).lerp(new Color("#ffffff"), 0.25).getStyle());
  shade.addColorStop(1, face);
  g.fillStyle = shade;
  g.beginPath();
  g.arc(cx, cy, r, 0, Math.PI * 2);
  g.fill();
  if (grey) {
    // A bold red ring, edged white so it shows on red roofs too: a stop no track leads to reads as a problem at a glance.
    g.strokeStyle = "#ffffff";
    g.lineWidth = 4;
    g.beginPath();
    g.arc(cx, cy, r + 1, 0, Math.PI * 2);
    g.stroke();
    g.strokeStyle = "#d33a2c";
    g.lineWidth = 12;
    g.beginPath();
    g.arc(cx, cy, r - 6, 0, Math.PI * 2);
    g.stroke();
  }
  if (d.state === "next") {
    g.strokeStyle = "#ffffff";
    g.lineWidth = 7;
    g.beginPath();
    g.arc(cx, cy, r - 3.5, 0, Math.PI * 2);
    g.stroke();
  }
  if (d.via) {
    // A via point: a white dot in the middle, no number (it's passed, not a stop).
    g.fillStyle = "#ffffff";
    g.beginPath();
    g.arc(cx, cy, r * 0.38, 0, Math.PI * 2);
    g.fill();
  }
  const fit = discLabel(d.label, r, (text, size) => {
    g.font = `bold ${Math.round(size)}px system-ui, sans-serif`;
    return g.measureText(text).width;
  });
  g.font = `bold ${Math.round(fit.size)}px system-ui, sans-serif`;
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.lineJoin = "round";
  g.lineWidth = 6;
  g.strokeStyle = grey ? "rgba(255, 255, 255, 0.5)" : "rgba(0, 0, 0, 0.28)";
  g.strokeText(fit.text, cx, cy + 3);
  g.fillStyle = grey ? "#5a534c" : "#ffffff";
  g.fillText(fit.text, cx, cy + 3);
  if (grey) {
    // A red badge with a white "!" at the disc's lower right (a problem, not "remove"), the number still showing.
    const bx = cx + r * 0.68;
    const by = cy + r * 0.62;
    const br = S * 0.19;
    g.fillStyle = "#ffffff";
    g.beginPath();
    g.arc(bx, by, br + 4, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = "#d33a2c";
    g.beginPath();
    g.arc(bx, by, br, 0, Math.PI * 2);
    g.fill();
    g.lineCap = "round";
    g.strokeStyle = "#ffffff";
    g.lineWidth = 5.5;
    g.beginPath();
    g.moveTo(bx, by - br * 0.55);
    g.lineTo(bx, by + br * 0.12);
    g.stroke();
    g.fillStyle = "#ffffff";
    g.beginPath();
    g.arc(bx, by + br * 0.5, 3.2, 0, Math.PI * 2);
    g.fill();
  }
  const tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}


/**
 * A disc's label as it fits inside it (radius `r` px, `width` measuring text at a size): one number big, a pair a
 * little smaller, more smaller still, and a long list of visits ("4·6·8·1", QA: clipped) smaller again down to what
 * still reads (half the radius), past which its first two and "+" ("4·6+"), or its first and "+".
 */
export function discLabel(label: string, r: number, width: (text: string, size: number) => number): { text: string; size: number } {
  const room = r * 1.5;
  let size = r * (label.length > 2 ? 0.72 : label.length > 1 ? 1.0 : 1.25);
  const w = width(label, size);
  if (w <= room) return { text: label, size };
  size = Math.max(r * 0.5, (size * room) / w);
  if (width(label, size) <= room) return { text: label, size };
  // (The first two and "+"; with big numbers, the first and "+".)
  const parts = label.split("·");
  for (const text of [`${parts.slice(0, 2).join("·")}+`, `${parts[0]}+`]) {
    size = r * 0.72;
    const w2 = width(text, size);
    if (w2 <= room) return { text, size };
    if (width(text, r * 0.5) <= room) return { text, size: (size * room) / w2 };
  }
  return { text: `${parts[0]}+`, size: r * 0.5 };
}

/**
 * How much wider to draw ribbons seen from `distance` mm (on a view `heightPx` tall, `fovDeg` vertical) so they're at
 * least `minPx` on screen: 1 close up; in steps of √2, so a zoom rebuilds them only when it crosses a step.
 */
export function ribbonScale(distance: number, heightPx: number, fovDeg: number, minPx = 4): number {
  const pxPerMm = heightPx / (2 * distance * Math.tan((fovDeg * Math.PI) / 360));
  const want = minPx / pxPerMm / RIBBON_WIDTH;
  if (want <= 1) return 1;
  return Math.SQRT2 ** Math.ceil(Math.log(want) / Math.log(Math.SQRT2));
}

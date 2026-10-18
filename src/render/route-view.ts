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

export interface DiscSpec {
  pieceId: number;
  label: string;
  colour: string;
  state: "next" | "stop" | "unreachable";
  /** The stop it stands for (in its tag, for picking); else its place in the list given. */
  stop?: number;
}

/** The ribbon: its width (mm), how far over the track's top it lies, and how finely it follows curves. */
const RIBBON_WIDTH = 14;
const RIBBON_LIFT = 0.4;
/** Dashes lie a little higher, so where a dotted way runs over a solid one they show on top. */
const DOTS_LIFT = 0.7;
const STEP = 6;
/**
 * Dotted ribbons: dash and gap lengths (mm), and the dashes' widths: a dark outline under a light core, so they read on
 * light wood as a way, not as sleepers (long, narrow, along the track).
 */
const DASH = 16;
const GAP = 10;
const DOT_OUTLINE = 16;
const DOT_CORE = 8;
const DOT_OUTLINE_COLOUR = "#2b2f3a";
/** The red dashes of a gap no track crosses. */
const GAP_COLOUR = "#d33a2c";
const GAP_WIDTH = 9;
const RIBBON_OPACITY = 0.85;
/**
 * Stop discs keep one size on screen, as map markers do (a 22 mm token is a few pixels at the usual zoom): a fraction
 * of the view's distance, about 34 px across on a phone held upright with the game's 30° camera ("next" a little
 * bigger). They float this high (mm) over the track's top, on a post.
 */
const DISC = 0.022;
const DISC_NEXT = 0.028;
const DISC_HEIGHT = 70;
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
  /** The discs drawn (sprites), each with its place over its stop (`userData.base`) and size (`userData.size`). */
  private discs: Sprite[] = [];
  /** Animation: the next stop's pulse until this time, and a disc (by stop) popping in since `popAt` (seconds). */
  private pulseFrom = -Infinity;
  private popStop = -1;
  private popAt = -Infinity;
  /** The camera's view the discs were last fanned out for (its matrix, the view's height, its fov). */
  private fannedFor: number[] = [];

  constructor(
    private readonly layout: Layout,
    private readonly mats: Materials,
  ) {
    this.group.name = "route";
  }

  /** Draw these ribbons and discs (replacing what was drawn). Builds geometry once per call; nothing per frame. */
  show(ribbons: readonly RibbonSpec[], discs: readonly DiscSpec[], gaps: readonly GapSpec[] = []): void {
    this.clear();
    // One mesh per colour and kind: a handful of draw calls however long the route.
    const strips = new Map<string, { colour: string; dotted: boolean; pos: number[]; uv: number[] }>();
    const stripOf = (colour: string, dotted: boolean) => {
      const key = `${colour}|${dotted ? 1 : 0}`;
      let b = strips.get(key);
      if (!b) strips.set(key, (b = { colour, dotted, pos: [], uv: [] }));
      return b;
    };
    for (const r of ribbons) {
      if (r.dotted) {
        const under = stripOf(DOT_OUTLINE_COLOUR, true);
        this.dashes(r.runs, DOT_OUTLINE, DOTS_LIFT, under.pos, under.uv);
        const core = stripOf(r.colour, true);
        this.dashes(r.runs, DOT_CORE, DOTS_LIFT + 0.3, core.pos, core.uv);
      } else {
        const b = stripOf(r.colour, false);
        for (const run of r.runs) this.strip(run, b.pos, b.uv);
      }
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
      mesh.renderOrder = 3;
      mesh.name = b.dotted ? "route-dots" : "route-ribbon";
      this.group.add(mesh);
    }
    this.discs = [];
    discs.forEach((d, index) => this.disc(d, index));
    this.fannedFor = [];
  }

  /** The next stop's disc pulses (a few beats, from `now`, seconds): it has just become the next, or the card opened. */
  pulse(now: number): void {
    this.pulseFrom = now;
  }

  /** The disc of stop `stop` pops in (just added), from `now` (seconds). */
  pop(stop: number, now: number): void {
    this.popStop = stop;
    this.popAt = now;
  }

  /**
   * Size the discs for `now` (seconds): the next one's pulse, a new one's pop. True while something's still moving (the
   * caller draws another frame); false at rest, when nothing need be drawn again.
   */
  animate(now: number): boolean {
    let moving = false;
    for (const d of this.discs) {
      const u = d.userData as { size: number; index: number; next: boolean };
      let k = 1;
      const pulse = now - this.pulseFrom;
      if (u.next && pulse >= 0 && pulse < PULSE_S) {
        // A gentle beat, fading out over the pulse's time.
        k *= 1 + 0.14 * Math.sin(pulse * PULSE_HZ * Math.PI * 2) ** 2 * (1 - pulse / PULSE_S);
        moving = true;
      }
      const pop = now - this.popAt;
      if (u.index === this.popStop && pop >= 0 && pop < POP_S) {
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

  clear(): void {
    for (const o of this.group.children) {
      // Ribbon geometry is the call's own; the post geometry and the materials are kept for the next show().
      if ((o as Mesh).isMesh && (o as Mesh).geometry !== this.postGeom) (o as Mesh).geometry.dispose();
    }
    this.group.clear();
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

  /** A quad strip along `run` from a to b (path distances), sampled on a fixed grid so runs over the same track agree. */
  private span(run: PathRun, a: number, b: number, lift: number, pos: number[], uv: number[], width = RIBBON_WIDTH): void {
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
      this.point(run, s, w, lift, l);
      this.point(run, s, -w, lift, r);
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

  private strip(run: PathRun, pos: number[], uv: number[]): void {
    if (!this.layout.getPiece(run.pieceId)) return;
    this.span(run, run.s0, run.s1, RIBBON_LIFT, pos, uv);
  }

  /** Dashes along the runs, spaced by distance along the whole way (so they run on evenly from piece to piece). */
  private dashes(runs: readonly PathRun[], width: number, lift: number, pos: number[], uv: number[]): void {
    let along = 0;
    const period = DASH + GAP;
    for (const run of runs) {
      if (!this.layout.getPiece(run.pieceId)) continue;
      const dir = run.s1 >= run.s0 ? 1 : -1;
      const n = Math.abs(run.s1 - run.s0);
      // Dash k covers [k·period, k·period + DASH) of the whole way.
      let k = Math.floor(along / period);
      for (;;) {
        const d0 = Math.max(k * period, along);
        const d1 = Math.min(k * period + DASH, along + n);
        if (d0 >= along + n) break;
        if (d1 > d0) this.span(run, run.s0 + dir * (d0 - along), run.s0 + dir * (d1 - along), lift, pos, uv, width);
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
        opacity: dotted ? 0.9 : RIBBON_OPACITY,
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
    const key = `${d.label}|${d.colour}|${d.state}`;
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
    const size = d.state === "next" ? DISC_NEXT : DISC;
    const tag = { kind: "route-stop", pieceId: d.pieceId, index: d.stop ?? index };

    const token = new Sprite(this.discMaterial(d));
    token.position.set(x, top + DISC_HEIGHT, z);
    token.scale.set(size, size, 1);
    token.renderOrder = 4;
    token.name = "route-stop";
    token.userData = { ...tag, size, next: d.state === "next", base: token.position.clone() };
    this.group.add(token);
    this.discs.push(token);

    // A thin wooden post from the track up to the disc, so it reads as standing over the stop.
    const post = new Mesh(this.postGeom, this.mats.naturalWood as Material);
    post.position.set(x, top, z);
    post.scale.set(1, DISC_HEIGHT, 1);
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
  g.font = `bold ${Math.round(r * (d.label.length > 2 ? 0.72 : d.label.length > 1 ? 1.0 : 1.25))}px system-ui, sans-serif`;
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.lineJoin = "round";
  g.lineWidth = 6;
  g.strokeStyle = grey ? "rgba(255, 255, 255, 0.5)" : "rgba(0, 0, 0, 0.28)";
  g.strokeText(d.label, cx, cy + 3);
  g.fillStyle = grey ? "#5a534c" : "#ffffff";
  g.fillText(d.label, cx, cy + 3);
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


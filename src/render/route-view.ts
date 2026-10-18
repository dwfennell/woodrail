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
  type Material,
} from "three";
import { createSample, getPieceDef, pathLength, samplePath, TRACK_THICKNESS, type Layout } from "../track";
import type { PathRun } from "../game/route-path";
import type { Materials } from "./materials";

export interface RibbonSpec {
  runs: readonly PathRun[];
  colour: string;
  dotted?: boolean;
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
/** Dotted ribbons: dash and gap lengths (mm). */
const DASH = 7;
const GAP = 6;
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

  constructor(
    private readonly layout: Layout,
    private readonly mats: Materials,
  ) {
    this.group.name = "route";
  }

  /** Draw these ribbons and discs (replacing what was drawn). Builds geometry once per call; nothing per frame. */
  show(ribbons: readonly RibbonSpec[], discs: readonly DiscSpec[]): void {
    this.clear();
    // One mesh per colour and kind: a handful of draw calls however long the route.
    const strips = new Map<string, { colour: string; dotted: boolean; pos: number[]; uv: number[] }>();
    for (const r of ribbons) {
      const key = `${r.colour}|${r.dotted ? 1 : 0}`;
      let b = strips.get(key);
      if (!b) strips.set(key, (b = { colour: r.colour, dotted: !!r.dotted, pos: [], uv: [] }));
      if (r.dotted) this.dashes(r.runs, b.pos, b.uv);
      else for (const run of r.runs) this.strip(run, b.pos, b.uv);
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
    discs.forEach((d, index) => this.disc(d, index));
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
  private span(run: PathRun, a: number, b: number, lift: number, pos: number[], uv: number[]): void {
    const lo = Math.min(a, b);
    const hi = Math.max(a, b);
    if (hi - lo < 1e-3) return;
    const ss = [lo];
    for (let s = (Math.floor(lo / STEP) + 1) * STEP; s < hi - 0.5; s += STEP) ss.push(s);
    ss.push(hi);
    const w = RIBBON_WIDTH / 2;
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
  private dashes(runs: readonly PathRun[], pos: number[], uv: number[]): void {
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
        if (d1 > d0) this.span(run, run.s0 + dir * (d0 - along), run.s0 + dir * (d1 - along), DOTS_LIFT, pos, uv);
        k++;
      }
      along += n;
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
        opacity: dotted ? 0.75 : RIBBON_OPACITY,
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
    token.userData = { ...tag };
    this.group.add(token);

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
 * number in white; "next" with a white rim, "unreachable" greyed with a red ✕. Null where there's no canvas (tests).
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
    // A red badge with a white ✕ at the disc's lower right, the number still showing.
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
    const k = br * 0.45;
    g.lineCap = "round";
    g.strokeStyle = "#ffffff";
    g.lineWidth = 5.5;
    g.beginPath();
    g.moveTo(bx - k, by - k);
    g.lineTo(bx + k, by + k);
    g.moveTo(bx + k, by - k);
    g.lineTo(bx - k, by + k);
    g.stroke();
  }
  const tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}


import { BufferAttribute, BufferGeometry, DoubleSide, Mesh, MeshBasicMaterial, type Scene } from "three";

/** Where goods come from (into the place shown) and go (out of it): gold in, green out, as on the card. */
export type HintTone = "in" | "out";

/** A line of chevrons on the ground from one place to another, pointing the way the goods go. */
export interface HintLine {
  readonly from: { readonly x: number; readonly z: number };
  readonly to: { readonly x: number; readonly z: number };
  readonly tone: HintTone;
}

/** A soft ring round a place on the ground. */
export interface HintRing {
  readonly x: number;
  readonly z: number;
  readonly tone: HintTone;
}

/** The colours, warm gold (as Show me's rings) for goods coming in, lacquer green for goods going out. */
const COLOURS: Record<HintTone, readonly [number, number, number]> = { in: [1, 0.62, 0.1], out: [0.25, 0.62, 0.3] };
/** Chevrons this far apart along a line (mm), each this long and wide. */
const STEP = 110;
const LENGTH = 44;
const WIDTH = 64;
/** Left clear at each end of a line (mm), so the chevrons stop short of the yards. */
const END_GAP = 150;
/** A ring's radius and width (mm), and its points. */
const RING_R = 170;
const RING_W = 22;
const RING_SEGMENTS = 40;
/** Above the ground (mm). */
const LIFT = 4;
/** At most this many chevrons a line: a line across the whole map stays a few hundred triangles. */
const MAX_CHEVRONS = 120;

/**
 * The triangles for `lines` and `rings`, on the ground (`groundY` at a point): positions and RGBA colours, three
 * vertices a triangle (no index). Pure, for tests.
 */
export function hintTriangles(lines: readonly HintLine[], rings: readonly HintRing[], groundY: (x: number, z: number) => number): { pos: number[]; col: number[] } {
  const pos: number[] = [];
  const col: number[] = [];
  const vert = (x: number, z: number, c: readonly [number, number, number], a: number) => {
    pos.push(x, groundY(x, z) + LIFT, z);
    col.push(c[0], c[1], c[2], a);
  };
  for (const l of lines) {
    const dx = l.to.x - l.from.x;
    const dz = l.to.z - l.from.z;
    const len = Math.hypot(dx, dz);
    if (len < END_GAP * 2 + LENGTH) continue;
    const ux = dx / len;
    const uz = dz / len;
    const c = COLOURS[l.tone];
    const span = len - END_GAP * 2;
    const n = Math.min(MAX_CHEVRONS, Math.max(1, Math.floor(span / STEP)));
    const step = span / n;
    for (let k = 0; k <= n; k++) {
      const t = END_GAP + k * step;
      // A chevron: an arrowhead with a notch, two triangles (tip, left wing, notch) and (tip, notch, right wing).
      const tx = l.from.x + ux * (t + LENGTH / 2);
      const tz = l.from.z + uz * (t + LENGTH / 2);
      const bx = l.from.x + ux * (t - LENGTH / 2);
      const bz = l.from.z + uz * (t - LENGTH / 2);
      const nx = l.from.x + ux * t;
      const nz = l.from.z + uz * t;
      const wx = -uz * (WIDTH / 2);
      const wz = ux * (WIDTH / 2);
      vert(tx, tz, c, 0.9);
      vert(bx + wx, bz + wz, c, 0.9);
      vert(nx, nz, c, 0.9);
      vert(tx, tz, c, 0.9);
      vert(nx, nz, c, 0.9);
      vert(bx - wx, bz - wz, c, 0.9);
    }
  }
  for (const r of rings) {
    const c = COLOURS[r.tone];
    for (let s = 0; s < RING_SEGMENTS; s++) {
      const a0 = (s / RING_SEGMENTS) * Math.PI * 2;
      const a1 = ((s + 1) / RING_SEGMENTS) * Math.PI * 2;
      const p = (a: number, rad: number): [number, number] => [r.x + Math.cos(a) * rad, r.z + Math.sin(a) * rad];
      const [o0, o1, i0, i1] = [p(a0, RING_R), p(a1, RING_R), p(a0, RING_R - RING_W), p(a1, RING_R - RING_W)];
      vert(o0[0], o0[1], c, 0.85);
      vert(o1[0], o1[1], c, 0.85);
      vert(i0[0], i0[1], c, 0.85);
      vert(i0[0], i0[1], c, 0.85);
      vert(o1[0], o1[1], c, 0.85);
      vert(i1[0], i1[1], c, 0.85);
    }
  }
  return { pos, col };
}

/**
 * Sandbox's chain hints on the map: chevrons on the ground from where an industry's goods come from to it, and from it
 * to where they go (while its card is open), or rings round those places (while one is held, to place it). One mesh,
 * one draw call, built only when what it shows changes (`key`); hidden after. Nothing per frame or per pointer move.
 */
export class ChainHintsView {
  private mesh: Mesh<BufferGeometry, MeshBasicMaterial> | null = null;
  private key = "";
  /** How many times it was built (for tests: showing the same again doesn't rebuild). */
  builds = 0;

  constructor(private readonly scene: Scene) {}

  get showing(): boolean {
    return this.mesh?.visible === true;
  }

  /** What it shows now ("" when hidden): for tests. */
  get shown(): string {
    return this.showing ? this.key : "";
  }

  /** Show these lines and rings (built afresh only if they differ from the last). Returns true if anything changed. */
  show(lines: readonly HintLine[], rings: readonly HintRing[], groundY: (x: number, z: number) => number): boolean {
    if (lines.length === 0 && rings.length === 0) return this.hide();
    const key = [...lines.map((l) => `${l.tone}${Math.round(l.from.x)},${Math.round(l.from.z)}>${Math.round(l.to.x)},${Math.round(l.to.z)}`), ...rings.map((r) => `o${r.tone}${Math.round(r.x)},${Math.round(r.z)}`)].join(";");
    if (this.mesh && key === this.key) {
      if (this.mesh.visible) return false;
      this.mesh.visible = true;
      return true;
    }
    this.key = key;
    this.builds++;
    const { pos, col } = hintTriangles(lines, rings, groundY);
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new BufferAttribute(new Float32Array(pos), 3));
    geometry.setAttribute("color", new BufferAttribute(new Float32Array(col), 4));
    geometry.computeBoundingSphere();
    if (this.mesh) {
      this.mesh.geometry.dispose();
      this.mesh.geometry = geometry;
    } else {
      const material = new MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, side: DoubleSide });
      this.mesh = new Mesh(geometry, material);
      this.mesh.renderOrder = 5;
      this.mesh.name = "chain-hints";
      this.scene.add(this.mesh);
    }
    this.mesh.visible = true;
    return true;
  }

  /** Hide it (kept, to show again cheaply). Returns true if it was showing. */
  hide(): boolean {
    if (!this.mesh?.visible) return false;
    this.mesh.visible = false;
    return true;
  }
}

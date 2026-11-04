import { BufferGeometry, DoubleSide, ExtrudeGeometry, Float32BufferAttribute, Group, Matrix4, Mesh, MeshBasicMaterial, Path, Shape, ShapeGeometry, Vector2, Vector3, type Material } from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { hillsOf, inTunnel, mayTunnel, tunnelsOn, type Landscape } from "../landscape";
import { createSample, getPieceDef, isTunnelMouth, pathLength, samplePath, TRENCH_HALF, TRENCH_WALL, type Layout } from "../track";

/** A tunnel's portal: where its track meets the open air, facing out along `out` (a world heading). */
export interface Portal {
  x: number;
  z: number;
  /** The track's base there. */
  y: number;
  /** The way the portal faces (out of the tunnel), a world heading. */
  out: number;
  /** In a hill's side, or at the foot of a tunnel mouth's cutting (as wide as the cutting, up to the felt). */
  kind: "hill" | "mouth";
  /** How high its frame stands over the track's base (mm). */
  top: number;
}

/** A short dash of the line painted over a tunnel, on the ground above it: from (x0, z0) to (x1, z1) at height y. */
interface Dash {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  y: number;
}

/** The portal's opening: half its width, where its arch springs and so its crown (mm over the track's base). */
const OPENING_HALF = 23;
const SPRING = 54;
/** A hill's portal: its frame this wide and high (two levels of hill are 96). */
const HILL_HALF = 28;
const HILL_HEIGHT = 86;
/** The frame stands this far proud of the hill's side (or the cutting's end). */
const FRAME_DEPTH = 5;
/** The dark of the opening, just outside the face it's on (so the hill or the felt doesn't show through it). */
const DARK_OUT = 0.8;
/** The dashes over a tunnel: this long, every this far, this wide (mm). */
const DASH = 10;
const DASH_EVERY = 22;
const DASH_WIDTH = 5;
/** Along track, sampled this often for where it goes in and out of the ground. */
const STEP = 6;

const sample = createSample();

/**
 * Where the layout's tunnels are: their portals (where track goes from open air into two levels of ground, and at the
 * foot of each tunnel mouth) and the dashes painted over them. Pure (from the layout and the land), for the view and tests.
 */
export function findTunnels(layout: Layout, land: Landscape): { portals: Portal[]; dashes: Dash[]; pieces: Set<number> } {
  const portals: Portal[] = [];
  const dashes: Dash[] = [];
  const pieces = new Set<number>();
  if (!tunnelsOn()) return { portals, dashes, pieces };
  const hills = hillsOf(land.grid);
  for (const id of layout.pieceIds()) {
    if (layout.isLifted(id)) continue;
    const p = layout.getPiece(id)!;
    if (!mayTunnel(land, p.type, p.flipped, p.pose, p.y)) continue;
    const def = getPieceDef(p.type, p.flipped);
    const c = Math.cos(p.pose.heading);
    const s = Math.sin(p.pose.heading);
    const world = (lx: number, lz: number) => ({ x: p.pose.x + lx * c - lz * s, z: p.pose.z + lx * s + lz * c });
    for (const path of def.paths) {
      const len = pathLength(path.geom);
      const n = Math.max(2, Math.ceil(len / STEP));
      const at = (d: number) => {
        samplePath(path.geom, d, sample);
        const w = world(sample.x, sample.z);
        return { ...w, y: p.y + sample.y, heading: p.pose.heading + sample.heading };
      };
      /** Where along the path a test changes, between two samples: halved down to a fraction of a mm. */
      const edge = (lo: number, hi: number, test: (d: number) => boolean) => {
        const was = test(lo);
        for (let i = 0; i < 12; i++) {
          const mid = (lo + hi) / 2;
          if (test(mid) === was) lo = mid;
          else hi = mid;
        }
        return { lo, hi };
      };
      if (isTunnelMouth(p.type)) {
        pieces.add(id);
        // (Its path runs down from its top end, s = 0.) Its portal where it runs in under a hill's side, else at its foot.
        const under = (d: number) => {
          const q = at(d);
          return hills.groundAt(q.x, q.z) > p.y + 0.5;
        };
        let face = -1;
        for (let k = 1; k <= n && face < 0; k++) if (under((len * k) / n)) face = edge((len * (k - 1)) / n, (len * k) / n, under).hi;
        const q = at(face >= 0 ? face : len);
        const depth = p.y - samplePath(path.geom, len, sample).y;
        portals.push({ x: q.x, z: q.z, y: q.y, out: q.heading + Math.PI, kind: face >= 0 ? "hill" : "mouth", top: face >= 0 ? HILL_HEIGHT : depth + p.y + 0.6 });
        continue;
      }
      const covered = (d: number) => {
        const q = at(d);
        return inTunnel(land, q.x, q.z, q.y);
      };
      let was = covered(0);
      let d0 = was ? 0 : -1;
      if (was) pieces.add(id);
      for (let k = 1; k <= n; k++) {
        const d = (len * k) / n;
        const now = covered(d);
        if (now) pieces.add(id);
        if (now !== was) {
          const { lo, hi } = edge((len * (k - 1)) / n, d, covered);
          const q = at(hi);
          // (Where the line goes under the ground at its own level: a hill's side, met square.)
          portals.push({ x: q.x, z: q.z, y: q.y, out: now ? q.heading + Math.PI : q.heading, kind: "hill", top: HILL_HEIGHT });
          if (now) d0 = hi;
          else {
            dashLine(d0, lo);
            d0 = -1;
          }
        }
        was = now;
      }
      if (d0 >= 0) dashLine(d0, len);
      // The painted dashes, on the ground over the covered stretch (from d0 to d1 along this path).
      function dashLine(from: number, to: number): void {
        for (let a = from + 4; a + DASH <= to - 2; a += DASH_EVERY) {
          const q0 = at(a);
          const q1 = at(a + DASH);
          const y = Math.max(hills.groundAt(q0.x, q0.z), hills.groundAt(q1.x, q1.z)) + 0.5;
          dashes.push({ x0: q0.x, z0: q0.z, x1: q1.x, z1: q1.z, y });
        }
      }
    }
  }
  // Two pieces meeting at a hill's side both find it: one portal.
  const kept: Portal[] = [];
  for (const q of portals) if (!kept.some((k) => Math.hypot(k.x - q.x, k.z - q.z) < 6 && Math.abs(k.y - q.y) < 6)) kept.push(q);
  return { portals: kept, dashes, pieces };
}

/**
 * Tunnels drawn: a painted portal round each opening, its dark mouth (track and trains behind it are hidden by the
 * hill or the felt, which stay whole: no cut and no rebuild of the ground), and dashes over the tunnel on the ground
 * above. Rebuilt only when the tunnels found change (a key of them).
 */
export class TunnelsView {
  readonly group = new Group();
  private key = "";
  private readonly dark = new MeshBasicMaterial({ color: "#1b120b", side: DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  private readonly dash = new MeshBasicMaterial({ color: "#3a2a1c", transparent: true, opacity: 0.55, depthWrite: false, side: DoubleSide, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });

  constructor(private readonly frame: Material) {}

  /** The portals and dashes as last found (tests, the pictures). */
  found: { portals: Portal[]; dashes: Dash[]; pieces: Set<number> } = { portals: [], dashes: [], pieces: new Set() };

  sync(layout: Layout, land: Landscape): boolean {
    const found = findTunnels(layout, land);
    const key = found.portals.map((p) => `${p.x.toFixed(1)},${p.z.toFixed(1)},${p.y.toFixed(1)},${p.out.toFixed(3)},${p.kind}`).join(";") + `|${found.dashes.length}:${found.dashes.map((d) => `${d.x0.toFixed(1)},${d.z0.toFixed(1)},${d.y.toFixed(1)}`).join(";")}`;
    if (key === this.key) return false;
    this.key = key;
    this.found = found;
    for (const m of [...this.group.children] as Mesh[]) {
      this.group.remove(m);
      m.geometry.dispose();
    }
    const frames: BufferGeometry[] = [];
    const darks: BufferGeometry[] = [];
    for (const p of found.portals) {
      const { frame, dark } = portalGeometry(p);
      frames.push(frame);
      darks.push(dark);
    }
    if (frames.length > 0) {
      const f = new Mesh(mergeGeometries(frames), this.frame);
      f.castShadow = true;
      f.receiveShadow = true;
      const d = new Mesh(mergeGeometries(darks), this.dark);
      this.group.add(f, d);
      for (const g of [...frames, ...darks]) g.dispose();
    }
    if (found.dashes.length > 0) this.group.add(new Mesh(dashGeometry(found.dashes), this.dash));
    return true;
  }

  dispose(): void {
    for (const m of this.group.children as Mesh[]) m.geometry.dispose();
    this.dark.dispose();
    this.dash.dispose();
  }
}

/** The opening's outline (across, up), anticlockwise: straight sides up to the spring, a half circle over. */
function openingShape(): { x: number; y: number }[] {
  const pts: { x: number; y: number }[] = [
    { x: OPENING_HALF, y: 0 },
    { x: OPENING_HALF, y: SPRING },
  ];
  for (let i = 1; i < 16; i++) {
    const a = (Math.PI * i) / 16;
    pts.push({ x: OPENING_HALF * Math.cos(a), y: SPRING + OPENING_HALF * Math.sin(a) });
  }
  pts.push({ x: -OPENING_HALF, y: SPRING }, { x: -OPENING_HALF, y: 0 });
  return pts;
}

/** A portal's frame (a painted plate round the opening, rounded over the top for a hill's) and its dark, in the world. */
export function portalGeometry(p: Portal): { frame: BufferGeometry; dark: BufferGeometry } {
  const mouth = p.kind === "mouth";
  const half = mouth ? TRENCH_HALF + TRENCH_WALL : HILL_HALF;
  const height = p.top;
  const outer = new Shape();
  outer.moveTo(-half, 0);
  outer.lineTo(half, 0);
  if (mouth) {
    outer.lineTo(half, height);
    outer.lineTo(-half, height);
  } else {
    // Shoulders, then a round top over the arch.
    const r = half;
    outer.lineTo(half, height - r);
    outer.absarc(0, height - r, r, 0, Math.PI, false);
  }
  outer.lineTo(-half, 0);
  const hole = openingShape();
  outer.holes.push(new Path(hole.map((q) => new Vector2(q.x, q.y)).reverse()));
  const frame = new ExtrudeGeometry(outer, { depth: FRAME_DEPTH, bevelEnabled: true, bevelThickness: 0.8, bevelSize: 0.8, bevelSegments: 1, curveSegments: 12 });
  const darkShape = new Shape();
  hole.forEach((q, i) => (i === 0 ? darkShape.moveTo(q.x, q.y) : darkShape.lineTo(q.x, q.y)));
  const dark = new ShapeGeometry(darkShape);
  dark.translate(0, 0, DARK_OUT);
  // Local: x across, y up, z out of the tunnel. To the world: z along `out`, x to its right, up y, at the track's base.
  const ox = Math.cos(p.out);
  const oz = Math.sin(p.out);
  const m = new Matrix4().makeBasis(new Vector3(-oz, 0, ox), new Vector3(0, 1, 0), new Vector3(ox, 0, oz)).setPosition(p.x, p.y, p.z);
  frame.applyMatrix4(m);
  dark.applyMatrix4(m);
  frame.deleteAttribute("uv");
  dark.deleteAttribute("uv");
  return { frame, dark };
}

/** The dashes over tunnels: flat strips on the ground, one geometry. */
function dashGeometry(dashes: readonly Dash[]): BufferGeometry {
  const pos: number[] = [];
  for (const d of dashes) {
    const dx = d.x1 - d.x0;
    const dz = d.z1 - d.z0;
    const l = Math.hypot(dx, dz) || 1;
    const nx = (-dz / l) * (DASH_WIDTH / 2);
    const nz = (dx / l) * (DASH_WIDTH / 2);
    const a = [d.x0 + nx, d.y, d.z0 + nz];
    const b = [d.x1 + nx, d.y, d.z1 + nz];
    const c = [d.x1 - nx, d.y, d.z1 - nz];
    const e = [d.x0 - nx, d.y, d.z0 - nz];
    pos.push(...a, ...e, ...c, ...a, ...c, ...b);
  }
  const g = new BufferGeometry();
  g.setAttribute("position", new Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

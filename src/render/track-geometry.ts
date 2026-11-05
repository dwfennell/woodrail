import {
  BoxGeometry,
  BufferGeometry,
  CylinderGeometry,
  ExtrudeGeometry,
  Float32BufferAttribute,
  Matrix4,
  Shape,
  ShapeGeometry,
  ShapeUtils,
  Vector2,
  Vector3,
} from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { mergeGeometries, mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import {
  createSample,
  GROOVE_SPACING,
  GROOVE_WIDTH,
  canStandOnArches,
  isTunnelMouth,
  pathLength,
  RISER_HEIGHT,
  samplePath,
  TRACK_THICKNESS,
  TRACK_WIDTH,
  type ConnectorDef,
  type PathGeom,
  type PieceDef,
} from "../track";
import { nonIndexed } from "./non-indexed";

// Render-only dimensions (mm).
export const GROOVE_DEPTH = 3;
export const PEG_HEIGHT = 11; // a seated peg shows 1 mm below the track surface inside the keyhole
export const PEG_NECK_LENGTH = 8;
export const PEG_NECK_WIDTH = 6;
export const PEG_HEAD_RADIUS = 6;
export const SOCKET_CLEARANCE = 0.6;
export const BUFFER_EXTRA = 38; // body continues past the buffer path end to carry the stop block
const TOP_RADIUS = 2.5;
const BOTTOM_RADIUS = 1;

export interface ProfilePoint {
  u: number;
  v: number;
  /** Shade smoothly through this point (bevel arcs) rather than as a hard corner. */
  smooth: boolean;
}

/** Counter-clockwise (u right/left-lateral, v up) closed outline of the track body cross-section. */
export function bodyProfile(): ProfilePoint[] {
  const w = TRACK_WIDTH / 2;
  const h = TRACK_THICKNESS;
  const pts: ProfilePoint[] = [];
  const arc = (cu: number, cv: number, r: number, a0: number, a1: number) => {
    const n = 5;
    for (let i = 0; i <= n; i++) {
      const a = a0 + ((a1 - a0) * i) / n;
      pts.push({ u: cu + r * Math.cos(a), v: cv + r * Math.sin(a), smooth: i > 0 && i < n });
    }
  };
  arc(-w + BOTTOM_RADIUS, BOTTOM_RADIUS, BOTTOM_RADIUS, Math.PI, 1.5 * Math.PI);
  arc(w - BOTTOM_RADIUS, BOTTOM_RADIUS, BOTTOM_RADIUS, 1.5 * Math.PI, 2 * Math.PI);
  arc(w - TOP_RADIUS, h - TOP_RADIUS, TOP_RADIUS, 0, 0.5 * Math.PI);
  arc(-w + TOP_RADIUS, h - TOP_RADIUS, TOP_RADIUS, 0.5 * Math.PI, Math.PI);
  return pts;
}

/** Groove cutter: a slot from just above the surface down to the groove floor, slightly rounded at the bottom. */
export function grooveProfile(centre: number): ProfilePoint[] {
  const half = GROOVE_WIDTH / 2;
  const floor = TRACK_THICKNESS - GROOVE_DEPTH;
  const r = 1.2;
  const pts: ProfilePoint[] = [];
  const arc = (cu: number, cv: number, a0: number, a1: number) => {
    for (let i = 0; i <= 3; i++) {
      const a = a0 + ((a1 - a0) * i) / 3;
      pts.push({ u: cu + r * Math.cos(a), v: cv + r * Math.sin(a), smooth: i > 0 && i < 3 });
    }
  };
  arc(centre - half + r, floor + r, Math.PI, 1.5 * Math.PI);
  arc(centre + half - r, floor + r, 1.5 * Math.PI, 2 * Math.PI);
  pts.push({ u: centre + half, v: TRACK_THICKNESS + 2, smooth: false });
  pts.push({ u: centre - half, v: TRACK_THICKNESS + 2, smooth: false });
  return pts;
}

export interface Frame {
  x: number;
  y: number;
  z: number;
  heading: number;
  s: number;
}

/** The turn between samples along an arc (radians). */
export const ARC_STEP = (3 * Math.PI) / 180;

/** The turn between samples along an arc in a piece's far version (`buildPieceFar`): within 0.6 mm of true. */
const FAR_ARC_STEP = (7.5 * Math.PI) / 180;
/** An S-curve's far version: a sample this far apart (mm), about every 4° of its turn. */
const FAR_S_STEP = 14;

/** Samples along a path, optionally extended straight past either end (`coarse`: for a far version). */
export function framesAlong(geom: PathGeom, extendStart: number, extendEnd: number, lineStep = 0, coarse = false): Frame[] {
  const len = pathLength(geom);
  const curved = geom.kind !== "line" || geom.rise !== 0 || !!geom.dip;
  // An arc every 3° of turn (within 0.07 mm of true at the outer edge of a large curve: more only costs triangles, a
  // large curve's were a third of a busy map's), a balloon loop's big gentle curves every 6 mm, a slope every 3 mm.
  const steps = curved
    ? geom.kind === "arc"
      ? Math.max(coarse ? 4 : 8, Math.ceil(Math.abs(geom.sweep) / (coarse ? FAR_ARC_STEP : ARC_STEP)))
      : Math.max(8, Math.ceil(len / (coarse && geom.kind === "s" ? FAR_S_STEP : geom.kind === "loop" ? 6 : 3)))
    : lineStep > 0
      ? Math.ceil(len / lineStep)
      : 1;
  const out: Frame[] = [];
  const p = createSample();
  const push = (s: number) => {
    samplePath(geom, s, p);
    out.push({ x: p.x, y: p.y, z: p.z, heading: p.heading, s });
  };
  if (extendStart > 0) {
    samplePath(geom, 0, p);
    out.push({ x: p.x - Math.cos(p.heading) * extendStart, y: p.y, z: p.z - Math.sin(p.heading) * extendStart, heading: p.heading, s: -extendStart });
  }
  for (let i = 0; i <= steps; i++) push((len * i) / steps);
  if (extendEnd > 0) {
    samplePath(geom, len, p);
    out.push({ x: p.x + Math.cos(p.heading) * extendEnd, y: p.y, z: p.z + Math.sin(p.heading) * extendEnd, heading: p.heading, s: len + extendEnd });
  }
  return out;
}

/**
 * Sweep a closed CCW profile along frames into a capped solid with normals and uvs (uv in mm). `edges`, if given, says
 * each profile edge's (from point i to i + 1) material slot and texture v at its two ends (else v is the perimeter so
 * far): the faces are then grouped by slot (the caps `SLOT_BODY`).
 */
export function sweep(profile: ProfilePoint[], frames: Frame[], edges?: readonly SweepEdge[]): BufferGeometry {
  const slots = [0, 1].map(() => ({ pos: [] as number[], nor: [] as number[], uv: [] as number[] }));
  let { pos, nor, uv } = slots[0];
  const n = profile.length;

  // Per-edge outward normals in profile space; per-point normals for each adjacent edge.
  const edgeN: Vector2[] = [];
  const perim: number[] = [0];
  for (let i = 0; i < n; i++) {
    const a = profile[i];
    const b = profile[(i + 1) % n];
    const du = b.u - a.u;
    const dv = b.v - a.v;
    const l = Math.hypot(du, dv) || 1;
    edgeN.push(new Vector2(dv / l, -du / l));
    perim.push(perim[i] + l);
  }
  const pointNormal = (i: number, edge: number): Vector2 => {
    if (!profile[i].smooth) return edgeN[edge];
    const prev = edgeN[(i - 1 + n) % n];
    const next = edgeN[i];
    return prev.clone().add(next).normalize();
  };

  const place = (f: Frame, u: number, v: number, target: number[]) => {
    const lx = -Math.sin(f.heading);
    const lz = Math.cos(f.heading);
    target.push(f.x + lx * u, f.y + v, f.z + lz * u);
  };
  const dir = (f: Frame, nu: number, nv: number, target: number[]) => {
    target.push(-Math.sin(f.heading) * nu, nv, Math.cos(f.heading) * nu);
  };

  for (let k = 0; k < frames.length - 1; k++) {
    const f0 = frames[k];
    const f1 = frames[k + 1];
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const na = pointNormal(i, i);
      const nb = pointNormal(j, i);
      const e = edges?.[i];
      ({ pos, nor, uv } = slots[e?.slot ?? SLOT_BODY]);
      const va = e ? e.va : perim[i];
      const vb = e ? e.vb : perim[i + 1];
      // quad corners: (f0,i) (f0,j) (f1,j) (f1,i)
      const corners: [Frame, number, Vector2, number][] = [
        [f0, i, na, va],
        [f0, j, nb, vb],
        [f1, j, nb, vb],
        [f1, i, na, va],
      ];
      // Winding: profile is CCW with outward normals to its right; sweeping forward gives outward-facing (0,3,2),(0,2,1)
      for (const idx of [0, 3, 2, 0, 2, 1]) {
        const [f, pi, nn, pv] = corners[idx];
        place(f, profile[pi].u, profile[pi].v, pos);
        dir(f, nn.x, nn.y, nor);
        uv.push(f.s, pv);
      }
    }
  }

  // End caps.
  ({ pos, nor, uv } = slots[SLOT_BODY]);
  const contour = profile.map((p) => new Vector2(p.u, p.v));
  const tris = ShapeUtils.triangulateShape(contour, []);
  const cap = (f: Frame, sign: number) => {
    const tx = Math.cos(f.heading) * sign;
    const tz = Math.sin(f.heading) * sign;
    for (const t of tris) {
      const order = sign > 0 ? [t[0], t[2], t[1]] : [t[0], t[1], t[2]];
      for (const i of order) {
        place(f, profile[i].u, profile[i].v, pos);
        nor.push(tx, 0, tz);
        uv.push(profile[i].u + 50, profile[i].v);
      }
    }
  };
  cap(frames[0], -1);
  cap(frames[frames.length - 1], 1);

  const g = new BufferGeometry();
  const all = (key: "pos" | "nor" | "uv") => (edges ? slots.flatMap((sl) => sl[key]) : slots[0][key]);
  g.setAttribute("position", new Float32BufferAttribute(all("pos"), 3));
  g.setAttribute("normal", new Float32BufferAttribute(all("nor"), 3));
  g.setAttribute("uv", new Float32BufferAttribute(all("uv"), 2));
  if (edges) {
    let start = 0;
    slots.forEach((sl, slot) => {
      const count = sl.pos.length / 3;
      if (count > 0) g.addGroup(start, count, slot);
      start += count;
    });
  }
  fixWinding(g);
  return g;
}

interface SweepEdge {
  slot: number;
  /** Texture v at the edge's two ends. */
  va: number;
  vb: number;
}

/** Ensure each triangle's winding agrees with its stored normal (outward-facing). */
function fixWinding(g: BufferGeometry): void {
  const p = g.getAttribute("position");
  const nAttr = g.getAttribute("normal");
  const uvAttr = g.getAttribute("uv");
  const a = new Vector3();
  const b = new Vector3();
  const c = new Vector3();
  const nn = new Vector3();
  for (let t = 0; t < p.count; t += 3) {
    a.fromBufferAttribute(p, t);
    b.fromBufferAttribute(p, t + 1);
    c.fromBufferAttribute(p, t + 2);
    nn.fromBufferAttribute(nAttr, t).add(nn.clone().fromBufferAttribute(nAttr, t + 1)).add(nn.clone().fromBufferAttribute(nAttr, t + 2));
    const face = b.sub(a).cross(c.sub(a));
    if (face.dot(nn) < 0) {
      for (const attr of [p, nAttr, uvAttr]) {
        const size = attr.itemSize;
        for (let k = 0; k < size; k++) {
          const v1 = attr.getComponent(t + 1, k);
          attr.setComponent(t + 1, k, attr.getComponent(t + 2, k));
          attr.setComponent(t + 2, k, v1);
        }
      }
    }
  }
}

/** Keyhole outline pointing along +a from a = a0 (neck start) outward. */
export function keyholeShape(a0: number, neckLength: number, neckHalf: number, headRadius: number, outward: number): Shape {
  const s = new Shape();
  const headCentre = a0 + outward * (neckLength + headRadius);
  const join = Math.sqrt(headRadius * headRadius - neckHalf * neckHalf);
  const neckEnd = headCentre - outward * join;
  s.moveTo(a0, -neckHalf);
  s.lineTo(neckEnd, -neckHalf);
  const start = Math.atan2(-neckHalf, neckEnd - headCentre);
  const end = Math.atan2(neckHalf, neckEnd - headCentre);
  s.absarc(headCentre, 0, headRadius, start, end + (outward > 0 ? 2 * Math.PI : 0), outward < 0);
  s.lineTo(a0, neckHalf);
  s.lineTo(a0, -neckHalf);
  return s;
}

/** Matrix mapping shape space (a outward, b right-lateral, up) onto a connector in piece space. */
export function connectorBasis(x: number, y: number, z: number, heading: number): Matrix4 {
  const a = new Vector3(Math.cos(heading), 0, Math.sin(heading));
  const right = new Vector3(Math.sin(heading), 0, -Math.cos(heading));
  const up = new Vector3(0, 1, 0);
  return new Matrix4().makeBasis(a, right, up).setPosition(x, y, z);
}

export function extrudeUp(shape: Shape, height: number, bevel: number): BufferGeometry {
  const g = new ExtrudeGeometry(shape, {
    depth: Math.max(0.1, height - 2 * bevel),
    bevelEnabled: bevel > 0,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 2,
    curveSegments: 24,
  });
  g.translate(0, 0, bevel);
  return nonIndexed(g);
}

export function onlyCsgAttributes(g: BufferGeometry): BufferGeometry {
  for (const name of Object.keys(g.attributes)) if (!["position", "normal", "uv"].includes(name)) g.deleteAttribute(name);
  g.clearGroups();
  return g;
}

/** Material slot indices in the returned geometry's groups. */
export const SLOT_BODY = 0;
export const SLOT_CUT = 1;
/** Painted parts of a piece (the bridge's viaduct). */
export const SLOT_PAINT = 2;
/** The stone viaduct's arches (painted stone, not the bridge's red). */
export const SLOT_STONE = 3;

/**
 * `archFloors` for a bridge drawn as a girder span: a one-level bridge over an underpass, open underneath for the
 * train in the dip (its arches would be in the way), on a pier at each end.
 */
export const GIRDER_FLOORS: readonly number[] = [-1];
export const isGirder = (floors: readonly number[] | null | undefined): boolean => floors?.length === 1 && floors[0] === -1;

export function riserGeometry(): BufferGeometry {
  const g = onlyCsgAttributes(nonIndexed(new RoundedBoxGeometry(TRACK_WIDTH + 6, RISER_HEIGHT, TRACK_WIDTH + 6, 3, 3)));
  g.translate(0, RISER_HEIGHT / 2, 0);
  // All body: meshes draw a body + cut material pair, and only faces in a group get drawn.
  g.addGroup(0, g.attributes.position.count, SLOT_BODY);
  return g;
}

/**
 * A carved piece with its corners shared: the carving leaves every triangle its own three corners (about twice the
 * corners it needs). Joining the identical ones keeps its look (and material groups) and halves its memory, on the
 * graphics card and in the saved cache.
 */
export function compactPiece(g: BufferGeometry): BufferGeometry {
  const merged = mergeVertices(g, 1e-4);
  g.dispose();
  return merged;
}

/** `levels`: for a bridge, how many riser heights its arches reach down below the deck. */
/**
 * A flat piece of several paths (a switch, a crossing, a kit's roads), plain: each path's body (and a double track's
 * web, between its lines) swept with `profile` on its own and merged, overlapping where they meet. Each after the
 * first is a hair lower (a tenth of a millimetre and more), so their tops don't fight where they overlap. (The carved
 * piece's body is their union, `flatBlockBody` in piece-carve.ts: it needs polygon-clipping, carved off the first
 * download.) For a stand-in, and for a shadow caster (where the overlap can't be seen).
 */
function overlappedBody(def: PieceDef, profile: ProfilePoint[]): BufferGeometry {
  const runs = def.paths.map((p) => framesAlong(p.geom, 0, p.to === null ? BUFFER_EXTRA : 0));
  if (def.web) runs.push(framesAlong(def.web, 0, 0));
  const parts = runs.map((frames, k) => sweep(k === 0 ? profile : profile.map((pt) => ({ ...pt, v: pt.v * (1 - 0.01 * k) })), frames));
  const g = mergeGeometries(parts) ?? parts[0];
  if (g !== parts[0]) for (const part of parts) part.dispose();
  return g;
}

/**
 * A piece's plain body, uncarved (no grooves, pegs or holes; a ramp or bridge without its supports): drawn for a moment
 * while the real one is carved in the background. A few milliseconds, where carving takes tens to hundreds.
 */
export function buildPieceStandIn(def: PieceDef): BufferGeometry {
  if (def.paths.length === 0) return riserGeometry();
  const g = def.paths.length === 1 ? sweep(bodyProfile(), framesAlong(def.paths[0].geom, 0, def.paths[0].to === null ? BUFFER_EXTRA : 0)) : overlappedBody(def, bodyProfile());
  g.clearGroups();
  g.addGroup(0, g.index ? g.index.count : g.attributes.position.count, SLOT_BODY);
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}

/**
 * What a piece casts its shadow with (drawn into the shadow map only, in its place: see TrackView): its body as a plain
 * block, no bevels, no grooves, no pegs, a few triangles a step. Its top is at the groove floor, so the grooves are lit
 * as before (a block up to the top would shade them); the shadow on the ground is the body's, 3 mm shorter.
 */
export function buildPieceShadowCaster(def: PieceDef): BufferGeometry {
  const h = TRACK_THICKNESS - GROOVE_DEPTH;
  let g: BufferGeometry;
  if (def.paths.length === 1) {
    const w = TRACK_WIDTH / 2;
    const block: ProfilePoint[] = [
      { u: -w, v: 0, smooth: false },
      { u: w, v: 0, smooth: false },
      { u: w, v: h, smooth: false },
      { u: -w, v: h, smooth: false },
    ];
    g = sweep(block, framesAlong(def.paths[0].geom, 0, def.paths[0].to === null ? BUFFER_EXTRA : 0));
  } else {
    g = overlappedBody(def, bodyProfile()).scale(1, h / TRACK_THICKNESS, 1);
  }
  g.clearGroups();
  g.deleteAttribute("uv");
  g.computeBoundingSphere();
  return g;
}

/**
 * Can this piece be drawn far out by its far version (`buildPieceFar`)? A plain piece of one path joined at both ends:
 * a straight, a curve, an S-curve. Not a ramp, bridge or underpass (their supports and slopes are carved), a buffer
 * (its block), a switch or crossing (several paths), a joiner (all peg).
 */
export function hasFarVersion(def: PieceDef): boolean {
  if (def.paths.length !== 1 || def.connectors.length !== 2 || def.supportHeight > 0 || canStandOnArches(def.type) || def.type === "underpass" || isTunnelMouth(def.type) || def.type === "joiner") return false;
  const p = def.paths[0];
  if (p.to === null) return false;
  const g = p.geom;
  return (g.kind === "line" || g.kind === "arc" || g.kind === "s") && g.rise === 0 && !(g.kind === "line" && g.dip);
}

/**
 * A piece's far version, for where it's drawn too small to see its finer carving (see `TrackView.setDetail`): the body
 * and its grooves swept as one outline (no carving), its bevels in fewer steps, its curve every 7.5° (not 3°), and no
 * holes at its ends (a joint's peg fills them: `buildPegGeometry`). About a tenth of the triangles: a large curve's
 * 3.1k are about 300. Its materials' groups, uvs and shading as the carved piece's. A millisecond or so to make.
 */
export function buildPieceFar(def: PieceDef): BufferGeometry {
  const w = TRACK_WIDTH / 2;
  const h = TRACK_THICKNESS;
  const floor = TRACK_THICKNESS - GROOVE_DEPTH;
  const pts: ProfilePoint[] = [];
  const edges: SweepEdge[] = [];
  /** Texture v so far: the body's perimeter (as the carved piece's body sweep), and the grooves' own. */
  let v = 0;
  let cutV = 0;
  const to = (u: number, pv: number, smooth: boolean, slot = SLOT_BODY) => {
    const last = pts[pts.length - 1];
    if (last) {
      const l = Math.hypot(u - last.u, pv - last.v);
      if (slot === SLOT_BODY) edges.push({ slot, va: v, vb: (v += l) });
      else edges.push({ slot, va: cutV, vb: (cutV += l) });
    }
    pts.push({ u, v: pv, smooth });
  };
  const arc = (cu: number, cv: number, r: number, a0: number, a1: number, n: number) => {
    for (let i = 0; i <= n; i++) {
      const a = a0 + ((a1 - a0) * i) / n;
      to(cu + r * Math.cos(a), cv + r * Math.sin(a), i > 0 && i < n);
    }
  };
  arc(-w + BOTTOM_RADIUS, BOTTOM_RADIUS, BOTTOM_RADIUS, Math.PI, 1.5 * Math.PI, 1);
  arc(w - BOTTOM_RADIUS, BOTTOM_RADIUS, BOTTOM_RADIUS, 1.5 * Math.PI, 2 * Math.PI, 1);
  arc(w - TOP_RADIUS, h - TOP_RADIUS, TOP_RADIUS, 0, 0.5 * Math.PI, 2);
  // Along the top, right to left, each groove's walls and floor (the carving's colour), then the top on past it.
  for (const c of [GROOVE_SPACING / 2, -GROOVE_SPACING / 2]) {
    const right = c + GROOVE_WIDTH / 2;
    const left = c - GROOVE_WIDTH / 2;
    to(right, h, false);
    const top = v;
    to(right, floor, false, SLOT_CUT);
    to(left, floor, false, SLOT_CUT);
    to(left, h, false, SLOT_CUT);
    // The top past the groove has its texture where the body's would be, as if the groove weren't there.
    v = top + (right - left);
  }
  arc(-w + TOP_RADIUS, h - TOP_RADIUS, TOP_RADIUS, 0.5 * Math.PI, Math.PI, 2);
  // The closing edge, back to the first point (the left side).
  edges.push({ slot: SLOT_BODY, va: v, vb: v + Math.hypot(pts[0].u - pts[pts.length - 1].u, pts[0].v - pts[pts.length - 1].v) });
  const g = sweep(pts, framesAlong(def.paths[0].geom, 0, 0, 0, true), edges);
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}

/** Scaffolding: posts this thick (mm), ledgers and braces a little thinner. */
const SCAFFOLD_POST = 5;
const SCAFFOLD_BAR = 3;

/**
 * Wooden scaffolding under a piece, from `bottom` up to `top` (piece-local y): a post each side at each end and the
 * middle, a ledger along each side at every level, and a cross brace in each bay. Drawn under a bridge lifted higher
 * than its arches are carved yet, in place of the arches still to come. Plain boxes, no carving.
 */
export function buildScaffold(def: PieceDef, bottom: number, top: number): BufferGeometry | null {
  if (def.paths.length !== 1 || top - bottom < 2) return null;
  const path = def.paths[0].geom;
  const len = pathLength(path);
  const side = TRACK_WIDTH / 2 - SCAFFOLD_POST;
  const stations = [SCAFFOLD_POST, len / 2, len - SCAFFOLD_POST].map((at) => {
    const p = samplePath(path, at, createSample());
    return { x: p.x, z: p.z, heading: p.heading };
  });
  const parts: BufferGeometry[] = [];
  const m = new Matrix4();
  /** A bar from a to b (piece-local points), this thick. */
  const bar = (a: Vector3, b: Vector3, thick: number) => {
    const d = new Vector3().subVectors(b, a);
    const length = d.length();
    if (length < 1) return;
    const g = new BoxGeometry(thick, length, thick);
    // Box's y along a→b, centred between them.
    const yAxis = d.clone().normalize();
    const xAxis = new Vector3(0, 0, 1).cross(yAxis);
    if (xAxis.lengthSq() < 1e-6) xAxis.set(1, 0, 0);
    xAxis.normalize();
    const zAxis = new Vector3().crossVectors(xAxis, yAxis);
    m.makeBasis(xAxis, yAxis, zAxis).setPosition(a.clone().add(b).multiplyScalar(0.5));
    g.applyMatrix4(m);
    parts.push(g);
  };
  const at = (st: (typeof stations)[number], across: number, y: number) =>
    new Vector3(st.x - Math.sin(st.heading) * across, y, st.z + Math.cos(st.heading) * across);
  const levels = Math.max(1, Math.round((top - bottom) / RISER_HEIGHT));
  const step = (top - bottom) / levels;
  for (const across of [-side, side]) {
    for (const st of stations) bar(at(st, across, bottom), at(st, across, top), SCAFFOLD_POST);
    for (let k = 0; k <= levels; k++) {
      const y = Math.min(top - SCAFFOLD_BAR / 2, bottom + k * step + (k === 0 ? SCAFFOLD_BAR / 2 : 0));
      for (let i = 1; i < stations.length; i++) bar(at(stations[i - 1], across, y), at(stations[i], across, y), SCAFFOLD_BAR);
    }
    for (let k = 0; k < levels; k++) {
      const y0 = bottom + k * step;
      for (let i = 1; i < stations.length; i++) bar(at(stations[(i + k) % 2 ? i - 1 : i], across, y0), at(stations[(i + k) % 2 ? i : i - 1], across, y0 + step), SCAFFOLD_BAR);
    }
  }
  const g = mergeGeometries(parts);
  for (const part of parts) part.dispose();
  return g;
}

/** The plug's top sits this far below the track surface: a faint seam where it fills its hole (and no flicker on a stand-in's uncarved body). */
const PLUG_DROP = 0.1;

/**
 * A peg as it stands on the end of a piece: a plug filling that end's hole, and the peg reaching out of it (into the
 * hole of the piece it joins, or out of a free end). In an end's frame: x outward from the end face, z across, y up
 * from the track base. Plain extrusions, no carving. Indexed, with position, normal and uv.
 */
export function buildPegGeometry(): BufferGeometry {
  // Only what can be seen: the plug's top (its walls stand against the hole's, its bottom on the piece's floor), its
  // face on the end of the piece, and the peg's top and walls out past it (its bottom sits on whatever's below). A
  // seat for every joint on the map, so kept to a few dozen triangles: coarse curves, no bevel.
  const plugShape = keyholeShape(0, PEG_NECK_LENGTH + SOCKET_CLEARANCE - 1, PEG_NECK_WIDTH / 2 + SOCKET_CLEARANCE, PEG_HEAD_RADIUS + SOCKET_CLEARANCE, -1);
  const pegShape = keyholeShape(0, PEG_NECK_LENGTH, PEG_NECK_WIDTH / 2, PEG_HEAD_RADIUS, 1);
  const top = (shape: Shape, height: number) => nonIndexed(new ShapeGeometry(shape, PEG_CURVE_SEGMENTS).translate(0, 0, height));
  const plugTop = top(plugShape, TRACK_THICKNESS - PLUG_DROP);
  const pegTop = top(pegShape, PEG_HEIGHT);
  // The peg's walls: an extrusion's sides only (its caps are the first group).
  const extruded = new ExtrudeGeometry(pegShape, { depth: PEG_HEIGHT, bevelEnabled: false, curveSegments: PEG_CURVE_SEGMENTS });
  const capCount = extruded.groups[0].count;
  const walls = nonIndexed(extruded);
  const wallPositions = walls.getAttribute("position").array.slice(capCount * 3);
  const wallUvs = walls.getAttribute("uv").array.slice(capCount * 2);
  const pegWalls = new BufferGeometry();
  pegWalls.setAttribute("position", new Float32BufferAttribute(wallPositions, 3));
  pegWalls.setAttribute("uv", new Float32BufferAttribute(wallUvs, 2));
  pegWalls.computeVertexNormals();
  // The plug's face on the end of the piece (across its neck, base to top), facing out.
  const half = PEG_NECK_WIDTH / 2 + SOCKET_CLEARANCE;
  const h = TRACK_THICKNESS - PLUG_DROP;
  const face = new BufferGeometry();
  face.setAttribute("position", new Float32BufferAttribute([0, -half, 0, 0, half, 0, 0, half, h, 0, -half, 0, 0, half, h, 0, -half, h], 3));
  face.setAttribute("uv", new Float32BufferAttribute([-half, 0, half, 0, half, h, -half, 0, half, h, -half, h], 2));
  face.computeVertexNormals();
  const toEnd = connectorBasis(0, 0, 0, 0);
  const parts = [plugTop, pegTop, pegWalls, face].map((g) => onlyCsgAttributes(g.applyMatrix4(toEnd)));
  for (const part of parts) if (!part.getAttribute("normal")) part.computeVertexNormals();
  const g = mergeVertices(mergeGeometries(parts), 1e-4);
  for (const part of [...parts, extruded, walls]) part.dispose();
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}

/** A peg's curves: round enough at the size it's seen. */
const PEG_CURVE_SEGMENTS = 8;

/** Where a peg stands on this end of a piece, in piece space (for `buildPegGeometry`). */
export function pegMatrix(c: ConnectorDef, out = new Matrix4()): Matrix4 {
  return out.makeRotationY(-c.pose.heading).setPosition(c.pose.x, c.y, c.pose.z);
}

/**
 * A lone piece as it comes, its own pegs on (a held piece, the tray's picture): `carved` (its holes at every end) with
 * a peg in each end that's a peg end. A joiner's pegs are its own already.
 */
export function withPegs(carved: BufferGeometry, def: PieceDef): BufferGeometry {
  const ends = def.type === "joiner" ? [] : def.connectors.filter((c) => c.kind === "peg");
  if (ends.length === 0) return carved;
  const source = buildPegGeometry();
  const peg = carved.index ? source : nonIndexed(source);
  const pegs = ends.map((c) => peg.clone().applyMatrix4(pegMatrix(c)));
  const attrs = Object.keys(carved.attributes);
  for (const p of pegs) for (const name of Object.keys(p.attributes)) if (!attrs.includes(name)) p.deleteAttribute(name);
  const shown = carved.clone();
  shown.clearGroups();
  const merged = mergeGeometries([shown, ...pegs]);
  shown.dispose();
  for (const p of pegs) p.dispose();
  source.dispose();
  if (!merged) return carved;
  merged.clearGroups();
  const count = (g: BufferGeometry) => (g.index ? g.index.count : g.attributes.position.count);
  const groups = carved.groups.length > 0 ? carved.groups.map((gr) => ({ ...gr })) : [{ start: 0, count: count(carved), materialIndex: SLOT_BODY }];
  // The pegs are plain wood: the last group's faces, if that's the body's, else a group of their own.
  const last = groups[groups.length - 1];
  const added = count(merged) - count(carved);
  if (last.materialIndex === SLOT_BODY && last.start + last.count === count(carved)) last.count += added;
  else groups.push({ start: count(carved), count: added, materialIndex: SLOT_BODY });
  for (const gr of groups) merged.addGroup(gr.start, gr.count, gr.materialIndex);
  merged.computeBoundingBox();
  merged.computeBoundingSphere();
  return merged;
}

/** Buffer stop block (separate so it can be painted), in piece-local space. */
export function buildBufferBlockGeometry(def: PieceDef): BufferGeometry | null {
  const p = def.paths.find((x) => x.to === null);
  if (!p) return null;
  const len = pathLength(p.geom);
  const g = new RoundedBoxGeometry(16, 26, TRACK_WIDTH, 3, 3);
  g.translate(len + BUFFER_EXTRA - 8, TRACK_THICKNESS + 13 - 1, 0);
  const bumpers: BufferGeometry[] = [];
  for (const side of [-9, 9]) {
    const b = new CylinderGeometry(5, 5, 6, 20);
    b.rotateZ(Math.PI / 2);
    b.translate(len + BUFFER_EXTRA - 16 - 3, TRACK_THICKNESS + 12, side);
    bumpers.push(b);
  }
  return mergeGeometries([g, ...bumpers].map(nonIndexed));
}

export { BoxGeometry };

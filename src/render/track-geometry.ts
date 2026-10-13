import {
  Path,
  BoxGeometry,
  BufferGeometry,
  CylinderGeometry,
  MeshBasicMaterial,
  type Material,
  ExtrudeGeometry,
  Float32BufferAttribute,
  Matrix4,
  Shape,
  ShapeUtils,
  Vector2,
  Vector3,
} from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import polygonClipping, { type Polygon } from "polygon-clipping";
import { ADDITION, Brush, Evaluator, SUBTRACTION } from "three-bvh-csg";
import {
  ARCH_CENTRES,
  ARCH_CROWN_DROP,
  ARCH_RADIUS,
  createSample,
  GROOVE_SPACING,
  GROOVE_WIDTH,
  pathLength,
  RISER_HEIGHT,
  samplePath,
  TRACK_THICKNESS,
  TRACK_WIDTH,
  type PathGeom,
  type PieceDef,
} from "../track";

// Render-only dimensions (mm).
export const GROOVE_DEPTH = 3;
export const PEG_HEIGHT = 11; // a seated peg shows 1 mm below the track surface inside the keyhole
const PEG_NECK_LENGTH = 8;
const PEG_NECK_WIDTH = 6;
const PEG_HEAD_RADIUS = 6;
const SOCKET_CLEARANCE = 0.6;
export const BUFFER_EXTRA = 38; // body continues past the buffer path end to carry the stop block
const TOP_RADIUS = 2.5;
const BOTTOM_RADIUS = 1;

interface ProfilePoint {
  u: number;
  v: number;
  /** Shade smoothly through this point (bevel arcs) rather than as a hard corner. */
  smooth: boolean;
}

/** Counter-clockwise (u right/left-lateral, v up) closed outline of the track body cross-section. */
function bodyProfile(): ProfilePoint[] {
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
function grooveProfile(centre: number): ProfilePoint[] {
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

interface Frame {
  x: number;
  y: number;
  z: number;
  heading: number;
  s: number;
}

/** Samples along a path, optionally extended straight past either end. */
function framesAlong(geom: PathGeom, extendStart: number, extendEnd: number, lineStep = 0): Frame[] {
  const len = pathLength(geom);
  const curved = geom.kind !== "line" || geom.rise !== 0;
  // Curves every 3 mm (a balloon loop's big gentle curves every 6).
  const steps = curved ? Math.max(8, Math.ceil(len / (geom.kind === "loop" ? 6 : 3))) : lineStep > 0 ? Math.ceil(len / lineStep) : 1;
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

/** Sweep a closed CCW profile along frames into a capped solid with normals and uvs (uv in mm). */
function sweep(profile: ProfilePoint[], frames: Frame[]): BufferGeometry {
  const pos: number[] = [];
  const nor: number[] = [];
  const uv: number[] = [];
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
      // quad corners: (f0,i) (f0,j) (f1,j) (f1,i)
      const corners: [Frame, number, Vector2, number][] = [
        [f0, i, na, perim[i]],
        [f0, j, nb, perim[i + 1]],
        [f1, j, nb, perim[i + 1]],
        [f1, i, na, perim[i]],
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
  g.setAttribute("position", new Float32BufferAttribute(pos, 3));
  g.setAttribute("normal", new Float32BufferAttribute(nor, 3));
  g.setAttribute("uv", new Float32BufferAttribute(uv, 2));
  fixWinding(g);
  return g;
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
function keyholeShape(a0: number, neckLength: number, neckHalf: number, headRadius: number, outward: number): Shape {
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
function connectorBasis(x: number, y: number, z: number, heading: number): Matrix4 {
  const a = new Vector3(Math.cos(heading), 0, Math.sin(heading));
  const right = new Vector3(Math.sin(heading), 0, -Math.cos(heading));
  const up = new Vector3(0, 1, 0);
  return new Matrix4().makeBasis(a, right, up).setPosition(x, y, z);
}

function extrudeUp(shape: Shape, height: number, bevel: number): BufferGeometry {
  const g = new ExtrudeGeometry(shape, {
    depth: Math.max(0.1, height - 2 * bevel),
    bevelEnabled: bevel > 0,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 2,
    curveSegments: 24,
  });
  g.translate(0, 0, bevel);
  return g.toNonIndexed();
}

function brush(g: BufferGeometry, material: Material = BODY): Brush {
  const b = new Brush(g.index ? g.toNonIndexed() : g, material);
  b.updateMatrixWorld();
  return b;
}

function onlyCsgAttributes(g: BufferGeometry): BufferGeometry {
  for (const name of Object.keys(g.attributes)) if (!["position", "normal", "uv"].includes(name)) g.deleteAttribute(name);
  g.clearGroups();
  return g;
}

/** Marker materials: faces from body brushes vs faces carved by cutters (grooves, keyholes). */
const BODY = new MeshBasicMaterial();
const CUT = new MeshBasicMaterial();
const PAINT = new MeshBasicMaterial();
/** Material slot indices in the returned geometry's groups. */
export const SLOT_BODY = 0;
export const SLOT_CUT = 1;
/** Painted parts of a piece (the bridge's viaduct). */
export const SLOT_PAINT = 2;

const evaluator = new Evaluator();
evaluator.useGroups = true;
evaluator.attributes = ["position", "normal", "uv"];

/**
 * Bridge: a painted viaduct `height` tall under the deck (which is at y = 0), straight or curved, two round arches on
 * three piers.
 */
function bridgeSupport(def: PieceDef, height: number): BufferGeometry {
  const path = def.paths[0].geom;
  const len = pathLength(path);
  // The viaduct body: a softly rounded block swept along the deck, from just below the ground to just under the track.
  const inset = 3;
  const frames: Frame[] = [];
  const steps = path.kind !== "line" ? Math.max(8, Math.ceil(len / 4)) : 1;
  const p = createSample();
  for (let i = 0; i <= steps; i++) {
    const at = inset + ((len - 2 * inset) * i) / steps;
    samplePath(path, at, p);
    frames.push({ x: p.x, y: p.y, z: p.z, heading: p.heading, s: at });
  }
  // On a slope (a bridge ramp) the body hangs deeper at the high end, then is cut level at the ground.
  const rise = path.kind === "line" ? path.rise : 0;
  let result = brush(sweep(viaductProfile(height + rise), frames), PAINT);
  const ground = -height;
  if (rise > 0) {
    const below = onlyCsgAttributes(new BoxGeometry(len * 2, rise * 2, TRACK_WIDTH * 2).toNonIndexed());
    below.translate(len / 2, ground - 1 - rise, 0);
    result = evaluator.evaluate(result, brush(below), SUBTRACTION);
  }
  // Arch tops a spandrel below the deck; the openings reach the ground. A low viaduct's arches are smaller, so each
  // still springs a little above the ground (a full-size one would be cut off by it).
  for (const at of ARCH_CENTRES) {
    samplePath(path, len * at, p);
    const archTop = p.y - ARCH_CROWN_DROP;
    const radius = Math.min(len * ARCH_RADIUS, archTop - ground - 4);
    const arch = onlyCsgAttributes(new CylinderGeometry(radius, radius, TRACK_WIDTH + 10, 40).toNonIndexed());
    arch.rotateX(Math.PI / 2);
    arch.translate(0, archTop - radius, 0);
    const opening = onlyCsgAttributes(new BoxGeometry(radius * 2, archTop - radius - ground + 2, TRACK_WIDTH + 10).toNonIndexed());
    opening.translate(0, (archTop - radius + ground) / 2 - 1, 0);
    for (const g of [arch, opening]) {
      g.rotateY(-p.heading);
      g.translate(p.x, 0, p.z);
      result = evaluator.evaluate(result, brush(g), SUBTRACTION);
    }
  }
  return result.geometry;
}

/** Cross-section of a bridge's viaduct (u across, v up from the deck), corners rounded. */
function viaductProfile(height: number): ProfilePoint[] {
  const w = TRACK_WIDTH / 2 - 2;
  const r = 2;
  const top = 1;
  const bottom = -height - 1;
  const pts: ProfilePoint[] = [];
  const arc = (cu: number, cv: number, a0: number, a1: number) => {
    const n = 3;
    for (let i = 0; i <= n; i++) {
      const a = a0 + ((a1 - a0) * i) / n;
      pts.push({ u: cu + r * Math.cos(a), v: cv + r * Math.sin(a), smooth: i > 0 && i < n });
    }
  };
  arc(-w + r, bottom + r, Math.PI, 1.5 * Math.PI);
  arc(w - r, bottom + r, 1.5 * Math.PI, 2 * Math.PI);
  arc(w - r, top - r, 0, 0.5 * Math.PI);
  arc(-w + r, top - r, 0.5 * Math.PI, Math.PI);
  return pts;
}

function riserGeometry(): BufferGeometry {
  const g = onlyCsgAttributes(new RoundedBoxGeometry(TRACK_WIDTH + 6, RISER_HEIGHT, TRACK_WIDTH + 6, 3, 3).toNonIndexed());
  g.translate(0, RISER_HEIGHT / 2, 0);
  // All body: meshes draw a body + cut material pair, and only faces in a group get drawn.
  g.addGroup(0, g.attributes.position.count, SLOT_BODY);
  return g;
}

/**
 * Body for flat multi-path pieces (switch, crossing): the 2D union of each path's ribbon, extruded with bevelled edges.
 * (Unioning overlapping swept solids with CSG is pathologically slow on their coplanar faces.)
 */
function flatBlockBody(def: PieceDef): BufferGeometry {
  const runs = def.paths.map((p) => framesAlong(p.geom, 0, 0));
  // Double track: one board, filled in between its two lines.
  if (def.web) runs.push(framesAlong(def.web, 0, 0));
  return flatBody(runs);
}

/** A flat body under several stretches of track (each a run of frames), merged where they overlap. */
function flatBody(runs: Frame[][]): BufferGeometry {
  const half = TRACK_WIDTH / 2;
  const ribbons: Polygon[] = runs.map((frames) => {
    const left = frames.map((f) => [f.x - Math.sin(f.heading) * half, f.z + Math.cos(f.heading) * half] as [number, number]);
    const right = frames.map((f) => [f.x + Math.sin(f.heading) * half, f.z - Math.cos(f.heading) * half] as [number, number]);
    return [[...left, ...right.reverse(), left[0]]];
  });
  const [first, ...rest] = ribbons;
  const union = polygonClipping.union(first, ...rest);
  const [ring, ...holes] = union[0];
  const shape = new Shape(ring.slice(0, -1).map(([x, z]) => new Vector2(x, -z)));
  // A loop's track encloses the felt inside it: keep that open.
  for (const h of holes) shape.holes.push(new Path(h.slice(0, -1).map(([x, z]) => new Vector2(x, -z))));
  const bevel = 2;
  const g = new ExtrudeGeometry(shape, {
    depth: TRACK_THICKNESS - 2 * bevel,
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelOffset: -bevel,
    bevelSegments: 3,
  });
  g.translate(0, 0, bevel);
  g.applyMatrix4(new Matrix4().makeBasis(new Vector3(1, 0, 0), new Vector3(0, 0, -1), new Vector3(0, 1, 0)));
  return onlyCsgAttributes(g.toNonIndexed());
}

/** Re-index CSG output groups so materialIndex is SLOT_BODY, SLOT_CUT or SLOT_PAINT. */
function slotGroups(result: Brush): BufferGeometry {
  const g = result.geometry;
  const mats = (Array.isArray(result.material) ? result.material : [result.material]) as Material[];
  for (const group of g.groups) {
    const m = mats[group.materialIndex ?? 0];
    group.materialIndex = m === CUT ? SLOT_CUT : m === PAINT ? SLOT_PAINT : SLOT_BODY;
  }
  return g;
}

/** Geometry for a piece type in piece-local space (plan x/z → world x/z, y up, track base at y = 0). */
/** `levels`: for a bridge, how many riser heights its arches reach down below the deck. */
export function buildPieceGeometry(def: PieceDef, levels = 0): BufferGeometry {
  if (def.paths.length === 0) return riserGeometry();
  if (def.type === "joiner") return joinerGeometry(def);
  if (def.paths.length === 1 && def.paths[0].geom.kind === "loop") return loopGeometry(def);

  let result =
    def.paths.length === 1
      ? brush(sweep(bodyProfile(), framesAlong(def.paths[0].geom, 0, def.paths[0].to === null ? BUFFER_EXTRA : 0)))
      : brush(flatBlockBody(def));

  if (levels > 0 && def.paths.length === 1) {
    // Keep the viaduct's own (painted) group through the union.
    const support = new Brush(bridgeSupport(def, levels * RISER_HEIGHT), [PAINT, PAINT, PAINT]);
    support.updateMatrixWorld();
    result = evaluator.evaluate(result, support, ADDITION);
  }

  // On a piece with several paths, straight grooves are cut in short steps like curved ones: one long sliver cut
  // across a curve's fine faces shatters the mesh (slow, and tens of thousands of triangles on a switch).
  const step = def.paths.length > 1 ? 6 : 0;
  for (const p of def.paths) {
    for (const c of [-GROOVE_SPACING / 2, GROOVE_SPACING / 2]) {
      const extra = p.to === null ? BUFFER_EXTRA - 20 : 2;
      result = evaluator.evaluate(result, brush(sweep(grooveProfile(c), framesAlong(p.geom, 2, extra, step)), CUT), SUBTRACTION);
    }
  }

  for (const c of def.connectors) {
    if (c.kind === "socket") {
      const shape = keyholeShape(
        1,
        PEG_NECK_LENGTH + SOCKET_CLEARANCE,
        PEG_NECK_WIDTH / 2 + SOCKET_CLEARANCE,
        PEG_HEAD_RADIUS + SOCKET_CLEARANCE,
        -1,
      );
      const g = extrudeUp(shape, TRACK_THICKNESS + 4, 0);
      g.applyMatrix4(connectorBasis(c.pose.x, c.y - 2, c.pose.z, c.pose.heading));
      result = evaluator.evaluate(result, brush(onlyCsgAttributes(g), CUT), SUBTRACTION);
    }
  }
  for (const c of def.connectors) {
    if (c.kind === "peg") {
      const shape = keyholeShape(-2, PEG_NECK_LENGTH + 2, PEG_NECK_WIDTH / 2, PEG_HEAD_RADIUS, 1);
      const g = extrudeUp(shape, PEG_HEIGHT, 0.6);
      g.applyMatrix4(connectorBasis(c.pose.x, c.y, c.pose.z, c.pose.heading));
      result = evaluator.evaluate(result, brush(onlyCsgAttributes(g)), ADDITION);
    }
  }

  const out = slotGroups(result);
  out.computeBoundingBox();
  out.computeBoundingSphere();
  return out;
}

/**
 * A balloon loop: its track leaves and comes back through the same end, overlapping itself there, so it's built as
 * two halves (out and back), merged like a switch's routes.
 */
function loopGeometry(def: PieceDef): BufferGeometry {
  const geom = def.paths[0].geom;
  const frames = framesAlong(geom, 0, 0);
  const mid = Math.floor(frames.length / 2);
  const halves = [frames.slice(0, mid + 1), frames.slice(mid)];
  let result = brush(flatBody(halves));
  const grooveFrames = framesAlong(geom, 2, 2);
  const gm = Math.floor(grooveFrames.length / 2);
  for (const run of [grooveFrames.slice(0, gm + 2), grooveFrames.slice(gm - 1)]) {
    for (const c of [-GROOVE_SPACING / 2, GROOVE_SPACING / 2]) result = evaluator.evaluate(result, brush(sweep(grooveProfile(c), run), CUT), SUBTRACTION);
  }
  for (const c of def.connectors) {
    const shape = keyholeShape(1, PEG_NECK_LENGTH + SOCKET_CLEARANCE, PEG_NECK_WIDTH / 2 + SOCKET_CLEARANCE, PEG_HEAD_RADIUS + SOCKET_CLEARANCE, -1);
    const g = extrudeUp(shape, TRACK_THICKNESS + 4, 0);
    g.applyMatrix4(connectorBasis(c.pose.x, c.y - 2, c.pose.z, c.pose.heading));
    result = evaluator.evaluate(result, brush(onlyCsgAttributes(g), CUT), SUBTRACTION);
  }
  const out = slotGroups(result);
  out.computeBoundingBox();
  out.computeBoundingSphere();
  return out;
}

/** A dog-bone joiner: just its two pegs, back to back (each reaching into a track end's hole). */
function joinerGeometry(def: PieceDef): BufferGeometry {
  const pegs = def.connectors.map((c) => {
    const g = extrudeUp(keyholeShape(-2, PEG_NECK_LENGTH + 2, PEG_NECK_WIDTH / 2, PEG_HEAD_RADIUS, 1), PEG_HEIGHT, 0.6);
    g.applyMatrix4(connectorBasis(c.pose.x, c.y, c.pose.z, c.pose.heading));
    return onlyCsgAttributes(g);
  });
  const out = slotGroups(evaluator.evaluate(brush(pegs[0]), brush(pegs[1]), ADDITION));
  out.computeBoundingBox();
  out.computeBoundingSphere();
  return out;
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
  return mergeGeometries([g.toNonIndexed(), ...bumpers.map((b) => b.toNonIndexed())]);
}

export { BoxGeometry };

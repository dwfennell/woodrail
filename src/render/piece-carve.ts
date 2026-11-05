import { BoxGeometry, CylinderGeometry, ExtrudeGeometry, Matrix4, MeshBasicMaterial, Path, Shape, Vector2, Vector3, type BufferGeometry, type Material } from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import polygonClipping, { type Polygon } from "polygon-clipping";
import { ADDITION, type Brush, Evaluator, SUBTRACTION } from "three-bvh-csg";
import { CsgBrush, csgEvaluate } from "./csg-brush";
import {
  ARCH_CENTRES,
  ARCH_CROWN_DROP,
  ARCH_RADIUS,
  createSample,
  GIRDER_PIER,
  GROOVE_SPACING,
  isRamp,
  isRack,
  isTunnelMouth,
  pathLength,
  RISER_HEIGHT,
  samplePath,
  TRACK_THICKNESS,
  TRACK_WIDTH,
  TRENCH_HALF,
  TRENCH_INSET,
  TRENCH_WALL,
  type ConnectorDef,
  type PieceDef,
} from "../track";
import { nonIndexed } from "./non-indexed";
import {
  ARC_STEP,
  bodyProfile,
  BUFFER_EXTRA,
  connectorBasis,
  extrudeUp,
  framesAlong,
  grooveProfile,
  isGirder,
  keyholeShape,
  onlyCsgAttributes,
  PEG_HEAD_RADIUS,
  PEG_HEIGHT,
  PEG_NECK_LENGTH,
  PEG_NECK_WIDTH,
  riserGeometry,
  SLOT_BODY,
  SLOT_CUT,
  SLOT_PAINT,
  SOCKET_CLEARANCE,
  sweep,
  type Frame,
  type ProfilePoint,
} from "./track-geometry";

// Carving track pieces (CSG: three-bvh-csg, three-mesh-bvh, polygon-clipping): what the piece workers run
// (`piece-worker.ts`), and the main thread only now and then (a join piece, or where no worker can run). Not in the
// first download: `TrackView` loads it (`carver.ts`). Track's other shapes (stand-ins, shadow casters, pegs, far
// versions) are in track-geometry.ts.

function brush(g: BufferGeometry, material: Material = BODY): Brush {
  const b = new CsgBrush(nonIndexed(g), material);
  b.updateMatrixWorld();
  return b;
}

/** Marker materials: faces from body brushes vs faces carved by cutters (grooves, keyholes). */
const BODY = new MeshBasicMaterial();
const CUT = new MeshBasicMaterial();
const PAINT = new MeshBasicMaterial();
const evaluator = new Evaluator();
evaluator.useGroups = true;
evaluator.attributes = ["position", "normal", "uv"];

/**
 * Bridge: a painted viaduct `height` tall under the deck (which is at y = 0), straight or curved, two round arches on
 * three piers.
 */
/** `floors`: how far down (riser heights) each arch's opening reaches, in `ARCH_CENTRES` order; all of `height` without. */
function bridgeSupport(def: PieceDef, height: number, floors?: readonly number[] | null): BufferGeometry {
  const path = def.paths[0].geom;
  const len = pathLength(path);
  if (isGirder(floors)) return girderSupport(def, height);
  // The viaduct body: a softly rounded block swept along the deck, from just below the ground to just under the track.
  const inset = 3;
  const frames: Frame[] = [];
  const steps = path.kind === "arc" ? Math.max(8, Math.ceil(Math.abs(path.sweep) / ARC_STEP)) : path.kind !== "line" ? Math.max(8, Math.ceil(len / 4)) : 1;
  const p = createSample();
  for (let i = 0; i <= steps; i++) {
    const at = inset + ((len - 2 * inset) * i) / steps;
    samplePath(path, at, p);
    frames.push({ x: p.x, y: p.y, z: p.z, heading: p.heading, s: at });
  }
  // On a slope (a ramp, straight or curved) the body hangs deeper at the high end, then is cut level at the ground.
  const rise = path.kind === "line" || path.kind === "arc" ? path.rise : 0;
  let result = brush(sweep(viaductProfile(height + rise), frames), PAINT);
  const ground = -height;
  if (rise > 0) {
    // (Wide enough for a curve's sweep too: all of it within its length of the start.)
    const below = onlyCsgAttributes(nonIndexed(new BoxGeometry(len * 4, rise * 2, len * 4)));
    below.translate(0, ground - 1 - rise, 0);
    result = csgEvaluate(evaluator, result, brush(below), SUBTRACTION);
  }
  // Arch tops a spandrel below the deck; the openings reach the ground. A low viaduct's arches are smaller, so each
  // still springs a little above the ground (a full-size one would be cut off by it).
  ARCH_CENTRES.forEach((at, i) => {
    // Over a hill, an arch springs from the hilltop: its opening stops there (the viaduct's foot goes on down, hidden).
    const floor = floors ? -floors[i] * RISER_HEIGHT : -height;
    samplePath(path, len * at, p);
    const archTop = p.y - ARCH_CROWN_DROP;
    // The arch's circle reaches below its centre: stopping on a hilltop, it's small enough to stand clear of it.
    const radius = Math.min(len * ARCH_RADIUS, archTop - floor - 4, floor > -height ? (archTop - floor) / 2 : Infinity);
    // No room for an arch here (a ramp's low end, close to the ground): solid.
    if (radius < 6) return;
    const arch = onlyCsgAttributes(nonIndexed(new CylinderGeometry(radius, radius, TRACK_WIDTH + 10, 40)));
    arch.rotateX(Math.PI / 2);
    arch.translate(0, archTop - radius, 0);
    const opening = onlyCsgAttributes(nonIndexed(new BoxGeometry(radius * 2, archTop - radius - floor + 2, TRACK_WIDTH + 10)));
    opening.translate(0, (archTop - radius + floor) / 2 - 1, 0);
    for (const g of [arch, opening]) {
      g.rotateY(-p.heading);
      g.translate(p.x, 0, p.z);
      result = csgEvaluate(evaluator, result, brush(g), SUBTRACTION);
    }
  });
  return result.geometry;
}

/** Pier length at each end of a girder span, and its side plates' thickness (mm). */
const PIER = GIRDER_PIER;
const GIRDER_PLATE = 4;
/** How far the side plates stand above the deck's top. */
const GIRDER_RISE = 5;

/** A girder span: a slim beam under the deck, a solid pier at each end down to the ground. */
function girderSupport(def: PieceDef, height: number): BufferGeometry {
  const path = def.paths[0].geom;
  const len = pathLength(path);
  const frames = framesAlong(path, 0, 0).map((f) => ({ ...f }));
  // Nothing below the deck (that's the headroom): a plate along each side, from the deck's underside up past its top.
  const plate = (u0: number, u1: number): ProfilePoint[] => [
    { u: u0, v: 0, smooth: false },
    { u: u1, v: 0, smooth: false },
    { u: u1, v: TRACK_THICKNESS + GIRDER_RISE, smooth: false },
    { u: u0, v: TRACK_THICKNESS + GIRDER_RISE, smooth: false },
  ];
  const w = TRACK_WIDTH / 2;
  let result = brush(sweep(plate(w - 0.5, w + GIRDER_PLATE), frames), PAINT);
  result = csgEvaluate(evaluator, result, brush(sweep(plate(-w - GIRDER_PLATE, -w + 0.5), frames), PAINT), ADDITION);
  const p = createSample();
  for (const at of [PIER / 2 + 2, len - PIER / 2 - 2]) {
    samplePath(path, at, p);
    const pier = onlyCsgAttributes(nonIndexed(new RoundedBoxGeometry(PIER, height + 1, TRACK_WIDTH - 2, 2, 2)));
    pier.translate(0, p.y - (height + 1) / 2, 0);
    pier.rotateY(-p.heading);
    pier.translate(p.x, 0, p.z);
    result = csgEvaluate(evaluator, result, brush(pier, PAINT), ADDITION);
  }
  return result.geometry;
}

/**
 * An underpass's trench: a wooden block sunk into the board round the dip, its top a rim just proud of the felt (the
 * felt has a hole there: `underpassHoles`), with a channel cut down to the track's bed as it dips. Piece-local.
 * `plinth`: how far down its block reaches off a hill's edge (mm below its ends), standing on the ground there.
 */
function trenchBrush(def: PieceDef, plinth = 0): Brush {
  const geom = def.paths[0].geom;
  const len = pathLength(geom);
  // Off a hill's edge, the block reaches on down to the ground below (`plinthLevels`): on the hill, it's hidden in it.
  const depth = Math.max((geom.kind === "line" ? (geom.dip ?? 0) : 0) + 4, plinth);
  const top = 0.6;
  const outer = TRENCH_HALF + TRENCH_WALL;
  const box = onlyCsgAttributes(nonIndexed(new RoundedBoxGeometry(len - 2 * TRENCH_INSET, depth + top, 2 * outer, 2, 1.5)));
  box.translate(len / 2, top - (depth + top) / 2, 0);
  const channel: ProfilePoint[] = [
    { u: -TRENCH_HALF, v: 0, smooth: false },
    { u: TRENCH_HALF, v: 0, smooth: false },
    { u: TRENCH_HALF, v: 40, smooth: false },
    { u: -TRENCH_HALF, v: 40, smooth: false },
  ];
  return csgEvaluate(evaluator, brush(box), brush(sweep(channel, framesAlong(geom, 4, 4)), CUT), SUBTRACTION);
}

/**
 * A tunnel mouth's cutting: a wooden block sunk into the board under the slope (the felt has a hole there), its rim just
 * proud of the felt, with a channel open to the sky down to the track's bed, through its low end (where the portal
 * stands: see `TunnelsView`). Piece-local; the high end is wherever the path's y is highest.
 */
function mouthBrush(def: PieceDef): Brush {
  const geom = def.paths[0].geom;
  const len = pathLength(geom);
  const ys = [0, len].map((s) => samplePath(geom, s, createSample()).y);
  const high = Math.max(...ys);
  const low = Math.min(...ys);
  const lowAtEnd = ys[1] < ys[0];
  const depth = high - low + 6;
  const top = 0.6;
  const outer = TRENCH_HALF + TRENCH_WALL;
  const blockLen = len - TRENCH_INSET;
  const box = onlyCsgAttributes(nonIndexed(new RoundedBoxGeometry(blockLen, depth + top, 2 * outer, 2, 1.5)));
  box.translate(lowAtEnd ? TRENCH_INSET + blockLen / 2 : blockLen / 2, high + top - (depth + top) / 2, 0);
  const channel: ProfilePoint[] = [
    { u: -TRENCH_HALF, v: 0, smooth: false },
    { u: TRENCH_HALF, v: 0, smooth: false },
    { u: TRENCH_HALF, v: 160, smooth: false },
    { u: -TRENCH_HALF, v: 160, smooth: false },
  ];
  return csgEvaluate(evaluator, brush(box), brush(sweep(channel, framesAlong(geom, 4, 4)), CUT), SUBTRACTION);
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

/**
 * Body for flat multi-path pieces (switch, crossing): the 2D union of each path's ribbon, extruded with bevelled edges.
 * (Unioning overlapping swept solids with CSG is pathologically slow on their coplanar faces.)
 */
function flatBlockBody(def: PieceDef): BufferGeometry {
  // A road ending at a buffer runs on past its end to carry the stop (a kit's terminus or shed: its model draws it).
  const runs = def.paths.map((p) => framesAlong(p.geom, 0, p.to === null ? BUFFER_EXTRA : 0));
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
  // One board, or several apart (a kit's roads side by side: a shed's, a terminus's).
  const shapes = union.map(([ring, ...holes]) => {
    const shape = new Shape(ring.slice(0, -1).map(([x, z]) => new Vector2(x, -z)));
    // A loop's track encloses the felt inside it: keep that open.
    for (const h of holes) shape.holes.push(new Path(h.slice(0, -1).map(([x, z]) => new Vector2(x, -z))));
    return shape;
  });
  const bevel = 2;
  const g = new ExtrudeGeometry(shapes, {
    depth: TRACK_THICKNESS - 2 * bevel,
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelOffset: -bevel,
    bevelSegments: 3,
  });
  g.translate(0, 0, bevel);
  g.applyMatrix4(new Matrix4().makeBasis(new Vector3(1, 0, 0), new Vector3(0, 0, -1), new Vector3(0, 1, 0)));
  return onlyCsgAttributes(nonIndexed(g));
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
export function buildPieceGeometry(def: PieceDef, levels = 0, floors: readonly number[] | null = null): BufferGeometry {
  if (def.paths.length === 0) return riserGeometry();
  if (def.type === "joiner") return joinerGeometry(def);
  if (def.paths.length === 1 && def.paths[0].geom.kind === "loop") return loopGeometry(def);

  let result =
    def.paths.length === 1
      ? brush(sweep(bodyProfile(), framesAlong(def.paths[0].geom, 0, def.paths[0].to === null ? BUFFER_EXTRA : 0)))
      : brush(flatBlockBody(def));

  // A ramp brings its own support: a sloping viaduct from the ground up under its high end (so it stands, and turns,
  // without a riser). Up off the ground, it stands on arches as a bridge does.
  const ownSupport = isRamp(def.type) && def.paths.length === 1;
  if ((levels > 0 || ownSupport) && def.paths.length === 1 && def.type !== "underpass") {
    // Keep the viaduct's own (painted) group through the union.
    const support = new CsgBrush(bridgeSupport(def, levels * RISER_HEIGHT, floors), [PAINT, PAINT, PAINT]);
    support.updateMatrixWorld();
    result = csgEvaluate(evaluator, result, support, ADDITION);
  }

  // (`levels` for an underpass: its block's plinth down off a hill's edge.)
  if (def.type === "underpass") result = csgEvaluate(evaluator, result, trenchBrush(def, levels * RISER_HEIGHT), ADDITION);
  if (isRack(def.type)) result = csgEvaluate(evaluator, result, brush(rackStrip(def), CUT), ADDITION);
  if (isTunnelMouth(def.type)) result = csgEvaluate(evaluator, result, mouthBrush(def), ADDITION);

  // On a piece with several paths, straight grooves are cut in short steps like curved ones: one long sliver cut
  // across a curve's fine faces shatters the mesh (slow, and tens of thousands of triangles on a switch).
  const step = def.paths.length > 1 ? 6 : 0;
  for (const p of def.paths) {
    for (const c of [-GROOVE_SPACING / 2, GROOVE_SPACING / 2]) {
      const extra = p.to === null ? BUFFER_EXTRA - 20 : 2;
      result = csgEvaluate(evaluator, result, brush(sweep(grooveProfile(c), framesAlong(p.geom, 2, extra, step)), CUT), SUBTRACTION);
    }
  }

  // Every end is carved as a hole: any two ends join, so which end of a joint shows the peg is the layout's to say.
  // TrackView draws the pegs (`buildPegGeometry`), and `withPegs` adds a lone piece's own.
  for (const c of def.connectors) result = csgEvaluate(evaluator, result, brush(socketCutter(c), CUT), SUBTRACTION);

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
    for (const c of [-GROOVE_SPACING / 2, GROOVE_SPACING / 2]) result = csgEvaluate(evaluator, result, brush(sweep(grooveProfile(c), run), CUT), SUBTRACTION);
  }
  for (const c of def.connectors) result = csgEvaluate(evaluator, result, brush(socketCutter(c), CUT), SUBTRACTION);
  const out = slotGroups(result);
  out.computeBoundingBox();
  out.computeBoundingSphere();
  return out;
}

/** A rack's strip: this wide, standing this far proud of the track's top, its teeth this far apart (mm). */
const RACK_HALF = 3.5;
const RACK_PROUD = 1.2;
const RACK_PITCH = 6;

/**
 * A rack's toothed strip down the middle of its track (between the grooves): a bar sunk a little into the top, with a
 * row of teeth on it, following the slope. In the carved wood's darker shade (the grooves' slot).
 */
function rackStrip(def: PieceDef): BufferGeometry {
  const geom = def.paths[0].geom;
  const len = pathLength(geom);
  const h = TRACK_THICKNESS;
  const bar: ProfilePoint[] = [
    { u: -RACK_HALF, v: h - 0.6, smooth: false },
    { u: RACK_HALF, v: h - 0.6, smooth: false },
    { u: RACK_HALF, v: h + RACK_PROUD, smooth: false },
    { u: -RACK_HALF, v: h + RACK_PROUD, smooth: false },
  ];
  // (In from each end, so its pegs and holes stay clear.)
  const inset = 14;
  const frames = framesAlong(geom, 0, 0).filter((f) => f.s >= inset && f.s <= len - inset);
  const parts: BufferGeometry[] = [nonIndexed(sweep(bar, frames))];
  const p = createSample();
  const q = createSample();
  const m = new Matrix4();
  for (let s = inset + RACK_PITCH / 2; s <= len - inset - RACK_PITCH / 2; s += RACK_PITCH) {
    samplePath(geom, s, p);
    samplePath(geom, Math.min(len, s + 1), q);
    const pitch = Math.atan2(q.y - p.y, Math.hypot(q.x - p.x, q.z - p.z));
    const tooth = new BoxGeometry(2.4, 1.6, RACK_HALF * 2 - 0.6);
    // Box along x (the path), up y, across z; turned to the path's heading and slope, on the bar's top.
    m.makeRotationZ(pitch);
    tooth.applyMatrix4(m);
    m.makeRotationY(-p.heading);
    tooth.applyMatrix4(m);
    tooth.translate(p.x, p.y + h + RACK_PROUD + 0.6, p.z);
    parts.push(nonIndexed(tooth));
  }
  for (const g of parts) onlyCsgAttributes(g);
  const out = mergeGeometries(parts);
  for (const g of parts) g.dispose();
  return out;
}

/** The cutter for an end's hole (a keyhole through the piece, open at the end face). */
function socketCutter(c: ConnectorDef): BufferGeometry {
  const shape = keyholeShape(1, PEG_NECK_LENGTH + SOCKET_CLEARANCE, PEG_NECK_WIDTH / 2 + SOCKET_CLEARANCE, PEG_HEAD_RADIUS + SOCKET_CLEARANCE, -1);
  const g = extrudeUp(shape, TRACK_THICKNESS + 4, 0);
  g.applyMatrix4(connectorBasis(c.pose.x, c.y - 2, c.pose.z, c.pose.heading));
  return onlyCsgAttributes(g);
}

/** A dog-bone joiner: just its two pegs, back to back (each reaching into a track end's hole). */
function joinerGeometry(def: PieceDef): BufferGeometry {
  const pegs = def.connectors.map((c) => {
    const g = extrudeUp(keyholeShape(-2, PEG_NECK_LENGTH + 2, PEG_NECK_WIDTH / 2, PEG_HEAD_RADIUS, 1), PEG_HEIGHT, 0.6);
    g.applyMatrix4(connectorBasis(c.pose.x, c.y, c.pose.z, c.pose.heading));
    return onlyCsgAttributes(g);
  });
  const out = slotGroups(csgEvaluate(evaluator, brush(pegs[0]), brush(pegs[1]), ADDITION));
  out.computeBoundingBox();
  out.computeBoundingSphere();
  return out;
}


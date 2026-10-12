import {
  BufferAttribute,
  Color,
  CylinderGeometry,
  Group,
  InstancedMesh,
  LatheGeometry,
  Matrix4,
  Quaternion,
  SphereGeometry,
  Vector2,
  Vector3,
  type BufferGeometry,
  type Material,
} from "three";
import { mergeGeometries, mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { rng } from "../../lib/rng";
import { COLS, FEAT_TREE, ROWS, type Landscape } from "../../landscape";
import type { Materials } from "../materials";

export const MAX_LEAN = 0.05;
const JITTER = 14;
export const TREE_GREENS = ["#3f8f4a", "#2f7a43", "#5ba356", "#6fae4f", "#4c9a3c"];

/** The turned trees, and the small countryside props (bushes, boulders) that stand and step aside like them. */
export const TREE_KINDS = ["fir", "ball", "discs", "birch", "apple", "autumn", "willow", "bush", "rock"] as const;
export type TreeKind = (typeof TREE_KINDS)[number];

export interface TreePlacement {
  x: number;
  z: number;
  /** Ground height under the tree. */
  y: number;
  kind: TreeKind;
  scale: number;
  lean: number;
  leanDir: number;
  yaw: number;
  tint: number;
}

/** Where each toy tree stands, with a little random size, lean and colour. Deterministic per map. */
export function treePlacements(land: Landscape): TreePlacement[] {
  const g = land.grid;
  const r = rng(land.seed * 131 + 17);
  const out: TreePlacement[] = [];
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      const i = g.index(col, row);
      if (g.feature[i] !== FEAT_TREE) continue;
      out.push({
        x: g.centreX(col) + (r() * 2 - 1) * JITTER,
        z: g.centreZ(row) + (r() * 2 - 1) * JITTER,
        y: g.groundY(i),
        kind: treeKind(r()),
        scale: 0.8 + r() * 0.4,
        lean: r() * MAX_LEAN,
        leanDir: r() * Math.PI * 2,
        yaw: r() * Math.PI * 2,
        tint: Math.floor(r() * TREE_GREENS.length),
      });
    }
  }
  return out;
}

/** Which shape a tree (or prop) is, from a uniform random number: mostly the three turned trees. */
export function treeKind(v: number): TreeKind {
  for (const [kind, upTo] of KIND_ODDS) if (v < upTo) return kind;
  return "rock";
}

/** Each kind's share, as cumulative upper bounds on a uniform number. */
const KIND_ODDS: readonly (readonly [TreeKind, number])[] = [
  ["fir", 0.3],
  ["ball", 0.54],
  ["discs", 0.7],
  ["birch", 0.77],
  ["apple", 0.83],
  ["autumn", 0.9],
  ["willow", 0.94],
  ["bush", 0.975],
  ["rock", 1],
];

const BASE_H = 4;
const TRUNK_H = 26;
const BIRCH_H = 36;

type CrownId = "fir" | "ball" | "discs" | "birch" | "willow" | "bush" | "rock";
interface KindLook {
  /** Stands on a round wooden base. */
  base: boolean;
  trunk: "wood" | "birch" | null;
  crown: CrownId;
  /** Crown colours, picked by the placement's `tint`. */
  palette: readonly string[];
  /** Red apples dotted over the crown. */
  apples?: boolean;
}

const LOOKS: Record<TreeKind, KindLook> = {
  fir: { base: true, trunk: "wood", crown: "fir", palette: TREE_GREENS },
  ball: { base: true, trunk: "wood", crown: "ball", palette: TREE_GREENS },
  discs: { base: true, trunk: "wood", crown: "discs", palette: TREE_GREENS },
  birch: { base: true, trunk: "birch", crown: "birch", palette: ["#9fd36a", "#b3dc78", "#8cc95e", "#a6d46f", "#c0e07f"] },
  apple: { base: true, trunk: "wood", crown: "ball", palette: ["#4f9e45", "#3f8f4a", "#5ba356", "#4c9a3c", "#46953f"], apples: true },
  autumn: { base: true, trunk: "wood", crown: "ball", palette: ["#e0662a", "#c8402a", "#f0a830", "#e8862c", "#d9502e"] },
  willow: { base: true, trunk: "wood", crown: "willow", palette: ["#86b84a", "#9cc356", "#7aae46", "#a9c95e", "#8fbd52"] },
  bush: { base: false, trunk: null, crown: "bush", palette: ["#3a7d3c", "#2f6f38", "#4a8c40", "#3f8445", "#356f30"] },
  rock: { base: false, trunk: null, crown: "rock", palette: ["#9a9a96", "#8a8c8e", "#a8a49c", "#7f8184", "#b0aea8"] },
};
const APPLE_REDS = ["#d42a1f", "#c21d1a", "#e0392a"];
const BIRCH_BARK = "#f2efe8";
const BIRCH_MARK = "#2b2622";

/** A turned fir: three tiers, each with a rounded lip, like a lathe-made toy tree. Base at y = 0. */
function firCrown(segments: number): BufferGeometry {
  const p = [
    [0, 0], [19, 0], [21, 1.5], [20, 4], [12, 16], [16.5, 16.5], [17.5, 18.5], [16, 20.5],
    [9, 32], [12.5, 32.5], [13.5, 34.5], [12, 36.5], [2, 52], [0.8, 54], [0, 54.5],
  ].map(([x, y]) => new Vector2(x, y));
  return new LatheGeometry(p, segments);
}

/** Stacked discs, widest at the bottom, each with rounded edges, like a stacking toy. Base at y = 0. */
function discCrown(segments: number): BufferGeometry {
  const p: Vector2[] = [new Vector2(0, 0)];
  let y = 0;
  for (const [r, h] of [[18, 9], [15, 8.5], [11.5, 8], [7.5, 7.5]]) {
    // Each disc: a short drum with rounded top and bottom edges, then a narrow neck to the next.
    p.push(new Vector2(r - 2, y), new Vector2(r, y + 2), new Vector2(r, y + h - 2), new Vector2(r - 2, y + h), new Vector2(4, y + h));
    y += h + 1;
    p.push(new Vector2(4, y));
  }
  p.push(new Vector2(0, y));
  return new LatheGeometry(p, segments);
}

const BALL_R = 19;
const BALL_Y = BASE_H + TRUNK_H + 13;

/** The ball crown, centred on `BALL_Y`. */
function ballCrown(segments: number, lowDetail: boolean): BufferGeometry {
  const ball = new SphereGeometry(BALL_R, segments, lowDetail ? 6 : 10);
  ball.scale(1, 1.05, 1);
  ball.translate(0, BALL_Y, 0);
  return ball;
}

/** Little red apples half sunk into the ball crown, spread round it by the golden angle. */
function apples(lowDetail: boolean): BufferGeometry {
  const parts: BufferGeometry[] = [];
  const n = 11;
  for (let i = 0; i < n; i++) {
    const theta = 0.55 + (i / (n - 1)) * 1.4; // from near the top to just below the equator
    const phi = i * 2.39996;
    const a = new SphereGeometry(3.4, lowDetail ? 5 : 8, lowDetail ? 4 : 6);
    a.translate(Math.sin(theta) * Math.cos(phi) * BALL_R * 0.98, BALL_Y + Math.cos(theta) * BALL_R * 1.05 * 0.98, Math.sin(theta) * Math.sin(phi) * BALL_R * 0.98);
    parts.push(a);
  }
  const g = mergeGeometries(parts)!;
  parts.forEach((p) => p.dispose());
  return g;
}

/** A tall, light birch crown: a stretched oval on a taller trunk. */
function birchCrown(segments: number, lowDetail: boolean): BufferGeometry {
  const g = new SphereGeometry(13, segments, lowDetail ? 6 : 10);
  g.scale(1, 1.75, 1);
  g.translate(0, BASE_H + BIRCH_H + 16, 0);
  return g;
}

/** A white birch trunk with dark bark marks painted in vertex colours (for `paint`). */
function birchTrunk(lowDetail: boolean): BufferGeometry {
  const radial = 8;
  const rows = lowDetail ? 1 : 18;
  const g = new CylinderGeometry(3, 3.6, BIRCH_H, radial, rows, true).toNonIndexed();
  g.translate(0, BASE_H + BIRCH_H / 2, 0);
  const n = g.getAttribute("position").count;
  const col = new Float32Array(n * 3);
  const bark = new Color(BIRCH_BARK);
  const mark = new Color(BIRCH_MARK);
  // Triangles come in pairs per quad, column by column (radial), row by row within each column.
  for (let t = 0; t < n / 3; t++) {
    const quad = t >> 1;
    const x = Math.floor(quad / rows);
    const y = quad % rows;
    const h = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
    const dark = !lowDetail && y > 0 && h - Math.floor(h) < 0.16;
    const c = dark ? mark : bark;
    for (let v = 0; v < 3; v++) col.set([c.r, c.g, c.b], (t * 3 + v) * 3);
  }
  g.setAttribute("color", new BufferAttribute(col, 3));
  return g;
}

/** A weeping willow: a broad dome, and fronds draped over its shoulders hanging down nearly to the ground. */
function willowCrown(segments: number, lowDetail: boolean): BufferGeometry {
  const lift = BASE_H + TRUNK_H - 20;
  const p = [
    [0, 18], [6, 19], [14, 13], [15.3, 12], [15.6, 14], [15.8, 20], [15.5, 26], [14, 31], [11, 35], [6, 38], [0, 39],
  ].map(([x, y]) => new Vector2(x, y + lift));
  const parts: BufferGeometry[] = [new LatheGeometry(p, segments)];
  const fronds = lowDetail ? 9 : 16;
  const tip = new Vector3();
  for (let i = 0; i < fronds; i++) {
    const a = (i / fronds) * Math.PI * 2 + 0.2;
    // Each frond is a strand from the dome's shoulder slanting out past its rim; alternate ones hang lower.
    const top = new Vector3(12.8, 33.5, 0);
    tip.set(18.4, i % 2 ? 7 : 2, 0);
    const len = top.distanceTo(tip);
    const f = new CylinderGeometry(0.5, 1.8, len, lowDetail ? 4 : 5, 1, false);
    f.rotateZ(Math.atan2(tip.x - top.x, top.y - tip.y));
    f.translate((top.x + tip.x) / 2, lift + (top.y + tip.y) / 2, 0);
    f.rotateY(-a);
    parts.push(f);
  }
  const g = mergeGeometries(parts)!;
  parts.forEach((q) => q.dispose());
  return g;
}

/** A low bush: a cluster of balls sitting on the ground, no trunk. */
function bushCrown(lowDetail: boolean): BufferGeometry {
  const balls = [
    [0, 10, 0, 10.5],
    [9, 7.5, 3, 8],
    [-8, 7, 4.5, 7.5],
    [2, 7.5, -9, 8],
    [-2.5, 15, -2, 7],
  ];
  const parts = balls.map(([x, y, z, r]) => {
    const s = new SphereGeometry(r, lowDetail ? 6 : 8, lowDetail ? 4 : 6);
    s.translate(x, y, z);
    return s;
  });
  const g = mergeGeometries(parts)!;
  parts.forEach((q) => q.dispose());
  return g;
}

/** A grey, rounded boulder: a gently lumpy squashed ball with a flat underside. */
function rockCrown(lowDetail: boolean): BufferGeometry {
  const g = new SphereGeometry(1, lowDetail ? 7 : 12, lowDetail ? 5 : 8);
  const pos = g.getAttribute("position");
  const v = new Vector3();
  const size = new Vector3(15, 10, 12);
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    // Smooth lumps from the direction alone, so the seam's duplicate vertices move together.
    const k = 1 + 0.11 * Math.sin(2.7 * v.x + 1.3) * Math.cos(2.1 * v.z) + 0.07 * Math.sin(3.3 * v.y + 2 * v.x);
    v.multiplyScalar(k).multiply(size);
    v.y = Math.max(v.y, -4) + 4;
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  // Weld the seam so the shading runs smoothly round it.
  g.deleteAttribute("normal");
  g.deleteAttribute("uv");
  const welded = mergeVertices(g);
  g.dispose();
  welded.computeVertexNormals();
  return welded;
}

function crownGeometry(id: CrownId, round: number, lowDetail: boolean): BufferGeometry {
  switch (id) {
    case "fir": {
      const g = firCrown(round);
      g.translate(0, BASE_H + TRUNK_H - 6, 0);
      return g;
    }
    case "discs": {
      const g = discCrown(round);
      g.translate(0, BASE_H + TRUNK_H - 4, 0);
      return g;
    }
    case "ball":
      return ballCrown(round, lowDetail);
    case "birch":
      return birchCrown(round, lowDetail);
    case "willow":
      return willowCrown(round, lowDetail);
    case "bush":
      return bushCrown(lowDetail);
    case "rock":
      return rockCrown(lowDetail);
  }
}

function instanced(geometry: BufferGeometry, material: Material, count: number): InstancedMesh {
  const mesh = new InstancedMesh(geometry, material, Math.max(1, count));
  mesh.count = count;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

/** Where a tree is drawn; `s` scales it (1 by default, 0 hides it), for growing and shrinking. */
export interface TreeAt {
  x: number;
  z: number;
  y: number;
  s?: number;
}
/** Move trees (one spot per placement, in order; null takes a tree away) — see `buildTrees`. */
export type PlaceTrees = (spots: readonly (TreeAt | null)[]) => void;

/** One instance a tree draws: which mesh, which slot in it, and whether it leans with the tree (bases don't). */
interface Part {
  mesh: InstancedMesh;
  k: number;
  lean: boolean;
}

/**
 * Turned-wood toy trees on round wooden bases, plus bushes and boulders that behave like them: one instanced draw
 * call per shape (bases, trunks, birch trunks, each crown shape, apples), and none for shapes the map doesn't use.
 * The group's `userData.place` (a `PlaceTrees`) moves them. `lowDetail` trees (for distant scenery) have fewer
 * facets, cheaper materials and no bases.
 */
export function buildTrees(placements: readonly TreePlacement[], mats: Materials, lowDetail = false): Group {
  const round = lowDetail ? 7 : 14;
  const group = new Group();
  const looks = placements.map((t) => LOOKS[t.kind]);
  const count = (f: (l: KindLook) => boolean) => looks.filter(f).length;

  const crownMat = lowDetail ? mats.scenery.crown : mats.lacquer("#ffffff");
  const woodMat = lowDetail ? mats.scenery.wood : mats.naturalWood;
  const meshes: InstancedMesh[] = [];
  const make = (geometry: BufferGeometry, material: Material, n: number) => {
    const mesh = instanced(geometry, material, n);
    meshes.push(mesh);
    return mesh;
  };

  // Distant trees go without their base discs: too small to see through the haze.
  const nBases = lowDetail ? 0 : count((l) => l.base);
  let bases: InstancedMesh | null = null;
  if (nBases) {
    const base = new CylinderGeometry(13, 14.5, BASE_H, round);
    base.translate(0, BASE_H / 2, 0);
    bases = make(base, woodMat, nBases);
    bases.castShadow = false; // flat discs: their shadow would hide under them anyway
  }
  let trunks: InstancedMesh | null = null;
  const nTrunks = count((l) => l.trunk === "wood");
  if (nTrunks) {
    const trunk = new CylinderGeometry(4, 5, TRUNK_H, 8, 1, true);
    trunk.translate(0, BASE_H + TRUNK_H / 2, 0);
    trunks = make(trunk, woodMat, nTrunks);
  }
  let birchTrunks: InstancedMesh | null = null;
  const nBirch = count((l) => l.trunk === "birch");
  if (nBirch) birchTrunks = make(birchTrunk(lowDetail), lowDetail ? crownMat : mats.paint, nBirch);
  let appleMesh: InstancedMesh | null = null;
  const nApples = count((l) => !!l.apples);
  if (nApples) appleMesh = make(apples(lowDetail), crownMat, nApples);
  const crowns = new Map<CrownId, InstancedMesh>();
  for (const id of new Set(looks.map((l) => l.crown))) crowns.set(id, make(crownGeometry(id, round, lowDetail), crownMat, count((l) => l.crown === id)));

  const c = new Color();
  const used = new Map<InstancedMesh, number>();
  const slot = (mesh: InstancedMesh, lean: boolean, color?: string): Part => {
    const k = used.get(mesh) ?? 0;
    used.set(mesh, k + 1);
    if (color) mesh.setColorAt(k, c.set(color));
    return { mesh, k, lean };
  };
  // Each tree's instances, and their colours, set once.
  const partsOf: Part[][] = placements.map((t, i) => {
    const l = looks[i];
    const parts: Part[] = [];
    if (l.base && bases) parts.push(slot(bases, false));
    if (l.trunk === "wood" && trunks) parts.push(slot(trunks, true));
    if (l.trunk === "birch" && birchTrunks) parts.push(slot(birchTrunks, true, lowDetail ? BIRCH_BARK : undefined));
    parts.push(slot(crowns.get(l.crown)!, true, l.palette[t.tint % l.palette.length]));
    if (l.apples && appleMesh) parts.push(slot(appleMesh, true, APPLE_REDS[t.tint % APPLE_REDS.length]));
    return parts;
  });

  const m = new Matrix4();
  const q = new Quaternion();
  const tilt = new Quaternion();
  const axis = new Vector3();
  const pos = new Vector3();
  const scl = new Vector3();
  const up = new Vector3(0, 1, 0);
  const hidden = new Matrix4().makeScale(0, 0, 0);
  const upright = new Matrix4();
  const place: PlaceTrees = (spots) => {
    placements.forEach((t, i) => {
      const at = spots[i];
      const parts = partsOf[i];
      if (!at || (at.s ?? 1) <= 1e-3) {
        for (const p of parts) p.mesh.setMatrixAt(p.k, hidden);
        return;
      }
      pos.set(at.x, at.y, at.z);
      scl.setScalar(t.scale * (at.s ?? 1));
      q.setFromAxisAngle(up, t.yaw);
      upright.compose(pos, q, scl);
      axis.set(Math.cos(t.leanDir), 0, Math.sin(t.leanDir));
      tilt.setFromAxisAngle(axis, t.lean);
      q.premultiply(tilt);
      m.compose(pos, q, scl);
      for (const p of parts) p.mesh.setMatrixAt(p.k, p.lean ? m : upright);
    });
    for (const mesh of meshes) {
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
    }
  };
  place(placements);
  group.userData.place = place;
  group.add(...meshes);
  return group;
}

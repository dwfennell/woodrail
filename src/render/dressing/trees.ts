import {
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
import { rng } from "../../lib/rng";
import { COLS, FEAT_TREE, ROWS, type Landscape } from "../../landscape";
import type { Materials } from "../materials";

export const MAX_LEAN = 0.05;
const JITTER = 14;
export const TREE_GREENS = ["#3f8f4a", "#2f7a43", "#5ba356", "#6fae4f", "#4c9a3c"];

export interface TreePlacement {
  x: number;
  z: number;
  /** Ground height under the tree. */
  y: number;
  kind: "fir" | "ball" | "discs";
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

/** Which turned shape a tree is, from a uniform random number. */
export function treeKind(v: number): TreePlacement["kind"] {
  return v < 0.45 ? "fir" : v < 0.8 ? "ball" : "discs";
}

const BASE_H = 4;
const TRUNK_H = 26;

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

/**
 * Turned-wood toy trees on round wooden bases: five instanced draw calls for the whole map. The group's
 * `userData.place` (a `PlaceTrees`) moves them. `lowDetail` trees (for
 * distant scenery) have fewer facets, cheaper materials and no bases: four draws.
 */
export function buildTrees(placements: readonly TreePlacement[], mats: Materials, lowDetail = false): Group {
  const round = lowDetail ? 7 : 14;
  const group = new Group();
  const firs = placements.filter((t) => t.kind === "fir");
  const balls = placements.filter((t) => t.kind === "ball");
  const stacks = placements.filter((t) => t.kind === "discs");

  const base = new CylinderGeometry(13, 14.5, BASE_H, round);
  base.translate(0, BASE_H / 2, 0);
  const trunk = new CylinderGeometry(4, 5, TRUNK_H, 8, 1, true);
  trunk.translate(0, BASE_H + TRUNK_H / 2, 0);
  const fir = firCrown(round);
  fir.translate(0, BASE_H + TRUNK_H - 6, 0);
  const ball = new SphereGeometry(19, round, lowDetail ? 6 : 10);
  ball.scale(1, 1.05, 1);
  ball.translate(0, BASE_H + TRUNK_H + 13, 0);
  const discs = discCrown(round);
  discs.translate(0, BASE_H + TRUNK_H - 4, 0);

  const crownMat = lowDetail ? mats.scenery.crown : mats.lacquer("#ffffff");
  const woodMat = lowDetail ? mats.scenery.wood : mats.naturalWood;
  const bases = instanced(base, woodMat, placements.length);
  bases.castShadow = false; // flat discs: their shadow would hide under them anyway
  const trunks = instanced(trunk, woodMat, placements.length);
  const firMesh = instanced(fir, crownMat, firs.length);
  const ballMesh = instanced(ball, crownMat, balls.length);
  const discMesh = instanced(discs, crownMat, stacks.length);

  const m = new Matrix4();
  const q = new Quaternion();
  const tilt = new Quaternion();
  const axis = new Vector3();
  const pos = new Vector3();
  const scl = new Vector3();
  const c = new Color();
  const up = new Vector3(0, 1, 0);
  const hidden = new Matrix4().makeScale(0, 0, 0);
  const counts = { fir: 0, ball: 0, discs: 0 };
  // Each tree's crown instance (in its kind's mesh), and the colours, set once.
  const crownOf = placements.map((t) => {
    const k = counts[t.kind]++;
    const crowns = t.kind === "fir" ? firMesh : t.kind === "ball" ? ballMesh : discMesh;
    crowns.setColorAt(k, c.set(TREE_GREENS[t.tint]));
    return { crowns, k };
  });
  const place: PlaceTrees = (spots) => {
    placements.forEach((t, i) => {
      const at = spots[i];
      const { crowns, k } = crownOf[i];
      if (!at || (at.s ?? 1) <= 1e-3) {
        if (!lowDetail) bases.setMatrixAt(i, hidden);
        trunks.setMatrixAt(i, hidden);
        crowns.setMatrixAt(k, hidden);
        return;
      }
      pos.set(at.x, at.y, at.z);
      scl.setScalar(t.scale * (at.s ?? 1));
      q.setFromAxisAngle(up, t.yaw);
      m.compose(pos, q, scl);
      if (!lowDetail) bases.setMatrixAt(i, m);
      axis.set(Math.cos(t.leanDir), 0, Math.sin(t.leanDir));
      tilt.setFromAxisAngle(axis, t.lean);
      q.premultiply(tilt);
      m.compose(pos, q, scl);
      trunks.setMatrixAt(i, m);
      crowns.setMatrixAt(k, m);
    });
    for (const mesh of [bases, trunks, firMesh, ballMesh, discMesh]) {
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
    }
  };
  place(placements);
  group.userData.place = place;
  group.add(trunks, firMesh, ballMesh, discMesh);
  // Distant trees go without their base discs: too small to see through the haze.
  if (lowDetail) {
    bases.dispose();
    base.dispose();
  } else group.add(bases);
  return group;
}

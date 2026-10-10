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
const TREE_GREENS = ["#3f8f4a", "#2f7a43", "#5ba356", "#6fae4f", "#4c9a3c"];

export interface TreePlacement {
  x: number;
  z: number;
  /** Ground height under the tree. */
  y: number;
  kind: "fir" | "ball";
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
        kind: r() < 0.55 ? "fir" : "ball",
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

const BASE_H = 4;
const TRUNK_H = 26;

/** A turned fir: three tiers, each with a rounded lip, like a lathe-made toy tree. Base at y = 0. */
function firCrown(): BufferGeometry {
  const p = [
    [0, 0], [19, 0], [21, 1.5], [20, 4], [12, 16], [16.5, 16.5], [17.5, 18.5], [16, 20.5],
    [9, 32], [12.5, 32.5], [13.5, 34.5], [12, 36.5], [2, 52], [0.8, 54], [0, 54.5],
  ].map(([x, y]) => new Vector2(x, y));
  return new LatheGeometry(p, 18);
}

function instanced(geometry: BufferGeometry, material: Material, count: number): InstancedMesh {
  const mesh = new InstancedMesh(geometry, material, Math.max(1, count));
  mesh.count = count;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

/** Turned-wood toy trees on round wooden bases: five instanced draw calls for the whole map. */
export function buildTrees(placements: readonly TreePlacement[], mats: Materials): Group {
  const group = new Group();
  const firs = placements.filter((t) => t.kind === "fir");
  const balls = placements.filter((t) => t.kind === "ball");

  const base = new CylinderGeometry(13, 14.5, BASE_H, 18);
  base.translate(0, BASE_H / 2, 0);
  const trunk = new CylinderGeometry(4, 5, TRUNK_H, 8, 1, true);
  trunk.translate(0, BASE_H + TRUNK_H / 2, 0);
  const fir = firCrown();
  fir.translate(0, BASE_H + TRUNK_H - 6, 0);
  const ball = new SphereGeometry(19, 18, 12);
  ball.scale(1, 1.05, 1);
  ball.translate(0, BASE_H + TRUNK_H + 13, 0);

  const crownMat = mats.lacquer("#ffffff");
  const bases = instanced(base, mats.naturalWood, placements.length);
  const trunks = instanced(trunk, mats.naturalWood, placements.length);
  const firMesh = instanced(fir, crownMat, firs.length);
  const ballMesh = instanced(ball, crownMat, balls.length);

  const m = new Matrix4();
  const q = new Quaternion();
  const tilt = new Quaternion();
  const axis = new Vector3();
  const pos = new Vector3();
  const scl = new Vector3();
  const c = new Color();
  const up = new Vector3(0, 1, 0);
  const counts = { fir: 0, ball: 0 };
  placements.forEach((t, i) => {
    pos.set(t.x, t.y, t.z);
    scl.setScalar(t.scale);
    q.setFromAxisAngle(up, t.yaw);
    m.compose(pos, q, scl);
    bases.setMatrixAt(i, m);
    axis.set(Math.cos(t.leanDir), 0, Math.sin(t.leanDir));
    tilt.setFromAxisAngle(axis, t.lean);
    q.premultiply(tilt);
    m.compose(pos, q, scl);
    trunks.setMatrixAt(i, m);
    const crowns = t.kind === "fir" ? firMesh : ballMesh;
    const k = counts[t.kind]++;
    crowns.setMatrixAt(k, m);
    crowns.setColorAt(k, c.set(TREE_GREENS[t.tint]));
  });
  group.add(bases, trunks, firMesh, ballMesh);
  return group;
}

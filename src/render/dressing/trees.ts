import {
  Color,
  ConeGeometry,
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
  type Object3D,
} from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { rng } from "../../lib/rng";
import { byTile, setCullBox, TREE_DETAIL_REACH } from "./tiles";
import { FEAT_TREE, forEachInPlot, hashInts, PLOT_DEPTH, PLOT_WIDTH, type Landscape } from "../../landscape";
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

/**
 * Where each toy tree stands, with a little random size, lean and colour, plot by plot in slot order (so the trees of
 * plots added later come after those already there). Deterministic per plot.
 */
export function treePlacements(land: Landscape, plots: readonly number[] = land.grid.plots.map((_, slot) => slot)): TreePlacement[] {
  const g = land.grid;
  const out: TreePlacement[] = [];
  for (const slot of plots) {
    const { px, pz } = g.plots[slot];
    const r = rng(hashInts(land.seed, px, pz, 131));
    forEachInPlot(slot, g.plots[slot], (i, col, row) => {
      if (g.feature[i] !== FEAT_TREE) return;
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
    });
  }
  return out;
}

/** Which turned shape a tree is, from a uniform random number. */
export function treeKind(v: number): TreePlacement["kind"] {
  return v < 0.45 ? "fir" : v < 0.8 ? "ball" : "discs";
}

const BASE_H = 4;
const TRUNK_H = 26;

/** A turned fir: three tiers, each with a rounded lip, like a lathe-made toy tree. Base at y = 0. `plain`: no lips. */
function firCrown(segments: number, plain = false): BufferGeometry {
  const p = (
    plain
      ? [[0, 0], [20, 0], [12, 16], [17, 18], [9, 32], [13, 34], [0, 54.5]]
      : [
          [0, 0], [19, 0], [21, 1.5], [20, 4], [12, 16], [16.5, 16.5], [17.5, 18.5], [16, 20.5],
          [9, 32], [12.5, 32.5], [13.5, 34.5], [12, 36.5], [2, 52], [0.8, 54], [0, 54.5],
        ]
  ).map(([x, y]) => new Vector2(x, y));
  return new LatheGeometry(p, segments);
}

/** Stacked discs, widest at the bottom, each with rounded edges, like a stacking toy. Base at y = 0. `plain`: square edges. */
function discCrown(segments: number, plain = false): BufferGeometry {
  const p: Vector2[] = [new Vector2(0, 0)];
  let y = 0;
  for (const [r, h] of [[18, 9], [15, 8.5], [11.5, 8], [7.5, 7.5]]) {
    // Each disc: a short drum with rounded top and bottom edges, then a narrow neck to the next.
    if (plain) p.push(new Vector2(r, y), new Vector2(r, y + h), new Vector2(4, y + h));
    else p.push(new Vector2(r - 2, y), new Vector2(r, y + 2), new Vector2(r, y + h - 2), new Vector2(r - 2, y + h), new Vector2(4, y + h));
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
  const round = lowDetail ? 6 : 14;
  const group = new Group();
  const firs = placements.filter((t) => t.kind === "fir");
  const balls = placements.filter((t) => t.kind === "ball");
  const stacks = placements.filter((t) => t.kind === "discs");

  const base = new CylinderGeometry(13, 14.5, BASE_H, round);
  base.translate(0, BASE_H / 2, 0);
  const trunk = new CylinderGeometry(4, 5, TRUNK_H, 8, 1, true);
  trunk.translate(0, BASE_H + TRUNK_H / 2, 0);
  const fir = firCrown(round, lowDetail);
  fir.translate(0, BASE_H + TRUNK_H - 6, 0);
  const ball = new SphereGeometry(19, round, lowDetail ? 5 : 10);
  ball.scale(1, 1.05, 1);
  ball.translate(0, BASE_H + TRUNK_H + 13, 0);
  const discs = discCrown(round, lowDetail);
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
  const hidden = new Matrix4();
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
        // Shrunk away where it stood (not at the origin, which would stretch the mesh's bounds there).
        hidden.makeScale(0, 0, 0).setPosition(t.x, t.y, t.z);
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

/** One tile of trees as built (see `buildTiledTrees`): what it was built from, its draws, and where it last put them. */
export interface TreeTile {
  sig: number;
  group: Group;
  place: PlaceTrees;
  last: (TreeAt | null)[];
}

/**
 * Trees as `buildTrees`, but a set of draws per tile (see `tiles.ts`), so trees out of view are skipped. The group's
 * `userData.place` takes one spot per placement, in order, as for `buildTrees`, and moves only the tiles whose trees
 * moved. Tiles in `reuse` whose trees are the same are kept rather than built again (taken out of their old group);
 * `reuse` is left holding this build's tiles. `extra` adds something per tile (such as contact shadows).
 */
export function buildTiledTrees(
  placements: readonly TreePlacement[],
  mats: Materials,
  lowDetail = false,
  reuse: Map<number, TreeTile> = new Map(),
  extra?: (trees: readonly TreePlacement[]) => Object3D | null,
): Group {
  const group = new Group();
  const kept = new Map<number, TreeTile>();
  const tiles = [...byTile(placements.map((t, i) => ({ t, i })), ({ t }) => t)].map(([key, list]) => {
    const trees = list.map(({ t }) => t);
    let sig = 0x811c9dc5;
    for (const t of trees) sig = Math.imul(sig ^ Math.round(t.x * 10) ^ Math.imul(Math.round(t.z * 10), 31) ^ Math.round(t.y), 0x01000193);
    let tile = reuse.get(key);
    if (!tile || tile.sig !== sig) {
      // Close up, a detailed set per plot (each culled on its own: trees are the busiest scenery); further off, one
      // plainer set for the whole tile (see `cullTiles`).
      const places: PlaceTrees[] = [];
      const near = new Group();
      const plots = [...byTile(trees.map((t, k) => ({ t, k })), ({ t }) => t, PLOT_WIDTH, PLOT_DEPTH).values()];
      for (const plot of plots) {
        const g = buildTrees(plot.map(({ t }) => t), mats, lowDetail);
        setCullBox(g, plot.map(({ t }) => t), plot.reduce((top, { t }) => Math.max(top, t.y + 150 * t.scale), 0));
        near.add(g);
        const placeIt = g.userData.place as PlaceTrees;
        const ks = plot.map(({ k }) => k);
        places.push((spots) => placeIt(ks.map((k) => spots[k])));
      }
      const g = new Group();
      g.add(near);
      if (!lowDetail) {
        const far = buildFarTrees(trees, mats);
        far.visible = false;
        g.add(far);
        g.userData.lod = { near, far };
        g.userData.detailReach = TREE_DETAIL_REACH;
        places.push(far.userData.place as PlaceTrees);
      }
      const more = extra?.(trees);
      if (more) g.add(more);
      // Trees are under 120 mm tall (a little more for big scenery ones), and step up to 144 mm aside.
      setCullBox(g, trees, trees.reduce((top, t) => Math.max(top, t.y + 150 * t.scale), 0));
      const place: PlaceTrees = (spots) => {
        for (const p of places) p(spots);
      };
      tile = { sig, group: g, place, last: trees.map((t) => ({ x: t.x, y: t.y, z: t.z, s: 1 })) };
    }
    kept.set(key, tile);
    group.add(tile.group);
    return { indices: list.map(({ i }) => i), tile };
  });
  reuse.clear();
  for (const [k, t] of kept) reuse.set(k, t);
  const same = (a: TreeAt | null, b: TreeAt | null) => a === b || (!!a && !!b && a.x === b.x && a.y === b.y && a.z === b.z && (a.s ?? 1) === (b.s ?? 1));
  const place: PlaceTrees = (spots) => {
    for (const { indices, tile } of tiles) {
      const mine = indices.map((i) => spots[i]);
      if (mine.length === tile.last.length && mine.every((s, k) => same(s, tile.last[k]))) continue;
      tile.place(mine);
      tile.last = mine.map((s) => (s ? { ...s } : null));
    }
  };
  group.userData.place = place;
  return group;
}

/**
 * Trees far off: each a plain cone on a short stalk in its crown's colour, all in one draw (a few dozen triangles a
 * tree). `userData.place` as for `buildTrees`.
 */
export function buildFarTrees(placements: readonly TreePlacement[], mats: Materials): Group {
  const group = new Group();
  const parts = [new CylinderGeometry(4.5, 4.5, BASE_H + TRUNK_H, 4, 1, true).translate(0, (BASE_H + TRUNK_H) / 2, 0), new ConeGeometry(19, 46, 6).translate(0, BASE_H + TRUNK_H + 17, 0)];
  const shape = mergeGeometries(parts.map((g) => g.toNonIndexed()));
  for (const g of parts) g.dispose();
  const mesh = instanced(shape, mats.scenery.crown, placements.length);
  mesh.castShadow = false;
  const c = new Color();
  placements.forEach((t, i) => mesh.setColorAt(i, c.set(TREE_GREENS[t.tint])));
  const m = new Matrix4();
  const q = new Quaternion();
  const pos = new Vector3();
  const scl = new Vector3();
  const place: PlaceTrees = (spots) => {
    placements.forEach((t, i) => {
      const at = spots[i];
      const s = at ? (at.s ?? 1) : 0;
      pos.set(at?.x ?? t.x, at?.y ?? t.y, at?.z ?? t.z);
      scl.setScalar(t.scale * s);
      m.compose(pos, q, scl);
      mesh.setMatrixAt(i, m);
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
  };
  place(placements);
  group.add(mesh);
  group.userData.place = place;
  return group;
}

import { Group, Mesh, type BufferGeometry, type Material } from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { CELL, outsideDistance, type OuterBlock, type OuterTree, type Rect, type Surroundings } from "../../landscape";
import { RISER_HEIGHT } from "../../track";
import type { Materials } from "../materials";
import { Batcher } from "./batcher";
import { blockMeshes, shadowProxyGeometry, shadowProxyMesh } from "./blocks";
import { building } from "./buildings";
import { buildTrees, MAX_LEAN, TREE_GREENS, treeKind, type TreePlacement } from "./trees";

const ROUNDED_REACH = 700;
const AROUND_ROUNDED_REACH = 150;

/**
 * Some scenery, made ready to draw: its blocks and trees (drawn instanced, so cheap to lay out again), and the
 * expensive part built once: its houses' geometry, merged per material, and its hills' shadow stand-in.
 */
export interface SceneryPart {
  blocks: readonly OuterBlock[];
  /**
   * Blocks this near the land are bevelled like its own; further out, plain boxes (in the land's beech within
   * `beechReach`, the scenery's paler wood beyond).
   */
  roundedReach: number;
  beechReach: number;
  trees: readonly OuterTree[];
  houses: Map<Material, BufferGeometry>;
  shadow: BufferGeometry | null;
}

/**
 * Build the expensive part of some scenery once (see `SceneryPart`). The countryside's blocks are bevelled up to
 * `ROUNDED_REACH` out; land shown around the world (`around`) has many more, so only those right by the land are.
 */
export function sceneryPart(s: Surroundings, mats: Materials, seed = 0, around = false): SceneryPart {
  const b = new Batcher(mats.paint);
  s.houses.forEach((h, i) =>
    building(b, mats, { cx: h.cx, cz: h.cz, w: h.w, d: h.d }, { floors: h.floors, kind: "house", roof: h.roof, seed: seed + i * 11 + 3, front: h.front }),
  );
  return {
    blocks: s.blocks,
    roundedReach: around ? AROUND_ROUNDED_REACH : ROUNDED_REACH,
    beechReach: around ? Infinity : ROUNDED_REACH,
    trees: s.trees,
    houses: b.merged(),
    shadow: shadowProxyGeometry(s.slabs),
  };
}

/** Free a part's geometry. */
export function disposeSceneryPart(p: SceneryPart): void {
  for (const g of p.houses.values()) g.dispose();
  p.shadow?.dispose();
}

/**
 * The scenery around the land: bevelled blocks beside it, plain ones beyond (big ones for the distant "mountains"),
 * trees and hamlets. Only the near hills cast shadows, through merged stand-ins.
 */
export function buildSurroundings(s: Surroundings, mats: Materials, land: Rect): Group {
  const part = sceneryPart(s, mats);
  const group = buildScenery([part], mats, land);
  disposeSceneryPart(part);
  return group;
}

/** Draw some scenery parts together, in a few draws for all of them (merging their houses and shadows). */
export function buildScenery(parts: readonly SceneryPart[], mats: Materials, land: Rect): Group {
  const group = new Group();
  // Next to the land the blocks are bevelled like the land's own; further out the haze hides the difference.
  const close: OuterBlock[] = [];
  const beech: OuterBlock[] = [];
  const plain: OuterBlock[] = [];
  for (const p of parts) {
    for (const k of p.blocks) {
      const d = k.size === CELL ? outsideDistance(k.x, k.z, land) : Infinity;
      (d < p.roundedReach ? close : d < p.beechReach ? beech : plain).push(k);
    }
  }
  const wood = { wood: mats.blockWood, top: mats.blockTop };
  group.add(blockMeshes(close, CELL, RISER_HEIGHT, wood, true, false));
  if (beech.length > 0) group.add(blockMeshes(beech, CELL, RISER_HEIGHT, wood, false));
  group.add(blockMeshes(plain, CELL, RISER_HEIGHT, mats.scenery, false));
  const shadows = parts.map((p) => p.shadow).filter((g): g is BufferGeometry => g !== null);
  if (shadows.length > 0) group.add(shadowProxyMesh(shadows.length === 1 ? shadows[0].clone() : mergeGeometries(shadows)));

  const trees: TreePlacement[] = parts.flatMap((p) => p.trees).map((t) => {
    const v = t.variant;
    return {
      x: t.x,
      z: t.z,
      y: t.y,
      kind: treeKind(v),
      scale: t.scale,
      lean: ((v * 97) % 1) * MAX_LEAN,
      leanDir: ((v * 331) % 1) * Math.PI * 2,
      yaw: ((v * 7919) % 1) * Math.PI * 2,
      tint: Math.floor(v * 1009) % TREE_GREENS.length,
    };
  });
  const forest = buildTrees(trees, mats, true);
  forest.traverse((o) => (o.castShadow = false));
  group.add(forest);

  const byMaterial = new Map<Material, BufferGeometry[]>();
  for (const p of parts) {
    for (const [m, g] of p.houses) {
      let list = byMaterial.get(m);
      if (!list) byMaterial.set(m, (list = []));
      list.push(g);
    }
  }
  for (const [material, list] of byMaterial) {
    const merged = list.length === 1 ? list[0].clone() : mergeGeometries(list);
    if (!merged) continue;
    const mesh = new Mesh(merged, material);
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  return group;
}

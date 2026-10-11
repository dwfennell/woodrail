import { Group } from "three";
import { CELL, type Surroundings } from "../../landscape";
import type { Materials } from "../materials";
import type { Batcher } from "./batcher";
import { blockMeshes, shadowProxy } from "./blocks";
import { building } from "./buildings";
import { buildTrees, MAX_LEAN, TREE_GREENS, type TreePlacement } from "./trees";

/**
 * The scenery around the mat: near hills of rounded blocks, distant "mountains" of big plain blocks, trees and
 * hamlets. Only the near hills cast shadows, through merged stand-ins; houses go into the shared batch.
 */
export function buildSurroundings(s: Surroundings, mats: Materials, b: Batcher): Group {
  const group = new Group();
  const near = s.blocks.filter((k) => k.size === CELL);
  const far = s.blocks.filter((k) => k.size !== CELL);
  group.add(blockMeshes(near, CELL, mats, true));
  if (far.length > 0) group.add(blockMeshes(far, far[0].size, mats, false));
  const proxy = shadowProxy(s.slabs);
  if (proxy) group.add(proxy);

  const trees: TreePlacement[] = s.trees.map((t) => {
    const v = t.variant;
    return {
      x: t.x,
      z: t.z,
      y: t.y,
      kind: v < 0.55 ? "fir" : "ball",
      scale: t.scale,
      lean: ((v * 97) % 1) * MAX_LEAN,
      leanDir: ((v * 331) % 1) * Math.PI * 2,
      yaw: ((v * 7919) % 1) * Math.PI * 2,
      tint: Math.floor(v * 1009) % TREE_GREENS.length,
    };
  });
  const forest = buildTrees(trees, mats);
  forest.traverse((o) => (o.castShadow = false));
  group.add(forest);

  s.houses.forEach((h, i) =>
    building(b, mats, { cx: h.cx, cz: h.cz, w: h.w, d: h.d }, { floors: h.floors, kind: "house", roof: h.roof, seed: i * 11 + 3, front: h.front }),
  );
  return group;
}

import { Group } from "three";
import { CELL, outsideDistance, type Surroundings } from "../../landscape";
import { RISER_HEIGHT } from "../../track";
import type { Materials } from "../materials";
import { Batcher } from "./batcher";
import { blockMeshes, shadowProxy } from "./blocks";
import { building } from "./buildings";
import { buildTrees, MAX_LEAN, TREE_GREENS, type TreePlacement } from "./trees";

const ROUNDED_REACH = 700;

/**
 * The scenery around the mat: bevelled blocks beside it, plain ones beyond (big ones for the distant "mountains"),
 * trees and hamlets. Only the near hills cast shadows, through merged stand-ins.
 */
export function buildSurroundings(s: Surroundings, mats: Materials): Group {
  const group = new Group();
  // Next to the mat the blocks are bevelled like the mat's own; further out the haze hides the difference.
  const close = s.blocks.filter((k) => k.size === CELL && outsideDistance(k.x, k.z) < ROUNDED_REACH);
  const plain = s.blocks.filter((k) => k.size !== CELL || outsideDistance(k.x, k.z) >= ROUNDED_REACH);
  group.add(blockMeshes(close, CELL, RISER_HEIGHT, { wood: mats.blockWood, top: mats.blockTop }, true, false));
  group.add(blockMeshes(plain, CELL, RISER_HEIGHT, mats.scenery, false));
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
  const forest = buildTrees(trees, mats, true);
  forest.traverse((o) => (o.castShadow = false));
  group.add(forest);

  const b = new Batcher(mats.paint);
  s.houses.forEach((h, i) =>
    building(b, mats, { cx: h.cx, cz: h.cz, w: h.w, d: h.d }, { floors: h.floors, kind: "house", roof: h.roof, seed: i * 11 + 3, front: h.front }),
  );
  b.build(group, false);
  return group;
}

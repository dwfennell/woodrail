import { expect } from "vitest";
import { isWater, SURF_SEA } from "../landscape";
import { QUAY } from "./harbours";
import { siteWhy } from "./industries";
import { buildStarterWorld, landForSale, plotsForSale, unlockPlot, type World } from "./world";

// Helpers for the tests of harbours (not part of the game).

/** The starter map with its coast plot bought. */
export function coastWorld(): World {
  const w = buildStarterWorld();
  const p = plotsForSale(w.landscape).find((q) => {
    const g = landForSale(w.landscape, q.px, q.pz).grid;
    let sea = false;
    g.forEachCell((i) => {
      if (g.surface[i] === SURF_SEA) sea = true;
    });
    return sea;
  })!;
  expect(unlockPlot(w, p.px, p.pz)).not.toBeNull();
  return w;
}

/** A pose for a harbour on this land: its site rule met, its quay on the water (the sea, or a river). */
export function harbourSite(w: World, water = SURF_SEA): { x: number; z: number; heading: number } {
  const g = w.landscape.grid;
  let found: { x: number; z: number; heading: number } | null = null;
  g.forEachCell((i, col, row) => {
    if (found || g.surface[i] !== water) return;
    for (const heading of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
      // The quay's point on this sea square: the piece stands back from it, on the land.
      const c = Math.cos(heading);
      const s = Math.sin(heading);
      const qx = g.centreX(col);
      const qz = g.centreZ(row);
      const pose = { x: qx - c * QUAY.t + s * QUAY.l, z: qz - s * QUAY.t - c * QUAY.l, heading };
      const under = g.cellAtWorld(pose.x + c * 108, pose.z + s * 108);
      if (under === -1 || isWater(g.surface[under])) continue;
      if (siteWhy(w.landscape, "depot-harbour", pose) === null) {
        found = pose;
        return;
      }
    }
  });
  expect(found).not.toBeNull();
  return found!;
}

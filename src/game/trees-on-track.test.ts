import { describe, expect, it } from "vitest";
import { TREE_CLEARANCE, trackPoints, treesAside } from "../landscape";
import { treePlacements } from "../render/dressing/trees";
import { candidatesFrom, connectorRef, createWorldConnector, getPieceDef } from "../track";
import { createWorld, plotsForSale, unlockPlot, type World } from "./world";

/**
 * Players' screenshots showed trees standing on track (seed 948582 by a drawn straight; a pale birch by a forest yard).
 * Trees grow only where the map is made (and on each plot bought, as it's made), never later, and every tree within
 * `TREE_CLEARANCE` of track steps aside or is taken away (`treesAside`). Here: track laid by hand off every station's
 * and yard's ends, then the land grown round it two plots deep (new towns, new forest yards and their trees), then more
 * track off the new ends. No tree stands within its clearance of any track, a yard's own track too.
 */

/** Three long straights on from every free end (as laid by hand). */
function layStubs(w: World): void {
  for (const id of [...w.layout.pieceIds()]) {
    const p = w.layout.getPiece(id)!;
    const def = getPieceDef(p.type, p.flipped);
    for (let k = 0; k < def.connectors.length; k++) {
      if (w.layout.joinedConnector(connectorRef(id, k)) !== -1) continue;
      const c = w.layout.worldConnector(connectorRef(id, k), createWorldConnector());
      let end = { x: c.x, z: c.z, heading: c.heading, y: c.y, kind: c.kind };
      for (let n = 0; n < 3; n++) {
        const q = candidatesFrom(end, ["straight-216"])[0];
        w.layout.addPiece(q.type, q.pose, q.y, q.flipped);
        end = q.end;
      }
    }
  }
}

describe("no tree stands on track", () => {
  it("track laid by hand by stations and forest yards, then the land grown round it: every tree clear of every track", () => {
    let forests = 0;
    for (const seed of [3, 7, 12, 948582]) {
      const w = createWorld(seed, true);
      layStubs(w);
      for (let round = 0; round < 2; round++) for (const p of plotsForSale(w.landscape)) unlockPlot(w, p.px, p.pz);
      layStubs(w);
      forests += w.landscape.depots.filter((d) => d.kind === "forest").length;
      const trees = treePlacements(w.landscape);
      const spots = treesAside(w.landscape.grid, w.layout, trees);
      const pts = [...trackPoints(w.layout).values()].flat();
      let nearest = Infinity;
      for (const t of spots) {
        if (!t) continue;
        for (let i = 0; i < pts.length; i += 2) nearest = Math.min(nearest, Math.hypot(pts[i] - t.x, pts[i + 1] - t.z));
      }
      expect(nearest, `seed ${seed}`).toBeGreaterThanOrEqual(TREE_CLEARANCE - 1e-6);
    }
    expect(forests).toBeGreaterThan(4);
  }, 60000);
});

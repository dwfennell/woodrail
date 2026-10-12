import { describe, expect, it } from "vitest";
import { FEAT_STATION, generateLandscape, SURF_LANE, SURF_ROAD } from "../landscape";
import { edgesOf, pieceOf } from "./pieces";

describe("town gates", () => {
  it("generated maps have no roads but a gate or two per town: a straight on flat grass leading out of a street", () => {
    let towns = 0;
    let gated = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const land = generateLandscape(seed);
      const g = land.grid;
      const nb = g.neighbours();
      const gatesOf = new Map<number, number>();
      for (let i = 0; i < g.cellCount; i++) {
        if (g.surface[i] !== SURF_LANE) continue;
        expect(pieceOf(g.road[i])?.id).toBe("straight");
        expect(g.height[i]).toBe(0);
        // One end on a town street, the other on open land.
        const ends = [0, 1, 2, 3].filter((e) => edgesOf(g.road[i]) & (1 << e)).map((e) => nb[i * 4 + e]);
        const street = ends.filter((j) => j !== -1 && g.surface[j] === SURF_ROAD);
        expect(street).toHaveLength(1);
        const town = land.towns.find((t) => t.cells.includes(street[0]))!;
        expect(town).toBeDefined();
        gatesOf.set(town.id, (gatesOf.get(town.id) ?? 0) + 1);
        for (let e = 0; e < 4; e++) expect(g.feature[nb[i * 4 + e]] === FEAT_STATION).toBe(false);
      }
      towns += land.towns.length;
      for (const n of gatesOf.values()) expect(n).toBeLessThanOrEqual(2);
      gated += gatesOf.size;
    }
    // Nearly every town has room for one.
    expect(gated / towns).toBeGreaterThan(0.9);
  });
});

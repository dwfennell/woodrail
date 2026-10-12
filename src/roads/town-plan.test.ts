import { describe, expect, it } from "vitest";
import { FEAT_BUILDING, FEAT_STATION, generateLandscape, SURF_LANE, SURF_ROAD } from "../landscape";
import { edgesOf, roadsJoin, type Edge } from "./pieces";

describe("town street plans", () => {
  it("every building fronts a street, streets join up from Station Road, and most main streets lead to a gate", () => {
    let towns = 0;
    let buildings = 0;
    let gates = 0;
    for (let seed = 1; seed <= 60; seed++) {
      const land = generateLandscape(seed);
      const g = land.grid;
      const nb = g.neighbours();
      for (const town of land.towns) {
        towns++;
        const streets = town.cells.filter((i) => g.surface[i] === SURF_ROAD);
        expect(streets.length, `${seed}/${town.name}`).toBeGreaterThan(3);
        for (const i of streets) {
          expect(g.road[i]).not.toBe(0);
          // Each end of a street piece meets the street's next square, or leads out of the town.
          for (let e = 0; e < 4; e++) {
            if (!(edgesOf(g.road[i]) & (1 << e))) continue;
            const j = nb[i * 4 + e];
            if (j !== -1 && g.surface[j] === SURF_ROAD) expect(roadsJoin(g.road[i], e as Edge, g.road[j])).toBe(true);
            else expect(j === -1 || g.feature[j] !== FEAT_BUILDING).toBe(true);
          }
        }
        // Streets on each side are one network: flood from any street square along joins.
        const seen = new Set<number>();
        let groups = 0;
        for (const s of streets) {
          if (seen.has(s)) continue;
          groups++;
          const queue = [s];
          seen.add(s);
          while (queue.length) {
            const i = queue.pop()!;
            for (let e = 0; e < 4; e++) {
              const j = nb[i * 4 + e];
              if (j !== -1 && !seen.has(j) && g.surface[j] === SURF_ROAD && roadsJoin(g.road[i], e as Edge, g.road[j])) {
                seen.add(j);
                queue.push(j);
              }
            }
          }
        }
        expect(groups, `${seed}/${town.name}`).toBeLessThanOrEqual(2);
        for (const b of town.buildings) {
          buildings++;
          expect(b.front).toBeDefined();
          // Its front faces a street square.
          expect(b.cells.some((c) => g.surface[nb[c * 4 + b.front!]] === SURF_ROAD)).toBe(true);
        }
        for (const i of streets) for (let e = 0; e < 4; e++) if (g.surface[nb[i * 4 + e]] === SURF_LANE) gates++;
        expect(town.cells.some((i) => g.feature[i] === FEAT_STATION)).toBe(true);
      }
    }
    expect(buildings / towns).toBeGreaterThan(5);
    // Two sides per town, most with room for a gate.
    expect(gates / towns).toBeGreaterThan(1.2);
  });
});

import { describe, expect, it } from "vitest";
import { CELL, FEAT_BUILDING, FEAT_STATION, generateLandscape, gridWithPlots, SURF_GRASS, SURF_ROAD } from "../landscape";
import { growTown, startsBothSides, type GrowthStep } from "./grow-town";
import { roadsJoin, type Edge } from "./pieces";

/** A town on an empty plot: station along x through row `cr`, platform on row `cr + 1`, the line kept clear. */
function openSite(cc = 15, cr = 11) {
  const g = gridWithPlots(0, 0, 1, 1);
  const cells: number[] = [];
  for (let c = cc - 1; c <= cc + 1; c++) {
    for (const r of [cr, cr + 1]) {
      const i = g.index(c, r);
      g.feature[i] = FEAT_STATION;
      cells.push(i);
    }
  }
  const town = { centre: { x: (cc + 0.5) * CELL, z: (cr + 0.5) * CELL }, heading: 0, cells, buildings: [] };
  const canUse = (i: number) => g.rowOf(i) !== cr && g.surface[i] === SURF_GRASS;
  return { g, town, canUse };
}

/** Put the steps on the grid as generation does. */
function apply(g: ReturnType<typeof gridWithPlots>, steps: GrowthStep[]) {
  for (const s of steps) {
    for (const [i, road] of s.streets) {
      g.surface[i] = SURF_ROAD;
      g.road[i] = road;
    }
    for (const c of s.cells) g.feature[c] = FEAT_BUILDING;
  }
}

describe("growTown", () => {
  it("is deterministic and changes nothing", () => {
    const { g, town, canUse } = openSite();
    const before = [g.surface.slice(), g.feature.slice(), g.road.slice()];
    const a = growTown(g, town, 20, { canUse });
    expect(growTown(g, town, 20, { canUse })).toEqual(a);
    expect([g.surface, g.feature, g.road]).toEqual(before);
    expect(a).toHaveLength(20);
  });

  it("starts with Station Road in front of the platform, and every building faces a street", () => {
    const { g, town, canUse } = openSite();
    const steps = growTown(g, town, 30, { canUse });
    expect(steps[0].streets.map(([i]) => i)).toEqual(expect.arrayContaining([14, 15, 16].map((c) => g.index(c, 13))));
    apply(g, steps);
    const nb = g.neighbours();
    for (const s of steps) {
      expect(s.cells.length).toBeLessThanOrEqual(2);
      for (const c of s.cells) expect(g.surface[nb[c * 4 + s.front]]).toBe(SURF_ROAD);
    }
  });

  it("lays streets that join up, never two wide, with side streets once it grows", () => {
    for (const cc of [10, 13, 15, 18, 21]) {
      const { g, town, canUse } = openSite(cc);
      apply(g, growTown(g, town, 30, { canUse }));
      const nb = g.neighbours();
      let side = 0;
      for (let i = 0; i < g.cellCount; i++) {
        if (g.surface[i] !== SURF_ROAD) continue;
        if (Math.abs(g.rowOf(i) - 11) > 2) side++;
        for (let e = 0; e < 4; e++) {
          const j = nb[i * 4 + e];
          if (j !== -1 && g.surface[j] === SURF_ROAD) expect(roadsJoin(g.road[i], e as Edge, g.road[j]), `${cc}: ${i} → ${j}`).toBe(true);
        }
        // No two-by-two of street.
        const r = nb[i * 4];
        const d = nb[i * 4 + 1];
        if (r !== -1 && d !== -1) expect(g.surface[r] === SURF_ROAD && g.surface[d] === SURF_ROAD && g.surface[nb[r * 4 + 1]] === SURF_ROAD).toBe(false);
      }
      expect(side, `${cc}: side streets`).toBeGreaterThan(0);
    }
  });

  it("evolves its middle: houses near the station become shops and gain floors", () => {
    const { g, town, canUse } = openSite();
    const steps = growTown(g, town, 30, { canUse });
    const changes = steps.flatMap((s) => s.changes);
    expect(changes.some((c) => c.kind === "shop")).toBe(true);
    expect(changes.some((c) => c.floors === 2)).toBe(true);
    // Only buildings already standing change: ids from earlier steps of the call.
    steps.forEach((s, k) => {
      for (const c of s.changes) expect(-1 - c.id).toBeLessThan(k);
    });
  });

  it("grows a new map's towns: a hamlet to a small town each, about two in five starting on both sides", () => {
    let towns = 0;
    let both = 0;
    let buildings = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const land = generateLandscape(seed);
      const g = land.grid;
      const nb = g.neighbours();
      for (const town of land.towns) {
        towns++;
        if (startsBothSides(town.centre)) both++;
        buildings += town.buildings.length;
        expect(town.buildings.length, `${seed}/${town.name}`).toBeLessThanOrEqual(14);
        for (const b of town.buildings) expect(b.cells.some((c) => g.surface[nb[c * 4 + b.front!]] === SURF_ROAD), `${seed}/${town.name}`).toBe(true);
      }
    }
    expect(both / towns).toBeGreaterThan(0.25);
    expect(both / towns).toBeLessThan(0.55);
    expect(buildings / towns).toBeGreaterThan(7);
  });

  it("is quick: ten buildings in a few milliseconds", () => {
    const { g, town, canUse } = openSite();
    growTown(g, town, 10, { canUse });
    const t0 = performance.now();
    for (let k = 0; k < 10; k++) growTown(g, town, 10, { canUse });
    expect((performance.now() - t0) / 10).toBeLessThan(20);
  });
});

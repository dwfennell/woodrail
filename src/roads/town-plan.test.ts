import { describe, expect, it } from "vitest";
import { CELL, FEAT_BUILDING, FEAT_STATION, generateLandscape, gridWithPlots, SURF_LANE, SURF_ROAD, SURF_TOWN } from "../landscape";
import { edgesOf, pieceOf, roadsJoin, type Edge } from "./pieces";
import { planTown } from "./town-plan";

describe("town street plans", () => {
  it("every building fronts a street, streets join up from Station Road, and most main streets lead to a gate", () => {
    let towns = 0;
    let buildings = 0;
    let gates = 0;
    let corners = 0;
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
          if (b.corner) corners++;
          expect(b.front).toBeDefined();
          // Its front faces a street square.
          expect(b.cells.some((c) => g.surface[nb[c * 4 + b.front!]] === SURF_ROAD)).toBe(true);
        }
        for (const i of streets) for (let e = 0; e < 4; e++) if (g.surface[nb[i * 4 + e]] === SURF_LANE) gates++;
        expect(town.cells.some((i) => g.feature[i] === FEAT_STATION)).toBe(true);
      }
    }
    expect(buildings / towns).toBeGreaterThan(5);
    // Most towns have a corner or two.
    expect(corners / towns).toBeGreaterThan(1);
    // Two sides per town, most with room for a gate.
    expect(gates / towns).toBeGreaterThan(1.2);
  });
});

describe("side streets", () => {
  /** A town on an empty plot reaching `radius` squares from its centre, station along x (platform toward +z). */
  function grownTown(radius: number, cc = 15, cr = 11) {
    const g = gridWithPlots(0, 0, 1, 1);
    const cells: number[] = [];
    for (let r = cr - 8; r <= cr + 8; r++) {
      for (let c = cc - 8; c <= cc + 8; c++) {
        const i = g.index(c, r);
        if (i === -1 || Math.hypot(c - cc, r - cr) >= radius) continue;
        // The station: its track row, and the platform row on the +z side.
        if ((r === cr || r === cr + 1) && Math.abs(c - cc) <= 1) g.feature[i] = FEAT_STATION;
        else if (Math.abs(r - cr) <= 1 && Math.abs(c - cc) >= 2) continue; // the approaches stay out of town
        g.surface[i] = SURF_TOWN;
        cells.push(i);
      }
    }
    const site = { centre: { x: (cc + 0.5) * CELL, z: (cr + 0.5) * CELL }, heading: 0, cells };
    return { g, site, cc, cr };
  }

  it("four-square towns have none", () => {
    const { g, site, cr } = grownTown(4);
    const plan = planTown(g, site, () => false);
    for (const i of plan.streets.keys()) expect(Math.abs(g.rowOf(i) - cr)).toBeLessThanOrEqual(3);
  });

  it("a town grown to 6.5 squares gets one each side, off the main street, with houses facing it", () => {
    const { g, site, cc, cr } = grownTown(6.5);
    const plan = planTown(g, site, () => false);
    const nb = g.neighbours();
    for (const s of [1, -1]) {
      const row = cr + s * 5;
      // The main street (at the middle or a square either way) goes on out beyond it.
      const mc = [cc - 1, cc, cc + 1].find((c) => plan.streets.has(g.index(c, row + s)))!;
      expect(mc).toBeDefined();
      const side = [...plan.streets.keys()].filter((i) => g.rowOf(i) === row && g.colOf(i) !== mc);
      expect(side.length).toBeGreaterThanOrEqual(6);
      // It meets the main street at a junction.
      const join = g.index(mc, row);
      expect(plan.streets.has(join)).toBe(true);
      expect(pieceOf(plan.streets.get(join)!)?.id).toMatch(/tee|cross/);
      // Every square of it joins the next.
      for (const i of side) {
        const toward = g.colOf(i) > mc ? 2 : 0;
        expect(roadsJoin(plan.streets.get(i)!, toward as Edge, plan.streets.get(nb[i * 4 + toward])!)).toBe(true);
      }
      // Houses face it from both sides.
      const facing = plan.lots.filter((l) => l.cells.some((c) => side.includes(nb[c * 4 + l.front])));
      expect(facing.length).toBeGreaterThanOrEqual(6);
    }
    // Every lot fronts a street.
    for (const l of plan.lots) expect(l.cells.some((c) => plan.streets.has(nb[c * 4 + l.front]))).toBe(true);
  });

  it("towns differ: a side has a high street or a loop, every street joined up to Station Road", () => {
    const seen = { high: 0, loop: 0, shifted: 0 };
    for (let cc = 8; cc <= 22; cc++) {
      for (const cr of [8, 11, 14]) {
        const { g, site } = grownTown(6.5, cc, cr);
        const plan = planTown(g, site, () => false);
        const nb = g.neighbours();
        // Flood along joined streets from each Station Road's middle: every street square is reached.
        const reached = new Set<number>();
        const todo = [cr - 2, cr + 2].map((r) => g.index(cc, r)).filter((i) => plan.streets.has(i));
        for (const i of todo) reached.add(i);
        while (todo.length) {
          const i = todo.pop()!;
          for (let e = 0; e < 4; e++) {
            const j = nb[i * 4 + e];
            if (!plan.streets.has(j) || reached.has(j) || !roadsJoin(plan.streets.get(i)!, e as Edge, plan.streets.get(j)!)) continue;
            reached.add(j);
            todo.push(j);
          }
        }
        expect(reached.size).toBe(plan.streets.size);
        for (const s of [1, -1]) {
          const out = [...plan.streets.keys()].filter((i) => g.rowOf(i) === cr + 3 * s);
          if (out.length === 2) seen.loop++;
          else if (out.length === 1) {
            seen.high++;
            if (g.colOf(out[0]) !== cc) seen.shifted++;
          }
        }
      }
    }
    expect(seen.loop).toBeGreaterThan(0);
    expect(seen.high).toBeGreaterThan(0);
    expect(seen.shifted).toBeGreaterThan(0);
  });
});

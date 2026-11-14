import { describe, expect, it } from "vitest";
import { CELL, FEAT_BUILDING, FEAT_STATION, generateLandscape, gridWithPlots, SURF_GRASS, SURF_ROAD } from "../landscape";
import { growTown, rowOpenings, startsBothSides, type GrowthStep } from "./grow-town";
import { encodeRoad, roadsJoin, type Edge } from "./pieces";

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

  it("gives the first buildings two squares when asked (wide: room for a landmark)", () => {
    const { g, town, canUse } = openSite();
    const steps = growTown(g, town, 6, { canUse, wide: 3 });
    expect(steps.slice(0, 3).map((s) => s.cells.length)).toEqual([2, 2, 2]);
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

describe("growTown keeps roads laid to a town joined", () => {
  it("a street square a road was laid up to keeps its end toward it as the town grows round it", () => {
    let checked = 0;
    for (const cc of [10, 13, 15, 18, 21]) {
      const { g, town, canUse } = openSite(cc);
      apply(g, growTown(g, town, 4, { canUse }));
      const nb = g.neighbours();
      // A road laid on at every street end: a straight on the open square its piece points at, joined to it.
      const laid: [number, number][] = [];
      for (let i = 0; i < g.cellCount; i++) {
        if (g.surface[i] !== SURF_ROAD) continue;
        for (let e = 0; e < 4; e++) {
          const j = nb[i * 4 + e];
          if (j === -1 || g.surface[j] !== SURF_GRASS || !roadsJoin(g.road[i], e as Edge, encodeRoad("straight", e & 1))) continue;
          g.setRoad(j, encodeRoad("straight", e & 1));
          laid.push([i, e]);
        }
      }
      // The town grows on (the roads' squares are lanes now: it keeps off them).
      apply(g, growTown(g, town, 30, { canUse }));
      for (const [i, e] of laid) {
        expect(roadsJoin(g.road[i], e as Edge, g.road[nb[i * 4 + e]]), `street ${i} still joins the road laid to it`).toBe(true);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(0);
  });
});

describe("growTown in rows (towns in rows: rows fill before the town spreads)", () => {
  const DIRS = [[1, 0], [0, 1], [-1, 0], [0, -1]] as const;
  type Site = ReturnType<typeof openSite>;
  /** Grow `n` buildings and put them on the grid and in the town's records, as the game does. */
  function grow(site: Site, n: number, rows: boolean) {
    const steps = growTown(site.g, site.town, n, { canUse: site.canUse, rows });
    apply(site.g, steps);
    const buildings = site.town.buildings as { id: number; cells: number[]; kind: "house" | "shop"; floors: 1 | 2; front?: Edge }[];
    for (const s of steps) buildings.push({ id: buildings.length + 1, cells: s.cells, kind: "house", floors: 1, front: s.front });
    return steps;
  }
  /** For each building: does one stand on the square beside it along its street, facing the same way; or across the street? */
  function rowsOf(site: Site) {
    const g = site.g;
    const frontAt = new Map<number, Edge | undefined>();
    for (const b of site.town.buildings as { cells: number[]; front?: Edge }[]) for (const c of b.cells) frontAt.set(c, b.front);
    const at = (i: number, e: number, k = 1) => g.index(g.colOf(i) + DIRS[e][0] * k, g.rowOf(i) + DIRS[e][1] * k);
    return (site.town.buildings as { cells: number[]; front?: Edge }[]).map((b) => {
      const f = b.front!;
      const joins = b.cells.some((c) => [(f + 1) & 3, (f + 3) & 3].some((p) => !b.cells.includes(at(c, p)) && frontAt.has(at(c, p)) && frontAt.get(at(c, p)) === f));
      const faces = b.cells.some((c) => frontAt.has(at(c, f, 2)));
      return { joins, faces };
    });
  }

  it("without rows, grows exactly as it did (the same steps as before rows were added)", () => {
    const { g, town, canUse } = openSite();
    const steps = growTown(g, town, 30, { canUse });
    expect(steps.map((s) => `${s.cells.join("+")}>${s.front}${s.corner ? "c" : ""}/${s.streets.map(([i, r]) => `${i}:${r}`).join(",")}/${s.changes.map((c) => `${c.id}${c.kind ?? ""}${c.floors ?? ""}`).join(",")}`).join(" ")).toMatchInlineSnapshot(`"325+324>3/417:1,418:1,419:1,293:1,294:1,295:1/ 263>1// 262>1// 449+448>3// 326>3/292:1,416:1/ 327>3/264:65,295:66,233:65,296:1,295:131/-2shop 265>1c// 232>0//-4shop 234>2/297:1/ 328>3//-7shop 266>1/202:65,298:1/ 323>3//-9shop 231>2/261:65,292:130,230:65/ 260>0//-3shop 259>3/229:1,230:2,228:1,199:65,230:67/-32 197>1/227:1/-11shop 450>3// 451>3/420:1/-17shop 452>3/389:65,420:66,421:1,420:131/ 390>1c/422:1/-13shop 291>0//-22 447>3// 446>3/385:65,416:130,415:1,416:131/ 445>3/414:1/-22shop 383>1/413:1/ 384>0c//-25shop 329>3//-12 235>0/267:65,298:66,236:65/-26shop 268>2// 391>1/205:65,237:1,236:195/-27shop"`);
    const b = openSite(10, 8);
    expect(growTown(b.g, b.town, 20, { canUse: b.canUse }).map((s) => s.cells.join("+")).join(" ")).toMatchInlineSnapshot(`"351+350 352 291 292 354 349 348 347 285 286 293 294 295 355 227 226 164 133 135+166 167"`);
  });

  it("the first six buildings stand together: each joins a row or faces one, none alone", () => {
    const site = openSite();
    grow(site, 6, true);
    const r = rowsOf(site);
    // (One may be the first of a new row by Station Road: a town that starts on both sides of its station.)
    expect(r.filter((b) => !b.joins && !b.faces).length).toBeLessThanOrEqual(1);
    expect(r.filter((b) => b.joins).length).toBeGreaterThanOrEqual(4);
  });

  it("at fourteen buildings four in five join a neighbour along their street, and every one faces a street", () => {
    const site = openSite();
    const steps = grow(site, 14, true);
    expect(steps).toHaveLength(14);
    const r = rowsOf(site);
    expect(r.filter((b) => b.joins).length / r.length).toBeGreaterThanOrEqual(0.8);
    const g = site.g;
    for (const s of steps) for (const c of s.cells) expect(g.surface[g.index(g.colOf(c) + DIRS[s.front][0], g.rowOf(c) + DIRS[s.front][1])]).toBe(SURF_ROAD);
  });

  it("a row is three lots, then an opening", () => {
    const site = openSite();
    grow(site, 18, true);
    const g = site.g;
    const built = new Map<number, Edge | undefined>();
    for (const b of site.town.buildings as { cells: number[]; front?: Edge }[]) for (const c of b.cells) built.set(c, b.front);
    for (const [c, f] of built) {
      // The run of built squares through this one along its street, all facing it.
      const p = ((f! + 1) & 3) as Edge;
      let run = 1;
      for (const dir of [p, (p + 2) & 3]) for (let k = 1; built.get(g.index(g.colOf(c) + DIRS[dir][0] * k, g.rowOf(c) + DIRS[dir][1] * k)) === f && built.has(g.index(g.colOf(c) + DIRS[dir][0] * k, g.rowOf(c) + DIRS[dir][1] * k)); k++) run++;
      expect(run, `square ${c}`).toBeLessThanOrEqual(3);
    }
  });

  it("a town that grew as a scatter gets its next buildings beside the ones it has", () => {
    const site = openSite();
    grow(site, 12, false);
    const had = site.town.buildings.length;
    grow(site, 4, true);
    const r = rowsOf(site).slice(had);
    expect(r).toHaveLength(4);
    expect(r.every((b) => b.joins || b.faces)).toBe(true);
    // Nothing that stood has moved.
    expect((site.town.buildings as { cells: number[] }[]).slice(0, had).every((b) => b.cells.every((c) => site.g.feature[c] === FEAT_BUILDING))).toBe(true);
  });

  it("is the same every time, and finds its openings", () => {
    const a = openSite();
    const b = openSite();
    expect(grow(a, 16, true)).toEqual(grow(b, 16, true));
    const open = rowOpenings(a.g, a.town);
    for (const i of open) {
      expect(a.g.feature[i]).not.toBe(FEAT_BUILDING);
      expect(a.g.surface[i]).toBe(SURF_GRASS);
    }
    expect(open.length).toBeGreaterThan(0);
    expect(rowOpenings(a.g, a.town)).toEqual(open);
  });
});

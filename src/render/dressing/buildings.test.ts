import { Box3, MeshStandardMaterial, type BufferGeometry, type Material } from "three";
import { beforeAll, describe, expect, it } from "vitest";
import { CELL, FEAT_STATION, generateLandscape, SURF_ROAD } from "../../landscape";
import type { Materials } from "../materials";
import type { Batcher } from "./batcher";
import { building, buildStation, STATION_ROOF_FLAT, buildTown, footprintOf, FURNITURE_CLEARANCE, SPECIAL_LOOKS, townFurniture, townGreens, townLooks, type Look, type PropKind } from "./buildings";
import { releaseBuilding } from "../../props/towns";
import { loadBlenderModels } from "../blender-models";
import { onFelt } from "./roads";

// The cars and the map's building parts are models (public/models): read from disk here.
beforeAll(() => loadBlenderModels());

/** A batch that only measures what is added to it. */
function measuring(): { b: Batcher; bounds: Box3; count: () => number } {
  const bounds = new Box3();
  let n = 0;
  const b = {
    add(_m: Material, g: BufferGeometry) {
      g.computeBoundingBox();
      bounds.union(g.boundingBox!);
      n++;
    },
  } as unknown as Batcher;
  return { b, bounds, count: () => n };
}

const mat = new MeshStandardMaterial();
const mats = { lacquer: () => mat, blockWood: mat, naturalWood: mat } as unknown as Materials;
const SEEDS = Array.from({ length: 30 }, (_, i) => i * 37 + 5);

describe("townLooks", () => {
  it("gives every town a few special buildings, each kind at most once, and uses every kind somewhere", () => {
    const seen = new Set<Look>();
    for (const seed of SEEDS) {
      const land = generateLandscape(seed);
      for (const town of land.towns) {
        const looks = townLooks(land.seed, town);
        expect(looks).toEqual(townLooks(land.seed, town));
        const specials = looks.filter((l) => SPECIAL_LOOKS.includes(l));
        if (town.buildings.length >= 1) expect(specials.length).toBeGreaterThanOrEqual(1);
        if (town.buildings.length >= 4) expect(specials.length).toBeGreaterThanOrEqual(2);
        expect(new Set(specials).size).toBe(specials.length);
        looks.forEach((l, k) => {
          if (l === "terrace") expect(town.buildings[k].cells.length).toBeGreaterThan(1);
          seen.add(l);
        });
      }
    }
    for (const l of [...SPECIAL_LOOKS, "terrace", "house", "shop"] as Look[]) expect(seen).toContain(l);
  });
});

describe("special buildings", () => {
  it("stay within their footprint (plus the usual roof overhang)", () => {
    const fronts = [{ x: 1, z: 0 }, { x: -1, z: 0 }, { x: 0, z: 1 }, { x: 0, z: -1 }];
    for (const kind of [...SPECIAL_LOOKS, "terrace"] as Look[]) {
      for (const size of [{ w: 60, d: 60 }, { w: 132, d: 60 }, { w: 60, d: 132 }]) {
        for (const front of fronts) {
          for (const floors of [1, 2]) {
            const m = measuring();
            const box = { cx: 100, cz: -40, ...size };
            const doors = building(m.b, mats, box, { floors, kind, roof: 1, seed: 3, front });
            expect(m.count()).toBeGreaterThan(5);
            expect(doors.length).toBeGreaterThanOrEqual(1);
            const slack = 6 + 1.6;
            expect(m.bounds.min.x).toBeGreaterThanOrEqual(box.cx - box.w / 2 - slack);
            expect(m.bounds.max.x, `${kind} ${JSON.stringify(size)} ${JSON.stringify(front)}`).toBeLessThanOrEqual(box.cx + box.w / 2 + slack);
            expect(m.bounds.min.z).toBeGreaterThanOrEqual(box.cz - box.d / 2 - slack);
            expect(m.bounds.max.z).toBeLessThanOrEqual(box.cz + box.d / 2 + slack);
            for (const p of doors) {
              expect(Math.abs(p.x - box.cx)).toBeLessThanOrEqual(box.w / 2 + 0.01);
              expect(Math.abs(p.z - box.cz)).toBeLessThanOrEqual(box.d / 2 + 0.01);
            }
          }
        }
      }
    }
  });
});

describe("townFurniture", () => {
  it("stands only on the town's road squares, clear of the open country, the station, doors and each other", () => {
    const kinds = new Set<PropKind>();
    for (const seed of SEEDS) {
      const land = generateLandscape(seed);
      const g = land.grid;
      for (const town of land.towns) {
        const looks = townLooks(land.seed, town);
        const doors = town.buildings.flatMap((bld, k) => {
          const fp = footprintOf(land, town, bld.cells, looks[k]);
          return building(measuring().b, mats, fp, { floors: bld.floors, kind: looks[k], roof: bld.roof, seed: 1, front: fp.front });
        });
        const own = new Set(town.cells);
        const props = townFurniture(land, town, doors);
        expect(props).toEqual(townFurniture(land, town, doors));
        for (const p of props) {
          kinds.add(p.kind);
          const i = g.cellAtWorld(p.x, p.z);
          expect(own.has(i) && g.surface[i] === SURF_ROAD).toBe(true);
          // On the pavement, never out on the street's felt (where cars drive): its middle and a ring round it.
          for (const [dx, dz] of [[0, 0], [3, 0], [-3, 0], [0, 3], [0, -3]]) {
            const j = g.cellAtWorld(p.x + dx, p.z + dz);
            expect(onFelt(g.road[j], p.x + dx - g.centreX(g.colOf(j)), p.z + dz - g.centreZ(g.rowOf(j))), `${p.kind} on the felt`).toBe(false);
          }
          // Nothing within the clearance of a square outside the town or of the station.
          for (let dr = -1; dr <= 1; dr++) {
            for (let dc = -1; dc <= 1; dc++) {
              const col = g.colOf(i) + dc;
              const row = g.rowOf(i) + dr;
              const j = g.inBounds(col, row) ? g.index(col, row) : -1;
              if (j !== -1 && own.has(j) && g.feature[j] !== FEAT_STATION) continue;
              const ex = Math.max(Math.abs(p.x - g.centreX(col)) - CELL / 2, 0);
              const ez = Math.max(Math.abs(p.z - g.centreZ(row)) - CELL / 2, 0);
              expect(Math.hypot(ex, ez)).toBeGreaterThanOrEqual(FURNITURE_CLEARANCE);
            }
          }
          for (const d of doors) expect(Math.hypot(d.x - p.x, d.z - p.z)).toBeGreaterThan(10);
        }
        for (let a = 0; a < props.length; a++) for (let c = a + 1; c < props.length; c++) expect(Math.hypot(props[a].x - props[c].x, props[a].z - props[c].z)).toBeGreaterThan(6);
      }
    }
    for (const k of ["lamp", "bench", "planter", "postbox", "phone", "busstop", "fountain", "statue"] as PropKind[]) expect(kinds).toContain(k);
    // 30 maps, every town's houses measured: about 4 s alone, more while the rest of the suite runs alongside.
  }, 30_000);

  it("builds towns' street furniture and stations (the buildings are props now)", () => {
    const land = generateLandscape(7);
    for (const town of land.towns) {
      const m = measuring();
      expect(buildTown(land, town, mats, m.b)).toEqual([]);
      buildStation(town, mats, m.b);
      expect(m.count()).toBeGreaterThan(50);
    }
  });
});

describe("town greens (QA: N7)", () => {
  it("a square a house left is a green, drawn as a low lawn on it: a fresh town has none", () => {
    const land = generateLandscape(SEEDS[0]);
    const town = land.towns.find((t) => t.buildings.some((b) => b.cells.length === 1 && !b.landmark))!;
    expect(townGreens(land, town)).toEqual([]);
    // (The rows' paved openings aside: they have a test of their own.)
    const before = measuring();
    buildTown(land, town, mats, before.b, false);
    const house = town.buildings.find((b) => b.cells.length === 1 && !b.landmark)!;
    const cell = house.cells[0];
    releaseBuilding(land, house.id);
    expect(townGreens(land, town)).toEqual([cell]);
    const after = measuring();
    buildTown(land, town, mats, after.b, false);
    // A lawn and twelve flowers, within the square and no higher than a few mm above the ground.
    expect(after.count() - before.count()).toBe(13);
    const g = land.grid;
    const lawn = measuring();
    buildTown(land, { ...town, cells: [cell], buildings: [] }, mats, lawn.b, false);
    const box = lawn.bounds;
    expect(box.min.x).toBeGreaterThanOrEqual(g.centreX(g.colOf(cell)) - CELL / 2);
    expect(box.max.x).toBeLessThanOrEqual(g.centreX(g.colOf(cell)) + CELL / 2);
    expect(box.max.y - g.groundY(cell)).toBeLessThan(5);
  });
});

describe("row openings (towns in rows)", () => {
  /** A town with a house in the middle of a row, and that house's square. */
  function rowWithMiddle() {
    for (const seed of SEEDS) {
      const land = generateLandscape(seed);
      const g = land.grid;
      for (const town of land.towns) {
        const frontAt = new Map<number, number | undefined>();
        for (const b of town.buildings) for (const c of b.cells) frontAt.set(c, b.front);
        for (const b of town.buildings) {
          if (b.cells.length !== 1 || b.front === undefined || b.landmark) continue;
          const c = b.cells[0];
          const along = b.front % 2 === 0 ? [[0, 1], [0, -1]] : [[1, 0], [-1, 0]];
          if (along.every(([dc, dr]) => frontAt.get(g.index(g.colOf(c) + dc, g.rowOf(c) + dr)) === b.front)) return { land, town, house: b, cell: c };
        }
      }
    }
    throw new Error("no town with three houses in a row in these seeds");
  }

  it("an opening between two houses of a row is a small paved place; off, or once a street leaves through it, nothing", () => {
    const { land, town, house, cell } = rowWithMiddle();
    const g = land.grid;
    // (The town's other openings, before this one: what it's counted against.)
    const count = (rows: boolean) => {
      const m = measuring();
      buildTown(land, { ...town, cells: [cell] }, mats, m.b, rows);
      return m.count();
    };
    const others = count(true) - count(false);
    // The house gone, its square bare grass again: an opening in the row.
    town.buildings.splice(town.buildings.indexOf(house), 1);
    g.feature[cell] = 0;
    g.owner[cell] = -1;
    g.surface[cell] = 0;
    const off = measuring();
    buildTown(land, { ...town, cells: [cell] }, mats, off.b, false);
    const on = measuring();
    buildTown(land, { ...town, cells: [cell] }, mats, on.b, true);
    expect(on.count() - off.count()).toBe(others + 1);
    // Flat pavement and nothing standing on it: the player's track or a prop may go there (the dressing can't know).
    const slab = measuring();
    buildTown(land, { ...town, cells: [], buildings: town.buildings.filter((x) => x.cells.some((c) => Math.abs(g.colOf(c) - g.colOf(cell)) + Math.abs(g.rowOf(c) - g.rowOf(cell)) === 1)) }, mats, slab.b, true);
    expect(slab.bounds.max.y - g.groundY(cell)).toBeLessThanOrEqual(2.5);
    expect(slab.bounds.max.x - slab.bounds.min.x).toBeLessThanOrEqual(CELL + 0.01);
    const place = measuring();
    buildTown(land, { ...town, cells: [], station: town.station }, mats, place.b, true);
    const none = measuring();
    buildTown(land, { ...town, cells: [], station: town.station }, mats, none.b, false);
    expect(place.count() - none.count()).toBe(on.count() - off.count());
    // A street through it: an opening no more.
    g.surface[cell] = SURF_ROAD;
    const street = measuring();
    buildTown(land, { ...town, cells: [cell] }, mats, street.b, true);
    const streetOff = measuring();
    buildTown(land, { ...town, cells: [cell] }, mats, streetOff.b, false);
    expect(street.count() - streetOff.count()).toBe(others);
  });
});

describe("the station house in the rows' style", () => {
  /** What `buildStation` adds, by a material's name. */
  function parts(rows: boolean) {
    const land = generateLandscape(7);
    const town = land.towns[0];
    const wood = new MeshStandardMaterial({ name: "wood" });
    const added: { paint: string; box: Box3 }[] = [];
    const named = { lacquer: (c: string) => new MeshStandardMaterial({ name: c }), blockWood: wood, naturalWood: wood } as unknown as Materials;
    const b = {
      add(m: Material, g: BufferGeometry) {
        g.computeBoundingBox();
        added.push({ paint: m.name, box: g.boundingBox!.clone() });
      },
    } as unknown as Batcher;
    buildStation(town, named, b, rows);
    return added;
  }
  const tall = (p: { box: Box3 }) => p.box.max.y - p.box.min.y;

  it("has painted walls and a hipped roof in place of the bare block and its flat lid; nothing stands higher than before", () => {
    const now = parts(false);
    const rows = parts(true);
    // Today: the house is a bare wooden block, 46 tall.
    expect(now.some((p) => p.paint === "wood" && Math.abs(tall(p) - 46) < 0.01)).toBe(true);
    expect(rows.some((p) => p.paint === "wood" && Math.abs(tall(p) - 46) < 0.01)).toBe(false);
    // In rows: cream walls, 46 tall, and a roof that slopes (taller than the flat lid's 5).
    expect(rows.some((p) => p.paint === "#f3e7cb" && Math.abs(tall(p) - 46) < 0.01)).toBe(true);
    const top = (list: typeof now) => Math.max(...list.map((p) => p.box.max.y));
    expect(top(rows)).toBeLessThanOrEqual(top(now) + 0.01);
    expect(rows.length).toBeGreaterThanOrEqual(now.length);
  });

  it("the roof's flat top is long enough for the town's sign to stand on: its posts are 28 either side of the middle, 2.4 thick", () => {
    const roofs = parts(true).filter((p) => p.box.max.y > 64 && p.box.max.y - p.box.min.y > 6 && p.box.max.y - p.box.min.y < 12);
    expect(roofs).toHaveLength(1);
    // (Measured on the roof's own geometry: how far its top face reaches along the station.)
    expect(STATION_ROOF_FLAT / 2).toBeGreaterThanOrEqual(28 + 2.4);
  });

  it("is how a station is drawn unless told otherwise", () => {
    const land = generateLandscape(7);
    const a = measuring();
    const b = measuring();
    buildStation(land.towns[0], mats, a.b);
    buildStation(land.towns[0], mats, b.b, true);
    expect(b.count()).toBe(a.count());
    expect(b.bounds).toEqual(a.bounds);
  });
});

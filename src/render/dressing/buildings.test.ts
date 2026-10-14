import { Box3, MeshStandardMaterial, type BufferGeometry, type Material } from "three";
import { beforeAll, describe, expect, it } from "vitest";
import { CELL, FEAT_STATION, generateLandscape, SURF_ROAD } from "../../landscape";
import type { Materials } from "../materials";
import type { Batcher } from "./batcher";
import { building, buildStation, buildTown, footprintOf, FURNITURE_CLEARANCE, SPECIAL_LOOKS, townFurniture, townLooks, type Look, type PropKind } from "./buildings";
import { loadBlenderModels } from "../blender-models";

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
  });

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

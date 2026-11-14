import { describe, expect, it } from "vitest";
import { buildStarterWorld, createWorld } from "../game/world";
import { FEAT_BUILDING, FEAT_NONE, SURF_TOWN } from "../landscape";
import { deserializeWorld, serializeWorld, type SaveData } from "../persist/save";
import { addTownProps, buildingCells, findBuilding, releaseBuilding, townProps } from "./towns";

describe("towns built from catalogue models", () => {
  it("every town building gets a model that fits its squares, standing on them", () => {
    const w = createWorld(4242);
    const buildings = w.landscape.towns.flatMap((t) => t.buildings);
    expect(buildings.length).toBeGreaterThan(0);
    const byBuilding = new Map([...w.props.all()].filter((p) => p.building !== undefined).map((p) => [p.building!, p]));
    for (const b of buildings) {
      const p = byBuilding.get(b.id);
      expect(p, `building ${b.id}`).toBeDefined();
      // Standing on its own squares.
      // (A two-square building's middle is on the line between its squares: either side of it.)
      const g = w.landscape.grid;
      expect([g.cellAtWorld(p!.x - 1, p!.z - 1), g.cellAtWorld(p!.x + 1, p!.z + 1)].some((c) => b.cells.includes(c))).toBe(true);
      // Two-square buildings get two-square models.
      const two = ["bldg-terrace", "bldg-semi-detached", "bldg-villa", "bldg-cottage-row", "bldg-church", "bldg-post-office", "bldg-cafe", "bldg-apartment-block", "bldg-bakery"];
      if (b.cells.length > 1) expect(two, p!.asset).toContain(p!.asset);
    }
  });

  it("the same map gets the same town (deterministic), and adding again adds nothing", () => {
    const a = createWorld(77);
    const b = createWorld(77);
    expect([...a.props.all()]).toEqual([...b.props.all()]);
    expect(addTownProps(a.landscape, a.props)).toBe(0);
    expect(townProps(a.landscape, a.landscape.towns[0]).length).toBe(a.landscape.towns[0].buildings.length);
  });

  it("releasing a building frees its squares as street, and putting it back restores them", () => {
    const w = buildStarterWorld();
    const b = w.landscape.towns[0].buildings[0];
    const cells = [...b.cells];
    expect(buildingCells(w.landscape, b.id)).toEqual(cells);
    const back = releaseBuilding(w.landscape, b.id);
    for (const i of cells) {
      expect(w.landscape.grid.feature[i]).toBe(FEAT_NONE);
      expect(w.landscape.grid.surface[i]).toBe(SURF_TOWN);
    }
    expect(findBuilding(w.landscape, b.id)).toBeNull();
    back();
    for (const i of cells) expect(w.landscape.grid.feature[i]).toBe(FEAT_BUILDING);
    expect(findBuilding(w.landscape, b.id)?.building).toBe(b);
  });

  it("saves keep the links; saves from before town props get them on load", () => {
    const w = buildStarterWorld();
    const data = JSON.parse(JSON.stringify(serializeWorld(w))) as SaveData;
    const r = deserializeWorld(data);
    expect(r.ok && [...r.value.props.all()]).toEqual([...w.props.all()]);
    delete data.props;
    const old = deserializeWorld(data);
    expect(old.ok && old.value.props.size).toBe(w.landscape.towns.reduce((n, t) => n + t.buildings.length, 0));
  });
});

describe("colour variants", () => {
  it("turn strong colours round the wheel, and leave whites, blacks and glass alone", async () => {
    const { shiftHue } = await import("../render/props/library");
    expect(shiftHue("#c8442f", 1)).not.toBe("#c8442f");
    expect(shiftHue("#c8442f", 1)).not.toBe(shiftHue("#c8442f", 2));
    for (const c of ["#ffffff", "#f6f3ec", "#2a2b2e", "#2b3644", "#8d8f93"]) expect(shiftHue(c, 2)).toBe(c);
  });

  it("towns use more than one variant", () => {
    const w = createWorld(4242);
    const variants = new Set([...w.props.all()].map((p) => p.variant ?? 0));
    expect(variants.size).toBeGreaterThan(1);
  });
});

describe("buildings facing their street", () => {
  it("a building's front (from the town plan) decides which way its model faces", () => {
    const w = createWorld(4242);
    const town = w.landscape.towns.find((t) => t.buildings.some((b) => b.cells.length === 1))!;
    const k = town.buildings.findIndex((b) => b.cells.length === 1);
    for (const [edge, front] of [[0, { x: 1, z: 0 }], [3, { x: 0, z: -1 }]] as const) {
      town.buildings[k].front = edge;
      const t = townProps(w.landscape, town)[k];
      expect(Math.cos(t.heading)).toBeCloseTo(front.x);
      expect(Math.sin(t.heading)).toBeCloseTo(front.z);
    }
  });
});

describe("towns in rows", () => {
  const rowsWorld = (seed = 4242) => {
    const w = createWorld(seed);
    const before = [...w.props.all()].map((p) => ({ ...p }));
    addTownProps(w.landscape, w.props, undefined, true);
    return { w, before };
  };
  const KEPT = /^(bldg-church|bldg-ice-cream-kiosk|bldg-fire-station|bldg-police-station|bldg-town-hall|bldg-hospital|bldg-school|bldg-market-hall|bldg-library|bldg-college|scene-)/;

  it("off, a town is dressed as it always was", () => {
    const a = createWorld(4242);
    const b = createWorld(4242);
    addTownProps(b.landscape, b.props, undefined, false);
    expect([...b.props.all()]).toEqual([...a.props.all()]);
    expect([...a.props.all()].some((p) => p.asset.startsWith("row-"))).toBe(false);
  });

  it("every house and shop becomes its row, the same prop on the same squares, on its lot's middle", async () => {
    const { rowFor } = await import("./rows");
    const { w, before } = rowsWorld();
    const g = w.landscape.grid;
    let rows = 0;
    for (const old of before) {
      if (old.building === undefined) continue;
      const p = w.props.get(old.id)!;
      expect(p, `prop ${old.id}`).toBeDefined();
      expect(p.building).toBe(old.building);
      expect(p.storeys).toBe(old.storeys);
      if (!rowFor(old.asset)) {
        expect(p).toEqual(old);
        expect(old.asset).toMatch(KEPT);
        continue;
      }
      rows++;
      expect(p.asset).toMatch(/^row-/);
      // (Its colour number is the one it had: a saved house keeps one steady colour.)
      expect(p.variant ?? 0).toBe(old.variant ?? 0);
      const { town, building } = findBuilding(w.landscape, p.building!)!;
      const cx = building.cells.reduce((a, c) => a + g.centreX(g.colOf(c)), 0) / building.cells.length;
      const cz = building.cells.reduce((a, c) => a + g.centreZ(g.rowOf(c)), 0) / building.cells.length;
      if (building.cells.length < 4) {
        expect(p.x).toBeCloseTo(cx);
        expect(p.z).toBeCloseTo(cz);
      }
      // Facing its street: the square before its front is a street's.
      if (building.front !== undefined && building.cells.length === 1) {
        const ahead = g.cellAtWorld(p.x + Math.cos(p.heading) * 72, p.z + Math.sin(p.heading) * 72);
        expect(g.road[ahead] !== 0 || g.surface[ahead] === 2, `building ${building.id} of ${town.name}`).toBe(true);
      }
      if (building.cells.length === 2) expect(["row-terrace", "row-bakery", "row-cafe", "row-post", "row-flats"]).toContain(p.asset);
    }
    expect(rows).toBeGreaterThan(10);
    // Again: nothing more to do.
    const again = [...w.props.all()].map((p) => ({ ...p }));
    expect(addTownProps(w.landscape, w.props, undefined, true)).toBe(0);
    expect([...w.props.all()]).toEqual(again);
  });

  it("a new building takes a row in a colour none beside it has, the same every time", async () => {
    const { rowColours } = await import("./rows");
    const dress = () => {
      const w = createWorld(4242);
      for (const p of [...w.props.all()]) if (p.building !== undefined) w.props.remove(p.id);
      addTownProps(w.landscape, w.props, undefined, true);
      return w;
    };
    const w = dress();
    expect([...w.props.all()]).toEqual([...dress().props.all()]);
    const g = w.landscape.grid;
    const byBuilding = new Map([...w.props.all()].filter((p) => p.building !== undefined).map((p) => [p.building!, p]));
    let pairs = 0;
    for (const town of w.landscape.towns) {
      for (const b of town.buildings) {
        const p = byBuilding.get(b.id)!;
        if (!p.asset.startsWith("row-")) continue;
        for (const c of b.cells) {
          for (const [dc, dr] of [[1, 0], [0, 1]]) {
            const i = g.index(g.colOf(c) + dc, g.rowOf(c) + dr);
            const q = i === -1 || b.cells.includes(i) || g.feature[i] !== FEAT_BUILDING ? undefined : byBuilding.get(g.owner[i]);
            if (!q || !q.asset.startsWith("row-")) continue;
            pairs++;
            expect(rowColours(q.variant ?? 0).body, `${town.name}: ${b.id} beside ${q.building}`).not.toBe(rowColours(p.variant ?? 0).body);
          }
        }
      }
    }
    expect(pairs).toBeGreaterThan(3);
    // More than one house style and more than one roof in a town.
    const town = w.landscape.towns[0];
    const own = town.buildings.map((b) => byBuilding.get(b.id)!).filter((p) => p.asset.startsWith("row-"));
    expect(new Set(own.map((p) => rowColours(p.variant ?? 0).body)).size).toBeGreaterThan(2);
  });

  it("a building with no front faces the nearest street, else the station", async () => {
    const { rowFront } = await import("./towns");
    const w = createWorld(4242);
    const g = w.landscape.grid;
    const town = w.landscape.towns.find((t) => t.buildings.some((b) => b.cells.length === 1 && b.front !== undefined))!;
    const b = town.buildings.find((x) => x.cells.length === 1 && x.front !== undefined)!;
    const front = b.front!;
    delete b.front;
    const e = rowFront(w.landscape, town, b);
    const dirs = [[1, 0], [0, 1], [-1, 0], [0, -1]];
    const ahead = g.index(g.colOf(b.cells[0]) + dirs[e][0], g.rowOf(b.cells[0]) + dirs[e][1]);
    expect(g.road[ahead] !== 0 || g.surface[ahead] === 2).toBe(true);
    b.front = front;
    // No street near: toward the town's centre, along the axis it lies farther on.
    const far = { id: 99999, cells: [g.index(g.colOf(b.cells[0]) + 40, g.rowOf(b.cells[0]))], floors: 1 as const, kind: "house" as const, roof: 0 };
    if (far.cells[0] !== -1) expect(rowFront(w.landscape, town, far)).toBe(2);
  });
});

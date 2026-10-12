import { describe, expect, it } from "vitest";
import { buildStarterWorld, createWorld } from "../game/world";
import { FEAT_BUILDING, FEAT_NONE, SURF_ROAD } from "../landscape";
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
      expect(w.landscape.grid.surface[i]).toBe(SURF_ROAD);
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

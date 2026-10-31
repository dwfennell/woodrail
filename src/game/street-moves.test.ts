import { describe, expect, it } from "vitest";
import { buildStarterWorld } from "./world";
import { FEAT_BUILDING, FEAT_NONE, SURF_GRASS, SURF_ROAD, SURF_TOWN, type Landscape, type Town } from "../landscape";
import { LandEditor } from "../landscape/edit";
import { checkPlacement } from "../landscape/clearance";
import { releaseBuilding } from "../props/towns";
import { movableStreet, moveStreet, streetFor, type StreetLot } from "./street-moves";
import { nextLots } from "./town-growth";

const EDGES = [
  [1, 0],
  [0, 1],
  [-1, 0],
  [0, -1],
] as const;

const world = () => {
  const w = buildStarterWorld();
  return { w, land: w.landscape, editor: new LandEditor(w.landscape, w.layout, { inRect: () => false }) };
};

const nb = (land: Landscape, i: number, e: number) => land.grid.index(land.grid.colOf(i) + EDGES[e][0], land.grid.rowOf(i) + EDGES[e][1]);
const streetsOf = (land: Landscape, town: Town) => town.cells.filter((i) => land.grid.surface[i] === SURF_ROAD);

/** Every house of the town faces a street square. */
function housesFaceStreets(land: Landscape, town: Town): boolean {
  return town.buildings.every((b) => b.front === undefined || b.cells.some((i) => land.grid.surface[nb(land, i, b.front!)] === SURF_ROAD));
}

/** A town green made by letting a house by a street go, and a street square of that town that can move onto it. */
function greenAndStreet(land: Landscape, editor: LandEditor): { town: Town; green: number; from: number; lot: StreetLot } {
  const g = land.grid;
  for (const town of land.towns) {
    for (const b of [...town.buildings]) {
      if (b.cells.length !== 1 || b.landmark) continue;
      const i = b.cells[0];
      if (![0, 1, 2, 3].some((e) => g.surface[nb(land, i, e)] === SURF_ROAD)) continue;
      const undo = releaseBuilding(land, b.id);
      for (const from of streetsOf(land, town)) {
        const lot = streetFor(land, town, from, i, editor);
        if (typeof lot === "object" && from !== i && [0, 1, 2, 3].every((e) => nb(land, from, e) !== i)) return { town, green: i, from, lot };
      }
      undo();
    }
  }
  throw new Error("no green a street can move onto");
}

describe("moving a town's streets (Game mode, issue #18)", () => {
  it("a town's street square can be picked up; grass and houses can't", () => {
    const { land } = world();
    const town = land.towns[0];
    expect(movableStreet(land, streetsOf(land, town)[0])).toBe(true);
    const house = town.buildings[0].cells[0];
    expect(movableStreet(land, house)).toBe(false);
    const g = land.grid;
    let grass = -1;
    for (let i = 0; i < g.cellCount && grass === -1; i++) if (g.surface[i] === SURF_GRASS) grass = i;
    expect(movableStreet(land, grass)).toBe(false);
  });

  it("onto a green beside another street: the green becomes street, the old square a green; houses still face streets; undo puts it all back", () => {
    const { land, editor } = world();
    const { town, green, from, lot } = greenAndStreet(land, editor);
    const g = land.grid;
    const snap = { s: g.surface.slice(), r: g.road.slice(), f: g.feature.slice(), cells: [...town.cells], fronts: town.buildings.map((b) => b.front) };
    const undo = moveStreet(land, town, lot);
    expect(g.surface[green]).toBe(SURF_ROAD);
    expect(g.road[green]).not.toBe(0);
    expect([g.surface[from], g.road[from], g.feature[from]]).toEqual([SURF_TOWN, 0, FEAT_NONE]);
    expect(town.cells).toContain(green);
    expect(town.cells).toContain(from);
    expect(housesFaceStreets(land, town)).toBe(true);
    // Each house that faced the old square turned to face a street.
    for (const t of lot.turns) {
      const b = town.buildings.find((x) => x.id === t.id)!;
      expect(b.cells.some((i) => g.surface[nb(land, i, b.front!)] === SURF_ROAD)).toBe(true);
    }
    undo();
    expect(Array.from(g.surface)).toEqual(Array.from(snap.s));
    expect(Array.from(g.road)).toEqual(Array.from(snap.r));
    expect(Array.from(g.feature)).toEqual(Array.from(snap.f));
    expect(town.cells).toEqual(snap.cells);
    expect(town.buildings.map((b) => b.front)).toEqual(snap.fronts);
  });

  it("the square a street leaves takes track (a town green), and growth still builds, facing streets", () => {
    const { w, land, editor } = world();
    const { town, from, lot } = greenAndStreet(land, editor);
    const g = land.grid;
    // Before: a street square blocks track.
    const pose = { x: g.centreX(g.colOf(from)) - 27, z: g.centreZ(g.rowOf(from)), heading: 0 };
    expect(checkPlacement(land, "straight-54", false, pose, g.groundY(from)).kind).toBe("blocked");
    moveStreet(land, town, lot);
    const after = checkPlacement(land, "straight-54", false, pose, g.groundY(from));
    expect(after.kind === "blocked" ? after.reason : "clear").not.toBe("town");
    const lots = nextLots(land, town, new LandEditor(land, w.layout, { inRect: () => false }), 4);
    expect(lots.length).toBeGreaterThan(0);
    // (Each faces a street: one there now, or one growth lays for it or for a lot before it.)
    const laid = new Set(lots.flatMap((l) => (l.streets ?? []).map(([i]) => i)));
    for (const l of lots) if (l.front !== undefined) expect(l.cells.some((i) => g.surface[nb(land, i, l.front!)] === SURF_ROAD || laid.has(nb(land, i, l.front!)))).toBe(true);
  });

  it("a street a house faces with no other street beside it stays (move the house first)", () => {
    const { land, editor } = world();
    const g = land.grid;
    const { town, green } = greenAndStreet(land, editor);
    let checked = 0;
    for (const b of town.buildings) {
      if (b.front === undefined || b.cells.length !== 1) continue;
      const i = b.cells[0];
      const streets = [0, 1, 2, 3].filter((e) => g.surface[nb(land, i, e)] === SURF_ROAD);
      if (streets.length !== 1 || streets[0] !== b.front) continue;
      const faced = nb(land, i, b.front);
      // (Not beside the green: then it would turn to face the street's new square.)
      if (faced === -1 || [0, 1, 2, 3].some((e) => nb(land, i, e) === green)) continue;
      const r = streetFor(land, town, faced, green, editor);
      // (Or another rule refuses it first: it never moves.)
      expect(typeof r).toBe("string");
      if (r === "faces") checked++;
    }
    expect(checked).toBeGreaterThan(0);
  });

  it("refused: onto a house, another street, grass away from the town, track; or not joining a street", () => {
    const { land, editor } = world();
    const { town, green, from } = greenAndStreet(land, editor);
    const g = land.grid;
    const house = town.buildings.find((b) => !b.landmark)!.cells[0];
    expect(g.feature[house]).toBe(FEAT_BUILDING);
    expect(streetFor(land, town, from, house, editor)).toBe("building");
    expect(streetFor(land, town, from, streetsOf(land, town).find((i) => i !== from)!, editor)).toBe("street");
    let far = -1;
    for (let i = 0; i < g.cellCount && far === -1; i++) {
      if (g.surface[i] !== SURF_GRASS) continue;
      if (Math.hypot(g.centreX(g.colOf(i)) - town.centre.x, g.centreZ(g.rowOf(i)) - town.centre.z) > 1000) far = i;
    }
    expect(streetFor(land, town, from, far, editor)).toBe("not-town");
    expect(streetFor(land, town, from, green, { checkLot: () => "track" })).toBe("track");
    // No street beside the green but the one being moved: it would stand alone.
    for (let e = 0; e < 4; e++) {
      const j = nb(land, green, e);
      if (j !== -1 && g.surface[j] === SURF_ROAD) g.surface[j] = SURF_TOWN;
    }
    expect(streetFor(land, town, from, green, editor)).toBe("no-join");
  });

  it("is quick: a check over every square of a town is a few ms at most", () => {
    const { land, editor } = world();
    const { town, from } = greenAndStreet(land, editor);
    const g = land.grid;
    const squares: number[] = [];
    for (let i = 0; i < g.cellCount; i++) if (Math.hypot(g.centreX(g.colOf(i)) - town.centre.x, g.centreZ(g.rowOf(i)) - town.centre.z) < 600) squares.push(i);
    const t0 = performance.now();
    for (const i of squares) streetFor(land, town, from, i, editor);
    const per = (performance.now() - t0) / squares.length;
    expect(per).toBeLessThan(2);
  });
});

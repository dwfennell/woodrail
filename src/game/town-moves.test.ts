import { describe, expect, it } from "vitest";
import { buildStarterWorld } from "./world";
import { FEAT_BUILDING, FEAT_NONE, FEAT_STATION, SURF_GRASS, SURF_ROAD, SURF_TOWN, type Landscape, type Town } from "../landscape";
import { LandEditor } from "../landscape/edit";
import { looksOf, releaseBuilding } from "../props/towns";
import { lotFor, moveBuilding, movableBuilding, townMoveMessage, type TownLot } from "./town-moves";
import { MAX_REACH } from "./town-growth";
import { deserializeWorld, serializeWorld } from "../persist/save";
import { nextLots } from "./town-growth";

const world = () => {
  const w = buildStarterWorld();
  return { w, land: w.landscape, editor: new LandEditor(w.landscape, w.layout, { inRect: () => false }) };
};

/** A town with at least two one-square houses (not landmarks). */
function houses(land: Landscape): { town: Town; a: number; b: number } {
  for (const town of land.towns) {
    const one = town.buildings.filter((b) => b.cells.length === 1 && !b.landmark);
    if (one.length >= 2) return { town, a: one[0].id, b: one[1].id };
  }
  throw new Error("no town with two houses");
}

/** A town green beside a street, made by letting a house go (as Sandbox does): a free lot to move another onto. */
function green(land: Landscape, town: Town, not: number[]): number {
  const g = land.grid;
  for (const b of town.buildings) {
    if (not.includes(b.id) || b.cells.length !== 1 || b.landmark) continue;
    const i = b.cells[0];
    const byStreet = [-1, 1].some((d) => g.surface[g.index(g.colOf(i) + d, g.rowOf(i))] === SURF_ROAD || g.surface[g.index(g.colOf(i), g.rowOf(i) + d)] === SURF_ROAD);
    if (!byStreet) continue;
    releaseBuilding(land, b.id);
    return i;
  }
  throw new Error("no house by a street to clear");
}

describe("moving a town's houses (Game mode)", () => {
  it("a house can be moved; a landmark can't", () => {
    const { land } = world();
    const { town, a } = houses(land);
    expect(movableBuilding(land, a)).toBe(true);
    town.buildings.find((b) => b.id === a)!.landmark = "school";
    expect(movableBuilding(land, a)).toBe(false);
    expect(movableBuilding(land, undefined)).toBe(false);
  });

  it("swaps places with another house of its town and its size: records, grid owners and looks; undo puts them back", () => {
    const { land, editor } = world();
    const { town, a, b } = houses(land);
    const A = town.buildings.find((x) => x.id === a)!;
    const B = town.buildings.find((x) => x.id === b)!;
    const [ca, cb] = [A.cells[0], B.cells[0]];
    const looks = looksOf(land, town);
    const lot = lotFor(land, a, cb, editor) as TownLot;
    expect(lot).toMatchObject({ cells: [cb], swap: b });
    const undo = moveBuilding(land, a, lot);
    expect(A.cells).toEqual([cb]);
    expect(B.cells).toEqual([ca]);
    expect(land.grid.owner[cb]).toBe(a);
    expect(land.grid.owner[ca]).toBe(b);
    expect([land.grid.feature[ca], land.grid.feature[cb]]).toEqual([FEAT_BUILDING, FEAT_BUILDING]);
    // The town's looks go by its list, which a move doesn't reorder.
    expect(looksOf(land, town)).toEqual(looks);
    undo();
    expect(A.cells).toEqual([ca]);
    expect(B.cells).toEqual([cb]);
    expect(land.grid.owner[ca]).toBe(a);
    expect(land.grid.owner[cb]).toBe(b);
  });

  it("moves onto a free town green by a street: its old square becomes a green, the new one its own, facing the street", () => {
    const { land, editor } = world();
    const { town, a, b } = houses(land);
    const free = green(land, town, [a, b]);
    const A = town.buildings.find((x) => x.id === a)!;
    const old = A.cells[0];
    const lot = lotFor(land, a, free, editor) as TownLot;
    expect(lot.swap).toBeUndefined();
    expect(lot.cells).toEqual([free]);
    expect(lot.front).not.toBeUndefined();
    const g = land.grid;
    const n = town.buildings.length;
    const undo = moveBuilding(land, a, lot);
    expect(A.cells).toEqual([free]);
    expect([g.feature[free], g.owner[free]]).toEqual([FEAT_BUILDING, a]);
    expect([g.feature[old], g.owner[old], g.surface[old]]).toEqual([FEAT_NONE, -1, SURF_TOWN]);
    // Still the town's: the green it left, and its own count.
    expect(town.buildings.length).toBe(n);
    expect(lotFor(land, b, old, editor)).toMatchObject({ cells: [old] });
    undo();
    expect(A.cells).toEqual([old]);
    expect([g.feature[old], g.owner[old]]).toEqual([FEAT_BUILDING, a]);
    expect([g.feature[free], g.owner[free]]).toEqual([FEAT_NONE, -1]);
  });

  it("stays in its town: not onto another town's houses, its station, or grass outside it", () => {
    const { land, editor } = world();
    const { town, a } = houses(land);
    const other = land.towns.find((t) => t !== town && t.buildings.some((b) => !b.landmark))!;
    expect(lotFor(land, a, other.buildings.find((b) => !b.landmark)!.cells[0], editor)).toBe("other-town");
    const g = land.grid;
    const station = town.cells.find((i) => g.feature[i] === FEAT_STATION)!;
    expect(lotFor(land, a, station, editor)).toBe("station");
    let grass = -1;
    for (let i = 0; i < g.cellCount && grass === -1; i++) if (g.surface[i] === SURF_GRASS && g.feature[i] === FEAT_NONE) grass = i;
    expect(lotFor(land, a, grass, editor)).toBe("not-town");
  });

  it("a green with track or a prop on it, or with no street beside it, is refused (as town growth would)", () => {
    const { land } = world();
    const { town, a, b } = houses(land);
    const free = green(land, town, [a, b]);
    const blocked = { checkLot: () => "track" as const };
    expect(lotFor(land, a, free, blocked)).toBe("track");
    // No street beside: the green's streets made grass.
    const g = land.grid;
    for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nb = g.index(g.colOf(free) + dc, g.rowOf(free) + dr);
      if (nb !== -1 && g.surface[nb] === SURF_ROAD) g.surface[nb] = SURF_TOWN;
    }
    expect(lotFor(land, a, free, { checkLot: () => null })).toBe("no-street");
  });

  it("two-square houses swap with each other, not with a one-square house", () => {
    const { land, editor } = world();
    let done = false;
    for (const town of land.towns) {
      const two = town.buildings.filter((b) => b.cells.length === 2 && !b.landmark);
      const one = town.buildings.find((b) => b.cells.length === 1 && !b.landmark);
      if (two.length < 2 || !one) continue;
      const [A, B] = two;
      const [ca, cb] = [A.cells, B.cells];
      expect(lotFor(land, A.id, one.cells[0], editor)).toBe("size");
      const lot = lotFor(land, A.id, cb[1], editor) as TownLot;
      expect(lot).toMatchObject({ cells: cb, swap: B.id });
      const undo = moveBuilding(land, A.id, lot);
      expect([A.cells, B.cells]).toEqual([cb, ca]);
      for (const i of cb) expect(land.grid.owner[i]).toBe(A.id);
      undo();
      expect([A.cells, B.cells]).toEqual([ca, cb]);
      done = true;
      break;
    }
    expect(done).toBe(true);
  });

  it("moves onto grass at the town's edge beside a street: the square joins the town; the lot it left is a green", () => {
    const { land, editor } = world();
    const g = land.grid;
    for (const town of land.towns) {
      const house = town.buildings.find((b) => b.cells.length === 1 && !b.landmark);
      if (!house) continue;
      for (let i = 0; i < g.cellCount; i++) {
        if (g.surface[i] !== SURF_GRASS || g.feature[i] !== FEAT_NONE) continue;
        const lot = lotFor(land, house.id, i, editor);
        if (typeof lot === "string") continue;
        const old = house.cells[0];
        const n = town.cells.length;
        const undo = moveBuilding(land, house.id, lot);
        expect(town.cells).toContain(i);
        expect([g.surface[i], g.feature[i], g.owner[i]]).toEqual([SURF_TOWN, FEAT_BUILDING, house.id]);
        expect([g.surface[old], g.feature[old]]).toEqual([SURF_TOWN, FEAT_NONE]);
        undo();
        expect(town.cells.length).toBe(n);
        expect([g.surface[i], g.feature[i]]).toEqual([SURF_GRASS, FEAT_NONE]);
        return;
      }
    }
    throw new Error("no edge square found");
  });

  it("houses pushed out toward a depot don't box a town in: growth still finds as many lots", () => {
    const { w, land, editor } = world();
    const g = land.grid;
    const depots = land.depots.map((d) => d.centre);
    const near = (i: number) => Math.min(...depots.map((d) => Math.hypot(g.centreX(g.colOf(i)) - d.x, g.centreZ(g.rowOf(i)) - d.z)));
    let moved = 0;
    for (const town of land.towns) {
      const before = nextLots(land, town, editor, 8).length;
      expect(before).toBe(8);
      // Six of its houses, each moved onto the edge square nearest a depot that will take it.
      const reach = (i: number) => Math.hypot(g.centreX(g.colOf(i)) - town.centre.x, g.centreZ(g.rowOf(i)) - town.centre.z) <= MAX_REACH;
      for (const house of town.buildings.filter((b) => b.cells.length === 1 && !b.landmark).slice(0, 6)) {
        const fresh = new LandEditor(land, w.layout, { inRect: () => false });
        const squares = [...Array(g.cellCount).keys()].filter((i) => g.surface[i] === SURF_GRASS && g.feature[i] === FEAT_NONE && reach(i)).sort((a, b) => near(a) - near(b));
        for (const i of squares) {
          const lot = lotFor(land, house.id, i, fresh);
          if (typeof lot === "string") continue;
          moveBuilding(land, house.id, lot);
          moved++;
          break;
        }
      }
      const after = nextLots(land, town, new LandEditor(land, w.layout, { inRect: () => false }), 8).length;
      expect(after).toBe(before);
    }
    // (Most towns had houses to move out.)
    expect(moved).toBeGreaterThanOrEqual(12);
  });

  it("not up on a step beside its street (QA: N4), and a two-square house faces its street along its long side (N6)", () => {
    const { land, editor } = world();
    const { town, a, b } = houses(land);
    const free = green(land, town, [a, b]);
    expect(lotFor(land, a, free, editor)).toMatchObject({ cells: [free] });
    land.grid.height[free] += 1;
    expect(lotFor(land, a, free, editor)).toBe("uneven");
    land.grid.height[free] -= 1;
    // Every lot offered to a two-square house: its street on a long side.
    const g = land.grid;
    let seen = 0;
    for (const t of land.towns)
      for (const two of t.buildings.filter((x) => x.cells.length === 2 && !x.landmark))
        for (let i = 0; i < g.cellCount; i++) {
          const r = lotFor(land, two.id, i, editor);
          if (typeof r === "string" || r.swap !== undefined || r.cells.length !== 2) continue;
          seen++;
          const alongX = g.rowOf(r.cells[0]) === g.rowOf(r.cells[1]);
          expect(alongX ? [1, 3] : [0, 2]).toContain(r.front);
        }
    expect(seen).toBeGreaterThan(0);
    // A green whose only street is at a two-square house's end: said so.
    expect(townMoveMessage("end-on")).toBe("The street must run along its long side");
  });

  it("a house's new place saves", () => {
    const { w, land, editor } = world();
    const { town, a, b } = houses(land);
    const cb = town.buildings.find((x) => x.id === b)!.cells[0];
    moveBuilding(land, a, lotFor(land, a, cb, editor) as TownLot);
    const r = deserializeWorld(JSON.parse(JSON.stringify(serializeWorld(w))));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const t = r.value.landscape.towns.find((x) => x.id === town.id)!;
    expect(t.buildings.find((x) => x.id === a)!.cells).toEqual([cb]);
    expect(r.value.landscape.grid.owner[cb]).toBe(a);
  });
});

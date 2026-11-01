import { describe, expect, it } from "vitest";
import type { CargoKind } from "../economy/cargo";
import { gridWithPlots, SURF_ROAD, type Landscape, type Town } from "../landscape";
import { deserializeWorld, serializeWorld } from "../persist/save";
import { encodeRoad, findTownLinks, joinedByRoad, setRoadSquare, townLinks } from "../roads";
import { StickerTracker } from "./stickers";
import { roadLine } from "./town-ledger";
import { growthOf, receivedBy, roadBonus, ROAD_BONUS_EVERY } from "./town-life";
import { townStatus } from "./towns";
import { buildStarterWorld, type World } from "./world";
import { roadBetween } from "./feeders-testing";
import { TownLife } from "./town-life";
import { loadFootprints } from "../props/footprints-testing";

/** Two towns of one street square each, in row 2: A at column 1, B at column 7, with grass between. */
function twoTowns(): Landscape {
  const grid = gridWithPlots(0, 0, 1, 1);
  const town = (id: number, col: number): Town => {
    const i = grid.index(col, 2);
    grid.surface[i] = SURF_ROAD;
    grid.road[i] = encodeRoad("straight", 0);
    return { id, name: id === 1 ? "Ashby" : "Fernby", centre: { x: 0, z: 0 }, station: { x: 0, z: 0, heading: 0 }, cells: [i], buildings: [] };
  };
  return { seed: 1, starter: false, grid, towns: [town(1, 1), town(2, 7)], depots: [], fields: [], shed: null, corridors: [], nextBuildingId: 0 };
}

/** Lay straights (as roads you laid: lanes) along row 2 from column `from` to `to`. */
function lay(land: Landscape, from: number, to: number): void {
  for (let c = from; c <= to; c++) setRoadSquare(land.grid, land.grid.index(c, 2), encodeRoad("straight", 0));
  land.grid.touch();
}

describe("the road graph: towns joined by road (roads spec D2)", () => {
  it("two towns are joined once an unbroken road runs between their streets, and parted when a square goes", () => {
    const land = twoTowns();
    expect(findTownLinks(land).get(1)).toEqual([]);
    lay(land, 2, 5);
    expect(joinedByRoad(land, 1)).toBe(false);
    lay(land, 6, 6);
    expect(townLinks(land).get(1)).toEqual([2]);
    expect(townLinks(land).get(2)).toEqual([1]);
    setRoadSquare(land.grid, land.grid.index(4, 2), 0);
    land.grid.touch();
    expect(joinedByRoad(land, 1)).toBe(false);
  });

  it("only pieces that meet join: a straight turned across the way breaks the road", () => {
    const land = twoTowns();
    lay(land, 2, 6);
    setRoadSquare(land.grid, land.grid.index(4, 2), encodeRoad("straight", 1));
    land.grid.touch();
    expect(joinedByRoad(land, 1)).toBe(false);
  });

  it("is cached by the grid's revision: worked out again only after the land changes", () => {
    const land = twoTowns();
    lay(land, 2, 6);
    const a = townLinks(land);
    expect(townLinks(land)).toBe(a);
    land.grid.touch();
    expect(townLinks(land)).not.toBe(a);
  });

  it("no starter map comes with two towns already joined", () => {
    const w = buildStarterWorld();
    expect([...townLinks(w.landscape).values()].every((l) => l.length === 0)).toBe(true);
  });
});

/** Deliver `n` of `kind` to town `townId`'s station pile, as a crane does. */
function deliver(w: World, townId: number, kind: CargoKind, n: number): void {
  const d = w.economy.allDepots().find((x) => x.role === "town" && x.townId === townId)!;
  const put = (w.economy as unknown as { put(slot: { kind: "pile"; depotId: number; cargo: CargoKind }, kind: CargoKind): void }).put.bind(w.economy);
  for (let k = 0; k < n; k++) put({ kind: "pile", depotId: d.id, cargo: kind }, kind);
}

describe("linked towns grow a bit faster, credited as goods arrive", () => {
  it("of what a joined town receives, one in nine counts twice toward growing; nothing for a town alone", () => {
    const w = buildStarterWorld();
    const t = w.landscape.towns[0].id;
    let joined = false;
    w.economy.joinedByRoad = () => joined;
    deliver(w, t, "planks", 9);
    expect(roadBonus(w, t)).toEqual({});
    joined = true;
    deliver(w, t, "planks", 9);
    expect(ROAD_BONUS_EVERY).toBe(9);
    expect(receivedBy(w, t).planks).toBe(18);
    expect(roadBonus(w, t)).toEqual({ planks: 1 });
    expect(growthOf(w, t).planks).toBe(19);
  });

  it("a town joined by road reaches a level with about a tenth less; parted later, it keeps its level", () => {
    const w = buildStarterWorld();
    const t = w.landscape.towns[0].id;
    w.economy.joinedByRoad = () => true;
    // A hamlet wants 4 planks, a village 8 more: 12 in all. Joined, 11 do it (11 + 1 bonus).
    deliver(w, t, "planks", 11);
    expect(townStatus(receivedBy(w, t)).level).toBe(1);
    expect(townStatus(growthOf(w, t)).level).toBe(2);
    w.economy.joinedByRoad = () => false;
    deliver(w, t, "planks", 1);
    expect(townStatus(growthOf(w, t)).level).toBe(2);
  });

  it("what a town got while joined is saved with the world", () => {
    const w = buildStarterWorld();
    const t = w.landscape.towns[0].id;
    w.economy.joinedByRoad = () => true;
    deliver(w, t, "planks", 10);
    const back = deserializeWorld(JSON.parse(JSON.stringify(serializeWorld(w))));
    if (!back.ok) throw new Error(back.error);
    expect(back.value.economy.roadGot.get(t)).toEqual({ planks: 10 });
    // (None: not written.)
    expect("roadGot" in serializeWorld(buildStarterWorld())).toBe(false);
  });
});

describe("the town card's road line, and the sticker", () => {
  it("says which towns it's joined to", () => {
    const w = buildStarterWorld();
    const [a, b] = w.landscape.towns;
    expect(roadLine(w, a.id)).toBeNull();
    // (Joined as the road graph would find it: the cache stands in for a road laid between them.)
    const links = townLinks(w.landscape) as Map<number, number[]>;
    links.set(a.id, [b.id]);
    expect(roadLine(w, a.id)).toBe(`Joined by road to ${b.name}`);
    links.set(a.id, w.landscape.towns.slice(1).map((t) => t.id));
    expect(roadLine(w, a.id)).toMatch(/^Joined by road to .+, .+ and \d more$/);
  });

  it("\"On the road\" is earned once two towns are joined, checked when the land changes", () => {
    const w = buildStarterWorld();
    Object.assign(w, { landscape: twoTowns() });
    const tracker = new StickerTracker();
    const ctx = { coins: 0, counts: new Map(), learned: new Set<string>(), goalsDone: () => false };
    expect(tracker.update(w, ctx, 0).map((s) => s.id)).not.toContain("road-link");
    lay(w.landscape, 2, 6);
    expect(tracker.update(w, ctx, 0).map((s) => s.id)).toContain("road-link");
  });
});

describe("a town growing keeps its streets joined to roads laid to them", () => {
  it("Larkfield grows a level (a new street off the one the road joins): it's still joined to Elderwick", async () => {
    const w = buildStarterWorld();
    const a = w.landscape.towns.find((t) => t.name === "Larkfield")!;
    const b = w.landscape.towns.find((t) => t.name === "Elderwick")!;
    roadBetween(w, a, b).lay();
    const host = Object.assign(w, { footprintOf: await loadFootprints(["bldg"]), editLand: () => {}, propsChanged: () => {}, setSignBadge: () => {} });
    const life = new TownLife(host, { received: () => {}, grew: () => {} });
    life.reset();
    expect(townLinks(w.landscape).get(a.id)).toEqual([b.id]);
    const streets = () => a.cells.filter((i) => w.landscape.grid.surface[i] === SURF_ROAD).length;
    const before = streets();
    // (Planks reach Larkfield as from a train: the crane's own count.)
    for (let k = 0; k < 9; k++) w.economy.receive(a.id, "planks");
    life.update();
    expect(life.status(a.id).level).toBe(1);
    // (It grew new streets, one of them off the square the road joins: that square was reshaped.)
    expect(streets()).toBeGreaterThan(before);
    expect(townLinks(w.landscape).get(a.id)).toEqual([b.id]);
  });
});

import { describe, expect, it } from "vitest";
import { gridWithPlots, SURF_LANE, SURF_RIVER, SURF_ROAD } from "../landscape";
import { mergeProgress } from "../persist/progress-merge";
import { encodeRoad, ROAD_PIECES, setRoadSquare } from "../roads";
import { ROAD_GROUPS, shownGroups, trayTabs, type TrayItem } from "../ui/tray-catalogue";
import { Progress } from "./progress";
import { ROAD_COINS, ROAD_TECH, ownRoad, roadsAdded, roadShortText, roadsOnMap, roadsPrice, roadsSpare } from "./road-box";
import { ready, techOf, unlocksOf } from "./tech";
import { ruleOf } from "./things";

describe("the Roads branch (roads spec D1, D3, D4)", () => {
  it("Roads: tier 2, after Passengers, a village; 2 planks and 60 coins", () => {
    const t = techOf("roads")!;
    expect([t.branch, t.tier, t.needs, t.research]).toEqual(["roads", 2, ["passengers"], { goods: { planks: 2 }, coins: 60 }]);
    const p = Progress.fresh();
    expect(ready(p, "roads")).toBe(false);
    p.learned.add("passengers");
    expect(ready(p, "roads")).toBe(false);
    p.bestLevel = 1;
    expect(ready(p, "roads")).toBe(true);
  });

  it("Crossing gates (after Roads, 2 planks and 40 coins) and Road bridges (after Roads and Bridges)", () => {
    expect([techOf("road-crossings")!.needs, techOf("road-crossings")!.research]).toEqual([["roads"], { goods: { planks: 2 }, coins: 40 }]);
    expect([techOf("road-bridges")!.needs, techOf("road-bridges")!.research]).toEqual([["roads", "bridges"], { goods: { planks: 3 }, coins: 80 }]);
    // Delivery vans are built (D5: after Roads and Warehouses, 4 planks and 150 coins); buses too (D6: buses.test.ts).
    expect([techOf("vans")!.needs, techOf("vans")!.research]).toEqual([["roads", "warehouses"], { goods: { planks: 4 }, coins: 150 }]);
    expect(techOf("buses")!).toBeDefined();
  });

  it("the crossing styles come with Crossing gates now, not Scenery kit", () => {
    expect(unlocksOf("road-crossings").sort()).toEqual(["prop:mech-gated-crossing", "prop:mech-level-crossing"]);
    expect(unlocksOf("scenery")).not.toContain("prop:mech-level-crossing");
    const p = Progress.fresh();
    p.learned.add("scenery");
    expect(p.knows("prop:mech-level-crossing")).toBe(false);
    p.learned.add("road-crossings");
    expect(p.knows("prop:mech-level-crossing")).toBe(true);
    expect(ruleOf("prop:mech-gated-crossing")?.free).toBe(true);
  });

  it("every road piece names its blueprint: the plain ones Roads, the zebra Crossing gates, bridge and ramps Road bridges", () => {
    for (const def of ROAD_PIECES) expect(techOf(ROAD_TECH[def.id]), def.id).toBeDefined();
    expect([ROAD_TECH.zebra, ROAD_TECH.bridge, ROAD_TECH["ramp-low"], ROAD_TECH["ramp-high"]]).toEqual(["road-crossings", "road-bridges", "road-bridges", "road-bridges"]);
  });
});

describe("the Roads tab in Game mode", () => {
  it("is on Game mode's tray, needing Roads; Sandbox's needs nothing", () => {
    const game = trayTabs("game").find((t) => t.id === "roads");
    expect(game?.gameTech).toBe("roads");
    expect(trayTabs("sandbox").some((t) => t.id === "roads")).toBe(true);
  });

  it("shows the zebra, bridge and ramp only once their blueprints are learned", () => {
    const learned = new Set(["roads"]);
    const known = (i: TrayItem) => i.kind !== "road" || learned.has(ROAD_TECH[i.piece]);
    const labels = () => shownGroups(ROAD_GROUPS, known).flatMap((g) => g.items.map((i) => i.label));
    expect(labels()).toEqual(["Road", "Straight", "Bend", "T-junction", "Crossroads", "Dead end"]);
    learned.add("road-crossings");
    expect(labels()).toContain("Zebra crossing");
    learned.add("road-bridges");
    expect(labels()).toEqual(expect.arrayContaining(["Road bridge", "Ramp"]));
  });
});

describe("road squares bought with coins (road-box.ts)", () => {
  const grid = () => gridWithPlots(0, 0, 1, 1);

  it("counts your roads (lanes, laid roads, road bridges), never a town's streets; cached until the grid changes", () => {
    const g = grid();
    expect(roadsOnMap(g)).toBe(0);
    setRoadSquare(g, g.index(1, 1), encodeRoad("straight", 0));
    setRoadSquare(g, g.index(2, 1), encodeRoad("straight", 0));
    g.touch();
    expect(roadsOnMap(g)).toBe(2);
    // A town's street.
    g.surface[g.index(3, 1)] = SURF_ROAD;
    g.road[g.index(3, 1)] = encodeRoad("straight", 0);
    // A road bridge over a river.
    g.surface[g.index(4, 1)] = SURF_RIVER;
    setRoadSquare(g, g.index(4, 1), encodeRoad("bridge", 0));
    // (Not counted again until the grid says it changed.)
    expect(roadsOnMap(g)).toBe(2);
    g.touch();
    expect(roadsOnMap(g)).toBe(3);
    expect([ownRoad(g, g.index(1, 1)), ownRoad(g, g.index(3, 1)), ownRoad(g, g.index(4, 1))]).toEqual([true, false, true]);
    expect(g.surface[g.index(1, 1)]).toBe(SURF_LANE);
  });

  it("an edit adds the squares going from none to a road, less your roads taken up; a move or reshape adds none", () => {
    const g = grid();
    const a = g.index(1, 1);
    const b = g.index(2, 1);
    expect(roadsAdded(g, [[a, encodeRoad("straight", 0)]])).toBe(1);
    setRoadSquare(g, a, encodeRoad("straight", 0));
    expect(roadsAdded(g, [[a, 0], [b, encodeRoad("straight", 0)]])).toBe(0);
    expect(roadsAdded(g, [[a, encodeRoad("curve", 1)]])).toBe(0);
    expect(roadsAdded(g, [[a, 0]])).toBe(-1);
  });

  it("costs ROAD_COINS a square beyond those in the box; the box is owned less on the map", () => {
    expect(ROAD_COINS).toBe(2);
    expect(roadsSpare(10, 7)).toBe(3);
    expect(roadsSpare(7, 10)).toBe(0);
    expect(roadsPrice(10, 10, 1)).toBe(2);
    expect(roadsPrice(10, 8, 1)).toBe(0);
    expect(roadsPrice(10, 8, 5)).toBe(6);
    expect(roadsPrice(10, 10, -1)).toBe(0);
    expect(roadShortText(2, 1)).toBe("Road: needs 1🪙 more");
  });

  it("Progress keeps the squares owned: covers the map's lanes, saved, and merged with the world kept", () => {
    const p = Progress.fresh();
    p.coverRoads(12);
    p.coverRoads(5);
    expect(p.roads).toBe(12);
    const back = Progress.fromJSON(JSON.parse(JSON.stringify(p.toJSON())));
    expect(back.roads).toBe(12);
    // (None owned: not written, so older saves' JSON stays as it was.)
    expect("roads" in Progress.fresh().toJSON()).toBe(false);
    const a = p.toJSON();
    const b = { ...p.toJSON(), roads: 20 };
    expect(mergeProgress(a, a, b, "remote").roads).toBe(20);
    expect(mergeProgress(a, b, a, "remote").roads).toBe(12);
  });
});

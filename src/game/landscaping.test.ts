import { describe, expect, it } from "vitest";
import { LandEditor } from "../landscape/edit";
import { FEAT_NONE, FEAT_RUIN, FEAT_STATION, SURF_GRASS, SURF_TOWN } from "../landscape/grid";
import { techOf } from "./tech";
import { LANDSCAPING, lowerPrice, lowerQuestion, lowerRefusal } from "./landscaping";
import { buildStarterWorld } from "./world";

const RICH = 10_000;

/** The starter map, and a hill square on it that can be lowered a step. */
function withHill() {
  const w = buildStarterWorld(true);
  const g = w.landscape.grid;
  const editor = new LandEditor(w.landscape, w.layout);
  let hill = -1;
  for (let i = 0; i < g.height.length && hill === -1; i++) if (g.height[i] > 0 && editor.check(i, -1) === null) hill = i;
  return { w, g, editor, hill };
}

describe("Landscaping: lowering hills for coins", () => {
  it("is a research in the midgame: tier 2, after bridges, once you have a city; mostly coins", () => {
    const t = techOf(LANDSCAPING)!;
    expect([t.tier, t.needs, t.research.coins, t.research.goods.planks]).toEqual([2, ["bridges"], 200, 6]);
    expect(t.requires).toContainEqual({ kind: "level", level: 3 });
  });

  it("costs 200, 300 or 400 coins a step: more for a higher hill", () => {
    expect([1, 2, 3].map((h) => lowerPrice(h))).toEqual([200, 300, 400]);
    expect(lowerQuestion(2, 900)).toBe("Lower this hill a step, from level 2 to 1? It costs 300 coins (you have 900).");
  });

  it("a hill square on open grass can be lowered, if you have the coins", () => {
    const { w, g, editor, hill } = withHill();
    expect(hill).not.toBe(-1);
    const price = lowerPrice(g.height[hill]);
    expect(lowerRefusal(w.landscape, editor, hill, price)).toBeNull();
    expect(lowerRefusal(w.landscape, editor, hill, price - 1)).toBe(`Lowering this costs ${price} coins: you have ${price - 1}`);
    const h = g.height[hill];
    expect(editor.apply(hill, -1)).toBeNull();
    expect(g.height[hill]).toBe(h - 1);
  });

  it("refuses flat ground, towns and stations, and old industries' sites", () => {
    const { w, g, editor } = withHill();
    const flat = g.height.findIndex((h, i) => h === 0 && g.surface[i] === SURF_GRASS && g.feature[i] === FEAT_NONE);
    expect(lowerRefusal(w.landscape, editor, flat, RICH)).toBe("That's flat already: tap a hill");
    // Anything that isn't open grass (a town's squares, a station's, a ruin's), even raised up a step to test it.
    for (const pick of [(i: number) => g.surface[i] === SURF_TOWN, (i: number) => g.feature[i] === FEAT_STATION, (i: number) => g.feature[i] === FEAT_RUIN]) {
      const i = g.height.findIndex((_, k) => pick(k));
      if (i === -1) continue;
      const was = g.height[i];
      g.height[i] = Math.max(1, was);
      expect(lowerRefusal(w.landscape, editor, i, RICH), `square ${i}`).toMatch(/^(Only grass can be raised or lowered|Something stands there)$/);
      g.height[i] = was;
    }
  });

  it("refuses a square with track on it or beside it", () => {
    const { w, g, hill } = withHill();
    w.layout.addPiece("straight-216", { x: g.centreX(g.colOf(hill)) - 108, z: g.centreZ(g.rowOf(hill)), heading: 0 });
    expect(lowerRefusal(w.landscape, new LandEditor(w.landscape, w.layout), hill, RICH)).toBe("There's track on or beside it");
  });

  it("refuses a step too steep for the squares around it", () => {
    const { w, g, editor } = withHill();
    // A square a step up beside one two up: lowered to flat, it would be two below its neighbour.
    const corridors = new Set(w.landscape.corridors);
    for (let i = 0; i < g.height.length; i++) {
      if (g.height[i] !== 1 || g.surface[i] !== SURF_GRASS || g.feature[i] !== FEAT_NONE || corridors.has(i)) continue;
      const col = g.colOf(i);
      const row = g.rowOf(i);
      const high = [g.index(col + 1, row), g.index(col - 1, row), g.index(col, row + 1), g.index(col, row - 1)].some((n) => n !== -1 && g.height[n] === 2);
      if (!high) continue;
      expect(lowerRefusal(w.landscape, editor, i, RICH)).toBe("Too steep: raise or lower the squares around it first");
      return;
    }
    throw new Error("no square a step up beside one two up on the starter map");
  });
});

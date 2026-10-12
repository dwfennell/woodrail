import { describe, expect, it } from "vitest";
import { buildStarterWorld } from "../game/world";
import { LandEditor, plotSlotOf, setHeights } from "./edit";
import { FEAT_BUILDING, FEAT_NONE, MAX_HEIGHT, SURF_GRASS, SURF_RIVER, type LandscapeGrid } from "./grid";

/** First open grass square at height 0 whose 5×5 surroundings are open grass at height 0 (room to build a hill). */
function flatSpot(g: LandscapeGrid, corridors: Set<number>): number {
  let found = -1;
  g.forEachCell((i, col, row) => {
    if (found !== -1) return;
    for (let dc = -2; dc <= 2; dc++)
      for (let dr = -2; dr <= 2; dr++) {
        const n = g.index(col + dc, row + dr);
        if (n === -1 || g.surface[n] !== SURF_GRASS || g.feature[n] !== FEAT_NONE || g.height[n] !== 0 || corridors.has(n)) return;
      }
    found = i;
  });
  if (found === -1) throw new Error("no flat spot");
  return found;
}

function setup() {
  const w = buildStarterWorld();
  const g = w.landscape.grid;
  const at = flatSpot(g, new Set(w.landscape.corridors));
  const n = (dc: number, dr: number) => g.index(g.colOf(at) + dc, g.rowOf(at) + dr);
  return { w, g, at, n };
}

describe("LandEditor", () => {
  it("raises and lowers open grass a block at a time, within the height range", () => {
    const { w, g, at } = setup();
    const ed = new LandEditor(w.landscape, w.layout);
    const v0 = g.version(plotSlotOf(at));
    expect(ed.apply(at, 1)).toBeNull();
    expect(g.height[at]).toBe(1);
    expect(g.version(plotSlotOf(at))).toBe(v0 + 1);
    expect(ed.apply(at, 1)).toBe("steep");
    expect(ed.apply(at, -1)).toBeNull();
    expect(ed.apply(at, -1)).toBe("bottom");
  });

  it("keeps within one block of the neighbours: a hill is built up in rings", () => {
    const { w, g, at, n } = setup();
    const ed = new LandEditor(w.landscape, w.layout);
    for (const [dc, dr] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) expect(ed.apply(n(dc, dr), 1)).toBeNull();
    expect(ed.apply(at, 1)).toBeNull();
    expect(g.height[at]).toBe(2);
    // Not past the top.
    g.height[at] = MAX_HEIGHT;
    expect(new LandEditor(w.landscape, w.layout).check(at, 1)).toBe("top");
  });

  it("leaves rivers, towns and buildings alone", () => {
    const { w, g } = setup();
    const ed = new LandEditor(w.landscape, w.layout);
    let river = -1;
    let house = -1;
    g.forEachCell((i) => {
      if (river === -1 && g.surface[i] === SURF_RIVER) river = i;
      if (house === -1 && g.feature[i] === FEAT_BUILDING) house = i;
    });
    expect(ed.check(river, 1)).toBe("not-grass");
    expect(ed.check(house, 1)).not.toBeNull();
    expect(ed.check(w.landscape.corridors[0], 1)).not.toBeNull();
  });

  it("won't bury or strand track, or move what stands there", () => {
    const { w, g } = setup();
    const mid = flatSpot(g, new Set(w.landscape.corridors));
    // A straight laid across the square, along x.
    w.layout.addPiece("straight-144", { x: g.centreX(g.colOf(mid)) - 72, z: g.centreZ(g.rowOf(mid)), heading: 0 });
    const ed = new LandEditor(w.landscape, w.layout);
    // Under the track, and the squares beside it.
    expect(ed.check(mid, 1)).toBe("track");
    expect(ed.check(g.index(g.colOf(mid), g.rowOf(mid) + 1), 1)).toBe("track");
    // Two squares off, clear.
    expect(ed.check(g.index(g.colOf(mid), g.rowOf(mid) + 2), 1)).toBeNull();
    const clear = setup();
    const withProp = new LandEditor(clear.w.landscape, clear.w.layout, { inRect: () => true });
    expect(withProp.check(clear.at, 1)).toBe("prop");
  });

  it("setHeights restores squares (undo) and reports the plots changed", () => {
    const { w, g, at } = setup();
    new LandEditor(w.landscape, w.layout).apply(at, 1);
    expect(setHeights(w.landscape, new Map([[at, 0]]))).toEqual([plotSlotOf(at)]);
    expect(g.height[at]).toBe(0);
  });
});

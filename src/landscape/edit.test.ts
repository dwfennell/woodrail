import { describe, expect, it } from "vitest";
import { buildStarterWorld } from "../game/world";
import { LandEditor, moveScenery, plotSlotOf, removeScenery, restore, sceneryAt, sceneryCells, setHeights, snapshot, treeSeed } from "./edit";
import { deserializeLandscape, serializeLandscape } from "../persist/landscape-data";
import { FEAT_BUILDING, FEAT_FIELD, FEAT_NONE, FEAT_SHED, FEAT_TREE, MAX_HEIGHT, SURF_GRASS, SURF_LANE, SURF_RIVER, SURF_ROAD, type LandscapeGrid } from "./grid";

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

  it("won't raise or lower a square beside a road (its end would be left in the air or buried)", () => {
    for (const surf of [SURF_ROAD, SURF_LANE]) {
      const { w, g, at, n } = setup();
      g.surface[n(1, 1)] = surf;
      expect(new LandEditor(w.landscape, w.layout).check(at, 1)).toBe("road");
      expect(new LandEditor(w.landscape, w.layout).check(n(-1, 0), 1)).toBeNull();
    }
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

describe("moving scenery", () => {
  function firstWith(g: LandscapeGrid, f: number): number {
    let found = -1;
    g.forEachCell((i) => {
      if (found === -1 && g.feature[i] === f) found = i;
    });
    return found;
  }

  it("a tree moves to a free square and keeps its look; undo puts it back", () => {
    const { w, g } = setup();
    const from = firstWith(g, FEAT_TREE);
    const s = sceneryAt(w.landscape, from)!;
    expect(s.kind).toBe("tree");
    const seed = treeSeed(w.landscape, from, g.colOf(from), g.rowOf(from));
    // Find a free step next to it.
    const ed = new LandEditor(w.landscape, w.layout);
    const step = [[1, 0], [-1, 0], [0, 1], [0, -1], [2, 0], [0, 2]].find(([dc, dr]) => ed.checkMove(s, dc, dr) === null)!;
    expect(step).toBeDefined();
    const to = g.index(g.colOf(from) + step[0], g.rowOf(from) + step[1]);
    const before = snapshot(w.landscape, [from, to], s);
    moveScenery(w.landscape, s, step[0], step[1]);
    expect(g.feature[from]).toBe(FEAT_NONE);
    expect(g.feature[to]).toBe(FEAT_TREE);
    expect(treeSeed(w.landscape, to, g.colOf(to), g.rowOf(to))).toBe(seed);
    restore(w.landscape, before);
    expect(g.feature[from]).toBe(FEAT_TREE);
    expect(g.feature[to]).toBe(FEAT_NONE);
  });

  it("won't move onto houses, river or off the land", () => {
    const { w, g } = setup();
    const tree = sceneryAt(w.landscape, firstWith(g, FEAT_TREE))!;
    const ed = new LandEditor(w.landscape, w.layout);
    expect(ed.checkMove(tree, 100000, 0)).toBe("off-land");
    const house = firstWith(g, FEAT_BUILDING);
    const t = (tree as { cell: number }).cell;
    expect(ed.checkMove(tree, g.colOf(house) - g.colOf(t), g.rowOf(house) - g.rowOf(t))).not.toBeNull();
  });

  it("a field moves whole and keeps its id; removing leaves an empty entry that still saves and loads", () => {
    const { w, g } = setup();
    const cell = firstWith(g, FEAT_FIELD);
    if (cell === -1) return; // the starter map may have no fields
    const field = sceneryAt(w.landscape, cell)!;
    expect(field.kind).toBe("field");
    const ed = new LandEditor(w.landscape, w.layout);
    const step = [[1, 0], [-1, 0], [0, 1], [0, -1], [0, 2], [2, 0], [0, -2], [-2, 0]].find(([dc, dr]) => ed.checkMove(field, dc, dr) === null);
    if (step) {
      const id = (field as { id: number }).id;
      moveScenery(w.landscape, field, step[0], step[1]);
      for (const i of sceneryCells(w.landscape, field)) {
        expect(g.feature[i]).toBe(FEAT_FIELD);
        expect(g.owner[i]).toBe(id);
      }
    }
    removeScenery(w.landscape, field);
    expect(sceneryCells(w.landscape, field)).toEqual([]);
    const back = deserializeLandscape(JSON.parse(JSON.stringify(serializeLandscape(w.landscape))));
    expect(back.ok).toBe(true);
  });

  it("the shed can be removed, and the map still loads", () => {
    const { w, g } = setup();
    if (!w.landscape.shed) return;
    const s = sceneryAt(w.landscape, w.landscape.shed.cells[0])!;
    expect(s.kind).toBe("shed");
    removeScenery(w.landscape, s);
    expect(w.landscape.shed).toBeNull();
    expect(firstWith(g, FEAT_SHED)).toBe(-1);
    expect(deserializeLandscape(JSON.parse(JSON.stringify(serializeLandscape(w.landscape)))).ok).toBe(true);
  });
});

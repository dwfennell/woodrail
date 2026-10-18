import { describe, expect, it } from "vitest";
import { CELL, FEAT_BUILDING, FEAT_NONE, SURF_GRASS, SURF_RIVER, type LandscapeGrid } from "../landscape";
import { buildStarterWorld } from "../game/world";
import { appendPiece, connectorRef, Layout } from "../track";
import { checkProp, footprintsOverlap, pieceHitsProp, propsInRect, scaleFootprint, TrackIndex, type Footprint } from "./placement";
import { PropStore } from "./store";

const SMALL: Footprint = { cx: 0, cz: 0, hw: 10, hd: 10 };

/** Centre of the first cell matching a test (with `around` cells on each side matching too, at its height). */
function findCell(g: LandscapeGrid, ok: (i: number) => boolean, around = 1): { x: number; z: number } {
  let found: { x: number; z: number } | null = null;
  g.forEachCell((i, col, row) => {
    if (found) return;
    for (let dc = -around; dc <= around; dc++)
      for (let dr = -around; dr <= around; dr++) {
        if (!g.inBounds(col + dc, row + dr)) return;
        const j = g.index(col + dc, row + dr);
        if (!ok(j) || g.height[j] !== g.height[i]) return;
      }
    found = { x: g.centreX(col), z: g.centreZ(row) };
  });
  if (!found) throw new Error("no such cell");
  return found;
}

function setup() {
  const w = buildStarterWorld();
  const g = w.landscape.grid;
  const props = new PropStore();
  const ctx = { land: w.landscape, track: new TrackIndex(w.layout), props, footprint: () => SMALL };
  return { w, g, props, ctx };
}

const grass = (g: LandscapeGrid) => (i: number) => g.surface[i] === SURF_GRASS && g.feature[i] === FEAT_NONE;

describe("checkProp", () => {
  it("stands on clear grass, at the ground's height", () => {
    const { g, ctx } = setup();
    const at = findCell(g, grass(g));
    expect(checkProp(ctx, SMALL, { ...at, heading: 0 }, "land")).toEqual({ kind: "clear", y: expect.any(Number) });
  });

  it("not off the land, not on a house; boats only on the river", () => {
    const { g, ctx } = setup();
    const ext = g.extent();
    expect(checkProp(ctx, SMALL, { x: ext.x1 + 500, z: 0, heading: 0 }, "land")).toEqual({ kind: "blocked", reason: "off-land" });
    const house = findCell(g, (i) => g.feature[i] === FEAT_BUILDING, 0);
    expect(checkProp(ctx, SMALL, { ...house, heading: 0 }, "land")).toMatchObject({ reason: "building" });
    const river = findCell(g, (i) => g.surface[i] === SURF_RIVER, 0);
    expect(checkProp(ctx, SMALL, { ...river, heading: 0 }, "land")).toMatchObject({ reason: "river" });
    expect(checkProp(ctx, SMALL, { ...river, heading: 0 }, "water")).toMatchObject({ kind: "clear" });
    // A bridge may span the river, or stand on dry land.
    expect(checkProp(ctx, SMALL, { ...river, heading: 0 }, "any")).toMatchObject({ kind: "clear" });
    const dry = findCell(g, grass(g));
    expect(checkProp(ctx, SMALL, { ...dry, heading: 0 }, "water")).toMatchObject({ reason: "dry" });
  });

  it("not over another prop (unless it's the one being moved)", () => {
    const { g, ctx, props } = setup();
    const at = findCell(g, grass(g));
    const p = props.add("x", { ...at, heading: 0, y: 0 });
    expect(checkProp(ctx, SMALL, { x: at.x + 12, z: at.z, heading: 0.3 }, "land")).toMatchObject({ reason: "prop" });
    expect(checkProp(ctx, SMALL, { x: at.x + 12, z: at.z, heading: 0.3 }, "land", p.id)).toMatchObject({ kind: "clear" });
    expect(checkProp(ctx, SMALL, { x: at.x + 24, z: at.z, heading: 0 }, "land")).toMatchObject({ kind: "clear" });
  });

  it("not on the track; and track can't be laid through a prop", () => {
    const { w, ctx, props } = setup();
    const [a] = w.landscape.towns;
    const id = appendPiece(w.layout, "straight-216", false, connectorRef(w.stations.get(a.id)!, 1));
    const piece = w.layout.getPiece(id)!;
    const mid = { x: piece.pose.x + Math.cos(piece.pose.heading) * 108, z: piece.pose.z + Math.sin(piece.pose.heading) * 108 };
    const track = new TrackIndex(w.layout);
    expect(checkProp({ ...ctx, track }, SMALL, { ...mid, heading: 0 }, "land")).toMatchObject({ reason: "track" });
    // Beside the track: a rail's half width plus a little.
    const side = { x: mid.x - Math.sin(piece.pose.heading) * 34, z: mid.z + Math.cos(piece.pose.heading) * 34 };
    expect(track.hits(SMALL, { ...side, heading: 0 })).toBe(false);

    const free = new Layout();
    expect(pieceHitsProp(props, () => SMALL, "straight-216", false, piece.pose)).toBe(false);
    props.add("x", { ...mid, heading: 0, y: 0 });
    expect(pieceHitsProp(props, () => SMALL, "straight-216", false, piece.pose)).toBe(true);
    expect(free.pieceCount).toBe(0);
  });

  it("not over a hill's edge", () => {
    const { g, ctx } = setup();
    // A cell beside a higher one: a footprint straddling their shared edge is uneven.
    let edge: { x: number; z: number } | null = null;
    g.forEachCell((i, col, row) => {
      if (edge || !g.inBounds(col + 1, row)) return;
      const j = g.index(col + 1, row);
      if (grass(g)(i) && grass(g)(j) && g.height[j] > g.height[i]) edge = { x: g.centreX(col) + CELL / 2, z: g.centreZ(row) };
    });
    expect(edge).not.toBeNull();
    expect(checkProp(ctx, SMALL, { ...edge!, heading: 0 }, "land")).toMatchObject({ reason: "uneven" });
  });
});

describe("footprintsOverlap", () => {
  const a: Footprint = { cx: 0, cz: 0, hw: 20, hd: 5 };
  it("turned rectangles", () => {
    expect(footprintsOverlap(a, { x: 0, z: 0, heading: 0 }, a, { x: 0, z: 8, heading: 0 })).toBe(true);
    expect(footprintsOverlap(a, { x: 0, z: 0, heading: 0 }, a, { x: 0, z: 11, heading: 0 })).toBe(false);
    // Turned a quarter: a long thin one crossing the other.
    expect(footprintsOverlap(a, { x: 0, z: 0, heading: 0 }, a, { x: 0, z: 15, heading: Math.PI / 2 })).toBe(true);
    expect(footprintsOverlap(a, { x: 0, z: 0, heading: 0 }, a, { x: 30, z: 15, heading: Math.PI / 2 })).toBe(false);
  });
});

describe("a prop drawn at its own scale (a landmark on a smaller lot)", () => {
  it("has its footprint scaled too: outlines, overlaps and rectangle checks use the size it's drawn", () => {
    const fp: Footprint = { cx: 10, cz: -4, hw: 60, hd: 30 };
    expect(scaleFootprint(fp, undefined)).toBe(fp);
    expect(scaleFootprint(fp, 0.8)).toEqual({ cx: 8, cz: -3.2, hw: 48, hd: 24 });
    const props = new PropStore();
    props.add("bldg-market-hall", { x: 0, z: 0, heading: 0, y: 0 }, undefined, { scale: 0.8 });
    // Its full-size footprint would reach x = 70; drawn at 0.8 it reaches 56.
    expect(propsInRect(props, () => fp, 60, -5, 80, 5)).toBe(false);
    expect(propsInRect(props, () => fp, 50, -5, 80, 5)).toBe(true);
  });
});

import { describe, expect, it } from "vitest";
import { checkPlacement, FEAT_BUILDING, FEAT_FIELD, gridWithPlots, SURF_RIVER, SURF_SEA, type Landscape } from "../landscape";
import { PropStore } from "../props/store";
import { appendPiece, connectorRef, findSplice, Layout, type PieceTypeId, type Pose } from "../track";
import { checkYard, turnedRound, YARD_FLIP_HINT, yardMessage, yardParts, type YardCheck } from "./depot-footprint";

function flat(): Landscape {
  return { seed: 0, starter: false, grid: gridWithPlots(-1, -1, 2, 2), towns: [], corridors: [], fields: [], shed: null, depots: [], nextBuildingId: 0 };
}

/** Set every square touched by the world rectangle (x0, z0)–(x1, z1). */
function setCells(land: Landscape, x0: number, x1: number, z0: number, z1: number, fn: (i: number) => void): void {
  const g = land.grid;
  for (let x = x0; x <= x1; x += 8) for (let z = z0; z <= z1; z += 8) {
    const i = g.cellAtWorld(x, z);
    if (i !== -1) fn(i);
  }
  g.revision++;
}

const P = (x: number, z: number, heading = 0): Pose => ({ x, z, heading });

function setup(): YardCheck & { land: Landscape; layout: Layout; props: PropStore } {
  const land = flat();
  return { land, layout: new Layout(), props: new PropStore(), footprint: () => ({ cx: 0, cz: 0, hw: 10, hd: 10 }) };
}

// A workshop at the origin along +x: its track runs z −20 to 20 (squares of rows −1 and 0), its yard z 30 to 114.
const AT = P(0, 0);

describe("a depot's yard", () => {
  it("is a pad beside the track on its +l side, the same for every pose (worked out once per kind)", () => {
    const parts = yardParts("depot-workshop")!;
    expect(parts[0]).toMatchObject({ cx: 108, cz: 72, hw: 98, hd: 42 });
    expect(yardParts("depot-workshop")).toBe(parts);
    expect(yardParts("straight-216")).toBeNull();
  });

  it("goes on clear ground", () => {
    const ctx = setup();
    for (const t of ["depot-workshop", "depot-sawmill", "depot-forest", "depot-mill", "depot-harbour"] as PieceTypeId[]) expect(checkYard(ctx, t, AT, 0, -1), t).toBeNull();
  });

  it("is refused on a hill beside the track, though the track itself is clear; turned round, it fits", () => {
    const ctx = setup();
    // A raised block on the yard's side, a square out from the track (row 1: z 72–144).
    setCells(ctx.land, 80, 130, 80, 130, (i) => (ctx.land.grid.height[i] = 1));
    expect(checkPlacement(ctx.land, "depot-workshop", false, AT, 0)).toEqual({ kind: "clear" });
    expect(checkYard(ctx, "depot-workshop", AT, 0, -1)).toBe("yard-hill");
    expect(yardMessage("depot-workshop", "yard-hill")).toBe("The workshop's yard is on a hill");
    // Turned right round on the same track, its yard is on the open side.
    const turned = turnedRound("depot-workshop", AT);
    expect(turned.x).toBeCloseTo(216);
    expect(turned.z).toBeCloseTo(0);
    expect(Math.abs(turned.heading)).toBeCloseTo(Math.PI);
    expect(checkYard(ctx, "depot-workshop", turned, 0, -1)).toBeNull();
    // Up on the hill's level, the block isn't above the yard.
    expect(checkYard(ctx, "depot-workshop", AT, 48, -1)).toBeNull();
  });

  it("is refused in the water, but a harbour's quay side may be on it", () => {
    const ctx = setup();
    // Water from 84 mm out from the track (a square's edge, z 72, for a depot at z −12).
    const at = P(0, -12);
    setCells(ctx.land, -10, 230, 76, 140, (i) => (ctx.land.grid.surface[i] = SURF_RIVER));
    expect(checkYard(ctx, "depot-workshop", at, 0, -1)).toBe("yard-water");
    expect(yardMessage("depot-sawmill", "yard-water")).toBe("The sawmill's yard is in the water");
    expect(checkYard(ctx, "depot-harbour", at, 0, -1)).toBeNull();
    // Further in, the harbour's yard is in the sea.
    setCells(ctx.land, -10, 230, 0, 70, (i) => (ctx.land.grid.surface[i] = SURF_SEA));
    expect(checkYard(ctx, "depot-harbour", at, 0, -1)).toBe("yard-water");
  });

  it("is refused on a house, a farm field or a prop beside the track", () => {
    const house = setup();
    setCells(house.land, 150, 160, 100, 104, (i) => (house.land.grid.feature[i] = FEAT_BUILDING));
    expect(checkYard(house, "depot-workshop", AT, 0, -1)).toBe("yard-ground");
    expect(yardMessage("depot-workshop", "yard-ground")).toBe("The workshop's yard needs open ground");
    // (A yard named for itself isn't "the forest yard's yard".)
    expect(yardMessage("depot-forest", "yard-ground")).toBe("The forest yard needs open ground");

    const field = setup();
    setCells(field.land, 20, 24, 100, 104, (i) => (field.land.grid.feature[i] = FEAT_FIELD));
    expect(checkYard(field, "depot-workshop", AT, 0, -1)).toBe("yard-ground");

    const prop = setup();
    prop.props.add("tree-oak", { x: 60, z: 90, heading: 0, y: 0 });
    expect(checkYard(prop, "depot-workshop", AT, 0, -1)).toBe("yard-ground");
    // On the far side of the line, it's clear.
    expect(checkYard(prop, "depot-workshop", turnedRound("depot-workshop", AT), 0, -1)).toBeNull();
  });

  it("is refused over other track, and on another depot's yard (or with its track through one)", () => {
    const ctx = setup();
    const line = ctx.layout.addPiece("straight-216", P(0, 80));
    expect(checkYard(ctx, "depot-workshop", AT, 0, -1)).toBe("yard-ground");
    // Left out (the piece being moved), or two levels up (a bridge over it), it's clear.
    expect(checkYard(ctx, "depot-workshop", AT, 0, line)).toBeNull();
    ctx.layout.removePiece(line);
    ctx.layout.addPiece("straight-216", P(0, 80), 96);
    expect(checkYard(ctx, "depot-workshop", AT, 0, -1)).toBeNull();

    const depots = setup();
    // Another workshop beside it, half a length along: the two yards overlap (the tracks are findOverlap's).
    depots.layout.addPiece("depot-workshop", P(100, 0));
    expect(checkYard(depots, "depot-workshop", P(0, 10), 0, -1)).toBe("yard-ground");
    // Across the line from it, back to back: the yards are on either side, clear of each other.
    expect(checkYard(depots, "depot-workshop", turnedRound("depot-workshop", P(100, -60)), 0, -1)).toBeNull();
    // Its track running through the other's yard.
    expect(checkYard(depots, "depot-workshop", turnedRound("depot-workshop", P(100, 80)), 0, -1)).toBe("yard-ground");
    // Ordinary track isn't a depot: nothing to check.
    expect(checkYard(depots, "straight-216", P(100, 80), 0, -1)).toBeNull();
  });
});

describe("a depot dropped onto a line", () => {
  /** Three long straights from the origin along +x, joined. */
  function line(l: Layout): number[] {
    const ids = [l.addPiece("straight-216", P(0, 0))];
    for (let i = 1; i < 3; i++) ids.push(appendPiece(l, "straight-216", false, connectorRef(ids[i - 1], 1)));
    return ids;
  }

  it("is refused where its yard would be on a hill, and fits turned round (the flip hint)", () => {
    const ctx = setup();
    const [, mid] = line(ctx.layout);
    // A hill beside the middle straight, on the side the depot's yard comes out on (+z).
    setCells(ctx.land, 260, 300, 80, 130, (i) => (ctx.land.grid.height[i] = 1));
    const s = findSplice(ctx.layout, "depot-workshop", false, { x: 324, z: 0 }, 0, 40);
    expect(s.kind).toBe("splice");
    if (s.kind !== "splice") return;
    expect(s.covers).toEqual([mid]);
    const ignore = new Set([-1, ...s.covers]);
    expect(checkYard(ctx, "depot-workshop", s.pose, s.y, ignore)).toBe("yard-hill");
    // Turned round, its yard is on the other side, and the line either side doesn't get in its way.
    expect(checkYard(ctx, "depot-workshop", turnedRound("depot-workshop", s.pose), s.y, ignore)).toBeNull();
    // Held turned round, it lies along the line that way: the same pose.
    const r = findSplice(ctx.layout, "depot-workshop", false, { x: 324, z: 0 }, Math.PI, 40);
    expect(r.kind === "splice" && r.pose.x).toBeCloseTo(432);
    expect(r.kind === "splice" && checkYard(ctx, "depot-workshop", r.pose, r.y, ignore)).toBeNull();
    expect(YARD_FLIP_HINT).toBe("Flip it to put the yard on the other side");
  });

  it("is refused with no hint when neither side fits", () => {
    const ctx = setup();
    line(ctx.layout);
    setCells(ctx.land, 260, 300, 80, 130, (i) => (ctx.land.grid.height[i] = 1));
    setCells(ctx.land, 260, 300, -130, -80, (i) => (ctx.land.grid.surface[i] = SURF_RIVER));
    const s = findSplice(ctx.layout, "depot-workshop", false, { x: 324, z: 0 }, 0, 40);
    if (s.kind !== "splice") throw new Error("no splice");
    const ignore = new Set(s.covers);
    expect(checkYard(ctx, "depot-workshop", s.pose, s.y, ignore)).toBe("yard-hill");
    expect(checkYard(ctx, "depot-workshop", turnedRound("depot-workshop", s.pose), s.y, ignore)).toBe("yard-water");
  });
});

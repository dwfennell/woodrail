import { describe, expect, it } from "vitest";
import { checkPlacement, FEAT_BUILDING, gridWithPlots, SURF_RIVER, SURF_TOWN, type Landscape } from "../landscape";
import { PropStore } from "../props/store";
import { appendPiece, connectorRef, findSplice, Layout, type PieceTypeId, type Pose } from "../track";
import {
  checkYard,
  flipHint,
  footprintInYards,
  hasFootprint,
  inYardMessage,
  placedYard,
  trackInYards,
  townMessage,
  turnedRound,
  YARD_FLIP_HINT,
  YARD_NO_ROOM,
  yardMessage,
  yardParts,
  type YardBlock,
  type YardCheck,
  type YardObstacle,
} from "./depot-footprint";

// The kit pieces' footprint checks are the depots' (depot-footprint.ts), over the kit's own rectangles: these are the
// depot tests' cases again for the furnished platform, and the two side by side.

const KIT = "kit-platform-furnished" as const;

function flat(): Landscape {
  return { seed: 0, starter: false, grid: gridWithPlots(-1, -1, 2, 2), towns: [], corridors: [], fields: [], shed: null, depots: [], nextBuildingId: 0 };
}

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
  return { land: flat(), layout: new Layout(), props: new PropStore(), footprint: () => ({ cx: 0, cz: 0, hw: 10, hd: 10 }) };
}

// The platform at the origin along +x: its track z −20 to 20, its platform z 20 to 48 (t 0 to 216).
const AT = P(0, 0);

/** The refusal for a piece of `type` at `pose`, as the game says it (what's in the way and all), or null. */
function say(ctx: YardCheck, type: PieceTypeId, pose: Pose = AT): string | null {
  const out: YardObstacle = { what: null };
  const why = checkYard(ctx, type, pose, 0, -1, out);
  return why && yardMessage(type, why, out.what);
}

describe("a kit's footprint (the furnished platform)", () => {
  it("is its platform's rectangle beside the track on its +l side, worked out once", () => {
    const parts = yardParts(KIT)!;
    expect(parts).toEqual([{ cx: 108, cz: 34, hw: 108, hd: 14, crane: false, post: false }]);
    expect(yardParts(KIT)).toBe(parts);
    expect(hasFootprint(KIT)).toBe(true);
    expect(hasFootprint("depot-workshop")).toBe(true);
    expect(hasFootprint("straight-216")).toBe(false);
    expect(checkYard(setup(), KIT, AT, 0, -1)).toBeNull();
  });

  it("is refused on a hill, in water, on a house, a prop or other track, named after the kit", () => {
    const hill = setup();
    setCells(hill.land, 60, 100, 30, 40, (i) => (hill.land.grid.height[i] = 1));
    expect(checkYard(hill, KIT, AT, 0, -1)).toBe("yard-hill");
    expect(yardMessage(KIT, "yard-hill")).toBe("The platform is on a hill");
    // Turned round, its platform is on the other side of the line: clear.
    expect(checkYard(hill, KIT, turnedRound(KIT, AT), 0, -1)).toBeNull();

    const water = setup();
    setCells(water.land, 60, 100, 30, 40, (i) => (water.land.grid.surface[i] = SURF_RIVER));
    expect(checkYard(water, KIT, AT, 0, -1)).toBe("yard-water");
    expect(yardMessage(KIT, "yard-water")).toBe("The platform is in the water");

    const house = setup();
    setCells(house.land, 150, 160, 30, 40, (i) => (house.land.grid.feature[i] = FEAT_BUILDING));
    expect(checkYard(house, KIT, AT, 0, -1)).toBe("yard-ground");
    expect(yardMessage(KIT, "yard-ground")).toBe("The platform needs open ground");
    expect(say(house, KIT)).toBe("The platform needs open ground: a house is in the way");
    expect(say(water, KIT)).toBe("The platform is in the river");

    const prop = setup();
    prop.props.add("tree-oak", { x: 60, z: 40, heading: 0, y: 0 });
    expect(checkYard(prop, KIT, AT, 0, -1)).toBe("yard-ground");
    expect(say(prop, KIT)).toBe("The platform needs open ground: a tree is in the way");
    expect(checkYard(prop, KIT, turnedRound(KIT, AT), 0, -1)).toBeNull();

    const track = setup();
    const line = track.layout.addPiece("straight-216", P(0, 40));
    expect(checkYard(track, KIT, AT, 0, -1)).toBe("yard-ground");
    expect(say(track, KIT)).toBe("The platform needs open ground: the track is in the way");
    expect(checkYard(track, KIT, AT, 0, line)).toBeNull();
    // A line a double track's width away runs clear beside the platform.
    track.layout.removePiece(line);
    track.layout.addPiece("straight-216", P(0, 72));
    expect(checkYard(track, KIT, AT, 0, -1)).toBeNull();

    expect(townMessage(KIT)).toBe("Keep the platform out of town");
  });

  it("and a depot's yard keep out of each other, both ways", () => {
    // A workshop the other side of a line beside the platform: its yard (l 30 to 114) over the platform.
    const ctx = setup();
    ctx.layout.addPiece("depot-workshop", turnedRound("depot-workshop", P(0, 100)));
    expect(checkYard(ctx, KIT, AT, 0, -1)).toBe("yard-ground");
    expect(say(ctx, KIT)).toBe("The platform needs open ground: the workshop's yard is in the way");
    const other = setup();
    other.layout.addPiece(KIT, AT);
    expect(checkYard(other, "depot-workshop", turnedRound("depot-workshop", P(0, 100)), 0, -1)).toBe("yard-ground");
    expect(say(other, "depot-workshop", turnedRound("depot-workshop", P(0, 100)))).toBe("The workshop's yard needs open ground: the track is in the way");
    // Two platforms back to back across a line's width: clear.
    expect(checkYard(other, KIT, turnedRound(KIT, P(0, 0)), 0, -1)).toBeNull();
  });

  it("refuses the same things as a depot's yard where the two overlap (parity)", () => {
    // The platform (l 20–48) and the workshop's pad (l 30–114) share l 30–48, t 10–206: the same obstacles there.
    const cases: [string, (ctx: ReturnType<typeof setup>) => void, YardBlock][] = [
      ["hill", (c) => setCells(c.land, 100, 110, 36, 42, (i) => (c.land.grid.height[i] = 1)), "yard-hill"],
      ["water", (c) => setCells(c.land, 100, 110, 36, 42, (i) => (c.land.grid.surface[i] = SURF_RIVER)), "yard-water"],
      ["house", (c) => setCells(c.land, 100, 110, 36, 42, (i) => (c.land.grid.feature[i] = FEAT_BUILDING)), "yard-ground"],
      ["prop", (c) => c.props.add("tree-oak", { x: 100, z: 40, heading: 0, y: 0 }), "yard-ground"],
      ["track", (c) => c.layout.addPiece("straight-216", P(0, 44)), "yard-ground"],
    ];
    for (const [what, put, why] of cases) {
      for (const type of [KIT, "depot-workshop"] as PieceTypeId[]) {
        const ctx = setup();
        put(ctx);
        expect(checkYard(ctx, type, AT, 0, -1), `${type}: ${what}`).toBe(why);
      }
    }
  });

  it("is a placed footprint other track and props keep out of: \"That's the platform\"", () => {
    const yards = [placedYard(9, KIT, AT, 0)!];
    expect(yards[0]).toMatchObject({ pieceId: 9, x0: 0, x1: 216, z0: 20, z1: 48 });
    expect(trackInYards(yards, "straight-216", false, P(0, 40), 0, -1)?.pieceId).toBe(9);
    expect(inYardMessage(KIT)).toBe("That's the platform");
    // Its own line, end on, and alongside past the platform.
    expect(trackInYards(yards, "straight-216", false, P(216, 0), 0, -1)).toBeNull();
    expect(trackInYards(yards, "straight-216", false, P(0, 72), 0, -1)).toBeNull();
    expect(footprintInYards(yards, { cx: 0, cz: 0, hw: 6, hd: 6 }, P(100, 30))?.pieceId).toBe(9);
    expect(footprintInYards(yards, { cx: 0, cz: 0, hw: 6, hd: 6 }, P(100, 60))).toBeNull();
  });
});

describe("a kit dropped onto a line: the flip hint", () => {
  it("spliced where the platform would be on a hill, it says Flip, named after the kit; neither side: no room", () => {
    const ctx = setup();
    // A line along the middle of a row of squares (z 0 to 72): its track on that row, the platform reaching the next.
    const ids = [ctx.layout.addPiece("straight-216", P(0, 36))];
    for (let i = 1; i < 3; i++) ids.push(appendPiece(ctx.layout, "straight-216", false, connectorRef(ids[i - 1], 1)));
    setCells(ctx.land, 260, 300, 80, 100, (i) => (ctx.land.grid.height[i] = 1));
    const s = findSplice(ctx.layout, KIT, false, { x: 324, z: 36 }, 0, 40);
    if (s.kind !== "splice") throw new Error(s.kind);
    expect(s.covers).toEqual([ids[1]]);
    const ignore = new Set(s.covers);
    expect(checkYard(ctx, KIT, s.pose, s.y, ignore)).toBe("yard-hill");
    expect(checkYard(ctx, KIT, turnedRound(KIT, s.pose), s.y, ignore)).toBeNull();
    const at = (pose: Pose) => {
      const track = checkPlacement(ctx.land, KIT, false, pose, 0);
      return track.kind !== "clear" ? track.reason : checkYard(ctx, KIT, pose, 0, ignore);
    };
    expect(flipHint(KIT, s.pose, at)).toBe("Flip it to put the platform on the other side");
    // Water the other side too: no room either way.
    setCells(ctx.land, 260, 300, -20, -10, (i) => (ctx.land.grid.surface[i] = SURF_RIVER));
    expect(flipHint(KIT, s.pose, at)).toBe("No room for the platform here");
    // Depots' words are unchanged.
    expect(YARD_FLIP_HINT).toBe("Flip it to put the yard on the other side");
    expect(YARD_NO_ROOM).toBe("No room for the yard here");
    expect(flipHint(KIT, AT, () => "building")).toBeNull();
  });
});

describe("the train lift's footprint: its whole frame", () => {
  const LIFT = "kit-train-lift" as const;
  it("covers its posts and platform on the ground (l ±38, t 0 to 288), a notch at each end over the line; its counterweights overhead", () => {
    const parts = yardParts(LIFT)!;
    const inside = (t: number, l: number, overhead = false) =>
      parts.some((p) => !!(p as { overhead?: boolean }).overhead === overhead && Math.abs(t - p.cx) <= p.hw && Math.abs(l - p.cz) <= p.hd);
    // A post at each end and the middle, each side (the model's posts: l ±28 to ±36); the platform's middle.
    for (const t of [2, 10, 144, 278, 286]) for (const l of [-36, -28, 28, 36]) expect(inside(t, l), `post t ${t} l ${l}`).toBe(true);
    expect(inside(144, 0)).toBe(true);
    // The counterweights (l ±35.4 to ±41.4, t 209 to 223) hang overhead.
    for (const l of [-41.4, -35.4, 35.4, 41.4]) for (const t of [209, 223]) expect(inside(t, l, true), `weight t ${t} l ${l}`).toBe(true);
    // Not the line at its ends (the track joined there), nor past its frame on the ground (2 mm past the posts).
    expect(inside(2, 0)).toBe(false);
    expect(inside(286, 0)).toBe(false);
    expect(inside(144, 39)).toBe(false);
    expect(inside(216, 41)).toBe(false);
  });

  it("stands right up to ground it can't (a town lot 2 mm past its posts), and says what's in the way when it can't", () => {
    // A town square from z 72: the lift's posts at z 34 + 36 = 70 stand 2 mm short of it (its old ±42 frame reached 76).
    const town = setup();
    setCells(town.land, 0, 300, 80, 100, (i) => (town.land.grid.surface[i] = SURF_TOWN));
    expect(say(town, LIFT, P(0, 34))).toBeNull();
    // 4 mm closer, its posts would stand on the lot.
    expect(say(town, LIFT, P(0, 38))).toBe("The train lift needs open ground: the town is in the way");
    const house = setup();
    setCells(house.land, 0, 300, 80, 100, (i) => (house.land.grid.feature[i] = FEAT_BUILDING));
    expect(say(house, LIFT, P(0, 38))).toBe("The train lift needs open ground: a house is in the way");
    const river = setup();
    setCells(river.land, 0, 300, 80, 100, (i) => (river.land.grid.surface[i] = SURF_RIVER));
    expect(say(river, LIFT, P(0, 34))).toBeNull();
    expect(say(river, LIFT, P(0, 38))).toBe("The train lift is in the river");
    const hill = setup();
    setCells(hill.land, 0, 300, 80, 100, (i) => (hill.land.grid.height[i] = 1));
    expect(say(hill, LIFT, P(0, 34))).toBeNull();
    expect(say(hill, LIFT, P(0, 38))).toBe("The train lift is on a hill");
    // Its counterweights hang over the river (or a hill) at z 34 + 41.4: nothing on the ground is in their way.
    expect(say(river, LIFT, P(0, 34))).toBeNull();
    // But a tree under one is.
    const tree = { ...setup(), footprint: () => ({ cx: 0, cz: 0, hw: 2, hd: 2 }) };
    tree.props.add("scene-birch", { x: 216, z: 41, heading: 0, y: 0 });
    expect(say(tree, LIFT)).toBe("The train lift needs open ground: a tree is in the way");
    // And track under it isn't (it would pass under at 70 mm and more up; the posts' band keeps its line over 52 mm off).
    const yards = [placedYard(9, LIFT, AT, 0)!];
    expect(trackInYards(yards, "straight-216", false, P(108, 54), 0, -1)).toBeNull();
  });

  it("a tree by a leg or a counterweight is refused; the line joined at both ends (felt and a level up) is clear", () => {
    const small = () => ({ ...setup(), footprint: () => ({ cx: 0, cz: 0, hw: 3, hd: 3 }) });
    for (const [x, z] of [
      [216, 41],
      [216, -41],
      [3, 33],
      [285, -33],
    ]) {
      const ctx = small();
      ctx.props.add("tree-oak", { x, z, heading: 0, y: 0 });
      expect(checkYard(ctx, LIFT, AT, 0, -1), `tree at ${x}, ${z}`).toBe("yard-ground");
    }
    const ctx = small();
    ctx.props.add("tree-oak", { x: 144, z: 50, heading: 0, y: 0 });
    expect(checkYard(ctx, LIFT, AT, 0, -1)).toBeNull();
    // The straights it splices between: one on the felt ending at its low end, one a level up from its high end.
    ctx.layout.addPiece("straight-216", P(-216, 0));
    ctx.layout.addPiece("straight-216", P(288, 0), 48);
    expect(checkYard(ctx, LIFT, AT, 0, -1)).toBeNull();
    const yards = [placedYard(9, LIFT, AT, 0)!];
    expect(trackInYards(yards, "straight-216", false, P(-216, 0), 0, -1)).toBeNull();
    expect(trackInYards(yards, "straight-216", false, P(288, 0), 48, -1)).toBeNull();
    // Track across it is in its way.
    expect(trackInYards(yards, "straight-216", false, P(144, -108, Math.PI / 2), 0, -1)?.pieceId).toBe(9);
    expect(inYardMessage(LIFT)).toBe("That's the train lift");
  });
});

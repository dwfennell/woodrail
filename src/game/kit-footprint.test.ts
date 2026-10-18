import { describe, expect, it } from "vitest";
import { checkPlacement, FEAT_BUILDING, gridWithPlots, SURF_RIVER, type Landscape } from "../landscape";
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

    const prop = setup();
    prop.props.add("tree-oak", { x: 60, z: 40, heading: 0, y: 0 });
    expect(checkYard(prop, KIT, AT, 0, -1)).toBe("yard-ground");
    expect(checkYard(prop, KIT, turnedRound(KIT, AT), 0, -1)).toBeNull();

    const track = setup();
    const line = track.layout.addPiece("straight-216", P(0, 40));
    expect(checkYard(track, KIT, AT, 0, -1)).toBe("yard-ground");
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
    const other = setup();
    other.layout.addPiece(KIT, AT);
    expect(checkYard(other, "depot-workshop", turnedRound("depot-workshop", P(0, 100)), 0, -1)).toBe("yard-ground");
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
  it("covers its posts, braces and counterweights (l ±42, t 0 to 288), a notch at each end over the line", () => {
    const parts = yardParts(LIFT)!;
    const inside = (t: number, l: number) => parts.some((p) => Math.abs(t - p.cx) <= p.hw && Math.abs(l - p.cz) <= p.hd);
    // A post at each end and the middle, each side; a counterweight; the platform's middle.
    for (const t of [2, 10, 144, 278, 286]) for (const l of [-36, -28, 28, 36]) expect(inside(t, l), `post t ${t} l ${l}`).toBe(true);
    for (const l of [-41, 41]) expect(inside(216, l)).toBe(true);
    expect(inside(144, 0)).toBe(true);
    // Not the line at its ends (the track joined there), nor past its frame.
    expect(inside(2, 0)).toBe(false);
    expect(inside(286, 0)).toBe(false);
    expect(inside(144, 46)).toBe(false);
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

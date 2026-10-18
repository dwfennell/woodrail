import { describe, expect, it } from "vitest";
import { checkPlacement, FEAT_BUILDING, FEAT_FIELD, FEAT_SHED, gridWithPlots, SURF_LANE, SURF_RIVER, SURF_ROAD, SURF_SEA, SURF_TOWN, type Landscape } from "../landscape";
import { PropStore } from "../props/store";
import { appendPiece, connectorRef, findSplice, Layout, type PieceTypeId, type Pose } from "../track";
import { checkYard, flipHint, footprintInYards, inYardMessage, placedYard, propPhrase, trackInYards, townMessage, turnedRound, YARD_FLIP_HINT, YARD_NO_ROOM, yardMessage, yardParts, type PlacedYard, type YardCheck, type YardObstacle } from "./depot-footprint";

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
    // Refused in town, a depot is told it by name (the track is told it as track).
    expect(townMessage("depot-workshop")).toBe("Keep the workshop out of town");
    expect(townMessage("depot-forest")).toBe("Keep the forest yard out of town");
    expect(townMessage("straight-216")).toBe("Keep the track out of town");
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

describe("a yard's refusal says what's in the way", () => {
  /** The message for the workshop at `pose`, as the game says it. */
  const say = (ctx: YardCheck, type: PieceTypeId = "depot-workshop", pose: Pose = AT): string | null => {
    const out: YardObstacle = { what: null };
    const why = checkYard(ctx, type, pose, 0, -1, out);
    return why && yardMessage(type, why, out.what);
  };

  it("names what's on the ground: a house, a field, the shed, the town, a road, a lane, the river, the sea, a hill", () => {
    const cases: [number | null, number | null, number | null, string][] = [
      [FEAT_BUILDING, null, null, "The workshop's yard needs open ground: a house is in the way"],
      [FEAT_FIELD, null, null, "The workshop's yard needs open ground: a field is in the way"],
      [FEAT_SHED, null, null, "The workshop's yard needs open ground: the engine shed is in the way"],
      [null, SURF_TOWN, null, "The workshop's yard needs open ground: the town is in the way"],
      [null, SURF_ROAD, null, "The workshop's yard needs open ground: a road is in the way"],
      [null, SURF_LANE, null, "The workshop's yard needs open ground: a lane is in the way"],
      [null, SURF_RIVER, null, "The workshop's yard is in the river"],
      [null, SURF_SEA, null, "The workshop's yard is in the sea"],
      [null, null, 1, "The workshop's yard is on a hill"],
    ];
    for (const [feature, surface, height, message] of cases) {
      const ctx = setup();
      setCells(ctx.land, 100, 110, 60, 70, (i) => {
        if (feature !== null) ctx.land.grid.feature[i] = feature;
        if (surface !== null) ctx.land.grid.surface[i] = surface;
        if (height !== null) ctx.land.grid.height[i] = height;
      });
      expect(say(ctx), message).toBe(message);
    }
    // Past the map's edge.
    expect(say(setup(), "depot-workshop", P(1e5, 0))).toBe("The workshop's yard needs open ground: the edge of the map is in the way");
  });

  it("names a prop, other track, or another yard", () => {
    const tree = setup();
    tree.props.add("scene-apple-tree", { x: 60, z: 90, heading: 0, y: 0 });
    expect(say(tree)).toBe("The workshop's yard needs open ground: a tree is in the way");
    const barn = setup();
    barn.props.add("bldg-red-barn", { x: 60, z: 90, heading: 0, y: 0 });
    expect(say(barn)).toBe("The workshop's yard needs open ground: a red barn is in the way");
    expect(propPhrase({ asset: "bldg-apartment-block" })).toBe("an apartment block");
    expect(propPhrase({ asset: "life-swans" })).toBe("swans");
    expect(propPhrase({ asset: "veh-town-bus" })).toBe("a town bus");
    const ducks = setup();
    ducks.props.add("life-ducks", { x: 60, z: 90, heading: 0, y: 0 });
    expect(say(ducks)).toBe("The workshop's yard needs open ground: ducks are in the way");

    const track = setup();
    track.layout.addPiece("straight-216", P(0, 80));
    expect(say(track)).toBe("The workshop's yard needs open ground: the track is in the way");
    const depots = setup();
    depots.layout.addPiece("depot-sawmill", P(100, 0));
    expect(say(depots, "depot-workshop", P(0, 10))).toBe("The workshop's yard needs open ground: the sawmill's yard is in the way");
    // With nothing said, the message is as it was.
    expect(yardMessage("depot-workshop", "yard-ground")).toBe("The workshop's yard needs open ground");
    expect(yardMessage("depot-workshop", "yard-water")).toBe("The workshop's yard is in the water");
  });

  it("and for the crane's legs", () => {
    const ctx = setup();
    ctx.props.add("rock", { x: 108, z: 31 - 25, heading: 0, y: 0 });
    ctx.footprint = () => ({ cx: 0, cz: 0, hw: 2, hd: 2 });
    expect(say(ctx, "depot-sawmill", P(0, 31))).toBe("The crane's legs need open ground: a rock is in the way");
    const water = setup();
    setCells(water.land, 100, 116, 150, 160, (i) => (water.land.grid.surface[i] = SURF_RIVER));
    expect(say(water, "depot-sawmill", P(0, 31))).toBe("The crane's legs are in the river");
  });
});

describe("a gantry crane's legs", () => {
  // A sawmill's gantry stands at t 108, its legs at l −25 (across the line) and l 115 (past the yard's far edge).
  it("are refused on their own when only they clash, the yard being clear", () => {
    // At z 31, the yard's samples reach z 143 and the far leg's z 145–147: a hill from z 144 is under the leg only.
    const at = P(0, 31);
    const hill = setup();
    setCells(hill.land, 100, 116, 150, 160, (i) => (hill.land.grid.height[i] = 1));
    expect(checkYard(hill, "depot-workshop", at, 0, -1)).toBeNull();
    expect(checkYard(hill, "depot-sawmill", at, 0, -1)).toBe("crane-hill");
    expect(yardMessage("depot-sawmill", "crane-hill")).toBe("The crane's legs are on a hill");

    const water = setup();
    setCells(water.land, 100, 116, 150, 160, (i) => (water.land.grid.surface[i] = SURF_RIVER));
    expect(checkYard(water, "depot-sawmill", at, 0, -1)).toBe("crane-water");
    expect(yardMessage("depot-sawmill", "crane-water")).toBe("The crane's legs are in the water");

    // The leg across the line: at z 21 the track's samples (z 3–39) stay in row 0, the leg (z −7 to −1) is in row −1.
    const across = setup();
    setCells(across.land, 100, 116, -60, -4, (i) => (across.land.grid.height[i] = 1));
    expect(checkPlacement(across.land, "depot-sawmill", false, P(0, 21), 0)).toEqual({ kind: "clear" });
    expect(checkYard(across, "depot-sawmill", P(0, 21), 0, -1)).toBe("crane-hill");

    const prop = setup();
    // (On the leg across the line: the far one stands just past the pad's edge.)
    prop.props.add("rock", { x: 108, z: 31 - 25, heading: 0, y: 0 });
    prop.footprint = () => ({ cx: 0, cz: 0, hw: 2, hd: 2 });
    expect(checkYard(prop, "depot-sawmill", at, 0, -1)).toBe("crane-ground");
    expect(yardMessage("depot-sawmill", "crane-ground")).toBe("The crane's legs need open ground");
  });

  it("the yard's own trouble is said first", () => {
    const ctx = setup();
    const at = P(0, 31);
    setCells(ctx.land, 100, 116, 150, 160, (i) => (ctx.land.grid.height[i] = 1));
    setCells(ctx.land, 150, 160, 100, 104, (i) => (ctx.land.grid.feature[i] = FEAT_BUILDING));
    expect(checkYard(ctx, "depot-sawmill", at, 0, -1)).toBe("yard-ground");
  });
});

describe("a player's depot's yard keeps other things out", () => {
  const yards = (): PlacedYard[] => [placedYard(7, "depot-workshop", AT, 0)!];

  it("knows its yard's bounding box", () => {
    const [y] = yards();
    expect(y).toMatchObject({ pieceId: 7, x0: 10, x1: 206, z0: 30, z1: 114 });
    expect(placedYard(1, "straight-216", AT, 0)).toBeNull();
  });

  it("refuses track through it, says whose it is, and lets it by alongside, over it, or when it's the depot itself", () => {
    expect(trackInYards(yards(), "straight-216", false, P(0, 80), 0, -1)?.pieceId).toBe(7);
    expect(inYardMessage("depot-workshop")).toBe("That's the workshop's yard");
    expect(inYardMessage("depot-forest")).toBe("That's the forest yard");
    // Its own line, end on, and a line beyond its far side.
    expect(trackInYards(yards(), "straight-216", false, P(216, 0), 0, -1)).toBeNull();
    expect(trackInYards(yards(), "straight-216", false, P(0, 140), 0, -1)).toBeNull();
    // Two levels up: a bridge over it.
    expect(trackInYards(yards(), "straight-216", false, P(0, 80), 96, -1)).toBeNull();
    // The depot being moved leaves its own yard.
    expect(trackInYards(yards(), "straight-216", false, P(0, 80), 0, 7)).toBeNull();
    // Across it, from far off.
    expect(trackInYards(yards(), "straight-216", false, P(100, -100, Math.PI / 2), 0, -1)?.pieceId).toBe(7);
    expect(trackInYards([], "straight-216", false, P(0, 80), 0, -1)).toBeNull();
  });

  it("refuses a prop standing in it", () => {
    const fp = { cx: 0, cz: 0, hw: 10, hd: 10 };
    expect(footprintInYards(yards(), fp, P(100, 70))?.pieceId).toBe(7);
    expect(footprintInYards(yards(), fp, P(100, 130))).toBeNull();
    expect(footprintInYards(yards(), fp, P(100, -40))).toBeNull();
  });
});

describe("the flip hint (yard the other side of the line)", () => {
  /** The full check of a workshop at a pose: its track's own, then its yard's. */
  const why = (ctx: ReturnType<typeof setup>) => (pose: Pose) => {
    const track = checkPlacement(ctx.land, "depot-workshop", false, pose, 0);
    return track.kind !== "clear" ? track.reason : checkYard(ctx, "depot-workshop", pose, 0, -1);
  };

  it("with water one side of a straight and a hill the other, there's no flip hint either way: no room for the yard", () => {
    const ctx = setup();
    // A hill on the yard's side (row 1: z 72–144), the river on the other (row −2: z −144 to −72).
    setCells(ctx.land, 80, 130, 80, 130, (i) => (ctx.land.grid.height[i] = 1));
    setCells(ctx.land, 80, 130, -130, -80, (i) => (ctx.land.grid.surface[i] = SURF_RIVER));
    const turned = turnedRound("depot-workshop", AT);
    expect(why(ctx)(AT)).toBe("yard-hill");
    expect(why(ctx)(turned)).toBe("yard-water");
    expect(flipHint("depot-workshop", AT, why(ctx))).toBe(YARD_NO_ROOM);
    expect(flipHint("depot-workshop", turned, why(ctx))).toBe(YARD_NO_ROOM);
  });

  it("with only the hill, held with its yard on the hill it says Flip; turned round it fits (and needs no hint)", () => {
    const ctx = setup();
    setCells(ctx.land, 80, 130, 80, 130, (i) => (ctx.land.grid.height[i] = 1));
    expect(flipHint("depot-workshop", AT, why(ctx))).toBe(YARD_FLIP_HINT);
    expect(why(ctx)(turnedRound("depot-workshop", AT))).toBeNull();
  });

  it("turned round, its track refused for something else (not its yard): no hint", () => {
    expect(flipHint("depot-workshop", AT, () => "building")).toBeNull();
  });

  it("refused for anything as held (too few trees, the river), it says Flip whenever it'd fit turned round (QA)", () => {
    // A Harvester short of trees as held ("Needs trees nearby: 4 of 5"), fine turned round: the Flip hint, as for
    // its yard (QA: one pair at a joint said Flip, the other only how many trees).
    const turned = turnedRound("depot-forest", AT);
    const asked: Pose[] = [];
    expect(flipHint("depot-forest", AT, (pose) => (asked.push(pose), null), "site")).toBe(YARD_FLIP_HINT);
    expect(asked).toEqual([turned]);
    expect(flipHint("depot-workshop", AT, () => null, "river")).toBe(YARD_FLIP_HINT);
    // Turned round its yard won't go: what's said for where it's held stands (not "No room for the yard here").
    expect(flipHint("depot-forest", AT, () => "yard-hill", "site")).toBeNull();
    expect(flipHint("depot-forest", AT, () => "site", "site")).toBeNull();
    // Refused for its yard both ways: no room.
    expect(flipHint("depot-forest", AT, () => "yard-water", "yard-hill")).toBe(YARD_NO_ROOM);
  });
});

import { describe, expect, it } from "vitest";
import { bridgeLevels, checkPlacement, gridWithPlots, hillsOf, syncCuttings, type BlockReason, type Landscape } from "../landscape";
import { encodeRoad } from "../roads/pieces";
import { RoadPlacer } from "../roads/place";
import { DrawLine, isBridge, isPlainStraight, Layout, lowCrossings, RISER_HEIGHT, UNDERPASS_LENGTH, type DrawEnd, type DrawOptions, type Pose } from "../track";
import { drawMessage, drawRefusal, trackMessage, trackPlacement, type TrackRules } from "./track-rules";
import { planUnderpass, planUnderpassAhead, UNDER_BRIDGE } from "./underpass-dig";

/** Underpasses on a hilltop (cut into the hill), by roads (refused, both ways), and under a bridge on a drawn line. */

const ONE = RISER_HEIGHT;

function flat(): Landscape {
  return { seed: 0, starter: false, grid: gridWithPlots(-2, -2, 3, 3), towns: [], corridors: [], fields: [], shed: null, depots: [], nextBuildingId: 0 };
}

/** Squares whose centres lie in x0..x1 × z0..z1: `h` blocks high. */
function hill(land: Landscape, x0: number, x1: number, z0: number, z1: number, h: number): Landscape {
  const g = land.grid;
  for (let x = x0 + 36; x < x1; x += 72)
    for (let z = z0 + 36; z < z1; z += 72) {
      const i = g.cellAtWorld(x, z);
      if (i !== -1) g.height[i] = h;
    }
  g.revision++;
  return land;
}

const bridgeAt = (x: number, z: number, heading: number): Pose => ({ x: x - 108 * Math.cos(heading), z: z - 108 * Math.sin(heading), heading });

describe("an underpass on a hilltop", () => {
  it("goes down on a level hilltop, and is cut into the hill: the ground drops to its dip in the trench, and stays put beside it", () => {
    const land = hill(flat(), -720, 720, -432, 432, 1);
    const layout = new Layout();
    // Mid-square on the hill (z = 36), well inside it.
    const pose = { x: -144, z: 36, heading: 0 };
    expect(checkPlacement(land, "underpass", false, pose, ONE).kind).toBe("clear");
    // Not on the felt beside the hill at the hill's height, nor on the hill at the felt's.
    expect(checkPlacement(land, "underpass", false, pose, 0)).toEqual({ kind: "blocked", reason: "dip" });
    layout.addPiece("underpass", pose, ONE);
    syncCuttings(land, layout);
    const hills = hillsOf(land.grid);
    expect(hills.groundAt(0, 36)).toBeCloseTo(ONE - 30, 0);
    // Beside the trench (past its walls) and past its ends: the hilltop.
    expect(hills.groundAt(0, 36 + 40)).toBe(ONE);
    expect(hills.groundAt(-200, 36)).toBe(ONE);
    expect(hills.cutBlocks().length).toBeGreaterThan(0);
  });

  it("a line on a hilltop, a bridge a level above it: an underpass is dug, cut into the hill", () => {
    const land = hill(flat(), -720, 720, -432, 432, 1);
    const layout = new Layout();
    for (let k = 0; k < 5; k++) layout.addPiece("straight-216", { x: -540 + k * 216, z: 36, heading: 0 }, ONE);
    const rules: TrackRules = { land, layout, props: null, footprint: () => undefined };
    const pose = bridgeAt(0, 36, Math.PI / 2);
    const plan = planUnderpass(rules, "bridge", false, pose, 2 * ONE, -1);
    expect(plan?.kind).toBe("dig");
    if (plan?.kind !== "dig") return;
    for (const id of plan.covers) layout.removePiece(id);
    for (const q of plan.pieces) layout.addPiece(q.type, q.pose, q.y, q.flipped);
    syncCuttings(land, layout);
    // The trench cut into the hill under it isn't ground it stands in: it's still a level up, on its piers.
    expect(hillsOf(land.grid).groundAt(0, 36)).toBeCloseTo(ONE - 30, 0);
    expect(bridgeLevels(land, "bridge", false, pose, 2 * ONE)).toBe(1);
  });
});

describe("an underpass and a road", () => {
  it("can't be laid across a road (square on or beside its trench), saying why", () => {
    const land = flat();
    const g = land.grid;
    // A straight road along z through x = 36's square.
    const i = g.cellAtWorld(36, 36);
    g.road[i] = encodeRoad("straight", 1);
    // The track across it (a level crossing): fine for a straight; an underpass: refused.
    expect(checkPlacement(land, "straight-216", false, { x: -72, z: 36, heading: 0 }, 0).kind).toBe("clear");
    expect(checkPlacement(land, "underpass", false, { x: -108, z: 36, heading: 0 }, 0)).toEqual({ kind: "blocked", reason: "dip-road" });
    // Running beside the road square, its trench reaching over it.
    const beside = flat();
    beside.grid.road[beside.grid.cellAtWorld(36, 108)] = encodeRoad("straight", 0);
    expect(checkPlacement(beside, "underpass", false, { x: -108, z: 36 + 6, heading: 0 }, 0)).toEqual({ kind: "blocked", reason: "dip-road" });
  });

  it("no road can be laid over an underpass's trench", () => {
    const land = flat();
    const layout = new Layout();
    layout.addPiece("underpass", { x: -144, z: 36, heading: 0 }, 0);
    const placer = new RoadPlacer(land, layout);
    const g = land.grid;
    // Square on over its middle, and over its wall.
    expect(placer.check(g.cellAtWorld(36, 36), encodeRoad("straight", 1))).toBe("underpass");
    expect(placer.check(g.cellAtWorld(-36, 36), encodeRoad("straight", 1))).toBe("underpass");
    // Well clear of it: fine.
    expect(placer.check(g.cellAtWorld(36, 324), encodeRoad("straight", 1))).toBe(null);
  });
});

describe("a drawn line on the ground meeting a bridge one level up", () => {
  /** The game's checks as DrawHand reads them, with Interaction's "under-bridge" and the `under` hook. */
  function options(land: Landscape, layout: Layout): DrawOptions {
    const rules: TrackRules = { land, layout, props: null, footprint: () => undefined };
    return {
      check: (c) => {
        const p = trackPlacement(rules, c.type, c.flipped, c.pose, c.y, -1);
        let reason: string | null = p.reason;
        if ((reason === "headroom" || reason === "piece") && isPlainStraight(c.type)) {
          const lows = lowCrossings(layout, c.type, c.flipped, c.pose, c.y, -1);
          if (lows.length === 1 && isBridge(layout.getPiece(lows[0])!.type) && Math.abs(layout.getPiece(lows[0])!.y - c.y - ONE) < 1) reason = "under-bridge";
        }
        const why = drawRefusal(land, c.type, c.flipped, c.pose, c.y, reason, p.risers);
        return why ? { reason: why.reason, message: drawMessage(why.reason, why.levels, (r) => (r === "under-bridge" ? UNDER_BRIDGE : trackMessage(r as BlockReason, why.levels))), levels: why.levels } : null;
      },
      under: (type, end) => {
        const plan = planUnderpassAhead(rules, type, false, { x: end.x, z: end.z, heading: end.heading }, end.y, -1, true);
        return plan?.kind === "dig" ? plan.pieces.map((q) => q.type) : null;
      },
      groundAt: () => 0,
      onMap: (x, z) => land.grid.cellAtWorld(x, z) !== -1,
      outOf: (t) => `Out of ${t}`,
    };
  }

  it("goes on under it through an underpass, its middle under the bridge", () => {
    for (const x0 of [-540, -468, -432, -396, -324]) {
      const land = flat();
      const layout = new Layout();
      layout.addPiece("bridge", bridgeAt(0, 36, Math.PI / 2), ONE);
      const start: DrawEnd = { x: x0, z: 36, heading: 0, y: 0, kind: "peg" };
      const line = new DrawLine(start, options(land, layout));
      for (let x = x0 + 4; x <= 520; x += 4) line.addPoint(x, 36);
      line.finish();
      const names = line.pieces.map((q) => `${q.type}${q.blocked ? "!" : ""}`).join(" ");
      const u = line.pieces.find((q) => q.type === "underpass");
      expect(u, `from ${x0}: ${names}`).toBeDefined();
      expect(line.pieces.some((q) => q.blocked && line.pieces.indexOf(q) <= line.pieces.indexOf(u!)), names).toBe(false);
      const mid = u!.pose.x + (UNDERPASS_LENGTH / 2) * Math.cos(u!.pose.heading);
      expect(Math.abs(mid), names).toBeLessThanOrEqual(27);
    }
  });

  it("where none fits (a slanting crossing), the straight shows red, saying how one would", () => {
    const land = flat();
    const layout = new Layout();
    layout.addPiece("bridge", bridgeAt(0, 36, (15 * Math.PI) / 180), ONE);
    const line = new DrawLine({ x: -468, z: 36, heading: 0, y: 0, kind: "peg" }, options(land, layout));
    for (let x = -464; x <= 400; x += 4) line.addPoint(x, 36);
    line.finish();
    expect(line.pieces.some((q) => q.type === "underpass")).toBe(false);
    expect(line.pieces.find((q) => q.blocked)?.blockedBy).toBe("under-bridge");
  });
});

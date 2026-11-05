import { describe, expect, it } from "vitest";
import { BLOCK_MESSAGES, bridgeLevels, checkPlacement, checkSupport, gridWithPlots, hillsOf, plinthLevels, syncCuttings, type BlockReason, type Landscape } from "../landscape";
import { encodeRoad } from "../roads/pieces";
import { RoadPlacer } from "../roads/place";
import { DRAW_TYPES, DrawLine, isBridge, isPlainStraight, Layout, lowCrossings, overUnderpass, RISER_HEIGHT, UNDERPASS_LENGTH, type DrawEnd, type DrawOptions, type Pose } from "../track";
import { drawMessage, drawRefusal, trackMessage, trackPlacement, type TrackRules } from "./track-rules";
import { DIG_MESSAGES, planUnderpass, planUnderpassAhead, UNDER_BRIDGE } from "./underpass-dig";

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
    // Not on the hill at the felt's height: it would dig into the hillside.
    expect(checkPlacement(land, "underpass", false, pose, 0)).toEqual({ kind: "blocked", reason: "dip-hill" });
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

/** The game's checks as DrawHand reads them, with Interaction's "under-bridge" and the `under` hook. */
function options(land: Landscape, layout: Layout): DrawOptions {
  const rules: TrackRules = { land, layout, props: null, footprint: () => undefined };
  return {
    check: (c) => {
      const p = trackPlacement(rules, c.type, c.flipped, c.pose, c.y, -1);
      let reason: string | null = p.reason;
      if ((reason === "headroom" || reason === "piece") && (isPlainStraight(c.type) || DRAW_TYPES.includes(c.type))) {
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


describe("a drawn line on the ground meeting a bridge one level up", () => {
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

describe("an underpass off a hill's edge", () => {
  /** A hill a level up west of x = 0 (z −432..432), and a line along it at the hill's height running on off its edge onto risers. */
  function edge(): { land: Landscape; layout: Layout; rules: TrackRules } {
    const land = hill(flat(), -864, 0, -432, 432, 1);
    const layout = new Layout();
    const rules: TrackRules = { land, layout, props: null, footprint: () => undefined };
    for (let k = 0; k < 6; k++) {
      const pose = { x: -864 + k * 216, z: 36, heading: 0 };
      const t = trackPlacement(rules, "straight-216", false, pose, ONE, -1);
      expect(t.reason).toBe(null);
      layout.addPiece("straight-216", pose, ONE);
      for (const r of t.risers) layout.addPiece("riser", r.pose, r.y);
    }
    return { land, layout, rules };
  }

  it("goes down part on the hilltop, part over the felt below on a plinth a level high, and holds up the track it joins", () => {
    const land = hill(flat(), -864, 0, -432, 432, 1);
    const layout = new Layout();
    const pose = { x: -144, z: 36, heading: 0 };
    expect(checkPlacement(land, "underpass", false, pose, ONE).kind).toBe("clear");
    expect(plinthLevels(land, "underpass", false, pose, ONE)).toBe(1);
    // Held up without risers (its block stands on the felt), and track on from its end rests on it.
    expect(checkSupport(land, layout, "underpass", false, pose, ONE, -1)).toEqual({ kind: "held", risers: [] });
    layout.addPiece("underpass", pose, ONE);
    expect(checkSupport(land, layout, "straight-216", false, { x: 144, z: 36, heading: 0 }, ONE, -1).kind).toBe("held");
    const on = checkSupport(land, layout, "straight-216", false, { x: 144, z: 36, heading: 0 }, ONE, -1);
    // (A riser under its far end only, not at the joint with the underpass.)
    expect(on.kind === "held" && on.risers.map((r) => Math.round(r.pose.x))).toEqual([360]);
    // On the hilltop it's sunk in it: no plinth.
    expect(plinthLevels(land, "underpass", false, { x: -576, z: 36, heading: 0 }, ONE)).toBe(0);
  });

  it("is refused where it would dig into the hillside, or the ground under it isn't whole levels down, saying why", () => {
    const land = hill(flat(), -864, 0, -432, 432, 1);
    // On the felt at the hill's foot, running into it: a hillside.
    expect(checkPlacement(land, "underpass", false, { x: -144, z: 36, heading: 0 }, 0)).toEqual({ kind: "blocked", reason: "dip-hill" });
    expect(BLOCK_MESSAGES["dip-hill"]).toMatch(/hillside/);
    // Half a level up off the edge: nothing for its block to stand on.
    expect(checkPlacement(land, "underpass", false, { x: -144, z: 36, heading: 0 }, ONE + 24)).toEqual({ kind: "blocked", reason: "dip" });
  });

  it("a bridge a level above a hilltop line near its edge digs one running off the edge: a girder span, the risers under it taken up", () => {
    for (const cx of [-100, -60, -20, 0, 40]) {
      const { land, layout, rules } = edge();
      const bridge = bridgeAt(cx, 36, Math.PI / 2);
      const plan = planUnderpass(rules, "bridge", false, bridge, 2 * ONE, -1);
      expect(plan?.kind, `at ${cx}: ${plan?.kind === "refused" ? plan.why : ""}`).toBe("dig");
      if (plan?.kind !== "dig") continue;
      const risers = plan.covers.filter((id) => layout.getPiece(id)!.type === "riser");
      for (const id of plan.covers) layout.removePiece(id);
      const ids = plan.pieces.map((q) => layout.addPiece(q.type, q.pose, q.y, q.flipped));
      const b = layout.addPiece("bridge", bridge, 2 * ONE);
      syncCuttings(land, layout);
      const u = layout.getPiece(ids[plan.pieces.findIndex((q) => q.type === "underpass")])!;
      const mid = u.pose.x + UNDERPASS_LENGTH / 2;
      expect(Math.abs(mid - cx)).toBeLessThanOrEqual(27);
      // Off the edge (its far end past x = 0): on a plinth.
      expect(u.pose.x + UNDERPASS_LENGTH).toBeGreaterThan(0);
      expect(plinthLevels(land, u.type, u.flipped, u.pose, u.y)).toBe(1);
      expect(overUnderpass(layout, layout.getPiece(b)!)).toBe(true);
      // No riser left standing in its block.
      for (const id of layout.pieceIds()) {
        const q = layout.getPiece(id)!;
        if (q.type === "riser") expect(q.pose.x < u.pose.x - 20 || q.pose.x > u.pose.x + UNDERPASS_LENGTH + 20, `riser at ${q.pose.x}`).toBe(true);
      }
      // Every piece put down is held up (no new risers needed), the bridge too.
      for (const id of ids) {
        const q = layout.getPiece(id)!;
        const s = checkSupport(land, layout, q.type, q.flipped, q.pose, q.y, id);
        expect(s.kind === "held" ? s.risers.length : -1, `${q.type} at ${q.pose.x} (cx ${cx})`).toBe(0);
      }
      expect(bridgeLevels(land, "bridge", false, bridge, 2 * ONE)).toBeGreaterThanOrEqual(1);
      void risers;
    }
  });

  it("a line on the felt along a hill's foot: the trench would dig into the hillside, and the bridge is refused saying so", () => {
    const land = hill(flat(), -864, 864, -432, 0, 1);
    const layout = new Layout();
    // The line 22 mm out from the hill's edge (z = 0): clear of it, but the trench's wall would cut into it.
    for (let k = 0; k < 6; k++) layout.addPiece("straight-216", { x: -648 + k * 216, z: 22, heading: 0 }, 0);
    const rules: TrackRules = { land, layout, props: null, footprint: () => undefined };
    const plan = planUnderpass(rules, "bridge", false, bridgeAt(0, 22, Math.PI / 2), ONE, -1);
    expect(plan).toEqual({ kind: "refused", why: "hillside" });
    expect(DIG_MESSAGES.hillside).toMatch(/hillside/);
  });
});

describe("a line drawn at a slant under a bridge one level up", () => {
  /** Draw a stroke from `start` (heading 0) towards `deg` from the grid, through the bridge's middle at the origin. */
  function drawSlant(deg: number, bridgeDeg: number) {
    const big: Landscape = { ...flat(), grid: gridWithPlots(-3, -3, 4, 4) };
    const layout = new Layout();
    layout.addPiece("bridge", bridgeAt(0, 0, (bridgeDeg * Math.PI) / 180), ONE);
    const ph = (deg * Math.PI) / 180;
    const x0 = -468 * Math.cos(ph);
    const z0 = -468 * Math.sin(ph);
    const line = new DrawLine({ x: x0, z: z0, heading: 0, y: 0, kind: "peg" }, options(big, layout));
    let worst = 0;
    for (let s = 4; s <= 1000; s += 4) {
      const t = performance.now();
      line.addPoint(x0 + s * Math.cos(ph), z0 + s * Math.sin(ph));
      worst = Math.max(worst, performance.now() - t);
    }
    line.finish();
    return { line, layout, worst, names: line.pieces.map((q) => `${q.type}${q.blocked ? "!" : ""}`).join(" ") };
  }

  it("zigzagging (straights and curves) it straightens out to cross under the bridge's middle through an underpass", () => {
    // Strokes at 20°, 30° and 60° to the grid, the bridge square across them or at 60°.
    for (const [deg, bridgeDeg] of [
      [20, 110],
      [20, 80],
      [30, 120],
      [30, 90],
      [60, 150],
      [60, 120],
      [45, 135],
    ]) {
      const { line, names } = drawSlant(deg, bridgeDeg);
      const k = line.pieces.findIndex((q) => q.type === "underpass");
      expect(k, `${deg}° under ${bridgeDeg}°: ${names}`).toBeGreaterThan(0);
      expect(line.pieces.slice(0, k + 1).some((q) => q.blocked), names).toBe(false);
      // Its middle under the bridge (on its line, between its piers: the plan checks they stand clear of the trench).
      const u = line.pieces[k];
      const mx = u.pose.x + (UNDERPASS_LENGTH / 2) * Math.cos(u.pose.heading);
      const mz = u.pose.z + (UNDERPASS_LENGTH / 2) * Math.sin(u.pose.heading);
      const b = (bridgeDeg * Math.PI) / 180;
      expect(Math.abs(-mx * Math.sin(b) + mz * Math.cos(b)), names).toBeLessThanOrEqual(27);
      expect(Math.abs(mx * Math.cos(b) + mz * Math.sin(b)), names).toBeLessThan(80);
      // The line goes on past it.
      expect(line.pieces.length, names).toBeGreaterThan(k + 1);
    }
  });

  it("where no straight way under the bridge's middle crosses it squarely enough, the piece shows red, saying how", () => {
    // A bridge almost along the stroke: every way under it is too shallow.
    const { line, names } = drawSlant(20, 35);
    expect(line.pieces.some((q) => q.type === "underpass"), names).toBe(false);
    expect(line.pieces.find((q) => q.blocked)?.blockedBy, names).toBe("under-bridge");
  });

  it("looking for a way under costs a few milliseconds on a pointer move at most", () => {
    let worst = 0;
    for (const [deg, b] of [
      [10, 100],
      [20, 110],
      [20, 35],
    ])
      worst = Math.max(worst, drawSlant(deg, b).worst);
    // (Node on a desktop; the first stroke warms up the code.)
    expect(worst).toBeLessThan(40);
  });
});

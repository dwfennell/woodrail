import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { checkPlacement, checkSupport, gridWithPlots, hillsOf, inTunnel, setTunnels, syncCuttings, type Landscape } from "../landscape";
import { findTunnels } from "../render/tunnels-view";
import { findLowCrossing, Layout, RISER_HEIGHT } from "../track";
import { trackBlock, type TrackRules } from "./track-rules";
import { planTunnel } from "./tunnel-dig";

/** The tunnels prototype (docs/superpowers/specs/2026-11-04-tunnels.md): track under two levels of ground. */

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

/** A hill as the land editor makes them: a level a square, up to two (x 144..288 and 576..720 one level, between two). */
function steppedHill(): Landscape {
  const land = hill(flat(), 144, 720, -216, 216, 1);
  return hill(land, 288, 576, -216, 216, 2);
}

const rulesOf = (land: Landscape, layout = new Layout()): TrackRules => ({ land, layout, props: null, footprint: () => undefined });

beforeEach(() => setTunnels(true));
afterEach(() => setTunnels(false));

describe("tunnels: placement", () => {
  it("off (as today), a straight into a hill is refused; on, under two levels it's in a tunnel and goes down", () => {
    const land = hill(flat(), 144, 576, -216, 216, 2);
    setTunnels(false);
    expect(checkPlacement(land, "straight-216", false, { x: 216, z: 36, heading: 0 }, 0)).toEqual({ kind: "blocked", reason: "hill" });
    setTunnels(true);
    expect(checkPlacement(land, "straight-216", false, { x: 216, z: 36, heading: 0 }, 0).kind).toBe("clear");
    // Across the hill's side, square to it: clear (a portal stands there).
    expect(checkPlacement(land, "straight-216", false, { x: 36, z: 36, heading: 0 }, 0).kind).toBe("clear");
    expect(inTunnel(land, 300, 36, 0)).toBe(true);
    expect(inTunnel(land, 100, 36, 0)).toBe(false);
  });

  it("refuses a line meeting the hill's side at a slant", () => {
    const land = hill(flat(), 144, 576, -216, 216, 2);
    expect(checkPlacement(land, "straight-216", false, { x: 0, z: 0, heading: 0.4 }, 0)).toEqual({ kind: "blocked", reason: "portal" });
  });

  it("a plain straight cuts through one level of hill (a cutting); a curve can't", () => {
    const land = steppedHill();
    expect(checkPlacement(land, "straight-108", false, { x: 150, z: 36, heading: 0 }, 0).kind).toBe("clear");
    expect(checkPlacement(land, "curve-large", false, { x: 150, z: 36, heading: 0 }, 0)).toEqual({ kind: "blocked", reason: "hill" });
  });

  it("the cutting is a slot through the one-level step only: the two-level hill stays whole over the tunnel", () => {
    const land = steppedHill();
    const layout = new Layout();
    for (let k = 0; k < 4; k++) layout.addPiece("straight-216", { x: k * 216, z: 36, heading: 0 }, 0);
    syncCuttings(land, layout);
    const hills = hillsOf(land.grid);
    expect(hills.groundAt(200, 36)).toBe(0);
    expect(hills.groundAt(200, 36 + 40)).toBe(ONE);
    expect(hills.groundAt(400, 36)).toBe(2 * ONE);
    expect(hills.groundAt(650, 36)).toBe(0);
    // Only the one-level blocks along the line are cut.
    // (The two-level blocks inside the hill aren't cut; those at its sides are touched only at their edge.)
    expect(hills.cutBlocks().every((b) => b.col * 72 < 288 || b.col * 72 >= 504)).toBe(true);
  });

  it("track two levels under the felt (cut and cover) goes down; one level under, it's refused", () => {
    const land = flat();
    expect(checkPlacement(land, "straight-216", false, { x: 0, z: 36, heading: 0 }, -2 * ONE).kind).toBe("clear");
    expect(checkPlacement(land, "straight-216", false, { x: 0, z: 36, heading: 0 }, -ONE)).toEqual({ kind: "blocked", reason: "shallow" });
  });

  it("under the felt, a town, a road or a river over it don't matter", () => {
    const land = flat();
    const g = land.grid;
    const i = g.cellAtWorld(108, 36);
    g.road[i] = 1;
    expect(checkPlacement(land, "straight-216", false, { x: 0, z: 36, heading: 0 }, 0).kind).toBe("blocked");
    expect(checkPlacement(land, "straight-216", false, { x: 0, z: 36, heading: 0 }, -2 * ONE).kind).toBe("clear");
  });

  it("a tunnel mouth goes down on flat felt, not on a hill, not across a road", () => {
    const land = flat();
    expect(checkPlacement(land, "tunnel-mouth", false, { x: 0, z: 36, heading: 0 }, 0).kind).toBe("clear");
    expect(checkPlacement(land, "tunnel-mouth", false, { x: 0, z: 36, heading: 0 }, ONE)).toEqual({ kind: "blocked", reason: "mouth" });
    hill(land, 144, 288, -216, 216, 1);
    expect(checkPlacement(land, "tunnel-mouth", false, { x: 0, z: 36, heading: 0 }, 0)).toEqual({ kind: "blocked", reason: "mouth" });
  });

  it("track in a tunnel is held up (it lies on the tunnel's floor)", () => {
    const land = flat();
    const layout = new Layout();
    expect(checkSupport(land, layout, "straight-216", false, { x: 0, z: 36, heading: 0 }, -2 * ONE, -1).kind).toBe("held");
    expect(checkSupport(land, layout, "tunnel-mouth", false, { x: 0, z: 36, heading: 0 }, 0, -1).kind).toBe("held");
  });

  it("a line on the felt crosses over the cut-and-cover tunnel (two levels over it: headroom)", () => {
    const land = flat();
    const layout = new Layout();
    layout.addPiece("tunnel-mouth", { x: -288, z: 36, heading: 0 }, 0);
    layout.addPiece("straight-216", { x: 0, z: 36, heading: 0 }, -2 * ONE);
    const rules = rulesOf(land, layout);
    const across = { x: 108, z: -108, heading: Math.PI / 2 };
    expect(findLowCrossing(layout, "straight-216", false, across, 0, -1)).toBe(-1);
    expect(trackBlock(rules, "straight-216", false, across, 0, -1)).toBeNull();
  });
});

describe("tunnels: planTunnel (a straight bored through the hill ahead)", () => {
  it("through a stepped hill: a cutting in, the tunnel, a cutting out, and on to open ground", () => {
    const land = steppedHill();
    const plan = planTunnel(rulesOf(land), { x: 0, z: 36, heading: 0 }, 0);
    expect(plan.kind).toBe("bore");
    if (plan.kind !== "bore") return;
    expect(plan.hillAt).toBeCloseTo(144, -1);
    expect(plan.entry).toBeCloseTo(288, -1);
    expect(plan.exit).toBeCloseTo(720, -1);
    expect(plan.length).toBeGreaterThanOrEqual(720 + 18);
    expect(plan.pieces.every((q) => q.y === 0)).toBe(true);
  });

  it("refuses at a slant, and where the far side is lower", () => {
    const land = steppedHill();
    expect(planTunnel(rulesOf(land), { x: 0, z: 36, heading: 0.3 }, 0)).toMatchObject({ kind: "refused", why: "square" });
    // A line on a one-level terrace, into a hill whose far side drops to the felt.
    const terrace = hill(flat(), -720, 0, -216, 216, 1);
    hill(terrace, 0, 288, -216, 216, 3);
    expect(planTunnel(rulesOf(terrace), { x: -300, z: 36, heading: 0 }, ONE)).toMatchObject({ kind: "refused", why: "drop" });
  });

  it("the portals are found where the line goes into two levels of hill, and dashes over the tunnel", () => {
    const land = steppedHill();
    const layout = new Layout();
    const plan = planTunnel(rulesOf(land, layout), { x: 0, z: 36, heading: 0 }, 0);
    if (plan.kind !== "bore") throw new Error(plan.why);
    for (const q of plan.pieces) layout.addPiece(q.type, q.pose, q.y, q.flipped);
    syncCuttings(land, layout);
    const { portals, dashes } = findTunnels(layout, land);
    expect(portals.map((q) => Math.round(q.x)).sort((a, b) => a - b)).toEqual([288, 576]);
    expect(dashes.length).toBeGreaterThan(5);
    expect(dashes.every((d) => d.x0 > 288 && d.x1 < 576 && Math.abs(d.y - 2 * ONE - 0.5) < 1)).toBe(true);
  });
});

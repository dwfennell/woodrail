import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { checkPlacement, checkSupport, gridWithPlots, inTunnel, LandEditor, mayTunnel, setTunnels, type Landscape } from "../landscape";
import { findTunnels } from "../render/tunnels-view";
import { DrawLine, findLowCrossing, Layout, RISER_HEIGHT, type DrawEnd } from "../track";
import { drawOptions } from "./draw-testing";
import type { World } from "./world";
import { trackBlock, type TrackRules } from "./track-rules";
import { planBore, planTunnel } from "./tunnel-dig";

/** Tunnels (docs/superpowers/specs/2026-11-04-tunnels.md): track under two levels of ground, a hill's and the board's. */

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

/** A hill one level high, x 288..720 (six squares), z −216..216. */
const oneLevel = () => hill(flat(), 288, 720, -216, 216, 1);
/** A hill as maps make them: a level a square, up to two (x 288..360 and 648..720 one level, between two). */
const stepped = () => hill(hill(flat(), 288, 720, -216, 216, 1), 360, 648, -216, 216, 2);

const rulesOf = (land: Landscape, layout = new Layout()): TrackRules => ({ land, layout, props: null, footprint: () => undefined });
const along = (x: number, z = 36): DrawEnd => ({ x, z, heading: 0, y: 0, kind: "peg" });

beforeEach(() => setTunnels(true));
afterEach(() => setTunnels(false));

describe("tunnels: placement", () => {
  it("off (as today), track under a hill is refused; on, a level under the felt under a one-level hill it's in a tunnel", () => {
    const land = oneLevel();
    setTunnels(false);
    expect(checkPlacement(land, "straight-216", false, { x: 360, z: 36, heading: 0 }, -ONE).kind).toBe("blocked");
    setTunnels(true);
    expect(checkPlacement(land, "straight-216", false, { x: 360, z: 36, heading: 0 }, -ONE).kind).toBe("clear");
    expect(inTunnel(land, 400, 36, -ONE)).toBe(true);
    expect(inTunnel(land, 200, 36, -ONE)).toBe(false);
  });

  it("track at the felt's level into a hill is still refused (no cuttings: a tunnel goes down a mouth)", () => {
    expect(checkPlacement(oneLevel(), "straight-216", false, { x: 216, z: 36, heading: 0 }, 0)).toEqual({ kind: "blocked", reason: "hill" });
  });

  it("a level under the felt with no hill over it is too shallow; two levels under, anything may be over it", () => {
    const land = flat();
    expect(checkPlacement(land, "straight-216", false, { x: 0, z: 36, heading: 0 }, -ONE)).toEqual({ kind: "blocked", reason: "shallow" });
    expect(checkPlacement(land, "straight-216", false, { x: 0, z: 36, heading: 0 }, -2 * ONE).kind).toBe("clear");
    // Half under the hill, half under bare felt: refused.
    expect(checkPlacement(oneLevel(), "straight-216", false, { x: 216, z: 36, heading: 0 }, -ONE)).toEqual({ kind: "blocked", reason: "shallow" });
  });

  it("only plain track in a tunnel: points need daylight", () => {
    expect(checkPlacement(flat(), "switch", false, { x: 0, z: 36, heading: 0 }, -2 * ONE)).toEqual({ kind: "blocked", reason: "daylight" });
    expect(checkPlacement(flat(), "curve-large", false, { x: 0, z: 36, heading: 0 }, -2 * ONE).kind).toBe("clear");
  });

  it("under the felt, a road over it doesn't matter", () => {
    const land = flat();
    land.grid.road[land.grid.cellAtWorld(108, 36)] = 1;
    expect(checkPlacement(land, "straight-216", false, { x: 0, z: 36, heading: 0 }, 0).kind).toBe("blocked");
    expect(checkPlacement(land, "straight-216", false, { x: 0, z: 36, heading: 0 }, -2 * ONE).kind).toBe("clear");
  });

  it("a short mouth's foot may run on under a hill's side, square to it; not at a slant, not on a hill", () => {
    const land = oneLevel();
    // Its foot at the side (288) or a little under it.
    expect(checkPlacement(land, "tunnel-mouth-short", false, { x: 144, z: 36, heading: 0 }, 0).kind).toBe("clear");
    expect(checkPlacement(land, "tunnel-mouth-short", false, { x: 160, z: 36, heading: 0 }, 0).kind).toBe("clear");
    // Too far in: the train wouldn't fit under the hill where the slope is still high.
    expect(checkPlacement(land, "tunnel-mouth-short", false, { x: 230, z: 36, heading: 0 }, 0)).toEqual({ kind: "blocked", reason: "mouth" });
    expect(checkPlacement(land, "tunnel-mouth-short", false, { x: 175, z: -30, heading: 0.3 }, 0).kind).toBe("blocked");
    expect(checkPlacement(land, "tunnel-mouth-short", false, { x: 400, z: 36, heading: 0 }, ONE)).toEqual({ kind: "blocked", reason: "mouth" });
  });

  it("track in a tunnel is held up (it lies on the tunnel's floor)", () => {
    const layout = new Layout();
    expect(checkSupport(oneLevel(), layout, "straight-216", false, { x: 360, z: 36, heading: 0 }, -ONE, -1).kind).toBe("held");
    expect(checkSupport(flat(), layout, "tunnel-mouth", false, { x: 0, z: 36, heading: 0 }, 0, -1).kind).toBe("held");
  });

  it("a line on the hilltop crosses over a tunnel a level under the felt (96 between them)", () => {
    const land = oneLevel();
    const layout = new Layout();
    layout.addPiece("straight-216", { x: 360, z: 36, heading: 0 }, -ONE);
    const across = { x: 468, z: -144, heading: Math.PI / 2 };
    expect(findLowCrossing(layout, "straight-216", false, across, ONE, -1)).toBe(-1);
    expect(trackBlock(rulesOf(land, layout), "straight-216", false, across, ONE, -1)).toBeNull();
  });

  it("the cheap test skips pieces on the felt with no hill near", () => {
    expect(mayTunnel(flat(), "straight-216", false, { x: 0, z: 0, heading: 0 }, 0)).toBe(false);
    expect(mayTunnel(stepped(), "straight-216", false, { x: 300, z: 36, heading: 0 }, 0)).toBe(true);
    expect(mayTunnel(flat(), "straight-216", false, { x: 0, z: 0, heading: 0 }, -2 * ONE)).toBe(true);
  });
});

describe("tunnels: the land over them", () => {
  it("the Raise and Lower tools won't touch a square over a tunnel (it would be left uncovered)", () => {
    const land = oneLevel();
    const layout = new Layout();
    const plan = planTunnel(rulesOf(land, layout), along(0));
    if (plan.kind !== "bore") throw new Error(plan.why);
    for (const q of plan.pieces) layout.addPiece(q.type, q.pose, q.y, q.flipped);
    const over = land.grid.cellAtWorld(504, 36);
    expect(new LandEditor(land, layout).check(over, -1)).toBe("track");
    expect(new LandEditor(land, new Layout()).check(over, -1)).not.toBe("track");
  });
});

describe("tunnels: planTunnel (under the hill ahead)", () => {
  it("under a one-level hill: straights, a mouth down to its side, a level under, a mouth up out the far side, all joined", () => {
    const land = oneLevel();
    const layout = new Layout();
    const plan = planTunnel(rulesOf(land, layout), along(0));
    expect(plan.kind).toBe("bore");
    if (plan.kind !== "bore") return;
    expect(plan.face).toBeCloseTo(288, 0);
    expect(plan.exit).toBeCloseTo(720, 0);
    const types = plan.pieces.map((q) => q.type);
    expect(types.filter((t) => t === "tunnel-mouth-short")).toHaveLength(2);
    expect(plan.pieces.filter((q) => q.y === -ONE).length).toBeGreaterThan(0);
    for (const q of plan.pieces) layout.addPiece(q.type, q.pose, q.y, q.flipped);
    expect(layout.jointCount).toBe(plan.pieces.length - 1);
    // The last piece ends on open felt past the hill.
    const last = plan.pieces[plan.pieces.length - 1];
    expect(last.y).toBe(0);
    expect(last.pose.x).toBeGreaterThan(720 + 100);
  });

  it("under a stepped hill (one level, two, one): the same, a level under the felt all the way", () => {
    const plan = planTunnel(rulesOf(stepped()), along(0));
    expect(plan.kind).toBe("bore");
  });

  it("refuses at a slant, too near the hill, where the hill dips to the felt, and with no hill ahead", () => {
    const land = oneLevel();
    expect(planTunnel(rulesOf(land), { ...along(0), heading: 0.3 })).toMatchObject({ kind: "refused", why: "square" });
    expect(planTunnel(rulesOf(land), along(200))).toMatchObject({ kind: "refused", why: "near" });
    const two = hill(hill(flat(), 288, 432, -216, 216, 1), 504, 720, -216, 216, 1);
    expect(planTunnel(rulesOf(two), along(0))).toMatchObject({ kind: "refused", why: "low" });
    expect(planTunnel(rulesOf(flat()), along(0))).toMatchObject({ kind: "refused", why: "none" });
  });

  it("a straight dropped against the hill's side: tunnelled from its end; too near, from a straight further back (taken up)", () => {
    const land = oneLevel();
    const layout = new Layout();
    const rules = rulesOf(land, layout);
    // Dropped with its far end in the hill: from its near end.
    const plan = planBore(rules, "straight-216", false, { x: 72, z: 36, heading: 0 }, 0);
    expect(plan?.kind).toBe("bore");
    // A line up to 180, and a straight dropped from there: too near on its own, so the line's last straight comes up.
    const a = layout.addPiece("straight-216", { x: -252, z: 36, heading: 0 }, 0);
    const b = layout.addPiece("straight-216", { x: -36, z: 36, heading: 0 }, 0);
    const near = planBore(rules, "straight-216", false, { x: 180, z: 36, heading: 0 }, 0);
    expect(near?.kind).toBe("bore");
    if (near?.kind !== "bore") return;
    expect(near.covers).toEqual([b]);
    expect(near.covers).not.toContain(a);
  });

  it("the portals are at both of the hill's sides, and the dashes on the hilltop over the tunnel", () => {
    const land = oneLevel();
    const layout = new Layout();
    const plan = planTunnel(rulesOf(land, layout), along(0));
    if (plan.kind !== "bore") throw new Error(plan.why);
    const ids = plan.pieces.map((q) => layout.addPiece(q.type, q.pose, q.y, q.flipped));
    const { portals, dashes, pieces } = findTunnels(layout, land);
    expect(portals.map((q) => Math.round(q.x)).sort((a, b) => a - b)).toEqual([288, 720]);
    expect(portals.every((q) => q.kind === "hill")).toBe(true);
    expect(dashes.length).toBeGreaterThan(5);
    expect(dashes.every((d) => d.x0 >= 288 && d.x1 <= 720 && Math.abs(d.y - ONE - 0.5) < 1)).toBe(true);
    expect(ids.filter((id) => pieces.has(id)).length).toBeGreaterThanOrEqual(3);
  });
});

describe("tunnels: Draw", () => {
  /** A line drawn along z 36 from x 0 across the one-level hill to x `to`, with tunnels on or off. */
  function draw(on: boolean, to = 1100) {
    setTunnels(on);
    const land = oneLevel();
    const world = { landscape: land, layout: new Layout(), props: null } as unknown as World;
    const rules = rulesOf(land, world.layout);
    const tunnel = (end: DrawEnd) => {
      const plan = planTunnel(rules, end);
      return plan.kind === "bore" ? plan.steps : null;
    };
    const line = new DrawLine({ x: 0, z: 36, heading: 0, y: 0, kind: "peg" }, { ...drawOptions(world, false), ...(on ? { tunnel } : {}) });
    for (let x = 6; x <= to; x += 6) line.addPoint(x, 36);
    line.finish();
    return line.pieces;
  }

  it("off: across a one-level hill, up a ramp and down again (as today)", () => {
    const types = draw(false).map((p) => p.type);
    expect(types.filter((t) => t === "ramp")).toHaveLength(2);
    expect(types).not.toContain("tunnel-mouth-short");
  });

  it("on: across it, under it instead, piece for piece (mouth down, straights a level under, mouth up), nothing refused", () => {
    const pieces = draw(true);
    const types = pieces.map((p) => p.type);
    expect(types.filter((t) => t === "tunnel-mouth-short")).toHaveLength(2);
    expect(types).not.toContain("ramp");
    expect(pieces.every((p) => !p.blocked)).toBe(true);
    expect(pieces.some((p) => p.y === -ONE)).toBe(true);
    expect(pieces[pieces.length - 1].end.x).toBeGreaterThan(720 + 100);
  });

  it("on, but stopping on the hilltop: it climbs (a line onto the hill still goes up)", () => {
    const types = draw(true, 520).map((p) => p.type);
    expect(types).toContain("ramp");
    expect(types).not.toContain("tunnel-mouth-short");
  });
});

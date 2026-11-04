import { describe, expect, it } from "vitest";
import { gridWithPlots, type Landscape } from "../landscape";
import { connectorRef, getPieceDef, Layout, overUnderpass, pathLength, RISER_HEIGHT, UNDERPASS_LENGTH, type PieceTypeId, type Pose } from "../track";
import { trackBlock, type TrackRules } from "./track-rules";
import { DIG_MESSAGES, planUnderpass, planUnderpassAhead, type DigPlan } from "./underpass-dig";

/** Open flat ground, a few plots each way round the origin. */
function flat(): Landscape {
  return { seed: 0, starter: false, grid: gridWithPlots(-2, -2, 3, 3), towns: [], corridors: [], fields: [], shed: null, depots: [], nextBuildingId: 0 };
}

const ONE = RISER_HEIGHT;

/** A line of five 216 straights along x through the origin (laid going +x, or −x with `back`). */
function line(layout: Layout, back = false, z = 0): number[] {
  const ids: number[] = [];
  for (let k = 0; k < 5; k++) {
    const x = -540 + k * 216;
    ids.push(back ? layout.addPiece("straight-216", { x: x + 216, z, heading: Math.PI }, 0) : layout.addPiece("straight-216", { x, z, heading: 0 }, 0));
  }
  return ids;
}

/** A bridge whose middle is at (x, z), its track going `heading`. */
function bridgeAt(x: number, z: number, heading: number): Pose {
  return { x: x - 108 * Math.cos(heading), z: z - 108 * Math.sin(heading), heading };
}

/** Take the plan's covers up and put its pieces down, as the editor's step does. */
function dig(layout: Layout, plan: DigPlan): number {
  if (plan.kind !== "dig") throw new Error(`refused: ${plan.why}`);
  for (const id of plan.covers) layout.removePiece(id);
  let under = -1;
  for (const p of plan.pieces) {
    const id = layout.addPiece(p.type, p.pose, p.y, p.flipped);
    if (p.type === "underpass") under = id;
  }
  return under;
}

const rulesFor = (layout: Layout): TrackRules => ({ land: flat(), layout, props: null, footprint: () => undefined });

describe("an underpass dug under a bridge one level up", () => {
  it("over a straight line, square on, either way round: the line keeps its length, the bridge then goes down and is drawn as a girder span", () => {
    for (const back of [false, true]) {
      for (const heading of [Math.PI / 2, -Math.PI / 2]) {
        for (const off of [0, 7, 30, -50]) {
          const layout = new Layout();
          line(layout, back);
          const rules = rulesFor(layout);
          const pose = bridgeAt(off, 0, heading);
          // Today's rule: refused.
          expect(trackBlock(rules, "bridge", false, pose, ONE, -1)).not.toBe(null);
          const plan = planUnderpass(rules, "bridge", false, pose, ONE, -1)!;
          expect(plan?.kind, `back ${back} heading ${heading} off ${off}`).toBe("dig");
          if (plan.kind !== "dig") continue;
          const covered = plan.covers.reduce((s, id) => s + pathLength(getPieceDef(layout.getPiece(id)!.type, false).paths[0].geom), 0);
          const laid = plan.pieces.reduce((s, p) => s + (p.type === "underpass" ? UNDERPASS_LENGTH : pathLength(getPieceDef(p.type, false).paths[0].geom)), 0);
          expect(laid).toBeCloseTo(covered, 6);
          expect(plan.pieces.filter((p) => p.type === "underpass")).toHaveLength(1);
          const under = dig(layout, plan);
          // The underpass's middle under the bridge: on the 18 mm lattice, or a step off it when the straights left over
          // can't be made from the box's lengths (18 can't); the bridge still clears it (checked below).
          const u = layout.getPiece(under)!;
          const mid = u.pose.x + (UNDERPASS_LENGTH / 2) * Math.cos(u.pose.heading);
          expect(Math.abs(mid - off)).toBeLessThanOrEqual(27);
          // Joined to the line both ends: the line is whole.
          expect(layout.joinedConnector(connectorRef(under, 0))).not.toBe(-1);
          expect(layout.joinedConnector(connectorRef(under, 1))).not.toBe(-1);
          expect(trackBlock(rules, "bridge", false, pose, ONE, -1)).toBe(null);
          const b = layout.addPiece("bridge", pose, ONE);
          expect(overUnderpass(layout, layout.getPiece(b)!)).toBe(true);
        }
      }
    }
  });

  it("a curved bridge, and a bridge at 45°, over a straight line: dug", () => {
    for (const [type, heading] of [
      ["bridge-curve", Math.PI / 2],
      ["bridge", Math.PI / 4],
      ["bridge", (3 * Math.PI) / 4],
    ] as [PieceTypeId, number][]) {
      const layout = new Layout();
      line(layout);
      const rules = rulesFor(layout);
      // (A curved bridge's middle is off its chord: start it so its track crosses near the origin.)
      const pose = type === "bridge" ? bridgeAt(0, 0, heading) : { x: -40, z: heading === Math.PI / 2 ? -54 : -60, heading };
      const plan = planUnderpass(rules, type, false, pose, ONE, -1)!;
      expect(plan?.kind, `${type} ${heading}: ${plan?.kind === "refused" ? plan.why : ""}`).toBe("dig");
      dig(layout, plan);
      expect(trackBlock(rules, type, false, pose, ONE, -1)).toBe(null);
      expect(overUnderpass(layout, layout.getPiece(layout.addPiece(type, pose, ONE))!)).toBe(true);
    }
  });

  it("refused, and says why: a slanting crossing, a curve or points under it, two lines, too little straight track", () => {
    const refused = (setup: (l: Layout) => void, pose: Pose, type: PieceTypeId = "bridge") => {
      const layout = new Layout();
      setup(layout);
      const plan = planUnderpass(rulesFor(layout), type, false, pose, ONE, -1);
      return plan?.kind === "refused" ? plan.why : plan?.kind ?? null;
    };
    // A slanting crossing (20°): the bridge would reach the underpass's slopes.
    expect(refused((l) => line(l), bridgeAt(0, 0, (20 * Math.PI) / 180))).toBe("angle");
    // A curve under the bridge.
    expect(refused((l) => l.addPiece("curve-large", { x: -120, z: 0, heading: 0 }, 0), bridgeAt(0, 30, Math.PI / 2))).toBe("curve");
    // Points under it.
    expect(refused((l) => l.addPiece("switch", { x: -72, z: 0, heading: 0 }, 0), bridgeAt(0, 0, Math.PI / 2))).toBe("points");
    // Two lines side by side under one bridge.
    expect(
      refused((l) => {
        line(l, false, 0);
        line(l, false, 72);
      }, bridgeAt(0, 36, Math.PI / 2)),
    ).toBe("lines");
    // A lone 216 straight: no room for a 288 underpass.
    expect(refused((l) => l.addPiece("straight-216", { x: -108, z: 0, heading: 0 }, 0), bridgeAt(0, 0, Math.PI / 2))).toBe("short");
    // An underpass already there, the bridge over its slope: put it over the middle.
    expect(refused((l) => l.addPiece("underpass", { x: -144, z: 0, heading: 0 }, 0), bridgeAt(100, 0, Math.PI / 2))).toBe("centre");
    // A curved bridge crossing the line near its end: its pier would stand in the trench.
    expect(refused((l) => line(l), { x: -40, z: -18, heading: Math.PI / 2 }, "bridge-curve")).toBe("pier");
    for (const why of ["angle", "curve", "points", "lines", "short", "centre", "pier"] as const) expect(DIG_MESSAGES[why].length).toBeLessThan(90);
  });

  it("a bridge's supports never stand in a trench: an arched bridge beside one, a girder span's pier on its edge, refused", () => {
    const layout = new Layout();
    layout.addPiece("underpass", { x: -144, z: 0, heading: 0 }, 0);
    const rules = rulesFor(layout);
    // Two levels up, square across the dip: on arches all along, they'd stand in the trench.
    expect(trackBlock(rules, "bridge", false, bridgeAt(0, 0, Math.PI / 2), 2 * ONE, -1)).toBe("trench");
    // One level up, square across the middle: a girder span, its piers clear.
    expect(trackBlock(rules, "bridge", false, bridgeAt(0, 0, Math.PI / 2), ONE, -1)).toBe(null);
    // An underpass put down under a bridge already there on arches (two levels up): refused too.
    const l2 = new Layout();
    l2.addPiece("bridge", bridgeAt(0, 0, Math.PI / 2), 2 * ONE);
    expect(trackBlock(rulesFor(l2), "underpass", false, { x: -144, z: 0, heading: 0 }, 0, -1)).toBe("trench");
  });

  it("doesn't apply two levels up, or to a piece that isn't a bridge, or with an underpass there already under the middle", () => {
    const layout = new Layout();
    line(layout);
    const rules = rulesFor(layout);
    expect(planUnderpass(rules, "bridge", false, bridgeAt(0, 0, Math.PI / 2), 2 * ONE, -1)).toBe(null);
    expect(planUnderpass(rules, "straight-216", false, bridgeAt(0, 0, Math.PI / 2), ONE, -1)).toBe(null);
    const plan = planUnderpass(rules, "bridge", false, bridgeAt(0, 0, Math.PI / 2), ONE, -1)!;
    dig(layout, plan);
    expect(planUnderpass(rules, "bridge", false, bridgeAt(0, 0, Math.PI / 2), ONE, -1)).toBe(null);
  });

  it("a signal on the straights it would take up: refused, saying to move it", () => {
    const layout = new Layout();
    const ids = line(layout);
    // On the joint between the 2nd and 3rd straights (under the bridge's dig), facing either way.
    for (const at of [connectorRef(ids[1], 1), connectorRef(ids[2], 0)]) {
      const l = new Layout();
      const ls = line(l);
      const ref = at === connectorRef(ids[1], 1) ? connectorRef(ls[1], 1) : connectorRef(ls[2], 0);
      expect(l.addSignal(ref)).not.toBe(-1);
      const plan = planUnderpass(rulesFor(l), "bridge", false, bridgeAt(0, 0, Math.PI / 2), ONE, -1);
      expect(plan).toEqual({ kind: "refused", why: "signal" });
    }
    expect(DIG_MESSAGES.signal).toMatch(/signal/i);
    // A signal on the line's far joints, clear of the dig: dug as usual.
    const far = new Layout();
    const fl = line(far);
    const sixth = far.addPiece("straight-216", { x: 540, z: 0, heading: 0 }, 0);
    expect(far.addSignal(connectorRef(sixth, 0))).not.toBe(-1);
    void fl;
    expect(planUnderpass(rulesFor(far), "bridge", false, bridgeAt(0, 0, Math.PI / 2), ONE, -1)?.kind).toBe("dig");
  });

  it("a straight laid on under a bridge already there: straights on to an underpass under it go down in its place", () => {
    for (const back of [false, true]) {
      const layout = new Layout();
      // The bridge one level up across x = 0; a line coming from the left to x = −144 (or from the right, to +144).
      const b = layout.addPiece("bridge", bridgeAt(0, 0, Math.PI / 2), ONE);
      if (!back) layout.addPiece("straight-216", { x: -360, z: 0, heading: 0 }, 0);
      else layout.addPiece("straight-216", { x: 144, z: 0, heading: 0 }, 0);
      const rules = rulesFor(layout);
      // The next straight on from its end, under the bridge: refused by itself.
      const pose: Pose = back ? { x: -72, z: 0, heading: 0 } : { x: -144, z: 0, heading: 0 };
      expect(["headroom", "piece"]).toContain(trackBlock(rules, "straight-216", false, pose, 0, -1));
      const plan = planUnderpassAhead(rules, "straight-216", false, pose, 0, -1)!;
      expect(plan?.kind, `back ${back}: ${plan?.kind === "refused" ? plan.why : ""}`).toBe("dig");
      if (plan.kind !== "dig") continue;
      expect(plan.covers).toEqual([]);
      for (const p of plan.pieces) {
        expect(trackBlock(rules, p.type, p.flipped, p.pose, p.y, -1)).toBe(null);
        layout.addPiece(p.type, p.pose, p.y, p.flipped);
      }
      // Laid on from the line's end: joined to it, the underpass's middle under the bridge.
      const u = [...layout.pieceIds()].map((id) => layout.getPiece(id)!).find((q) => q.type === "underpass")!;
      const mid = u.pose.x + (UNDERPASS_LENGTH / 2) * Math.cos(u.pose.heading);
      expect(Math.abs(mid)).toBeLessThanOrEqual(27);
      expect(overUnderpass(layout, layout.getPiece(b)!)).toBe(true);
    }
  });

  it("a straight under a bridge two levels up, or nothing over it: not its business", () => {
    const layout = new Layout();
    layout.addPiece("bridge", bridgeAt(0, 0, Math.PI / 2), 2 * ONE);
    expect(planUnderpassAhead(rulesFor(layout), "straight-216", false, { x: -108, z: 0, heading: 0 }, 0, -1)).toBe(null);
    expect(planUnderpassAhead(rulesFor(new Layout()), "straight-216", false, { x: -108, z: 0, heading: 0 }, 0, -1)).toBe(null);
  });
});

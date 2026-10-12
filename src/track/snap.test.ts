import { describe, expect, it } from "vitest";
import { connectorRef, Layout } from "./layout";
import { solveParentPose, transformPose, type Pose } from "./math";
import { getPieceDef } from "./pieces";
import { appendPiece, findSnap, findSnapAtPoint } from "./snap";
import { SNAP_CAPTURE_RADIUS } from "./constants";

const P = (x: number, z: number, heading = 0): Pose => ({ x, z, heading });
const deg = (d: number) => (d * Math.PI) / 180;

function curveChain(l: Layout, count: number): number[] {
  const ids = [l.addPiece("curve-large", P(0, 0))];
  for (let i = 1; i < count; i++) ids.push(appendPiece(l, "curve-large", false, connectorRef(ids[i - 1], 1)));
  return ids;
}

describe("findSnap", () => {
  it("snaps a nearby dragged piece exactly onto a free peg", () => {
    const l = new Layout();
    l.addPiece("straight-144", P(0, 0));
    const r = findSnap(l, "straight-144", false, P(150, 8, deg(10)), 0);
    expect(r.kind).toBe("snapped");
    if (r.kind !== "snapped") return;
    expect(r.pose.x).toBeCloseTo(144);
    expect(r.pose.z).toBeCloseTo(0);
    expect(r.pose.heading).toBeCloseTo(0);
    expect(r.connector).toBe(0);
  });

  it("returns none when nothing is within the capture radius", () => {
    const l = new Layout();
    l.addPiece("straight-144", P(0, 0));
    expect(findSnap(l, "straight-144", false, P(400, 0), 0).kind).toBe("none");
  });

  it("snaps a piece's peg onto a free socket (attaching behind)", () => {
    const l = new Layout();
    l.addPiece("straight-144", P(0, 0));
    const r = findSnap(l, "straight-108", false, P(-100, 5), 0);
    expect(r.kind).toBe("snapped");
    if (r.kind !== "snapped") return;
    expect(r.connector).toBe(1);
    expect(r.pose.x).toBeCloseTo(-108);
  });

  it("ignores the dragged piece's own connectors", () => {
    const l = new Layout();
    const a = l.addPiece("straight-144", P(0, 0));
    expect(findSnap(l, "straight-144", false, P(5, 0), 0, a).kind).toBe("none");
  });

  it("snaps onto a raised connector and reports the resulting base height", () => {
    const l = new Layout();
    l.addPiece("ramp", P(0, 0)); // peg at x=216, y=64
    const r = findSnap(l, "straight-144", false, P(220, 0), 50);
    expect(r.kind).toBe("snapped");
    if (r.kind === "snapped") expect(r.y).toBeCloseTo(64);
  });

  it("does not snap to joined connectors", () => {
    const l = new Layout();
    l.addPiece("straight-144", P(0, 0));
    l.addPiece("straight-144", P(144, 0));
    const r = findSnap(l, "straight-54", false, P(146, 0), 0);
    // nearest free connectors are at x=0 (socket) and x=288 (peg), both out of range
    expect(r.kind).toBe("none");
  });
});

describe("loop closure", () => {
  it("eight large curves close a circle", () => {
    const l = new Layout();
    curveChain(l, 8);
    expect(l.jointCount).toBe(8);
  });

  it("an oval of 8 curves and 2 matching straights closes", () => {
    const l = new Layout();
    const ids = [l.addPiece("curve-large", P(0, 0))];
    const seq = ["curve-large", "curve-large", "curve-large", "straight-216", "curve-large", "curve-large", "curve-large", "curve-large", "straight-216"] as const;
    for (const t of seq) ids.push(appendPiece(l, t, false, connectorRef(ids[ids.length - 1], 1)));
    expect(l.jointCount).toBe(10);
  });

  it("an oval with mismatched straights does not close", () => {
    const l = new Layout();
    const ids = [l.addPiece("curve-large", P(0, 0))];
    const seq = ["curve-large", "curve-large", "curve-large", "straight-216", "curve-large", "curve-large", "curve-large", "curve-large", "straight-144"] as const;
    for (const t of seq) ids.push(appendPiece(l, t, false, connectorRef(ids[ids.length - 1], 1)));
    expect(l.jointCount).toBe(9);
  });

  it("joint play lets a slightly-off final piece close the loop (0.5° ≈ 1.2 mm)", () => {
    const l = new Layout();
    const ids = curveChain(l, 7);
    const exact = l.getPiece(appendPiece(l, "curve-large", false, connectorRef(ids[6], 1)))!;
    l.removePiece(exact.id);
    l.addPiece("curve-large", { ...exact.pose, heading: exact.pose.heading + deg(0.5) });
    expect(l.jointCount).toBe(8);
    const errors = [...l.joints()].map((j) => j.posError);
    expect(Math.max(...errors)).toBeGreaterThan(1);
  });

  it("a loop that is ~3.6 mm off (1.5°) still closes, like real wooden track", () => {
    const l = new Layout();
    const ids = curveChain(l, 7);
    const exact = l.getPiece(appendPiece(l, "curve-large", false, connectorRef(ids[6], 1)))!;
    l.removePiece(exact.id);
    l.addPiece("curve-large", { ...exact.pose, heading: exact.pose.heading + deg(1.5) });
    expect(l.jointCount).toBe(8);
  });

  it("a loop that is 6° off does not close", () => {
    const l = new Layout();
    const ids = curveChain(l, 7);
    const exact = l.getPiece(appendPiece(l, "curve-large", false, connectorRef(ids[6], 1)))!;
    l.removePiece(exact.id);
    l.addPiece("curve-large", { ...exact.pose, heading: exact.pose.heading + deg(6) });
    // Turned about its socket, the piece holds at neither end.
    expect(l.jointCount).toBe(6);
  });
});

describe("findSnap capture radius", () => {
  it("accepts a larger capture radius (zoomed-out dragging)", () => {
    const l = new Layout();
    l.addPiece("straight-144", P(0, 0));
    expect(findSnap(l, "straight-144", false, P(184, 0), 0).kind).toBe("none");
    expect(findSnap(l, "straight-144", false, P(184, 0), 0, -1, 60).kind).toBe("snapped");
  });
});

describe("auto-fit (ends that don't match turn or mirror the piece to fit)", () => {
  /** A long straight from the origin along +x: hole (socket) at x = 0, peg at x = 216. */
  function base() {
    const layout = new Layout();
    layout.addPiece("straight-216", { x: 0, z: 0, heading: 0 });
    return layout;
  }
  const centre = (type: Parameters<typeof getPieceDef>[0], flipped: boolean, pose: Pose) => {
    const d = getPieceDef(type, flipped);
    let x = 0;
    let z = 0;
    for (const c of d.connectors) {
      const w = transformPose(pose, c.pose, { x: 0, z: 0, heading: 0 });
      x += w.x;
      z += w.z;
    }
    return { x: x / d.connectors.length, z: z / d.connectors.length };
  };

  it("a straight held peg-to-peg seats turned round, where it was held", () => {
    const layout = base();
    // Held turned round: its peg end at x = 216 (against the other peg), its hole end out at x = 432.
    const held = { x: 432, z: 0, heading: Math.PI };
    expect(findSnap(layout, "straight-216", false, held, 0).kind).toBe("none");
    const s = findSnap(layout, "straight-216", false, held, 0, -1, SNAP_CAPTURE_RADIUS, "turn");
    expect(s.kind).toBe("snapped");
    if (s.kind !== "snapped") return;
    expect(s.pose.x).toBeCloseTo(216, 6);
    expect(s.pose.z).toBeCloseTo(0, 6);
    expect(Math.cos(s.pose.heading)).toBeCloseTo(1, 6);
  });

  it("a curve held peg-to-peg seats mirrored when allowed, so it still bends the way it was held", () => {
    const layout = base();
    // Hold a curve with its peg end against the straight's peg (facing back along −x), bending away beyond it.
    const peg = getPieceDef("curve-large", false).connectors[1];
    const held = solveParentPose(peg.pose, { x: 216, z: 0, heading: Math.PI }, { x: 0, z: 0, heading: 0 });
    const was = centre("curve-large", false, held);
    const turned = findSnap(layout, "curve-large", false, held, 0, -1, SNAP_CAPTURE_RADIUS, "turn");
    const fitted = findSnap(layout, "curve-large", false, held, 0, -1, SNAP_CAPTURE_RADIUS, "turn-or-mirror");
    expect(turned.kind).toBe("snapped");
    expect(fitted.kind).toBe("snapped");
    if (turned.kind !== "snapped" || fitted.kind !== "snapped") return;
    expect(fitted.flipped).toBe(true);
    const away = (s: typeof fitted) => {
      const c = centre("curve-large", s.flipped, s.pose);
      return Math.hypot(c.x - was.x, c.z - was.z);
    };
    expect(away(fitted)).toBeLessThan(1);
    expect(away(turned)).toBeGreaterThan(away(fitted) + 20);
  });

  it("an exact fit nearby still wins over a turned one", () => {
    const layout = base();
    // Held the right way round, its hole end at the straight's peg.
    const s = findSnap(layout, "straight-216", false, { x: 217, z: 0, heading: 0 }, 0, -1, SNAP_CAPTURE_RADIUS, "turn-or-mirror");
    expect(s.kind).toBe("snapped");
    if (s.kind === "snapped") expect(s.flipped).toBe(false);
  });

  it("never turns a ramp round to fit: that would make an up ramp a down one", () => {
    const layout = base();
    // A ramp held with its (high) peg end against the straight's peg, sloping back the other way.
    const held = { x: 432, z: 0, heading: Math.PI };
    for (const y of [0, -64]) {
      expect(findSnap(layout, "ramp", false, held, y, -1, SNAP_CAPTURE_RADIUS, "turn-or-mirror").kind).toBe("none");
    }
    // Held the right way round, it fits as it is: rising away from the straight.
    const s = findSnap(layout, "ramp", false, { x: 220, z: 0, heading: 0 }, 0, -1, SNAP_CAPTURE_RADIUS, "turn-or-mirror");
    expect(s.kind).toBe("snapped");
    if (s.kind === "snapped") expect(s.y).toBe(0);
  });
});

describe("findSnapAtPoint", () => {
  it("seats the piece on the free end under the pointer, even with the held piece's ends far from it", () => {
    const l = new Layout();
    l.addPiece("straight-144", P(0, 0)); // free peg at x=144, free socket at x=0
    // Held centred on the pointer, at the peg: its own ends are 108 mm either side.
    const r = findSnapAtPoint(l, "straight-216", false, P(144 - 108, 0), 0, { x: 150, z: 6 }, -1, SNAP_CAPTURE_RADIUS, "turn");
    expect(r.kind).toBe("snapped");
    if (r.kind !== "snapped") return;
    expect(r.connector).toBe(0);
    expect(r.pose.x).toBeCloseTo(144);
    expect(r.pose.heading).toBeCloseTo(0);
    // The plain end-based snap finds nothing from here.
    expect(findSnap(l, "straight-216", false, P(144 - 108, 0), 0, -1, SNAP_CAPTURE_RADIUS, "turn").kind).toBe("none");
  });

  it("picks the end nearest the pointer when two are in reach", () => {
    const l = new Layout();
    l.addPiece("straight-144", P(0, 0));
    const r = findSnapAtPoint(l, "straight-144", false, P(-72, 0), 0, { x: 4, z: 0 }, -1, 60, "turn");
    expect(r.kind).toBe("snapped");
    if (r.kind === "snapped") expect(r.pose.x).toBeCloseTo(-144);
  });

  it("chooses the curve's seating most like the piece as held", () => {
    const l = new Layout();
    l.addPiece("straight-144", P(0, 0));
    for (const held of [deg(30), deg(-30)]) {
      // A new curve held just past the peg, swinging one way or the other.
      const pose = P(150, 0, held);
      const r = findSnapAtPoint(l, "curve-large", false, pose, 0, { x: 146, z: 0 }, -1, SNAP_CAPTURE_RADIUS, "turn-or-mirror");
      expect(r.kind).toBe("snapped");
      if (r.kind !== "snapped") continue;
      const def = getPieceDef("curve-large", r.flipped);
      const far = transformPose(r.pose, def.connectors[1 - r.connector].pose, P(0, 0));
      expect(Math.sign(far.z)).toBe(Math.sign(held));
    }
  });

  it("returns none away from any free end, and ignores the piece's own", () => {
    const l = new Layout();
    const a = l.addPiece("straight-144", P(0, 0));
    expect(findSnapAtPoint(l, "straight-144", false, P(300, 0), 0, { x: 300, z: 0 }).kind).toBe("none");
    expect(findSnapAtPoint(l, "straight-144", false, P(0, 0), 0, { x: 144, z: 0 }, a).kind).toBe("none");
  });
});

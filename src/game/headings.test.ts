import { describe, expect, it } from "vitest";
import { connectorRef, createWorldConnector, Layout } from "../track/layout";
import { appendPiece, findSnap } from "../track/snap";
import { normalizeAngle, type Pose } from "../track/math";
import { JOINT_ANGLE_TOLERANCE, JOINT_POS_TOLERANCE } from "../track/constants";
import { COARSE_STEP, FINE_STEP, nextCoarse, nextFine, onFine, snapHeading, STICK, twistHeading } from "./headings";

const deg = (d: number) => (d * Math.PI) / 180;
const same = (a: number, b: number) => expect(Math.abs(normalizeAngle(a - b))).toBeLessThan(1e-9);

describe("hand turning headings", () => {
  it("a fine step is a third of an eighth, so every eighth (a curve's turn) is a fine heading", () => {
    expect(FINE_STEP * 3).toBeCloseTo(COARSE_STEP, 12);
    for (let k = -16; k <= 16; k++) expect(onFine(k * COARSE_STEP)).toBe(true);
    expect(onFine(deg(15))).toBe(true);
    expect(onFine(deg(22.5))).toBe(false);
  });

  it("Turn goes on to the next eighth: an eighth from one, the one just past from in between", () => {
    same(nextCoarse(0), deg(45));
    same(nextCoarse(deg(45)), deg(90));
    same(nextCoarse(deg(15)), deg(45));
    same(nextCoarse(deg(30)), deg(45));
    same(nextCoarse(deg(-15)), 0);
    same(nextCoarse(deg(15), -1), 0);
    same(nextCoarse(0, -1), deg(-45));
    // (Headings added up from many eighths stay on them: no float drift skips one.)
    let h = 0;
    for (let i = 0; i < 40; i++) h = nextCoarse(h);
    same(h, 40 * COARSE_STEP);
  });

  it("Shift+R steps 15°, three to an eighth, and from off the fine headings lands on the next", () => {
    same(nextFine(0), deg(15));
    same(nextFine(nextFine(nextFine(0))), deg(45));
    same(nextFine(deg(3)), deg(15));
    same(nextFine(deg(15), -1), 0);
    let h = 0;
    for (let i = 0; i < 24; i++) h = nextFine(h);
    same(h, 2 * Math.PI);
  });

  it("a twist rounds to 15°, but sticks to an eighth within 10°", () => {
    same(snapHeading(deg(9)), 0);
    same(snapHeading(deg(-9.9)), 0);
    same(snapHeading(deg(11)), deg(15));
    same(snapHeading(deg(24)), deg(30));
    same(snapHeading(deg(36)), deg(45));
    expect(STICK).toBeGreaterThan(FINE_STEP / 2);
  });

  it("a twist turns as the line between the fingers turns, across ±180°, and a wobble keeps how it's held", () => {
    same(twistHeading(0, 0, deg(16)), deg(15));
    same(twistHeading(deg(90), deg(170), deg(-170)), deg(105));
    same(twistHeading(deg(90), deg(-170), deg(170)), deg(75));
    // Picked up lying a little off (joint play): a wobble under half a step leaves it so.
    expect(twistHeading(deg(3), deg(40), deg(45))).toBe(deg(3));
    same(twistHeading(deg(3), deg(40), deg(80)), deg(45));
  });
});

/** The far end of the chain meets the first piece's free end: a loop that closes (within a joint's play). */
function closes(start: number, type: "curve-large" | "curve-small" | "curve-wide"): boolean {
  const l = new Layout();
  const first = l.addPiece(type, { x: 120, z: -40, heading: start });
  let id = first;
  for (let i = 1; i < 8; i++) id = appendPiece(l, type, false, connectorRef(id, 1));
  const a = l.worldConnector(connectorRef(first, 0), createWorldConnector());
  const b = l.worldConnector(connectorRef(id, 1), createWorldConnector());
  return Math.hypot(a.x - b.x, a.z - b.z) < JOINT_POS_TOLERANCE && Math.abs(normalizeAngle(a.heading - b.heading - Math.PI)) < JOINT_ANGLE_TOLERANCE;
}

describe("the fine headings agree with the curves", () => {
  it("eight curves laid from a piece at any fine heading close into a circle", () => {
    for (let k = 0; k < 24; k++) {
      for (const type of ["curve-large", "curve-small", "curve-wide"] as const) expect(closes(k * FINE_STEP, type), `${type} at ${k * 15}°`).toBe(true);
    }
  });

  it("a piece held at 15° or 30° still seats on a free end, taking that end's heading (snapping isn't harder)", () => {
    const l = new Layout();
    const s = l.addPiece("straight-216", { x: 0, z: 0, heading: 0 });
    const end = l.worldConnector(connectorRef(s, 1), createWorldConnector());
    for (const held of [0, deg(15), deg(30), deg(-15), deg(-30)]) {
      // Its first end held 6 mm off the free end, turned as held.
      const pose: Pose = { x: end.x + 6, z: end.z + 4, heading: held };
      const r = findSnap(l, "straight-216", false, pose, 0);
      expect(r.kind, `held at ${(held * 180) / Math.PI}°`).toBe("snapped");
      if (r.kind === "snapped") same(r.pose.heading, 0);
    }
  });
});

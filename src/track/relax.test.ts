import { describe, expect, it } from "vitest";
import { JOINT_POS_TOLERANCE } from "./constants";
import { Layout } from "./layout";
import { relaxJoints } from "./relax";

const worstJoint = (layout: Layout): number => Math.max(0, ...[...layout.joints()].map((j) => j.posError));

describe("relaxJoints", () => {
  it("closes a joint a loose piece was dropped into with play", () => {
    const layout = new Layout();
    const a = layout.addPiece("straight-144", { x: 0, z: 0, heading: 0 });
    const b = layout.addPiece("straight-144", { x: 150, z: 3, heading: 0.03 });
    expect(layout.jointCount).toBe(1);
    expect(worstJoint(layout)).toBeGreaterThan(5);
    const moved = relaxJoints(layout, [b], (id) => id === a);
    expect([...moved.keys()]).toEqual([b]);
    layout.nudgePieces(moved);
    expect(layout.jointCount).toBe(1);
    expect(worstJoint(layout)).toBeLessThan(0.05);
    expect([...layout.joints()][0].angleError).toBeLessThan(1e-3);
  });

  it("spreads the slack of a run between two fixed ends over all its joints", () => {
    const layout = new Layout();
    // Two fixed straights 8 mm further apart than four 144s fill: one joint takes all the play.
    const left = layout.addPiece("straight-144", { x: 0, z: 0, heading: 0 });
    const right = layout.addPiece("straight-144", { x: 144 * 5 + 8, z: 0, heading: 0 });
    const run = [1, 2, 3, 4].map((i) => layout.addPiece("straight-144", { x: 144 * i, z: 0, heading: 0 }));
    expect(layout.jointCount).toBe(5);
    expect(worstJoint(layout)).toBeCloseTo(8, 5);
    const fixed = new Set([left, right]);
    const moved = relaxJoints(layout, [run[3]], (id) => fixed.has(id));
    layout.nudgePieces(moved);
    expect(layout.jointCount).toBe(5);
    expect(worstJoint(layout)).toBeLessThan(2);
    expect(layout.getPiece(left)!.pose).toEqual({ x: 0, z: 0, heading: 0 });
    expect(layout.getPiece(right)!.pose).toEqual({ x: 144 * 5 + 8, z: 0, heading: 0 });
  });

  it("leaves snug track alone", () => {
    const layout = new Layout();
    layout.addPiece("straight-144", { x: 0, z: 0, heading: 0 });
    const b = layout.addPiece("straight-144", { x: 144, z: 0, heading: 0 });
    expect(relaxJoints(layout, [b], () => false).size).toBe(0);
  });

  it("never moves pinned pieces, so a lone pinned joint keeps its play", () => {
    const layout = new Layout();
    layout.addPiece("straight-144", { x: 0, z: 0, heading: 0 });
    const b = layout.addPiece("straight-144", { x: 150, z: 0, heading: 0 });
    expect(relaxJoints(layout, [b], () => true).size).toBe(0);
    expect(worstJoint(layout)).toBeLessThanOrEqual(JOINT_POS_TOLERANCE);
  });
});

import { describe, expect, it } from "vitest";
import { JOINT_ANGLE_TOLERANCE, JOINT_POS_TOLERANCE } from "./constants";
import { connectorRef, createWorldConnector, Layout } from "./layout";
import { angleDiff } from "./math";
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

  /**
   * A run of 1 to 3 loose straights from a fixed straight, toward a fixed straight turned 3° to 13° about its end, its
   * end 0 to 12 mm past the run's: a near miss to close, as a drawn line closing on a station.
   */
  function closing(n: number, deg: number, gap: number) {
    const layout = new Layout();
    const a = layout.addPiece("straight-144", { x: 0, z: 0, heading: 0 });
    const run = Array.from({ length: n }, (_, i) => layout.addPiece("straight-144", { x: 144 * (i + 1), z: 0, heading: 0 }));
    const b = layout.addPiece("straight-144", { x: 144 * (n + 1) + gap, z: 0, heading: (deg * Math.PI) / 180 });
    const last = run[n - 1];
    const near: [number, number][] = [[connectorRef(last, 1), connectorRef(b, 0)]];
    return { layout, fixed: (id: number) => id === a || id === b, last, near };
  }
  const turnOf = (layout: Layout, [p, q]: [number, number]) =>
    angleDiff(layout.worldConnector(p, createWorldConnector()).heading, layout.worldConnector(q, createWorldConnector()).heading + Math.PI);

  it("never leaves a joint turned past the joint tolerance, nor a near miss it closes (QA: 8.1° at the sawmill)", () => {
    let closed = 0;
    for (const n of [1, 2, 3])
      for (let deg = 3; deg <= 13; deg += 2)
        for (const gap of [0, 6, 12]) {
          const { layout, fixed, last, near } = closing(n, deg, gap);
          const moved = relaxJoints(layout, [last], fixed, near);
          layout.nudgePieces(moved);
          const why = `${n} straights, ${deg}°, ${gap} mm`;
          for (const j of layout.joints()) expect(j.angleError, why).toBeLessThanOrEqual(JOINT_ANGLE_TOLERANCE + 1e-9);
          if (moved.size > 0) expect(turnOf(layout, near[0]), why).toBeLessThanOrEqual(JOINT_ANGLE_TOLERANCE + 1e-9);
          if (layout.seatFree(near[0][0])) closed++;
        }
    // The flex is kept, and more: 11 of the 54 close within the tolerance (5 did before, some only past it).
    expect(closed).toBeGreaterThanOrEqual(11);
  });

  it("spreads a turn the fixed ends leave over the loose run, so it closes (two straights, 5°, which one fit couldn't)", () => {
    for (const gap of [0, 6, 12]) {
      const { layout, fixed, last, near } = closing(2, 5, gap);
      layout.nudgePieces(relaxJoints(layout, [last], fixed, near));
      expect(layout.seatFree(near[0][0])).toBe(true);
      for (const j of layout.joints()) {
        expect(j.angleError).toBeLessThanOrEqual(JOINT_ANGLE_TOLERANCE);
        expect(j.posError).toBeLessThanOrEqual(JOINT_POS_TOLERANCE / 2);
      }
    }
  });
});

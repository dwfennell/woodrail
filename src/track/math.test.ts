import { describe, expect, it } from "vitest";
import { angleDiff, normalizeAngle, solveParentPose, transformPose, type Pose } from "./math";

const P = (x: number, z: number, heading: number): Pose => ({ x, z, heading });

describe("normalizeAngle", () => {
  it("maps into (-π, π]", () => {
    expect(normalizeAngle(0)).toBe(0);
    expect(normalizeAngle(Math.PI)).toBeCloseTo(Math.PI);
    expect(normalizeAngle(-Math.PI)).toBeCloseTo(Math.PI);
    expect(normalizeAngle(3 * Math.PI)).toBeCloseTo(Math.PI);
    expect(normalizeAngle(-Math.PI / 2 + 4 * Math.PI)).toBeCloseTo(-Math.PI / 2);
  });
});

describe("angleDiff", () => {
  it("is the smallest absolute difference across the wrap", () => {
    expect(angleDiff(Math.PI - 0.01, -Math.PI + 0.01)).toBeCloseTo(0.02);
    expect(angleDiff(0, Math.PI)).toBeCloseTo(Math.PI);
    expect(angleDiff(0.1, -0.1)).toBeCloseTo(0.2);
  });
});

describe("transformPose", () => {
  it("rotates then translates a local pose", () => {
    const out = P(0, 0, 0);
    transformPose(P(10, 20, Math.PI / 2), P(5, 0, 0), out);
    expect(out.x).toBeCloseTo(10);
    expect(out.z).toBeCloseTo(25);
    expect(out.heading).toBeCloseTo(Math.PI / 2);
  });

  it("returns the out object", () => {
    const out = P(0, 0, 0);
    expect(transformPose(P(0, 0, 0), P(1, 1, 0), out)).toBe(out);
  });
});

describe("solveParentPose", () => {
  it("inverts transformPose", () => {
    const local = P(30, -12, 0.7);
    const world = P(-100, 250, -2.1);
    const parent = solveParentPose(local, world, P(0, 0, 0));
    const back = transformPose(parent, local, P(0, 0, 0));
    expect(back.x).toBeCloseTo(world.x);
    expect(back.z).toBeCloseTo(world.z);
    expect(angleDiff(back.heading, world.heading)).toBeCloseTo(0);
  });
});

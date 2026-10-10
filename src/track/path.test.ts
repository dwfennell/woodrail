import { describe, expect, it } from "vitest";
import { angleDiff } from "./math";
import { createSample, pathLength, samplePath, type PathGeom } from "./path";

const line: PathGeom = { kind: "line", start: { x: 10, z: 5, heading: 0 }, length: 100, y0: 0, rise: 0 };
const arcLeft: PathGeom = { kind: "arc", start: { x: 0, z: 0, heading: 0 }, radius: 182, sweep: Math.PI / 4, y0: 0, rise: 0 };
const arcRight: PathGeom = { ...arcLeft, sweep: -Math.PI / 4 };
const ramp: PathGeom = { kind: "line", start: { x: 0, z: 0, heading: 0 }, length: 216, y0: 0, rise: 64 };

describe("pathLength", () => {
  it("is length for lines and radius × |sweep| for arcs", () => {
    expect(pathLength(line)).toBe(100);
    expect(pathLength(arcRight)).toBeCloseTo((182 * Math.PI) / 4);
  });
});

describe("samplePath", () => {
  it("moves along a line", () => {
    const s = samplePath(line, 40, createSample());
    expect(s.x).toBeCloseTo(50);
    expect(s.z).toBeCloseTo(5);
    expect(s.heading).toBeCloseTo(0);
  });

  it("ends a left (positive sweep) arc toward +z", () => {
    const s = samplePath(arcLeft, pathLength(arcLeft), createSample());
    expect(s.x).toBeCloseTo(182 * Math.sin(Math.PI / 4));
    expect(s.z).toBeCloseTo(182 * (1 - Math.cos(Math.PI / 4)));
    expect(angleDiff(s.heading, Math.PI / 4)).toBeCloseTo(0);
  });

  it("mirrors a right (negative sweep) arc toward -z", () => {
    const s = samplePath(arcRight, pathLength(arcRight), createSample());
    expect(s.z).toBeCloseTo(-182 * (1 - Math.cos(Math.PI / 4)));
    expect(angleDiff(s.heading, -Math.PI / 4)).toBeCloseTo(0);
  });

  it("has unit-speed tangent consistent with position on arcs", () => {
    const a = samplePath(arcLeft, 50, createSample());
    const b = samplePath(arcLeft, 50.001, createSample());
    expect((b.x - a.x) / 0.001).toBeCloseTo(Math.cos(a.heading), 3);
    expect((b.z - a.z) / 0.001).toBeCloseTo(Math.sin(a.heading), 3);
  });

  it("eases ramp height with zero slope at both ends", () => {
    const out = createSample();
    expect(samplePath(ramp, 0, out).y).toBeCloseTo(0);
    expect(out.slope).toBeCloseTo(0);
    expect(samplePath(ramp, 108, out).y).toBeCloseTo(32);
    expect(out.slope).toBeCloseTo((64 * 1.5) / 216);
    expect(samplePath(ramp, 216, out).y).toBeCloseTo(64);
    expect(out.slope).toBeCloseTo(0);
  });

  it("clamps distance to the path", () => {
    expect(samplePath(line, -20, createSample()).x).toBeCloseTo(10);
    expect(samplePath(line, 500, createSample()).x).toBeCloseTo(110);
  });
});

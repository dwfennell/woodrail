import { describe, expect, it } from "vitest";
import { Vector3 } from "three";
import { clampView, edgePan, frameDistance, isDoubleTap, lerpAngle } from "./camera-director";

describe("frameDistance", () => {
  it("fits a sphere to the narrower side of the frustum", () => {
    // Wide screen: vertical fov is the narrow side. sin(half fov) * d = radius.
    const d = frameDistance(100, 30, 16 / 9);
    expect(Math.sin((15 * Math.PI) / 180) * d).toBeCloseTo(100, 6);
    // Tall phone screen: horizontal fov is narrower, so the camera must back off further.
    expect(frameDistance(100, 30, 0.5)).toBeGreaterThan(d);
    const hHalf = Math.atan(Math.tan((15 * Math.PI) / 180) * 0.5);
    expect(Math.sin(hHalf) * frameDistance(100, 30, 0.5)).toBeCloseTo(100, 6);
  });
});

describe("clampView", () => {
  it("lifts a camera that sank below its target's horizon", () => {
    const t = new Vector3(0, 0, 0);
    const p = new Vector3(500, -40, 0);
    clampView(t, p, 100, 9000, 1.42);
    const polar = Math.acos((p.y - t.y) / p.distanceTo(t));
    expect(polar).toBeLessThanOrEqual(1.42 + 1e-9);
    expect(p.distanceTo(t)).toBeCloseTo(Math.hypot(500, 40), 6);
  });

  it("keeps the distance within range", () => {
    const t = new Vector3(10, 0, 10);
    const far = new Vector3(10, 20000, 10.001);
    clampView(t, far, 100, 9000, 1.42);
    expect(far.distanceTo(t)).toBeCloseTo(9000, 6);
    const near = new Vector3(10, 5, 10);
    clampView(t, near, 100, 9000, 1.42);
    expect(near.distanceTo(t)).toBeCloseTo(100, 6);
  });
});

describe("edgePan", () => {
  const out = { dx: 0, dy: 0 };
  it("is still in the middle of the screen", () => {
    edgePan(500, 400, 1000, 800, 60, out);
    expect(out).toEqual({ dx: 0, dy: 0 });
  });

  it("pushes fully at the edges, symmetrically", () => {
    edgePan(0, 400, 1000, 800, 60, out);
    expect(out.dx).toBeCloseTo(-1);
    edgePan(1000, 400, 1000, 800, 60, out);
    expect(out.dx).toBeCloseTo(1);
    edgePan(500, 0, 1000, 800, 60, out);
    expect(out.dy).toBeCloseTo(-1);
  });

  it("ramps in gently from the zone's inner edge", () => {
    edgePan(30, 400, 1000, 800, 60, out);
    expect(out.dx).toBeCloseTo(-0.25);
  });
});

describe("isDoubleTap", () => {
  const a = { t: 1000, x: 100, y: 100 };
  it("accepts a quick second tap in the same place", () => expect(isDoubleTap(a, { t: 1250, x: 110, y: 104 })).toBe(true));
  it("rejects a slow second tap", () => expect(isDoubleTap(a, { t: 1320, x: 100, y: 100 })).toBe(false));
  it("rejects a tap somewhere else", () => expect(isDoubleTap(a, { t: 1100, x: 130, y: 100 })).toBe(false));
  it("rejects a first tap", () => expect(isDoubleTap(null, a)).toBe(false));
});

describe("lerpAngle", () => {
  it("takes the short way round", () => {
    expect(lerpAngle(3, -3, 0.5)).toBeCloseTo(Math.PI, 6);
    expect(lerpAngle(0.1, 0.5, 1)).toBeCloseTo(0.5, 9);
  });
});

import { describe, expect, it } from "vitest";
import { Vector3 } from "three";
import { clampTarget, clampView, edgePan, frameDistance, isDoubleTap, lerpAngle } from "./camera-director";

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

describe("clampTarget", () => {
  it("keeps the look-at point over the mat, moving the camera with it", () => {
    const t = new Vector3(3000, 0, -2500);
    const p = new Vector3(3500, 800, -1500);
    clampTarget(t, p, 2240, 1664);
    expect(t.x).toBe(2240);
    expect(t.z).toBe(-1664);
    expect(p.x).toBe(2740);
    expect(p.z).toBe(-664);
    expect(p.y).toBe(800);
  });

  it("leaves a target on the mat alone", () => {
    const t = new Vector3(100, 20, -50);
    const p = new Vector3(600, 900, 700);
    clampTarget(t, p, 2240, 1664);
    expect(t.toArray()).toEqual([100, 20, -50]);
    expect(p.toArray()).toEqual([600, 900, 700]);
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

import { PerspectiveCamera } from "three";
import type { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { CameraDirector } from "./camera-director";

describe("CameraDirector edge pan", () => {
  it("pans toward the camera when dragging just above the tray (the screen's usable bottom)", () => {
    const camera = new PerspectiveCamera(30, 1000 / 800, 5, 40000);
    camera.position.set(0, 600, 600);
    const controls = { target: new Vector3(), minDistance: 100, maxDistance: 9000, maxPolarAngle: 1.42, addEventListener: () => {} } as unknown as OrbitControls;
    camera.lookAt(controls.target);
    const d = new CameraDirector(camera, controls);
    // Tray covers y 600..800; the pointer is just above it.
    d.setEdgePointer({ x: 500, y: 590, touch: false, bottom: 600 });
    d.update(1 / 30, 1000, 800);
    expect(controls.target.z).toBeGreaterThan(0);
  });
});

describe("CameraDirector over the scenery around the mat", () => {
  const setup = () => {
    const camera = new PerspectiveCamera(30, 1000 / 800, 5, 40000);
    camera.position.set(0, 1500, 1500);
    const controls = { target: new Vector3(), minDistance: 100, maxDistance: 14000, maxPolarAngle: 1.42, addEventListener: () => {} } as unknown as OrbitControls;
    camera.lookAt(controls.target);
    const d = new CameraDirector(camera, controls);
    d.bounds = { halfW: 2240, halfD: 1664 };
    return { camera, controls, d };
  };

  it("glides toward the nearest point on the mat, easing all the way, when asked to look off it", () => {
    const { controls, d } = setup();
    d.glideTo(new Vector3(6000, 0, 0), 1500, { duration: 1 });
    const xs: number[] = [];
    for (let i = 0; i < 60; i++) {
      d.update(1 / 60, 1000, 800);
      xs.push(controls.target.x);
    }
    // Halfway through an ease-in-out the target is halfway to its (clamped) destination, not already at the edge.
    expect(xs[29]).toBeGreaterThan(900);
    expect(xs[29]).toBeLessThan(1300);
    expect(xs[59]).toBeCloseTo(2240, 0);
  });

  it("zooming at a point far out in the haze doesn't lurch the view to the mat's edge", () => {
    const { controls, d } = setup();
    d.zoomAt(new Vector3(30000, 0, 0), -200);
    d.update(1 / 60, 1000, 800);
    expect(controls.target.x).toBeLessThan(400);
  });
});

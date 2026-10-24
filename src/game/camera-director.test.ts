import { describe, expect, it } from "vitest";
import { Spherical, Vector3 } from "three";
import { aimInRoom, clampTarget, clampView, fitToRect, EDGE_TOUCH_DWELL, EDGE_TOUCH_RAMP, EDGE_TOUCH_SPEED, EDGE_TOUCH_ZONE, edgeDwell, edgePan, frameAlong, frameDistance, isDoubleTap, lerpAngle, nearPlaneFor } from "./camera-director";

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

describe("nearPlaneFor", () => {
  it("pulls the near plane out as the camera backs off, so distant layers a fraction of a mm apart don't flicker", () => {
    // 24-bit depth: the smallest depth step at distance z is about z² / (near · 2²⁴).
    const step = (z: number) => (z * z) / (nearPlaneFor(z) * 2 ** 24);
    for (const d of [120, 420, 1500, 4000, 9000, 14000]) expect(step(d)).toBeLessThan(0.1);
  });

  it("stays close enough that nothing between the camera and its target is cut away", () => {
    for (const d of [120, 420, 1500, 4000, 14000]) expect(nearPlaneFor(d)).toBeLessThanOrEqual(Math.max(5, d * 0.04));
    expect(nearPlaneFor(120)).toBe(5);
  });
});

describe("clampTarget", () => {
  it("keeps the look-at point over the mat, moving the camera with it", () => {
    const t = new Vector3(3000, 0, -2500);
    const p = new Vector3(3500, 800, -1500);
    clampTarget(t, p, { x0: -2240, z0: -1664, x1: 2240, z1: 1664 });
    expect(t.x).toBe(2240);
    expect(t.z).toBe(-1664);
    expect(p.x).toBe(2740);
    expect(p.z).toBe(-664);
    expect(p.y).toBe(800);
  });

  it("leaves a target on the mat alone", () => {
    const t = new Vector3(100, 20, -50);
    const p = new Vector3(600, 900, 700);
    clampTarget(t, p, { x0: -2240, z0: -1664, x1: 2240, z1: 1664 });
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

  it("waits for a drag out of the tray to leave the edge band before panning, then pans when it comes back", () => {
    const camera = new PerspectiveCamera(30, 1000 / 800, 5, 40000);
    camera.position.set(0, 600, 600);
    const controls = { target: new Vector3(), minDistance: 100, maxDistance: 9000, maxPolarAngle: 1.42, addEventListener: () => {} } as unknown as OrbitControls;
    camera.lookAt(controls.target);
    const d = new CameraDirector(camera, controls);
    // Just out of the tray: inside the bottom band, but the finger is only passing through.
    d.setEdgePointer({ x: 500, y: 590, touch: true, bottom: 600, waitForExit: true });
    d.update(1 / 30, 1000, 800);
    expect(controls.target.z).toBe(0);
    expect(d.edgePanning).toBe(false);
    // Up into the open view, then back down to the edge on purpose.
    d.setEdgePointer({ x: 500, y: 300, touch: true, bottom: 600, waitForExit: true });
    d.update(1 / 30, 1000, 800);
    d.setEdgePointer({ x: 500, y: 590, touch: true, bottom: 600, waitForExit: true });
    d.update(1 / 30, 1000, 800);
    // (On touch it waits in the band a moment before it moves: see edgeDwell.)
    expect(controls.target.z).toBe(0);
    for (let k = 0; k < 30; k++) d.update(1 / 30, 1000, 800);
    expect(controls.target.z).toBeGreaterThan(0);
    // Back over the tray (no pointer) and out again: waits again.
    const z = controls.target.z;
    d.setEdgePointer(null);
    d.setEdgePointer({ x: 500, y: 590, touch: true, bottom: 600, waitForExit: true });
    d.update(1 / 30, 1000, 800);
    expect(controls.target.z).toBe(z);
  });

  it("on a slow phone the wait before an edge pan is still half a second, not stretched by the capped frame step", () => {
    const camera = new PerspectiveCamera(30, 1000 / 800, 5, 40000);
    camera.position.set(0, 600, 600);
    const controls = { target: new Vector3(), minDistance: 100, maxDistance: 9000, maxPolarAngle: 1.42, addEventListener: () => {} } as unknown as OrbitControls;
    camera.lookAt(controls.target);
    const d = new CameraDirector(camera, controls);
    d.setEdgePointer({ x: 500, y: 590, touch: true, bottom: 600 });
    // 4 fps: each frame's step is capped at 0.1 s, but 0.25 s really passed.
    d.update(0.1, 1000, 800, 0.25);
    expect(controls.target.z).toBe(0);
    d.update(0.1, 1000, 800, 0.25);
    d.update(0.1, 1000, 800, 0.25);
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
    d.bounds = { x0: -2240, z0: -1664, x1: 2240, z1: 1664 };
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

  it("a glide goes by the time that's passed: one slow frame (3 s, its step capped at 0.1) lands it, exactly, done", () => {
    const { camera, controls, d } = setup();
    d.glideTo(new Vector3(800, 0, -400), 2000, { phi: 0.6, duration: 0.9 });
    d.update(1 / 60, 1000, 800, 1 / 60);
    d.update(0.1, 1000, 800, 3);
    expect(d.busy).toBe(false);
    expect(controls.target.x).toBeCloseTo(800, 6);
    expect(controls.target.z).toBeCloseTo(-400, 6);
    expect(camera.position.distanceTo(controls.target)).toBeCloseTo(2000, 6);
    // (Done: another frame leaves it where it is.)
    const at = camera.position.clone();
    d.update(0.1, 1000, 800, 3);
    expect(camera.position.distanceTo(at)).toBe(0);
  });

  it("a glide's first step is the frame's capped step: the slow frame that started it (a tap's handler) doesn't jump it", () => {
    const { controls, d } = setup();
    const x0 = controls.target.x;
    d.glideTo(new Vector3(x0 + 1000, 0, 0), 2000, { duration: 0.9 });
    // (QA: 683 ms went by in the tap's handler before the glide's first frame.)
    d.update(0.1, 1000, 800, 0.683);
    expect(d.busy).toBe(true);
    // Eased in over 0.1 s of 0.9 (k ≈ 0.005), not 0.683 s (k ≈ 0.79).
    expect(controls.target.x - x0).toBeLessThan(10);
    expect(controls.target.x - x0).toBeGreaterThan(0);
    // From then on, by the time that's passed: a slow frame lands it.
    d.update(0.1, 1000, 800, 3);
    expect(d.busy).toBe(false);
    expect(controls.target.x).toBeCloseTo(x0 + 1000, 6);
  });

  it("zooming at a point far out in the haze doesn't lurch the view to the mat's edge", () => {
    const { controls, d } = setup();
    d.zoomAt(new Vector3(30000, 0, 0), -200);
    d.update(1 / 60, 1000, 800);
    expect(controls.target.x).toBeLessThan(400);
  });
});

describe("frameAlong", () => {
  it("lays two places up the screen on a phone held upright, across it on a wide screen, and fits them", () => {
    const pts = [
      { x: 0, z: 0 },
      { x: 1000, z: 0 },
    ];
    const tall = frameAlong(pts, 45, 390 / 844, 200);
    const wide = frameAlong(pts, 45, 1280 / 800, 200);
    expect([tall.x, tall.z]).toEqual([500, 0]);
    // Upright: the camera stands back along the span (it runs up the screen); wide: across it.
    expect(Math.abs(Math.sin(tall.theta!))).toBeCloseTo(1);
    expect(Math.abs(Math.cos(wide.theta!))).toBeCloseTo(1);
    // The span fits the phone's long side: half as far back as fitting it across (its short side).
    expect(tall.distance).toBeLessThan(frameDistance(700, 45, 390 / 844) * 0.55);
    expect(wide.distance).toBeLessThan(tall.distance);
    expect(frameAlong([{ x: 5, z: 5 }], 45, 1, 200).theta).toBeNull();
  });
});

describe("edge pan while placing, on touch (QA: the view ran off with the target)", () => {
  it("a mouse pans at once, in full", () => {
    expect(edgeDwell(0, false)).toBe(1);
  });
  it("a finger waits in the band before the view moves", () => {
    expect(edgeDwell(0, true)).toBe(0);
    expect(edgeDwell(EDGE_TOUCH_DWELL - 0.01, true)).toBe(0);
  });
  it("…then eases in, to at most half the mouse's speed", () => {
    expect(edgeDwell(EDGE_TOUCH_DWELL + EDGE_TOUCH_RAMP / 2, true)).toBeCloseTo(EDGE_TOUCH_SPEED / 2);
    expect(edgeDwell(EDGE_TOUCH_DWELL + EDGE_TOUCH_RAMP, true)).toBeCloseTo(EDGE_TOUCH_SPEED);
    expect(edgeDwell(10, true)).toBeCloseTo(EDGE_TOUCH_SPEED);
    expect(EDGE_TOUCH_SPEED).toBeLessThanOrEqual(0.5);
  });
  it("the band on touch is narrow (it was 72 px)", () => {
    expect(EDGE_TOUCH_ZONE).toBeLessThanOrEqual(40);
  });
});

describe("fitToRect: the whole railway in the room the HUD leaves (QA: back to my railway)", () => {
  // A phone held upright, the view tilted as a player has it, a top bar (to 70 px) and the tray (from 690 px).
  const W = 390;
  const H = 844;
  const room = { left: 0, top: 70, right: W, bottom: 690 };
  const camera = () => new PerspectiveCamera(30, W / H, 5, 40000);
  const onScreen = (points: Vector3[], fit: { target: Vector3; distance: number }, phi: number, theta: number) => {
    const cam = camera();
    cam.position.setFromSpherical(new Spherical(fit.distance, phi, theta)).add(fit.target);
    cam.lookAt(fit.target);
    cam.updateMatrixWorld();
    return points.map((p) => {
      const v = p.clone().project(cam);
      return { x: ((v.x + 1) / 2) * W, y: ((1 - v.y) / 2) * H };
    });
  };
  const check = (points: Vector3[], phi: number, theta: number) => {
    const fit = fitToRect(points, camera(), phi, theta, room, W, H, 24);
    const s = onScreen(points, fit, phi, theta);
    const xs = s.map((p) => p.x);
    const ys = s.map((p) => p.y);
    // All of it in the room, with the margin (to a pixel or two)...
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(room.left + 22);
    expect(Math.max(...xs)).toBeLessThanOrEqual(room.right - 22);
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(room.top + 22);
    expect(Math.max(...ys)).toBeLessThanOrEqual(room.bottom - 22);
    // ...and filling it one way (not just far off).
    const fill = Math.max((Math.max(...xs) - Math.min(...xs)) / (W - 48), (Math.max(...ys) - Math.min(...ys)) / (room.bottom - room.top - 48));
    expect(fill).toBeGreaterThan(0.9);
  };

  it("six straights in a line, along the screen's long side", () => {
    const line = Array.from({ length: 7 }, (_, i) => new Vector3(400 + i * 216, 0, 300));
    check(line, 1.0, Math.PI / 2);
  });

  it("two stations far apart, and a loop, at another tilt and heading", () => {
    check([new Vector3(-900, 0, 200), new Vector3(1100, 0, -150)], 0.8, -1.4);
    const loop = Array.from({ length: 16 }, (_, i) => new Vector3(Math.cos((i / 16) * 2 * Math.PI) * 600, 0, Math.sin((i / 16) * 2 * Math.PI) * 400));
    check(loop, 1.1, 0.3);
  });
});

describe("aimInRoom: the game's glides show their target in the middle of what the map shows, not behind a card", () => {
  const show = (look: Vector3, target: Vector3, d: number, phi: number, theta: number, w: number, h: number) => {
    const cam = new PerspectiveCamera(30, w / h, 5, 40000);
    cam.position.setFromSpherical(new Spherical(d, phi, theta)).add(look);
    cam.lookAt(look);
    cam.updateMatrixWorld();
    const v = target.clone().project(cam);
    return { x: ((v.x + 1) / 2) * w, y: ((1 - v.y) / 2) * h };
  };
  const cases = [
    // A phone upright, a card over the bottom half; a phone on its side, a card docked at the right.
    { w: 390, h: 844, room: { left: 0, top: 70, right: 390, bottom: 380 } },
    { w: 844, h: 390, room: { left: 0, top: 56, right: 520, bottom: 250 } },
  ];
  for (const { w, h, room } of cases)
    for (const [phi, theta, d] of [[1.0, 0.3, 420], [0.7, -2.1, 1500], [1.2, 1.4, 900]])
      it(`${w}x${h}, phi ${phi}, theta ${theta}, ${d} mm away`, () => {
        const target = new Vector3(320, 24, -180);
        const camera = new PerspectiveCamera(30, w / h, 5, 40000);
        const look = aimInRoom(target, d, phi, theta, camera, w, h, room);
        const s = show(look, target, d, phi, theta, w, h);
        expect(s.x).toBeCloseTo((room.left + room.right) / 2, 0);
        expect(s.y).toBeCloseTo((room.top + room.bottom) / 2, 0);
        expect(look.y).toBe(target.y);
      });
  it("with the whole view as the room it's where it was", () => {
    const target = new Vector3(10, 0, 20);
    const look = aimInRoom(target, 600, 1, 0.5, new PerspectiveCamera(30, 390 / 844, 5, 40000), 390, 844, { left: 0, top: 0, right: 390, bottom: 844 });
    expect(look.distanceTo(target)).toBeLessThan(1e-6);
  });
});

describe("fitToRect with a lone point (QA: Show me's one marker sat at the screen's middle, behind a card)", () => {
  it("at the least distance given, the point shows in the room's middle", () => {
    const W = 844;
    const H = 390;
    const room = { left: 0, top: 116, right: 414, bottom: 246 };
    const camera = new PerspectiveCamera(30, W / H, 5, 40000);
    const point = new Vector3(300, 0, -200);
    const fit = fitToRect([point], camera, 1.0, 0.4, room, W, H, 32, 1100);
    expect(fit.distance).toBeCloseTo(1100, 6);
    const cam = new PerspectiveCamera(30, W / H, 5, 40000);
    cam.position.setFromSpherical(new Spherical(fit.distance, 1.0, 0.4)).add(fit.target);
    cam.lookAt(fit.target);
    cam.updateMatrixWorld();
    const v = point.clone().project(cam);
    expect(((v.x + 1) / 2) * W).toBeCloseTo((room.left + room.right) / 2, 0);
    expect(((1 - v.y) / 2) * H).toBeCloseTo((room.top + room.bottom) / 2, 0);
  });
});

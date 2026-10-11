import { PerspectiveCamera, Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { isTilt, TouchGestures } from "./touch-camera";

const view = { width: 400, height: 800 };
const limits = { minDistance: 120, maxDistance: 14000, maxPolarAngle: 1.42 };

function rig() {
  const camera = new PerspectiveCamera(45, view.width / view.height, 1, 100000);
  const target = new Vector3(0, 0, 0);
  camera.position.set(0, 900, 700);
  camera.lookAt(target);
  camera.updateMatrixWorld();
  return { camera, target, g: new TouchGestures(camera, target, limits) };
}

/** Where a world point lands on screen (px). */
function screenOf(camera: PerspectiveCamera, p: Vector3): { x: number; y: number } {
  camera.updateMatrixWorld();
  const v = p.clone().project(camera);
  return { x: ((v.x + 1) / 2) * view.width, y: ((1 - v.y) / 2) * view.height };
}

describe("touch camera", () => {
  it("one finger drags the ground: the point under it stays under it", () => {
    const { camera, g } = rig();
    const start = { x: 150, y: 500 };
    const ground = g.groundAt(start, view, new Vector3())!.clone();
    g.begin([start], view);
    for (let k = 1; k <= 12; k++) g.move([{ x: 150 + k * 10, y: 500 - k * 15 }], view, k / 60);
    const s = screenOf(camera, ground);
    expect(s.x).toBeCloseTo(270, 0);
    expect(s.y).toBeCloseTo(320, 0);
  });

  it("two fingers pinch, twist and pan about their midpoint, keeping the ground under each finger", () => {
    const { camera, g } = rig();
    const a0 = { x: 140, y: 420 };
    const b0 = { x: 260, y: 460 };
    const ga = g.groundAt(a0, view, new Vector3())!.clone();
    const gb = g.groundAt(b0, view, new Vector3())!.clone();
    g.begin([a0, b0], view);
    // Spread 1.4×, turn 25°, and move the midpoint 40 px right, in small steps.
    const mid0 = { x: 200, y: 440 };
    const steps = 20;
    let a = a0;
    let b = b0;
    for (let k = 1; k <= steps; k++) {
      const t = k / steps;
      const ang = (25 * Math.PI) / 180 * t;
      const sc = 1 + 0.4 * t;
      const mid = { x: mid0.x + 40 * t, y: mid0.y };
      const place = (p: { x: number; y: number }) => {
        const dx = (p.x - mid0.x) * sc;
        const dy = (p.y - mid0.y) * sc;
        return { x: mid.x + dx * Math.cos(ang) - dy * Math.sin(ang), y: mid.y + dx * Math.sin(ang) + dy * Math.cos(ang) };
      };
      a = place(a0);
      b = place(b0);
      g.move([a, b], view, k / 60);
    }
    const sa = screenOf(camera, ga);
    const sb = screenOf(camera, gb);
    expect(Math.hypot(sa.x - a.x, sa.y - a.y)).toBeLessThan(2);
    expect(Math.hypot(sb.x - b.x, sb.y - b.y)).toBeLessThan(2);
  });

  it("two fingers dragged up together tilt toward the horizon, without moving the target", () => {
    const { camera, target, g } = rig();
    const phi0 = Math.acos((camera.position.y - target.y) / camera.position.distanceTo(target));
    g.begin([{ x: 150, y: 500 }, { x: 250, y: 505 }], view);
    for (let k = 1; k <= 10; k++) g.move([{ x: 150, y: 500 - k * 8 }, { x: 250, y: 505 - k * 8 }], view, k / 60);
    const phi1 = Math.acos((camera.position.y - target.y) / camera.position.distanceTo(target));
    expect(phi1).toBeGreaterThan(phi0 + 0.3);
    expect(target.length()).toBeLessThan(1e-6);
  });

  it("a fling glides on and comes smoothly to rest; a slow release doesn't", () => {
    const { target, g } = rig();
    g.begin([{ x: 200, y: 400 }], view);
    for (let k = 1; k <= 6; k++) g.move([{ x: 200 - k * 20, y: 400 }], view, k / 60);
    g.end(6 / 60 + 0.01);
    const at = target.clone();
    let frames = 0;
    while (g.glide(1 / 60) && frames < 600) frames++;
    const coasted = target.distanceTo(at);
    expect(coasted).toBeGreaterThan(50);
    // About two and a half time constants or more before it settles (not an abrupt stop).
    expect(frames / 60).toBeGreaterThan(0.6);

    const r = rig();
    r.g.begin([{ x: 200, y: 400 }], view);
    for (let k = 1; k <= 6; k++) r.g.move([{ x: 200 - k * 20, y: 400 }], view, k / 60);
    r.g.end(6 / 60 + 0.3);
    expect(r.g.glide(1 / 60)).toBe(false);
  });

  it("tells a two-finger tilt from a pinch or a pan", () => {
    expect(isTilt({ x: 100, y: 400 }, { x: 200, y: 400 }, { x: 100, y: 385 }, { x: 200, y: 386 })).toBe(true);
    expect(isTilt({ x: 100, y: 400 }, { x: 200, y: 400 }, { x: 90, y: 400 }, { x: 210, y: 400 })).toBe(false);
    expect(isTilt({ x: 100, y: 400 }, { x: 200, y: 400 }, { x: 115, y: 400 }, { x: 215, y: 400 })).toBe(false);
  });
});

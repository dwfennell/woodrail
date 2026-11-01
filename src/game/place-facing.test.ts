import { describe, expect, it } from "vitest";
import { copyPointerMotion, createPointerMotion, facingAlong, FACING_DEAD_PX, FACING_WINDOW_PX, notePointer, type PointerMotion } from "./place-facing";

/** The pointer moved from (x, y) by (dx, dy) in `steps` even moves. */
function path(m: PointerMotion, x: number, y: number, dx: number, dy: number, steps = 10): void {
  if (Number.isNaN(m.x)) notePointer(m, x, y);
  for (let k = 1; k <= steps; k++) notePointer(m, m.x + dx / steps, m.y + dy / steps);
}

/** A choice made the way the drag makes it: the train flips when told −1, and stays as it is otherwise. */
function held(m: PointerMotion, way: 1 | -1, tx: number, ty: number): 1 | -1 {
  const said = facingAlong(m, way * tx, way * ty);
  return said === -1 ? (-way as 1 | -1) : way;
}

describe("facing a held train by the pointer's way along the track", () => {
  it("says nothing before the pointer moves (tap to place, a click on the map)", () => {
    const m = createPointerMotion();
    expect(facingAlong(m, 1, 0)).toBe(0);
    notePointer(m, 100, 100);
    expect(facingAlong(m, 1, 0)).toBe(0);
  });

  it("dragged right along a track running across the screen: that way; dragged left: the other", () => {
    const right = createPointerMotion();
    path(right, 100, 300, 80, 0);
    expect(facingAlong(right, 1, 0)).toBe(1);
    expect(facingAlong(right, -1, 0)).toBe(-1);
    const left = createPointerMotion();
    path(left, 300, 300, -80, 0);
    expect(facingAlong(left, 1, 0)).toBe(-1);
  });

  it("is by the track's way on screen, at any length (a track running up the screen)", () => {
    const m = createPointerMotion();
    path(m, 200, 500, 3, -70);
    expect(facingAlong(m, 0, -0.01)).toBe(1);
    expect(facingAlong(m, 0, 40)).toBe(-1);
  });

  it("moving across the track says nothing", () => {
    const m = createPointerMotion();
    path(m, 200, 500, 0, -120);
    expect(facingAlong(m, 1, 0)).toBe(0);
    // A little sideways drift with it isn't enough either.
    const n = createPointerMotion();
    path(n, 200, 500, 15, -120);
    expect(facingAlong(n, 1, 0)).toBe(0);
  });

  it("a small nudge (under the dead zone) says nothing", () => {
    const m = createPointerMotion();
    path(m, 200, 300, FACING_DEAD_PX - 4, 0);
    expect(facingAlong(m, 1, 0)).toBe(0);
  });

  it("keeps only the recent path: a long drag one way, then a clear drag back, turns it", () => {
    const m = createPointerMotion();
    path(m, 0, 300, 600, 0, 60);
    expect(Math.hypot(m.dx, m.dy)).toBeCloseTo(FACING_WINDOW_PX, 6);
    // Back by the window alone: even, nothing said yet; past it by the dead zone: turned.
    path(m, m.x, m.y, -60, 0, 10);
    expect(facingAlong(m, 1, 0)).toBe(0);
    path(m, m.x, m.y, -FACING_DEAD_PX - 2, 0, 4);
    expect(facingAlong(m, 1, 0)).toBe(-1);
  });

  it("jitter doesn't flip it, and a pointer coming up out of the tray then along the track goes along", () => {
    const m = createPointerMotion();
    // Up from the tray onto a track running across the screen, then 40 px along it to the right.
    path(m, 200, 800, 0, -300, 20);
    path(m, m.x, m.y, 40, 0, 5);
    let way: 1 | -1 = 1;
    way = held(m, way, 1, 0);
    expect(way).toBe(1);
    way = held(m, -1, 1, 0);
    expect(way).toBe(1);
    // Wobbles of a few px either way: stays.
    for (let k = 0; k < 40; k++) {
      notePointer(m, m.x + (k % 2 ? -6 : 6), m.y + (k % 3) - 1);
      way = held(m, way, 1, 0);
      expect(way).toBe(1);
    }
  });

  it("hysteresis: once a way is said, holding still or a short move back keeps it", () => {
    const m = createPointerMotion();
    path(m, 100, 300, 60, 0);
    let way: 1 | -1 = held(m, -1, 1, 0);
    expect(way).toBe(1);
    // 30 px back: the window's sum is still ahead (30 px), so it keeps the way.
    path(m, m.x, m.y, -30, 0, 6);
    way = held(m, way, 1, 0);
    expect(way).toBe(1);
    // Further back: turned.
    path(m, m.x, m.y, -60, 0, 6);
    way = held(m, way, 1, 0);
    expect(way).toBe(-1);
  });

  it("a copy carries the motion over (a click from a carried ghost)", () => {
    const a = createPointerMotion();
    path(a, 10, 10, -70, 0);
    const b = createPointerMotion();
    copyPointerMotion(a, b);
    notePointer(b, a.x, a.y);
    expect(facingAlong(b, 1, 0)).toBe(-1);
  });

  it("a zero-length track direction says nothing", () => {
    const m = createPointerMotion();
    path(m, 0, 0, 80, 0);
    expect(facingAlong(m, 0, 0)).toBe(0);
  });
});

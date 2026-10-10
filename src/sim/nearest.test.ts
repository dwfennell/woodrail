import { describe, expect, it } from "vitest";
import { appendPiece, connectorRef, Layout } from "../track";
import { createWorldSample, cursorWorld } from "./cursor";
import { nearestCursor } from "./nearest";

describe("nearestCursor", () => {
  it("projects onto a straight", () => {
    const l = new Layout();
    const a = l.addPiece("straight-216", { x: 0, z: 0, heading: 0 });
    const r = nearestCursor(l, 100, 12, 40, 0);
    expect(r).not.toBeNull();
    expect(r!.cursor.pieceId).toBe(a);
    expect(r!.cursor.s).toBeCloseTo(100);
    expect(r!.distance).toBeCloseTo(12);
  });

  it("projects onto an arc and returns a cursor at that world point", () => {
    const l = new Layout();
    const a = l.addPiece("curve-large", { x: 0, z: 0, heading: 0 });
    appendPiece(l, "curve-large", false, connectorRef(a, 1));
    const target = { x: 120, z: 50 };
    const r = nearestCursor(l, target.x, target.z, 60, 0)!;
    const w = cursorWorld(l, r.cursor, createWorldSample());
    expect(Math.hypot(w.x - target.x, w.z - target.z)).toBeCloseTo(r.distance, 3);
    expect(r.distance).toBeLessThan(30);
  });

  it("prefers the travel direction closest to the given heading", () => {
    const l = new Layout();
    l.addPiece("straight-216", { x: 0, z: 0, heading: 0 });
    expect(nearestCursor(l, 100, 0, 40, Math.PI)!.cursor.reversed).toBe(true);
    expect(nearestCursor(l, 100, 0, 40, 0.2)!.cursor.reversed).toBe(false);
  });

  it("returns null when nothing is in range", () => {
    const l = new Layout();
    l.addPiece("straight-216", { x: 0, z: 0, heading: 0 });
    expect(nearestCursor(l, 100, 300, 40, 0)).toBeNull();
  });
});

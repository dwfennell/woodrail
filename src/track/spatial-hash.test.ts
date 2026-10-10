import { describe, expect, it } from "vitest";
import { SpatialHash } from "./spatial-hash";

describe("SpatialHash", () => {
  it("finds items in nearby cells and not far ones", () => {
    const h = new SpatialHash(64);
    h.insert(1, 10, 10);
    h.insert(2, 70, 10);
    h.insert(3, 1000, 1000);
    const out: number[] = [];
    const n = h.query(30, 10, 45, out);
    expect(out.slice(0, n).sort()).toEqual([1, 2]);
  });

  it("works across negative coordinates far from the origin", () => {
    const h = new SpatialHash(64);
    h.insert(7, -50_000.5, -80_000.25);
    h.insert(8, -49_990, -80_000);
    const out: number[] = [];
    const n = h.query(-50_000, -80_000, 20, out);
    expect(out.slice(0, n).sort()).toEqual([7, 8]);
  });

  it("finds items across a cell boundary", () => {
    const h = new SpatialHash(64);
    h.insert(1, 63.9, 0);
    const out: number[] = [];
    expect(h.query(64.1, 0, 1, out)).toBe(1);
  });

  it("removes items", () => {
    const h = new SpatialHash(64);
    h.insert(1, 0, 0);
    expect(h.remove(1)).toBe(true);
    expect(h.remove(1)).toBe(false);
    expect(h.has(1)).toBe(false);
    expect(h.query(0, 0, 10, [])).toBe(0);
    expect(h.size).toBe(0);
  });

  it("clears the out array before writing", () => {
    const h = new SpatialHash(64);
    const out = [99, 98, 97];
    expect(h.query(0, 0, 10, out)).toBe(0);
    expect(out).toHaveLength(0);
  });

  it("re-inserting an item moves it", () => {
    const h = new SpatialHash(64);
    h.insert(1, 0, 0);
    h.insert(1, 500, 500);
    expect(h.query(0, 0, 10, [])).toBe(0);
    expect(h.query(500, 500, 10, [])).toBe(1);
    expect(h.size).toBe(1);
  });
});

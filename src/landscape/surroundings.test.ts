import { describe, expect, it } from "vitest";
import { CELL, MAT_DEPTH, MAT_WIDTH } from "./grid";
import { generateSurroundings, outsideDistance, RING_WIDTH, SCENERY_MARGIN } from "./surroundings";

const overlaps = (a: { x0: number; z0: number; x1: number; z1: number }, b: { x0: number; z0: number; x1: number; z1: number }) =>
  a.x0 < b.x1 && b.x0 < a.x1 && a.z0 < b.z1 && b.z0 < a.z1;

describe("outsideDistance", () => {
  it("is zero on the mat and grows away from its edges and corners", () => {
    expect(outsideDistance(0, 0)).toBe(0);
    expect(outsideDistance(MAT_WIDTH / 2 - 1, MAT_DEPTH / 2 - 1)).toBe(0);
    expect(outsideDistance(MAT_WIDTH / 2 + 100, 0)).toBe(100);
    expect(outsideDistance(0, -MAT_DEPTH / 2 - 250)).toBe(250);
    expect(outsideDistance(MAT_WIDTH / 2 + 30, MAT_DEPTH / 2 + 40)).toBeCloseTo(50);
  });
});

describe("generateSurroundings", () => {
  const seeds = [1, 2, 3, 7, 42, 99, 123, 500];

  it("is deterministic per seed and varies between seeds", () => {
    expect(generateSurroundings(42)).toEqual(generateSurroundings(42));
    expect(generateSurroundings(42).blocks).not.toEqual(generateSurroundings(43).blocks);
  });

  it.each(seeds)("seed %i: scenery stays off the mat and its margin, within the ring", (seed) => {
    const s = generateSurroundings(seed);
    expect(s.blocks.length).toBeGreaterThan(500);
    for (const b of s.blocks) {
      // Nearest point of the block's square to the mat.
      const nx = Math.max(Math.abs(b.x) - b.size / 2, 0);
      const nz = Math.max(Math.abs(b.z) - b.size / 2, 0);
      expect(outsideDistance(Math.sign(b.x) * nx, Math.sign(b.z) * nz)).toBeGreaterThanOrEqual(SCENERY_MARGIN - 1e-6);
      expect(outsideDistance(b.x, b.z)).toBeLessThanOrEqual(RING_WIDTH + b.size);
    }
    for (const t of s.trees) {
      expect(outsideDistance(t.x, t.z)).toBeGreaterThanOrEqual(SCENERY_MARGIN);
      expect(outsideDistance(t.x, t.z)).toBeLessThanOrEqual(RING_WIDTH + 2 * CELL);
    }
    for (const h of s.houses) expect(outsideDistance(h.cx, h.cz) - Math.hypot(h.w, h.d) / 2).toBeGreaterThanOrEqual(SCENERY_MARGIN);
  });

  it.each(seeds)("seed %i: hills rise toward the horizon", (seed) => {
    const s = generateSurroundings(seed);
    const tops = s.blocks.filter((b) => b.top);
    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
    const near = tops.filter((b) => outsideDistance(b.x, b.z) < 900).map((b) => b.y + b.height);
    const far = tops.filter((b) => outsideDistance(b.x, b.z) > 2000).map((b) => b.y + b.height);
    expect(mean(far)).toBeGreaterThan(mean(near) * 1.5);
  });

  it.each(seeds)("seed %i: only blocks that can be seen are listed", (seed) => {
    const s = generateSurroundings(seed);
    const key = (b: { x: number; z: number; y: number }) => `${b.x},${b.z},${b.y}`;
    const columns = new Map<string, number>();
    for (const b of s.blocks) if (b.top) columns.set(`${b.x},${b.z}`, b.y + b.height);
    expect(new Set(s.blocks.map(key)).size).toBe(s.blocks.length);
    for (const b of s.blocks) {
      if (b.top) continue;
      // A block below the top shows only where some neighbouring column is lower than its top.
      const around = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dz]) => columns.get(`${b.x + dx * b.size},${b.z + dz * b.size}`) ?? 0);
      expect(Math.min(...around)).toBeLessThan(b.y + b.height);
    }
  });

  it.each(seeds)("seed %i: three or four hamlets of houses on clear ground", (seed) => {
    const s = generateSurroundings(seed);
    expect(s.hamlets).toBeGreaterThanOrEqual(3);
    expect(s.hamlets).toBeLessThanOrEqual(4);
    expect(s.houses.length).toBeGreaterThanOrEqual(2 * s.hamlets);
    const rect = (h: { cx: number; cz: number; w: number; d: number }) => ({ x0: h.cx - h.w / 2, x1: h.cx + h.w / 2, z0: h.cz - h.d / 2, z1: h.cz + h.d / 2 });
    for (let i = 0; i < s.houses.length; i++) {
      for (let j = i + 1; j < s.houses.length; j++) expect(overlaps(rect(s.houses[i]), rect(s.houses[j]))).toBe(false);
      for (const b of s.blocks) {
        const br = { x0: b.x - b.size / 2, x1: b.x + b.size / 2, z0: b.z - b.size / 2, z1: b.z + b.size / 2 };
        expect(overlaps(rect(s.houses[i]), br)).toBe(false);
      }
      for (const t of s.trees) expect(overlaps(rect(s.houses[i]), { x0: t.x - 20, x1: t.x + 20, z0: t.z - 20, z1: t.z + 20 })).toBe(false);
    }
  });

  it("trees stand on the ground or on a block top", () => {
    const s = generateSurroundings(9);
    expect(s.trees.length).toBeGreaterThan(40);
    const tops = new Map<string, number>();
    for (const b of s.blocks) if (b.top) tops.set(`${b.x},${b.z}`, b.y + b.height);
    for (const t of s.trees) {
      if (t.y === 0) continue;
      expect([...tops.entries()].some(([k, y]) => {
        const [x, z] = k.split(",").map(Number);
        return y === t.y && Math.abs(x - t.x) <= CELL && Math.abs(z - t.z) <= CELL;
      })).toBe(true);
    }
  });

  it("shadow slabs cover the near hills", () => {
    const s = generateSurroundings(5);
    expect(s.slabs.length).toBeGreaterThan(0);
    for (const sl of s.slabs) expect(sl.x1 - sl.x0).toBeGreaterThan(0);
  });
});

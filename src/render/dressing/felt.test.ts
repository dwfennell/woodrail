import { MeshBasicMaterial, type Mesh } from "three";
import { describe, expect, it } from "vitest";
import { CELL, generateLandscape, gridWithPlots, SURF_RIVER, SURF_ROAD, SURF_SAND, SURF_SEA, type LandscapeGrid } from "../../landscape";
import { buildFeltTiles, clipLoop, type FeltTiles } from "./felt";

/** A river wandering diagonally across the tile edge at x = 0. */
function riverGrid(): LandscapeGrid {
  const g = gridWithPlots(-1, -1, 2, 2);
  for (let c = -25; c <= 25; c++) {
    const r = 11 + Math.round(c * 0.2 + Math.sin(c / 3) * 2);
    for (const dr of [0, 1]) g.surface[g.index(c, r + dr)] = SURF_RIVER;
  }
  return g;
}

/** The z of the felt's top outline where it meets the plane x = `x` (from one tile's mesh). */
function edgeZs(mesh: Mesh, x: number): number[] {
  const pos = mesh.geometry.getAttribute("position");
  let top = -Infinity;
  for (let i = 0; i < pos.count; i++) top = Math.max(top, pos.getY(i));
  const zs = new Set<number>();
  for (let i = 0; i < pos.count; i++) if (Math.abs(pos.getX(i) - x) < 1e-6 && Math.abs(pos.getY(i) - top) < 1e-6) zs.add(Math.round(pos.getZ(i) * 100) / 100);
  return [...zs].sort((a, b) => a - b);
}

describe("felt in tiles", () => {
  it("draws a tile only where there's felt, and meets its neighbour exactly across their edge", () => {
    const cache: FeltTiles = new Map();
    const group = buildFeltTiles([riverGrid()], [SURF_RIVER], new MeshBasicMaterial(), () => 1.6, cache);
    expect(group.children).toHaveLength(2);
    const [a, b] = group.children as Mesh[];
    const left = edgeZs(a, 0);
    const right = edgeZs(b, 0);
    expect(left.length).toBeGreaterThanOrEqual(2);
    expect(left).toEqual(right);
  });

  it("extrudes a tile again only when its squares change", () => {
    const cache: FeltTiles = new Map();
    const g = riverGrid();
    buildFeltTiles([g], [SURF_RIVER], new MeshBasicMaterial(), () => 1.6, cache);
    const before = new Map([...cache].map(([k, t]) => [k, t.geometry]));
    // A pond far into the left tile (beyond the right tile's margin).
    g.surface[g.index(-28, -18)] = SURF_RIVER;
    buildFeltTiles([g], [SURF_RIVER], new MeshBasicMaterial(), () => 1.6, cache);
    const changed = [...cache].filter(([k, t]) => before.get(k) !== t.geometry).map(([k]) => k);
    expect(changed).toHaveLength(1);
    expect(CELL).toBe(72);
  });

  it("has no zero-length normals (they light as NaN: dark or bright specks far out)", () => {
    let zero = 0;
    let verts = 0;
    for (const seed of [1, 7, 42, 600189]) {
      const grid = generateLandscape(seed, { coast: true }).grid;
      for (const surfaces of [[[SURF_RIVER, SURF_SEA]], [[SURF_SAND, SURF_SEA, SURF_RIVER]], [SURF_ROAD]] as const) {
        const group = buildFeltTiles([grid], surfaces, new MeshBasicMaterial(), () => 1.6, new Map());
        for (const m of group.children as Mesh[]) {
          const n = m.geometry.getAttribute("normal");
          verts += n.count;
          for (let i = 0; i < n.count; i++) if (Math.hypot(n.getX(i), n.getY(i), n.getZ(i)) < 1e-6) zero++;
        }
      }
    }
    expect(verts).toBeGreaterThan(0);
    expect(zero).toBe(0);
  });

  it("clips an outline to a rectangle", () => {
    const square = [{ x: -2, z: -2 }, { x: 2, z: -2 }, { x: 2, z: 2 }, { x: -2, z: 2 }];
    const out = clipLoop(square, 0, 0, 5, 5);
    expect(out.map((p) => [p.x, p.z]).sort()).toEqual([[0, 0], [0, 2], [2, 0], [2, 2]].sort());
  });
});

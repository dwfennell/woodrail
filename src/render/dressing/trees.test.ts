import { InstancedMesh, Matrix4, MeshStandardMaterial } from "three";
import { describe, expect, it } from "vitest";
import { CELL, FEAT_TREE, generateLandscape } from "../../landscape";
import type { Materials } from "../materials";
import { buildTrees, MAX_LEAN, PLANTED_KINDS, TREE_KINDS, treeKind, treePlacements, type PlaceTrees, type TreePlacement } from "./trees";

describe("treePlacements", () => {
  const land = generateLandscape(11);
  const g = land.grid;
  const trees = treePlacements(land);

  it("puts one tree on every tree square, near its centre and on its ground", () => {
    let count = 0;
    for (let i = 0; i < g.cellCount; i++) if (g.feature[i] === FEAT_TREE) count++;
    expect(trees).toHaveLength(count);
    for (const t of trees) {
      const i = g.cellAtWorld(t.x, t.z);
      expect(g.feature[i]).toBe(FEAT_TREE);
      expect(Math.abs(t.x - g.centreX(g.colOf(i)))).toBeLessThanOrEqual(CELL / 2 - 14);
      expect(t.y).toBe(g.groundY(i));
    }
  });

  it("leans and sizes stay within toy-like bounds", () => {
    for (const t of trees) {
      expect(t.lean).toBeLessThanOrEqual(MAX_LEAN);
      expect(t.scale).toBeGreaterThanOrEqual(0.8);
      expect(t.scale).toBeLessThanOrEqual(1.2);
    }
    expect(new Set(trees.map((t) => t.kind)).size).toBeGreaterThanOrEqual(5);
  });

  it("is deterministic per map", () => {
    expect(treePlacements(generateLandscape(11))).toEqual(trees);
  });
});

describe("treeKind", () => {
  it("can choose every kind, leaning to the three turned trees", () => {
    const n = 10000;
    const tally = new Map<string, number>();
    for (let i = 0; i < n; i++) {
      const k = treeKind((i + 0.5) / n);
      tally.set(k, (tally.get(k) ?? 0) + 1);
    }
    for (const k of PLANTED_KINDS) expect(tally.get(k) ?? 0).toBeGreaterThan(0);
    expect(tally.get("autumn") ?? 0).toBe(0);
    const classic = (tally.get("fir")! + tally.get("ball")! + tally.get("discs")!) / n;
    expect(classic).toBeGreaterThanOrEqual(0.65);
    for (const k of ["bush", "rock", "willow"]) expect(tally.get(k)! / n).toBeLessThan(0.06);
  });
});

describe("buildTrees", () => {
  const mat = new MeshStandardMaterial();
  const mats = { lacquer: () => mat, naturalWood: mat, paint: mat, scenery: { wood: mat, top: mat, crown: mat } } as unknown as Materials;
  const placements: TreePlacement[] = TREE_KINDS.map((kind, i) => ({ x: i * 100, z: 0, y: 0, kind, scale: 1, lean: 0, leanDir: 0, yaw: 0, tint: i }));
  const meshesOf = (g: ReturnType<typeof buildTrees>) => g.children.filter((o): o is InstancedMesh => o instanceof InstancedMesh);
  const scaleAt = (mesh: InstancedMesh, k: number) => {
    const m = new Matrix4();
    mesh.getMatrixAt(k, m);
    return m.getMaxScaleOnAxis();
  };

  it("draws each shape with one instanced mesh, and only shapes the map uses", () => {
    // bases, trunks, birch trunks, apples, and 7 crown shapes.
    expect(meshesOf(buildTrees(placements, mats))).toHaveLength(11);
    expect(meshesOf(buildTrees(placements, mats, true))).toHaveLength(10); // no bases
    expect(meshesOf(buildTrees(placements.filter((t) => t.kind === "rock"), mats))).toHaveLength(1);
  });

  it("hides and shows every part of every kind as trees step aside", () => {
    for (const lowDetail of [false, true]) {
      const g = buildTrees(placements, mats, lowDetail);
      const meshes = meshesOf(g);
      const total = meshes.reduce((n, m) => n + m.count, 0);
      const shown = () => meshes.reduce((n, m) => n + Array.from({ length: m.count }, (_, k) => scaleAt(m, k)).filter((s) => s > 0).length, 0);
      expect(shown()).toBe(total);
      (g.userData.place as PlaceTrees)(placements.map(() => null));
      expect(shown()).toBe(0);
      (g.userData.place as PlaceTrees)(placements.map((t) => ({ x: t.x, y: t.y, z: t.z, s: 0.5 })));
      expect(shown()).toBe(total);
    }
  });
});

import { Scene } from "three";
import { describe, expect, it } from "vitest";
import { ChainHintsView, hintTriangles } from "./chain-hints-view";

const flat = () => 0;

describe("chain hints on the map", () => {
  it("chevrons along a line point the way the goods go, on the ground, short of each end", () => {
    const { pos, col } = hintTriangles([{ from: { x: 0, z: 0 }, to: { x: 1000, z: 0 }, tone: "in" }], [], (x) => (x > 500 ? 48 : 0));
    expect(pos.length % 9).toBe(0);
    expect(col.length / 4).toBe(pos.length / 3);
    const xs = pos.filter((_, i) => i % 3 === 0);
    expect(Math.min(...xs)).toBeGreaterThan(100);
    expect(Math.max(...xs)).toBeLessThan(900);
    // Each chevron's first vertex is its tip, ahead (toward `to`) of its wings.
    expect(pos[0]).toBeGreaterThan(pos[3]);
    // On the ground under it (a hill past 500 mm), lifted a little.
    for (let i = 0; i < pos.length; i += 3) expect(pos[i + 1]).toBe(pos[i] > 500 ? 52 : 4);
    // Gold for goods coming in.
    expect(col.slice(0, 3)).toEqual([1, 0.62, 0.1]);
  });

  it("a line too short for chevrons draws none; a ring is a band of triangles round its place", () => {
    expect(hintTriangles([{ from: { x: 0, z: 0 }, to: { x: 200, z: 0 }, tone: "out" }], [], flat).pos).toEqual([]);
    const { pos } = hintTriangles([], [{ x: 500, z: 500, tone: "out" }], flat);
    for (let i = 0; i < pos.length; i += 3) {
      const r = Math.hypot(pos[i] - 500, pos[i + 2] - 500);
      expect(r).toBeGreaterThan(140);
      expect(r).toBeLessThan(175);
    }
  });

  it("a line across the map stays a few hundred triangles", () => {
    const { pos } = hintTriangles([{ from: { x: 0, z: 0 }, to: { x: 100000, z: 0 }, tone: "in" }], [], flat);
    expect(pos.length / 9).toBeLessThanOrEqual(2 * 121);
  });

  it("shown again as it was: no rebuild; hidden, then shown again: no rebuild; something new: rebuilt", () => {
    const scene = new Scene();
    const v = new ChainHintsView(scene);
    const lines = [{ from: { x: 0, z: 0 }, to: { x: 1000, z: 0 }, tone: "in" as const }];
    expect(v.show(lines, [], flat)).toBe(true);
    expect(v.show(lines, [], flat)).toBe(false);
    expect(v.builds).toBe(1);
    expect(v.hide()).toBe(true);
    expect(v.hide()).toBe(false);
    expect(v.showing).toBe(false);
    expect(v.show(lines, [], flat)).toBe(true);
    expect(v.builds).toBe(1);
    expect(v.show(lines, [{ x: 0, z: 0, tone: "out" }], flat)).toBe(true);
    expect(v.builds).toBe(2);
    expect(scene.children.length).toBe(1);
    // Nothing to show: hidden.
    v.show([], [], flat);
    expect(v.showing).toBe(false);
  });
});

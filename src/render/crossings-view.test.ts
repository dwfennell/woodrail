import { describe, expect, it } from "vitest";
import { MeshStandardMaterial } from "three";
import type { SimSnapshot } from "../sim";
import { CrossingsView } from "./crossings-view";
import type { Materials } from "./materials";

const m = new MeshStandardMaterial();
const mats = { lacquer: () => m, naturalWood: m } as unknown as Materials;

/** One car standing at (x, z). */
const carAt = (x: number, z: number): SimSnapshot => {
  const transforms = new Float32Array(6);
  transforms[0] = x;
  transforms[2] = z;
  return { count: 1, ids: new Int32Array(1), kinds: new Uint8Array(1), trainIds: new Int32Array(1), derailed: new Uint8Array(1), levers: new Int8Array(1), transforms };
};

const arms = (v: CrossingsView) => {
  const out: number[] = [];
  v.group.traverse((o) => {
    if (o.children.length === 6) out.push(o.rotation.z);
  });
  return out;
};

describe("level crossings view", () => {
  it("a crossing still on the map keeps its posts and arms as they are when the list is set again", () => {
    const v = new CrossingsView(mats);
    const gates = (x: number) => [
      { x: x - 44, z: 30, y: 0, dx: 1, dz: 0, ax: 0, az: -1 },
      { x: x + 44, z: -30, y: 0, dx: -1, dz: 0, ax: 0, az: 1 },
    ];
    const a = { x: 0, z: 0, y: 0, gates: gates(0) };
    v.setCrossings([a]);
    // A train at the crossing: the arms come down.
    for (let i = 0; i < 20; i++) v.update(carAt(0, 0), 0.1);
    const posts = [...v.group.children];
    expect(arms(v).every((r) => r === 0)).toBe(true);
    // Something changed elsewhere (a switch thrown, a piece placed): the same crossing, plus a new one.
    v.setCrossings([{ ...a, gates: gates(0) }, { x: 500, z: 0, y: 0, gates: gates(500) }]);
    expect(v.group.children.slice(0, 2)).toEqual(posts);
    expect(v.group.children.length).toBe(4);
    // The kept arms are still down; only the new crossing's are up.
    expect(arms(v).filter((r) => r === 0).length).toBe(2);
    // And a crossing that's gone takes its posts with it.
    v.setCrossings([{ x: 500, z: 0, y: 0, gates: gates(500) }]);
    expect(v.group.children.length).toBe(2);
    for (const p of posts) expect(v.group.children).not.toContain(p);
  });
});

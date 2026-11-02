import { describe, expect, it } from "vitest";
import { CROSSING_BELL_GAP_MS, CrossingBells } from "./crossing-bell";

const near = (): [number, number] => [0.8, 0.1];

describe("level crossing bells", () => {
  it("nothing closing: nothing rings", () => {
    expect(new CrossingBells().ring([], 0, near)).toBeNull();
  });

  it("rings for a crossing on the screen and near enough, then not again until the gap has passed", () => {
    const bells = new CrossingBells();
    const c = [{ x: 0, z: 0 }];
    expect(bells.ring(c, 1000, near)).toEqual([0.8, 0.1]);
    expect(bells.ring(c, 1000 + CROSSING_BELL_GAP_MS - 1, near)).toBeNull();
    expect(bells.ring(c, 1000 + CROSSING_BELL_GAP_MS, near)).toEqual([0.8, 0.1]);
  });

  it("an off-screen or far crossing doesn't ring (nor use up the gap); of several, the loudest rings", () => {
    const bells = new CrossingBells();
    expect(bells.ring([{ x: 0, z: 0 }], 0, () => null)).toBeNull();
    expect(bells.ring([{ x: 0, z: 0 }], 10, () => [0.1, 0])).toBeNull();
    const heard = (x: number): [number, number] => (x === 1 ? [0.5, -0.5] : [0.9, 0.4]);
    expect(bells.ring([{ x: 1, z: 0 }, { x: 2, z: 0 }], 20, heard)).toEqual([0.9, 0.4]);
  });
});

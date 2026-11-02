import { Color, Matrix4, MeshStandardMaterial, Object3D, Vector3, type InstancedMesh } from "three";
import { describe, expect, it } from "vitest";
import { CARGO_KINDS, Economy, MAX_WAGON_CAPACITY, WAGON_CAPACITY } from "../economy";
import { Sim } from "../sim";
import { Layout } from "../track";
import { DepotView } from "./depot-view";
import { HEAP_KINDS, HOPPER_FLOOR, HOPPER_HEAP, hopperLook } from "./hopper-load";
import type { Materials } from "./materials";

describe("hopperLook: a hopper's load to its look", () => {
  it("empty, it shows no heap (its open bin)", () => {
    expect(hopperLook(null, 0, WAGON_CAPACITY)).toBeNull();
    for (const k of HEAP_KINDS) expect(hopperLook(k, 0, WAGON_CAPACITY)).toBeNull();
    // A unit being lifted off the last one (the count drawn goes below zero): still empty.
    expect(hopperLook("coal", -1, WAGON_CAPACITY)).toBeNull();
  });

  it("loaded, a heap of what it carries, in that goods' look", () => {
    for (const k of HEAP_KINDS) expect(hopperLook(k, 1, WAGON_CAPACITY)?.heap).toBe(k);
  });

  it("goods it doesn't heap (it never carries them) show no heap", () => {
    for (const k of CARGO_KINDS.filter((k) => !(HEAP_KINDS as readonly string[]).includes(k))) expect(hopperLook(k, 2, WAGON_CAPACITY)).toBeNull();
  });

  it("the heap rises a step a unit, from low in the bin to its rim when full", () => {
    const ys = [1, 2, 3].map((n) => hopperLook("grain", n, 3)!.y);
    expect(ys[0]).toBeGreaterThan(HOPPER_FLOOR);
    expect(ys[1]).toBeGreaterThan(ys[0]);
    expect(ys[2]).toBeGreaterThan(ys[1]);
    expect(ys[2]).toBe(HOPPER_HEAP);
    expect(hopperLook("grain", 2, 3)!.fill).toBeCloseTo(2 / 3);
  });

  it("follows the wagon's capacity (heavy wagons hold five): full is full, half is half", () => {
    expect(hopperLook("ore", MAX_WAGON_CAPACITY, MAX_WAGON_CAPACITY)!.y).toBe(HOPPER_HEAP);
    expect(hopperLook("ore", 3, MAX_WAGON_CAPACITY)!.y).toBeLessThan(HOPPER_HEAP);
    // Never past full.
    expect(hopperLook("ore", 9, 3)!.fill).toBe(1);
  });
});

function stubMaterials(): Materials {
  const m = (c = "#ffffff") => new MeshStandardMaterial({ color: new Color(c) });
  const lacquer = (c: string) => m(c);
  return new Proxy({ lacquer } as unknown as Materials, { get: (t, k) => (k in t ? t[k as keyof Materials] : m()) });
}

describe("DepotView: a hopper's heap, drawn as one instance of its goods' heap", () => {
  it("empty: no heap; coal or grain: one heap of that kind, sunk by how empty it is", () => {
    const layout = new Layout();
    const economy = new Economy(layout, new Sim(layout));
    const view = new DepotView(stubMaterials());
    view.setWorld(economy, layout);
    const car = new Object3D();
    car.userData.carKind = "hopper";
    const id = 7;
    const heaps = (view as unknown as { heaps: Record<string, { parts: InstancedMesh[] }> }).heaps;
    const drawn = () => Object.fromEntries(HEAP_KINDS.map((k) => [k, heaps[k].parts[0].count]));
    const baseY = (k: string) => new Vector3().setFromMatrixPosition(heaps[k].parts[0].getMatrixAt(0, new Matrix4()) as unknown as Matrix4).y;
    const draw = () => view.update(economy, [id], 1, () => car, 0, false);

    draw();
    expect(drawn()).toEqual({ grain: 0, stone: 0, coal: 0, ore: 0 });

    economy.setCargo(id, "coal", 1);
    expect(draw()).toBe("changed");
    expect(drawn()).toEqual({ grain: 0, stone: 0, coal: 1, ore: 0 });
    const low = baseY("coal");
    economy.setCargo(id, "coal", WAGON_CAPACITY);
    draw();
    expect(baseY("coal")).toBeGreaterThan(low);
    expect(baseY("coal")).toBe(HOPPER_HEAP);

    economy.setCargo(id, "grain", 2);
    draw();
    expect(drawn()).toEqual({ grain: 1, stone: 0, coal: 0, ore: 0 });
    // The same load again: nothing to redraw.
    expect(draw()).toBe("still");
  });
});

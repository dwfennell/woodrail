import { Box3, Color, MeshStandardMaterial } from "three";
import { describe, expect, it } from "vitest";
import { CAR_SPECS } from "../sim";
import type { Materials } from "./materials";
import { AXLE_HEIGHT, buildCarModel, WHEEL_RADIUS } from "./train-models";

/** Plain stand-ins for the game's materials (theirs need a canvas for textures). */
function stubMaterials(): Materials {
  const m = (c = "#ffffff") => new MeshStandardMaterial({ color: new Color(c) });
  const lacquer = (c: string) => m(c);
  return new Proxy({ lacquer } as unknown as Materials, { get: (t, k) => (k in t ? t[k as keyof Materials] : m()) });
}

describe("the track cleaner car", () => {
  it("is the catalogue's wagon on the rails: its brushes turn with its wheels, and it's its own length", () => {
    const model = buildCarModel("cleaner", stubMaterials());
    expect(model.wheels).toHaveLength(6);
    expect(model.wheels.filter((w) => w.name.startsWith("brush")).map((w) => w.name).sort()).toEqual(["brushA", "brushB"]);
    const box = new Box3().setFromObject(model.root);
    // Wheels' feet about on the groove floor, where the other cars' run.
    expect(Math.abs(box.min.y - (AXLE_HEIGHT - WHEEL_RADIUS))).toBeLessThan(1);
    // About its length along x (couplers poking out a little).
    expect(box.max.x - box.min.x).toBeGreaterThan(CAR_SPECS.cleaner.length - 2);
    expect(box.max.x - box.min.x).toBeLessThan(CAR_SPECS.cleaner.length + 10);
    model.root.traverse((o) => expect(o.userData.carKind).toBe("cleaner"));
  });
});

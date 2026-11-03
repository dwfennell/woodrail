import { Box3, MeshStandardMaterial } from "three";
import { describe, expect, it } from "vitest";
import { loadBlenderModels } from "./blender-models";
import type { Materials } from "./materials";
import { buildCarModel } from "./train-models";
import { CAR_LOOKS, type CarKind } from "../sim";
import { RISER_HEIGHT, TRAIN_HEADROOM, UNDERPASS_DIP } from "../track";

function stubMaterials(): Materials {
  const m = () => new MeshStandardMaterial();
  const lacquer = () => m();
  return new Proxy({ lacquer } as unknown as Materials, { get: (t, k) => (k in t ? t[k as keyof Materials] : m()) });
}

describe("headroom", () => {
  it("every car, in every look and loaded, fits under track TRAIN_HEADROOM above its own, with room to spare", async () => {
    await loadBlenderModels();
    const mats = stubMaterials();
    let tallest = 0;
    for (const kind of Object.keys(CAR_LOOKS) as CarKind[]) {
      for (const look of CAR_LOOKS[kind]) {
        const model = buildCarModel(kind, mats, 0, look, true);
        model.root.updateMatrixWorld(true);
        tallest = Math.max(tallest, new Box3().setFromObject(model.root).max.y);
      }
    }
    // (72.5 mm today: the double-decker coach.)
    expect(tallest).toBeLessThan(TRAIN_HEADROOM - 3);
    // One level over an underpass is enough; one level alone isn't.
    expect(RISER_HEIGHT + UNDERPASS_DIP).toBeGreaterThanOrEqual(TRAIN_HEADROOM);
    expect(RISER_HEIGHT).toBeLessThan(tallest);
  }, 60000);
});

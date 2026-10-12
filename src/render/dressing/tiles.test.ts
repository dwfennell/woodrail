import { Group, PerspectiveCamera } from "three";
import { describe, expect, it } from "vitest";
import { PLOT_DEPTH, PLOT_WIDTH } from "../../landscape";
import { cullTiles, detailReach, plotRect, setCullRects } from "./tiles";

/** A camera low over (x, z), looking straight down from `height`, seeing a small patch. */
function cameraOver(x: number, z: number, height: number): PerspectiveCamera {
  const camera = new PerspectiveCamera(20, 1, 10, 100000);
  camera.position.set(x, height, z);
  camera.lookAt(x, 0, z);
  camera.updateMatrixWorld();
  return camera;
}

describe("culling tiles", () => {
  it("shows a plot seen only in its middle, far from its corners", () => {
    const root = new Group();
    const plot = new Group();
    setCullRects(plot, [plotRect({ px: 0, pz: 0 })], 100);
    root.add(plot);
    // Over the plot's middle, seeing a few hundred mm round it: no corner is anywhere near the view.
    cullTiles([root], cameraOver(PLOT_WIDTH / 2, PLOT_DEPTH / 2, 1500), 5000, detailReach(1500));
    expect(plot.visible).toBe(true);
    // Over the next plot along: hidden.
    cullTiles([root], cameraOver(PLOT_WIDTH * 1.6, PLOT_DEPTH / 2, 1500), 5000, detailReach(1500));
    expect(plot.visible).toBe(false);
  });

  it("shows things only seen close up within the detail reach, which grows with the zoom", () => {
    const root = new Group();
    const core = new Group();
    setCullRects(core, [plotRect({ px: 0, pz: 0 })], 100);
    core.userData.nearOnly = true;
    root.add(core);
    const over = (height: number) => cullTiles([root], cameraOver(PLOT_WIDTH / 2, PLOT_DEPTH / 2, height), 50000, detailReach(height));
    over(5000);
    expect(core.visible).toBe(true);
    over(12000);
    expect(core.visible).toBe(true);
    cullTiles([root], cameraOver(PLOT_WIDTH / 2, PLOT_DEPTH / 2, 12000), 50000, detailReach(2000));
    expect(core.visible).toBe(false);
  });
});

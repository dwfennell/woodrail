import { Group, PerspectiveCamera } from "three";
import { describe, expect, it } from "vitest";
import { PLOT_CELLS, PLOT_DEPTH, PLOT_WIDTH, type Town } from "../../landscape";
import { cullTiles, detailReach, plotRect, setCullRects, tileAt, townTilesOf } from "./tiles";

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

describe("the tiles a land edit redraws for its towns", () => {
  // A town whose centre is in one tile, with a square (a green a house left) in a plot of another.
  const town = { centre: { x: 10, z: 10 }, cells: [5 * PLOT_CELLS + 3], buildings: [{ cells: [7 * PLOT_CELLS + 1] }] } as unknown as Town;

  it("an edit in a plot with a town's square (or one of its houses') redraws the town's own tile: its greens are drawn there", () => {
    expect([...townTilesOf([town], [5])]).toEqual([tileAt(10, 10)]);
    expect([...townTilesOf([town], [7])]).toEqual([tileAt(10, 10)]);
  });

  it("an edit away from every town's squares redraws no town", () => {
    expect(townTilesOf([town], [4, 6]).size).toBe(0);
  });
});


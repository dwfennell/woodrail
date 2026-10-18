import { Scene } from "three";
import { describe, expect, it } from "vitest";
import { buildStarterWorld, HALT_REACH } from "../game/world";
import { HaltReachView } from "./halt-reach-view";

describe("HaltReachView (a halt's reach round each town, while one is held)", () => {
  it("is built once, then only shown and hidden; built again only when the towns or their ground change", () => {
    const land = buildStarterWorld().landscape;
    const scene = new Scene();
    const view = new HaltReachView(scene, HALT_REACH);
    expect(view.showing).toBe(false);
    for (let i = 0; i < 20; i++) {
      view.show(land);
      expect(view.showing).toBe(true);
      view.hide();
    }
    expect(view.builds).toBe(1);
    // One mesh for every town (one draw call), its rings at the reach from each town's middle.
    const meshes = scene.children.filter((o) => o.name === "halt-reach");
    expect(meshes).toHaveLength(1);
    const pos = (meshes[0] as unknown as { geometry: { attributes: { position: { count: number; getX(i: number): number; getZ(i: number): number } } } }).geometry.attributes.position;
    const t = land.towns[0];
    let far = 0;
    for (let i = 0; i < pos.count / land.towns.length; i++) far = Math.max(far, Math.hypot(pos.getX(i) - t.centre.x, pos.getZ(i) - t.centre.z));
    expect(far).toBeGreaterThan(HALT_REACH);
    expect(far).toBeLessThan(HALT_REACH * 1.05);
    // The ground changed (a square raised): rebuilt on the next show, so the ring lies on it.
    land.grid.revision++;
    view.show(land);
    expect(view.builds).toBe(2);
    view.dispose();
    expect(scene.children.filter((o) => o.name === "halt-reach")).toHaveLength(0);
  });
});

import { Color, MeshStandardMaterial, PerspectiveCamera } from "three";
import { describe, expect, it } from "vitest";
import { PropStore } from "../props/store";
import { CLOCK_ASSET, ClockView, handAngles } from "./clock-view";
import type { Materials } from "./materials";
import { drawnKey, PropLibrary } from "./props/library";

/** Plain stand-ins for the game's materials (theirs need a canvas for textures). */
function stubMaterials(): Materials {
  const m = (c = "#ffffff") => new MeshStandardMaterial({ color: new Color(c) });
  const lacquer = (c: string) => m(c);
  return new Proxy({ lacquer } as unknown as Materials, { get: (t, k) => (k in t ? t[k as keyof Materials] : m()) });
}

describe("station clocks", () => {
  it("show the game's time, from eight in the morning, a game minute a minute", () => {
    expect(handAngles(0)).toEqual({ hour: (8 / 12) * Math.PI * 2, minute: 0 });
    const a = handAngles(90 * 60 + 30);
    // 9:30 (and 30 s).
    expect(a.minute).toBeCloseTo(Math.PI);
    expect(a.hour).toBeCloseTo((9.5 / 12) * Math.PI * 2);
  });

  it("are drawn bare of their hands, which are set only when the minute changes, a frame asked for only in view", async () => {
    const lib = new PropLibrary(stubMaterials());
    await lib.load(CLOCK_ASSET);
    // The prop is drawn bare; the whole model (with hands) stays for the tray and the hand.
    expect(drawnKey(CLOCK_ASSET)).not.toBe(CLOCK_ASSET);
    const whole = lib.model(CLOCK_ASSET)!;
    const bare = lib.model(drawnKey(CLOCK_ASSET))!;
    const verts = (m: typeof whole) => m.parts.reduce((n, p) => n + p.geometry.getAttribute("position").count, 0);
    expect(verts(bare)).toBeLessThan(verts(whole));
    const props = new PropStore();
    const clock = props.add(CLOCK_ASSET, { x: 0, z: 0, heading: 0, y: 0 });
    const view = new ClockView(lib);
    view.sync(props);
    expect(view.count).toBe(1);
    const camera = new PerspectiveCamera(50, 1, 1, 5000);
    camera.position.set(0, 300, 400);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld();
    expect(view.tick(10, camera)).toBe(true);
    // Same minute: nothing.
    expect(view.tick(50, camera)).toBe(false);
    // The next minute, out of view: the hands are set, but no frame asked for.
    camera.lookAt(0, 0, 5000);
    camera.updateMatrixWorld();
    expect(view.tick(61, camera)).toBe(false);
    // Taken away: gone.
    props.remove(clock.id);
    view.sync(props);
    expect(view.count).toBe(0);
  });
});

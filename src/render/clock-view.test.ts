import { Color, type Mesh, MeshStandardMaterial, PerspectiveCamera } from "three";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PropStore } from "../props/store";
import { CLOCK_ASSET, ClockView, handAngles, msToNextMinute } from "./clock-view";
import type { Materials } from "./materials";
import { drawnKey, PropLibrary } from "./props/library";

/** Plain stand-ins for the game's materials (theirs need a canvas for textures). */
function stubMaterials(): Materials {
  const m = (c = "#ffffff") => new MeshStandardMaterial({ color: new Color(c) });
  const lacquer = (c: string) => m(c);
  return new Proxy({ lacquer } as unknown as Materials, { get: (t, k) => (k in t ? t[k as keyof Materials] : m()) });
}

describe("station clocks", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("show the real time: the minute hand on its minute, the hour hand moving on between the hours", () => {
    const turn = Math.PI * 2;
    expect(handAngles(0, 0)).toEqual({ hour: 0, minute: 0 });
    expect(handAngles(12, 0)).toEqual({ hour: 0, minute: 0 });
    // Quarter past three: the minute hand at three, the hour hand a quarter of the way from three to four.
    const a = handAngles(15, 15);
    expect(a.minute).toBeCloseTo(turn / 4);
    expect(a.hour).toBeCloseTo((3.25 / 12) * turn);
    // Half past nine in the morning and in the evening look the same.
    expect(handAngles(21, 30)).toEqual(handAngles(9, 30));
    expect(handAngles(9, 30).minute).toBeCloseTo(Math.PI);
    expect(handAngles(9, 30).hour).toBeCloseTo((9.5 / 12) * turn);
    // A minute to midnight: both hands nearly round to twelve, short of it.
    const late = handAngles(23, 59);
    expect(late.minute).toBeCloseTo((59 / 60) * turn);
    expect(late.hour).toBeCloseTo(((11 + 59 / 60) / 12) * turn);
    expect(late.hour).toBeLessThan(turn);
  });

  it("wait for the next minute's start", () => {
    expect(msToNextMinute(new Date(2026, 10, 2, 14, 7, 0, 0))).toBe(60_000);
    expect(msToNextMinute(new Date(2026, 10, 2, 14, 7, 59, 900))).toBe(100);
    expect(msToNextMinute(new Date(2026, 10, 2, 14, 7, 12, 345))).toBe(47_655);
  });

  it("are drawn bare of their hands, which are set only when the minute changes, a frame asked for only in view", async () => {
    // (The page's clock away from the times ticked below, so the first is a new minute.)
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 10, 2, 8, 0));
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
    // Its hands are drawn, and cast no shadow onto the face.
    const meshes: Mesh[] = [];
    view.group.traverse((o) => (o as Mesh).isMesh && meshes.push(o as Mesh));
    expect(meshes.length).toBeGreaterThan(0);
    expect(meshes.every((m) => !m.castShadow)).toBe(true);
    const camera = new PerspectiveCamera(50, 1, 1, 5000);
    camera.position.set(0, 300, 400);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld();
    const at = (m: number, s = 0) => new Date(2026, 10, 2, 9, m, s);
    expect(view.tick(at(0, 10), camera, 800)).toBe(true);
    // Same minute: nothing.
    expect(view.tick(at(0, 50), camera, 800)).toBe(false);
    // The next minute, in view but far off (the map view: QA, a frame every 20 s), the hand's move under half a pixel:
    // set, no frame asked for. Nearer, or with more pixels to the view, it shows.
    camera.position.set(0, 2400, 3200);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld();
    expect(view.tick(at(1, 1), camera, 800)).toBe(false);
    expect(view.tick(at(2, 1), camera, 4000)).toBe(true);
    camera.position.set(0, 300, 400);
    // The next minute, out of view: the hands are set, but no frame asked for.
    camera.lookAt(0, 0, 5000);
    camera.updateMatrixWorld();
    expect(view.tick(at(3, 1), camera, 800)).toBe(false);
    // Taken away: gone.
    props.remove(clock.id);
    view.sync(props);
    expect(view.count).toBe(0);
  });

  it("are set at once, then at each minute's start by a timer, and at once when the page shows again (no timer hidden)", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 10, 2, 14, 7, 40));
    const lib = new PropLibrary(stubMaterials());
    await lib.load(CLOCK_ASSET);
    const props = new PropStore();
    props.add(CLOCK_ASSET, { x: 0, z: 0, heading: 0, y: 0 });
    const view = new ClockView(lib);
    view.sync(props);
    const camera = new PerspectiveCamera(50, 1, 1, 5000);
    camera.position.set(0, 300, 400);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld();
    const listeners = new Map<string, () => void>();
    const doc = { hidden: false, addEventListener: (k: string, f: () => void) => listeners.set(k, f), removeEventListener: (k: string) => listeners.delete(k) };
    let frames = 0;
    view.start(camera, () => 800, () => frames++, doc as unknown as Document);
    // Put down, it was set to the time then (and drawn with the props it came with): no frame more for it.
    expect(view.shown).toEqual(handAngles(14, 7));
    expect(frames).toBe(0);
    // Nothing more until the minute's start, twenty seconds on; then one frame, and one a minute after.
    vi.advanceTimersByTime(19_000);
    expect(frames).toBe(0);
    vi.advanceTimersByTime(1_100);
    expect(frames).toBe(1);
    expect(view.shown).toEqual(handAngles(14, 8));
    vi.advanceTimersByTime(59_000);
    expect(frames).toBe(1);
    vi.advanceTimersByTime(1_000);
    expect(frames).toBe(2);
    expect(view.shown).toEqual(handAngles(14, 9));
    // Hidden: no timer at all; shown again ten minutes on, the hands are set at once.
    doc.hidden = true;
    listeners.get("visibilitychange")!();
    expect(vi.getTimerCount()).toBe(0);
    vi.setSystemTime(new Date(2026, 10, 2, 14, 19, 30));
    doc.hidden = false;
    listeners.get("visibilitychange")!();
    expect(frames).toBe(3);
    expect(view.shown).toEqual(handAngles(14, 19));
    expect(vi.getTimerCount()).toBe(1);
    view.dispose();
    expect(vi.getTimerCount()).toBe(0);
    expect(listeners.size).toBe(0);
  });

  it("put down after a while with none, a clock shows the time now (not the last the hands were set to)", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 10, 2, 10, 5));
    const lib = new PropLibrary(stubMaterials());
    await lib.load(CLOCK_ASSET);
    const props = new PropStore();
    const view = new ClockView(lib);
    view.sync(props);
    vi.setSystemTime(new Date(2026, 10, 2, 11, 40));
    props.add(CLOCK_ASSET, { x: 0, z: 0, heading: 0, y: 0 });
    view.sync(props);
    expect(view.shown).toEqual(handAngles(11, 40));
  });
});

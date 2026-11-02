import { BoxGeometry, Color, type Mesh, MeshStandardMaterial, PerspectiveCamera } from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PropStore } from "../props/store";
import { CLOCK_ASSET, ClockView, handAngles, msToNextMinute } from "./clock-view";
import type { Materials } from "./materials";
import { drawnKey, kitModelKey, modelKey, PropLibrary } from "./props/library";
import { CLOCK_ASSETS, HAND_NAMES, splitFlatHands } from "./clock-hands";
import { loadModelSet } from "./blender-models";
import { loadAsset } from "../catalogue/registry";
import { kitForAsset } from "../track";
import { Matrix4, Vector3 } from "three";

/** Plain stand-ins for the game's materials (theirs need a canvas for textures). */
function stubMaterials(): Materials {
  const m = (c = "#ffffff") => new MeshStandardMaterial({ color: new Color(c) });
  // (One material per name, as the game's: the paint is one material, shared.)
  const named = new Map<PropertyKey, MeshStandardMaterial>();
  const paint = m();
  paint.userData = {};
  return new Proxy({ lacquer: (c: string) => Object.assign(m(c), { userData: { paintColor: c } }), paint } as unknown as Materials, {
    get: (t, k) => (k in t ? t[k as keyof Materials] : named.get(k) ?? (named.set(k, m()), named.get(k))),
  });
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
    const view = new ClockView((k) => lib.clockHands(k));
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
    const view = new ClockView((k) => lib.clockHands(k));
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

  it("pinned by the e2e hook, the hands are set once and never move: no timer, no listener, no frames", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 10, 2, 14, 7, 40));
    (globalThis as { __woodrailPinClocks?: boolean }).__woodrailPinClocks = true;
    try {
      const lib = new PropLibrary(stubMaterials());
      await lib.load(CLOCK_ASSET);
      const props = new PropStore();
      props.add(CLOCK_ASSET, { x: 0, z: 0, heading: 0, y: 0 });
      const view = new ClockView((k) => lib.clockHands(k));
      view.sync(props);
      const camera = new PerspectiveCamera(50, 1, 1, 5000);
      camera.position.set(0, 300, 400);
      camera.lookAt(0, 0, 0);
      camera.updateMatrixWorld();
      const listeners = new Map<string, () => void>();
      const doc = { hidden: false, addEventListener: (k: string, f: () => void) => listeners.set(k, f), removeEventListener: (k: string) => listeners.delete(k) };
      let frames = 0;
      view.start(camera, () => 800, () => frames++, doc as unknown as Document);
      expect(view.shown).toEqual(handAngles(14, 7));
      expect(vi.getTimerCount()).toBe(0);
      expect(listeners.size).toBe(0);
      vi.advanceTimersByTime(5 * 60_000);
      // (A clock put down later is set to the pinned time too.)
      props.add(CLOCK_ASSET, { x: 100, z: 0, heading: 0, y: 0 });
      view.sync(props);
      expect(view.shown).toEqual(handAngles(14, 7));
      expect(frames).toBe(0);
      view.dispose();
    } finally {
      delete (globalThis as { __woodrailPinClocks?: boolean }).__woodrailPinClocks;
    }
  });

  it("put down after a while with none, a clock shows the time now (not the last the hands were set to)", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 10, 2, 10, 5));
    const lib = new PropLibrary(stubMaterials());
    await lib.load(CLOCK_ASSET);
    const props = new PropStore();
    const view = new ClockView((k) => lib.clockHands(k));
    view.sync(props);
    vi.setSystemTime(new Date(2026, 10, 2, 11, 40));
    props.add(CLOCK_ASSET, { x: 0, z: 0, heading: 0, y: 0 });
    view.sync(props);
    expect(view.shown).toEqual(handAngles(11, 40));
  });

  it("every model with a clock face is a clock: its hands drawn apart", async () => {
    const withHands = new Set<string>();
    for (const [id, node] of await loadModelSet("buildings", true)) node.traverse((o) => HAND_NAMES.has(o.name) && withHands.add(id));
    const post = await loadAsset("scene-clock-post");
    const lib = new PropLibrary(stubMaterials());
    post!.build(new (await import("../catalogue/kit")).Kit(stubMaterials(), 0.5)).traverse((o) => HAND_NAMES.has(o.name) && withHands.add("scene-clock-post"));
    expect([...withHands].sort()).toEqual([...CLOCK_ASSETS].sort());
    // Each is drawn bare, its hands apart: two hands a face.
    for (const id of CLOCK_ASSETS) {
      const kit = kitForAsset(id);
      const key = kit ? kitModelKey(kit) : modelKey(id);
      await lib.load(key);
      const hands = lib.clockHands(key)!;
      expect(hands.hands.length, id).toBeGreaterThanOrEqual(2);
      expect(hands.hands.filter((h) => h.kind === "hour").length, id).toBe(hands.hands.filter((h) => h.kind === "minute").length);
    }
  });

  it("all the clocks' hands are one draw call, each drawn at the time on its own face, following it as it moves", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 10, 2, 15, 20));
    const lib = new PropLibrary(stubMaterials());
    const kit = kitForAsset("bldg-grand-terminus")!;
    await Promise.all([lib.load(drawnKey(CLOCK_ASSET)), lib.load(drawnKey("bldg-town-hall")), lib.load(drawnKey("bldg-college", 2)), lib.load(kitModelKey(kit))]);
    const props = new PropStore();
    props.add(CLOCK_ASSET, { x: 0, z: 0, heading: 0, y: 0 });
    const hall = props.add("bldg-town-hall", { x: 500, z: 0, heading: 1, y: 0 });
    props.add("bldg-college", { x: -500, z: 0, heading: 2, y: 0 }, undefined, { variant: 2 });
    const view = new ClockView((k) => lib.clockHands(k));
    view.sync(props);
    view.setClocks("kits", [[7, { key: kitModelKey(kit), matrix: new Matrix4().makeTranslation(0, 0, 900) }]]);
    expect(view.counts()).toEqual({ props: 3, kits: 1 });
    expect(view.drawCalls).toBe(1);
    const a = handAngles(15, 20);
    const near = (x: number, y: number) => Math.abs(Math.atan2(Math.sin(x - y), Math.cos(x - y))) < 1e-4;
    const check = () => {
      for (const s of Object.values(view.drawnAngles())) {
        expect(s.hour.length).toBeGreaterThan(0);
        expect(s.hour.every((h) => near(h, a.hour))).toBe(true);
        expect(s.minute.every((h) => near(h, a.minute))).toBe(true);
      }
    };
    check();
    // The town hall moved: its hands follow (the turn about its face still the time's).
    const handPos = () => {
      const m = new Matrix4();
      const at: Vector3[] = [];
      view.group.children.forEach((b) => {
        const mesh = b as unknown as { getMatrixAt(i: number, m: Matrix4): void; instanceCount: number };
        for (let i = 0; i < mesh.instanceCount; i++) {
          try {
            mesh.getMatrixAt(i, m);
            at.push(new Vector3().setFromMatrixPosition(m));
          } catch {
            /* a deleted instance */
          }
        }
      });
      return at;
    };
    const before = handPos().filter((p) => p.x > 400).length;
    expect(before).toBeGreaterThan(0);
    props.move(hall.id, { x: 500, z: 3000, heading: 1, y: 0 });
    view.sync(props);
    expect(handPos().filter((p) => p.z > 2500).length).toBe(before);
    check();
    // Its kit taken up: its hands go.
    view.setClocks("kits", []);
    expect(view.counts()).toEqual({ props: 3, kits: 0 });
  });

  it("the station house's flat clock is split into its marks and two hands, each pointing as it was", () => {
    // A face at the origin looking +z, marks round it, the minute hand at twelve, the hour at three, as dressing.py's.
    const g = new BoxGeometry(0.9, 3.8, 0.6).translate(0, 1.9, 2.4);
    const hour = new BoxGeometry(3.2, 0.9, 0.6).translate(1.6, 0, 2.4);
    const marks = [0, 1, 2, 3].map((i) => new BoxGeometry(0.5, 0.5, 0.5).translate(Math.cos(i) * 4.3, Math.sin(i) * 4.3, 2.25));
    const merged = mergeGeometries([g, hour, ...marks].map((x) => x.toNonIndexed()))!;
    const split = splitFlatHands(merged)!;
    expect(split.hands.map((h) => h.kind)).toEqual(["hour", "minute"]);
    expect(split.rest.getAttribute("position").count).toBe(4 * 36);
    // Posed at its rest angle (three for the hour, twelve for the minute), each is where it was.
    const tipAt = (h: (typeof split.hands)[number], angle: number) => {
      h.geometry.computeBoundingBox();
      const m = new Matrix4().multiplyMatrices(h.base, new Matrix4().makeRotationX(-angle));
      return h.geometry.boundingBox!.clone().applyMatrix4(m).getCenter(new Vector3());
    };
    const hc = tipAt(split.hands[0], Math.PI / 2);
    expect(hc.x).toBeCloseTo(1.6);
    expect(hc.y).toBeCloseTo(0);
    expect(hc.z).toBeCloseTo(2.4);
    const mc = tipAt(split.hands[1], 0);
    expect(mc.x).toBeCloseTo(0);
    expect(mc.y).toBeCloseTo(1.9);
    // And at three, the minute hand points at three (+x, the face seen from +z).
    expect(tipAt(split.hands[1], Math.PI / 2).x).toBeCloseTo(1.9);
  });
});

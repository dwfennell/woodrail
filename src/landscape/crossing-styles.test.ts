import { describe, expect, it } from "vitest";
import { MeshStandardMaterial, type Object3D } from "three";
import { pieceHitsProp, propsInRect } from "../props/placement";
import { PropStore } from "../props/store";
import { CrossingsView } from "../render/crossings-view";
import type { Materials } from "../render/materials";
import type { SimSnapshot } from "../sim";
import { crossingStyleOf, nearestCrossing, STYLE_REACH, styleCrossings } from "./crossing-styles";
import type { LevelCrossing } from "./crossings";

const gates = (x: number) => [
  { x: x - 44, z: 30, y: 0, dx: 1, dz: 0, ax: 0, az: -1 },
  { x: x + 44, z: -30, y: 0, dx: -1, dz: 0, ax: 0, az: 1 },
];
const crossing = (x: number): LevelCrossing => ({ x, z: 0, y: 0, gates: gates(x) });
const prop = (id: number, asset: string, x: number, z = 0) => ({ id, asset, x, z });

describe("crossing styles", () => {
  it("the level crossing and gated crossing props are styles; nothing else is", () => {
    expect(crossingStyleOf("mech-level-crossing")).toBe("barriers");
    expect(crossingStyleOf("mech-gated-crossing")).toBe("gates");
    expect(crossingStyleOf("mech-semaphore-signal")).toBeUndefined();
    expect(crossingStyleOf("bldg-red-barn")).toBeUndefined();
  });

  it("a crossing prop styles the crossing nearest it, within reach; the prop is linked to it", () => {
    const crossings = [crossing(0), crossing(500)];
    const r = styleCrossings(crossings, [prop(1, "mech-gated-crossing", 490, 20), prop(2, "bldg-red-barn", 0, 0)]);
    expect(r.crossings.map((c) => c.style)).toEqual([undefined, "gates"]);
    expect(r.crossings[1].styleProp).toBe(1);
    expect([...r.linked]).toEqual([1]);
    // Unstyled crossings are the very ones found (they look as today).
    expect(r.crossings[0]).toBe(crossings[0]);
  });

  it("a crossing prop out of reach of every crossing styles none, and isn't linked (it's drawn as a prop)", () => {
    const r = styleCrossings([crossing(0)], [prop(1, "mech-level-crossing", STYLE_REACH + 5, 0)]);
    expect(r.crossings[0].style).toBeUndefined();
    expect(r.linked.size).toBe(0);
  });

  it("of two on one crossing the nearer wins; the other isn't linked", () => {
    const r = styleCrossings([crossing(0)], [prop(1, "mech-level-crossing", 30, 0), prop(2, "mech-gated-crossing", 4, 0)]);
    expect(r.crossings[0].style).toBe("gates");
    expect([...r.linked]).toEqual([2]);
  });

  it("the prop in the hand styles nothing while it's held (its crossing looks as before)", () => {
    const r = styleCrossings([crossing(0)], [prop(7, "mech-level-crossing", 0, 0)], 7);
    expect(r.crossings[0].style).toBeUndefined();
    expect(r.linked.size).toBe(0);
  });

  it("a crossing with nowhere for a barrier (track all round) takes no style", () => {
    const r = styleCrossings([{ x: 0, z: 0, y: 0, gates: [] }], [prop(1, "mech-level-crossing", 0, 0)]);
    expect(r.crossings[0].style).toBeUndefined();
    expect(r.linked.size).toBe(0);
  });

  it("follows the crossings: the track moved away, the style goes with it; back, it comes back", () => {
    const props = [prop(1, "mech-gated-crossing", 500, 0)];
    expect(styleCrossings([crossing(0)], props).linked.size).toBe(0);
    expect(styleCrossings([crossing(0), crossing(500)], props).crossings[1].style).toBe("gates");
  });

  it("nearestCrossing finds the nearest within reach, or −1", () => {
    const crossings = [crossing(0), crossing(200)];
    expect(nearestCrossing(crossings, 150, 0)).toBe(1);
    expect(nearestCrossing(crossings, 100, 300)).toBe(-1);
    expect(nearestCrossing(crossings, 100, 0, 150)).toBe(0);
  });

  it("a crossing prop is in nothing's way: track runs through it, other things stand by it", () => {
    const store = new PropStore();
    store.add("mech-level-crossing", { x: 0, z: 0, heading: 0, y: 0 });
    const fp = () => ({ cx: 0, cz: 0, hw: 70, hd: 120 });
    expect(pieceHitsProp(store, fp, "straight-216", false, { x: -100, z: 0, heading: 0 })).toBe(false);
    expect(propsInRect(store, fp, -10, -10, 10, 10)).toBe(false);
    // (Any other prop there would be.)
    store.add("bldg-red-barn", { x: 0, z: 0, heading: 0, y: 0 });
    expect(pieceHitsProp(store, fp, "straight-216", false, { x: -100, z: 0, heading: 0 })).toBe(true);
  });
});

describe("crossings drawn in their styles", () => {
  const m = new MeshStandardMaterial();
  const mats = { lacquer: () => m, naturalWood: m } as unknown as Materials;
  const carAt = (x: number, z: number): SimSnapshot => {
    const transforms = new Float32Array(6);
    transforms[0] = x;
    transforms[2] = z;
    return { count: 1, ids: new Int32Array(1), kinds: new Uint8Array(1), trainIds: new Int32Array(1), derailed: new Uint8Array(1), levers: new Int8Array(1), transforms };
  };
  const none: SimSnapshot = { ...carAt(0, 0), count: 0 };
  const named = (v: CrossingsView) => {
    const pivots: Object3D[] = [];
    v.group.traverse((o) => {
      if (o.children.length >= 5 && o.parent && o.parent.parent === v.group) pivots.push(o);
    });
    return pivots;
  };

  it("gates swing shut across the road while a train passes (about the vertical), and back open after", () => {
    const v = new CrossingsView(mats);
    v.setCrossings([{ ...crossing(0), style: "gates", styleProp: 9 }]);
    const pivots = named(v);
    expect(pivots).toHaveLength(2);
    const open = pivots.map((p) => p.rotation.y);
    // Open: along the roadside, away from the crossing (the first gate's way in is +x: it lies along −x).
    expect(Math.cos(open[0])).toBeCloseTo(-1, 6);
    for (let i = 0; i < 20; i++) v.update(carAt(0, 0), 0.1);
    const shut = pivots.map((p) => p.rotation.y);
    // Shut: across the road toward its middle (the first gate's arm reaches −z: local +x turned to (0, −1)).
    expect(Math.cos(shut[0])).toBeCloseTo(0, 6);
    expect(-Math.sin(shut[0])).toBeCloseTo(-1, 6);
    // A quarter turn, the short way; and no arm lowered (they swing, about y only).
    expect(Math.abs(shut[0] - open[0])).toBeCloseTo(Math.PI / 2, 6);
    for (const p of pivots) expect(p.rotation.z).toBe(0);
    let moving = true;
    for (let i = 0; i < 20 && moving; i++) moving = v.update(none, 0.1);
    expect(pivots.map((p) => p.rotation.y)).toEqual(open);
    // Tapped, it's its prop's.
    expect(v.propAt(pivots[0].children[0])).toBe(9);
  });

  it("the level-crossing style lowers its booms, its lamps flashing while they're down and dark when up", () => {
    const v = new CrossingsView(mats);
    v.setCrossings([{ ...crossing(0), style: "barriers", styleProp: 3 }]);
    const lit = () => {
      let n = 0;
      v.group.traverse((o) => {
        if (o.userData.lit && o.visible) n++;
      });
      return n;
    };
    expect(lit()).toBe(0);
    for (let i = 0; i < 20; i++) v.update(carAt(0, 0), 0.1);
    // One lamp of each post's pair lit at a time.
    expect(lit()).toBe(2);
    let moving = true;
    for (let i = 0; i < 30 && moving; i++) moving = v.update(none, 0.1);
    v.update(none, 0.1);
    expect(lit()).toBe(0);
  });

  it("a crossing whose style changes is built again; an unstyled one is drawn as before", () => {
    const v = new CrossingsView(mats);
    v.setCrossings([crossing(0)]);
    const before = [...v.group.children];
    v.setCrossings([crossing(0)]);
    expect(v.group.children).toEqual(before);
    v.setCrossings([{ ...crossing(0), style: "gates", styleProp: 1 }]);
    for (const p of before) expect(v.group.children).not.toContain(p);
    expect(v.propAt(v.group.children[0])).toBe(1);
    v.setCrossings([crossing(0)]);
    expect(v.propAt(v.group.children[0])).toBe(-1);
  });
});

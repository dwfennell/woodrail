import { describe, expect, it } from "vitest";
import type { MapMarker } from "../game/map-markers";
import { LOCK_OUT, layoutMarkers, type MarkerSpot } from "./map-view";

const marker = (key: string, kind: MapMarker["kind"]): MapMarker => ({ key, kind, x: 0, z: 0, title: key, detail: "" });
const LABEL = { w: 190, h: 52 };
const BADGE = { w: 28, h: 28 };
const overlap = (a: MarkerSpot, b: MarkerSpot) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/** Every pair of shown boxes apart, and each within the bars and the screen. */
function expectClear(spots: (MarkerSpot | null)[], screenW: number, lo: number, hi: number): void {
  const shown = spots.filter((s): s is MarkerSpot => !!s);
  for (let i = 0; i < shown.length; i++) {
    expect(shown[i].y).toBeGreaterThanOrEqual(lo);
    expect(shown[i].y + shown[i].h).toBeLessThanOrEqual(hi);
    expect(shown[i].x).toBeGreaterThanOrEqual(8);
    expect(shown[i].x + shown[i].w).toBeLessThanOrEqual(screenW - 8);
    for (let j = i + 1; j < shown.length; j++) expect(overlap(shown[i], shown[j]), `${JSON.stringify(shown[i])} × ${JSON.stringify(shown[j])}`).toBe(false);
  }
}

describe("layoutMarkers (the map view's boxes)", () => {
  it("a phone on its side (667×375), the towns crowded down by the Map bar: no badge under a label, no label over another", () => {
    // QA's case: five towns and a depot just above the Map bar, a ruin's badge among them. The nudge into range ran
    // after the declutter and put labels back over the badge and one another.
    const markers = [
      marker("town:1", "town"),
      marker("town:2", "town"),
      marker("town:3", "town"),
      marker("town:4", "town"),
      marker("depot:0", "sawmill"),
      marker("site:9", "forest"),
      marker("ruin-around:-2,-1:0", "ruin"),
      marker("ruin:0", "ruin"),
    ];
    const pts = [
      { x: 286, y: 232 },
      { x: 270, y: 248 },
      { x: 375, y: 252 },
      { x: 450, y: 250 },
      { x: 468, y: 262 },
      { x: 190, y: 180 },
      { x: 600, y: 236 },
      { x: 336, y: 146 },
    ];
    const sizes = markers.map((m) => (m.kind === "ruin" ? BADGE : LABEL));
    const [W, lo, hi] = [667, 72, 280];
    const spots = layoutMarkers(markers, pts, sizes, W, lo, hi);
    expectClear(spots, W, lo, hi);
    // The higher ones still shown (one town keeps its spot), the badge clear of the bars kept on its ruin.
    expect(spots.filter(Boolean).length).toBeGreaterThanOrEqual(4);
    expect(spots[7]).toMatchObject({ x: 336 - 14, y: 146 - 14 });
  });

  it("a crowd anywhere (random, seeded): nothing overlaps, everything within the bars and the screen", () => {
    let seed = 12345;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    for (let round = 0; round < 300; round++) {
      const W = rnd() < 0.5 ? 390 : 844;
      const lo = 72;
      const hi = W === 390 ? 760 : 300;
      const n = 4 + Math.floor(rnd() * 24);
      const kinds: MapMarker["kind"][] = ["town", "ruin", "forest", "sawmill", "ruin"];
      const markers = Array.from({ length: n }, (_, k) => marker(`m:${k}`, kinds[Math.floor(rnd() * kinds.length)]));
      const pts = markers.map(() => (rnd() < 0.1 ? null : { x: rnd() * W, y: rnd() * (hi + 80) }));
      const sizes = markers.map((m) => (m.kind === "ruin" ? BADGE : { w: 120 + Math.floor(rnd() * 90), h: 40 + Math.floor(rnd() * 16) }));
      expectClear(layoutMarkers(markers, pts, sizes, W, lo, hi), W, lo, hi);
    }
  });

  it("a ruin on the player's land keeps its badge, a town's label nudged off it; one on the land around gives way", () => {
    const own = { ...marker("ruin:4", "ruin"), ruin: 4 };
    const m = [marker("town:1", "town"), own, marker("town:2", "town"), marker("ruin-around:1,1:0", "ruin")];
    const pts = [{ x: 100, y: 300 }, { x: 150, y: 310 }, { x: 100, y: 500 }, { x: 150, y: 510 }];
    const spots = layoutMarkers(m, pts, m.map((x) => (x.kind === "ruin" ? BADGE : LABEL)), 390, 72, 760);
    expect(spots[1]).toEqual({ x: 136, y: 296, w: 28, h: 28, flip: false });
    expect(spots[0]).not.toBeNull();
    expect(spots[0]!.y).not.toBe(286);
    expect(spots[2]).toMatchObject({ x: 86, y: 486 });
    expect(spots[3]).toBeNull();
    expectClear(spots, 390, 72, 760);
  });

  it("a ruin's badge stays on its ruin: under a bar or past the edge it isn't shown", () => {
    const m = [marker("ruin:1", "ruin"), marker("ruin:2", "ruin"), marker("ruin:3", "ruin")];
    const spots = layoutMarkers(m, [{ x: 100, y: 60 }, { x: 3, y: 200 }, { x: 100, y: 200 }], m.map(() => BADGE), 390, 72, 700);
    expect(spots[0]).toBeNull();
    expect(spots[1]).toBeNull();
    expect(spots[2]).toEqual({ x: 86, y: 186, w: 28, h: 28, flip: false });
  });

  it("is cheap: 100 markers laid out in well under a millisecond each time on a desktop", () => {
    const markers = Array.from({ length: 100 }, (_, k) => marker(`m:${k}`, k % 3 === 0 ? "ruin" : "town"));
    const pts = markers.map((_, k) => ({ x: (k * 97) % 844, y: 72 + ((k * 53) % 228) }));
    const sizes = markers.map((m) => (m.kind === "ruin" ? BADGE : LABEL));
    for (let k = 0; k < 20; k++) layoutMarkers(markers, pts, sizes, 844, 72, 300);
    const t0 = performance.now();
    for (let k = 0; k < 100; k++) layoutMarkers(markers, pts, sizes, 844, 72, 300);
    const each = (performance.now() - t0) / 100;
    console.log(`  (layoutMarkers, 100 markers: ${each.toFixed(3)} ms)`);
    expect(each).toBeLessThan(5);
  });
});

describe("a ruin's lock", () => {
  it("a locked badge's box takes in its lock: a label beside it is kept off the lock", () => {
    const own = { ...marker("ruin:4", "ruin"), ruin: 4, locked: true };
    const m = [own, marker("town:1", "town")];
    // The town's label just right of the badge and level with its lock (box 28 + LOCK_OUT).
    const pts = [{ x: 100, y: 300 }, { x: 100 + 14 + 28 + 4, y: 300 + 14 + 2 }];
    const spots = layoutMarkers(m, pts, [{ w: 28 + LOCK_OUT, h: 28 + LOCK_OUT }, LABEL], 390, 72, 760);
    expectClear(spots, 390, 72, 760);
    expect(spots[0]).not.toBeNull();
  });
});

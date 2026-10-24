import { describe, expect, it } from "vitest";
import { PerspectiveCamera, Vector3 } from "three";
import { fitToRect } from "./camera-director";
import { mapFramePoints, mapMarkers, ruinMarkers, type MapMarker } from "./map-markers";
import { townStatus } from "./towns";
import { receivedBy } from "./town-life";
import { buildStarterWorld, landForSale, plotsAround, plotsForSale, unlockPlot, type World } from "./world";
import mainSrc from "../main.ts?raw";

/** What the map view marks (as `currentMapMarkers` makes them): the land's places, its ruins and the land around's. */
function marked(w: World): MapMarker[] {
  const ruins = (w.landscape.sites ?? []).map((site) => ({ site, around: false }));
  for (const p of plotsAround(w.landscape)) for (const site of landForSale(w.landscape, p.px, p.pz).sites ?? []) ruins.push({ site, around: true });
  return [...mapMarkers(w, (id) => townStatus(receivedBy(w, id))), ...ruinMarkers(ruins, () => false)];
}

/** Buy `n` plots, nearest the middle first (as QA grew seed 7's map). */
function grown(n: number): World {
  const w = buildStarterWorld();
  for (let k = 0; k < n; k++) {
    const fs = plotsForSale(w.landscape).sort((a, c) => Math.hypot(a.px, a.pz) - Math.hypot(c.px, c.pz));
    unlockPlot(w, fs[0].px, fs[0].pz);
  }
  return w;
}

/** The map view's fit, as `openMap` makes it (between the bars, at its tilt), and where a point is on screen then. */
function mapFit(w: World, width: number, height: number, top: number, bottom: number) {
  const camera = new PerspectiveCamera(30, width / height, 5, 40000);
  const pts = mapFramePoints(marked(w), w.landscape.grid.extent()).map((q) => new Vector3(q.x, 0, q.z));
  const room = { left: 0, right: width, top, bottom };
  const fit = fitToRect(pts, camera, 0.22, 0, room, width, height, 24, 0, 14000);
  camera.position.copy(fit.target).add(new Vector3(0, Math.cos(0.22), Math.sin(0.22)).multiplyScalar(fit.distance));
  camera.lookAt(fit.target);
  camera.updateMatrixWorld();
  const screen = (p: Vector3) => {
    const v = p.clone().project(camera);
    return { x: ((v.x + 1) / 2) * width, y: ((1 - v.y) / 2) * height };
  };
  return { pts, fit, room, screen };
}

describe("the map view's framing", () => {
  it("frames every place marked on the player's land and the ruins on it, not the land around's ruins", () => {
    const w = buildStarterWorld();
    const marks = marked(w);
    const pts = mapFramePoints(marks, w.landscape.grid.extent());
    const own = marks.filter((m) => !m.key.startsWith("ruin-around:"));
    expect(marks.some((m) => m.key.startsWith("ruin-around:"))).toBe(true);
    expect(own.some((m) => m.key.startsWith("ruin:"))).toBe(true);
    expect(pts).toEqual(own.map((m) => ({ x: m.x, z: m.z })));
    // Nothing marked: the land's corners.
    const e = w.landscape.grid.extent();
    expect(mapFramePoints([], e)).toEqual([
      { x: e.x0, z: e.z0 },
      { x: e.x1, z: e.z0 },
      { x: e.x1, z: e.z1 },
      { x: e.x0, z: e.z1 },
    ]);
    expect(mainSrc).toMatch(/mapFramePoints\(currentMapMarkers\(\), game\.landscape\.grid\.extent\(\)\)/);
    expect(mainSrc).toMatch(/fitToRect\(pts, game\.camera, MAP_PHI/);
  });

  it("a starter map on a phone on its side (667×375, 844×390): every place marked, between the bars", () => {
    for (const [W, H, top, bottom] of [
      [667, 375, 74, 279],
      [844, 390, 74, 294],
    ]) {
      const { pts, fit, room, screen } = mapFit(buildStarterWorld(), W, H, top, bottom);
      expect(fit.distance).toBeLessThanOrEqual(14000);
      for (const p of pts) {
        const s = screen(p);
        expect(s.x).toBeGreaterThanOrEqual(room.left);
        expect(s.x).toBeLessThanOrEqual(room.right);
        expect(s.y).toBeGreaterThanOrEqual(room.top);
        expect(s.y).toBeLessThanOrEqual(room.bottom);
      }
    }
  });

  it("22 plots bought, upright (390×844): as far out as the camera goes, the places' middle in the band's middle", () => {
    const w = grown(22);
    const { pts, fit, room, screen } = mapFit(w, 390, 844, 74, 760);
    expect(fit.distance).toBe(14000);
    // The marked places' spread is centred between the bars (a drag pans to the rest).
    const s = pts.map(screen);
    const mid = (a: number[]) => (Math.min(...a) + Math.max(...a)) / 2;
    expect(Math.abs(mid(s.map((q) => q.x)) - (room.left + room.right) / 2)).toBeLessThan(8);
    expect(Math.abs(mid(s.map((q) => q.y)) - (room.top + room.bottom) / 2)).toBeLessThan(8);
  });
});

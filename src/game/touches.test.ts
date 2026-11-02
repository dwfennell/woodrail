import { Color, MeshStandardMaterial, PerspectiveCamera } from "three";
import { describe, expect, it } from "vitest";
import { FEAT_NONE, SURF_GRASS } from "../landscape";
import { LandEditor } from "../landscape/edit";
import { nearTrack, trackPoints } from "../landscape/trees-aside";
import { deserializeLandscape, serializeLandscape } from "../persist/landscape-data";
import { deserializeWorld, serializeWorld } from "../persist/save";
import type { Materials } from "../render/materials";
import { TouchesView } from "../render/touches-view";
import { createSnapshot } from "../sim/sim";
import { appendPiece, connectorRef } from "../track";
import { buildOnLots, nextLots } from "./town-growth";
import { firstTrainMark, kidSpot, MARK_ASIDE, stationTheme, STATION_THEMES, TOUCH_TRACK_CLEARANCE, touchesWanted, townTouches, Wave, WAVE_NEAR, WAVE_SECONDS } from "./touches";
import { buildStarterWorld } from "./world";

const open = () => false;

describe("a town's own colours", () => {
  it("come from its name: the same every time, and towns differ", () => {
    const w = buildStarterWorld();
    for (const t of w.landscape.towns) expect(stationTheme(t.name)).toBe(stationTheme(String(t.name)));
    expect(STATION_THEMES).toContain(stationTheme("Ashby"));
    const names = ["Ashby", "Brambleton", "Larkfield", "Thimble Cross", "Willowmere", "Pinecrest", "Quillsby", "Elderwick", "Gorsemoor", "Puddleby"];
    expect(new Set(names.map((n) => stationTheme(n))).size).toBeGreaterThanOrEqual(4);
  });
});

describe("life in town: touches on the free ground at a town's edge", () => {
  it("grow in number with the town's level", () => {
    const w = buildStarterWorld();
    const town = w.landscape.towns[0];
    const counts = [0, 1, 2, 3, 4].map((level) => townTouches(w.landscape, town, level, open).length);
    expect(counts[0]).toBe(touchesWanted(0));
    for (let k = 1; k < counts.length; k++) expect(counts[k]).toBeGreaterThan(counts[k - 1]);
    // A bigger town keeps the ones it had.
    const at = (level: number) => townTouches(w.landscape, town, level, open).map((s) => s.cell);
    expect(at(3).slice(0, at(1).length)).toEqual(at(1));
  });

  it("stand on plain grass next to the town, not on its lots, streets, corridors or hills", () => {
    const w = buildStarterWorld();
    const g = w.landscape.grid;
    const corridors = new Set(w.landscape.corridors);
    for (const town of w.landscape.towns) {
      const own = new Set(town.cells);
      for (const s of townTouches(w.landscape, town, 3, open)) {
        expect(g.surface[s.cell]).toBe(SURF_GRASS);
        expect(g.feature[s.cell]).toBe(FEAT_NONE);
        expect(g.road[s.cell]).toBe(0);
        expect(own.has(s.cell)).toBe(false);
        expect(corridors.has(s.cell)).toBe(false);
        expect(g.cellAtWorld(s.x, s.z)).toBe(s.cell);
      }
    }
  });

  it("don't block growth: a square the town builds on loses its touch, and the rest stay put", () => {
    const w = buildStarterWorld();
    const land = w.landscape;
    const town = land.towns[0];
    const before = townTouches(land, town, 3, open);
    // The town grows on its next lots, as it does in play, wherever its touches stood.
    const lots = nextLots(land, town, new LandEditor(land, w.layout), 4);
    const taken = new Set(lots.flatMap((l) => l.cells));
    expect(before.some((s) => taken.has(s.cell))).toBe(true);
    buildOnLots(land, town, lots);
    const after = townTouches(land, town, 3, open);
    expect(after.some((s) => taken.has(s.cell))).toBe(false);
    expect(after.length).toBe(before.length);
    // Most of those it kept stay where they were (the new edge brings new spots, which may come first).
    const kept = before.filter((s) => !taken.has(s.cell));
    expect(kept.filter((s) => after.some((a) => a.cell === s.cell)).length).toBeGreaterThanOrEqual(Math.ceil(kept.length / 2));
  });

  it("step aside from track laid by them", () => {
    const w = buildStarterWorld();
    const land = w.landscape;
    const town = land.towns[0];
    const first = townTouches(land, town, 0, open)[0];
    // A straight laid right over it.
    const id = w.layout.addPiece("straight-216", { x: first.x - 108, z: first.z, heading: 0 });
    expect(id).toBeGreaterThan(0);
    const track = trackPoints(w.layout);
    const now = townTouches(land, town, 0, (x, z) => nearTrack(track, x, z, TOUCH_TRACK_CLEARANCE));
    expect(now).toHaveLength(1);
    expect(now[0].cell).not.toBe(first.cell);
    expect(nearTrack(track, now[0].x, now[0].z, TOUCH_TRACK_CLEARANCE)).toBe(false);
  });
});

describe("the child at the end of the platform waves at a train going by", () => {
  it("once per pass: not again until no train is near", () => {
    const wave = new Wave();
    wave.update(1000, 0.1);
    expect(wave.waving).toBe(false);
    wave.update(WAVE_NEAR - 1, 0.1);
    expect(wave.waving).toBe(true);
    expect(wave.arm().lift).toBeGreaterThanOrEqual(0);
    // The train lingers by: the wave ends, and doesn't start again.
    for (let t = 0; t < WAVE_SECONDS + 1; t += 0.1) wave.update(50, 0.1);
    expect(wave.waving).toBe(false);
    // It goes, and the next one comes.
    wave.update(1000, 0.1);
    wave.update(40, 0.1);
    expect(wave.waving).toBe(true);
  });

  it("stands on the platform, past the canopy, beside the track", () => {
    const w = buildStarterWorld();
    const town = w.landscape.towns[0];
    const k = kidSpot(town);
    const s = town.station;
    const t = (k.x - s.x) * Math.cos(s.heading) + (k.z - s.z) * Math.sin(s.heading);
    expect(t).toBeGreaterThan(196);
    expect(t).toBeLessThan(206);
  });
});

function stubMaterials(): Materials {
  const lacquer = (c: string) => new MeshStandardMaterial({ color: new Color(c) });
  return new Proxy({ lacquer } as unknown as Materials, { get: (t, k) => (k in t ? t[k as keyof Materials] : new MeshStandardMaterial()) });
}

describe("TouchesView", () => {
  it("places the touches again only when what they're placed from changes", () => {
    const w = buildStarterWorld();
    const view = new TouchesView(stubMaterials());
    expect(view.sync(w.landscape, "a", null, open)).toBe(true);
    expect(view.spots.length).toBeGreaterThan(0);
    expect(view.sync(w.landscape, "a", null, open)).toBe(false);
    expect(view.sync(w.landscape, "b", () => 3, open)).toBe(true);
  });

  it("a child waves as a car comes by, in view; asked for less motion, it doesn't", () => {
    const w = buildStarterWorld();
    const town = w.landscape.towns[0];
    const k = kidSpot(town);
    const camera = new PerspectiveCamera(50, 1, 10, 100000);
    camera.position.set(k.x, 800, k.z + 600);
    camera.lookAt(k.x, 0, k.z);
    camera.updateMatrixWorld();
    for (const calm of [false, true]) {
      const view = new TouchesView(stubMaterials());
      view.calm = calm;
      view.sync(w.landscape, "a", null, open);
      const snap = createSnapshot();
      snap.count = 1;
      snap.transforms[0] = k.x + 2000;
      snap.transforms[2] = k.z;
      expect(view.update(snap, 1 / 30, camera)).toBe(false);
      snap.transforms[0] = k.x + 60;
      expect(view.update(snap, 1 / 30, camera)).toBe(!calm);
      expect(view.wavesOf().get(town.id)!.waving).toBe(!calm);
    }
  });
});

describe("the first train's marker", () => {
  it("lies beside the track where the train stood", () => {
    const m = firstTrainMark(100, 200, 0.5);
    expect(Math.hypot(m.x - 100, m.z - 200)).toBeCloseTo(MARK_ASIDE);
    // Across the track, not along it.
    expect((m.x - 100) * Math.cos(0.5) + (m.z - 200) * Math.sin(0.5)).toBeCloseTo(0);
  });

  it("lies on the open side: not on the platform", () => {
    // Left (−z for heading 0) is a platform; right is grass.
    const m = firstTrainMark(0, 0, 0, (_x, z) => z > 0);
    expect(m.z).toBeCloseTo(MARK_ASIDE);
    expect(firstTrainMark(0, 0, 0).z).toBeCloseTo(-MARK_ASIDE);
  });

  it("is saved with the map, and loads where it was", () => {
    const w = buildStarterWorld();
    w.landscape.firstTrain = { x: 12.5, z: -40, heading: 1 };
    const back = deserializeLandscape(JSON.parse(JSON.stringify(serializeLandscape(w.landscape))));
    expect(back.ok && back.value.firstTrain).toEqual({ x: 12.5, z: -40, heading: 1 });
    // None yet: none saved, none loaded.
    delete w.landscape.firstTrain;
    const none = deserializeLandscape(JSON.parse(JSON.stringify(serializeLandscape(w.landscape))));
    expect(none.ok && none.value.firstTrain).toBeUndefined();
  });

  it("a map saved before markers, with an engine on it, gets none (its first train ran long ago)", () => {
    const w = buildStarterWorld();
    const station = w.stations.get(w.landscape.towns[0].id)!;
    appendPiece(w.layout, "straight-216", false, connectorRef(station, 1));
    const placed = w.sim.addTrain(["engine"], { pieceId: station, pathIndex: 0, reversed: false, s: 100 });
    expect(placed.kind).toBe("placed");
    const data = serializeWorld(w);
    delete (data.landscape as { firstTrain?: unknown }).firstTrain;
    const back = deserializeWorld(JSON.parse(JSON.stringify(data)));
    expect(back.ok && back.value.landscape.firstTrain).toBeNull();
  });
});

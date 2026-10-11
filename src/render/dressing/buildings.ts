import { BoxGeometry, CylinderGeometry, ExtrudeGeometry, Shape, SphereGeometry, type BufferGeometry } from "three";
import { rng } from "../../lib/rng";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { CELL, COLS, type Landscape, type Shed, type Town } from "../../landscape";
import { STATION_ROOF_TOP } from "../../landscape/sign";
import { TRACK_WIDTH } from "../../track";
import type { Materials } from "../materials";
import type { Batcher } from "./batcher";

const ROOF_COLORS = ["#c8442f", "#2f6db5", "#3c8f4e", "#6b4a8f"];
const WALL_COLORS = ["#f0ebe0", "#e9d9b8", "#f3e3c3", "#f6dcc8", "#dfe8e4"];
const DOOR_COLORS = ["#7a3b26", "#2f5d8a", "#3c6e3e", "#8a2f3a"];
const FLOOR_H = 40;
/** Underside of the station canopy: clear of the tallest engine (chimney top ≈ 63 mm above the track base). */
export const CANOPY_Y = 76;
/** Lateral distance of the canopy's far posts from the station track's centre line. */
const CANOPY_FAR = TRACK_WIDTH / 2 + 6;
const OVERHANG = 6;

/** A rectangular window frame (outer w × h, border width `border`), 1.8 mm deep, its back on z = 0. */
function frameRing(w: number, h: number, border: number): BufferGeometry {
  const outer = new Shape();
  outer.moveTo(-w / 2, -h / 2);
  outer.lineTo(w / 2, -h / 2);
  outer.lineTo(w / 2, h / 2);
  outer.lineTo(-w / 2, h / 2);
  const hole = new Shape();
  hole.moveTo(-w / 2 + border, -h / 2 + border);
  hole.lineTo(-w / 2 + border, h / 2 - border);
  hole.lineTo(w / 2 - border, h / 2 - border);
  hole.lineTo(w / 2 - border, -h / 2 + border);
  outer.holes.push(hole);
  return new ExtrudeGeometry(outer, { depth: 1.8, bevelEnabled: false });
}

const FLOWER_COLORS = ["#d9443a", "#e6b52c", "#e98aa8", "#f3ead8"];
/** Window glass as on a printed wooden toy: a pale sky-blue pane with a cream cross of glazing bars. */
const PANE_COLOR = "#a9cfe6";

/** A printed-look pane (w × h) with glazing bars; `place` positions geometry authored facing +z, `out` mm proud. */
export function printedPane(b: Batcher, mats: Materials, w: number, h: number, place: (g: BufferGeometry, out: number) => BufferGeometry): void {
  b.add(mats.lacquer(PANE_COLOR), place(new BoxGeometry(w, h, 1), 0.3));
  b.add(mats.lacquer("#fbf6ec"), place(new BoxGeometry(1.4, h, 1), 0.9));
  b.add(mats.lacquer("#fbf6ec"), place(new BoxGeometry(w, 1.4, 1), 0.9));
}

const pick = <T,>(list: readonly T[], n: number): T => list[((n % list.length) + list.length) % list.length];

/**
 * A painted wooden toy building facing `front` (unit axis vector): body, overhanging roof, framed windows set back
 * behind their frames, a front door, and sometimes a chimney.
 */
export function building(
  b: Batcher,
  mats: Materials,
  box: { cx: number; cz: number; w: number; d: number },
  opts: { floors: number; kind: "house" | "shop"; roof: number; seed: number; front: { x: number; z: number } },
): void {
  const { cx, cz, w, d } = box;
  const h = FLOOR_H * opts.floors + 6;
  const body = new RoundedBoxGeometry(w, h, d, 2, 2.5);
  body.translate(cx, h / 2, cz);
  // Like a wooden toy: most walls are bare beech under a painted roof; some are painted.
  b.add(opts.seed % 5 < 3 ? mats.blockWood : mats.lacquer(pick(WALL_COLORS, opts.seed)), body);
  const roofMat = mats.lacquer(ROOF_COLORS[opts.roof]);

  if (opts.kind === "house") {
    // Gable roof along the longer side, overhanging the walls on every side.
    const along = w >= d;
    const span = along ? d : w;
    const length = along ? w : d;
    const rise = span * 0.55;
    const tri = new Shape();
    tri.moveTo(-span / 2 - OVERHANG, -1);
    tri.lineTo(span / 2 + OVERHANG, -1);
    tri.lineTo(0, rise);
    tri.lineTo(-span / 2 - OVERHANG, -1);
    const roof = new ExtrudeGeometry(tri, { depth: length + OVERHANG * 2, bevelEnabled: true, bevelSize: 1.2, bevelThickness: 1.2, bevelSegments: 2 });
    roof.translate(0, 0, -(length + OVERHANG * 2) / 2);
    if (along) roof.rotateY(Math.PI / 2);
    roof.translate(cx, h, cz);
    b.add(roofMat, roof);
    if (opts.seed % 3 !== 0) {
      // Chimney on the roof slope, a third of the way along.
      const ch = new RoundedBoxGeometry(9, rise * 0.9 + 10, 9, 1, 1.2);
      const off = span * 0.22;
      const t = length * 0.28 * (opts.seed % 2 ? 1 : -1);
      ch.translate(along ? cx + t : cx + off, h + rise * 0.45 + 5, along ? cz + off : cz + t);
      b.add(mats.lacquer("#a5503a"), ch);
    }
  } else {
    const roof = new RoundedBoxGeometry(w + OVERHANG * 2, 5, d + OVERHANG * 2, 1, 1.5);
    roof.translate(cx, h + 2.5, cz);
    b.add(roofMat, roof);
    const parapet = new RoundedBoxGeometry(w + 2, 6, d + 2, 1, 1.5);
    parapet.translate(cx, h + 7, cz);
    b.add(mats.lacquer("#f3ead8"), parapet);
  }

  // Facade features on the front and back faces (the faces whose normal is ±front).
  const fx = opts.front.x;
  const fz = opts.front.z;
  const faceWidth = fx !== 0 ? d : w;
  const faceDepth = fx !== 0 ? w : d;
  // Local facade coordinates (u across the face, y up, s = 1 front / −1 back) to world.
  const place = (g: BufferGeometry, u: number, y: number, s: number, out: number) => {
    // Geometry is authored facing +z; turn it to face out of this side of the building.
    if (s < 0) g.rotateY(Math.PI);
    if (fx !== 0) g.rotateY(fx * (Math.PI / 2));
    if (fz < 0) g.rotateY(Math.PI);
    const n = s * (faceDepth / 2 + out);
    g.translate(cx + fx * n + (fx !== 0 ? 0 : u), y, cz + fz * n + (fx !== 0 ? u : 0));
    return g;
  };
  const frameMat = mats.lacquer("#fbf6ec");
  const cols = faceWidth > 70 ? 2 : 1;
  for (const s of [1, -1]) {
    for (let f = 0; f < opts.floors; f++) {
      const ground = f === 0;
      for (let k = 0; k < cols; k++) {
        const u = cols === 1 ? 0 : (k === 0 ? -1 : 1) * faceWidth * 0.24;
        if (ground && s === 1 && k === 0) continue; // the door goes here
        const ww = Math.min(14, faceWidth * 0.28);
        // The frame stands proud of the wall; the glass sits back inside it.
        const y = 16 + f * FLOOR_H;
        b.add(frameMat, place(frameRing(ww + 4, 16, 2), u, y, s, 0));
        printedPane(b, mats, ww, 12, (g, out) => place(g, u, y, s, out));
        const sill = new BoxGeometry(ww + 6, 2, 3);
        b.add(frameMat, place(sill, u, 9 + f * FLOOR_H, s, 1.2));
        if (opts.kind === "house" && ground && s === 1) {
          // A window box of flowers under the front windows.
          b.add(mats.lacquer("#3c8f4e"), place(new RoundedBoxGeometry(ww + 4, 4, 4, 1, 1), u, 6, s, 3));
          b.add(mats.lacquer(pick(FLOWER_COLORS, opts.seed + k)), place(new RoundedBoxGeometry(ww, 2.5, 3, 1, 1), u, 9, s, 3));
        }
      }
    }
  }
  // Door with a little brass knob, and a shop awning over the front.
  const doorU = cols === 1 ? 0 : -faceWidth * 0.24;
  const door = new RoundedBoxGeometry(13, 24, 2, 1, 0.8);
  b.add(mats.lacquer(pick(DOOR_COLORS, opts.seed >> 2)), place(door, doorU, 12, 1, 0.6));
  const knob = new CylinderGeometry(1.1, 1.1, 1.5, 8);
  knob.rotateX(Math.PI / 2);
  b.add(mats.lacquer("#d9a93a"), place(knob, doorU + 4, 12, 1, 1.8));
  if (opts.kind === "shop") {
    // Striped awning over the front, sloping down and out.
    const stripes = 5;
    const aw = faceWidth * 0.8;
    for (let i = 0; i < stripes; i++) {
      const strip = new BoxGeometry(aw / stripes, 2.5, 13);
      strip.rotateX(0.35);
      b.add(mats.lacquer(i % 2 ? "#fbf6ec" : "#c8442f"), place(strip, -aw / 2 + (aw / stripes) * (i + 0.5), h * 0.62, 1, 6));
    }
  }
}

/** All of a town's buildings, each facing toward the town centre. Returns their footprints (centre and size). */
export function buildTown(land: Landscape, town: Town, mats: Materials, b: Batcher): { cx: number; cz: number; w: number; d: number }[] {
  const { grid } = land;
  return town.buildings.map((bld) => {
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (const c of bld.cells) {
      const col = c % COLS;
      const row = (c - col) / COLS;
      minX = Math.min(minX, grid.centreX(col) - CELL / 2);
      maxX = Math.max(maxX, grid.centreX(col) + CELL / 2);
      minZ = Math.min(minZ, grid.centreZ(row) - CELL / 2);
      maxZ = Math.max(maxZ, grid.centreZ(row) + CELL / 2);
    }
    const cx = (minX + maxX) / 2;
    const cz = (minZ + maxZ) / 2;
    const tx = town.centre.x - cx;
    const tz = town.centre.z - cz;
    const front = Math.abs(tx) > Math.abs(tz) ? { x: Math.sign(tx) || 1, z: 0 } : { x: 0, z: Math.sign(tz) || 1 };
    const box = { cx, cz, w: maxX - minX - 12, d: maxZ - minZ - 12 };
    building(b, mats, box, { floors: bld.floors, kind: bld.kind, roof: bld.roof, seed: bld.id * 7 + town.id * 13, front });
    return box;
  });
}

/**
 * The fixed station: platform with a yellow edge line, a canopy over both platform and track (trains run under the
 * roof, as with a wooden toy station) and a little beech station house.
 */
export function buildStation(town: Town, mats: Materials, b: Batcher): void {
  const s = town.station;
  const dx = Math.cos(s.heading);
  const dz = Math.sin(s.heading);
  const yaw = -s.heading;
  const place = (g: BufferGeometry, t: number, lateral: number, y: number) => {
    g.rotateY(yaw);
    g.translate(s.x + dx * t - dz * lateral, y, s.z + dz * t + dx * lateral);
    return g;
  };
  const side = TRACK_WIDTH / 2;
  b.add(mats.blockWood, place(new RoundedBoxGeometry(196, 14, 38, 2, 2.5), 108, side + 21, 7));
  b.add(mats.lacquer("#e6b52c"), place(new RoundedBoxGeometry(196, 2, 4, 1, 0.8), 108, side + 4, 14.5));
  // Canopy posts: on the platform, and opposite them beside the track.
  const postH = CANOPY_Y - 14;
  for (const t of [36, 108, 180]) b.add(mats.lacquer("#f0ebe0"), place(new CylinderGeometry(2.2, 2.2, postH, 10), t, side + 30, 14 + postH / 2));
  for (const t of [36, 180]) b.add(mats.lacquer("#f0ebe0"), place(new CylinderGeometry(2.2, 2.2, CANOPY_Y, 10), t, -CANOPY_FAR, CANOPY_Y / 2));
  const canopyW = side + 34 + CANOPY_FAR;
  const canopyMid = (side + 34 - CANOPY_FAR) / 2;
  b.add(mats.lacquer("#c8442f"), place(new RoundedBoxGeometry(176, 4, canopyW, 1, 1.5), 108, canopyMid, CANOPY_Y + 2));
  b.add(mats.lacquer("#fbf6ec"), place(new RoundedBoxGeometry(178, 3, canopyW + 2, 1, 1.2), 108, canopyMid, CANOPY_Y - 0.5));
  b.add(mats.blockWood, place(new RoundedBoxGeometry(70, 46, 30, 2, 2.5), 108, side + 58, 14 + 23));
  b.add(mats.lacquer("#2f6db5"), place(new RoundedBoxGeometry(80, 5, 38, 1, 1.5), 108, side + 58, STATION_ROOF_TOP - 2.5));
  // Station house door and windows facing the platform.
  b.add(mats.lacquer("#7a3b26"), place(new RoundedBoxGeometry(12, 24, 2, 1, 0.8), 108, side + 42.5, 14 + 12));
  for (const t of [86, 130]) {
    // Authored facing +z; the platform face looks toward −lateral.
    const face = (g: BufferGeometry, out: number) => {
      g.rotateY(Math.PI);
      return place(g, t, side + 42.6 - out, 14 + 26);
    };
    b.add(mats.lacquer("#fbf6ec"), face(new BoxGeometry(16, 14, 1.6), -0.4));
    printedPane(b, mats, 12, 10, face);
  }
  // Clock over the door: a cream face in a red rim, with two dark hands.
  const clockFace = (g: BufferGeometry, out: number) => {
    g.rotateX(Math.PI / 2);
    return place(g, 108, side + 43 - out, 14 + 36);
  };
  b.add(mats.lacquer("#c8442f"), clockFace(new CylinderGeometry(6.5, 6.5, 1.6, 24), 0.8));
  b.add(mats.lacquer("#fbf6ec"), clockFace(new CylinderGeometry(5.2, 5.2, 1.6, 24), 1.4));
  b.add(mats.lacquer("#2a2b2e"), place(new BoxGeometry(0.9, 4.2, 0.6).translate(0, 1.8, 0), 108, side + 43 - 2.4, 14 + 36));
  b.add(mats.lacquer("#2a2b2e"), place(new BoxGeometry(3.2, 0.9, 0.6).translate(1.4, 0, 0), 108, side + 43 - 2.4, 14 + 36));

  // Benches facing the track, between the canopy posts.
  for (const t of [72, 144]) {
    b.add(mats.naturalWood, place(new RoundedBoxGeometry(24, 2, 7, 1, 0.8), t, side + 27, 14 + 6));
    b.add(mats.naturalWood, place(new RoundedBoxGeometry(24, 7, 1.6, 1, 0.6), t, side + 30.5, 14 + 10));
    for (const e of [-10, 10]) b.add(mats.lacquer("#2f6db5"), place(new BoxGeometry(2, 5, 6), t + e, side + 27, 14 + 2.5));
  }

  // A few peg-doll passengers waiting on the platform.
  const r = rng(town.id * 97 + 11);
  const spots = [24, 50, 96, 120, 168, 190];
  const count = 2 + Math.floor(r() * 3);
  for (let k = 0; k < count; k++) {
    const t = spots.splice(Math.floor(r() * spots.length), 1)[0];
    const lateral = side + 10 + r() * 8;
    pegDoll(b, mats, (g) => place(g, t, lateral, 14), r);
  }
}

const PEG_COATS = ["#c8442f", "#2f6db5", "#3c8f4e", "#e6b52c", "#6b4a8f", "#e98aa8"];
const PEG_HATS = ["#2a2b2e", "#7a3b26", "#c8442f", "#2f6db5"];

/** A turned peg doll (about 18 mm tall): painted coat, bare beech head, and sometimes a hat. */
export function pegDoll(b: Batcher, mats: Materials, place: (g: BufferGeometry) => BufferGeometry, r: () => number): void {
  const coat = PEG_COATS[Math.floor(r() * PEG_COATS.length)];
  b.add(mats.lacquer(coat), place(new CylinderGeometry(3.2, 4.2, 11, 14).translate(0, 5.5, 0)));
  b.add(mats.naturalWood, place(new SphereGeometry(3.4, 14, 10).translate(0, 14, 0)));
  if (r() < 0.6) {
    const hat = PEG_HATS[Math.floor(r() * PEG_HATS.length)];
    b.add(mats.lacquer(hat), place(new CylinderGeometry(4, 4, 0.9, 14).translate(0, 16.4, 0)));
    b.add(mats.lacquer(hat), place(new CylinderGeometry(2.6, 2.8, 3, 14).translate(0, 18.2, 0)));
  }
}

/** Arched door outline (w × h, round top), authored facing +z with its back on z = 0. */
function archedDoor(w: number, h: number, depth: number): BufferGeometry {
  const shape = new Shape();
  shape.moveTo(-w / 2, 0);
  shape.lineTo(w / 2, 0);
  shape.lineTo(w / 2, h - w / 2);
  shape.absarc(0, h - w / 2, w / 2, 0, Math.PI, false);
  shape.lineTo(-w / 2, 0);
  return new ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: 12 });
}

/**
 * The engine shed: a long beech shed under a red gable roof, two tall arched green doors at the end facing along
 * its heading, printed windows down the sides and a vent on the ridge.
 */
export function buildShed(land: Landscape, shed: Shed, mats: Materials, b: Batcher): void {
  const y = land.grid.groundY(shed.cells[0]);
  const dx = Math.cos(shed.heading);
  const dz = Math.sin(shed.heading);
  const yaw = -shed.heading;
  // Local shed coordinates: a along the heading (doors at +a), l across, height up from the ground.
  const place = (g: BufferGeometry, a: number, l: number, h: number) => {
    g.rotateY(yaw);
    g.translate(shed.x + dx * a - dz * l, y + h, shed.z + dz * a + dx * l);
    return g;
  };
  const LEN = 124;
  const WIDE = 96;
  const WALL = 52;
  b.add(mats.blockWood, place(new RoundedBoxGeometry(LEN, WALL, WIDE, 2, 2.5), 0, 0, WALL / 2));
  // Gable roof, ridge running along the shed.
  const rise = WIDE * 0.42;
  const tri = new Shape();
  tri.moveTo(-WIDE / 2 - OVERHANG, -1);
  tri.lineTo(WIDE / 2 + OVERHANG, -1);
  tri.lineTo(0, rise);
  tri.lineTo(-WIDE / 2 - OVERHANG, -1);
  const roof = new ExtrudeGeometry(tri, { depth: LEN + OVERHANG * 2, bevelEnabled: true, bevelSize: 1.2, bevelThickness: 1.2, bevelSegments: 2 });
  // Authored with the ridge along z; turn it so the ridge runs along a (local x).
  roof.translate(0, 0, -(LEN + OVERHANG * 2) / 2);
  roof.rotateY(Math.PI / 2);
  b.add(mats.lacquer("#c8442f"), place(roof, 0, 0, WALL));
  b.add(mats.lacquer("#2a2b2e"), place(new RoundedBoxGeometry(30, 10, 14, 1, 1.5), 0, 0, WALL + rise + 3));
  b.add(mats.lacquer("#c8442f"), place(new RoundedBoxGeometry(36, 3, 20, 1, 1), 0, 0, WALL + rise + 9));

  // Doors on the front end (+a), facing out: authored facing +z, turned to face +a.
  const front = (g: BufferGeometry, l: number, h: number, out: number) => {
    g.rotateY(Math.PI / 2);
    return place(g, LEN / 2 + out, l, h);
  };
  for (const l of [-WIDE / 4, WIDE / 4]) {
    b.add(mats.lacquer("#fbf6ec"), front(archedDoor(38, 46, 1.6), l, 0, -0.2));
    b.add(mats.lacquer("#2f5d3a"), front(archedDoor(32, 42, 1.6), l, 0, 0.4));
    b.add(mats.lacquer("#fbf6ec"), front(new BoxGeometry(1.4, 26, 1), l, 13, 2.2));
  }
  // Printed windows down both sides.
  for (const side of [1, -1]) {
    for (const a of [-36, 0, 36]) {
      const face = (g: BufferGeometry, out: number) => {
        if (side < 0) g.rotateY(Math.PI);
        return place(g, a, side * (WIDE / 2 + out), 34);
      };
      b.add(mats.lacquer("#fbf6ec"), face(new BoxGeometry(20, 16, 1.6), 0.2));
      printedPane(b, mats, 16, 12, face);
    }
  }
}

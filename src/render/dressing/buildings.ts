import { BoxGeometry, CylinderGeometry, ExtrudeGeometry, Shape, type BufferGeometry } from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { CELL, COLS, type Landscape, type Town } from "../../landscape";
import { STATION_ROOF_TOP } from "../../landscape/sign";
import { TRACK_WIDTH } from "../../track";
import type { Materials } from "../materials";
import type { Batcher } from "./batcher";

const ROOF_COLORS = ["#c8442f", "#2f6db5", "#3c8f4e", "#6b4a8f"];
const WALL_COLORS = ["#f0ebe0", "#e9d9b8", "#f3e3c3", "#f6dcc8", "#dfe8e4"];
const DOOR_COLORS = ["#7a3b26", "#2f5d8a", "#3c6e3e", "#8a2f3a"];
const FLOOR_H = 40;
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
  b.add(mats.lacquer(pick(WALL_COLORS, opts.seed)), body);
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
        b.add(frameMat, place(frameRing(ww + 4, 16, 2), u, 16 + f * FLOOR_H, s, 0));
        const pane = new BoxGeometry(ww, 12, 1);
        b.add(mats.glass, place(pane, u, 16 + f * FLOOR_H, s, 0.3));
        const sill = new BoxGeometry(ww + 6, 2, 3);
        b.add(frameMat, place(sill, u, 9 + f * FLOOR_H, s, 1.2));
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
    const awning = new RoundedBoxGeometry(faceWidth * 0.8, 3, 11, 1, 1);
    b.add(mats.lacquer("#c8442f"), place(awning, 0, h * 0.62, 1, 5));
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

/** The fixed station: platform with a yellow edge line, canopy on posts and a little station house. */
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
  for (const t of [48, 108, 168]) b.add(mats.lacquer("#f0ebe0"), place(new CylinderGeometry(2.2, 2.2, 46, 10), t, side + 30, 14 + 23));
  b.add(mats.lacquer("#c8442f"), place(new RoundedBoxGeometry(150, 4, 46, 1, 1.5), 108, side + 22, 14 + 48));
  b.add(mats.lacquer("#e9d9b8"), place(new RoundedBoxGeometry(70, 46, 30, 2, 2.5), 108, side + 58, 14 + 23));
  b.add(mats.lacquer("#2f6db5"), place(new RoundedBoxGeometry(80, 5, 38, 1, 1.5), 108, side + 58, STATION_ROOF_TOP - 2.5));
  // Station house door and windows facing the platform.
  b.add(mats.lacquer("#7a3b26"), place(new RoundedBoxGeometry(12, 24, 2, 1, 0.8), 108, side + 42.5, 14 + 12));
  for (const t of [86, 130]) {
    b.add(mats.lacquer("#fbf6ec"), place(new BoxGeometry(16, 14, 1.6), t, side + 42.6, 14 + 26));
    b.add(mats.glass, place(new BoxGeometry(12, 10, 1), t, side + 42.2, 14 + 26));
  }
}

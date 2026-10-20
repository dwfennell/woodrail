import { BoxGeometry, ConeGeometry, CylinderGeometry, ExtrudeGeometry, Shape, SphereGeometry, type BufferGeometry, type Material } from "three";
import { rng } from "../../lib/rng";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { CELL, FEAT_BUILDING, FEAT_NONE, FEAT_STATION, SURF_ROAD, SURF_TOWN, type Landscape, type Shed, type Town } from "../../landscape";
import { STATION_ROOF_TOP } from "../../landscape/sign";
import { TRACK_WIDTH } from "../../track";
import { addPart } from "../blender-models";
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
  opts: { floors: number; kind: Look; roof: number; seed: number; front: { x: number; z: number } },
): Point[] {
  if (opts.kind !== "house" && opts.kind !== "shop") return specialBuilding(b, mats, box, { ...opts, kind: opts.kind });
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
      addPart(b, mats, "chimney-top", (g) => g.translate(along ? cx + t : cx + off, h + rise * 0.9 + 10, along ? cz + off : cz + t));
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
          addPart(b, mats, "flower-box", (g) => place(g.scale((ww + 4) / 18, 1, 1), u, 4, s, 3), { flower: pick(FLOWER_COLORS, opts.seed + k) });
        }
      }
    }
  }
  // Door with a little brass knob, and a shop awning over the front.
  const doorU = cols === 1 ? 0 : -faceWidth * 0.24;
  addPart(b, mats, "door", (g) => place(g, doorU, 12, 1, 0), { door: pick(DOOR_COLORS, opts.seed >> 2) });
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
  const n = faceDepth / 2;
  return [{ x: cx + fx * n + (fx !== 0 ? 0 : doorU), z: cz + fz * n + (fx !== 0 ? doorU : 0) }];
}

/** A building's footprint (centre and size, inset from its squares) and the way its front faces. */
export interface Footprint {
  cx: number;
  cz: number;
  w: number;
  d: number;
  front: { x: number; z: number };
}

/**
 * Where a town's building stands and which way it faces: onto its street (`faces`, a grid edge), or in towns from
 * before streets, toward the town centre (a terrace faces off its long side).
 */
export function footprintOf(land: Landscape, town: Town, cells: readonly number[], look: Look, faces?: 0 | 1 | 2 | 3): Footprint {
  const { grid } = land;
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const c of cells) {
    const col = grid.colOf(c);
    const row = grid.rowOf(c);
    minX = Math.min(minX, grid.centreX(col) - CELL / 2);
    maxX = Math.max(maxX, grid.centreX(col) + CELL / 2);
    minZ = Math.min(minZ, grid.centreZ(row) - CELL / 2);
    maxZ = Math.max(maxZ, grid.centreZ(row) + CELL / 2);
  }
  const cx = (minX + maxX) / 2;
  const cz = (minZ + maxZ) / 2;
  const tx = town.centre.x - cx;
  const tz = town.centre.z - cz;
  const w = maxX - minX - 12;
  const d = maxZ - minZ - 12;
  // Onto its street, when the town was laid out streets first; else toward the town centre.
  if (faces !== undefined) return { cx, cz, w, d, front: [{ x: 1, z: 0 }, { x: 0, z: 1 }, { x: -1, z: 0 }, { x: 0, z: -1 }][faces] };
  let front = Math.abs(tx) > Math.abs(tz) ? { x: Math.sign(tx) || 1, z: 0 } : { x: 0, z: Math.sign(tz) || 1 };
  if (look === "terrace" && w !== d) front = w > d ? { x: 0, z: Math.sign(tz) || 1 } : { x: Math.sign(tx) || 1, z: 0 };
  return { cx, cz, w, d, front };
}

/**
 * Which look each of a town's buildings gets (same order as `town.buildings`): a few special buildings per town
 * (each kind at most once), and terraced cottage rows on some of the remaining long house footprints. Its own random
 * stream from the map seed and town, so the landscape generator's sequence is untouched.
 */
export function townLooks(seed: number, town: Town): Look[] {
  const r = rng((Math.imul(seed, 53) + town.id * 977 + 3) >>> 0);
  const looks: Look[] = town.buildings.map((bl) => bl.kind);
  const n = looks.length;
  if (n === 0) return looks;
  const long = (i: number) => town.buildings[i].cells.length > 1;
  const want = Math.min(Math.max(n - 1, 1), 1 + (n >= 4 ? 1 : 0) + (n >= 7 ? 1 : 0) + (r() < 0.4 ? 1 : 0));
  const kinds: Look[] = [...SPECIAL_LOOKS];
  for (let i = kinds.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [kinds[i], kinds[j]] = [kinds[j], kinds[i]];
  }
  const free = looks.map((_, i) => i);
  for (const kind of kinds.slice(0, want)) {
    const longs = free.filter(long);
    const shorts = free.filter((i) => !long(i));
    // Church and school like a long footprint; the shops a short one.
    const pool = kind === "church" || kind === "school" ? (longs.length ? longs : shorts) : shorts.length ? shorts : longs;
    const i = pool[Math.floor(r() * pool.length)];
    looks[i] = kind;
    free.splice(free.indexOf(i), 1);
  }
  for (const i of free) if (long(i) && looks[i] === "house" && r() < 0.75) looks[i] = "terrace";
  return looks;
}

/**
 * A town's street furniture, on the pavements of its road squares, clear of the buildings' doors. The buildings
 * themselves are catalogue models placed as props (see `src/props/towns.ts`); their doors are at the middle of their
 * fronts, facing the town centre. Returns nothing to cast contact shadows (props stand on their own).
 */
export function buildTown(land: Landscape, town: Town, mats: Materials, b: Batcher): { cx: number; cz: number; w: number; d: number }[] {
  const looks = townLooks(land.seed, town);
  const doors: Point[] = town.buildings.map((bld, k) => {
    const fp = footprintOf(land, town, bld.cells, looks[k], bld.front);
    const half = fp.front.x !== 0 ? fp.w / 2 : fp.d / 2;
    return { x: fp.cx + fp.front.x * half, z: fp.cz + fp.front.z * half };
  });
  for (const p of townFurniture(land, town, doors)) furniture(b, mats, p);
  for (const i of townGreens(land, town)) green(land, i, mats, b);
  return [];
}

/** A town's greens: its squares with nothing on them (a house moved away, or not yet built on). */
export function townGreens(land: Landscape, town: Town): number[] {
  const g = land.grid;
  return town.cells.filter((i) => g.surface[i] === SURF_TOWN && g.feature[i] === FEAT_NONE);
}

const LAWN_INSET = 5;
const LAWN_H = 1.4;

/**
 * A town green: a painted lawn a little lighter than the fields' felt, with a few flowers in its corners. Low and flat,
 * so a prop stood on it stands clear.
 */
function green(land: Landscape, i: number, mats: Materials, b: Batcher): void {
  const g = land.grid;
  const x = g.centreX(g.colOf(i));
  const z = g.centreZ(g.rowOf(i));
  const y = g.groundY(i);
  const size = CELL - 2 * LAWN_INSET;
  b.add(mats.lacquer("#4e8f34"), new RoundedBoxGeometry(size, LAWN_H, size, 2, 0.7).translate(x, y + LAWN_H / 2, z));
  // In each corner a little clump of one colour, three flowers stepping in from the corner.
  const r = rng(land.seed * 31 + i * 7 + 5);
  const reach = size / 2 - 5;
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    const flower = mats.lacquer(pick(FLOWER_COLORS, Math.floor(r() * FLOWER_COLORS.length)));
    for (const [ox, oz] of [[0, 0], [5, 2], [2, 5]]) {
      b.add(flower, new SphereGeometry(1.8, 6, 4).translate(x + sx * (reach - ox), y + LAWN_H + 1.2, z + sz * (reach - oz)));
    }
  }
}

/**
 * The fixed station: platform with a yellow edge line, a canopy over both platform and track (trains run under the
 * roof, as with a wooden toy station) and a little beech station house.
 */
export function buildStation(town: Town, mats: Materials, b: Batcher): void {
  const place = stationPlace(town);
  const side = TRACK_WIDTH / 2;
  b.add(mats.blockWood, place(new RoundedBoxGeometry(196, 14, 38, 2, 2.5), 108, side + 21, 7));
  b.add(mats.lacquer("#e6b52c"), place(new RoundedBoxGeometry(196, 2, 4, 1, 0.8), 108, side + 4, 14.5));
  // Canopy posts: on the platform, and opposite them beside the track.
  for (const t of [36, 108, 180]) addPart(b, mats, "canopy-post-62", (g) => place(g, t, side + 30, 14));
  for (const t of [36, 180]) addPart(b, mats, "canopy-post-76", (g) => place(g, t, -CANOPY_FAR, 0));
  const canopyW = side + 34 + CANOPY_FAR;
  const canopyMid = (side + 34 - CANOPY_FAR) / 2;
  b.add(mats.lacquer("#c8442f"), place(new RoundedBoxGeometry(176, 4, canopyW, 1, 1.5), 108, canopyMid, CANOPY_Y + 2));
  b.add(mats.lacquer("#fbf6ec"), place(new RoundedBoxGeometry(178, 3, canopyW + 2, 1, 1.2), 108, canopyMid, CANOPY_Y - 0.5));
  b.add(mats.blockWood, place(new RoundedBoxGeometry(70, 46, 30, 2, 2.5), 108, side + 58, 14 + 23));
  b.add(mats.lacquer("#2f6db5"), place(new RoundedBoxGeometry(80, 5, 38, 1, 1.5), 108, side + 58, STATION_ROOF_TOP - 2.5));
  // Station house door and windows facing the platform.
  addPart(b, mats, "door", (g) => place(g.scale(12 / 13, 1, 1).rotateY(Math.PI), 108, side + 43, 14 + 12), { door: "#7a3b26" });
  for (const t of [86, 130]) {
    // Authored facing +z; the platform face looks toward −lateral.
    const face = (g: BufferGeometry, out: number) => {
      g.rotateY(Math.PI);
      return place(g, t, side + 42.6 - out, 14 + 26);
    };
    b.add(mats.lacquer("#fbf6ec"), face(new BoxGeometry(16, 14, 1.6), -0.4));
    printedPane(b, mats, 12, 10, face);
  }
  // Clock over the door, facing the platform.
  addPart(b, mats, "station-clock", (g) => place(g.rotateY(Math.PI), 108, side + 43, 14 + 36));

  // Benches facing the track, between the canopy posts.
  for (const t of [72, 144]) addPart(b, mats, "station-bench", (g) => place(g, t, side + 27, 14));

  // Station staff and a traveller (their own stream, so the waiting passengers below keep their places): a conductor
  // with a flag near the far end, a porter with a luggage barrow by the station house, a traveller with a suitcase.
  // Each faces the track (authored facing +z, turned to face −lateral).
  const facing = (t: number, lateral: number) => (g: BufferGeometry) => place(g.rotateY(Math.PI), t, side + lateral, 14);
  const who = stationStaff(town);
  if (who & 1) conductor(b, mats, facing(196, 8));
  if (who & 2) porter(b, mats, facing(124, 36.5));
  if (who & 4) traveller(b, mats, facing(170, 27));
  // (The peg-doll passengers waiting on the platform are drawn apart, by `buildWaiting`: their number can change.)
}

/** Place geometry authored at a station's origin: `t` mm along its track, `lateral` mm across, `y` up. */
function stationPlace(town: Town): (g: BufferGeometry, t: number, lateral: number, y: number) => BufferGeometry {
  const s = town.station;
  const dx = Math.cos(s.heading);
  const dz = Math.sin(s.heading);
  const yaw = -s.heading;
  return (g, t, lateral, y) => {
    g.rotateY(yaw);
    g.translate(s.x + dx * t - dz * lateral, y, s.z + dz * t + dx * lateral);
    return g;
  };
}

/** Which of the station staff stand on a town's platform: bits for the conductor (1), porter (2) and traveller (4). */
function stationStaff(town: Town): number {
  const s = town.station;
  const staff = rng((town.id * 131 + Math.round(s.x) * 7 + Math.round(s.z) * 3 + 29) >>> 0);
  return 1 + Math.floor(staff() * 7); // a non-empty set of the three
}

/** Most peg dolls a platform has room for. */
export const MAX_WAITING_DOLLS = 12;

/**
 * Peg-doll passengers waiting on a town's platform: `count` of them (up to `MAX_WAITING_DOLLS`), or null for the usual
 * few (two to four, the town's own). Each town's dolls keep their places and coats as the number changes: the first
 * ones are always the same. `after(k)` is called once the first k have been added. Returns the usual number.
 */
export function buildWaiting(town: Town, count: number | null, mats: Materials, b: Batcher, after?: (k: number) => void): number {
  const place = stationPlace(town);
  const side = TRACK_WIDTH / 2;
  const r = rng(town.id * 97 + 11);
  // (The socket end of the platform is the goods corner: crane and plank pile.)
  const spots = stationStaff(town) & 1 ? [96, 120, 158, 168, 176] : [96, 120, 158, 168, 190];
  // More room further along, between the benches and the station house's door (for a busy platform).
  const more = [70, 82, 108, 132, 146, 186, 62];
  const usual = 2 + Math.floor(r() * 3);
  const n = Math.min(count ?? usual, MAX_WAITING_DOLLS);
  after?.(0);
  for (let k = 0; k < n; k++) {
    const pool = spots.length > 0 ? spots : more;
    const t = pool.splice(Math.floor(r() * pool.length), 1)[0];
    const lateral = side + 10 + r() * 8;
    pegDoll(b, mats, (g) => place(g, t, lateral, 14), r);
    after?.(k + 1);
  }
  return usual;
}

const PEG_COATS = ["#c8442f", "#2f6db5", "#3c8f4e", "#e6b52c", "#6b4a8f", "#e98aa8"];
const PEG_HATS = ["#2a2b2e", "#7a3b26", "#c8442f", "#2f6db5"];

/** A turned peg doll (about 18 mm tall): painted coat, bare beech head, and sometimes a hat. */
export function pegDoll(b: Batcher, mats: Materials, place: (g: BufferGeometry) => BufferGeometry, r: () => number): void {
  const coat = PEG_COATS[Math.floor(r() * PEG_COATS.length)];
  const hatted = r() < 0.6;
  // (The same draws from r in either case, so the waiting passengers keep their places.)
  const hat = hatted ? PEG_HATS[Math.floor(r() * PEG_HATS.length)] : "";
  addPart(b, mats, hatted ? "peg-doll-hat" : "peg-doll", place, { coat, hat });
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
  for (const l of [-WIDE / 4, WIDE / 4]) addPart(b, mats, "shed-door", (g) => front(g, l, 0, 0));
  // Printed windows down both sides.
  for (const side of [1, -1]) {
    for (const a of [-36, 0, 36]) {
      const face = (g: BufferGeometry, out: number) => {
        if (side < 0) g.rotateY(Math.PI);
        return place(g, a, side * (WIDE / 2 + out), 34);
      };
      addPart(b, mats, "shed-window", (g) => face(g, 0));
    }
  }
}

// ————————————————————————————————————————— Special buildings —————————————————————————————————————————

/** How a town building is drawn: the generator's plain house or shop, or one of the special looks. */
export type Look = "house" | "shop" | "bakery" | "cafe" | "post" | "church" | "school" | "terrace";
/** The special buildings a town can get (a terraced row is given to long house footprints separately). */
export const SPECIAL_LOOKS: readonly Look[] = ["bakery", "cafe", "post", "church", "school"];

export interface Point {
  x: number;
  z: number;
}

const CREAM = "#fbf6ec";
const STONE = "#e4dccb";
const SLATE = "#7a8592";
const TERRACE_WALLS = ["#f2c2cc", "#bcd8ea", "#f3dd8a", "#f6dcc8", "#cfe3c4"];

/** 0 front (+z), 1 right (+x), 2 back (−z), 3 left (−x), in a building's local frame. */
type Side = 0 | 1 | 2 | 3;

/**
 * Bakery, café, post office, church, school or terraced cottage row, drawn in the building's local frame (x across
 * the front, z out of the front, y up) and kept within its footprint. Returns the world positions of its front doors.
 */
function specialBuilding(
  b: Batcher,
  mats: Materials,
  box: { cx: number; cz: number; w: number; d: number },
  opts: { floors: number; kind: Exclude<Look, "house" | "shop">; roof: number; seed: number; front: { x: number; z: number } },
): Point[] {
  const { floors, seed } = opts;
  const W = opts.front.x !== 0 ? box.d : box.w;
  const D = opts.front.x !== 0 ? box.w : box.d;
  const th = Math.atan2(opts.front.x, opts.front.z);
  const cos = Math.cos(th);
  const sin = Math.sin(th);
  const world = (g: BufferGeometry) => g.rotateY(th).translate(box.cx, 0, box.cz);
  const put = (m: Material, g: BufferGeometry) => b.add(m, world(g));
  const pt = (u: number, v: number): Point => ({ x: box.cx + u * cos + v * sin, z: box.cz - u * sin + v * cos });
  const paint = (c: string) => mats.lacquer(c);
  const rbox = (w: number, h: number, d: number, x: number, y: number, z: number, r = 1) => {
    const g = new RoundedBoxGeometry(w, h, d, 1, Math.min(r, w / 2 - 0.01, h / 2 - 0.01, d / 2 - 0.01));
    return g.translate(x, y, z);
  };
  /** A body (cu, cv centre, hx, hz half size): geometry authored facing +z, back on z = 0, put on one of its faces. */
  const onFace = (g: BufferGeometry, side: Side, body: Body, along: number, y: number, out: number) => {
    const a = (side * Math.PI) / 2;
    g.rotateY(a);
    const nx = Math.sin(a);
    const nz = Math.cos(a);
    const half = side % 2 === 0 ? body.hz : body.hx;
    return world(g.translate(body.cu + nx * (half + out) + nz * along, y, body.cv + nz * (half + out) - nx * along));
  };
  const win = (side: Side, body: Body, along: number, y: number, ww: number, wh: number, sill = true) => {
    b.add(paint(CREAM), onFace(frameRing(ww + 4, wh + 4, 2), side, body, along, y, 0));
    printedPane(b, mats, ww, wh, (g, out) => onFace(g, side, body, along, y, out));
    if (sill) b.add(paint(CREAM), onFace(new BoxGeometry(ww + 6, 2, 3), side, body, along, y - wh / 2 - 3, 1.2));
  };
  const door = (side: Side, body: Body, along: number, color: string, dw = 13, dh = 24): Point => {
    addPart(b, mats, "door", (g) => onFace(g.scale(dw / 13, dh / 24, 1), side, body, along, dh / 2, 0), { door: color });
    const a = (side * Math.PI) / 2;
    const half = side % 2 === 0 ? body.hz : body.hx;
    return pt(body.cu + Math.sin(a) * half + Math.cos(a) * along, body.cv + Math.cos(a) * half - Math.sin(a) * along);
  };
  /** A gable roof over a body, its ridge along x (`alongX`) or z, eaves at height y. Returns the rise. */
  const gable = (body: Body, alongX: boolean, y: number, color: string, steep = 0.55, ends: [number, number] = [OVERHANG, OVERHANG]) => {
    const span = alongX ? body.hz * 2 : body.hx * 2;
    const length = alongX ? body.hx * 2 : body.hz * 2;
    const rise = span * steep;
    const tri = new Shape();
    tri.moveTo(-span / 2 - OVERHANG, -1);
    tri.lineTo(span / 2 + OVERHANG, -1);
    tri.lineTo(0, rise);
    tri.lineTo(-span / 2 - OVERHANG, -1);
    const depth = length + ends[0] + ends[1];
    const roof = new ExtrudeGeometry(tri, { depth, bevelEnabled: true, bevelSize: 1.2, bevelThickness: 1.2, bevelSegments: 2 });
    // Extruded along z from 0; the first end overhang sits at the body's low side.
    roof.translate(0, 0, -length / 2 - ends[0]);
    if (alongX) roof.rotateY(Math.PI / 2);
    put(paint(color), roof.translate(body.cu, y, body.cv));
    return rise;
  };
  /** A flat roof with a cream parapet over a body of height h. */
  const flat = (body: Body, h: number, color: string) => {
    put(paint(color), rbox(body.hx * 2 + Math.min(OVERHANG, 4) * 2, 5, body.hz * 2 + Math.min(OVERHANG, 4) * 2, body.cu, h + 2.5, body.cv, 1.5));
    put(paint("#f3ead8"), rbox(body.hx * 2 + 2, 6, body.hz * 2 + 2, body.cu, h + 7, body.cv, 1.5));
  };
  const awning = (body: Body, width: number, y: number, a: string, c: string, depth = 13, along = 0) => {
    const stripes = Math.max(3, Math.round(width / 10) | 1);
    for (let i = 0; i < stripes; i++) {
      const strip = new BoxGeometry(width / stripes, 2.5, depth).rotateX(0.35).translate(0, 0, depth / 2 - 0.5);
      b.add(paint(i % 2 ? c : a), onFace(strip, 0, body, along - width / 2 + (width / stripes) * (i + 0.5), y, 0));
    }
  };
  const chimney = (x: number, z: number, y0: number, top: number) => {
    put(paint("#a5503a"), rbox(9, top - y0, 9, x, (top + y0) / 2, z, 1.2));
    addPart(b, mats, "chimney-top", (g) => world(g.translate(x, top - 1.25, z)));
  };
  const h = FLOOR_H * floors + 6;
  const whole: Body = { cu: 0, cv: 0, hx: W / 2, hz: D / 2 };
  const doors: Point[] = [];

  switch (opts.kind) {
    case "bakery": {
      // Cream walls, eaves to the front, a giant loaf on the ridge and a tall oven chimney.
      put(paint("#f3e3c3"), rbox(W, h, D, 0, h / 2, 0, 2.5));
      const rise = gable(whole, true, h, ROOF_COLORS[opts.roof]);
      chimney(W * 0.3, -D * 0.2, h, h + rise + 14);
      const loaf = new SphereGeometry(8, 18, 10).scale(1.8, 0.8, 1.1).translate(0, h + rise + 3, 0);
      put(paint("#c98a46"), loaf);
      for (const x of [-7, 0, 7]) {
        const top = 6.4 * Math.sqrt(Math.max(0, 1 - (x / 14.4) ** 2));
        put(paint("#ecc88e"), new BoxGeometry(1.6, 1.2, 7).rotateY(0.5).translate(x, h + rise + 3 + top - 0.2, 0));
      }
      const doorU = -W * 0.24;
      doors.push(door(0, whole, doorU, "#7a3b26"));
      win(0, whole, W * 0.2, 16, Math.min(22, W * 0.36), 14);
      awning(whole, W * 0.86, 31, "#e98a3a", CREAM, 7);
      for (let f = 1; f < floors; f++) for (const u of [-W * 0.24, W * 0.24]) win(0, whole, u, 16 + f * FLOOR_H, 12, 12);
      for (let f = 0; f < floors; f++) win(2, whole, 0, 16 + f * FLOOR_H, 12, 12);
      break;
    }
    case "cafe": {
      // Set back from the front: two little tables with parasols stand out front, under a striped awning.
      const back = 18;
      const body: Body = { cu: 0, cv: -back / 2, hx: W / 2, hz: (D - back) / 2 };
      put(paint(pick(["#f6dcc8", "#dfe8e4", "#f3e3c3"], seed)), rbox(W, h, D - back, 0, h / 2, -back / 2, 2.5));
      flat(body, h, ROOF_COLORS[opts.roof]);
      doors.push(door(0, body, -W * 0.24, "#3c6e3e"));
      win(0, body, W * 0.2, 16, Math.min(20, W * 0.34), 14);
      awning(body, W * 0.9, 30, "#3c8f4e", CREAM, 10);
      for (let f = 1; f < floors; f++) for (const u of [-W * 0.24, W * 0.24]) win(0, body, u, 16 + f * FLOOR_H, 12, 12);
      for (let f = 0; f < floors; f++) win(2, body, 0, 16 + f * FLOOR_H, 12, 12);
      const tables = W > 90 ? [-W * 0.3, 0, W * 0.3] : [-W * 0.26, W * 0.26];
      const tz = D / 2 - back / 2 + 1;
      tables.forEach((x, k) => {
        put(mats.naturalWood, new CylinderGeometry(4.6, 4.6, 1.2, 14).translate(x, 8.4, tz));
        put(paint("#2a2b2e"), new CylinderGeometry(0.7, 1.4, 8, 6).translate(x, 4, tz));
        for (const s of [-7, 7]) put(mats.naturalWood, new CylinderGeometry(2, 2, 5, 10).translate(x + s, 2.5, tz));
        put(paint(CREAM), new CylinderGeometry(0.45, 0.45, 13, 6).translate(x, 15, tz));
        put(paint(k % 2 ? "#e6b52c" : "#c8442f"), new ConeGeometry(7.5, 3.5, 12).translate(x, 21.5, tz));
      });
      break;
    }
    case "post": {
      // Red walls, a cream envelope sign over the door and a pillar box beside it, set back inside the footprint.
      const back = 10;
      const body: Body = { cu: 0, cv: -back / 2, hx: W / 2, hz: (D - back) / 2 };
      put(paint("#c8442f"), rbox(W, h, D - back, 0, h / 2, -back / 2, 2.5));
      flat(body, h, "#2f6db5");
      const doorU = -W * 0.18;
      doors.push(door(0, body, doorU, "#2f5d8a"));
      win(0, body, W * 0.24, 16, 12, 12);
      for (let f = 1; f < floors; f++) for (const u of [-W * 0.24, W * 0.24]) win(0, body, u, 16 + f * FLOOR_H, 12, 12);
      for (let f = 0; f < floors; f++) win(2, body, 0, 16 + f * FLOOR_H, 12, 12);
      // Envelope sign over the door.
      b.add(paint(CREAM), onFace(new BoxGeometry(18, 11, 1.4), 0, body, doorU, 33, 0));
      for (const s of [-1, 1]) {
        const flap = new BoxGeometry(10.4, 1, 1).rotateZ(s * 0.5).translate(s * 4.4, 0, 0);
        b.add(paint("#c8442f"), onFace(flap, 0, body, doorU, 35.5, 1.2));
      }
      // Pillar box by the door.
      const px = doorU + 13;
      const pz = D / 2 - back / 2;
      put(paint("#c8442f"), new CylinderGeometry(3.3, 3.5, 13, 14).translate(px, 6.5, pz));
      put(paint("#c8442f"), new CylinderGeometry(3.9, 3.9, 1.4, 14).translate(px, 13.4, pz));
      put(paint("#c8442f"), new SphereGeometry(3.4, 14, 6, 0, Math.PI * 2, 0, Math.PI / 2).translate(px, 14, pz));
      put(paint("#2a2b2e"), new BoxGeometry(3.6, 0.8, 1).translate(px, 10.5, pz + 3.1));
      break;
    }
    case "school": {
      // Yellow schoolhouse with a row of windows and a bell cupola on the ridge.
      const alongX = W >= D;
      put(paint("#ecc451"), rbox(W, h, D, 0, h / 2, 0, 2.5));
      const rise = gable(whole, alongX, h, "#c8442f", 0.5);
      const n = W >= 100 ? 4 : 2;
      const us = n === 4 ? [-W * 0.38, -W * 0.15, W * 0.15, W * 0.38] : [-W * 0.3, W * 0.3];
      doors.push(door(0, whole, 0, "#2f6db5", 13, 26));
      for (let f = 0; f < floors; f++) for (const u of us) win(0, whole, u, 18 + f * FLOOR_H, 10, 14);
      for (let f = 0; f < floors; f++) for (const u of us) win(2, whole, u, 18 + f * FLOOR_H, 10, 14);
      const y = h + rise;
      put(paint(CREAM), rbox(13, 5, 13, 0, y, 0, 1));
      for (const [x, z] of [[-4.6, -4.6], [4.6, -4.6], [-4.6, 4.6], [4.6, 4.6]]) put(paint(CREAM), rbox(2, 10, 2, x, y + 7.5, z, 0.4));
      put(paint("#e6b52c"), new CylinderGeometry(1.2, 3, 4.2, 12).translate(0, y + 6.5, 0));
      put(paint("#c8442f"), new ConeGeometry(10, 7, 4).rotateY(Math.PI / 4).translate(0, y + 16, 0));
      put(paint("#e6b52c"), new SphereGeometry(1.2, 8, 6).translate(0, y + 20, 0));
      break;
    }
    case "church": {
      // A stone nave under a steep slate roof and a square tower with a plain spire and a weathervane.
      const longX = W >= D;
      const T = Math.min(28, Math.round(Math.min(W, D) * 0.44));
      const end = seed % 2 ? 1 : -1;
      const tower: Body = longX ? { cu: end * (W / 2 - T / 2), cv: 0, hx: T / 2, hz: T / 2 } : { cu: 0, cv: D / 2 - T / 2, hx: T / 2, hz: T / 2 };
      const nave: Body = longX
        ? { cu: -end * (T / 2) + end * 1, cv: 0, hx: (W - T) / 2 + 1, hz: D / 2 - 4 }
        : { cu: 0, cv: -T / 2 + 1, hx: W / 2 - 4, hz: (D - T) / 2 + 1 };
      const naveH = 42;
      put(paint(STONE), rbox(nave.hx * 2, naveH, nave.hz * 2, nave.cu, naveH / 2, nave.cv, 2));
      // Only the far end of the nave overhangs: its other end meets the tower.
      const towardTower = longX ? (end > 0 ? [OVERHANG, 0] : [0, OVERHANG]) : [OVERHANG, 0];
      gable(nave, longX, naveH, SLATE, 0.62, towardTower as [number, number]);
      const towerH = 70;
      put(paint(STONE), rbox(T, towerH, T, tower.cu, towerH / 2, tower.cv, 2));
      put(paint(CREAM), rbox(T + 3, 3, T + 3, tower.cu, towerH + 1.5, tower.cv, 1));
      const spireH = 38;
      put(paint(SLATE), new ConeGeometry((T / 2 + 1) * Math.SQRT2, spireH, 4).rotateY(Math.PI / 4).translate(tower.cu, towerH + 3 + spireH / 2, tower.cv));
      // Weathervane: a short rod with an arrow resting on its top (no crossbar above it).
      const top = towerH + 3 + spireH;
      put(paint("#d9a93a"), new CylinderGeometry(0.5, 0.5, 8, 6).translate(tower.cu, top + 3, tower.cv));
      put(paint("#d9a93a"), new SphereGeometry(1.3, 8, 6).translate(tower.cu, top + 3, tower.cv));
      put(paint("#d9a93a"), new BoxGeometry(12, 0.9, 0.9).translate(tower.cu, top + 7.4, tower.cv));
      put(paint("#d9a93a"), new ConeGeometry(1.6, 3, 4).rotateZ(-Math.PI / 2).translate(tower.cu + 7.5, top + 7.4, tower.cv));
      put(paint("#d9a93a"), new BoxGeometry(0.6, 3.4, 3.4).rotateX(Math.PI / 4).translate(tower.cu - 5.6, top + 7.4, tower.cv));
      // Arched door and a round window on the front; tall arched windows down the nave.
      const arch = (side: Side, body: Body, along: number, y: number, aw: number, ah: number, inner: string) => {
        b.add(paint(CREAM), onFace(archedDoor(aw + 3, ah + 3, 1.6).translate(0, -1.5, 0), side, body, along, y, -0.2));
        b.add(paint(inner), onFace(archedDoor(aw, ah, 1.6), side, body, along, y, 0.4));
      };
      const doorBody = longX ? nave : tower;
      arch(0, doorBody, 0, 0, 12, 22, "#7a3b26");
      doors.push(pt(doorBody.cu, doorBody.cv + doorBody.hz));
      const clock = (side: Side) => {
        b.add(paint(CREAM), onFace(new CylinderGeometry(5.5, 5.5, 1.4, 20).rotateX(Math.PI / 2).translate(0, 0, 0.7), side, tower, 0, towerH - 13, 0));
        b.add(paint("#2a2b2e"), onFace(new BoxGeometry(0.9, 4, 0.5).translate(0, 1.6, 0), side, tower, 0, towerH - 13, 1.5));
        b.add(paint("#2a2b2e"), onFace(new BoxGeometry(3, 0.9, 0.5).translate(1.2, 0, 0), side, tower, 0, towerH - 13, 1.5));
      };
      clock(0);
      clock(2);
      if (longX) {
        const n = Math.max(2, Math.floor((nave.hx * 2) / 26));
        for (let k = 0; k < n; k++) {
          const a = nave.cu - nave.hx + ((k + 0.5) * nave.hx * 2) / n - nave.cu;
          if (Math.abs(a) < 12) continue;
          arch(0, nave, a, 12, 7, 18, PANE_COLOR);
          arch(2, nave, -a, 12, 7, 18, PANE_COLOR);
        }
        arch(2, nave, 0, 12, 7, 18, PANE_COLOR);
      } else {
        const n = Math.max(1, Math.floor((nave.hz * 2) / 24));
        for (let k = 0; k < n; k++) {
          const a = -nave.hz + ((k + 0.5) * nave.hz * 2) / n;
          arch(1, nave, -a, 12, 7, 18, PANE_COLOR);
          arch(3, nave, a, 12, 7, 18, PANE_COLOR);
        }
      }
      break;
    }
    case "terrace": {
      // Two or three joined cottages, each its own colour and height, with its own roof, door and chimney.
      const n = W >= 110 ? 3 : 2;
      const cw = W / n;
      for (let i = 0; i < n; i++) {
        const cu = -W / 2 + cw * (i + 0.5);
        const ch = h + [0, 5, 2][i % 3];
        const body: Body = { cu, cv: 0, hx: cw / 2, hz: D / 2 };
        put(paint(pick(TERRACE_WALLS, seed + i * 2)), rbox(cw - 0.6, ch, D, cu, ch / 2, 0, 2));
        const ends: [number, number] = [i === 0 ? OVERHANG : 0.3, i === n - 1 ? OVERHANG : 0.3];
        const rise = gable(body, true, ch, pick(ROOF_COLORS, opts.roof + i), 0.55, ends);
        chimney(cu + cw * 0.3, -D * 0.12, ch, ch + rise + 4);
        const flip = (seed + i) % 2 ? 1 : -1;
        doors.push(door(0, body, -flip * cw * 0.22, pick(DOOR_COLORS, seed + i)));
        const ww = Math.min(12, cw * 0.3);
        win(0, body, flip * cw * 0.22, 16, ww, 12);
        b.add(paint("#3c8f4e"), onFace(new RoundedBoxGeometry(ww + 4, 4, 4, 1, 1), 0, body, flip * cw * 0.22, 6, 3));
        b.add(paint(pick(FLOWER_COLORS, seed + i)), onFace(new RoundedBoxGeometry(ww, 2.5, 3, 1, 1), 0, body, flip * cw * 0.22, 9, 3));
        for (let f = 1; f < floors; f++) for (const s of [-1, 1]) win(0, body, s * cw * 0.22, 16 + f * FLOOR_H, ww, 12);
        for (let f = 0; f < floors; f++) win(2, body, 0, 16 + f * FLOOR_H, ww, 12);
      }
      break;
    }
  }
  return doors;
}

interface Body {
  cu: number;
  cv: number;
  hx: number;
  hz: number;
}

// ————————————————————————————————————————— Street furniture —————————————————————————————————————————

export type PropKind = "lamp" | "bench" | "planter" | "postbox" | "phone" | "busstop" | "fountain" | "statue";

/** A piece of street furniture: its centre on the mat, and its turn (authored facing +z, it faces the road). */
export interface Prop {
  kind: PropKind;
  x: number;
  z: number;
  yaw: number;
}

/** Half width along the kerb, depth across it, and whether it is tall enough to meet a shop awning. */
const PROP_SIZE: Record<PropKind, { half: number; depth: number; tall: boolean }> = {
  lamp: { half: 4, depth: 8, tall: true },
  bench: { half: 12, depth: 8, tall: false },
  planter: { half: 7.5, depth: 8, tall: false },
  postbox: { half: 4, depth: 8, tall: false },
  phone: { half: 8, depth: 16, tall: true },
  busstop: { half: 21, depth: 12, tall: true },
  fountain: { half: 14, depth: 28, tall: false },
  statue: { half: 8, depth: 16, tall: true },
};
/** Furniture keeps this far (mm) from any square outside the town (where track may run) and from the station. */
export const FURNITURE_CLEARANCE = 18;
/** ...and this far from a building's door. */
const DOOR_CLEARANCE = 12;
const KERB_OFFSETS = [-22, 22, -30, 30, -14, 14, 0];

interface Rect {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
}

/**
 * Street furniture for a town: along the pavement edges of its road squares where they meet its buildings (a lamp,
 * bench or planter backs onto a house wall and leaves the middle of the road open), never in front of a door, and
 * kept well clear of the station and of every square outside the town, so nothing stands where track can run. A
 * bigger town gets a fountain or statue tucked into a corner between two buildings. Its own random stream.
 */
export function townFurniture(land: Landscape, town: Town, doors: readonly Point[]): Prop[] {
  const { grid } = land;
  const own = new Set(town.cells);
  const r = rng((Math.imul(land.seed, 61) + town.id * 389 + 17) >>> 0);
  const at = (col: number, row: number) => (grid.inBounds(col, row) ? grid.index(col, row) : -1);
  const road = (i: number) => i >= 0 && own.has(i) && grid.surface[i] === SURF_ROAD && grid.feature[i] === FEAT_NONE;
  const house = (i: number) => i >= 0 && own.has(i) && grid.feature[i] === FEAT_BUILDING;
  const roads = town.cells.filter(road).sort((a, b) => a - b);
  const placed: Rect[] = [];
  const props: Prop[] = [];

  const overlaps = (a: Rect, b: Rect) => a.x0 < b.x1 && b.x0 < a.x1 && a.z0 < b.z1 && b.z0 < a.z1;
  const cellRect = (col: number, row: number): Rect => ({
    x0: grid.centreX(col) - CELL / 2,
    x1: grid.centreX(col) + CELL / 2,
    z0: grid.centreZ(row) - CELL / 2,
    z1: grid.centreZ(row) + CELL / 2,
  });
  const grow = (a: Rect, m: number): Rect => ({ x0: a.x0 - m, x1: a.x1 + m, z0: a.z0 - m, z1: a.z1 + m });
  const fits = (rc: Rect) => {
    const g = grow(rc, FURNITURE_CLEARANCE);
    for (let row = grid.rowAt(g.z0); row <= grid.rowAt(g.z1); row++) {
      for (let col = grid.colAt(g.x0); col <= grid.colAt(g.x1); col++) {
        const i = at(col, row);
        const cr = cellRect(col, row);
        // On our own road squares only; and nothing near the open country or the station.
        if (overlaps(rc, cr) && !road(i)) return false;
        if (i === -1 || !own.has(i) || grid.feature[i] === FEAT_STATION) if (overlaps(g, cr)) return false;
      }
    }
    const d = grow(rc, DOOR_CLEARANCE);
    if (doors.some((p) => p.x > d.x0 && p.x < d.x1 && p.z > d.z0 && p.z < d.z1)) return false;
    return !placed.some((p) => overlaps(grow(rc, 6), p));
  };

  // Kerb spots: the middle of each edge where a road square meets a building, with its normal into the road.
  const kerbs: { x: number; z: number; nx: number; nz: number }[] = [];
  const corners: { x: number; z: number; nx: number; nz: number }[] = [];
  for (const i of roads) {
    const col = grid.colOf(i);
    const row = grid.rowOf(i);
    const cx = grid.centreX(col);
    const cz = grid.centreZ(row);
    for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      if (house(at(col + dc, row + dr))) kerbs.push({ x: cx + (dc * CELL) / 2, z: cz + (dr * CELL) / 2, nx: -dc, nz: -dr });
    }
    for (const dc of [1, -1]) {
      for (const dr of [1, -1]) {
        if (house(at(col + dc, row)) && house(at(col, row + dr))) corners.push({ x: cx + (dc * CELL) / 2, z: cz + (dr * CELL) / 2, nx: -dc, nz: -dr });
      }
    }
  }
  const shuffled = <T,>(list: readonly T[]): T[] => {
    const out = [...list];
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(r() * (i + 1));
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  };
  const rectOf = (x: number, z: number, hx: number, hz: number): Rect => ({ x0: x - hx, x1: x + hx, z0: z - hz, z1: z + hz });
  const tryPlace = (kind: PropKind): boolean => {
    const { half, depth, tall } = PROP_SIZE[kind];
    const inset = (tall ? 9 : 4) + depth / 2;
    if (kind === "fountain" || kind === "statue") {
      // Tucked into the corner between two buildings, facing out across the road.
      for (const c of shuffled(corners)) {
        const x = c.x + c.nx * (4 + half);
        const z = c.z + c.nz * (4 + half);
        const rc = rectOf(x, z, half, half);
        if (!fits(rc)) continue;
        placed.push(rc);
        props.push({ kind, x, z, yaw: Math.atan2(c.nx, c.nz) });
        return true;
      }
    }
    for (const k of shuffled(kerbs)) {
      for (const a of KERB_OFFSETS) {
        // Along the kerb is perpendicular to its normal.
        const x = k.x + k.nx * inset + (k.nx === 0 ? a : 0);
        const z = k.z + k.nz * inset + (k.nx === 0 ? 0 : a);
        const rc = k.nx === 0 ? rectOf(x, z, half, depth / 2) : rectOf(x, z, depth / 2, half);
        if (!fits(rc)) continue;
        placed.push(rc);
        props.push({ kind, x, z, yaw: Math.atan2(k.nx, k.nz) });
        return true;
      }
    }
    return false;
  };

  const kinds: PropKind[] = [];
  if (town.buildings.length >= 6 || roads.length >= 8) kinds.push(r() < 0.5 ? "fountain" : "statue");
  if (r() < 0.6) kinds.push("busstop");
  if (r() < 0.5) kinds.push("phone");
  if (r() < 0.7) kinds.push("postbox");
  const benches = 1 + (r() < 0.5 ? 1 : 0);
  const planters = 1 + Math.floor(r() * 2);
  const lamps = 2 + Math.floor(r() * 3);
  for (let k = 0; k < Math.max(benches, planters, lamps); k++) {
    if (k < lamps) kinds.push("lamp");
    if (k < benches) kinds.push("bench");
    if (k < planters) kinds.push("planter");
  }
  for (const kind of kinds) tryPlace(kind);
  return props;
}

/** One piece of street furniture, drawn into the batch. */
export function furniture(b: Batcher, mats: Materials, p: Prop): void {
  // Each kind is a part (tools/blender/dressing.py), authored facing +z; a planter's flowers vary with where it stands.
  const seed = Math.round(Math.abs(p.x) + Math.abs(p.z));
  const flowers = Object.fromEntries([0, 1, 2, 3].map((k) => [`flower${k}`, pick(FLOWER_COLORS, seed + k)]));
  addPart(b, mats, p.kind, (g) => g.rotateY(p.yaw).translate(p.x, 0, p.z), flowers);
}

// ————————————————————————————————————————— Station staff and travellers —————————————————————————————————————————


/** A conductor in a maroon coat and peaked cap, holding a green flag out to the side (+x). */
export function conductor(b: Batcher, mats: Materials, put: (g: BufferGeometry) => BufferGeometry): void {
  addPart(b, mats, "conductor", put);
}

/** A porter in a brown coat and cap pushing a luggage barrow piled with cases; the barrow runs toward +x. */
export function porter(b: Batcher, mats: Materials, put: (g: BufferGeometry) => BufferGeometry): void {
  addPart(b, mats, "porter", put);
}

/** A traveller in a green coat and bowler hat with a brown suitcase at their side (+x). */
export function traveller(b: Batcher, mats: Materials, put: (g: BufferGeometry) => BufferGeometry): void {
  addPart(b, mats, "traveller", put);
}

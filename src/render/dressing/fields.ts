import { BoxGeometry, ConeGeometry, CylinderGeometry, ExtrudeGeometry, IcosahedronGeometry, Shape, SphereGeometry, type BufferGeometry } from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { rng } from "../../lib/rng";
import { CELL, COLS, type Field, type FieldStock, type Landscape } from "../../landscape";
import type { Materials } from "../materials";
import type { Batcher } from "./batcher";

const POST_H = 16;
const POST_STEP = 36;
const INSET = 5;
/** The gap left in the fence or wall for a gate, centred on its side. */
const GATE_GAP = 26;

type Place = (g: BufferGeometry) => BufferGeometry;
type Add = (color: string | null, geo: BufferGeometry) => void;

/** Roughly how far each animal reaches from its centre, and how far apart two of them stand. */
const REACH: Record<Exclude<FieldStock, "crops">, { reach: number; apart: number; count: [number, number] }> = {
  cow: { reach: 24, apart: 34, count: [2, 3] },
  sheep: { reach: 18, apart: 28, count: [3, 4] },
  pig: { reach: 20, apart: 30, count: [2, 3] },
  horse: { reach: 28, apart: 40, count: [2, 2] },
  chicken: { reach: 9, apart: 15, count: [5, 7] },
};

/** The kinds of field dressing, as chosen for one paddock (all derived from the map seed and the field's id). */
export interface FieldDressing {
  wall: boolean;
  /** The side (0 top, 1 right, 2 bottom, 3 left) with a gate in it, or -1. */
  gateSide: number;
  /** What stands in each corner (top-left, top-right, bottom-right, bottom-left). */
  corners: ("hay" | "haystack" | "trough" | "hives" | "coop" | "barn" | null)[];
  crop: "wheat" | "greens";
}

/** Picks a paddock's dressing from its own random stream (no draws from the landscape generator's sequence). */
export function fieldDressing(seed: number, field: Field): FieldDressing {
  const d = rng(seed * 43 + field.id * 13 + 2);
  const wall = d() < 0.4;
  const gateSide = d() < 0.6 ? Math.floor(d() * 4) : -1;
  const crop = d() < 0.5 ? "wheat" : "greens";
  const props: FieldDressing["corners"] = [];
  if (field.animal === "chicken") props.push("coop");
  // About half the other fields have a red barn in a corner.
  else if (d() < 0.5) props.push("barn");
  const extras: ("hay" | "haystack" | "trough" | "hives")[] = [d() < 0.5 ? "hay" : "haystack", "hives"];
  if (field.animal !== "crops" && field.animal !== "chicken") extras.push("trough", "trough");
  for (let i = extras.length - 1; i > 0; i--) {
    const j = Math.floor(d() * (i + 1));
    [extras[i], extras[j]] = [extras[j], extras[i]];
  }
  const building = props.length;
  const want = building ? Math.floor(d() * 2) : 1 + Math.floor(d() * 2);
  for (const e of extras) if (props.length < want + building && !props.includes(e)) props.push(e);
  const corners: FieldDressing["corners"] = [null, null, null, null];
  const start = Math.floor(d() * 4);
  props.forEach((p, k) => (corners[(start + k * 2 + (k >= 2 ? 1 : 0)) % 4] = p));
  return { wall, gateSide, corners, crop };
}

/**
 * A paddock: a beech post-and-rail fence or a dry stone wall round its edge (sometimes with a gate), a few toy animals
 * (cows, sheep, pigs by a mud puddle, horses, or hens round their coop) or rows of crops with a scarecrow, and hay,
 * a trough or beehives in its corners. Everything stays inside its 2 × 2 squares.
 */
export function buildField(land: Landscape, field: Field, mats: Materials, b: Batcher): void {
  const g = land.grid;
  const first = field.cells[0];
  const col = first % COLS;
  const row = (first - col) / COLS;
  const x0 = g.centreX(col) - CELL / 2 + INSET;
  const z0 = g.centreZ(row) - CELL / 2 + INSET;
  const size = CELL * 2 - INSET * 2;
  const y = g.groundY(first);
  const add: Add = (color, geo) => b.add(color ? mats.lacquer(color) : mats.naturalWood, geo);
  /** Places geometry built at the origin at (x, z) in the field's own frame (0..size from its fence corner). */
  const at = (x: number, z: number, yaw = 0): Place => (geo) => geo.rotateY(yaw).translate(x0 + x, y, z0 + z);

  const dress = fieldDressing(land.seed, field);
  const d = rng(land.seed * 47 + field.id * 17 + 3);

  // Boundary: four sides, each a fence or wall from corner to corner with an optional gate gap in the middle.
  const sides: [number, number, number, number][] = [[0, 0, size, 0], [size, 0, size, size], [size, size, 0, size], [0, size, 0, 0]];
  sides.forEach(([ax, az, bx, bz], s) => {
    const yaw = -Math.atan2(bz - az, bx - ax);
    const ux = (bx - ax) / size;
    const uz = (bz - az) / size;
    const along = (t: number) => at(ax + ux * t, az + uz * t, yaw);
    const gate = s === dress.gateSide;
    const gapA = (size - GATE_GAP) / 2;
    const gapB = (size + GATE_GAP) / 2;
    const runs: [number, number][] = gate ? [[0, gapA], [gapB, size]] : [[0, size]];
    if (dress.wall) {
      for (const [t0, t1] of runs) stoneWall(add, d, along, t0 - (t0 === 0 ? 3.5 : 0), t1 + (t1 === size ? 3.5 : 0));
      if (gate) for (const t of [gapA - 1, gapB + 1]) add("#8f8c84", along(t)(new BoxGeometry(7, 17, 8).translate(0, 8.5, 0)));
    } else {
      const steps = Math.round(size / POST_STEP);
      for (let k = 0; k < steps; k++) {
        const t = (k / steps) * size;
        if (gate && t > gapA - 4 && t < gapB + 4) continue;
        add(null, along(t)(new CylinderGeometry(1.6, 1.8, POST_H, 8).translate(0, POST_H / 2, 0)));
      }
      for (const [t0, t1] of runs) {
        for (const h of [6, 12]) add(null, along((t0 + t1) / 2)(new RoundedBoxGeometry(t1 - t0, 2, 1.6, 1, 0.6).translate(0, h, 0)));
      }
      if (gate) for (const t of [gapA, gapB]) add(null, along(t)(new CylinderGeometry(2.2, 2.4, POST_H + 3, 8).translate(0, (POST_H + 3) / 2, 0)));
    }
    if (gate) fieldGate(add, along(size / 2), GATE_GAP - (dress.wall ? 9 : 5));
  });

  // Things in the corners, built in a frame with the fences along +x and +z from the corner.
  const occupied: { x: number; z: number; r: number }[] = [];
  const cornerAt = [[0, 0, 0], [size, 0, -Math.PI / 2], [size, size, Math.PI], [0, size, Math.PI / 2]];
  dress.corners.forEach((prop, i) => {
    if (!prop) return;
    const [cx, cz, yaw] = cornerAt[i];
    const place = at(cx, cz, yaw);
    const local = (u: number, v: number) => ({ x: cx + u * Math.cos(yaw) + v * Math.sin(yaw), z: cz - u * Math.sin(yaw) + v * Math.cos(yaw) });
    if (prop === "hay") hayBales(add, place);
    else if (prop === "haystack") haystack(add, place);
    else if (prop === "trough") trough(add, place);
    else if (prop === "hives") beehives(add, place, d);
    else if (prop === "barn") barn(add, place);
    else coop(add, place);
    occupied.push(prop === "barn" ? { ...local(26, 22), r: 32 } : { ...local(20, 18), r: prop === "hives" || prop === "trough" ? 16 : 22 });
  });

  if (field.animal === "crops") {
    crops(add, at, size, dress.crop, d() < 0.5, occupied);
    scarecrow(add, at(size / 2, size / 2, d() * Math.PI * 2), d() < 0.5 ? "#c8402f" : "#3d6fb6");
    return;
  }

  // Pigs have a mud puddle to wallow in, somewhere in the middle.
  const spec = REACH[field.animal];
  const spots: { x: number; z: number }[] = [];
  if (field.animal === "pig") {
    const px = 44 + d() * (size - 88);
    const pz = 44 + d() * (size - 88);
    mudPuddle(add, at(px, pz, d() * Math.PI), d);
    spots.push({ x: px, z: pz });
  }

  // Animals, spread out and facing every which way, clear of the props.
  const r = rng(land.seed * 41 + field.id * 7 + 1);
  const [lo, hi] = spec.count;
  const count = lo + Math.floor(r() * (hi - lo + 1));
  const margin = spec.reach + 2;
  for (let tries = 0; tries < 60 && spots.length < count; tries++) {
    const x = margin + r() * (size - margin * 2);
    const z = margin + r() * (size - margin * 2);
    if (spots.some((s) => Math.hypot(s.x - x, s.z - z) < spec.apart)) continue;
    if (occupied.some((o) => Math.hypot(o.x - x, o.z - z) < o.r + spec.reach * 0.7)) continue;
    spots.push({ x, z });
  }
  for (const s of spots) {
    const place = at(s.x, s.z, r() * Math.PI * 2);
    if (field.animal === "cow") cow(add, place);
    else if (field.animal === "sheep") sheep(add, place);
    else if (field.animal === "pig") pig(add, place);
    else if (field.animal === "horse") horse(add, place, HORSE_COATS[Math.floor(r() * HORSE_COATS.length)]);
    else chicken(add, place, (["#f6f1e6", "#a85a2a", "#5a3a2a"] as const)[Math.floor(r() * 3)]);
  }
}

// ——— Boundaries ———

const HORSE_COATS = ["#9a5a2e", "#6b3b1e", "#2a2b2e"];
const STONES = ["#9a9a92", "#b4b2a8", "#85857e", "#a7a196"];

/** A dry stone wall from `t0` to `t1` along a side: three courses of chunky grey stones, staggered. */
function stoneWall(add: Add, d: () => number, along: (t: number) => Place, t0: number, t1: number): void {
  const courses: [number, number, number][] = [[0, 5, 7.5], [5, 4.5, 6.5], [9.5, 3.5, 5.5]];
  courses.forEach(([base, h, depth], c) => {
    let t = t0;
    let first = c % 2 === 1;
    while (t < t1 - 0.5) {
      let len = first ? 5 + d() * 4 : 8 + d() * 6;
      first = false;
      if (t1 - (t + len) < 5) len = t1 - t;
      const hh = h * (0.9 + d() * 0.2);
      const dd = depth * (0.92 + d() * 0.1);
      add(STONES[Math.floor(d() * STONES.length)], along(t + len / 2)(new BoxGeometry(len - 0.6, hh, dd).translate(0, base + hh / 2, (d() - 0.5) * 0.6)));
      t += len;
    }
  });
}

/** A white five-bar field gate (closed), built along +x and centred on the origin. */
function fieldGate(add: Add, place: Place, len: number): void {
  const white = "#f3ead8";
  for (const h of [3, 6, 9, 12]) add(white, place(new BoxGeometry(len, 1.4, 1.1).translate(0, h, 0)));
  for (const x of [-len / 2, len / 2]) add(white, place(new BoxGeometry(1.8, 12, 1.3).translate(x, 8, 0)));
  const brace = new BoxGeometry(Math.hypot(len, 9), 1.3, 1);
  brace.rotateZ(Math.atan2(9, len)).translate(0, 7.5, 0.4);
  add(white, place(brace));
}

// ——— Corner props (fences along +x and +z from the corner at the origin) ———

const HAY = "#e2bd55";

/** Three round hay bales, two lying side by side and one stood on end. */
function hayBales(add: Add, place: Place): void {
  for (const [x, z] of [[14, 12], [30, 12]]) {
    add(HAY, place(new CylinderGeometry(6.5, 6.5, 10, 14).rotateX(Math.PI / 2).translate(x, 6.5, z)));
    add("#c99a3a", place(new CylinderGeometry(6.6, 6.6, 1.2, 14).rotateX(Math.PI / 2).translate(x, 6.5, z)));
  }
  add(HAY, place(new CylinderGeometry(6.5, 6.5, 10, 14).translate(14, 5, 28)));
  add("#c99a3a", place(new CylinderGeometry(6.6, 6.6, 1.2, 14).translate(14, 5, 28)));
}

/** A round haystack with a thatched dome top. */
function haystack(add: Add, place: Place): void {
  add(HAY, place(new CylinderGeometry(11, 12, 10, 16).translate(18, 5, 18)));
  add(HAY, place(new SphereGeometry(11, 16, 6, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 1.3, 1).translate(18, 10, 18)));
  add("#c99a3a", place(new CylinderGeometry(11.3, 11.6, 1.4, 16).translate(18, 8, 18)));
  add("#c99a3a", place(new ConeGeometry(2, 4, 8).translate(18, 26, 18)));
}

/** A beech water trough on two little feet, full to the brim. */
function trough(add: Add, place: Place): void {
  for (const x of [14, 34]) add(null, place(new BoxGeometry(2, 2.5, 10).translate(x, 1.25, 12)));
  add(null, place(new RoundedBoxGeometry(28, 7, 9, 1, 1.2).translate(24, 6, 12)));
  add("#4a90c8", place(new BoxGeometry(25, 0.6, 6.4).translate(24, 9.4, 12)));
}

/** Two or three beehives in a row along the fence: white stepped boxes with a pitched lid. */
function beehives(add: Add, place: Place, d: () => number): void {
  const n = 2 + Math.floor(d() * 2);
  for (let k = 0; k < n; k++) {
    const x = 11 + k * 13;
    const body = k === 1 ? "#f0c64a" : "#f6f1e6";
    add(null, place(new BoxGeometry(8, 2, 8).translate(x, 1, 10)));
    add(body, place(new RoundedBoxGeometry(9, 5, 9, 1, 0.8).translate(x, 4.5, 10)));
    add(body, place(new RoundedBoxGeometry(10, 4.5, 10, 1, 0.8).translate(x, 9.25, 10)));
    add("#c8402f", place(new ConeGeometry(8, 4, 4).rotateY(Math.PI / 4).translate(x, 13.5, 10)));
    add("#2a2b2e", place(new BoxGeometry(4, 0.8, 0.4).translate(x, 3, 14.6)));
  }
}

/** A little red henhouse on legs, with a pitched beech roof and a ramp down from its door. */
function coop(add: Add, place: Place): void {
  const red = "#c8402f";
  const [cx, cz] = [18, 14];
  for (const [lx, lz] of [[-9, -6], [-9, 6], [9, -6], [9, 6]]) add(null, place(new BoxGeometry(1.8, 4, 1.8).translate(cx + lx, 2, cz + lz)));
  add(red, place(new RoundedBoxGeometry(22, 11, 15, 1, 1).translate(cx, 9.5, cz)));
  // Gable ends under the roof.
  add(red, place(new CylinderGeometry(1, 1, 21.6, 3).rotateZ(Math.PI / 2).rotateX(-Math.PI / 2).scale(1, 2.67, 7.8).translate(cx, 16.33, cz)));
  for (const s of [-1, 1]) {
    const slope = new BoxGeometry(25, 1.2, 10);
    slope.translate(0, 0, s * 4.6).rotateX(s * 0.55).translate(cx, 19.2, cz);
    add(null, place(slope));
  }
  add("#2a2b2e", place(new BoxGeometry(5, 6, 0.5).translate(cx + 4, 8, cz + 7.6)));
  const ramp = new BoxGeometry(5, 0.8, 12);
  ramp.rotateX(0.55).translate(cx + 4, 2.6, cz + 12.5);
  add(null, place(ramp));
}

/**
 * A red barn in the corner: plank walls with white trim, a gambrel roof, big X-braced doors facing into the field
 * and a hay loft door above them.
 */
function barn(add: Add, place: Place): void {
  const red = "#b8432f";
  const white = "#f6f1e6";
  const [cx, cz] = [26, 20];
  const [w, d, h] = [42, 28, 22];
  add(red, place(new RoundedBoxGeometry(w, h, d, 1, 1.2).translate(cx, h / 2, cz)));
  // Gambrel roof: steep lower slopes, shallow upper ones; its outline extruded along the barn.
  const half = d / 2 + 2;
  const roof = new Shape();
  roof.moveTo(-half, 0);
  roof.lineTo(-half + 4, 9);
  roof.lineTo(0, 15);
  roof.lineTo(half - 4, 9);
  roof.lineTo(half, 0);
  roof.lineTo(-half, 0);
  const roofGeo = new ExtrudeGeometry(roof, { depth: w + 4, bevelEnabled: true, bevelSize: 0.8, bevelThickness: 0.8, bevelSegments: 1 });
  roofGeo.translate(0, 0, -(w + 4) / 2).rotateY(Math.PI / 2).translate(cx, h - 0.5, cz);
  add("#5a5d63", place(roofGeo));
  // Gable ends in red under the roof, with a round loft window.
  for (const s of [-1, 1]) {
    const gable = new ExtrudeGeometry(roof, { depth: 1, bevelEnabled: false });
    gable.scale(0.92, 0.92, 1).rotateY(Math.PI / 2).translate(cx + s * (w / 2 - 0.5), h - 0.5, cz);
    add(red, place(gable));
  }
  // Doors on the side facing the field (+z): two leaves with white frames and X braces.
  const face = cz + d / 2 + 0.4;
  add(white, place(new BoxGeometry(20, 17, 0.8).translate(cx, 8.5, face)));
  for (const lx of [-5, 5]) {
    add(red, place(new BoxGeometry(8.4, 15, 1).translate(cx + lx, 8, face + 0.3)));
    for (const r of [0.95, -0.95]) add(white, place(new BoxGeometry(1.2, 16, 0.6).rotateZ(r * 0.52).translate(cx + lx, 8, face + 0.9)));
  }
  // Loft door and the white trim along the eaves and corners.
  add(white, place(new BoxGeometry(9, 7, 0.8).translate(cx, h + 5, face - 2.6)));
  add(red, place(new BoxGeometry(7, 5, 1).translate(cx, h + 5, face - 2.2)));
  for (const lx of [-w / 2, w / 2]) for (const lz of [-d / 2, d / 2]) add(white, place(new BoxGeometry(1.6, h, 1.6).translate(cx + lx, h / 2, cz + lz)));
}

// ——— Middle-of-the-field things ———

/** A brown mud puddle: a flat disc of glossy mud with a couple of splashes beside it. */
function mudPuddle(add: Add, place: Place, d: () => number): void {
  const mud = "#6b4a2b";
  add(mud, place(new CylinderGeometry(15, 15, 0.8, 20).scale(1.2, 1, 0.85).translate(0, 0.4, 0)));
  for (let k = 0; k < 2; k++) {
    const a = d() * Math.PI * 2;
    add(mud, place(new CylinderGeometry(4, 4, 0.7, 12).translate(Math.cos(a) * 20, 0.35, Math.sin(a) * 15)));
  }
}

/** Rows of crops on brown soil ridges: yellow wheat tufts or round green cabbages, clear of the corner props. */
function crops(add: Add, at: (x: number, z: number, yaw?: number) => Place, size: number, kind: "wheat" | "greens", acrossZ: boolean, occupied: { x: number; z: number; r: number }[]): void {
  const pos = (u: number, v: number) => (acrossZ ? { x: v, z: u } : { x: u, z: v });
  const middle = size / 2;
  const clear = (x: number, z: number) => Math.hypot(x - middle, z - middle) > 12 && !occupied.some((o) => Math.hypot(o.x - x, o.z - z) < o.r + 4);
  const tuft = kind === "wheat" ? new ConeGeometry(2, 7.5, 6) : new IcosahedronGeometry(3.4, 0);
  for (let v = 14; v <= size - 14; v += 15) {
    // The soil ridge, broken where something stands in the way.
    let start = -1;
    const flush = (u1: number) => {
      if (start < 0) return;
      const { x, z } = pos((start + u1) / 2, v);
      add("#8a5a32", at(x, z, acrossZ ? Math.PI / 2 : 0)(new RoundedBoxGeometry(u1 - start, 1.6, 8, 1, 0.6)));
      start = -1;
    };
    for (let k = 0, u = 12; u <= size - 12; k++, u += 10) {
      const { x, z } = pos(u, v);
      if (!clear(x, z)) {
        flush(u - 5);
        continue;
      }
      if (start < 0) start = u - 5;
      if (kind === "wheat") add(k % 2 ? "#e6c25a" : "#d9b03e", at(x, z)(tuft.clone().translate(0, 4.6, 0)));
      else add(k % 2 ? "#5aa04a" : "#78b85a", at(x, z)(tuft.clone().scale(1, 0.85, 1).translate(0, 3.6, 0)));
    }
    flush(size - 7);
  }
  tuft.dispose();
}

/** A scarecrow on a pole: arms out, a coloured shirt, a burlap head and a black hat, straw at the cuffs. */
function scarecrow(add: Add, place: Place, shirt: string): void {
  add(null, place(new CylinderGeometry(1.1, 1.3, 26, 8).translate(0, 13, 0)));
  add(null, place(new BoxGeometry(1.6, 1.6, 26).translate(0, 22, 0)));
  add(shirt, place(new RoundedBoxGeometry(5, 10, 9, 1, 1.4).translate(0, 19, 0)));
  for (const s of [-1, 1]) {
    add(shirt, place(new BoxGeometry(3, 3, 7).translate(0, 22, s * 7)));
    add(HAY, place(new ConeGeometry(1.6, 3, 6).rotateX(-s * Math.PI / 2).translate(0, 22, s * 12)));
  }
  add("#e2c48a", place(new SphereGeometry(3.6, 12, 8).translate(0, 27.5, 0)));
  add("#2a2b2e", place(new CylinderGeometry(5.5, 5.5, 0.8, 14).translate(0, 30.5, 0)));
  add("#2a2b2e", place(new CylinderGeometry(2.8, 3.2, 4, 12).translate(0, 32.8, 0)));
  add(HAY, place(new ConeGeometry(3, 4, 6).rotateX(Math.PI).translate(0, 13, 0)));
}

// ——— Animals (facing +x, standing on y = 0) ———

/** A chunky toy cow, about 34 mm long: white body with a black saddle patch, pink muzzle. */
function cow(add: Add, place: Place): void {
  for (const [lx, lz] of [[-8, -4.5], [-8, 4.5], [8, -4.5], [8, 4.5]]) add(null, place(new CylinderGeometry(1.7, 1.7, 8, 8).translate(lx, 4, lz)));
  add("#f6f1e6", place(new RoundedBoxGeometry(26, 12, 13, 2, 3).translate(0, 13, 0)));
  add("#2a2b2e", place(new RoundedBoxGeometry(10, 2, 13.6, 1, 1).translate(-2, 18.6, 0)));
  add("#f6f1e6", place(new RoundedBoxGeometry(9, 9, 9, 2, 2.5).translate(16, 17, 0)));
  add("#e9a3a8", place(new RoundedBoxGeometry(3, 5, 7, 1, 1.2).translate(21, 15, 0)));
  for (const lz of [-3.5, 3.5]) add("#e6b52c", place(new CylinderGeometry(0.8, 1.1, 4, 6).translate(15, 23, lz)));
}

/** A fluffy toy sheep: cream wool of beads over a body, black face and legs. */
function sheep(add: Add, place: Place): void {
  for (const [lx, lz] of [[-6, -4], [-6, 4], [6, -4], [6, 4]]) add("#2a2b2e", place(new CylinderGeometry(1.5, 1.5, 7, 8).translate(lx, 3.5, lz)));
  add("#f3ead8", place(new RoundedBoxGeometry(20, 11, 13, 2, 4.5).translate(0, 12, 0)));
  for (const [lx, lz] of [[-5, -3], [0, 3], [5, -2], [-4, 3.5], [4, 3]]) add("#f3ead8", place(new SphereGeometry(4.2, 10, 8).translate(lx, 17, lz)));
  add("#2a2b2e", place(new RoundedBoxGeometry(8, 8, 7, 2, 2.2).translate(12, 15, 0)));
}

/** A round pink pig with a big snout, triangle ears and a curly tail. */
function pig(add: Add, place: Place): void {
  const pink = "#f2a7b8";
  for (const [lx, lz] of [[-6.5, -4], [-6.5, 4], [6.5, -4], [6.5, 4]]) add(pink, place(new CylinderGeometry(1.9, 1.9, 6, 8).translate(lx, 3, lz)));
  add(pink, place(new RoundedBoxGeometry(21, 11, 12, 2, 4.5).translate(0, 10.5, 0)));
  add(pink, place(new SphereGeometry(5.2, 12, 8).translate(11.5, 12, 0)));
  add("#d9768f", place(new CylinderGeometry(2.6, 2.6, 3, 12).rotateZ(Math.PI / 2).translate(17, 11, 0)));
  for (const s of [-1, 1]) {
    add(pink, place(new ConeGeometry(1.8, 3.6, 4).rotateX(s * 0.5).translate(11, 17.4, s * 3)));
    add("#2a2b2e", place(new SphereGeometry(0.6, 6, 4).translate(15.4, 13.6, s * 2)));
  }
  add(pink, place(new CylinderGeometry(0.6, 0.6, 3, 6).rotateZ(1.1).translate(-11.6, 13, 0)));
  add(pink, place(new SphereGeometry(1, 6, 4).translate(-12.8, 14.6, 0)));
}

/** A tall toy horse: long legs with black hooves, an arched neck with a mane, and a swishing tail. */
function horse(add: Add, place: Place, coat: string): void {
  const mane = coat === "#2a2b2e" ? "#e8dcc0" : "#2a2b2e";
  for (const [lx, lz] of [[-10, -3.4], [-10, 3.4], [10, -3.4], [10, 3.4]]) {
    add(coat, place(new CylinderGeometry(1.8, 1.6, 15, 8).translate(lx, 8.5, lz)));
    add("#2a2b2e", place(new CylinderGeometry(2, 2, 1.8, 8).translate(lx, 0.9, lz)));
  }
  add(coat, place(new RoundedBoxGeometry(28, 11, 10, 2, 4).translate(0, 20.5, 0)));
  add(coat, place(new RoundedBoxGeometry(6.5, 14, 5.5, 1, 2).rotateZ(-0.45).translate(14.5, 28, 0)));
  add(coat, place(new RoundedBoxGeometry(11, 5, 5.2, 1, 2).rotateZ(-0.6).translate(20, 32.5, 0)));
  add(mane, place(new BoxGeometry(2.2, 14, 1.8).rotateZ(-0.45).translate(11.8, 30, 0)));
  for (const s of [-1, 1]) {
    add(coat, place(new ConeGeometry(1, 3, 4).translate(17, 37.4, s * 1.5)));
    add("#2a2b2e", place(new SphereGeometry(0.6, 6, 4).translate(20.5, 34.6, s * 2.6)));
  }
  add(mane, place(new CylinderGeometry(1.2, 1.9, 13, 8).rotateZ(-0.25).translate(-15.5, 16, 0)));
}

/** A small hen: an egg-shaped body, a perky tail, red comb and a yellow beak, on two orange legs. */
function chicken(add: Add, place: Place, body: string): void {
  for (const s of [-1, 1]) add("#e88a2a", place(new CylinderGeometry(0.45, 0.45, 3.4, 5).translate(0, 1.7, s * 1.4)));
  add(body, place(new SphereGeometry(4, 10, 8).scale(1.25, 0.9, 0.95).translate(0, 6.2, 0)));
  add(body, place(new ConeGeometry(2.4, 5, 6).rotateZ(0.7).translate(-4.4, 8.8, 0)));
  add(body, place(new SphereGeometry(2.3, 8, 6).translate(3.8, 10.2, 0)));
  add("#d23a2e", place(new BoxGeometry(2.6, 1.8, 0.8).translate(3.6, 12.6, 0)));
  add("#f0c64a", place(new ConeGeometry(0.9, 2.2, 5).rotateZ(-Math.PI / 2).translate(6.6, 10, 0)));
}

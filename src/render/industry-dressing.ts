import { BoxGeometry, CylinderGeometry, DodecahedronGeometry, SphereGeometry, type BufferGeometry, type Material } from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import type { CargoKind, DepotRole } from "../economy";
import type { Materials } from "./materials";

/**
 * What makes each industry's yard its own: the ground it stands on (straw, cobbles, gravel, a plank deck) and a few
 * props telling what goes on there. All static, batched with the depot's other static parts (lacquer of any colour
 * shares one draw call), so it costs vertices once and nothing per frame.
 *
 * Coordinates are depot coordinates (see depot-view.ts): `t` along the track from its socket end, `l` across (yard
 * side +), `y` up from the ground. The pad spans t 10–206, l 30–114.
 */

/** Adds one part: geometry in depot-local axes (centred), placed at t, l, y. */
export type PlaceFn = (material: Material, geometry: BufferGeometry, t: number, l: number, y: number) => void;

/** The pad's top. */
export const PAD_H = 4;
/** A pile's pallet: its piles stand on it. */
export const PALLET_H = 2.5;

/** Each industry's ground (the pad's colour), for those that have their own. */
export const YARD_GROUND: Partial<Record<DepotRole, string>> = {
  farm: "#e6c27a",
  mill: "#d8cfbf",
  quarry: "#b8b1a4",
};

/** Each good's colour on its pallet's rim: a pile's place reads even when it's empty. */
export const PILE_TAG: Record<CargoKind, string> = {
  log: "#3c8f4e",
  planks: "#c8442f",
  grain: "#e0a526",
  flour: "#2f6db5",
  stone: "#6f747b",
  coal: "#2a2b2e",
  ore: "#9a4f2c",
  iron: "#5f7a96",
  furniture: "#a0612e",
  tools: "#c8442f",
};

const PAD = { t: 108, l: 72, w: 196, d: 84 };

/** A pallet under a pile: a low beech board with a painted rim, `len` along t and `wide` along l. */
export function pallet(add: PlaceFn, mats: Materials, kind: CargoKind, t: number, l: number, len: number, wide: number): void {
  const y = PAD_H + PALLET_H / 2;
  add(mats.naturalWood, new RoundedBoxGeometry(len, PALLET_H, wide, 1, 0.6), t, l, y);
  const rim = mats.lacquer(PILE_TAG[kind]);
  for (const s of [-1, 1]) {
    add(rim, new BoxGeometry(len + 2, PALLET_H + 1, 1.4), t, l + (s * (wide + 0.6)) / 2, y + 0.5);
    add(rim, new BoxGeometry(1.4, PALLET_H + 1, wide + 2), t + (s * (len + 0.6)) / 2, l, y + 0.5);
  }
}

/** Dress an industry's yard. Returns true if it drew its own ground (so the plain pad isn't wanted). */
export function dressIndustry(role: DepotRole, add: PlaceFn, mats: Materials): boolean {
  switch (role) {
    case "farm":
      farm(add, mats);
      return true;
    case "mill":
      mill(add, mats);
      return true;
    case "quarry":
      quarry(add, mats);
      return true;
    case "warehouse":
      warehouse(add, mats);
      return true;
    default:
      return false;
  }
}

function ground(add: PlaceFn, color: string, mats: Materials): void {
  add(mats.lacquer(color), new RoundedBoxGeometry(PAD.w, PAD_H, PAD.d, 2, 1.5), PAD.t, PAD.l, PAD_H / 2);
}

/** The farm yard: straw ground, a vegetable patch with a scarecrow at the near end, hay bales, a fence at the back. */
function farm(add: PlaceFn, mats: Materials): void {
  ground(add, YARD_GROUND.farm!, mats);
  // The patch: ridges of earth along the track, a row of leafy heads on each.
  const soil = mats.lacquer("#8a5a33");
  const leaf = [mats.lacquer("#5fae3c"), mats.lacquer("#7cc04a")];
  const head = new SphereGeometry(4.2, 8, 6).scale(1, 0.8, 1);
  for (const [i, l] of [52, 66, 80, 94].entries()) {
    add(soil, new RoundedBoxGeometry(58, 4, 9, 1, 1.8), 47, l, PAD_H + 2);
    for (let k = 0; k < 5; k++) add(leaf[(i + k) % 2], head.clone(), 23 + k * 12 + (i % 2) * 3, l, PAD_H + 6.5);
  }
  // A scarecrow between the middle rows: a post, arms, a straw head and a red hat.
  const pole = mats.naturalWood;
  add(pole, new CylinderGeometry(1, 1, 30, 6), 58, 73, PAD_H + 15);
  add(mats.lacquer("#2f6db5"), new RoundedBoxGeometry(3, 2.4, 22, 1, 0.8), 58, 73, PAD_H + 22);
  add(mats.lacquer("#2f6db5"), new RoundedBoxGeometry(5, 10, 7, 1, 1.5), 58, 73, PAD_H + 19);
  add(mats.lacquer("#e6c27a"), new SphereGeometry(3.4, 10, 8), 58, 73, PAD_H + 28.5);
  add(mats.lacquer("#c8442f"), new CylinderGeometry(2.4, 5, 3, 12), 58, 73, PAD_H + 32);
  // Hay bales by the barn, two lying and one on top.
  const hay = mats.lacquer("#e3b850");
  const bale = () => new CylinderGeometry(6, 6, 11, 14).rotateX(Math.PI / 2);
  add(hay, bale(), 132, 102, PAD_H + 6);
  add(hay, bale(), 132, 90, PAD_H + 6);
  add(hay, bale(), 132, 96, PAD_H + 16);
  // A fence along the back of the yard.
  fence(add, mats.lacquer("#f0ebe0"), 12, 204, 111);
}

/** A post-and-rail fence along t from t0 to t1 at l. */
function fence(add: PlaceFn, paint: Material, t0: number, t1: number, l: number): void {
  const n = Math.round((t1 - t0) / 24);
  for (let k = 0; k <= n; k++) add(paint, new BoxGeometry(2.4, 12, 2.4), t0 + ((t1 - t0) * k) / n, l, PAD_H + 6);
  for (const y of [5, 10]) add(paint, new BoxGeometry(t1 - t0, 1.6, 1.2), (t0 + t1) / 2, l, PAD_H + y);
}

/** The mill: pale ground, a flagstone path, a ring of grass and flowers round the windmill, sacks waiting by its door. */
function mill(add: PlaceFn, mats: Materials): void {
  ground(add, YARD_GROUND.mill!, mats);
  // A path of flagstones from the track to the windmill's door (it faces the track, at t 160).
  const slabs = [mats.lacquer("#c9bfac"), mats.lacquer("#e4dccd")];
  for (let k = 0; k < 3; k++) add(slabs[k % 2], new RoundedBoxGeometry(12, 1, 8, 1, 0.5), 160 + (k % 2 ? 2 : -2), 36 + k * 10, PAD_H + 0.3);
  // Grass round the windmill's foot (its tower stands at t 160, l 86), with flowers.
  add(mats.lacquer("#6dae45"), new CylinderGeometry(27, 27, 1.6, 28), 160, 86, PAD_H + 0.6);
  const bloom = new SphereGeometry(2, 6, 5);
  const colours = ["#e35a8c", "#f2d03b", "#ffffff", "#c8442f"].map((c) => mats.lacquer(c));
  for (let k = 0; k < 12; k++) {
    const a = (k / 12) * Math.PI * 2 + 0.3;
    // Not in front of the door (it faces the track, −l).
    if (Math.abs(a - (3 * Math.PI) / 2) < 0.45) continue;
    add(colours[k % 4], bloom.clone(), 160 + Math.cos(a) * 25, 86 + Math.sin(a) * 25, PAD_H + 2.6);
  }
  // Flour sacks stacked by the door, ready for the crane.
  const sack = mats.lacquer("#f1ebdd");
  const sackG = () => new RoundedBoxGeometry(14, 6, 9, 2, 2.4);
  for (const [t, l, y] of [[130, 60, 3], [130, 70, 3], [131, 65, 9]] as const) add(sack, sackG(), t, l, PAD_H + y);
  // A little barrow by them.
  barrow(add, mats, 190, 58);
}

/** A wheelbarrow at t, l, handles toward +t. */
function barrow(add: PlaceFn, mats: Materials, t: number, l: number): void {
  add(mats.lacquer("#2f6db5"), new RoundedBoxGeometry(14, 6, 10, 1, 1.5), t, l, PAD_H + 7);
  add(mats.lacquer("#c8442f"), new CylinderGeometry(3.6, 3.6, 2.4, 12).rotateX(Math.PI / 2), t - 8, l, PAD_H + 3.6);
  for (const s of [-1, 1]) add(mats.naturalWood, new BoxGeometry(14, 1.4, 1.4), t + 8, l + s * 4, PAD_H + 6);
}

/** The quarry: grey gravel, chips of rock lying about, and a tub wagon on a stub of narrow rails. */
function quarry(add: PlaceFn, mats: Materials): void {
  ground(add, YARD_GROUND.quarry!, mats);
  // Rubble: chips of three greys, scattered where nothing else stands.
  const greys = ["#9d9a92", "#c6c3ba", "#85827b"].map((c) => mats.lacquer(c));
  const chips: [number, number, number][] = [
    [18, 40, 3], [26, 52, 2.4], [70, 108, 3.4], [84, 104, 2.4], [150, 40, 2.8], [164, 52, 3.6], [178, 44, 2.4], [196, 44, 3],
    [60, 98, 2.2], [140, 48, 2.2], [200, 86, 2.6], [118, 106, 2.4],
  ];
  chips.forEach(([t, l, r], k) => add(greys[k % 3], new DodecahedronGeometry(r, 0).rotateY(k), t, l, PAD_H + r * 0.6));
  // The tub wagon's rails: a short siding along the near side of the yard, sleepers under it.
  const rail = mats.lacquer("#6b6f75");
  for (const s of [-1, 1]) add(rail, new BoxGeometry(64, 1.6, 1.4), 172, 64 + s * 4.5, PAD_H + 2.2);
  for (let k = 0; k < 6; k++) add(mats.naturalWood, new BoxGeometry(3, 1.4, 14), 144 + k * 11.5, 64, PAD_H + 0.7);
  // The tub: an iron box on four little wheels, heaped with stone.
  add(mats.lacquer("#4f6f8f"), new RoundedBoxGeometry(18, 9, 12, 1, 1.5), 172, 64, PAD_H + 9);
  for (const dt of [-6, 6]) for (const s of [-1, 1]) add(mats.lacquer("#2f2f33"), new CylinderGeometry(2.6, 2.6, 1.6, 10).rotateX(Math.PI / 2), 172 + dt, 64 + s * 5.4, PAD_H + 4);
  for (const [dt, dl, r] of [[-4, -2, 3.2], [3, 2, 3.6], [0, -1, 2.8]] as const) add(greys[1], new DodecahedronGeometry(r, 0), 172 + dt, 64 + dl, PAD_H + 14);
  // A buffer stop at the end of the siding.
  add(mats.lacquer("#c8442f"), new RoundedBoxGeometry(4, 8, 14, 1, 1.2), 206, 64, PAD_H + 4);
}

/**
 * The warehouse: a plank deck, and crates and barrels waiting in front of its goods shed (whose dock, from l 53 out,
 * has crates and sacks of its own: tools/blender/dressing.py, industry_warehouse), a hand truck.
 */
function warehouse(add: PlaceFn, mats: Materials): void {
  // The deck: planks along the track, two tones of beech.
  const boards = [mats.lacquer("#d9b27a"), mats.lacquer("#c99f68")];
  const n = 8;
  const w = PAD.d / n;
  for (let k = 0; k < n; k++) add(boards[k % 2], new RoundedBoxGeometry(PAD.w, PAD_H, w - 0.6, 1, 0.8), PAD.t, PAD.l - PAD.d / 2 + w * (k + 0.5), PAD_H / 2);
  // Crates, painted, at the far end, between the dock and the track.
  const crate = (c: string, t: number, l: number, y: number, s = 12) => add(mats.lacquer(c), new RoundedBoxGeometry(s, s, s, 1, 1.2), t, l, PAD_H + y + s / 2);
  crate("#c8442f", 194, 40, 0);
  crate("#2f6db5", 181, 40, 0);
  crate("#e6b52c", 188, 40, 12, 10);
  crate("#3c8f4e", 168, 40, 0, 10);
  // Barrels.
  for (const [t, l] of [[118, 39], [128, 40], [123, 47]] as const) {
    add(mats.lacquer("#8a5a33"), new CylinderGeometry(4.6, 4.6, 12, 12), t, l, PAD_H + 6);
    for (const y of [3, 9]) add(mats.lacquer("#2f2f33"), new CylinderGeometry(4.9, 4.9, 1.2, 12), t, l, PAD_H + y);
  }
  // A hand truck leaning by the crates.
  add(mats.lacquer("#c8442f"), new BoxGeometry(1.4, 18, 8), 154, 40, PAD_H + 9);
  add(mats.lacquer("#2f2f33"), new CylinderGeometry(2.4, 2.4, 10, 10).rotateX(Math.PI / 2), 154, 40, PAD_H + 2.4);
}

/** The ground of a yard is drawn by `dressIndustry` for these (the plain pad is skipped). */
export const hasOwnGround = (role: DepotRole): boolean => role === "farm" || role === "mill" || role === "quarry" || role === "warehouse";

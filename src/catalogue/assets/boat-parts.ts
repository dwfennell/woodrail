import { Group, type Material, type Mesh } from "three";
import type { Kit } from "../kit";

/** Parts shared by the boats (vehicles.ts) and the water assets (water.ts). */

type Pt = [number, number];

/** How far the water felt under a boat reaches past its hull (mm). */
export const FELT_MARGIN = 5;

/**
 * A soft hull outline in plan (x along the boat, y across it, as drawn on paper), `len` × `w`: a rounded box, its bow
 * (+x) drawn in to a point by `bow` (0, a barge's blunt ends; 1, a ship's pointed bow).
 */
export function hullOutline(len: number, w: number, bow = 1, n = 32): Pt[] {
  const L = len / 2;
  const W = w / 2;
  const out: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const c = Math.cos(a);
    const s = Math.sin(a);
    // A superellipse (exponent 4): boxy, with round corners.
    const x = L * Math.sign(c) * Math.abs(c) ** 0.5;
    let y = W * Math.sign(s) * Math.abs(s) ** 0.5;
    if (x > 0) y *= 1 - bow * 0.75 * (x / L) ** 2;
    out.push([x, y]);
  }
  return out;
}

/** A flat outline lying on the ground, `h` thick, its base on y. */
export function flat(k: Kit, mat: Material, outline: Pt[], h: number, y = 0, x = 0, z = 0, bevel = 0.6): Mesh {
  const m = k.extrude(mat, outline, h, 0, 0, 0, bevel);
  m.rotation.x = -Math.PI / 2;
  m.position.set(x, y + h / 2, z);
  return m;
}

/**
 * The water under a boat. In the game, blue felt just round its hull (`len` × `w`, its bow drawn in by `bow`, as
 * `hullOutline`), so a boat on a river sits on the river and doesn't spill a pond over the banks. In the catalogue's
 * viewer, also a round felt pond `pond` across to show it off on: an underlay (`Asset.build`), left out in the game.
 */
export function boatFelt(k: Kit, len: number, w: number, bow = 1, pond = 0): Group {
  const g = new Group();
  g.add(flat(k, k.water, hullOutline(len + FELT_MARGIN * 2, w + FELT_MARGIN * 2, bow), 1.4, 0, 0, 0, 0.5));
  if (pond > 0) {
    const disc = k.feltDisc(pond, k.water);
    disc.position.y -= 0.4;
    disc.userData.underlay = true;
    g.add(disc);
  }
  return g;
}

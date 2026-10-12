import { CylinderGeometry, SphereGeometry, type BufferGeometry } from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { rng } from "../../lib/rng";
import { CELL, type Field, type Landscape } from "../../landscape";
import type { Materials } from "../materials";
import type { Batcher } from "./batcher";

const POST_H = 16;
const POST_STEP = 36;
const INSET = 5;

/** A fenced paddock: beech posts and two rails round its edge, and a few toy animals grazing inside. */
export function buildField(land: Landscape, field: Field, mats: Materials, b: Batcher): void {
  const g = land.grid;
  const first = field.cells[0];
  const col = g.colOf(first);
  const row = g.rowOf(first);
  const x0 = g.centreX(col) - CELL / 2 + INSET;
  const z0 = g.centreZ(row) - CELL / 2 + INSET;
  const size = CELL * 2 - INSET * 2;
  const y = g.groundY(first);

  // Fence: posts along each side, with two rails between the corners.
  const steps = Math.round(size / POST_STEP);
  for (const [ax, az, bx, bz] of [[x0, z0, x0 + size, z0], [x0 + size, z0, x0 + size, z0 + size], [x0 + size, z0 + size, x0, z0 + size], [x0, z0 + size, x0, z0]]) {
    for (let k = 0; k < steps; k++) {
      const t = k / steps;
      b.add(mats.naturalWood, new CylinderGeometry(1.6, 1.8, POST_H, 8).translate(ax + (bx - ax) * t, y + POST_H / 2, az + (bz - az) * t));
    }
    const len = Math.hypot(bx - ax, bz - az);
    for (const h of [6, 12]) {
      const rail = new RoundedBoxGeometry(len, 2, 1.6, 1, 0.6);
      rail.rotateY(-Math.atan2(bz - az, bx - ax));
      rail.translate((ax + bx) / 2, y + h, (az + bz) / 2);
      b.add(mats.naturalWood, rail);
    }
  }

  // Animals, spread out and facing every which way.
  const r = rng(land.seed * 41 + field.id * 7 + 1);
  const count = field.animal === "cow" ? 2 + Math.floor(r() * 2) : 3 + Math.floor(r() * 2);
  const spots: { x: number; z: number }[] = [];
  for (let tries = 0; tries < 40 && spots.length < count; tries++) {
    const x = x0 + 22 + r() * (size - 44);
    const z = z0 + 22 + r() * (size - 44);
    if (spots.some((s) => Math.hypot(s.x - x, s.z - z) < 34)) continue;
    spots.push({ x, z });
  }
  for (const s of spots) {
    const yaw = r() * Math.PI * 2;
    const place = (geo: BufferGeometry) => geo.rotateY(yaw).translate(s.x, y, s.z);
    if (field.animal === "cow") cow(b, mats, place);
    else sheep(b, mats, place);
  }
}

/** A chunky toy cow facing +x, about 34 mm long: white body with a black saddle patch, pink muzzle. */
function cow(b: Batcher, mats: Materials, place: (g: BufferGeometry) => BufferGeometry): void {
  for (const [lx, lz] of [[-8, -4.5], [-8, 4.5], [8, -4.5], [8, 4.5]]) {
    b.add(mats.naturalWood, place(new CylinderGeometry(1.7, 1.7, 8, 8).translate(lx, 4, lz)));
  }
  b.add(mats.lacquer("#f6f1e6"), place(new RoundedBoxGeometry(26, 12, 13, 2, 3).translate(0, 13, 0)));
  b.add(mats.lacquer("#2a2b2e"), place(new RoundedBoxGeometry(10, 2, 13.6, 1, 1).translate(-2, 18.6, 0)));
  b.add(mats.lacquer("#f6f1e6"), place(new RoundedBoxGeometry(9, 9, 9, 2, 2.5).translate(16, 17, 0)));
  b.add(mats.lacquer("#e9a3a8"), place(new RoundedBoxGeometry(3, 5, 7, 1, 1.2).translate(21, 15, 0)));
  for (const lz of [-3.5, 3.5]) b.add(mats.lacquer("#e6b52c"), place(new CylinderGeometry(0.8, 1.1, 4, 6).translate(15, 23, lz)));
}

/** A fluffy toy sheep facing +x: cream wool of beads over a body, black face and legs. */
function sheep(b: Batcher, mats: Materials, place: (g: BufferGeometry) => BufferGeometry): void {
  for (const [lx, lz] of [[-6, -4], [-6, 4], [6, -4], [6, 4]]) {
    b.add(mats.lacquer("#2a2b2e"), place(new CylinderGeometry(1.5, 1.5, 7, 8).translate(lx, 3.5, lz)));
  }
  b.add(mats.lacquer("#f3ead8"), place(new RoundedBoxGeometry(20, 11, 13, 2, 4.5).translate(0, 12, 0)));
  for (const [lx, lz] of [[-5, -3], [0, 3], [5, -2], [-4, 3.5], [4, 3]]) {
    b.add(mats.lacquer("#f3ead8"), place(new SphereGeometry(4.2, 10, 8).translate(lx, 17, lz)));
  }
  b.add(mats.lacquer("#2a2b2e"), place(new RoundedBoxGeometry(8, 8, 7, 2, 2.2).translate(12, 15, 0)));
}

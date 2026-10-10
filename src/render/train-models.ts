import {
  BoxGeometry,
  CylinderGeometry,
  DodecahedronGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  Color,
  SphereGeometry,
  TorusGeometry,
  type Material,
} from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { CAR_SPECS, type CarKind } from "../sim";
import { GROOVE_SPACING, TRACK_THICKNESS } from "../track";
import type { Materials } from "./materials";
import { rng } from "./textures";
import { GROOVE_DEPTH } from "./track-geometry";

const WHEEL_RADIUS = 6.5;
/** Wheel centres ride in the groove floor. */
export const AXLE_HEIGHT = TRACK_THICKNESS - GROOVE_DEPTH + WHEEL_RADIUS - 0.5;
const DECK = AXLE_HEIGHT + 4;

export interface CarModel {
  root: Group;
  /** Spun by distance travelled. */
  wheels: Mesh[];
  /** Engine only: glows to show the lever. */
  lamp?: Mesh;
}

const PALETTES: Record<CarKind, { body: string; trim: string }> = {
  engine: { body: "#2d6b3f", trim: "#c8442f" },
  hopper: { body: "#e6b52c", trim: "#2f6db5" },
  passenger: { body: "#2f6db5", trim: "#f0ebe0" },
  caboose: { body: "#c8442f", trim: "#f0ebe0" },
};

function add(group: Group, geo: import("three").BufferGeometry, mat: Material, x: number, y: number, z: number): Mesh {
  const m = new Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  group.add(m);
  return m;
}

/** Car facing +x, centred on its two axles, y = 0 at the track base. */
export function buildCarModel(kind: CarKind, mats: Materials, variant = 0): CarModel {
  const spec = CAR_SPECS[kind];
  const pal = PALETTES[kind];
  const body = mats.lacquer(variant === 1 && kind === "engine" ? "#b8432f" : pal.body);
  const trim = mats.lacquer(variant === 1 && kind === "engine" ? "#1f3f73" : pal.trim);
  const L = spec.length;
  const W = spec.width;
  const root = new Group();
  const wheels: Mesh[] = [];

  // Chassis: natural beech slab.
  add(root, new RoundedBoxGeometry(L - 6, 8, W - 2, 2, 2), mats.naturalWood, 0, DECK, 0);

  // Wheels: lacquered discs with a metal hub, riding in the grooves.
  const wheelGeo = new CylinderGeometry(WHEEL_RADIUS, WHEEL_RADIUS, 4.5, 28);
  wheelGeo.rotateX(Math.PI / 2);
  const hubGeo = new CylinderGeometry(1.6, 1.6, 6, 12);
  hubGeo.rotateX(Math.PI / 2);
  const axleX = L / 2 - spec.bogieInset;
  for (const x of [-axleX, axleX]) {
    for (const z of [-GROOVE_SPACING / 2, GROOVE_SPACING / 2]) {
      const w = add(root, wheelGeo, mats.lacquer("#b8432f"), x, AXLE_HEIGHT, z);
      wheels.push(w);
      add(root, hubGeo, mats.magnet, x, AXLE_HEIGHT, z + Math.sign(z) * 1.2);
    }
  }

  // Magnetic couplers: a short wooden arm with a dark round magnet at each end.
  const armGeo = new BoxGeometry(8, 4, 6);
  const magGeo = new CylinderGeometry(5, 5, 4, 24);
  magGeo.rotateZ(Math.PI / 2);
  for (const s of [-1, 1]) {
    add(root, armGeo, mats.naturalWood, s * (L / 2 - 6), DECK, 0);
    add(root, magGeo, mats.magnet, s * (L / 2 - 2), DECK, 0);
  }

  const top = DECK + 4;
  let lamp: Mesh | undefined;

  if (kind === "engine") {
    const boilerLen = L * 0.52;
    const boiler = new CylinderGeometry(12.5, 12.5, boilerLen, 32);
    boiler.rotateZ(Math.PI / 2);
    add(root, boiler, body, L * 0.12, top + 12.5, 0);
    for (const bx of [L * 0.12 - boilerLen * 0.2, L * 0.12 + boilerLen * 0.25]) {
      const band = new TorusGeometry(12.6, 1.1, 10, 32);
      band.rotateY(Math.PI / 2);
      add(root, band, trim, bx, top + 12.5, 0);
    }
    const front = new CylinderGeometry(11, 11, 3, 32);
    front.rotateZ(Math.PI / 2);
    add(root, front, mats.magnet, L * 0.12 + boilerLen / 2 + 1, top + 12.5, 0);
    add(root, new CylinderGeometry(4.5, 4, 14, 20), mats.magnet, L * 0.28, top + 30, 0);
    add(root, new CylinderGeometry(6.5, 4.5, 4, 20), mats.magnet, L * 0.28, top + 38, 0);
    add(root, new SphereGeometry(6, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2), trim, L * 0.02, top + 24, 0);
    // Cab with windows and a rounded roof.
    add(root, new RoundedBoxGeometry(L * 0.32, 32, W, 2, 2.5), body, -L * 0.3, top + 16, 0);
    for (const z of [-W / 2 - 0.4, W / 2 + 0.4]) add(root, new BoxGeometry(L * 0.18, 10, 1), mats.glass, -L * 0.3, top + 22, z);
    add(root, new RoundedBoxGeometry(L * 0.38, 4, W + 6, 2, 1.8), trim, -L * 0.3, top + 34, 0);
    lamp = add(
      root,
      new SphereGeometry(3.2, 16, 12),
      new MeshStandardMaterial({ color: new Color("#ffcf6b"), emissive: new Color("#ffaa33"), emissiveIntensity: 0.2, roughness: 0.3 }),
      -L * 0.3,
      top + 39,
      0,
    );
    // Cowcatcher-ish red buffer beam.
    add(root, new RoundedBoxGeometry(4, 8, W, 1, 1.2), trim, L / 2 - 9, DECK - 1, 0);
  } else if (kind === "hopper") {
    const h = 22;
    const inner = L - 14;
    add(root, new RoundedBoxGeometry(inner, 4, W, 1, 1.5), body, 0, top + 2, 0);
    for (const z of [-W / 2 + 2, W / 2 - 2]) add(root, new RoundedBoxGeometry(inner, h, 4, 1, 1.5), body, 0, top + h / 2, z);
    for (const x of [-inner / 2 + 2, inner / 2 - 2]) add(root, new RoundedBoxGeometry(4, h, W, 1, 1.5), body, x, top + h / 2, 0);
    for (const z of [-W / 2 + 1.5, W / 2 - 1.5]) add(root, new RoundedBoxGeometry(inner + 4, 3, 5, 1, 1.2), trim, 0, top + h, z);
    for (const x of [-inner / 2 + 1, inner / 2 - 1]) add(root, new RoundedBoxGeometry(5, 3, W + 2, 1, 1.2), trim, x, top + h, 0);
    // Coal: a heap of dark lumps.
    const r = rng(variant * 101 + 7);
    const lump = new DodecahedronGeometry(4.2, 0);
    for (let i = 0; i < 34; i++) {
      const x = (r() - 0.5) * (inner - 12);
      const z = (r() - 0.5) * (W - 12);
      const y = top + h - 7 + (1 - Math.hypot(x / inner, z / W) * 2) * 6 + r() * 2;
      const m = add(root, lump, mats.coal, x, y, z);
      m.rotation.set(r() * 3, r() * 3, r() * 3);
      m.scale.setScalar(0.7 + r() * 0.6);
    }
  } else {
    const h = kind === "passenger" ? 30 : 26;
    const bodyLen = L - 12;
    add(root, new RoundedBoxGeometry(bodyLen, h, W, 2, 2.5), body, 0, top + h / 2, 0);
    const windows = kind === "passenger" ? 4 : 2;
    for (let i = 0; i < windows; i++) {
      const x = -bodyLen / 2 + (bodyLen / windows) * (i + 0.5);
      for (const z of [-W / 2 - 0.4, W / 2 + 0.4]) add(root, new BoxGeometry(bodyLen / windows - 7, h * 0.36, 1), mats.glass, x, top + h * 0.62, z);
    }
    add(root, new RoundedBoxGeometry(bodyLen + 8, 5, W + 5, 2, 2), trim, 0, top + h + 1.5, 0);
    if (kind === "caboose") {
      add(root, new RoundedBoxGeometry(bodyLen * 0.35, 14, W * 0.7, 2, 2), body, 0, top + h + 9, 0);
      add(root, new RoundedBoxGeometry(bodyLen * 0.45, 3, W * 0.85, 1, 1.2), trim, 0, top + h + 17, 0);
      for (const z of [-W * 0.35 - 0.4, W * 0.35 + 0.4]) add(root, new BoxGeometry(bodyLen * 0.22, 6, 1), mats.glass, 0, top + h + 9, z);
    }
  }

  root.traverse((o) => {
    o.userData.carKind = kind;
  });
  return { root, wheels, lamp };
}

export { WHEEL_RADIUS };

/** Free the GPU geometry a car model owns. Lacquer and wood materials are shared caches and are kept. */
export function disposeObject(root: import("three").Object3D): void {
  root.traverse((o) => {
    const mesh = o as Mesh;
    if (!mesh.isMesh) return;
    mesh.geometry.dispose();
    if (mesh.userData.ownsMaterial) (mesh.material as Material).dispose();
  });
}

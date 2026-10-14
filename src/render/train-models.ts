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
  type BufferGeometry,
  type Material,
  type Object3D,
} from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { Brush, Evaluator, SUBTRACTION } from "three-bvh-csg";
import { CAR_SPECS, type CarKind, type CarLook } from "../sim";
import { GROOVE_SPACING, TRACK_THICKNESS } from "../track";
import { blenderCar } from "./blender-models";
import type { Materials } from "./materials";
import { rng } from "./textures";
import { GROOVE_DEPTH } from "./track-geometry";

const WHEEL_RADIUS = 6.5;
const WHEEL_WIDTH = 4.5;
/** Wheel centres ride in the groove floor. */
export const AXLE_HEIGHT = TRACK_THICKNESS - GROOVE_DEPTH + WHEEL_RADIUS - 0.5;
const DECK = AXLE_HEIGHT + 4;
/** Top of the timber wagon's deck, where cargo sits (car-local y). */
export const TIMBER_DECK = DECK + 4 + 4;

export interface CarModel {
  root: Group;
  /** Spun (round z) by distance travelled. */
  wheels: Object3D[];
  /** Engine only: glows to show the lever. */
  lamp?: Mesh;
}

const PALETTES: Record<CarKind, { body: string; trim: string }> = {
  engine: { body: "#2d6b3f", trim: "#c8442f" },
  hopper: { body: "#e6b52c", trim: "#2f6db5" },
  passenger: { body: "#2f6db5", trim: "#f0ebe0" },
  caboose: { body: "#c8442f", trim: "#f0ebe0" },
  timber: { body: "#c8442f", trim: "#c8442f" },
};

/** Wheel arches clear the wheel by this much (mm). */
const WHEEL_ARCH_GAP = 1.5;
const chassisCache = new Map<CarKind, BufferGeometry>();
const chassisCsg = new Evaluator();

/** A car's chassis slab (centred on y = 0, sitting at DECK), with wheel arches cut out over its wheels. */
function chassisGeometry(kind: CarKind): BufferGeometry {
  let g = chassisCache.get(kind);
  if (g) return g;
  const spec = CAR_SPECS[kind];
  const slab = new RoundedBoxGeometry(spec.length - 6, 8, spec.width - 2, 2, 2);
  slab.deleteAttribute("normal");
  slab.computeVertexNormals();
  let result = new Brush(slab.toNonIndexed());
  result.updateMatrixWorld();
  const axleX = spec.length / 2 - spec.bogieInset;
  // Each arch: a round cut around the wheel, from just inside the wheel out through the side of the slab.
  const inner = GROOVE_SPACING / 2 - WHEEL_WIDTH / 2 - WHEEL_ARCH_GAP;
  const depth = spec.width / 2 - inner + 2;
  for (const x of [-axleX, axleX]) {
    for (const side of [-1, 1]) {
      const cut = new CylinderGeometry(WHEEL_RADIUS + WHEEL_ARCH_GAP, WHEEL_RADIUS + WHEEL_ARCH_GAP, depth, 28);
      cut.rotateX(Math.PI / 2);
      cut.translate(x, AXLE_HEIGHT - DECK, side * (inner + depth / 2));
      const brush = new Brush(cut.toNonIndexed());
      brush.updateMatrixWorld();
      result = chassisCsg.evaluate(result, brush, SUBTRACTION);
    }
  }
  g = result.geometry;
  g.clearGroups();
  g.computeBoundingSphere();
  chassisCache.set(kind, g);
  return g;
}

function add(group: Group, geo: import("three").BufferGeometry, mat: Material, x: number, y: number, z: number): Mesh {
  const m = new Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  group.add(m);
  return m;
}

/** Car facing +x, centred on its two axles, y = 0 at the track base. */
export function buildCarModel(kind: CarKind, mats: Materials, variant = 0, look: CarLook = "classic"): CarModel {
  const spec = CAR_SPECS[kind];
  const pal = PALETTES[kind];
  const body = mats.lacquer(variant === 1 && kind === "engine" ? "#b8432f" : pal.body);
  const trim = mats.lacquer(variant === 1 && kind === "engine" ? "#1f3f73" : pal.trim);
  const L = spec.length;
  const W = spec.width;
  const root = new Group();
  const wheels: Mesh[] = [];
  // Windows look printed on, as on a wooden toy: a pale sky-blue pane, not dark glass.
  const pane = mats.lacquer("#a9cfe6");

  // Chassis: natural beech slab, with an arch cut over each wheel so the wheels stand clear of it.
  add(root, chassisGeometry(kind), mats.naturalWood, 0, DECK, 0);

  // Wheels: lacquered discs with a metal hub, riding in the grooves.
  const wheelGeo = new CylinderGeometry(WHEEL_RADIUS, WHEEL_RADIUS, WHEEL_WIDTH, 28);
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

  const lampMaterial = () => new MeshStandardMaterial({ color: new Color("#ffcf6b"), emissive: new Color("#ffaa33"), emissiveIntensity: 0.2, roughness: 0.3 });

  // The model made in Blender (tools/blender/trains.py), when it's loaded; the one built below otherwise.
  // The classic engine's second colour scheme (the other looks have one each).
  const recolor: Record<string, string> = variant === 1 && kind === "engine" && look === "classic" ? { [pal.body]: "#b8432f", [pal.trim]: "#1f3f73" } : {};
  const made = blenderCar(kind, look, mats, lampMaterial(), recolor);
  if (made) {
    made.root.traverse((o) => (o.userData.carKind = kind));
    return made;
  }

  if (kind === "engine" && look !== "classic") {
    lamp = engineLook(root, mats, look, L, W, top, pane, lampMaterial());
  } else if ((kind === "passenger" || kind === "caboose") && look !== "classic") {
    coachLook(root, mats, look, L, W, top, pane);
  } else if (kind === "engine") {
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
    for (const z of [-W / 2 - 0.4, W / 2 + 0.4]) add(root, new BoxGeometry(L * 0.18, 10, 1), pane, -L * 0.3, top + 22, z);
    add(root, new RoundedBoxGeometry(L * 0.38, 4, W + 6, 2, 1.8), trim, -L * 0.3, top + 34, 0);
    lamp = add(
      root,
      new SphereGeometry(3.2, 16, 12),
      lampMaterial(),
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
  } else if (kind === "timber") {
    // Flat beech deck with a low rim and four red-capped stakes; cargo rides on the deck (see TIMBER_DECK).
    const inner = L - 12;
    add(root, new RoundedBoxGeometry(inner, 4, W, 1, 1.5), mats.naturalWood, 0, top + 2, 0);
    for (const x of [-inner / 2 + 6, inner / 2 - 6]) {
      for (const z of [-W / 2 + 2.5, W / 2 - 2.5]) {
        add(root, new CylinderGeometry(1.8, 1.8, 18, 10), mats.naturalWood, x, top + 4 + 9, z);
        add(root, new SphereGeometry(2.4, 12, 8), body, x, top + 4 + 18, z);
      }
    }
  } else {
    const h = kind === "passenger" ? 30 : 26;
    const bodyLen = L - 12;
    add(root, new RoundedBoxGeometry(bodyLen, h, W, 2, 2.5), body, 0, top + h / 2, 0);
    const windows = kind === "passenger" ? 4 : 2;
    for (let i = 0; i < windows; i++) {
      const x = -bodyLen / 2 + (bodyLen / windows) * (i + 0.5);
      for (const z of [-W / 2 - 0.4, W / 2 + 0.4]) add(root, new BoxGeometry(bodyLen / windows - 7, h * 0.36, 1), pane, x, top + h * 0.62, z);
    }
    add(root, new RoundedBoxGeometry(bodyLen + 8, 5, W + 5, 2, 2), trim, 0, top + h + 1.5, 0);
    if (kind === "caboose") {
      add(root, new RoundedBoxGeometry(bodyLen * 0.35, 14, W * 0.7, 2, 2), body, 0, top + h + 9, 0);
      add(root, new RoundedBoxGeometry(bodyLen * 0.45, 3, W * 0.85, 1, 1.2), trim, 0, top + h + 17, 0);
      for (const z of [-W * 0.35 - 0.4, W * 0.35 + 0.4]) add(root, new BoxGeometry(bodyLen * 0.22, 6, 1), pane, 0, top + h + 9, z);
    }
  }

  root.traverse((o) => {
    o.userData.carKind = kind;
  });
  return { root, wheels, lamp };
}

/**
 * An engine's body in one of its other looks, on the shared chassis: a tank engine, a diesel shunter or an electric.
 * Returns the cab-roof lamp (it glows to show the lever).
 */
function engineLook(root: Group, mats: Materials, look: CarLook, L: number, W: number, top: number, pane: Material, lampMat: Material): Mesh {
  const box = (w: number, h: number, d: number, m: Material, x: number, y: number, z: number, r = 2) => add(root, new RoundedBoxGeometry(w, h, d, 2, r), m, x, y, z);
  const black = mats.magnet;
  if (look === "tank") {
    // A blue tank engine: short boiler between square side tanks, a tall chimney, a dome and a roomy cab.
    const body = mats.lacquer("#2f6db5");
    const trim = mats.lacquer("#c8442f");
    const boiler = new CylinderGeometry(11, 11, L * 0.5, 32);
    boiler.rotateZ(Math.PI / 2);
    add(root, boiler, body, L * 0.14, top + 13, 0);
    for (const z of [-W / 2 + 4, W / 2 - 4]) {
      box(L * 0.42, 17, 8, body, L * 0.1, top + 8.5, z);
      box(L * 0.44, 2.5, 9, trim, L * 0.1, top + 17.5, z, 1);
    }
    const face = new CylinderGeometry(9.5, 9.5, 3, 32);
    face.rotateZ(Math.PI / 2);
    add(root, face, black, L * 0.39 + 1, top + 13, 0);
    add(root, new CylinderGeometry(4, 3.6, 16, 20), black, L * 0.3, top + 30, 0);
    add(root, new CylinderGeometry(6, 4, 4, 20), trim, L * 0.3, top + 39, 0);
    add(root, new SphereGeometry(5.5, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2), mats.lacquer("#e6b52c"), L * 0.1, top + 23, 0);
    box(L * 0.34, 30, W, body, -L * 0.28, top + 15, 0, 2.5);
    for (const z of [-W / 2 - 0.4, W / 2 + 0.4]) add(root, new BoxGeometry(L * 0.18, 9, 1), pane, -L * 0.28, top + 21, z);
    box(L * 0.4, 4, W + 5, trim, -L * 0.28, top + 32, 0, 1.8);
    add(root, new RoundedBoxGeometry(4, 8, W, 1, 1.2), trim, L / 2 - 9, DECK - 1, 0);
    return add(root, new SphereGeometry(3.2, 16, 12), lampMat, -L * 0.28, top + 37, 0);
  }
  if (look === "diesel") {
    // A yellow diesel shunter: a long low hood with a grille and black stripes, a tall cab at the back.
    const body = mats.lacquer("#e6b52c");
    const stripe = mats.lacquer("#2a2b2e");
    box(L * 0.58, 20, W - 6, body, L * 0.13, top + 10, 0, 3);
    for (let i = 0; i < 4; i++) add(root, new BoxGeometry(1.2, 10, W - 10), stripe, L * 0.3 + i * 3.4 - 2, top + 12, 0);
    for (const z of [-1, 1]) add(root, new BoxGeometry(L * 0.5, 2.5, 0.8), stripe, L * 0.13, top + 6, z * (W / 2 - 2.6));
    add(root, new CylinderGeometry(2.4, 2.4, 5, 14), black, L * 0.2, top + 22, 0);
    box(L * 0.32, 32, W, body, -L * 0.3, top + 16, 0, 2.5);
    for (const z of [-W / 2 - 0.4, W / 2 + 0.4]) add(root, new BoxGeometry(L * 0.2, 11, 1), pane, -L * 0.3, top + 22, z);
    add(root, new BoxGeometry(1, 10, W - 8), pane, -L * 0.3 + L * 0.16 + 0.4, top + 22, 0);
    box(L * 0.36, 3, W + 3, stripe, -L * 0.3, top + 33, 0, 1.2);
    // Black-and-yellow chevrons on the buffer beam.
    add(root, new RoundedBoxGeometry(4, 8, W, 1, 1.2), stripe, L / 2 - 9, DECK - 1, 0);
    return add(root, new SphereGeometry(3.2, 16, 12), lampMat, -L * 0.3, top + 37, 0);
  }
  // An electric: a long red box cab-to-cab, a cream band, and a folding pantograph on the roof.
  const body = mats.lacquer("#c8442f");
  const cream = mats.lacquer("#f0ebe0");
  const bodyLen = L - 10;
  box(bodyLen, 30, W, body, 0, top + 15, 0, 4);
  for (const z of [-W / 2 - 0.3, W / 2 + 0.3]) add(root, new BoxGeometry(bodyLen - 6, 3.5, 0.8), cream, 0, top + 11, z);
  for (const s of [-1, 1]) {
    // Cab windows at each end, and small side windows.
    add(root, new BoxGeometry(1, 9, W - 8), pane, s * (bodyLen / 2 + 0.3), top + 21, 0);
    for (const z of [-W / 2 - 0.4, W / 2 + 0.4]) add(root, new BoxGeometry(9, 8, 1), pane, s * (bodyLen / 2 - 9), top + 21, z);
  }
  for (let i = -1; i <= 1; i++) for (const z of [-W / 2 - 0.4, W / 2 + 0.4]) add(root, new BoxGeometry(7, 6, 1), pane, i * 14, top + 21, z);
  box(bodyLen - 6, 2.5, W - 6, mats.lacquer("#8d8f93"), 0, top + 31, 0, 1);
  // Pantograph: two arms in a diamond, a bow on top.
  // A single folding arm (up and back to a knee, then up and forward) carrying the bow across the roof.
  const link = (x0: number, y0: number, x1: number, y1: number) => {
    const m = add(root, new BoxGeometry(Math.hypot(x1 - x0, y1 - y0), 1.6, 1.6), black, (x0 + x1) / 2, top + (y0 + y1) / 2, 0);
    m.rotation.z = Math.atan2(y1 - y0, x1 - x0);
  };
  add(root, new BoxGeometry(6, 3, 6), black, 6, top + 32.5, 0);
  link(6, 33, -4, 40);
  link(-4, 40, 3, 47);
  add(root, new BoxGeometry(2.4, 1.8, W - 4), black, 3, top + 47.5, 0);
  return add(root, new SphereGeometry(3, 16, 12), lampMat, bodyLen / 2 - 6, top + 34, 0);
}

/** A coach or caboose body in one of its other looks: dining car, sleeper, double-decker, bay-window caboose. */
function coachLook(root: Group, mats: Materials, look: CarLook, L: number, W: number, top: number, pane: Material): void {
  const bodyLen = L - 12;
  const box = (w: number, h: number, d: number, m: Material, x: number, y: number, z: number, r = 2) => add(root, new RoundedBoxGeometry(w, h, d, 2, r), m, x, y, z);
  const side = (w: number, h: number, x: number, y: number, m: Material = pane) => {
    for (const z of [-W / 2 - 0.4, W / 2 + 0.4]) add(root, new BoxGeometry(w, h, 1), m, x, y, z);
  };
  if (look === "dining") {
    // Claret with a cream window band, three wide windows, and a kitchen chimney on the roof.
    const h = 30;
    box(bodyLen, h, W, mats.lacquer("#7a2a3a"), 0, top + h / 2, 0, 2.5);
    side(bodyLen - 4, 13, 0, top + h * 0.6, mats.lacquer("#f0ebe0"));
    for (let i = -1; i <= 1; i++) side(bodyLen / 3 - 8, 9, (i * bodyLen) / 3, top + h * 0.6 + 0.1);
    box(bodyLen + 8, 5, W + 5, mats.lacquer("#f0ebe0"), 0, top + h + 1.5, 0);
    add(root, new CylinderGeometry(2.6, 2.6, 7, 14), mats.magnet, -bodyLen / 2 + 10, top + h + 7, 0);
    return;
  }
  if (look === "sleeper") {
    // Night blue, little square windows, a scatter of gold stars and a moon.
    const h = 31;
    box(bodyLen, h, W, mats.lacquer("#1f3f73"), 0, top + h / 2, 0, 2.5);
    for (let i = 0; i < 6; i++) side(7, 7, -bodyLen / 2 + 7 + i * ((bodyLen - 14) / 5), top + h * 0.62);
    const gold = mats.lacquer("#e6b52c");
    const star = new SphereGeometry(1.1, 8, 6);
    for (const [x, y] of [[-24, 7], [-9, 5], [6, 8], [21, 6], [31, 9]]) for (const z of [-W / 2 - 0.6, W / 2 + 0.6]) add(root, star, gold, x, top + y, z);
    for (const z of [-W / 2 - 0.6, W / 2 + 0.6]) add(root, new CylinderGeometry(3, 3, 1, 20), gold, -32, top + 10, z).rotation.set(Math.PI / 2, 0, 0);
    box(bodyLen + 8, 5, W + 5, mats.lacquer("#e6b52c"), 0, top + h + 1.5, 0);
    return;
  }
  if (look === "double-decker") {
    // Tall and green, two rows of windows.
    const h = 44;
    box(bodyLen, h, W, mats.lacquer("#2d6b3f"), 0, top + h / 2, 0, 2.5);
    for (const y of [0.33, 0.75]) for (let i = 0; i < 4; i++) side(bodyLen / 4 - 6, 9, -bodyLen / 2 + (bodyLen / 4) * (i + 0.5), top + h * y);
    side(bodyLen - 2, 2.2, 0, top + h * 0.54, mats.lacquer("#f0ebe0"));
    box(bodyLen + 6, 5, W + 4, mats.lacquer("#f0ebe0"), 0, top + h + 1.5, 0);
    return;
  }
  // Bay-window caboose: yellow, a brown roof, and a boxy bay out of each side for the guard to look along the train.
  const h = 26;
  const body = mats.lacquer("#e6b52c");
  const brown = mats.lacquer("#7a4a2a");
  box(bodyLen, h, W, body, 0, top + h / 2, 0, 2.5);
  side(9, 9, -bodyLen / 2 + 9, top + h * 0.62);
  side(9, 9, bodyLen / 2 - 9, top + h * 0.62);
  for (const s of [-1, 1]) {
    box(18, 16, 5, body, 0, top + h * 0.58, s * (W / 2 + 2), 1.5);
    add(root, new BoxGeometry(12, 8, 1), pane, 0, top + h * 0.62, s * (W / 2 + 4.7));
    box(20, 2.5, 7, brown, 0, top + h * 0.58 + 9, s * (W / 2 + 2), 1);
  }
  box(bodyLen + 8, 5, W + 5, brown, 0, top + h + 1.5, 0);
  add(root, new CylinderGeometry(2, 2, 6, 12), mats.magnet, bodyLen / 2 - 8, top + h + 6, 0);
}

export { WHEEL_RADIUS };

/** Free the GPU geometry a car model owns. Lacquer and wood materials are shared caches and are kept. */
export function disposeObject(root: import("three").Object3D): void {
  root.traverse((o) => {
    const mesh = o as Mesh;
    if (!mesh.isMesh) return;
    if (!mesh.userData.sharedGeometry) mesh.geometry.dispose();
    if (mesh.userData.ownsMaterial) (mesh.material as Material).dispose();
  });
}

/** Which colour scheme a car wears: it follows the car (its id survives being picked up and put down). */
export const carVariant = (kind: CarKind, id: number): number => (kind === "engine" ? id % 2 : id);

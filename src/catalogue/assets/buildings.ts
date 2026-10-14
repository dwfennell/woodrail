import { CylinderGeometry, Group, Mesh, Shape, type Material, type Object3D } from "three";
import { TOY, type Kit } from "../kit";
import { catalogueModel, loadModelSet } from "../../render/blender-models";
import type { Asset } from "../types";

/**
 * Stations & buildings: chunky toy architecture. Beech or lacquered walls, gloss roofs and doors, windows as dark
 * printed-look insets with a white sill. Fronts face +x; anything a train runs through runs along x.
 */

const CAT = "Stations & buildings" as const;
const WIN = "#2b3644";
const BRICK = "#a8553a";
const STONE = "#b9b2a5";
const SLATE = "#4a5560";

// ——— Local helpers ———

/** Parts named `name` under `root`, found once and cached on the root (so animate allocates nothing per frame). */
function parts(root: Object3D, name: string): Object3D[] {
  const cache = (root.userData.parts ??= {}) as Record<string, Object3D[]>;
  let list = cache[name];
  if (!list) {
    const found: Object3D[] = [];
    root.traverse((o) => {
      if (o.name === name) found.push(o);
    });
    list = cache[name] = found;
  }
  return list;
}

function named<T extends Object3D>(o: T, name: string): T {
  o.name = name;
  return o;
}

/** A triangular prism along x (gable infill, a pediment): `len` long, `d` across, `rh` high, its base on y. */
function gable(k: Kit, mat: Material, len: number, d: number, rh: number, x = 0, y = 0, z = 0): Mesh {
  return k.at(k.extrude(mat, [[-d / 2, 0], [d / 2, 0], [0, rh]], len, 0, 0, 0, 0), x, y, z, Math.PI / 2);
}

/** A house body: walls `w` (x) × `d` (z) × `h`, a gable `rh` high and an overhanging pitched roof, ridge along x. */
function house(k: Kit, w: number, d: number, h: number, wall: Material, roof: string, rh = d * 0.45, x = 0, z = 0, o = 4): Group {
  const g = new Group();
  g.add(k.box(wall, w, h, d, 2));
  g.add(gable(k, wall, w - 0.5, d, rh, 0, h, 0));
  const drop = (2 * o * rh) / d;
  g.add(k.roof(k.paint(roof), w + 2 * o, d + 2 * o, rh + drop, 0, h - drop + 1.4, 0));
  return k.at(g, x, 0, z);
}

/** A four-sided pyramid roof, `side` across at its base on y. */
function hip(k: Kit, mat: Material, side: number, h: number, x = 0, y = 0, z = 0): Mesh {
  return k.at(k.cone(mat, side / Math.SQRT2, h, 0, 0, 0, 4), x, y, z, Math.PI / 4);
}

/** A window on a wall facing ±x (the wall's face at x), with a white sill. */
function winX(k: Kit, x: number, y: number, z: number, w = 9, h = 11): Group {
  return k.group(k.box(k.paint(WIN), 1.6, h, w, 0.4, x, y, z), k.box(k.paint(TOY.white), 2.6, 1.4, w + 2, 0.4, x, y - 1.4, z));
}

/** A window on a wall facing ±z (the wall's face at z), with a white sill. */
function winZ(k: Kit, x: number, y: number, z: number, w = 9, h = 11): Group {
  return k.group(k.box(k.paint(WIN), w, h, 1.6, 0.4, x, y, z), k.box(k.paint(TOY.white), w + 2, 1.4, 2.6, 0.4, x, y - 1.4, z));
}

/** A door on a wall facing +x, with a brass knob. */
function doorX(k: Kit, color: string, x: number, z: number, w = 10, h = 18, y = 0): Group {
  return k.group(k.box(k.paint(color), 1.8, h, w, 0.6, x, y, z), k.ball(k.paint(TOY.yellow), 0.9, x + 1.2, y + h * 0.5, z + w * 0.3));
}

/** A door on a wall facing +z. */
function doorZ(k: Kit, color: string, x: number, z: number, w = 10, h = 18): Group {
  return k.group(k.box(k.paint(color), w, h, 1.8, 0.6, x, 0, z), k.ball(k.paint(TOY.yellow), 0.9, x + w * 0.3, h * 0.5, z + 1.2));
}

/** A platform lamp post. */
function lamp(k: Kit, x: number, z: number, h = 34, y = 0): Group {
  const black = k.paint(TOY.black);
  return k.group(
    k.cyl(black, 3, 2, x, y, z),
    k.cyl(black, 1.1, h, x, y, z, 1.1, 10),
    k.ball(k.paint("#f6e7a8"), 3, x, y + h + 2, z),
    k.cone(black, 3.6, 3, x, y + h + 4, z, 10),
  );
}

/** A slatted platform bench, its seat along x (turn with `ry`). */
function bench(k: Kit, x: number, z: number, ry = 0, y = 0, back: string = TOY.green): Group {
  const black = k.paint(TOY.black);
  const g = k.group(
    k.box(k.wood, 18, 1.8, 6, 0.6, 0, 5, 0),
    k.box(k.paint(back), 18, 6, 1.4, 0.5, 0, 7, -3),
    k.box(black, 1.4, 5, 6, 0.3, -7, 0, 0),
    k.box(black, 1.4, 5, 6, 0.3, 7, 0, 0),
  );
  return k.at(g, x, y, z, ry);
}

/** A brick chimney stack with a dark cap, its base on y. */
function chimney(k: Kit, x: number, y: number, z: number, h = 14, color: string = BRICK): Group {
  return k.group(k.box(k.paint(color), 6, h, 6, 1, x, y, z), k.box(k.paint(TOY.black), 7.5, 2, 7.5, 0.6, x, y + h, z));
}

/** Three puffs of cotton smoke (named "smoke"), drifting up from (x, y, z). */
function smoke(k: Kit, x: number, y: number, z: number): Group {
  const g = named(new Group(), "smoke");
  for (let i = 0; i < 3; i++) g.add(k.ball(k.paint("#e9e6e0"), 4, 0, i * 8, 0));
  return k.at(g, x, y, z);
}

function animateSmoke(root: Object3D, t: number): void {
  for (const g of parts(root, "smoke")) {
    const n = g.children.length;
    for (let i = 0; i < n; i++) {
      const f = (t * 0.45 + i / n) % 1;
      const p = g.children[i];
      p.position.set(f * 6, f * 26, 0);
      p.scale.setScalar(0.5 + f * 0.9);
    }
  }
}

/** A clock face looking along +x with hands named "hour" and "minute". */
function clock(k: Kit, r: number, x: number, y: number, z: number, ry = 0): Group {
  const g = new Group();
  g.add(k.cylX(k.paint(TOY.black), r + 1.2, 1.6, -0.4, 0, 0, 24));
  g.add(k.cylX(k.paint(TOY.white), r, 2, 0, 0, 0, 24));
  const black = k.paint(TOY.black);
  const hour = named(new Group(), "hour");
  hour.add(k.box(black, 0.8, r * 0.55, 1.6, 0.3, 0, 0, 0));
  const minute = named(new Group(), "minute");
  minute.add(k.box(black, 0.8, r * 0.85, 1.1, 0.3, 0, 0, 0));
  g.add(k.at(hour, 1.3, 0, 0), k.at(minute, 1.6, 0, 0), k.ball(black, 1, 1.8, 0, 0));
  return k.at(g, x, y, z, ry);
}

function animateClock(root: Object3D, t: number): void {
  for (const m of parts(root, "minute")) m.rotation.x = -t * 0.6;
  for (const h of parts(root, "hour")) h.rotation.x = -t * 0.05;
}

/** A plain platform slab `len` (x) × `d` (z), with a yellow edge line on its +z side (`edge` −1 for −z). */
function platform(k: Kit, len: number, d: number, x = 0, z = 0, h = 13, edge: 1 | -1 = 1): Group {
  return k.group(k.box(k.wood, len, h, d, 1.5, x, 0, z), k.box(k.paint(TOY.yellow), len - 1, 0.6, 3, 0.2, x, h, z + edge * (d / 2 - 2.5)));
}

/** A station name board on two posts (blank: the board is the sign). */
function nameBoard(k: Kit, x: number, z: number, w = 24, y = 0, color: string = TOY.blue): Group {
  const black = k.paint(TOY.black);
  return k.group(
    k.cyl(black, 1, 26, x - w / 2 + 2, y, z, 1, 8),
    k.cyl(black, 1, 26, x + w / 2 - 2, y, z, 1, 8),
    k.box(k.paint(color), w, 7, 1.8, 0.6, x, y + 22, z),
    k.box(k.paint(TOY.white), w - 5, 2.4, 2.2, 0.3, x, y + 24.3, z),
  );
}

/** A striped awning sloping out over a wall facing +x (at x), `w` wide, its top edge at y. */
function awningX(k: Kit, x: number, y: number, z: number, w: number, a: string = TOY.red, b: string = TOY.white, n = 6): Group {
  const g = new Group();
  const sw = w / n;
  for (let i = 0; i < n; i++) {
    const s = k.box(k.paint(i % 2 ? b : a), 12, 1.6, sw, 0.3, 6, -0.8, -w / 2 + sw * (i + 0.5));
    g.add(s);
  }
  g.rotation.z = -0.45;
  return k.at(g, x, y, z);
}

/** A wooden crate. */
function crate(k: Kit, x: number, y: number, z: number, s = 9, color = "#c99a5b"): Group {
  return k.group(k.box(k.paint(color), s, s, s, 1, x, y, z), k.box(k.cut, s + 0.4, 1.2, s + 0.4, 0.3, x, y + s * 0.45, z));
}

/** A tied sack. */
function sack(k: Kit, x: number, y: number, z: number): Group {
  return k.group(k.ball(k.paint("#d8c49a"), 4, x, y + 3.4, z, 0.9), k.cyl(k.paint("#d8c49a"), 1.4, 3, x, y + 6, z, 2, 10));
}

/** A milk churn. */
function churn(k: Kit, x: number, y: number, z: number): Mesh {
  return k.lathe(k.paint("#d9dde2"), [[0, 0], [3.4, 0], [3.4, 7], [2, 9.5], [2, 11], [2.8, 11.5], [0, 12]], x, y, z, 16);
}

/** A slope panel from (z0, y0) to (z1, y1) across, `len` long along x, `t` thick (for odd roofs). */
function panel(k: Kit, mat: Material, len: number, z0: number, y0: number, z1: number, y1: number, t = 2.5): Mesh {
  const dz = z1 - z0;
  const dy = y1 - y0;
  const m = k.box(mat, len, t, Math.hypot(dz, dy) + 1.5, 0.8);
  m.position.set(0, (y0 + y1) / 2, (z0 + z1) / 2);
  m.rotation.x = -Math.atan2(dy, dz);
  return m;
}

/** A pine tree on a turned trunk. */
function pine(k: Kit, x: number, z: number, h = 40): Group {
  return k.group(k.cyl(k.wood, 2.5, 8, x, 0, z, 2.5, 12), k.cone(k.paint(TOY.green), h * 0.32, h * 0.6, x, 6, z, 16), k.cone(k.paint(TOY.green), h * 0.24, h * 0.45, x, h * 0.45, z, 16));
}

/** A window band of dark glass around a cylinder, between y and y + h. */
function glassBand(k: Kit, r: number, h: number, y: number, x = 0, z = 0): Mesh {
  return k.cyl(k.paint(WIN), r, h, x, y, z, r, 24);
}

// ——— The assets ———

export const ASSETS: Asset[] = [
  // ——— Stations ———
  {
    id: "bldg-country-halt",
    name: "Country halt",
    category: CAT,
    tags: ["station", "halt", "platform", "rural", "shelter"],
    notes: "A single short platform with a lean-to shelter, a name board and one lamp. Place it beside any straight; a passenger train that stops here could pick up the one peg person waiting.",
    build: (k) => {
      const green = k.paint(TOY.green);
      const g = platform(k, 100, 28, 0, 0);
      // Lean-to shelter: back wall, two sides, sloping roof.
      g.add(k.box(green, 40, 26, 3, 1, 0, 13, -11));
      g.add(k.box(green, 3, 26, 14, 1, -18.5, 13, -5));
      g.add(k.box(green, 3, 26, 14, 1, 18.5, 13, -5));
      const roof = k.box(k.paint(TOY.red), 46, 2.5, 22, 0.8, 0, 38, -3);
      roof.rotation.x = 0.18;
      g.add(roof);
      g.add(bench(k, 0, -6, 0, 13, TOY.cream));
      g.add(nameBoard(k, 34, -6, 22, 13));
      g.add(lamp(k, -38, 6, 30, 13));
      g.add(k.peg(TOY.purple, TOY.black, -24, 13, 4));
      return g;
    },
  },
  {
    id: "bldg-two-platform-station",
    name: "Two-platform station with footbridge",
    category: CAT,
    tags: ["station", "footbridge", "double track", "platform", "canopy"],
    notes: "Two through tracks between a platform each side, joined by a covered footbridge. A good passing place: one train waits at the platform while the other runs through.",
    build: (k) => {
      const g = new Group();
      for (const z of [-22, 22]) g.add(k.trackSlab(150, 0, 0, z));
      g.add(platform(k, 150, 26, 0, -56, 13, 1));
      g.add(platform(k, 150, 26, 0, 56, 13, -1));
      // Station building on the far platform.
      const b = k.at(house(k, 60, 18, 28, k.paint(TOY.cream), TOY.red, 10), -25, 13, -60);
      b.add(doorZ(k, TOY.blue, 0, 9.5, 10, 18));
      for (const x of [-18, 18]) b.add(winZ(k, x, 9, 9.3));
      g.add(b);
      g.add(chimney(k, -40, 50, -63));
      // Canopy on the near platform.
      for (const x of [-50, -20, 10]) g.add(k.cyl(k.paint(TOY.green), 1.4, 30, x, 13, 58, 1.4, 10));
      const canopy = k.box(k.paint(TOY.green), 76, 2.5, 26, 0.8, -20, 43, 56);
      canopy.rotation.x = -0.12;
      g.add(canopy);
      g.add(bench(k, -35, 62, Math.PI, 13), bench(k, -5, 62, Math.PI, 13));
      // Footbridge: two stair towers and a covered span.
      const blue = k.paint(TOY.blue);
      for (const z of [-60, 60]) {
        g.add(k.box(blue, 18, 54, 14, 1.5, 48, 13, z));
        g.add(hip(k, k.paint(TOY.red), 20, 8, 48, 78, z));
      }
      g.add(k.box(blue, 18, 4, 110, 1, 48, 62, 0));
      for (const x of [40, 56]) g.add(k.box(k.paint(TOY.cream), 2, 10, 106, 0.6, x, 66, 0));
      g.add(k.box(k.paint(TOY.red), 22, 2.5, 112, 0.8, 48, 77, 0));
      for (const x of [-60, 20, 64]) g.add(lamp(k, x, -46, 30, 13));
      g.add(lamp(k, 64, 46, 30, 13));
      g.add(nameBoard(k, 25, -66, 26, 13));
      return g;
    },
  },
  {
    id: "bldg-grand-terminus",
    name: "Grand terminus",
    category: CAT,
    tags: ["station", "terminus", "clock tower", "glass roof", "city", "buffers"],
    notes: "Three dead-end roads under an arched glass train shed, fronted by a concourse and a clock tower. The end of the line: a city's terminus could set timetabled departures for each road.",
    build: (k) => {
      const g = new Group();
      const cream = k.paint(TOY.cream);
      // Tracks and buffer stops.
      for (const z of [-48, 0, 48]) {
        g.add(k.trackSlab(130, -30, 0, z));
        g.add(k.box(k.paint(TOY.red), 6, 12, 30, 1.5, 36, 12, z));
        for (const s of [-10, 10]) g.add(k.cylX(k.paint(TOY.black), 2.5, 4, 32, 18, z + s, 12));
      }
      for (const z of [-24, 24]) g.add(platform(k, 130, 8, -30, z, 13));
      // Shed: low side walls, ribs, half-barrel glass roof.
      for (const z of [-72, 72]) g.add(k.box(k.paint(BRICK), 140, 30, 4, 1, -25, 0, z));
      const glass = new Mesh(new CylinderGeometry(70, 70, 136, 24, 1, true, 0, Math.PI), k.glass);
      glass.geometry.rotateZ(Math.PI / 2);
      glass.position.set(-25, 30, 0);
      g.add(glass);
      for (const x of [-90, -58, -25, 8, 40]) g.add(k.at(k.ring(k.paint(TOY.green), 71, 1.6, 0, 0, 0, true, Math.PI), x, 30, 0, Math.PI / 2));
      g.add(k.box(k.paint(TOY.green), 136, 3, 4, 1, -25, 99, 0));
      // Concourse front and clock tower.
      g.add(k.box(cream, 30, 48, 150, 2, 58, 0, 0));
      g.add(k.box(k.paint(TOY.blue), 34, 3, 154, 1, 58, 48, 0));
      for (const z of [-55, -35, 35, 55]) g.add(winX(k, 73, 26, z, 10, 14));
      for (const z of [-18, 18]) g.add(doorX(k, TOY.blue, 73, z, 12, 24));
      g.add(k.box(cream, 26, 108, 26, 2, 58, 0, 0));
      g.add(hip(k, k.paint(TOY.green), 30, 22, 58, 108, 0));
      g.add(k.cyl(k.paint(TOY.yellow), 1, 10, 58, 128, 0, 0.5, 8));
      g.add(clock(k, 9, 72, 90, 0));
      g.add(clock(k, 9, 44, 90, 0, Math.PI));
      g.add(k.box(k.paint(WIN), 1.6, 26, 12, 0.6, 72, 52, 0));
      g.add(k.peg(TOY.red, TOY.black, 82, 0, 30), k.peg(TOY.blue, null, 84, 0, -40));
      return g;
    },
    animate: animateClock,
  },
  {
    id: "bldg-mountain-station",
    name: "Mountain station",
    category: CAT,
    tags: ["station", "mountain", "chalet", "snow", "alpine", "balcony"],
    notes: "A chalet station with a stone ground floor, timber upper storey and a snow-capped roof. Sits at the top of a climb; trains that reach it could earn a bonus for a hill route.",
    build: (k) => {
      const g = platform(k, 90, 24, 0, 18, 13, 1);
      g.add(k.box(k.paint(STONE), 60, 16, 30, 1.5, -5, 0, -12));
      const upper = k.at(house(k, 60, 30, 24, k.paint(TOY.brown), TOY.red, 9, 0, 0, 8), -5, 16, -12);
      upper.add(k.roof(k.paint(TOY.white), 56, 42, 12, 0, 23.2 + 2.4, 0, 1.6));
      for (const x of [-18, 0, 18]) upper.add(winZ(k, x, 9, 15.4, 8, 9));
      g.add(upper);
      // Balcony on the upper storey.
      g.add(k.box(k.wood, 52, 2, 8, 0.5, -5, 20, 7));
      g.add(k.box(k.paint(TOY.brown), 52, 6, 1.2, 0.3, -5, 22, 10.6));
      g.add(doorZ(k, TOY.green, -5, 3.4, 10, 14));
      for (const x of [-25, 15]) g.add(winZ(k, x, 5, 3.4, 8, 7));
      g.add(chimney(k, -25, 46, -18, 12, STONE));
      g.add(pine(k, 36, -18, 44), pine(k, 44, -6, 34));
      g.add(nameBoard(k, 25, 22, 22, 13, TOY.red));
      return g;
    },
  },
  {
    id: "bldg-harbour-station",
    name: "Harbour station",
    category: CAT,
    tags: ["station", "harbour", "quay", "boat", "water", "jetty", "lifebuoy"],
    notes: "A seaside station on the quay with a jetty, bollards and a little boat bobbing at its mooring. Boat-train idea: passengers arriving by ferry want a train onward.",
    build: (k) => {
      const g = new Group();
      g.add(k.box(k.water, 140, 1.2, 50, 0.4, 0, 0, 50));
      g.add(platform(k, 140, 30, 0, -10, 13, -1));
      const b = k.at(house(k, 54, 22, 26, k.paint(TOY.white), TOY.blue, 10), -20, 13, -12);
      b.add(doorZ(k, TOY.blue, 0, 11.4, 10, 17));
      for (const x of [-17, 17]) b.add(winZ(k, x, 9, 11.2, 9, 9));
      for (const x of [-17, 0, 17]) b.add(winZ(k, x, 9, -11.2, 9, 9));
      g.add(b);
      // Jetty on piles.
      g.add(k.box(k.wood, 18, 3, 40, 0.6, 40, 10, 22));
      for (const z of [10, 26, 40]) for (const x of [33, 47]) g.add(k.cyl(k.paint(TOY.brown), 1.8, 11, x, 0, z, 1.8, 10));
      for (const x of [10, 60]) g.add(k.lathe(k.paint(TOY.black), [[0, 0], [3, 0], [2, 3], [2, 5], [3.4, 6], [0, 6.5]], x, 13, 3, 14));
      // Lifebuoy on a post.
      g.add(k.cyl(k.paint(TOY.white), 1.2, 22, -60, 13, 3, 1.2, 8));
      g.add(k.at(k.ring(k.paint(TOY.red), 5, 1.8, 0, 0, 0, true), -60, 30, 4.5));
      // The boat.
      const boat = named(new Group(), "boat");
      boat.add(k.lathe(k.paint(TOY.red), [[0, 0], [5, 0], [8, 6], [0, 6]], 0, 0, 0, 20));
      boat.children[0].scale.set(2.4, 1, 1);
      boat.add(k.box(k.paint(TOY.white), 12, 8, 10, 1.5, -2, 6, 0), k.cyl(k.paint(TOY.yellow), 2, 6, -2, 14, 0, 2, 10));
      g.add(k.at(boat, 72, 0, 46));
      g.add(lamp(k, 40, -20, 30, 13));
      return g;
    },
    animate: (root, t) => {
      for (const b of parts(root, "boat")) {
        b.position.y = 0.6 + Math.sin(t * 1.6) * 0.8;
        b.rotation.x = Math.sin(t * 1.1) * 0.06;
      }
    },
  },
  {
    id: "bldg-signal-box",
    name: "Signal box",
    category: CAT,
    tags: ["signal box", "levers", "signalman", "lineside", "stairs"],
    notes: "A two-storey signal box: brick base, glazed operating floor with a row of levers, outside stairs. In game it could be the place you tap to switch points and signals for its stretch of line.",
    build: (k) => {
      const g = new Group();
      g.add(k.box(k.paint(BRICK), 40, 26, 26, 1.5));
      for (const z of [-7, 7]) g.add(winX(k, 20, 9, z, 7, 8));
      g.add(k.box(k.paint(TOY.cream), 42, 22, 28, 1.5, 0, 26, 0));
      g.add(k.box(k.paint(WIN), 38, 12, 29, 0.4, 0, 31, 0));
      g.add(k.box(k.paint(WIN), 43, 12, 22, 0.4, 0, 31, 0));
      g.add(hip(k, k.paint(SLATE), 52, 12, 0, 48, 0));
      // Levers, visible through the glass.
      const reds = [TOY.red, TOY.red, TOY.yellow, TOY.blue, TOY.red];
      reds.forEach((c, i) => {
        const lever = new Group();
        lever.add(k.box(k.paint(c), 1.2, 10, 1.2, 0.3, 0, 0, 0));
        lever.name = i === 2 ? "lever" : "";
        g.add(k.at(lever, 15, 28, -8 + i * 4));
      });
      // Outside stairs and landing.
      for (let i = 0; i < 6; i++) g.add(k.box(k.wood, 8, 2, 4, 0.4, -12 + i * 4, i * 4.4, 17));
      g.add(k.box(k.wood, 12, 2, 8, 0.4, 14, 25, 17));
      g.add(doorZ(k, TOY.green, 14, 14, 8, 16).translateY(26));
      g.add(k.peg(TOY.blue, TOY.black, 8, 27, -2));
      return g;
    },
    animate: (root, t) => {
      for (const l of parts(root, "lever")) l.rotation.z = Math.max(0, Math.sin(t * 0.8)) * 0.7;
    },
  },
  {
    id: "bldg-ticket-booth",
    name: "Ticket booth",
    category: CAT,
    tags: ["ticket", "booth", "kiosk", "platform", "small"],
    notes: "A one-person ticket booth with a counter window. Tickets sold here could be the game's way of letting passengers queue for a route.",
    build: (k) => {
      const g = new Group();
      g.add(k.box(k.paint(TOY.red), 22, 28, 20, 2));
      g.add(k.box(k.paint(WIN), 1.6, 10, 14, 0.4, 11, 12, 0));
      g.add(k.box(k.wood, 5, 1.6, 16, 0.5, 12.5, 11, 0));
      g.add(k.box(k.paint(TOY.cream), 28, 3, 26, 1, 0, 28, 0));
      g.add(hip(k, k.paint(TOY.blue), 26, 8, 0, 31, 0));
      g.add(k.cyl(k.paint(TOY.yellow), 4, 1.2, 0, 39, 0, 4, 16));
      g.add(k.cylX(k.paint(TOY.yellow), 5, 1.2, 0, 46, 0, 20), k.cyl(k.paint(TOY.black), 0.8, 6, 0, 38, 0, 0.8, 6));
      g.add(k.peg(TOY.blue, TOY.red, 6, 2, 0));
      return g;
    },
  },
  {
    id: "bldg-waiting-shelter",
    name: "Waiting shelter",
    category: CAT,
    tags: ["shelter", "bench", "glass", "platform", "small"],
    notes: "A glass-sided shelter with a bench and a timetable board. Passengers wait longer without complaining when there's one at the stop.",
    build: (k) => {
      const g = new Group();
      const frame = k.paint(TOY.teal);
      g.add(k.box(k.glass, 36, 26, 1.5, 0.3, 0, 0, -9));
      for (const x of [-17.5, 17.5]) g.add(k.box(k.glass, 1.5, 26, 18, 0.3, x, 0, 0));
      for (const x of [-18, 18]) for (const z of [-9, 9]) g.add(k.cyl(frame, 1.2, 27, x, 0, z, 1.2, 10));
      const roof = k.box(frame, 42, 2.4, 24, 1, 0, 27, 0);
      roof.rotation.x = -0.1;
      g.add(roof);
      g.add(bench(k, 0, -4, 0, 0, TOY.teal));
      g.add(k.box(k.paint(TOY.cream), 10, 12, 1, 0.3, 10, 9, -8));
      g.add(k.peg(TOY.orange, null, -8, 6, -3));
      return g;
    },
  },
  {
    id: "bldg-platform-furnished",
    name: "Platform with benches and lamps",
    category: CAT,
    tags: ["platform", "bench", "lamp", "clock", "bin", "straight"],
    notes: "A long plain platform dressed with lamps, benches, a hanging clock and a bin. Lay several end to end beside a straight to build any length of station.",
    build: (k) => {
      const g = platform(k, 140, 26, 0, 0);
      for (const x of [-55, 0, 55]) g.add(lamp(k, x, -6, 32, 13));
      g.add(bench(k, -28, -6, 0, 13), bench(k, 28, -6, 0, 13));
      // Hanging clock on a bracket.
      g.add(k.cyl(k.paint(TOY.black), 1.2, 40, 0, 13, -9, 1.2, 8));
      g.add(k.box(k.paint(TOY.black), 2, 2, 10, 0.4, 0, 52, -5));
      g.add(clock(k, 5, 1.2, 46, 0), clock(k, 5, -1.2, 46, 0, Math.PI));
      g.add(k.cyl(k.paint(TOY.green), 3, 7, 62, 13, -6, 3.4, 14));
      g.add(k.peg(TOY.yellow, null, -10, 13, 2), k.peg(TOY.green, TOY.brown, 14, 13, -2));
      return g;
    },
    animate: animateClock,
  },
  {
    id: "bldg-station-clock",
    name: "Station clock",
    category: CAT,
    tags: ["clock", "post", "small", "time", "platform"],
    notes: "A two-faced clock on a turned post. Could show the game's timetable clock, ticking faster when you speed up time.",
    build: (k) => {
      const g = new Group();
      g.add(k.lathe(k.paint(TOY.green), [[0, 0], [5, 0], [5, 2], [2.5, 4], [1.8, 10], [1.8, 40], [3, 42], [0, 42]], 0, 0, 0, 20));
      g.add(k.cylZ(k.paint(TOY.green), 8, 6, 0, 50, 0, 24));
      g.add(clock(k, 6.5, 0, 50, 3.2, -Math.PI / 2), clock(k, 6.5, 0, 50, -3.2, Math.PI / 2));
      g.add(k.ball(k.paint(TOY.yellow), 2, 0, 59.5, 0));
      return g;
    },
    animate: animateClock,
  },

  // ——— Railway yard ———
  {
    id: "bldg-water-tower",
    name: "Water tower",
    category: CAT,
    tags: ["water", "tower", "tank", "steam", "spout", "yard"],
    notes: "A round tank on four legs with a swinging spout. Steam engines could need a drink every so many laps, adding a reason to route past it.",
    build: (k) => {
      const g = new Group();
      for (const [x, z] of [[-12, -12], [12, -12], [-12, 12], [12, 12]]) g.add(k.box(k.paint(TOY.black), 3.5, 44, 3.5, 0.8, x, 0, z));
      g.add(k.box(k.wood, 32, 4, 32, 1, 0, 42, 0));
      g.add(k.cyl(k.paint(TOY.green), 18, 22, 0, 46, 0, 18, 28));
      g.add(k.ring(k.paint(TOY.black), 18.2, 0.9, 0, 52, 0), k.ring(k.paint(TOY.black), 18.2, 0.9, 0, 62, 0));
      g.add(k.cone(k.paint(TOY.red), 20, 8, 0, 68, 0, 28));
      for (let i = 0; i < 8; i++) g.add(k.box(k.wood, 7, 1, 1, 0.2, -20, 4 + i * 5, 14));
      for (const x of [-23, -17]) g.add(k.box(k.wood, 1.2, 44, 1.2, 0.2, x, 0, 14));
      // Swinging spout.
      const spout = named(new Group(), "spout");
      spout.add(k.cylX(k.paint(TOY.black), 2.4, 26, 13, 0, 0, 12), k.cyl(k.paint(TOY.black), 2.6, 8, 26, -8, 0, 2.6, 12));
      g.add(k.at(spout, 14, 50, 0));
      return g;
    },
    animate: (root, t) => {
      for (const s of parts(root, "spout")) s.rotation.y = Math.sin(t * 0.7) * 0.9;
    },
  },
  {
    id: "bldg-coal-stage",
    name: "Coal stage",
    category: CAT,
    tags: ["coal", "fuel", "chute", "tubs", "yard", "steam"],
    notes: "A raised brick stage heaped with coal, with tubs and a tipping chute. Engines parked alongside refuel; it could also accept coal unloaded from hoppers.",
    build: (k) => {
      const g = new Group();
      g.add(k.box(k.paint(BRICK), 60, 26, 36, 1.5));
      g.add(k.box(k.wood, 64, 3, 40, 1, 0, 26, 0));
      // Ramp up the back.
      const ramp = k.box(k.wood, 40, 2.5, 16, 0.6, -44, 12, 0);
      ramp.rotation.z = 0.6;
      g.add(ramp);
      g.add(k.cone(k.coal, 14, 10, -10, 29, -4, 18));
      for (let i = 0; i < 7; i++) g.add(k.ball(k.coal, 3 + (i % 3), -18 + i * 5, 30, 8 - (i % 2) * 4));
      for (const x of [10, 22]) {
        g.add(k.box(k.paint(TOY.grey), 9, 7, 8, 1, x, 29, -6));
        g.add(k.box(k.coal, 8, 2, 7, 0.6, x, 35.5, -6));
      }
      // Chute over the track side (+z).
      const chute = named(new Group(), "chute");
      chute.add(k.box(k.paint(TOY.black), 12, 1.4, 20, 0.4, 0, 0, 10));
      chute.add(k.box(k.paint(TOY.black), 1.2, 4, 20, 0.3, -6, 0, 10), k.box(k.paint(TOY.black), 1.2, 4, 20, 0.3, 6, 0, 10));
      g.add(k.at(chute, 16, 29, 18));
      g.add(k.peg(TOY.black, TOY.black, -2, 29, 12));
      return g;
    },
    animate: (root, t) => {
      for (const c of parts(root, "chute")) c.rotation.x = 0.2 + Math.max(0, Math.sin(t * 0.9)) * 0.5;
    },
  },
  {
    id: "bldg-engine-shed",
    name: "Engine shed (2-road)",
    category: CAT,
    tags: ["engine shed", "depot", "two road", "doors", "yard", "storage"],
    notes: "A brick shed with two roads under a smoke-vented roof and swinging doors. Parking engines out of sight; trains inside could be saved between sessions.",
    build: (k) => {
      const g = new Group();
      const brick = k.paint(BRICK);
      for (const z of [-26, 26]) g.add(k.trackSlab(140, 12, 0, z));
      for (const z of [-54, 54]) g.add(k.box(brick, 106, 60, 4, 1, 0, 0, z));
      g.add(k.box(brick, 4, 60, 112, 1, -51, 0, 0));
      // Front wall with two arched openings.
      const s = new Shape();
      s.moveTo(-56, 0);
      s.lineTo(-48, 0);
      s.lineTo(-48, 32);
      s.absarc(-26, 32, 22, Math.PI, 0, true);
      s.lineTo(-4, 0);
      s.lineTo(4, 0);
      s.lineTo(4, 32);
      s.absarc(26, 32, 22, Math.PI, 0, true);
      s.lineTo(48, 0);
      s.lineTo(56, 0);
      s.lineTo(56, 60);
      s.lineTo(-56, 60);
      s.closePath();
      g.add(k.at(k.extrude(brick, s, 4, 0, 0, 0, 0.6), 51, 0, 0, Math.PI / 2));
      g.add(gable(k, brick, 104, 112, 26, 0, 60, 0));
      const drop = (2 * 5 * 26) / 112;
      g.add(k.roof(k.paint(SLATE), 114, 122, 26 + drop, 0, 60 - drop + 1.4, 0));
      g.add(k.box(k.paint(SLATE), 70, 6, 12, 1, 0, 86, 0));
      g.add(k.box(k.paint(SLATE), 76, 2, 18, 0.6, 0, 92, 0));
      for (const x of [-30, 0, 30]) g.add(winZ(k, x, 30, 56, 10, 12), winZ(k, x, 30, -56, 10, 12));
      // Doors: two leaves per road, hinged at the opening's sides, swinging out.
      for (const zc of [-26, 26]) {
        const l = named(new Group(), "leafL");
        l.add(k.box(k.paint(TOY.green), 2, 44, 22, 0.6, 0, 0, 11));
        g.add(k.at(l, 55, 0, zc - 22));
        const r = named(new Group(), "leafR");
        r.add(k.box(k.paint(TOY.green), 2, 44, 22, 0.6, 0, 0, -11));
        g.add(k.at(r, 55, 0, zc + 22));
      }
      return g;
    },
    animate: (root, t) => {
      const a = (0.5 - 0.5 * Math.cos(t * 0.6)) * 1.5;
      for (const l of parts(root, "leafL")) l.rotation.y = a;
      for (const r of parts(root, "leafR")) r.rotation.y = -a;
    },
  },
  {
    id: "bldg-roundhouse-segment",
    name: "Roundhouse segment",
    category: CAT,
    tags: ["roundhouse", "turntable", "stalls", "depot", "engine", "modular"],
    notes: "Three engine stalls fanned round a turntable's centre, each with its own track and smoke jack. Clip several segments round a turntable for a full roundhouse.",
    build: (k) => {
      const g = new Group();
      const brick = k.paint(BRICK);
      const pivotX = 150;
      for (const a of [-0.42, 0, 0.42]) {
        const stall = new Group();
        stall.add(k.trackSlab(100, -150, 0, 0));
        // Side walls and back, open front.
        for (const z of [-24, 24]) stall.add(k.box(brick, 80, 46, 3, 1, -150, 0, z));
        stall.add(k.box(brick, 3, 46, 51, 1, -189, 0, 0));
        stall.add(k.box(brick, 3, 12, 51, 1, -111, 34, 0));
        const roof = k.box(k.paint(SLATE), 88, 3, 56, 1, -150, 46, 0);
        roof.rotation.z = -0.08;
        stall.add(roof);
        stall.add(k.cyl(k.paint(TOY.black), 3, 14, -158, 49, 0, 2.4, 12), k.box(k.paint(TOY.black), 9, 1.5, 9, 0.4, -158, 63, 0));
        stall.rotation.y = a;
        stall.position.x = pivotX;
        g.add(stall);
      }
      return k.at(g, -60, 0, 0);
    },
  },
  {
    id: "bldg-goods-shed",
    name: "Goods shed",
    category: CAT,
    tags: ["goods", "freight", "shed", "crane", "crates", "loading dock", "sliding door"],
    notes: "A timber goods shed with a loading dock, a sliding door and a little hand crane. Wagons left at the dock could be loaded with crates for delivery to the town.",
    build: (k) => {
      const g = new Group();
      const b = house(k, 90, 40, 38, k.paint(TOY.brown), TOY.red, 14);
      g.add(b);
      g.add(winX(k, 45, 22, 0, 10, 10), winX(k, -45, 22, 0, 10, 10));
      g.add(k.box(k.paint(WIN), 34, 28, 1, 0.3, 0, 0, 20.2));
      const door = named(new Group(), "door");
      door.add(k.box(k.paint(TOY.cream), 34, 28, 2, 0.6, 0, 0, 0), k.box(k.paint(TOY.red), 2, 26, 2.6, 0.3, 0, 1, 0));
      g.add(k.at(door, 0, 0, 21.8));
      g.add(k.box(k.paint(TOY.cream), 80, 2, 3, 0.4, 0, 29, 21.5));
      g.add(k.box(k.wood, 100, 12, 18, 1.2, 0, 0, 30));
      g.add(crate(k, -38, 12, 30), crate(k, -28, 12, 33, 8, TOY.blue), crate(k, -36, 21, 31, 7, TOY.red));
      g.add(sack(k, 24, 12, 32), sack(k, 31, 12, 30), sack(k, 27, 18, 31));
      // Hand crane at the dock's end.
      const crane = named(new Group(), "jib");
      crane.add(k.cyl(k.paint(TOY.yellow), 2.4, 30, 0, 0, 0, 2, 12));
      const jib = k.box(k.paint(TOY.yellow), 28, 2.4, 2.4, 0.5, 12, 26, 0);
      jib.rotation.z = 0.25;
      crane.add(jib, k.cyl(k.paint(TOY.black), 0.4, 14, 25, 15, 0, 0.4, 6), k.box(k.paint(TOY.black), 3, 3, 3, 0.5, 25, 12, 0));
      g.add(k.at(crane, 45, 12, 32));
      return g;
    },
    animate: (root, t) => {
      for (const d of parts(root, "door")) d.position.x = (0.5 - 0.5 * Math.cos(t * 0.5)) * 34;
      for (const j of parts(root, "jib")) j.rotation.y = Math.sin(t * 0.4) * 1.6;
    },
  },
  {
    id: "bldg-warehouse",
    name: "Warehouse",
    category: CAT,
    tags: ["warehouse", "hoist", "loading doors", "brick", "storage", "freight"],
    notes: "A tall brick warehouse with stacked loading doors and a hoist lifting sacks to the top floor. Stores goods between deliveries: fill it by train, empty it by lorry.",
    build: (k) => {
      const g = new Group();
      g.add(k.box(k.paint(BRICK), 60, 96, 46, 2));
      g.add(gable(k, k.paint(BRICK), 59.5, 46, 14, 0, 96, 0));
      const drop = (2 * 4 * 14) / 46;
      g.add(k.roof(k.paint(SLATE), 68, 54, 14 + drop, 0, 96 - drop + 1.4, 0));
      for (let f = 0; f < 4; f++) {
        g.add(k.box(k.paint(TOY.green), 1.8, 16, 14, 0.5, 30, 4 + f * 23, 0));
        for (const z of [-15, 15]) g.add(winX(k, 30, 7 + f * 23, z, 8, 10));
        for (const x of [-18, 0, 18]) g.add(winZ(k, x, 7 + f * 23, 23, 8, 10));
      }
      // Hoist beam, rope and load.
      g.add(k.box(k.paint(TOY.black), 18, 3, 3, 0.6, 38, 100, 0));
      const rope = named(new Group(), "rope");
      rope.add(k.cyl(k.paint(TOY.cream), 0.5, 1, 0, 0, 0, 0.5, 6));
      g.add(k.at(rope, 44, 30, 0));
      const hook = named(new Group(), "hook");
      hook.add(sack(k, 0, -9, 0), k.box(k.paint(TOY.black), 2, 2, 2, 0.4, 0, -1.5, 0));
      g.add(k.at(hook, 44, 30, 0));
      return g;
    },
    animate: (root, t) => {
      const y = 22 + (0.5 - 0.5 * Math.cos(t * 0.6)) * 70;
      for (const h of parts(root, "hook")) h.position.y = y;
      for (const r of parts(root, "rope")) {
        r.position.y = y;
        r.scale.y = 100 - y;
      }
    },
  },

  // ——— Countryside ———
  {
    id: "bldg-farmhouse",
    name: "Farmhouse",
    category: CAT,
    tags: ["farm", "house", "porch", "countryside", "chimney"],
    notes: "A cream farmhouse with a red roof, a porch and two chimneys. The farm could send milk, eggs and grain to town by rail.",
    build: (k) => {
      const g = house(k, 60, 34, 36, k.paint(TOY.cream), TOY.red, 18);
      g.add(doorX(k, TOY.green, 30, 0, 10, 18));
      for (const z of [-10, 10]) g.add(winX(k, 30, 26, z));
      for (const z of [-11]) g.add(winX(k, 30, 8, z));
      for (const x of [-18, 0, 18]) g.add(winZ(k, x, 18, 17, 8, 10));
      g.add(chimney(k, -24, 46, 0, 14), chimney(k, 24, 46, 0, 14));
      // Porch.
      g.add(k.box(k.wood, 12, 2, 24, 0.6, 36, 0, 4));
      for (const z of [-7, 15]) g.add(k.cyl(k.paint(TOY.white), 1, 20, 41, 2, z, 1, 8));
      const pr = k.box(k.paint(TOY.red), 14, 2, 28, 0.6, 37, 22, 4);
      pr.rotation.z = -0.2;
      g.add(pr);
      return g;
    },
  },
  {
    id: "bldg-red-barn",
    name: "Red barn",
    category: CAT,
    tags: ["barn", "farm", "gambrel", "hay", "countryside"],
    notes: "A big red barn with a gambrel roof, white-crossed doors and a hay loft. Fill it with hay bales from a flat wagon at harvest time.",
    build: (k) => {
      const g = new Group();
      const red = k.paint(TOY.red);
      const w = 70;
      const a = 22;
      const h = 30;
      const pts: [number, number][] = [[-a, 0], [a, 0], [a, h], [a * 0.55, h + 16], [0, h + 24], [-a * 0.55, h + 16], [-a, h]];
      g.add(k.at(k.extrude(red, pts, w, 0, 0, 0, 0.8), 0, 0, 0, Math.PI / 2));
      const roof = k.paint(SLATE);
      const lift = 1.4;
      for (const s of [-1, 1]) {
        g.add(panel(k, roof, w + 4, s * (a + 3), h - 2 + lift, s * a * 0.55, h + 16 + lift));
        g.add(panel(k, roof, w + 4, s * a * 0.55, h + 16 + lift, 0, h + 24 + lift));
      }
      // Big doors with white crosses on the front gable end (+x).
      const white = k.paint(TOY.white);
      for (const z of [-7.5, 7.5]) {
        g.add(k.box(red, 1.6, 26, 15, 0.4, w / 2 + 0.8, 0, z));
        const c1 = k.box(white, 1, 32, 2, 0.2, w / 2 + 1.8, 13, z);
        c1.rotation.x = 0.55;
        const c2 = k.box(white, 1, 32, 2, 0.2, w / 2 + 1.8, 13, z);
        c2.rotation.x = -0.55;
        c1.position.y = c2.position.y = 13;
        g.add(c1, c2);
        g.add(k.box(white, 1.4, 26, 1.6, 0.2, w / 2 + 1.6, 0, z + 7.2), k.box(white, 1.4, 1.6, 16, 0.2, w / 2 + 1.6, 25, z));
      }
      const loft = named(new Group(), "loft");
      loft.add(k.box(k.paint(TOY.white), 1.6, 12, 12, 0.4, 0, 0, 6));
      g.add(k.box(k.paint(WIN), 1.2, 12, 12, 0.3, w / 2 + 0.4, 34, 0));
      g.add(k.at(loft, w / 2 + 1.2, 34, -6));
      g.add(k.cyl(k.paint("#e8cf6a"), 6, 10, w / 2 + 12, 0, 18, 6, 18));
      return g;
    },
    animate: (root, t) => {
      for (const l of parts(root, "loft")) l.rotation.y = (0.5 - 0.5 * Math.cos(t * 0.8)) * 1.4;
    },
  },
  {
    id: "bldg-silo",
    name: "Grain silo",
    category: CAT,
    tags: ["silo", "grain", "farm", "tall", "ladder", "chute"],
    notes: "A tall banded silo with a domed cap and a loading spout. Tip a hopper of grain in at harvest, or load wagons from its spout.",
    build: (k) => {
      const g = new Group();
      g.add(k.cyl(k.paint(STONE), 18, 6, 0, 0, 0, 18, 28));
      g.add(k.cyl(k.paint(TOY.sky), 16, 84, 0, 6, 0, 16, 28));
      for (let i = 1; i <= 4; i++) g.add(k.ring(k.paint(TOY.white), 16.2, 0.9, 0, 6 + i * 17, 0));
      g.add(k.ball(k.paint(TOY.red), 16.5, 0, 90, 0, 0.5));
      g.add(k.cyl(k.paint(TOY.red), 2, 5, 0, 97, 0, 1, 10));
      for (const z of [-3, 3]) g.add(k.box(k.paint(TOY.black), 1, 82, 1, 0.2, 16.5, 6, z));
      for (let i = 0; i < 14; i++) g.add(k.box(k.paint(TOY.black), 1, 0.8, 6, 0.2, 16.5, 10 + i * 5.5, 0));
      const spout = k.cylX(k.paint(TOY.grey), 2.5, 22, -24, 40, 0, 12);
      spout.rotation.z = Math.PI / 2 + 0.7;
      g.add(spout);
      return g;
    },
  },
  {
    id: "bldg-windmill",
    name: "Windmill",
    category: CAT,
    tags: ["windmill", "mill", "sails", "flour", "countryside", "animated"],
    notes: "A turned tower mill with a red cap and four lattice sails that turn in the breeze. Grain in, flour out: a stop on the bakery's supply line.",
    build: (k) => {
      const g = new Group();
      g.add(k.lathe(k.paint(TOY.cream), [[0, 0], [22, 0], [22, 3], [15, 64], [0, 64]], 0, 0, 0, 32));
      g.add(k.ring(k.paint(TOY.brown), 17, 1.6, 0, 40, 0));
      g.add(k.cyl(k.wood, 21, 2, 0, 38, 0, 21, 28));
      g.add(k.ball(k.paint(TOY.red), 16, 0, 64, 0, 0.75));
      g.add(doorX(k, TOY.green, 21.4, 0, 9, 16));
      for (const y of [24, 50]) g.add(winX(k, 22.3 - (7 * (y + 5)) / 61, y, 0, 6, 8));
      const sails = named(new Group(), "sails");
      sails.add(k.cylX(k.paint(TOY.red), 4, 6, 0, 0, 0, 16));
      for (let i = 0; i < 4; i++) {
        const arm = new Group();
        arm.add(k.box(k.wood, 1.8, 42, 2, 0.4, 0, 0, 0));
        arm.add(k.box(k.paint(TOY.white), 1.2, 30, 10, 0.4, 0.4, 10, 5.5));
        for (let j = 0; j < 4; j++) arm.add(k.box(k.wood, 1.6, 1, 11, 0.2, 0.8, 12 + j * 9, 5.5));
        arm.rotation.x = (i * Math.PI) / 2;
        sails.add(arm);
      }
      g.add(k.at(sails, 17, 66, 0));
      return g;
    },
    animate: (root, t) => {
      for (const s of parts(root, "sails")) s.rotation.x = t * 1.1;
    },
  },
  {
    id: "bldg-watermill",
    name: "Watermill",
    category: CAT,
    tags: ["watermill", "mill", "water wheel", "river", "animated"],
    notes: "A stone mill beside its own mill race, its paddle wheel turning in the stream. Place it where the river meets the line and it grinds grain sent by rail.",
    build: (k) => {
      const g = new Group();
      const b = house(k, 56, 34, 34, k.paint(STONE), TOY.brown, 16);
      b.add(doorX(k, TOY.red, 28, 0, 10, 18));
      for (const z of [-11, 11]) b.add(winX(k, 28, 24, z, 8, 9));
      b.add(winZ(k, -16, 20, -17), winZ(k, 16, 20, -17));
      g.add(b, chimney(k, -18, 46, -6));
      g.add(k.box(k.water, 80, 1.6, 18, 0.4, 0, 0, 30));
      const wheel = named(new Group(), "wheel");
      for (const z of [-4.5, 4.5]) wheel.add(k.ring(k.paint(TOY.red), 19, 1.4, 0, 0, z, true));
      wheel.add(k.cylZ(k.paint(TOY.black), 3, 14, 0, 0, 0, 14));
      for (let i = 0; i < 10; i++) {
        const p = new Group();
        p.add(k.box(k.wood, 8, 1.6, 10, 0.4, 0, 16.5, 0), k.box(k.paint(TOY.red), 1.2, 16, 1.2, 0.2, 0, 2, 0));
        p.rotation.z = (i * Math.PI * 2) / 10;
        wheel.add(p);
      }
      g.add(k.at(wheel, 0, 22, 27));
      g.add(k.cylZ(k.paint(TOY.black), 1.8, 10, 0, 22, 20, 10));
      return g;
    },
    animate: (root, t) => {
      for (const w of parts(root, "wheel")) w.rotation.z = -t * 0.8;
    },
  },
  {
    id: "bldg-lighthouse",
    name: "Lighthouse",
    category: CAT,
    tags: ["lighthouse", "coast", "harbour", "light", "striped", "animated"],
    notes: "A red-and-white striped lighthouse on a stone base, its beam sweeping round and lamp blinking. A landmark for the harbour; its light could flash at night-time in game.",
    build: (k) => {
      const g = new Group();
      g.add(k.cyl(k.paint(STONE), 26, 6, 0, 0, 0, 24, 24));
      g.add(k.lathe(k.paint(TOY.white), [[0, 6], [15, 6], [10.5, 88], [0, 88]], 0, 0, 0, 28));
      const rAt = (y: number) => 15 - (4.5 * (y - 6)) / 82;
      for (const y0 of [18, 44, 70]) g.add(k.cyl(k.paint(TOY.red), rAt(y0) + 0.4, 12, 0, y0, 0, rAt(y0 + 12) + 0.4, 28));
      g.add(doorX(k, TOY.blue, 14.2, 0, 7, 12, 6));
      g.add(k.cyl(k.paint(TOY.black), 15, 2, 0, 88, 0, 15, 24));
      g.add(k.ring(k.paint(TOY.black), 14.5, 0.6, 0, 95, 0));
      for (let i = 0; i < 8; i++) g.add(k.cyl(k.paint(TOY.black), 0.5, 7, 14.5 * Math.cos((i * Math.PI) / 4), 89, 14.5 * Math.sin((i * Math.PI) / 4), 0.5, 6));
      g.add(k.cyl(k.glass, 8, 14, 0, 90, 0, 8, 20));
      const light = named(k.ball(k.paint("#ffe36b"), 4.5, 0, 97, 0), "light");
      g.add(light);
      g.add(k.cone(k.paint(TOY.red), 10, 9, 0, 104, 0, 20), k.ball(k.paint(TOY.black), 1.6, 0, 113.5, 0));
      const beam = named(new Group(), "beam");
      const cone = k.cone(k.paint("#fff3b0"), 5, 26, 0, 0, 0, 14);
      cone.rotation.z = Math.PI / 2;
      cone.position.set(18, 0, 0);
      beam.add(cone);
      g.add(k.at(beam, 0, 97, 0));
      return g;
    },
    animate: (root, t) => {
      for (const b of parts(root, "beam")) b.rotation.y = t * 1.4;
      for (const l of parts(root, "light")) l.visible = (t * 1.5) % 1 < 0.6;
    },
  },

  // ——— Town ———
  {
    id: "bldg-fire-station",
    name: "Fire station",
    category: CAT,
    tags: ["fire station", "emergency", "doors", "bell", "hose tower", "town"],
    notes: "A two-bay fire station with roll-up doors, a hose tower and a brass bell. Its doors open when a fire engine is called out; a fire wagon on rails could answer too.",
    build: (k) => {
      const g = new Group();
      g.add(k.box(k.paint(BRICK), 56, 44, 44, 2));
      g.add(k.box(k.paint(TOY.cream), 60, 4, 48, 1, 0, 44, 0));
      for (const z of [-11.5, 11.5]) {
        g.add(k.box(k.paint(WIN), 1.4, 28, 19, 0.3, 28.2, 0, z));
        const d = named(new Group(), "door");
        d.add(k.box(k.paint(TOY.red), 1.8, 28, 19, 0.5, 0, 0, 0));
        for (const y of [7, 14, 21]) d.add(k.box(k.paint(TOY.white), 2.2, 0.8, 18, 0.2, 0, y, 0));
        g.add(k.at(d, 29.4, 0, z));
      }
      g.add(k.box(k.paint(TOY.white), 2, 6, 40, 0.5, 29, 32, 0));
      g.add(k.box(k.paint(TOY.red), 2.4, 3, 30, 0.4, 29.4, 33.5, 0));
      // Hose tower at the back.
      g.add(k.box(k.paint(BRICK), 18, 76, 18, 2, -22, 0, -14));
      g.add(hip(k, k.paint(TOY.red), 22, 10, -22, 76, -14));
      for (const y of [52, 64]) g.add(winX(k, -13, y, -14, 6, 8));
      // Bell on a bracket.
      g.add(k.box(k.paint(TOY.black), 6, 1.5, 1.5, 0.3, 31, 40, -18));
      g.add(k.lathe(k.paint(TOY.yellow), [[0, 0], [3.6, 0], [3, 2], [2, 5], [0, 5.6]], 34, 34, -18, 16));
      return g;
    },
    animate: (root, t) => {
      const lift = Math.min(1, Math.max(0, Math.sin(t * 0.6) * 1.5)) * 22;
      for (const d of parts(root, "door")) d.position.y = lift;
    },
  },
  {
    id: "bldg-police-station",
    name: "Police station",
    category: CAT,
    tags: ["police", "station", "blue lamp", "town", "emergency"],
    notes: "A tidy blue-trimmed police station with a blinking blue lamp over the door. A police car could be called from here when a level crossing is blocked.",
    build: (k) => {
      const g = house(k, 56, 36, 38, k.paint(TOY.white), TOY.blue, 14);
      g.add(doorX(k, TOY.blue, 28, 0, 11, 20));
      g.add(k.box(k.paint(TOY.blue), 4, 2, 22, 0.5, 30, 20, 0));
      for (const z of [-12, 12]) g.add(winX(k, 28, 10, z, 7, 9), winX(k, 28, 28, z, 7, 9));
      g.add(winX(k, 28, 28, 0, 7, 9));
      g.add(k.box(k.paint(TOY.blue), 2, 4, 50, 0.4, 28.4, 35, 0));
      g.add(k.box(k.paint(TOY.white), 2.2, 2, 30, 0.4, 28.8, 36, 0));
      g.add(k.box(k.paint(TOY.black), 6, 1.5, 1.5, 0.3, 31, 24, 0));
      g.add(k.box(k.paint("#3a4f80"), 4, 5, 4, 1, 34, 23, 0));
      g.add(named(k.box(k.paint("#5ea8ff"), 4.4, 3.4, 4.4, 1, 34, 23.8, 0), "blue"));
      g.add(chimney(k, -18, 44, 8));
      g.add(k.peg(TOY.blue, TOY.blue, 38, 0, 12));
      return g;
    },
    animate: (root, t) => {
      for (const b of parts(root, "blue")) b.visible = (t * 2) % 1 < 0.5;
    },
  },
  {
    id: "bldg-post-office",
    name: "Post office",
    category: CAT,
    tags: ["post office", "mail", "letters", "post box", "town"],
    notes: "A red-trimmed post office with a pillar box outside and an envelope sign. Mail sacks loaded here could ride a mail van to every station on the line.",
    build: (k) => {
      const g = house(k, 52, 34, 34, k.paint(TOY.cream), TOY.red, 14);
      g.add(k.box(k.paint(TOY.red), 2, 4, 34, 0.5, 26.4, 22, 0));
      g.add(doorX(k, TOY.red, 26, -10, 10, 18));
      g.add(k.box(k.paint(WIN), 1.6, 14, 18, 0.4, 26, 4, 8));
      g.add(winX(k, 26, 28, -8, 8, 7), winX(k, 26, 28, 8, 8, 7));
      // Envelope sign.
      g.add(k.box(k.paint(TOY.white), 2, 9, 14, 0.4, 28, 40, 0));
      for (const s of [-1, 1]) {
        const flap = k.box(k.paint(TOY.red), 2.4, 0.8, 8.4, 0.2, 28.2, 46, s * 3.4);
        flap.rotation.x = s * 0.6;
        g.add(flap);
      }
      // Pillar box.
      g.add(k.cyl(k.paint(TOY.red), 3.6, 18, 36, 0, 14, 3.6, 18), k.ball(k.paint(TOY.red), 3.8, 36, 18, 14, 0.6));
      g.add(k.box(k.paint(TOY.black), 1, 1, 4, 0.2, 39.4, 14, 14));
      g.add(chimney(k, 16, 44, -6));
      return g;
    },
  },
  {
    id: "bldg-bakery",
    name: "Bakery",
    category: CAT,
    tags: ["bakery", "bread", "shop", "awning", "chimney", "town", "smoke"],
    notes: "A bakery with a striped awning, a giant loaf on the roof and a smoking oven chimney. It wants flour from the mill and sends bread to the café.",
    build: (k) => {
      const g = house(k, 46, 32, 34, k.paint(TOY.cream), TOY.brown, 13);
      g.add(doorX(k, TOY.brown, 23, 10, 9, 18));
      g.add(k.box(k.paint(WIN), 1.6, 12, 16, 0.4, 23, 5, -6));
      g.add(awningX(k, 23, 24, 0, 32, TOY.orange, TOY.cream));
      g.add(winX(k, 23, 30, 0, 9, 7));
      g.add(chimney(k, -14, 42, 6, 16), smoke(k, -14, 60, 6));
      // Giant loaf on the ridge.
      const loaf = k.ball(k.paint("#c98a46"), 9, 4, 54, 0, 0.55);
      loaf.scale.x = 1.7;
      g.add(loaf);
      for (const x of [-6, 0, 6]) g.add(k.box(k.paint("#e8c48a"), 1.2, 1, 9, 0.2, 4 + x, 58.4, 0));
      return g;
    },
    animate: animateSmoke,
  },
  {
    id: "bldg-cafe",
    name: "Café",
    category: CAT,
    tags: ["cafe", "tea", "tables", "umbrella", "awning", "town"],
    notes: "A little café with an awning and two outside tables under parasols. Passengers waiting for a late train could drift over for a cup of tea.",
    build: (k) => {
      const g = house(k, 40, 30, 30, k.paint(TOY.green), TOY.cream, 12);
      g.add(doorX(k, TOY.cream, 20, -8, 9, 17));
      g.add(k.box(k.paint(WIN), 1.6, 12, 12, 0.4, 20, 5, 6));
      g.add(awningX(k, 20, 23, 0, 28, TOY.green, TOY.cream));
      // Cup sign on the gable.
      g.add(k.lathe(k.paint(TOY.white), [[0, 0], [2.4, 0], [3.4, 5], [0, 5]], 21.5, 30, 0, 14), k.ring(k.paint(TOY.white), 1.6, 0.6, 21.5, 33, 3.2, true));
      for (const [x, z, c] of [[36, -10, TOY.red], [36, 12, TOY.yellow]] as const) {
        g.add(k.cyl(k.wood, 5, 1, x, 9, z, 5, 18), k.cyl(k.paint(TOY.black), 0.8, 9, x, 0, z, 0.8, 8));
        g.add(k.cyl(k.paint(TOY.white), 0.5, 26, x, 0, z, 0.5, 6), k.cone(k.paint(c), 11, 5, x, 24, z, 8));
        g.add(k.box(k.wood, 4, 5, 4, 0.6, x + 8, 0, z), k.box(k.wood, 4, 5, 4, 0.6, x - 8, 0, z));
      }
      g.add(k.peg(TOY.pink, null, 44, 0, -10));
      return g;
    },
  },
  {
    id: "bldg-school",
    name: "School with bell",
    category: CAT,
    tags: ["school", "bell", "cupola", "playground", "town", "animated"],
    notes: "A yellow schoolhouse with a bell swinging in its cupola. The bell could ring at the school run, when children want the morning train.",
    build: (k) => {
      const g = house(k, 70, 34, 32, k.paint(TOY.yellow), TOY.red, 15);
      g.add(doorX(k, TOY.blue, 35, 0, 11, 20));
      for (const z of [-11, 11]) g.add(winX(k, 35, 18, z, 7, 12));
      for (const x of [-24, -8, 8, 24]) g.add(winZ(k, x, 14, 17.2, 9, 14));
      // Cupola on the ridge.
      const white = k.paint(TOY.white);
      g.add(k.box(white, 14, 6, 14, 1, 0, 43, 0));
      for (const [x, z] of [[-5.5, -5.5], [5.5, -5.5], [-5.5, 5.5], [5.5, 5.5]]) g.add(k.box(white, 2, 12, 2, 0.4, x, 49, z));
      g.add(hip(k, k.paint(TOY.red), 17, 9, 0, 61, 0), k.cyl(k.paint(TOY.yellow), 0.6, 6, 0, 69, 0, 0.4, 6));
      const bell = named(new Group(), "bell");
      bell.add(k.lathe(k.paint(TOY.yellow), [[0, -8], [4, -8], [3.4, -6], [2.4, -2], [0, -1]], 0, 0, 0, 16), k.ball(k.paint(TOY.black), 1, 0, -8.4, 0));
      g.add(k.at(bell, 0, 60, 0));
      // Playground fence along the front, open at the gate in front of the door.
      for (const z of [-30, -20, -10, 10, 20, 30]) g.add(k.box(white, 1.6, 9, 1.6, 0.3, 42, 0, z));
      for (const z of [-20, 20]) g.add(k.box(white, 1.4, 1.6, 21.6, 0.3, 42, 6, z));
      // Gateposts, a little taller, either side of the opening.
      for (const z of [-8, 8]) g.add(k.box(k.paint(TOY.blue), 2.2, 12, 2.2, 0.4, 42, 0, z));
      g.add(k.peg(TOY.red, null, 40, 0, -38), k.peg(TOY.blue, null, 48, 0, 32));
      return g;
    },
    animate: (root, t) => {
      for (const b of parts(root, "bell")) b.rotation.x = Math.sin(t * 3) * 0.6;
    },
  },
  {
    id: "bldg-church",
    name: "Church",
    category: CAT,
    tags: ["church", "spire", "tower", "rose window", "village"],
    notes: "A village church: a long nave and a stone tower with a tall spire and a rose window. A landmark you can see across the layout; wedding specials could run on Saturdays.",
    build: (k) => {
      const g = new Group();
      const n = k.at(house(k, 70, 34, 34, k.paint(STONE), SLATE, 22), -14, 0, 0);
      for (const x of [-26, -10, 6, 22]) n.add(winZ(k, x, 12, 17.2, 7, 16), winZ(k, x, 12, -17.2, 7, 16));
      g.add(n);
      g.add(k.box(k.paint(STONE), 26, 70, 26, 2, 30, 0, 0));
      g.add(k.box(k.paint(TOY.cream), 30, 3, 30, 1, 30, 70, 0));
      g.add(hip(k, k.paint(SLATE), 26, 54, 30, 73, 0));
      g.add(k.cyl(k.paint(TOY.yellow), 0.8, 12, 30, 124, 0, 0.8, 8), k.box(k.paint(TOY.yellow), 1.6, 1.6, 7, 0.3, 30, 132, 0));
      const door = k.extrude(k.paint(TOY.red), new Shape().moveTo(-6, 0).lineTo(6, 0).lineTo(6, 14).absarc(0, 14, 6, 0, Math.PI, false).lineTo(-6, 0), 2, 0, 0, 0, 0.3);
      g.add(k.at(door, 43.2, 0, 0, Math.PI / 2));
      g.add(k.cylX(k.paint(TOY.blue), 6, 1.6, 43.2, 40, 0, 20), k.cylX(k.paint(TOY.yellow), 2.2, 2, 43.4, 40, 0, 12));
      for (const z of [-5, 5]) g.add(k.box(k.paint(WIN), 1.6, 10, 4, 0.4, 43, 56, z));
      return g;
    },
  },
  {
    id: "bldg-town-hall",
    name: "Town hall",
    category: CAT,
    tags: ["town hall", "civic", "columns", "clock", "flag", "pediment"],
    notes: "A columned town hall with a clock turret and a flag. The heart of a town: its requests (passengers, coal, bread) could set the layout's goals.",
    build: (k) => {
      const g = new Group();
      const cream = k.paint(TOY.cream);
      g.add(k.box(k.paint(STONE), 70, 4, 80, 1, 0, 0, 0));
      g.add(k.box(cream, 50, 40, 76, 2, -8, 4, 0));
      g.add(k.box(k.paint(TOY.blue), 54, 3, 80, 1, -8, 44, 0));
      for (const z of [-30, -18, 18, 30]) g.add(winX(k, 17, 26, z, 7, 10), winX(k, 17, 10, z, 7, 10));
      // Portico.
      for (const z of [-15, -5, 5, 15]) g.add(k.lathe(k.paint(TOY.white), [[0, 0], [3, 0], [3, 1.5], [2.2, 2.5], [2.2, 34], [3, 35], [3, 36], [0, 36]], 26, 4, z, 16));
      g.add(k.box(cream, 14, 3, 42, 0.8, 23, 40, 0));
      g.add(k.at(gable(k, cream, 14, 42, 10, 0, 0, 0), 23, 43, 0, 0));
      g.add(doorX(k, TOY.blue, 17, 0, 12, 22, 4));
      // Clock turret and flag.
      g.add(k.box(cream, 22, 22, 22, 2, -8, 47, 0));
      g.add(clock(k, 7, 3.4, 58, 0));
      g.add(k.ball(k.paint(TOY.teal), 11, -8, 69, 0, 0.8));
      g.add(k.cyl(k.paint(TOY.black), 0.8, 26, -8, 76, 0, 0.6, 8));
      const flag = named(new Group(), "flag");
      flag.add(k.box(k.paint(TOY.red), 14, 8, 0.8, 0.2, 7, 0, 0), k.box(k.paint(TOY.yellow), 14.2, 2, 1, 0.2, 7, 3, 0));
      g.add(k.at(flag, -8, 93, 0));
      return g;
    },
    animate: (root, t) => {
      animateClock(root, t);
      for (const f of parts(root, "flag")) f.rotation.y = Math.sin(t * 2.2) * 0.35;
    },
  },
  {
    id: "bldg-castle-gate",
    name: "Castle gate",
    category: CAT,
    tags: ["castle", "gate", "portcullis", "towers", "tunnel", "animated"],
    notes: "Two round towers and a crenellated wall with a portcullis the track runs through. The portcullis must be raised before a train can pass: a toll gate or a timing puzzle.",
    build: (k) => {
      const g = new Group();
      const stone = k.paint(STONE);
      g.add(k.trackSlab(80));
      const s = new Shape();
      s.moveTo(-40, 0);
      s.lineTo(-25, 0);
      s.lineTo(-25, 38);
      s.absarc(0, 38, 25, Math.PI, 0, true);
      s.lineTo(25, 0);
      s.lineTo(40, 0);
      s.lineTo(40, 80);
      s.lineTo(-40, 80);
      s.closePath();
      g.add(k.at(k.extrude(stone, s, 16, 0, 0, 0, 0.8), 0, 0, 0, Math.PI / 2));
      for (let i = 0; i < 5; i++) for (const x of [-6, 6]) g.add(k.box(stone, 4, 6, 7, 0.8, x, 80, -32 + i * 16));
      for (const z of [-46, 46]) {
        g.add(k.cyl(stone, 20, 100, 0, 0, z, 19, 28));
        for (let i = 0; i < 8; i++) {
          const a = (i * Math.PI) / 4;
          g.add(k.box(stone, 6, 7, 6, 0.8, 17 * Math.cos(a), 100, z + 17 * Math.sin(a)));
        }
        g.add(winX(k, 19.4, 60, z, 3, 10), k.cyl(k.paint(TOY.black), 0.8, 18, 0, 100, z, 0.6, 8));
        g.add(k.at(k.extrude(k.paint(z < 0 ? TOY.blue : TOY.red), [[0, 0], [12, 3], [0, 7]], 0.8, 0, 0, 0, 0.2), 0, 110, z));
      }
      const port = named(new Group(), "portcullis");
      const black = k.paint(TOY.black);
      for (let i = 0; i < 6; i++) port.add(k.box(black, 1.6, 52, 1.6, 0.3, 0, 0, -21 + i * 8.4));
      for (const y of [12, 26, 40]) port.add(k.box(black, 1.6, 1.6, 48, 0.3, 0, y, 0));
      g.add(k.at(port, 10, 0, 0));
      return g;
    },
    animate: (root, t) => {
      const lift = Math.min(1, Math.max(0, Math.sin(t * 0.5) * 1.4 + 0.3)) * 48;
      for (const p of parts(root, "portcullis")) p.position.y = lift;
    },
  },
  {
    id: "bldg-factory",
    name: "Factory with chimney",
    category: CAT,
    tags: ["factory", "chimney", "sawtooth roof", "industry", "smoke"],
    notes: "A brick works under a sawtooth roof with a tall banded chimney puffing smoke. Takes in coal and timber by rail and sends out boxes of toys.",
    build: (k) => {
      const g = new Group();
      g.add(k.box(k.paint(BRICK), 96, 30, 60, 2));
      const pts: [number, number][] = [[-48, 0], [48, 0], [48, 16]];
      for (let i = 3; i >= 0; i--) {
        const x0 = -48 + i * 24;
        pts.push([x0, 2], [x0, 16]);
      }
      pts.pop();
      g.add(k.extrude(k.paint(SLATE), pts, 62, 0, 30, 0, 0.6));
      for (let i = 0; i < 4; i++) g.add(k.box(k.paint(TOY.sky), 1.2, 12, 56, 0.3, -48 + (i + 1) * 24 - 0.8, 32, 0));
      for (const x of [-34, -12, 12, 34]) g.add(winZ(k, x, 12, 30, 12, 12));
      g.add(k.box(k.paint(TOY.blue), 1.8, 22, 22, 0.6, 48, 0, 0));
      g.add(k.box(k.paint(TOY.yellow), 2.4, 3, 30, 0.5, 48.4, 25, 0));
      g.add(k.lathe(k.paint(BRICK), [[0, 0], [9, 0], [9, 4], [6, 120], [7.5, 122], [7.5, 126], [0, 126]], -36, 0, -14, 20));
      for (const y of [40, 80]) g.add(k.cyl(k.paint(TOY.white), 8.1 - (y / 120) * 3 + 0.2, 4, -36, y, -14, 8.1 - ((y + 4) / 120) * 3 + 0.2, 20));
      g.add(smoke(k, -36, 130, -14));
      return g;
    },
    animate: animateSmoke,
  },
  {
    id: "bldg-sawmill",
    name: "Sawmill",
    category: CAT,
    tags: ["sawmill", "timber", "logs", "saw", "industry", "animated"],
    notes: "An open-sided sawmill with a spinning saw, a log pile and a stack of sawn planks. Unload a timber wagon here and it turns logs into planks for the toy factory.",
    build: (k) => {
      const g = new Group();
      for (const x of [-30, 0, 30]) for (const z of [-18, 18]) g.add(k.box(k.paint(TOY.brown), 4, 34, 4, 0.8, x, 0, z));
      g.add(gable(k, k.paint(TOY.brown), 66, 40, 12, 0, 34, 0));
      const drop = (2 * 5 * 12) / 40;
      g.add(k.roof(k.paint(TOY.green), 76, 50, 12 + drop, 0, 34 - drop + 1.4, 0));
      // Saw bench.
      g.add(k.box(k.wood, 40, 10, 12, 1, 0, 0, 0));
      g.add(k.cylX(k.wood, 3.5, 30, -6, 13.5, 0, 14));
      const blade = named(new Group(), "blade");
      blade.add(k.cylZ(k.metal, 9, 1, 0, 0, 0, 20), k.cylZ(k.paint(TOY.red), 2.5, 2, 0, 0, 0, 12));
      g.add(k.at(blade, 10, 10, 0));
      // Logs and planks.
      for (let i = 0; i < 3; i++) g.add(k.cylX(k.wood, 4, 34, -10, 4, 26 + i * 8.5, 14));
      for (let i = 0; i < 2; i++) g.add(k.cylX(k.wood, 4, 34, -10, 11.5, 30 + i * 8.5, 14));
      for (let i = 0; i < 4; i++) g.add(k.box(k.wood, 34, 2, 12, 0.3, 50, i * 2.4, -4 + (i % 2)));
      g.add(k.peg(TOY.red, TOY.yellow, -4, 0, -10));
      return g;
    },
    animate: (root, t) => {
      for (const b of parts(root, "blade")) b.rotation.z = -t * 12;
    },
  },
  {
    id: "bldg-dairy",
    name: "Dairy",
    category: CAT,
    tags: ["dairy", "milk", "churns", "farm", "loading stand"],
    notes: "A white dairy with a giant milk bottle on the roof and a stand of churns ready for collection. A milk train stops each morning to load the churns.",
    build: (k) => {
      const g = house(k, 52, 32, 30, k.paint(TOY.white), TOY.blue, 13);
      g.add(doorX(k, TOY.blue, 26, -8, 10, 18));
      g.add(winX(k, 26, 12, 8, 9, 9));
      for (const x of [-12, 12]) g.add(winZ(k, x, 14, 16.2, 9, 9));
      g.add(k.lathe(k.paint(TOY.white), [[0, 0], [6, 0], [6, 10], [3, 15], [3, 18], [0, 18]], 0, 43, 0, 20), k.cyl(k.paint(TOY.blue), 3.4, 2.4, 0, 61, 0, 3.4, 16));
      // Churn stand.
      g.add(k.box(k.wood, 24, 9, 12, 1, 38, 0, 6));
      for (const z of [-2, 6, 14]) g.add(churn(k, 34, 9, z));
      g.add(churn(k, 42, 9, 2), churn(k, 42, 9, 10));
      return g;
    },
  },
  {
    id: "bldg-petrol-station",
    name: "Petrol station",
    category: CAT,
    tags: ["petrol", "fuel", "pumps", "canopy", "road", "garage"],
    notes: "A roadside filling station: two pumps under a canopy, a kiosk and a turning sign. Road vehicles refuel here; a tanker train could keep it supplied.",
    build: (k) => {
      const g = new Group();
      g.add(k.box(k.road, 70, 1, 60, 0.4, 0, 0, 0));
      for (const z of [-14, 14]) g.add(k.cyl(k.paint(TOY.white), 2, 34, 10, 1, z, 2, 12));
      g.add(k.box(k.paint(TOY.white), 34, 5, 44, 1.5, 10, 35, 0), k.box(k.paint(TOY.green), 35, 2, 45, 0.6, 10, 36.5, 0));
      for (const [z, c] of [[-8, TOY.red], [8, TOY.yellow]] as const) {
        g.add(k.box(k.wood, 8, 2, 8, 0.6, 10, 1, z));
        g.add(k.box(k.paint(c), 6, 16, 6, 1.2, 10, 3, z), k.box(k.paint(WIN), 6.4, 4, 3, 0.4, 10, 12, z));
        g.add(k.ring(k.paint(TOY.black), 3, 0.6, 13.5, 8, z, false));
      }
      g.add(k.at(house(k, 20, 18, 20, k.paint(TOY.cream), TOY.green, 6), -22, 1, -14));
      g.add(k.box(k.paint(WIN), 1.6, 9, 10, 0.4, -12, 7, -14));
      g.add(k.cyl(k.paint(TOY.grey), 1.6, 50, -28, 1, 20, 1.6, 10));
      const sign = named(new Group(), "sign");
      sign.add(k.cylX(k.paint(TOY.green), 9, 2, 0, 0, 0, 24), k.cylX(k.paint(TOY.yellow), 6, 2.4, 0, 0, 0, 20));
      g.add(k.at(sign, -28, 58, 20));
      return g;
    },
    animate: (root, t) => {
      for (const s of parts(root, "sign")) s.rotation.y = t * 0.8;
    },
  },
  {
    id: "bldg-market-stall",
    name: "Market stall",
    category: CAT,
    tags: ["market", "stall", "fruit", "canopy", "small", "town"],
    notes: "A striped market stall piled with fruit and veg, with a peg stallholder. Farm goods brought by train end up here on market day.",
    build: (k) => {
      const g = new Group();
      g.add(k.box(k.wood, 30, 12, 14, 1));
      for (const x of [-14, 14]) for (const z of [-6, 6]) g.add(k.cyl(k.wood, 0.9, 30, x, 0, z, 0.9, 8));
      for (let i = 0; i < 6; i++) {
        const s = k.box(k.paint(i % 2 ? TOY.white : TOY.blue), 5.4, 1.4, 20, 0.3, -13.5 + i * 5.4, 30, -1);
        s.rotation.x = 0.2;
        g.add(s);
      }
      const fruit = [TOY.red, TOY.orange, TOY.leaf, TOY.yellow, TOY.purple];
      for (let i = 0; i < 5; i++) {
        g.add(k.box(k.paint("#c99a5b"), 5.4, 2.4, 9, 0.5, -12 + i * 6, 12, 1));
        for (let j = 0; j < 3; j++) g.add(k.ball(k.paint(fruit[i]), 1.7, -12 + i * 6 + (j - 1) * 1.7, 15.6, 1 + (j - 1) * 2.4));
      }
      g.add(k.peg(TOY.green, TOY.red, 0, 0, -12));
      g.add(crate(k, 20, 0, 8, 7), crate(k, 20, 7, 8, 6, TOY.leaf));
      return g;
    },
  },
  {
    id: "bldg-cottage-row",
    name: "Cottage row",
    category: CAT,
    tags: ["cottages", "terrace", "houses", "village", "chimneys"],
    notes: "Three terraced cottages in different colours, each with its own door and chimney. Houses make passengers: the more homes near a station, the busier it gets.",
    build: (k) => {
      const g = new Group();
      const cols = [TOY.pink, TOY.sky, TOY.yellow];
      const roofs = [TOY.red, TOY.blue, TOY.green];
      for (let i = 0; i < 3; i++) {
        const x = -34 + i * 34;
        const c = k.at(house(k, 34, 30, 30 + (i % 2) * 4, k.paint(cols[i]), roofs[i], 13, 0, 0, 3), x, 0, 0);
        const h = 30 + (i % 2) * 4;
        c.add(doorZ(k, [TOY.green, TOY.red, TOY.blue][i], -6, 15, 8, 16));
        c.add(winZ(k, 8, 8, 15, 8, 8), winZ(k, -6, h - 10, 15, 8, 7), winZ(k, 8, h - 10, 15, 8, 7));
        c.add(chimney(k, 12, h + 6, -4, 12));
        g.add(c);
      }
      return k.at(g, 0, 0, 0, Math.PI / 2);
    },
  },
  {
    id: "bldg-apartment-block",
    name: "Apartment block",
    category: CAT,
    tags: ["apartments", "flats", "city", "balconies", "tall"],
    notes: "A four-storey block of flats with balconies and a roof hut. Lots of people in a small footprint: a city station beside it never runs out of passengers.",
    build: (k) => {
      const g = new Group();
      g.add(k.box(k.paint(TOY.cream), 60, 104, 48, 2));
      g.add(k.box(k.paint(TOY.teal), 64, 4, 52, 1, 0, 104, 0));
      g.add(k.box(k.paint(TOY.cream), 16, 10, 14, 1.5, -12, 108, -8));
      for (let f = 0; f < 4; f++) {
        const y = 12 + f * 24;
        for (const z of [-16, 0, 16]) g.add(winX(k, 30, y, z, 8, 12));
        for (const x of [-18, 0, 18]) g.add(winZ(k, x, y, 24, 8, 12));
        if (f > 0) {
          g.add(k.box(k.wood, 12, 2, 50, 0.5, 34, y - 4, 0));
          g.add(k.box(k.paint(TOY.orange), 1.4, 6, 50, 0.4, 39.4, y - 2, 0));
        }
      }
      g.add(doorX(k, TOY.teal, 30, 0, 12, 10, 0));
      g.add(k.box(k.paint(TOY.teal), 10, 2, 18, 0.5, 34, 14, 0));
      return g;
    },
  },
  {
    id: "bldg-hospital",
    name: "Hospital",
    category: CAT,
    tags: ["hospital", "red cross", "helipad", "ambulance", "town", "emergency"],
    notes: "A white hospital with a red cross, a covered entrance and a helipad on the roof. An ambulance coach on the train could bring patients from the countryside.",
    build: (k) => {
      const g = new Group();
      g.add(k.box(k.paint(TOY.white), 50, 58, 80, 2));
      g.add(k.box(k.paint(TOY.white), 40, 34, 30, 2, -40, 0, 0));
      for (let f = 0; f < 3; f++) for (const z of [-30, -18, 18, 30]) g.add(winX(k, 25, 10 + f * 17, z, 8, 9));
      for (let f = 0; f < 2; f++) for (const x of [-48, -32]) g.add(winZ(k, x, 10 + f * 14, 15, 8, 8));
      // Red cross.
      g.add(k.box(k.paint(TOY.red), 2, 14, 4.5, 0.4, 25.6, 40, 0), k.box(k.paint(TOY.red), 2, 4.5, 14, 0.4, 25.6, 44.75, 0));
      // Entrance canopy.
      g.add(k.box(k.paint(TOY.sky), 1.6, 18, 20, 0.4, 25.2, 0, 0));
      g.add(k.box(k.paint(TOY.red), 16, 2, 26, 0.6, 32, 20, 0));
      for (const z of [-11, 11]) g.add(k.cyl(k.paint(TOY.white), 1, 20, 39, 0, z, 1, 8));
      // Helipad.
      g.add(k.cyl(k.paint(TOY.green), 18, 1, 0, 58, 0, 18, 28));
      g.add(k.box(k.paint(TOY.white), 2, 0.6, 12, 0.2, -4, 59, 0), k.box(k.paint(TOY.white), 2, 0.6, 12, 0.2, 4, 59, 0), k.box(k.paint(TOY.white), 8, 0.6, 2, 0.2, 0, 59, 0));
      return g;
    },
  },
  {
    id: "bldg-control-tower",
    name: "Airport control tower",
    category: CAT,
    tags: ["airport", "control tower", "radar", "aviation", "tall", "animated"],
    notes: "A slender control tower with a glass cab and a spinning radar dish. An airport station: planes in the sky, trains connecting to town.",
    build: (k) => {
      const g = new Group();
      g.add(k.box(k.paint(TOY.white), 44, 18, 30, 2, -6, 0, 0));
      g.add(k.box(k.paint(WIN), 1.6, 8, 24, 0.4, 16, 6, 0));
      g.add(k.lathe(k.paint(TOY.white), [[0, 0], [11, 0], [9, 76], [0, 76]], 0, 0, 0, 24));
      g.add(k.ring(k.paint(TOY.orange), 10, 1, 0, 50, 0));
      g.add(k.cyl(k.paint(TOY.white), 10, 4, 0, 76, 0, 17, 24));
      g.add(k.cyl(k.paint(WIN), 17, 14, 0, 80, 0, 19, 24));
      g.add(k.cyl(k.paint(TOY.orange), 20, 3, 0, 94, 0, 20, 24));
      g.add(k.cyl(k.paint(TOY.grey), 1.4, 8, 0, 97, 0, 1.4, 8));
      const radar = named(new Group(), "radar");
      const dish = k.box(k.paint(TOY.white), 3, 6, 22, 1, 0, 0, 0);
      dish.rotation.z = 0.3;
      radar.add(dish, k.box(k.paint(TOY.grey), 4, 2, 2, 0.4, -2, 2, 0));
      g.add(k.at(radar, 0, 104, 0));
      g.add(named(k.ball(k.paint(TOY.red), 1.6, 0, 112, 0), "beacon"));
      g.add(k.cyl(k.paint(TOY.grey), 0.6, 6, 0, 106, 0, 0.6, 6));
      return g;
    },
    animate: (root, t) => {
      for (const r of parts(root, "radar")) r.rotation.y = t * 1.5;
      for (const b of parts(root, "beacon")) b.visible = (t * 1.2) % 1 < 0.5;
    },
  },
  {
    id: "bldg-ice-cream-kiosk",
    name: "Ice-cream kiosk",
    category: CAT,
    tags: ["ice cream", "kiosk", "seaside", "round", "small", "animated"],
    notes: "A round pink kiosk with a striped roof and a giant cone slowly turning on top. Seaside fun near the harbour: busier in summer, a reason to run day-trip specials.",
    build: (k) => {
      const g = new Group();
      g.add(k.cyl(k.paint(TOY.pink), 16, 24, 0, 0, 0, 16, 24));
      g.add(glassBand(k, 16.3, 9, 10));
      g.add(k.cyl(k.wood, 17.4, 1.6, 0, 9, 0, 17.4, 24));
      g.add(k.cyl(k.paint(TOY.white), 20, 2, 0, 24, 0, 20, 24));
      g.add(k.cone(k.paint(TOY.white), 20, 10, 0, 26, 0, 12));
      for (let i = 0; i < 6; i++) {
        const s = k.box(k.paint(TOY.red), 2, 0.5, 21, 0.2, 0, 0, 0);
        const a = (i * Math.PI) / 3;
        s.position.set(Math.cos(a) * 10, 31.2, Math.sin(a) * 10);
        s.rotation.order = "YXZ";
        s.rotation.y = -a + Math.PI / 2;
        s.rotation.x = Math.atan2(10, 20);
        g.add(s);
      }
      const cone = named(new Group(), "cone");
      const c = k.cone(k.paint("#d9a35b"), 6, 16, 0, -16, 0, 14);
      c.rotation.x = Math.PI;
      cone.add(c, k.ball(k.paint(TOY.pink), 6, 0, 1, 0), k.ball(k.paint(TOY.cream), 5, 0, 8, 0), k.ball(k.paint(TOY.red), 1.6, 0, 13.5, 0));
      g.add(k.at(cone, 0, 52, 0));
      g.add(k.peg(TOY.white, TOY.white, 6, 0, 4).translateY(1));
      return g;
    },
    animate: (root, t) => {
      for (const c of parts(root, "cone")) c.rotation.y = t * 0.7;
    },
  },
  {
    id: "bldg-toy-shop",
    name: "Toy shop",
    category: CAT,
    tags: ["toy shop", "shop", "window", "pinwheel", "town", "animated"],
    notes: "A purple toy shop with a tiny wooden train in the window and a pinwheel spinning on the roof. A toy railway in a toy railway: deliveries from the factory keep its shelves full.",
    build: (k) => {
      const g = house(k, 44, 32, 34, k.paint(TOY.purple), TOY.yellow, 13);
      g.add(doorX(k, TOY.yellow, 22, 10, 9, 18));
      g.add(k.box(k.paint(WIN), 1.6, 14, 18, 0.4, 22, 4, -5));
      g.add(k.box(k.paint(TOY.yellow), 2.2, 1.4, 20, 0.3, 22.4, 18, -5), k.box(k.paint(TOY.yellow), 2.2, 1.4, 20, 0.3, 22.4, 3, -5));
      // Tiny train on display, and blocks.
      const cs = [TOY.red, TOY.blue, TOY.green];
      for (let i = 0; i < 3; i++) g.add(k.box(k.paint(cs[i]), 3, 3, 4.6, 0.6, 23.6, 5, -12 + i * 5.4));
      g.add(k.box(k.paint(TOY.yellow), 3, 3, 3, 0.6, 23.6, 8, -12));
      g.add(awningX(k, 22, 27, 0, 30, TOY.yellow, TOY.purple, 6));
      g.add(winX(k, 22, 30, 0, 9, 7));
      for (const [x, c] of [[-14, TOY.red], [-6, TOY.blue], [2, TOY.green]] as const) g.add(k.box(k.paint(c), 7, 7, 7, 1.2, x, 0, 20));
      g.add(k.box(k.paint(TOY.yellow), 7, 7, 7, 1.2, -10, 7, 20));
      // Pinwheel on the ridge.
      g.add(k.cyl(k.paint(TOY.white), 0.8, 14, 14, 46, 0, 0.8, 8));
      const pin = named(new Group(), "pinwheel");
      const pc = [TOY.red, TOY.yellow, TOY.blue, TOY.green];
      for (let i = 0; i < 4; i++) {
        const blade = new Group();
        blade.add(k.extrude(k.paint(pc[i]), [[0, 0], [0, 8], [5, 8]], 0.8, 0, 0, 0, 0));
        blade.rotation.y = Math.PI / 2;
        const holder = new Group();
        holder.add(blade);
        holder.rotation.x = (i * Math.PI) / 2;
        pin.add(holder);
      }
      pin.add(k.ball(k.paint(TOY.white), 1.4, 0, 0, 0));
      g.add(k.at(pin, 15.4, 60, 0));
      return g;
    },
    animate: (root, t) => {
      for (const p of parts(root, "pinwheel")) p.rotation.x = t * 3;
    },
  },
  // ——— Town houses: sized to the map's town squares (one square: about 56 × 56; two squares: about 128 × 56) ———
  {
    id: "bldg-townhouse",
    name: "Townhouse",
    category: CAT,
    tags: ["house", "townhouse", "town", "tall", "two floors"],
    notes: "A tall, narrow two-storey townhouse with a blue door and a little fanlight. Fits one town square; a row of them makes a high street.",
    build: (k) => {
      const g = house(k, 40, 30, 46, k.paint("#e7d6b8"), SLATE, 12);
      g.add(doorX(k, TOY.blue, 20, 0, 9, 17));
      g.add(k.cylX(k.paint("#f6e7a8"), 4, 1.6, 20.4, 18, 0, 16));
      for (const y of [24, 36]) for (const z of [-8, 8]) g.add(winX(k, 20, y, z, 7, 9));
      g.add(chimney(k, -12, 50, 10, 10));
      return g;
    },
  },
  {
    id: "bldg-thatched-cottage",
    name: "Thatched cottage",
    category: CAT,
    tags: ["house", "cottage", "thatch", "village", "town", "country"],
    notes: "A low whitewashed cottage under a deep, rounded straw thatch, with roses round the door. Fits one town square, and looks at home on the edge of a village.",
    build: (k) => {
      const g = new Group();
      g.add(k.box(k.paint(TOY.white), 40, 20, 34, 3));
      // The thatch: a thick, soft-edged ridge that comes down low over the walls.
      const thatch = k.paint("#d9b45a");
      g.add(k.roof(thatch, 46, 42, 18, 0, 17, 0, 5));
      g.add(k.box(thatch, 44, 4, 8, 3.5, 0, 33, 0));
      g.add(doorX(k, TOY.green, 20, -6, 8, 15));
      g.add(winX(k, 20, 8, 8, 8, 8));
      for (const [y, z] of [[3, -12], [9, -12.5], [15, -11], [5, 1], [12, 0.5]] as const) g.add(k.ball(k.paint(TOY.pink), 1.6, 21, y, z));
      g.add(chimney(k, -10, 26, -10, 12, STONE));
      return g;
    },
  },
  {
    id: "bldg-timber-house",
    name: "Timber-framed house",
    category: CAT,
    tags: ["house", "timber", "half-timbered", "tudor", "town"],
    notes: "Cream walls criss-crossed with dark oak beams, an upper floor jutting out over the street and a steep red roof. Fits one town square.",
    build: (k) => {
      const g = new Group();
      const cream = k.paint("#f0e3c6");
      const oak = k.paint("#5b3a22");
      g.add(k.box(cream, 36, 20, 32, 1.5));
      // Upper floor jetties out over the front.
      g.add(k.box(cream, 42, 18, 34, 1.5, 3, 20, 0));
      g.add(gable(k, cream, 41.5, 34, 16, 3, 38, 0));
      g.add(k.roof(k.paint(TOY.red), 48, 40, 19, 3, 37, 0));
      // Beams on the front faces.
      for (const z of [-15, -5, 5, 15]) g.add(k.box(oak, 1.6, 18, 2, 0.3, 24.2, 20, z), k.box(oak, 1.6, 20, 2, 0.3, 18.2, 0, z));
      g.add(k.box(oak, 1.6, 2, 34, 0.3, 24.2, 19, 0), k.box(oak, 1.6, 2, 34, 0.3, 24.2, 36.5, 0));
      for (const s of [-1, 1]) g.add(k.at(k.box(oak, 1.4, 12, 1.8, 0.3, 24.2, 23, s * 10), 0, 0, 0, 0).rotateX(s * 0.6));
      g.add(doorX(k, "#5b3a22", 18, 0, 8, 16));
      for (const z of [-10, 10]) g.add(winX(k, 24, 26, z, 6, 8));
      return g;
    },
  },
  {
    id: "bldg-bungalow",
    name: "Bungalow",
    category: CAT,
    tags: ["house", "bungalow", "town", "low", "garden"],
    notes: "A wide, low house all on one floor under a hipped roof, with a front step and a window box. Fits one town square.",
    build: (k) => {
      const g = new Group();
      g.add(k.box(k.paint("#c9dcef"), 40, 18, 44, 2));
      g.add(hip(k, k.paint(BRICK), 56, 16, 0, 18, 0));
      g.add(doorX(k, TOY.red, 20, 0, 9, 15), k.box(k.paint(STONE), 4, 1.6, 14, 0.5, 22, 0, 0));
      for (const z of [-13, 13]) {
        g.add(winX(k, 20, 6, z, 10, 8));
        g.add(k.box(k.paint(TOY.green), 3, 2.6, 11, 0.6, 21.6, 4, z));
        for (const dz of [-3, 0, 3]) g.add(k.ball(k.paint(dz === 0 ? TOY.yellow : TOY.red), 1.2, 22, 7.3, z + dz));
      }
      return g;
    },
  },
  {
    id: "bldg-corner-shop",
    name: "Corner shop",
    category: CAT,
    tags: ["shop", "corner shop", "grocer", "town", "awning"],
    notes: "A little grocer's with a striped awning, crates of fruit by the door and a flat above with a window box. Fits one town square.",
    build: (k) => {
      const g = house(k, 38, 36, 40, k.paint("#2f7a6e"), SLATE, 11);
      g.add(doorX(k, TOY.cream, 19, 10, 8, 17));
      g.add(k.box(k.paint(WIN), 1.6, 13, 18, 0.4, 19, 3, -6));
      g.add(awningX(k, 19, 20, -2, 32, TOY.green, TOY.white, 6));
      g.add(k.box(k.paint(TOY.cream), 1.4, 5, 26, 0.6, 19.6, 25, 0));
      for (const z of [-10, 10]) g.add(winX(k, 19, 31, z, 8, 7));
      for (const [z, c] of [[-14, TOY.orange], [-7, TOY.red], [0, TOY.yellow]] as const) {
        g.add(k.box(k.wood, 6, 3, 6, 0.6, 25, 0, z));
        for (const dz of [-1.3, 1.3]) g.add(k.ball(k.paint(c), 1.5, 25, 4, z + dz));
      }
      return g;
    },
  },
  {
    id: "bldg-narrow-house",
    name: "Narrow gabled house",
    category: CAT,
    tags: ["house", "narrow", "canal house", "gable", "town", "tall"],
    notes: "A slim house with a stepped gable to the street, like the canal houses of an old port. Three floors on one town square; a row of them in different colours is a postcard.",
    build: (k) => {
      const g = new Group();
      const wall = k.paint("#c76b4f");
      g.add(k.box(wall, 40, 52, 26, 1.5));
      // Stepped gable on the front.
      for (const [y, w] of [[52, 22], [57, 15], [62, 8]] as const) g.add(k.box(wall, 4, 5, w, 0.8, 18, y, 0));
      g.add(k.roof(k.paint(SLATE), 38, 28, 12, -2, 52, 0));
      g.add(doorX(k, TOY.black, 20, 0, 8, 16));
      for (const y of [24, 38]) for (const z of [-6, 6]) g.add(winX(k, 20, y, z, 6, 9));
      g.add(k.box(k.paint(TOY.white), 1.6, 5, 6, 0.4, 20.2, 56, 0));
      return g;
    },
  },
  {
    id: "bldg-brick-house",
    name: "Brick house with bay window",
    category: CAT,
    tags: ["house", "brick", "bay window", "town", "victorian"],
    notes: "A red-brick house with a white bay window on the ground floor, a slate roof and a chimney at each end. Fits one town square.",
    build: (k) => {
      const g = house(k, 36, 40, 38, k.paint(BRICK), SLATE, 13);
      // Swap the gable to face the side: a broad front with the bay.
      g.add(k.box(k.paint(TOY.white), 6, 16, 16, 1.2, 21, 0, 6));
      g.add(k.box(k.paint(WIN), 1.6, 9, 12, 0.4, 24.1, 4, 6));
      g.add(k.box(k.paint(SLATE), 8, 2, 18, 0.6, 21, 16, 6));
      g.add(doorX(k, TOY.blue, 18, -10, 8, 17));
      for (const z of [-10, 8]) g.add(winX(k, 18, 26, z, 8, 9));
      for (const x of [-14, 14]) g.add(chimney(k, x, 46, 0, 9));
      return g;
    },
  },
  {
    id: "bldg-terrace",
    name: "Terrace of three",
    category: CAT,
    tags: ["houses", "terrace", "row", "town", "street"],
    notes: "Three joined houses under one long roof, each with its own colour of front door and a chimney on the ridge between them. Fits two town squares, front along the long side.",
    build: (k) => {
      const g = new Group();
      const wall = k.paint("#e4d2b0");
      g.add(k.box(wall, 34, 34, 120, 2));
      g.add(k.at(gable(k, wall, 119.5, 34, 13, 0, 34, 0), 0, 0, 0, Math.PI / 2));
      g.add(k.at(k.roof(k.paint(SLATE), 128, 42, 16, 0, 0, 0), 0, 32, 0, Math.PI / 2));
      const doors = [TOY.red, TOY.blue, TOY.green];
      for (let i = 0; i < 3; i++) {
        const z = -40 + i * 40;
        g.add(doorX(k, doors[i], 17, z - 8, 8, 16));
        g.add(winX(k, 17, 6, z + 8, 9, 9), winX(k, 17, 23, z - 8, 8, 8), winX(k, 17, 23, z + 8, 8, 8));
        if (i < 2) g.add(k.box(k.paint(TOY.cream), 1.4, 34, 1.4, 0.3, 17.4, 0, z + 20));
      }
      for (const z of [-20, 20]) g.add(chimney(k, 0, 45, z, 9));
      return g;
    },
  },
  {
    id: "bldg-semi-detached",
    name: "Semi-detached pair",
    category: CAT,
    tags: ["houses", "semi-detached", "pair", "town", "suburb"],
    notes: "Two mirror-image houses sharing a wall, each with a porch and a front garden hedge. Fits two town squares, front along the long side.",
    build: (k) => {
      const g = new Group();
      const halves: [number, string, string][] = [
        [-1, "#d8e6cf", TOY.red],
        [1, "#f2dcc2", TOY.blue],
      ];
      for (const [s, wall, door] of halves) {
        const zc = s * 28;
        g.add(k.box(k.paint(wall), 36, 34, 56, 2, -4, 0, zc));
        g.add(doorX(k, door, 14, zc - s * 18, 8, 16));
        g.add(k.box(k.paint(TOY.white), 6, 2, 14, 0.6, 16, 18, zc - s * 18));
        g.add(winX(k, 14, 6, zc + s * 6, 12, 9), winX(k, 14, 23, zc - s * 14, 8, 8), winX(k, 14, 23, zc + s * 6, 10, 8));
        g.add(k.box(k.paint(TOY.leaf), 4, 6, 22, 2, 22, 0, zc + s * 10));
      }
      // A hipped roof over each half, joined along the ridge.
      for (const z of [-30, 30]) g.add(hip(k, k.paint(BRICK), 44, 14, -4, 34, z));
      g.add(k.box(k.paint(BRICK), 30, 6, 60, 2, -4, 34, 0));
      g.add(chimney(k, -4, 40, 0, 9));
      return g;
    },
  },
  {
    id: "bldg-villa",
    name: "Villa",
    category: CAT,
    tags: ["house", "villa", "grand", "town", "porch", "columns"],
    notes: "A grand pale villa with a columned porch, tall windows, a hipped roof and a chimney at each end. The finest house in town; fits two town squares.",
    build: (k) => {
      const g = new Group();
      const wall = k.paint("#efe7d6");
      g.add(k.box(wall, 40, 38, 104, 2));
      g.add(k.box(k.paint(STONE), 42, 2, 106, 0.6, 0, 18, 0));
      for (const z of [-30, 30]) g.add(hip(k, k.paint(SLATE), 48, 16, 0, 38, z));
      g.add(k.box(k.paint(SLATE), 36, 6, 60, 2, 0, 38, 0));
      // The porch: four columns and a pediment.
      for (const z of [-14, -5, 5, 14]) g.add(k.cyl(k.paint(TOY.white), 2, 22, 26, 0, z, 2, 12));
      g.add(k.box(k.paint(TOY.white), 12, 3, 34, 1, 25, 22, 0), k.at(k.extrude(k.paint(TOY.white), [[-17, 0], [17, 0], [0, 8]], 10, 0, 0, 0, 0.6), 25, 25, 0, Math.PI / 2));
      g.add(doorX(k, "#2b5b3a", 20, 0, 10, 20));
      for (const z of [-40, -26, 26, 40]) g.add(winX(k, 20, 4, z, 8, 13), winX(k, 20, 24, z, 8, 11));
      for (const z of [-46, 46]) g.add(chimney(k, 0, 46, z, 10, STONE));
      return g;
    },
  },
];

// The models made in Blender (tools/blender/bldg.py) stand in for the ones built above, where there is one.
const MODELS = await loadModelSet("buildings", true);
for (const asset of ASSETS) {
  const model = MODELS.get(asset.id);
  if (model) asset.build = (k) => catalogueModel(model, k);
}

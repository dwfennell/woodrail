import { Group, type Material, type Mesh, type Object3D, Vector3 } from "three";
import { type Kit, TOY } from "../kit";
import type { Asset } from "../types";

/**
 * People & animals: peg-doll people (turned bodies, round beech heads, painted uniforms, about 18 mm tall) told apart by
 * hats, bags and tools, and chunky turned-and-sawn wooden animals. Facing +x, standing on y = 0.
 */

const GOLD = "#d9a93a";
const STRAW = "#d9b25a";
const SILVER = "#c9ccd1";

type V3 = [number, number, number];

// ——— Small helpers ———

/** A cylinder from `a` to `b` (radius `r0` at a, `r1` at b): limbs, poles, necks, tails, horns. */
function rod(k: Kit, mat: Material, a: V3, b: V3, r0: number, r1 = r0, seg = 12): Mesh {
  const d = new Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  const m = k.cyl(mat, r0, Math.max(0.01, d.length()), 0, 0, 0, r1, seg);
  m.position.set((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2);
  m.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), d.normalize());
  return m;
}

/** A named group (a pivot for animation) at (x, y, z). */
function pivot(name: string, x: number, y: number, z: number, ...parts: Object3D[]): Group {
  const g = new Group();
  g.name = name;
  g.position.set(x, y, z);
  for (const p of parts) g.add(p);
  return g;
}

/** A turned dome (a hat crown, a helmet, hair), its base on y. */
function dome(k: Kit, mat: Material, r: number, h: number, x = 0, y = 0, z = 0): Mesh {
  const p: [number, number][] = [[0.01, 0]];
  for (let i = 0; i <= 6; i++) {
    const a = (i / 6) * (Math.PI / 2);
    p.push([Math.max(0.01, r * Math.cos(a)), h * Math.sin(a)]);
  }
  return k.lathe(mat, p, x, y, z, 20);
}

/** A ball stretched along x (bodies of birds, fish, rabbits). */
function egg(k: Kit, mat: Material, r: number, x: number, y: number, z: number, sx = 1, sy = 1, sz = 1): Mesh {
  const m = k.ball(mat, r, x, y, z);
  m.scale.set(sx, sy, sz);
  return m;
}

/** A pair of eyes looking +x, `half` either side of centre. */
function eyes(k: Kit, x: number, y: number, half: number, r = 0.6, col: string = TOY.black): Group {
  return k.group(k.ball(k.paint(col), r, x, y, -half), k.ball(k.paint(col), r, x, y, half));
}

/** A cone pointing +x (a beak, a snout), its base at x. */
function beak(k: Kit, mat: Material, r: number, len: number, x: number, y: number, z = 0): Mesh {
  return rod(k, mat, [x, y, z], [x + len, y, z], r, 0.05, 10);
}

/** Look up a named part, cached on the root so animate doesn't search every frame. */
function part(root: Object3D, name: string): Object3D | undefined {
  const cache = (root.userData.parts ??= {}) as Record<string, Object3D | undefined>;
  if (!(name in cache)) cache[name] = root.getObjectByName(name);
  return cache[name];
}

// ——— Peg people ———

const BODY_H = 11;
const HAND = -5.2;
/** Radius of the turned body at height y. */
const rAt = (y: number) => 4.2 - (y / BODY_H) * 1.0;

/** A peg person: turned body in `coat`, beech head, optional trousers and hair. */
function person(k: Kit, coat: string, o: { legs?: string; hair?: string } = {}): Group {
  const g = new Group();
  g.add(k.cyl(k.paint(coat), 4.2, BODY_H, 0, 0, 0, 3.2, 16));
  if (o.legs) g.add(band(k, o.legs, 0, 3.6));
  g.add(k.ball(k.wood, 3.4, 0, 14, 0));
  if (o.hair) g.add(dome(k, k.paint(o.hair), 3.6, 3.7, -0.5, 13.9, 0));
  return g;
}

/** A painted band round the body between y0 and y1 (a belt, an apron, a scarf, a hi-vis stripe). */
function band(k: Kit, col: string, y0: number, y1: number, out = 0.2): Mesh {
  return k.cyl(k.paint(col), rAt(y0) + out, y1 - y0, 0, y0, 0, rAt(y1) + out, 16);
}

/** A front panel (an apron, a bib, a waistcoat front) painted on the body. */
function apron(k: Kit, col: string, y0: number, y1: number, w = 4.4): Mesh {
  const m = k.box(k.paint(col), 0.6, y1 - y0, w, 0.25, 0, y0, 0);
  m.position.x = rAt((y0 + y1) / 2) - 0.05;
  m.rotation.z = Math.atan2(1, BODY_H);
  return m;
}

/** Buttons down the front. */
function buttons(k: Kit, col: string, ys: number[]): Group {
  return k.group(...ys.map((y) => k.ball(k.paint(col), 0.45, rAt(y) + 0.1, y, 0)));
}

/** An arm on `side` (+1 right, −1 left), pivoting at the shoulder; `swing` lifts it forward (radians). */
function arm(k: Kit, coat: string, side: 1 | -1, swing = 0, name = ""): Group {
  const g = pivot(name, 0, 9.6, side * 3.6);
  g.add(k.capsule(k.paint(coat), 1.1, 3.2, 0, -5.4, 0));
  g.add(k.ball(k.wood, 1.2, 0, HAND, 0));
  g.rotation.z = swing;
  g.rotation.x = -side * 0.12;
  return g;
}

/** Put `item` in an arm's hand, kept upright. */
function hold(armG: Group, item: Object3D, dx = 0, dy = 0, dz = 0): Object3D {
  item.position.set(item.position.x + dx, item.position.y + HAND + dy, item.position.z + dz);
  item.rotation.z = -armG.rotation.z;
  armG.add(item);
  return item;
}

// Hats, placed for a head centred at y 14 (radius 3.4).

function cap(k: Kit, col: string, peak = col): Group {
  return k.group(k.cyl(k.paint(col), 3.55, 2.4, 0, 15.6, 0, 3.75, 16), k.box(k.paint(peak), 3.2, 0.6, 5.2, 0.3, 3.4, 15.7, 0));
}
function kepi(k: Kit, col: string): Group {
  const g = cap(k, col, TOY.black);
  g.add(k.cyl(k.paint(GOLD), 3.66, 0.6, 0, 16.2, 0, 3.7, 16));
  g.add(k.ball(k.paint(GOLD), 0.6, 3.7, 17, 0));
  return g;
}
function topHat(k: Kit, col: string): Group {
  return k.group(k.cyl(k.paint(col), 5, 0.7, 0, 16.3, 0, 5, 20), k.cyl(k.paint(col), 3.1, 5.5, 0, 16.6, 0, 3.2, 16));
}
function bowler(k: Kit, col: string): Group {
  return k.group(k.cyl(k.paint(col), 4.6, 0.6, 0, 16.2, 0, 4.6, 20), dome(k, k.paint(col), 3.2, 3.2, 0, 16.4, 0));
}
function hardHat(k: Kit, col: string): Group {
  return k.group(
    dome(k, k.paint(col), 3.9, 3.6, 0, 15.3, 0),
    k.cyl(k.paint(col), 4.4, 0.5, 0, 15.2, 0, 4.4, 20),
    k.box(k.paint(col), 2.5, 0.5, 5, 0.2, 4, 15.2, 0),
    k.box(k.paint(col), 6.5, 1, 1.2, 0.5, 0, 18.3, 0),
  );
}
function fireHelmet(k: Kit, col: string): Group {
  return k.group(
    dome(k, k.paint(col), 3.9, 3.8, 0, 15.2, 0),
    k.cyl(k.paint(col), 4.8, 0.5, -0.9, 15.1, 0, 4.8, 20),
    k.box(k.paint(col), 7, 1.4, 1, 0.5, -0.4, 18, 0),
    k.box(k.paint(GOLD), 0.6, 1.8, 1.8, 0.3, 3.7, 16, 0),
  );
}
function policeHelmet(k: Kit, col: string): Group {
  const profile: [number, number][] = [[0.01, 0], [3.8, 0], [3.7, 2], [3.2, 4.5], [2.3, 6.3], [1, 7], [0.01, 7.2]];
  return k.group(
    k.lathe(k.paint(col), profile, 0, 15.2, 0, 20),
    k.cyl(k.paint(col), 4.4, 0.5, 0, 15.1, 0, 4.4, 20),
    k.ball(k.paint(SILVER), 1, 3.5, 17.6, 0, 1.3),
    k.ball(k.paint(SILVER), 0.7, 0, 22.4, 0),
  );
}
function toque(k: Kit): Group {
  const w = k.paint(TOY.white);
  return k.group(k.cyl(w, 3.6, 2, 0, 15.8, 0, 3.6, 16), k.cyl(w, 3.3, 4, 0, 17.6, 0, 4.2, 16), k.ball(w, 4.2, 0, 21.6, 0, 0.5));
}
function strawHat(k: Kit): Group {
  return k.group(
    k.cyl(k.paint(STRAW), 6.6, 0.6, 0, 16.2, 0, 6.6, 24),
    k.cyl(k.paint(STRAW), 3.1, 2.6, 0, 16.6, 0, 2.8, 16),
    k.cyl(k.paint(TOY.red), 3.12, 0.7, 0, 16.9, 0, 3.05, 16),
  );
}
function souwester(k: Kit, col: string): Group {
  const flap = k.box(k.paint(col), 1, 5, 7.5, 0.4, -4.2, 10.5, 0);
  flap.rotation.z = -0.3;
  return k.group(dome(k, k.paint(col), 3.9, 3.4, 0, 15.3, 0), k.cyl(k.paint(col), 4.9, 0.5, 0, 15.2, 0, 4.9, 20), flap);
}
function bobbleHat(k: Kit, col: string, bobble: string): Group {
  return k.group(dome(k, k.paint(col), 3.7, 3.8, 0, 15, 0), k.cyl(k.paint(bobble), 3.8, 1, 0, 14.9, 0, 3.75, 16), k.ball(k.paint(bobble), 1.3, 0, 19.1, 0));
}
function bucketHat(k: Kit, col: string): Group {
  return k.group(k.cyl(k.paint(col), 5, 1.2, 0, 15.6, 0, 3.6, 20), k.cyl(k.paint(col), 3.5, 2.6, 0, 16.6, 0, 3.1, 16));
}
function boater(k: Kit, bandCol: string): Group {
  return k.group(
    k.cyl(k.paint(STRAW), 5.6, 0.5, 0, 16.3, 0, 5.6, 24),
    k.cyl(k.paint(STRAW), 3.3, 2.2, 0, 16.6, 0, 3.3, 16),
    k.cyl(k.paint(bandCol), 3.36, 0.9, 0, 16.8, 0, 3.36, 16),
  );
}
function bandHat(k: Kit, col: string, plume: string): Group {
  return k.group(
    k.cyl(k.paint(col), 3.5, 7, 0, 15.6, 0, 3.9, 16),
    k.box(k.paint(TOY.black), 2.6, 0.5, 5, 0.2, 3.6, 15.6, 0),
    k.ball(k.paint(GOLD), 1, 3.8, 18.5, 0),
    k.capsule(k.paint(plume), 0.9, 2.5, 2.4, 21.6, 0),
  );
}
function pillbox(k: Kit, col: string): Mesh {
  return k.cyl(k.paint(col), 3.7, 2.6, 0, 15.6, 0, 3.9, 16);
}

// Carried things (built round the hand at the origin).

function flag(k: Kit, col: string): Group {
  const g = new Group();
  g.add(rod(k, k.wood, [0, -2, 0], [0, 10, 0], 0.35));
  g.add(pivot("flag", 0, 9.6, 0, k.box(k.paint(col), 5.5, 3.6, 0.4, 0.15, 2.8, -3.6, 0)));
  return g;
}
function lantern(k: Kit, light: string): Group {
  const black = k.paint(TOY.black);
  return k.group(
    k.ring(black, 1.2, 0.25, 0, -0.6, 0, true, Math.PI),
    k.box(black, 3.2, 0.7, 3.2, 0.3, 0, -1.7, 0),
    k.box(k.glass, 2.6, 3, 2.6, 0.3, 0, -4.7, 0),
    k.ball(k.paint(light), 1, 0, -3.2, 0),
    k.box(black, 3.4, 0.8, 3.4, 0.3, 0, -5.4, 0),
  );
}
function suitcase(k: Kit, col: string, w = 7, h = 4.6, d = 2.4): Group {
  return k.group(
    k.box(k.paint(col), w, h, d, 0.6, 0, -h - 0.4, 0),
    k.ring(k.paint(TOY.black), 1, 0.3, 0, -0.4, 0, true, Math.PI),
    k.box(k.paint(GOLD), 0.5, h + 0.1, d + 0.15, 0.1, -w / 4, -h - 0.45, 0),
    k.box(k.paint(GOLD), 0.5, h + 0.1, d + 0.15, 0.1, w / 4, -h - 0.45, 0),
  );
}

// ——— Animals ———

interface Quad {
  g: Group;
  head: Group;
  tail: Group;
}

/** A chunky four-legged animal: a rounded block body on turned legs, with head and tail pivots to fill in. */
function quad(k: Kit, coat: string, L: number, W: number, H: number, legH: number, legR: number, legCol = coat, hoof?: string): Quad {
  const g = new Group();
  g.add(k.box(k.paint(coat), L, H, W, Math.min(W, H) * 0.42, 0, legH, 0));
  for (const sx of [-1, 1])
    for (const sz of [-1, 1]) {
      const x = sx * (L / 2 - legR - 1.5);
      const z = sz * (W / 2 - legR - 0.3);
      g.add(k.cyl(k.paint(legCol), legR, legH + 2, x, 0, z, legR * 0.85, 12));
      if (hoof) g.add(k.cyl(k.paint(hoof), legR + 0.15, 1.6, x, 0, z, legR, 12));
    }
  const head = pivot("head", L / 2 - 1, legH + H * 0.7, 0);
  const tail = pivot("tail", -L / 2 + 0.5, legH + H * 0.75, 0);
  g.add(head, tail);
  return { g, head, tail };
}

/** Flat painted spots on an animal's sides (and top). */
function spots(k: Kit, col: string, z: number, list: [number, number, number][]): Group {
  return k.group(...list.flatMap(([x, y, r]) => [k.cylZ(k.paint(col), r, 0.6, x, y, z, 16), k.cylZ(k.paint(col), r, 0.6, x, y, -z, 16)]));
}

/** A small bird (a hen, a goose): egg body, wings, tail, legs, and a named head pivot. */
function bird(k: Kit, body: string, o: { r: number; legs?: number; neck?: number; headName: string; beakCol?: string }): Group {
  const g = new Group();
  const r = o.r;
  const legH = o.legs ?? 0;
  const m = k.paint(body);
  g.add(egg(k, m, r, 0, legH + r * 0.8, 0, 1.25, 0.85, 0.9));
  for (const s of [-1, 1]) g.add(egg(k, m, r * 0.6, -r * 0.2, legH + r * 0.9, s * r * 0.8, 1.5, 0.6, 0.35));
  g.add(rod(k, m, [-r * 0.8, legH + r * 0.9, 0], [-r * 1.6, legH + r * 1.5, 0], r * 0.55, 0.2));
  if (legH > 0) {
    const leg = k.paint(TOY.orange);
    for (const s of [-1, 1]) {
      g.add(rod(k, leg, [0, 0, s * r * 0.35], [0, legH + r * 0.4, s * r * 0.35], 0.4));
      g.add(k.box(leg, 2.2, 0.5, 1.4, 0.2, 0.7, 0, s * r * 0.35));
    }
  }
  const neck = o.neck ?? 0;
  const head = pivot(o.headName, r * 0.8, legH + r * 1.1, 0);
  if (neck > 0) head.add(rod(k, m, [0, 0, 0], [r * 0.25, neck, 0], r * 0.32, r * 0.28));
  const hr = r * 0.5;
  head.add(k.ball(m, hr, r * 0.3, neck + hr * 0.7, 0));
  head.add(beak(k, k.paint(o.beakCol ?? TOY.orange), hr * 0.45, hr * 1.1, r * 0.3 + hr * 0.75, neck + hr * 0.55, 0));
  head.add(eyes(k, r * 0.3 + hr * 0.45, neck + hr * 1.05, hr * 0.62, Math.max(0.35, hr * 0.17)));
  g.add(head);
  return g;
}

/** A pond: a disc of blue felt. */
function pond(k: Kit, r: number): Mesh {
  return k.feltDisc(r, k.water);
}

// ——— The catalogue ———
const PECKS = ["peck-0", "peck-1", "peck-2"];
const DUCKS = ["duck-0", "duck-1", "duck-2", "duck-3"];
const SWANS = ["swan-0", "swan-1"];
const GEESE = ["goose-0", "goose-1"];
const DROPS = ["drop-0", "drop-1", "drop-2"];
const PENGUINS = ["penguin-0", "penguin-1"];
const PERCHES = ["perch-0", "perch-1", "perch-2"];


const C = "People & animals" as const;

export const ASSETS: Asset[] = [
  // ——— Railway staff ———
  {
    id: "life-driver",
    name: "Engine driver",
    category: C,
    tags: ["person", "driver", "railway", "staff", "wave"],
    notes: "A driver in blue overalls, striped cap and red neckerchief, waving, with an oil can. Ride in the engine's cab; a train won't leave the shed until its driver is aboard.",
    build: (k) => {
      const g = person(k, TOY.blue, { legs: "#244f86" });
      g.add(band(k, TOY.red, 9.6, 11));
      g.add(apron(k, "#244f86", 3.6, 9.5, 4));
      g.add(cap(k, "#264a7a", TOY.black), k.cyl(k.paint(TOY.white), 3.8, 0.5, 0, 17.4, 0, 3.8, 16));
      const can = k.group(k.cyl(k.paint(TOY.grey), 1.6, 2.6, 0, -3.2, 0), k.cone(k.paint(TOY.grey), 1.6, 1.2, 0, -0.6, 0, 12), rod(k, k.paint(TOY.grey), [0.5, -1.5, 0], [4, 0.5, 0], 0.3));
      g.add(hold(arm(k, TOY.blue, 1, 0.3), can, 0, 0, 0.8).parent!);
      g.add(arm(k, TOY.blue, -1, 2.7, "wave"));
      return g;
    },
    animate: (root, t) => {
      const a = part(root, "wave");
      if (a) a.rotation.x = 0.12 + Math.sin(t * 6) * 0.35;
    },
  },
  {
    id: "life-conductor",
    name: "Conductor with flag",
    category: C,
    tags: ["person", "conductor", "flag", "railway", "staff", "departure"],
    notes: "A conductor in a maroon coat with brass buttons, waving a green flag. Raise the flag to send a waiting train off: a departure signal the player can tap.",
    build: (k) => {
      const coat = "#7b2333";
      const g = person(k, coat, { legs: TOY.black });
      g.add(buttons(k, GOLD, [5, 7, 9]));
      g.add(cap(k, coat, TOY.black), k.cyl(k.paint(GOLD), 3.66, 0.5, 0, 16.2, 0, 3.7, 16));
      g.add(hold(arm(k, coat, 1, 2.4), flag(k, TOY.leaf), 0, 0, 0.4).parent!);
      const whistle = k.cylX(k.paint(SILVER), 0.6, 2, 1.2, 0, 0, 10);
      g.add(hold(arm(k, coat, -1, 0.5), whistle).parent!);
      return g;
    },
    animate: (root, t) => {
      const f = part(root, "flag");
      if (f) f.rotation.y = Math.sin(t * 7) * 0.5;
    },
  },
  {
    id: "life-station-master",
    name: "Station master",
    category: C,
    tags: ["person", "station master", "railway", "staff", "watch"],
    notes: "The station master in a navy frock coat and gold-banded kepi, checking a pocket watch. Stands on the platform and grumbles (a little puff) when a train is late against the timetable.",
    build: (k) => {
      const coat = "#1f2f57";
      const g = person(k, coat, { legs: TOY.black });
      g.add(k.cyl(k.paint(coat), 4.5, 3, 0, 0, 0, 4.25, 16));
      g.add(buttons(k, GOLD, [4.5, 6.3, 8.1]));
      g.add(band(k, GOLD, 6.9, 7.4, 0.25));
      g.add(kepi(k, coat));
      g.add(k.box(k.paint(TOY.white), 0.6, 1.4, 2.4, 0.2, 3.4, 9.6, 0));
      const watch = k.group(k.cylX(k.paint(GOLD), 1.5, 0.6, 0, -0.3, 0, 16), k.cylX(k.paint(TOY.cream), 1.1, 0.7, 0.05, -0.3, 0, 16));
      g.add(hold(arm(k, coat, -1, 1.3, "watch-arm"), watch, 0.6, 0, -0.5).parent!);
      g.add(arm(k, coat, 1, 0.1));
      return g;
    },
    animate: (root, t) => {
      const a = part(root, "watch-arm");
      if (a) a.rotation.z = 1.1 + Math.max(0, Math.sin(t * 0.8)) * 0.4;
    },
  },
  {
    id: "life-guard",
    name: "Guard with lantern",
    category: C,
    tags: ["person", "guard", "lantern", "railway", "staff", "night"],
    notes: "A guard in a green coat swinging a red lantern. Rides in the brake van; at dusk the lantern glows on the last car so you can see the train is complete.",
    build: (k) => {
      const coat = "#2d5b3a";
      const g = person(k, coat, { legs: TOY.black });
      g.add(buttons(k, SILVER, [5, 7, 9]));
      g.add(band(k, TOY.black, 5.6, 6.4, 0.25));
      g.add(cap(k, coat, TOY.black));
      const a = arm(k, coat, 1, 0.5, "lamp-arm");
      const l = hold(a, lantern(k, TOY.red), 0, 1, 0.5);
      l.name = "lamp";
      g.add(a, arm(k, coat, -1, 0.05));
      return g;
    },
    animate: (root, t) => {
      const a = part(root, "lamp-arm");
      const l = part(root, "lamp");
      if (!a || !l) return;
      a.rotation.z = 0.5 + Math.sin(t * 2.2) * 0.3;
      l.rotation.z = -a.rotation.z + Math.sin(t * 2.2 - 0.6) * 0.25;
    },
  },
  {
    id: "life-porter",
    name: "Porter with luggage trolley",
    category: C,
    tags: ["person", "porter", "luggage", "trolley", "station", "suitcase"],
    notes: "A porter in a brown waistcoat pushing a four-wheeled barrow piled with cases, a trunk and a hatbox. Wheel luggage from the taxi rank to the coach: passengers won't board until their bags are loaded.",
    build: (k) => {
      const g = new Group();
      const coat = "#6b3f22";
      const p = person(k, TOY.cream, { legs: TOY.black });
      p.add(apron(k, coat, 4, 10, 5), cap(k, coat, TOY.black));
      p.add(arm(k, TOY.cream, 1, 1.2), arm(k, TOY.cream, -1, 1.2));
      g.add(k.at(p, -15, 0, 0));
      // The barrow.
      const blk = k.paint(TOY.black);
      g.add(k.box(k.wood, 24, 2, 14, 0.8, 4, 4.5, 0));
      for (const x of [-5, 13]) for (const z of [-6, 6]) g.add(k.cylZ(blk, 2.4, 1.6, x, 2.4, z * 1.05, 16));
      for (const z of [-5.5, 5.5]) g.add(rod(k, k.paint(TOY.green), [-7.5, 6.5, z], [-10, 8.2, z], 0.5));
      g.add(k.cylZ(k.paint(TOY.green), 0.6, 12, -10, 8.2, 0, 10));
      // The luggage.
      g.add(k.box(k.paint(TOY.brown), 10, 6, 11, 1, 0, 6.5, 0));
      g.add(k.box(k.paint(GOLD), 10.2, 0.8, 11.2, 0.3, 0, 9, 0));
      g.add(k.box(k.paint(TOY.blue), 8, 3, 6, 0.8, 0.5, 12.5, -1.5));
      g.add(k.box(k.paint(TOY.red), 6, 2.6, 5, 0.8, 0, 15.5, -1));
      g.add(k.cyl(k.paint(TOY.pink), 3.2, 3.5, 10, 6.5, 2.8, 3.2, 20), k.cyl(k.paint(TOY.white), 3.3, 0.7, 10, 9.4, 2.8, 3.3, 20));
      g.add(k.box(k.paint(TOY.green), 5, 5, 3, 0.8, 11, 6.5, -4));
      return g;
    },
  },
  {
    id: "life-signal-operator",
    name: "Signal operator at the lever frame",
    category: C,
    tags: ["person", "signal", "signal box", "levers", "railway", "staff"],
    notes: "A signal operator in shirtsleeves and waistcoat working a frame of coloured levers. Put them in a signal box: each lever pulled changes a signal or a point, so the box becomes the player's control desk.",
    build: (k) => {
      const g = new Group();
      const p = person(k, TOY.white, { legs: TOY.black, hair: TOY.brown });
      p.add(apron(k, TOY.black, 4, 10, 5.5), band(k, TOY.red, 7.2, 7.6, 0.3));
      p.add(arm(k, TOY.white, 1, 1.25), arm(k, TOY.white, -1, 1.25, "op-arm"));
      g.add(k.at(p, -2, 0, 0));
      g.add(k.box(k.cut, 6, 3, 28, 1, 9, 0, 0));
      const cols = [TOY.red, TOY.red, TOY.yellow, TOY.black, TOY.blue];
      cols.forEach((c, i) => {
        const z = -10 + i * 5;
        const lever = pivot(`lever-${i}`, 9, 3, z, rod(k, k.metal, [0, 0, 0], [0, 12, 0], 0.55, 0.45), rod(k, k.paint(c), [0, 6, 0], [0, 10, 0], 0.75), k.cylX(k.paint(SILVER), 0.7, 1.6, 0, 12.4, 0, 10));
        lever.rotation.z = i === 3 ? 0.5 : -0.25;
        g.add(lever);
      });
      return g;
    },
    animate: (root, t) => {
      const l = part(root, "lever-2");
      const a = part(root, "op-arm");
      const s = 0.5 + 0.5 * Math.sin(t * 1.2);
      if (l) l.rotation.z = -0.25 + s * 0.75;
      if (a) a.rotation.z = 1.4 - s * 0.35;
    },
  },

  // ——— Passengers ———
  {
    id: "life-child-balloon",
    name: "Child with balloon",
    category: C,
    tags: ["person", "child", "passenger", "balloon", "small"],
    notes: "A small passenger in a yellow raincoat and bobble hat, holding a red balloon on a string. Children could ride free, and a let-go balloon floating over the layout is a little thing to spot.",
    build: (k) => {
      const g = person(k, TOY.yellow, { legs: TOY.blue });
      g.add(bobbleHat(k, TOY.red, TOY.white), buttons(k, TOY.blue, [5, 7.5]));
      const a = arm(k, TOY.yellow, 1, 2.2);
      a.add(pivot("balloon", 0, HAND, 0, rod(k, k.paint(TOY.white), [0, 0, 0], [0, 14, 0], 0.15, 0.15, 6), egg(k, k.paint(TOY.red), 3, 0, 17, 0, 1, 1.15, 1), k.cone(k.paint(TOY.red), 0.7, 1, 0, 13.5, 0, 8)));
      (a.children[a.children.length - 1] as Group).rotation.z = -2.2;
      g.add(a, arm(k, TOY.yellow, -1, 0.1));
      g.scale.setScalar(0.72);
      return k.group(g);
    },
    animate: (root, t) => {
      const b = part(root, "balloon");
      if (b) b.rotation.x = Math.sin(t * 1.4) * 0.15;
    },
  },
  {
    id: "life-grandparent",
    name: "Grandparent with cane",
    category: C,
    tags: ["person", "grandparent", "passenger", "cane", "glasses"],
    notes: "A grandparent in a purple coat, grey hair in a bun, round glasses and a walking cane. Takes a seat on the platform bench and wants a coach with a step: a slow, patient passenger.",
    build: (k) => {
      const g = person(k, TOY.purple, { legs: TOY.grey, hair: "#cfcfcf" });
      g.add(k.ball(k.paint("#cfcfcf"), 1.8, -3.1, 16.3, 0));
      g.add(band(k, TOY.cream, 9.8, 11, 0.3));
      const glasses = k.paint(TOY.black);
      for (const z of [-1.3, 1.3]) g.add(k.ring(glasses, 0.95, 0.18, 3.25, 14.6, z, true));
      for (const r of g.children.slice(-2)) r.rotation.y = Math.PI / 2;
      const a = arm(k, TOY.purple, 1, 0.45);
      hold(a, k.group(rod(k, k.paint(TOY.brown), [0, 0.5, 0], [0, -5, 0], 0.45), k.ring(k.paint(TOY.brown), 0.9, 0.45, -0.9, 0.5, 0, true, Math.PI)), 0, 0, 0.5);
      g.add(a, arm(k, TOY.purple, -1, 0.1));
      g.add(k.box(k.paint(TOY.red), 4, 3.2, 1.8, 0.6, 0, 1.6, -5.4));
      return g;
    },
  },
  {
    id: "life-traveller",
    name: "Traveller with suitcase",
    category: C,
    tags: ["person", "traveller", "passenger", "suitcase", "bowler"],
    notes: "A traveller in a green coat and bowler hat with a strapped brown case. A passenger with a destination: deliver them to the station they ask for to earn a ticket.",
    build: (k) => {
      const g = person(k, TOY.green, { legs: TOY.grey });
      g.add(bowler(k, TOY.black), buttons(k, TOY.black, [5, 7, 9]), band(k, TOY.cream, 10, 11, 0.25));
      const a = arm(k, TOY.green, 1, 0.05);
      hold(a, suitcase(k, TOY.brown), 0, 1.4, 1.4);
      g.add(a, arm(k, TOY.green, -1, 0.15));
      return g;
    },
  },
  {
    id: "life-tourist",
    name: "Tourist with camera",
    category: C,
    tags: ["person", "tourist", "passenger", "camera", "photo", "backpack"],
    notes: "A tourist in an orange shirt and sun hat with a backpack, snapping photos (the flash blinks). Stands by scenic spots; pass a viewpoint slowly and they take a photo for the album.",
    build: (k) => {
      const g = person(k, TOY.orange, { legs: TOY.sky });
      g.add(bucketHat(k, TOY.cream));
      g.add(k.box(k.paint(TOY.green), 3, 6, 5.5, 1.2, -4.2, 4.5, 0));
      const cam = new Group();
      cam.add(k.box(k.paint(TOY.black), 2.2, 2.4, 4.2, 0.5, 0, -1.2, 0));
      cam.add(k.cylX(k.paint(TOY.grey), 0.9, 1.4, 1.5, 0, 0, 12));
      cam.add(pivot("flash", 0, 1.2, 1.4, k.ball(k.paint(TOY.white), 0.7, 0, 0, 0)));
      const a = arm(k, TOY.orange, 1, 1.9);
      const b = arm(k, TOY.orange, -1, 1.9);
      a.rotation.x = 0.25;
      b.rotation.x = -0.25;
      g.add(a, b);
      g.add(k.at(cam, 6, 12.4, 0));
      return g;
    },
    animate: (root, t) => {
      const f = part(root, "flash");
      if (f) f.visible = t % 2.5 < 0.15;
    },
  },

  // ——— Town folk ———
  {
    id: "life-farmer",
    name: "Farmer with pitchfork",
    category: C,
    tags: ["person", "farmer", "farm", "straw hat", "pitchfork"],
    notes: "A farmer in a check-red shirt, blue dungarees and a wide straw hat, holding a pitchfork. Waits at the farm halt with milk churns and hay bales to send to town.",
    build: (k) => {
      const g = person(k, TOY.red, { legs: TOY.blue });
      g.add(band(k, TOY.blue, 3.6, 6.5), apron(k, TOY.blue, 6, 9.6, 3.6), strawHat(k));
      for (const y of [7.6, 9]) g.add(k.box(k.paint(TOY.white), 0.4, 0.4, 7, 0.1, rAt(y), y, 0));
      const fork = k.group(rod(k, k.paint(TOY.brown), [0, -4, 0], [0, 14, 0], 0.4));
      for (const z of [-1, 0, 1]) fork.add(rod(k, k.metal, [0, 14, z], [0, 17.5, z], 0.25));
      fork.add(k.cylZ(k.metal, 0.3, 2.4, 0, 14, 0, 8));
      const a = arm(k, TOY.red, 1, 0.6);
      hold(a, fork, 0, 0, 0.3);
      g.add(a, arm(k, TOY.red, -1, 0.1));
      return g;
    },
  },
  {
    id: "life-fisher",
    name: "Fisher on a crate",
    category: C,
    tags: ["person", "fisher", "fishing", "harbour", "rod", "sou'wester"],
    notes: "A fisher in a yellow oilskin and sou'wester, sitting on a crate with a rod and a bucket of catch. Park by the river or harbour; fish could be loaded into an ice van for market.",
    build: (k) => {
      const g = new Group();
      g.add(k.box(k.wood, 10, 6, 10, 0.8, 0, 0, 0));
      for (const y of [2, 4]) g.add(k.box(k.cut, 10.2, 0.5, 10.2, 0, 0, y, 0));
      const p = person(k, TOY.yellow, { legs: TOY.yellow });
      p.add(souwester(k, TOY.yellow), buttons(k, TOY.black, [5, 7.5]));
      const a = arm(k, TOY.yellow, 1, 1.1, "rod-arm");
      hold(a, k.group(rod(k, k.paint(TOY.brown), [0, 0, 0], [16, 14, 0], 0.4, 0.2), rod(k, k.paint(TOY.white), [16, 14, 0], [16, -6, 0], 0.08, 0.08, 4), k.ball(k.paint(TOY.red), 0.8, 16, -5, 0)), 0, 0, 0.3);
      p.add(a, arm(k, TOY.yellow, -1, 0.9));
      g.add(k.at(p, -1, 6, 0));
      g.add(k.cyl(k.paint(TOY.blue), 2.8, 4.5, -2, 0, 9, 3.4, 16), k.ring(k.paint(TOY.grey), 2.6, 0.2, -2, 6.5, 9, true, Math.PI));
      g.add(egg(k, k.paint(TOY.orange), 1.2, -2, 4.6, 9, 2, 0.8, 0.8));
      return g;
    },
    animate: (root, t) => {
      const a = part(root, "rod-arm");
      if (a) a.rotation.z = 1.1 + Math.sin(t * 1.6) * 0.06 + (t % 6 < 0.5 ? 0.25 : 0);
    },
  },
  {
    id: "life-firefighter",
    name: "Firefighter with hose",
    category: C,
    tags: ["person", "firefighter", "fire", "hose", "helmet", "emergency"],
    notes: "A firefighter in navy with reflective yellow bands and a red helmet, aiming a brass-nozzled hose from a coiled reel. Rides on the fire engine; a burning haystack event needs the water tanker to arrive.",
    build: (k) => {
      const coat = "#26324f";
      const g = person(k, coat, { legs: coat });
      g.add(band(k, TOY.yellow, 2.4, 3.2, 0.25), band(k, TOY.yellow, 6.5, 7.3, 0.25), fireHelmet(k, TOY.red));
      const hose = k.paint(TOY.red);
      g.add(k.ring(hose, 3.3, 1, 0, 1, -8), k.ring(hose, 3.3, 1, 0, 2.6, -8), k.cyl(k.paint(TOY.grey), 1.5, 4, 0, 0, -8));
      g.add(rod(k, hose, [2.6, 2.6, -8], [5.5, 6, -2], 0.7));
      const a = arm(k, coat, 1, 1.1);
      const b = arm(k, coat, -1, 1.1);
      g.add(a, b);
      g.add(rod(k, hose, [5.5, 6, -2], [6, 6, 0.5], 0.7), rod(k, k.paint(GOLD), [5.4, 6.2, 0.5], [10, 6.8, 0.5], 0.8, 0.45));
      g.add(pivot("spray", 10.5, 6.8, 0.5, ...[0, 1, 2].map((i) => k.ball(k.paint(TOY.sky), 0.7 - i * 0.1, 2 + i * 2.5, 0, 0))));
      return g;
    },
    animate: (root, t) => {
      const s = part(root, "spray");
      if (s) s.position.x = 10.5 + ((t * 6) % 2.5);
    },
  },
  {
    id: "life-police",
    name: "Police officer directing traffic",
    category: C,
    tags: ["person", "police", "traffic", "helmet", "whistle", "town"],
    notes: "A police officer in a tall rounded helmet, white gloves raised to stop the traffic. Stand at a level crossing or junction: road vehicles wait while the officer's arm is up.",
    build: (k) => {
      const coat = "#1b2a4e";
      const g = person(k, coat, { legs: coat });
      g.add(buttons(k, SILVER, [4.5, 6.5, 8.5]), band(k, TOY.black, 5.4, 6, 0.25), policeHelmet(k, coat));
      const a = arm(k, coat, 1, 2.9, "stop-arm");
      a.add(k.ball(k.paint(TOY.white), 1.35, 0, HAND, 0));
      g.add(a, arm(k, coat, -1, 0.1));
      return g;
    },
    animate: (root, t) => {
      const a = part(root, "stop-arm");
      if (a) a.rotation.z = (t % 6) < 3 ? 2.9 : 0.15;
    },
  },
  {
    id: "life-postie",
    name: "Postie with sack",
    category: C,
    tags: ["person", "postie", "post", "mail", "letters", "sack"],
    notes: "A postie in a red coat and cap with a bulging mail sack on the back and a letter in hand. Collects from the post box and rides the mail van; letters are a light, quick cargo between towns.",
    build: (k) => {
      const g = person(k, TOY.red, { legs: TOY.black });
      g.add(cap(k, TOY.red, TOY.black), band(k, TOY.yellow, 10.2, 10.8, 0.3));
      g.add(egg(k, k.paint("#c9b48a"), 4, -5.2, 8.5, 0, 0.7, 1.1, 1));
      g.add(k.cyl(k.paint("#a08a5e"), 1.2, 1.6, -5.2, 12.6, 0, 0.8, 12));
      g.add(rod(k, k.paint(TOY.brown), [-3.6, 12, -2.2], [3.1, 4.5, 2.6], 0.4));
      const a = arm(k, TOY.red, 1, 1.0);
      hold(a, k.box(k.paint(TOY.white), 0.4, 3, 4.4, 0.1, 1.2, -0.5, 0), 0, 0, 0);
      g.add(a, arm(k, TOY.red, -1, 0.1));
      return g;
    },
  },
  {
    id: "life-baker",
    name: "Baker with bread tray",
    category: C,
    tags: ["person", "baker", "bread", "bakery", "food", "town"],
    notes: "A baker in white with a cream apron and a pillbox cap, carrying a tray of loaves. Bakeries take flour from the mill and send bread out on the morning train.",
    build: (k) => {
      const g = person(k, TOY.white, { legs: TOY.grey });
      g.add(apron(k, TOY.cream, 1, 9.5, 5), pillbox(k, TOY.white));
      const tray = new Group();
      tray.add(k.box(k.paint(TOY.brown), 7, 0.8, 8, 0.3, 3, 0, 0));
      for (const z of [-2.4, 0, 2.4]) tray.add(egg(k, k.paint("#c98a3e"), 1.3, 3, 1.5, z, 2.2, 0.9, 0.9));
      tray.add(egg(k, k.paint("#b06f2c"), 1.4, 3, 3, 0, 1.6, 1, 1));
      g.add(arm(k, TOY.white, 1, 1.45), arm(k, TOY.white, -1, 1.45));
      g.add(k.at(tray, 1.5, 9.4, 0));
      return g;
    },
  },
  {
    id: "life-chef",
    name: "Chef flipping pancakes",
    category: C,
    tags: ["person", "chef", "cook", "pan", "restaurant", "dining car"],
    notes: "A chef in a tall toque and red neckerchief tossing a pancake in a pan. Belongs in the dining car or station café; a busy chef means hungry passengers want the food wagon.",
    build: (k) => {
      const g = person(k, TOY.white, { legs: TOY.black });
      g.add(toque(k), band(k, TOY.red, 9.8, 11, 0.3), buttons(k, TOY.black, [4.5, 6.5, 8.5]));
      g.add(arm(k, TOY.white, 1, 1.3, "pan-arm"), arm(k, TOY.white, -1, 0.1));
      const pan = k.group(k.cyl(k.paint(TOY.black), 3, 1, 9, 6.5, 2, 2.6, 20), rod(k, k.paint(TOY.black), [6.5, 7, 2], [3, 7.8, 3.8], 0.4));
      g.add(pan);
      g.add(pivot("pancake", 9, 7.6, 2, k.cyl(k.paint("#e6c27a"), 2.2, 0.5, 0, 0, 0, 2.2, 16)));
      return g;
    },
    animate: (root, t) => {
      const p = part(root, "pancake");
      if (!p) return;
      const s = (t % 1.6) / 1.6;
      p.position.y = 7.6 + Math.sin(s * Math.PI) * 8;
      p.rotation.z = s * Math.PI * 2;
    },
  },
  {
    id: "life-doctor",
    name: "Doctor with bag",
    category: C,
    tags: ["person", "doctor", "medical", "bag", "stethoscope", "hospital"],
    notes: "A doctor in a white coat over teal, stethoscope round the neck, carrying a black bag. Hurries to the station when someone is poorly: an express job that clears the line ahead.",
    build: (k) => {
      const g = person(k, TOY.white, { legs: TOY.teal, hair: TOY.brown });
      g.add(apron(k, TOY.teal, 5, 10.6, 2.2));
      g.add(rod(k, k.paint(TOY.black), [3.2, 10.6, -2.4], [3.5, 6.5, -1], 0.25), rod(k, k.paint(TOY.black), [3.2, 10.6, 2.4], [3.5, 6.5, 1], 0.25));
      g.add(k.cylX(k.paint(SILVER), 0.8, 0.6, 3.7, 6.2, 0, 12));
      const bag = k.group(k.box(k.paint(TOY.black), 6, 4, 3, 1.2, 0, -4.6, 0), k.ring(k.paint(GOLD), 1, 0.3, 0, -0.5, 0, true, Math.PI), k.box(k.paint(GOLD), 6.1, 0.4, 3.1, 0.1, 0, -1.6, 0));
      const a = arm(k, TOY.white, 1, 0.1);
      hold(a, bag, 0, 0.8, 1.6);
      g.add(a, arm(k, TOY.white, -1, 0.15));
      return g;
    },
  },
  {
    id: "life-builder",
    name: "Builder with wheelbarrow",
    category: C,
    tags: ["person", "builder", "hard hat", "wheelbarrow", "construction", "sand"],
    notes: "A builder in a yellow hard hat and hi-vis bib pushing a wheelbarrow of sand, a shovel stuck in it. Shows up where a track or building is being placed; new pieces arrive in their barrow.",
    build: (k) => {
      const g = new Group();
      const p = person(k, TOY.blue, { legs: "#244f86" });
      p.add(apron(k, TOY.orange, 3.5, 10, 6), band(k, TOY.white, 6.5, 7.2, 0.35), hardHat(k, TOY.yellow));
      p.add(arm(k, TOY.blue, 1, 0.9), arm(k, TOY.blue, -1, 0.9));
      g.add(k.at(p, -13, 0, 0));
      // Barrow: a tray on a front wheel, two legs, two handles back to the builder's hands.
      const green = k.paint(TOY.green);
      g.add(k.cylZ(k.paint(TOY.black), 3, 2.2, 8, 3, 0, 20), k.cylZ(k.metal, 0.9, 3.4, 8, 3, 0, 10));
      g.add(k.box(green, 12, 5, 10, 1.6, 1.5, 5, 0));
      g.add(dome(k, k.paint("#d9b97a"), 4.6, 2.4, 1.5, 9.8, 0));
      for (const z of [-3.6, 3.6]) {
        g.add(rod(k, k.metal, [8, 3, z * 0.4], [-8.8, 6.7, z], 0.5));
        g.add(rod(k, k.metal, [-3, 5, z], [-3, 0, z], 0.5));
      }
      g.add(k.group(rod(k, k.paint(TOY.brown), [0, 11, 2], [-5, 22, 3], 0.4), k.box(k.metal, 1, 4, 3.4, 0.3, 1.6, 8, 1.8)));
      return g;
    },
  },
  {
    id: "life-crane-operator",
    name: "Crane operator with pendant",
    category: C,
    tags: ["person", "crane", "operator", "hard hat", "hi-vis", "yard", "controls"],
    notes: "A crane operator in an orange hard hat and hi-vis vest, working a yellow push-button pendant on a dangling cable. Stand them by the goods-yard crane: tap the operator to work the crane.",
    build: (k) => {
      const g = person(k, TOY.grey, { legs: "#244f86" });
      g.add(band(k, TOY.yellow, 4, 10.4, 0.25), band(k, SILVER, 6.6, 7.2, 0.35), hardHat(k, TOY.orange));
      g.add(arm(k, TOY.grey, 1, 1.0), arm(k, TOY.grey, -1, 1.0));
      const pend = new Group();
      pend.add(k.box(k.paint(TOY.yellow), 2.6, 5, 2.6, 0.8, 0, -2.5, 0));
      pend.add(k.ball(k.paint(TOY.green), 0.5, 1.35, 1, 0.5), k.ball(k.paint(TOY.red), 0.5, 1.35, 1, -0.5));
      pend.add(pivot("go", 1.35, -1, 0, k.ball(k.paint(TOY.green), 0.55, 0, 0, 0)));
      pend.add(rod(k, k.paint(TOY.black), [0, 2.5, 0], [-2, 14, 3], 0.25));
      g.add(k.at(pend, 4.8, 7, 0));
      return g;
    },
    animate: (root, t) => {
      const b = part(root, "go");
      if (b) b.position.x = 1.35 - (Math.sin(t * 3) > 0.5 ? 0.35 : 0);
    },
  },
  {
    id: "life-ice-cream-seller",
    name: "Ice-cream seller and cart",
    category: C,
    tags: ["person", "ice cream", "cart", "umbrella", "seaside", "park"],
    notes: "An ice-cream seller in a striped boater behind a two-wheeled cart under a pink parasol, holding out a cone. Set up by the beach halt: on hot days passengers queue, and the cart needs milk from the dairy.",
    build: (k) => {
      const g = new Group();
      const cart = new Group();
      cart.add(k.box(k.paint(TOY.cream), 16, 10, 12, 2, 0, 5, 0));
      cart.add(k.box(k.paint(TOY.pink), 16.4, 2, 12.4, 0.8, 0, 9, 0));
      cart.add(k.box(k.paint(TOY.sky), 16.4, 1.4, 12.4, 0.6, 0, 5.4, 0));
      for (const z of [-6.8, 6.8]) cart.add(k.wheel(5, -2, 5, z, TOY.red, 1.6));
      cart.add(rod(k, k.wood, [7, 5, 0], [7, 0, 0], 0.8));
      cart.add(k.cyl(k.paint(TOY.white), 6.5, 1, 0, 15, 0, 6.8, 20));
      const scoops = [TOY.pink, TOY.cream, "#7a4a2a"];
      scoops.forEach((c, i) => cart.add(k.ball(k.paint(c), 1.8, -4 + i * 4, 16.2, 0)));
      cart.add(rod(k, k.wood, [-6, 15, 0], [-6, 36, 0], 0.5));
      cart.add(k.cone(k.paint(TOY.pink), 13, 5, -6, 33, 0, 24), k.ring(k.paint(TOY.white), 12.6, 0.6, -6, 33.2, 0), k.ball(k.paint(TOY.yellow), 1, -6, 38.4, 0));
      g.add(k.at(cart, 6, 0, 0));
      const p = person(k, TOY.white, { legs: TOY.sky });
      p.add(band(k, TOY.pink, 2, 3, 0.25), band(k, TOY.pink, 5, 6, 0.25), band(k, TOY.pink, 8, 9, 0.25), boater(k, TOY.red));
      const a = arm(k, TOY.white, 1, 1.3);
      hold(a, k.group(rod(k, k.paint("#d9a868"), [0, -2.5, 0], [0, 1, 0], 0.05, 1.2), k.ball(k.paint(TOY.pink), 1.5, 0, 1.8, 0)), 0, 0, 0.6);
      p.add(a, arm(k, TOY.white, -1, 0.2));
      g.add(k.at(p, -10, 0, 7));
      return g;
    },
  },
  {
    id: "life-band",
    name: "Station band",
    category: C,
    tags: ["person", "band", "music", "drum", "trumpet", "parade", "festival"],
    notes: "A drummer and a trumpeter in red tunics and plumed band hats on a little round stage. Plays when a special train arrives: a celebration for finishing a route or a festival day.",
    build: (k) => {
      const g = new Group();
      g.add(k.cyl(k.wood, 22, 2, 0, 0, 0, 21, 36), k.cyl(k.paint(TOY.blue), 22.2, 0.8, 0, 0.6, 0, 22.2, 36));
      const tunic = TOY.red;
      // Drummer.
      const d = person(k, tunic, { legs: TOY.black });
      d.add(band(k, TOY.white, 6.5, 7.1, 0.25), bandHat(k, TOY.black, TOY.white));
      d.add(rod(k, k.paint(TOY.white), [2, 10.5, -3], [3.6, 5, 2.5], 0.3));
      for (const s of [1, -1] as const) {
        const a = arm(k, tunic, s, 1.0, s > 0 ? "stick-r" : "stick-l");
        hold(a, rod(k, k.wood, [0, 0, 0], [4, -1.5, -s * 2], 0.3, 0.25), 0, 0, 0);
        d.add(a);
      }
      d.add(k.cyl(k.paint(TOY.blue), 4, 4.4, 8, 2.6, 0, 4, 20), k.cyl(k.paint(TOY.white), 4.2, 0.6, 8, 2.6, 0, 4.2, 20), k.cyl(k.paint(TOY.white), 4.2, 0.6, 8, 6.4, 0, 4.2, 20), k.cyl(k.paint(TOY.cream), 3.7, 0.2, 8, 7, 0, 3.7, 20));
      d.add(rod(k, k.metal, [8, 0, 0], [8, 2.6, 0], 0.4));
      g.add(k.at(d, -4, 2, -8));
      // Trumpeter.
      const tr = pivot("trumpeter", -2, 2, 9);
      const p = person(k, tunic, { legs: TOY.black });
      p.add(band(k, TOY.white, 6.5, 7.1, 0.25), bandHat(k, TOY.black, TOY.yellow));
      p.add(arm(k, tunic, 1, 1.5), arm(k, tunic, -1, 1.5));
      const gold = k.paint(GOLD);
      p.add(rod(k, gold, [3.2, 13, 0], [9, 12, 0], 0.4), k.cyl(gold, 0.5, 2.5, 6, 12.6, 0, 0.5, 8), rod(k, gold, [9, 12, 0], [12.5, 11.4, 0], 0.5, 2.4), k.ring(gold, 1.8, 0.3, 6.5, 10.2, 0, true));
      tr.add(p);
      g.add(tr);
      return g;
    },
    animate: (root, t) => {
      const r = part(root, "stick-r");
      const l = part(root, "stick-l");
      const tr = part(root, "trumpeter");
      if (r) r.rotation.z = 1.0 + Math.max(0, Math.sin(t * 9)) * 0.4;
      if (l) l.rotation.z = 1.0 + Math.max(0, -Math.sin(t * 9)) * 0.4;
      if (tr) tr.rotation.z = Math.sin(t * 2.25) * 0.08;
    },
  },
  {
    id: "life-family",
    name: "Family day out",
    category: C,
    tags: ["person", "family", "passengers", "children", "group", "holiday"],
    notes: "Two grown-ups and two children holding hands on a little plinth, the smallest hopping with excitement. A group fare: they all need seats in the same coach to the seaside.",
    build: (k) => {
      const g = new Group();
      g.add(k.box(k.wood, 46, 2, 14, 0.8, 0, 0, 0));
      const folk: [string, string, number, number, string | undefined][] = [
        [TOY.blue, TOY.grey, 1, -15, TOY.black],
        [TOY.green, TOY.blue, 0.68, -4, TOY.yellow],
        [TOY.pink, TOY.cream, 0.6, 5, TOY.brown],
        [TOY.red, TOY.black, 1, 15, "#8a5a2a"],
      ];
      folk.forEach(([coat, legs, s, z, hair], i) => {
        const p = person(k, coat, { legs, hair });
        p.add(arm(k, coat, 1, 0.1), arm(k, coat, -1, 0.1));
        if (i === 0) p.add(topHat(k, TOY.black));
        p.scale.setScalar(s);
        g.add(pivot(i === 2 ? "hopper" : "", 0, 2, z, p));
      });
      // Hands joined between neighbours.
      const hand = (i: number, side: number): V3 => [0, 2 + 4.4 * folk[i][2], folk[i][3] + side * 4.2 * folk[i][2]];
      for (let i = 0; i < 3; i++) g.add(rod(k, k.wood, hand(i, 1), hand(i + 1, -1), 0.9, 0.9, 10));
      return g;
    },
    animate: (root, t) => {
      const h = part(root, "hopper");
      if (h) h.position.y = 2 + Math.abs(Math.sin(t * 4)) * 3;
    },
  },

  // ——— Farm animals ———
  {
    id: "life-dog",
    name: "Dog",
    category: C,
    tags: ["animal", "dog", "pet", "wag"],
    notes: "A chunky brown dog with floppy black ears and a red collar, tail wagging. Follows its owner to the station; a lost dog could be returned on the next train for a reward.",
    build: (k) => {
      const { g, head, tail } = quad(k, "#a0683a", 18, 8, 7, 5, 1.6);
      const m = k.paint("#a0683a");
      head.add(k.ball(m, 3.8, 2, 3, 0), k.box(m, 4, 3, 3.6, 1.2, 5, 0.6, 0), k.ball(k.paint(TOY.black), 0.9, 7, 2.4, 0));
      head.add(eyes(k, 4.6, 4.4, 1.5, 0.55));
      for (const s of [-1, 1]) head.add(egg(k, k.paint(TOY.black), 1.5, 1, 2.6, s * 3.6, 0.9, 1.8, 0.45));
      head.add(k.ring(k.paint(TOY.red), 3, 0.5, 0, 0, 0, true));
      (head.children[head.children.length - 1] as Mesh).rotation.y = Math.PI / 2;
      tail.add(rod(k, m, [0, 0, 0], [-3.5, 4.5, 0], 1, 0.5));
      return g;
    },
    animate: (root, t) => {
      const tl = part(root, "tail");
      if (tl) tl.rotation.x = Math.sin(t * 14) * 0.6;
    },
  },
  {
    id: "life-cat",
    name: "Cat",
    category: C,
    tags: ["animal", "cat", "pet", "station cat"],
    notes: "A sitting ginger cat with pointed ears and a swishing tail. Every station needs a station cat: it naps on the sunniest platform and wakes when a train pulls in.",
    build: (k) => {
      const g = new Group();
      const m = k.paint(TOY.orange);
      g.add(egg(k, m, 4, 0, 4.4, 0, 1, 1.1, 0.9));
      for (const s of [-1, 1]) g.add(egg(k, m, 2.4, -0.8, 2.2, s * 2.8, 1.3, 0.9, 0.7), k.capsule(m, 0.9, 3, 2.6, 0, s * 1.3));
      g.add(k.ball(m, 3, 1, 10.4, 0));
      for (const s of [-1, 1]) g.add(rod(k, m, [0.8, 12, s * 1.6], [0.6, 14.4, s * 2.1], 1.1, 0.1, 8));
      g.add(eyes(k, 3.6, 11, 1.1, 0.5, TOY.leaf), k.ball(k.paint(TOY.pink), 0.45, 4, 10, 0));
      g.add(egg(k, k.paint(TOY.cream), 2, 2.5, 6, 0, 0.6, 1.3, 1));
      const tail = pivot("tail", -3.5, 1.5, 0, rod(k, m, [0, 0, 0], [-3, 1, 2], 0.9), rod(k, m, [-3, 1, 2], [-3.5, 5, 4], 0.9, 0.7), k.ball(m, 0.7, -3.5, 5, 4));
      g.add(tail);
      return g;
    },
    animate: (root, t) => {
      const tl = part(root, "tail");
      if (tl) tl.rotation.y = Math.sin(t * 1.5) * 0.5;
    },
  },
  {
    id: "life-cow",
    name: "Cow",
    category: C,
    tags: ["animal", "cow", "farm", "milk", "graze"],
    notes: "A black-and-white cow with horns, pink muzzle, udder and a brass bell, lowering her head to graze. A field of cows supplies milk churns for the dairy train.",
    build: (k) => {
      const { g, head, tail } = quad(k, TOY.white, 32, 15, 15, 10, 2.5, TOY.white, TOY.black);
      g.add(spots(k, TOY.black, 7.55, [[-6, 18, 3.4], [6, 15, 2.8], [-10, 13, 2]]));
      g.add(k.cyl(k.paint(TOY.black), 3.5, 0.5, 2, 25, 1.5, 3.5, 16));
      g.add(egg(k, k.paint(TOY.pink), 3, -8, 10, 0, 1, 0.6, 1), k.many(4, (i) => k.cyl(k.paint(TOY.pink), 0.5, 1.5, -9 + (i % 2) * 2, 7.5, i < 2 ? -1 : 1)));
      const w = k.paint(TOY.white);
      head.add(k.box(w, 9, 9, 8, 3, 5, -5, 0), k.box(k.paint(TOY.pink), 4, 5, 8.4, 2, 9, -6, 0), eyes(k, 7, 1.5, 2.6, 0.7));
      head.add(k.ball(k.paint(TOY.black), 0.5, 11, -3, -1.5), k.ball(k.paint(TOY.black), 0.5, 11, -3, 1.5));
      for (const s of [-1, 1]) {
        head.add(rod(k, k.paint(TOY.cream), [4, 3.5, s * 2.5], [4.5, 6.5, s * 5.5], 0.9, 0.3));
        head.add(k.box(w, 2.5, 1.5, 3, 0.5, 2.5, 1.5, s * 5));
      }
      head.add(k.cone(k.paint(GOLD), 1.5, 2.5, 2, -8, 0, 12));
      tail.add(rod(k, w, [0, 0, 0], [-1.5, -11, 0], 0.6), k.ball(k.paint(TOY.black), 1.2, -1.5, -11.5, 0, 1.4));
      return g;
    },
    animate: (root, t) => {
      const h = part(root, "head");
      const tl = part(root, "tail");
      if (h) h.rotation.z = -0.45 * (0.5 + 0.5 * Math.sin(t * 0.7));
      if (tl) tl.rotation.x = Math.sin(t * 2.5) * 0.35;
    },
  },
  {
    id: "life-sheep",
    name: "Sheep",
    category: C,
    tags: ["animal", "sheep", "farm", "wool", "lamb"],
    notes: "A fluffy sheep of stacked white beads with a black face and legs, chewing. A flock in the hills gives wool bales for the mill; sheep on the line would stop a train.",
    build: (k) => {
      const { g, head } = quad(k, TOY.white, 20, 12, 10, 6, 1.3, TOY.black);
      const w = k.paint(TOY.white);
      for (const x of [-6, 0, 6]) for (const s of [-1, 1]) g.add(k.ball(w, 3.6, x, 11.5, s * 3.5));
      for (const x of [-3, 3]) g.add(k.ball(w, 3.8, x, 15, 0));
      g.add(k.ball(w, 3.6, -9, 12, 0));
      const b = k.paint(TOY.black);
      head.add(k.box(b, 6, 6, 5, 2.2, 4, -1, 0), eyes(k, 7, 3, 1.5, 0.55, TOY.white), k.ball(w, 2.6, 2, 5, 0));
      for (const s of [-1, 1]) head.add(egg(k, b, 1.2, 3, 3, s * 3.2, 0.7, 0.7, 1.8));
      return g;
    },
    animate: (root, t) => {
      const h = part(root, "head");
      if (h) h.rotation.z = Math.sin(t * 5) * 0.06 - 0.1;
    },
  },
  {
    id: "life-pig",
    name: "Pig",
    category: C,
    tags: ["animal", "pig", "farm", "mud", "curly tail"],
    notes: "A round pink pig with a big snout, triangle ears and a curly tail that twirls, standing in a puddle of mud. Pigs love the turnip wagon; a muddy pig might need a wash at the water tower.",
    build: (k) => {
      const { g, head, tail } = quad(k, TOY.pink, 22, 13, 12, 5, 2.1);
      g.add(k.cyl(k.paint("#5a3a22"), 10, 0.5, -1, 0, 0, 9.5, 24));
      const m = k.paint(TOY.pink);
      head.add(k.ball(m, 5, 2, 0.5, 0), k.cylX(k.paint("#d9768f"), 2.4, 3, 7.4, -0.2, 0, 16));
      head.add(k.ball(k.paint("#7a3040"), 0.5, 8.9, -0.2, -0.9), k.ball(k.paint("#7a3040"), 0.5, 8.9, -0.2, 0.9), eyes(k, 5.6, 2.8, 2, 0.55));
      for (const s of [-1, 1]) head.add(rod(k, m, [1.5, 3.5, s * 2.6], [3, 6.5, s * 3.6], 1.5, 0.1, 8));
      const curl = pivot("curl", -0.6, 0, 0, k.ring(m, 1.4, 0.45, 0, 0, 0, true, Math.PI * 1.6));
      curl.rotation.y = Math.PI / 2;
      tail.add(curl);
      return g;
    },
    animate: (root, t) => {
      const c = part(root, "curl");
      if (c) c.rotation.z = t * 4;
    },
  },
  {
    id: "life-horse",
    name: "Horse",
    category: C,
    tags: ["animal", "horse", "farm", "saddle", "pony"],
    notes: "A chestnut horse with a black mane and tail and a red saddle cloth, nodding. Could pull a cart to the station, or race the train along the field fence for a bonus.",
    build: (k) => {
      const coat = "#9a5a2e";
      const { g, head, tail } = quad(k, coat, 30, 11, 12, 15, 1.9, coat, TOY.black);
      const m = k.paint(coat);
      const b = k.paint(TOY.black);
      g.add(k.box(k.paint(TOY.red), 10, 2, 11.8, 0.8, 0, 25.5, 0), k.box(k.paint(GOLD), 10.4, 0.6, 12.2, 0.3, 0, 25.4, 0));
      head.add(rod(k, m, [-2, 0, 0], [3.5, 11, 0], 3.6, 2.8));
      const face = k.box(m, 10, 5, 5, 2, 0, 0, 0);
      face.position.set(7.5, 10, 0);
      face.rotation.z = -0.55;
      head.add(face, rod(k, b, [-4, 2, 0], [1.4, 13.6, 0], 1.2), eyes(k, 6, 12, 2.3, 0.6));
      for (const s of [-1, 1]) head.add(rod(k, m, [3.6, 13, s * 1.3], [3.4, 16, s * 1.5], 1, 0.1, 8));
      head.add(k.ball(b, 0.5, 11.2, 6.6, -1.2), k.ball(b, 0.5, 11.2, 6.6, 1.2));
      tail.add(rod(k, b, [0, 0, 0], [-3, -4, 0], 1.4, 1.8), rod(k, b, [-3, -4, 0], [-3.5, -12, 0], 1.8, 1));
      return g;
    },
    animate: (root, t) => {
      const h = part(root, "head");
      const tl = part(root, "tail");
      if (h) h.rotation.z = Math.sin(t * 1.8) * 0.08;
      if (tl) tl.rotation.x = Math.sin(t * 2.6) * 0.3;
    },
  },
  {
    id: "life-goat",
    name: "Goat on a rock",
    category: C,
    tags: ["animal", "goat", "farm", "mountain", "rock", "horns"],
    notes: "A grey-and-white goat with curling horns and a beard, stood proudly on a boulder. Lives on hill blocks: it eats anything left on the line, so keep the wagons moving.",
    build: (k) => {
      const g = new Group();
      g.add(dome(k, k.paint(TOY.grey), 13, 8, 0, 0, 0));
      const { g: goat, head, tail } = quad(k, TOY.white, 20, 9, 9, 9, 1.4);
      g.add(k.at(goat, 0, 5, 0));
      goat.add(k.box(k.paint(TOY.grey), 12, 3, 9.4, 1.4, 0, 15.5, 0));
      const m = k.paint(TOY.white);
      const face = k.box(m, 8, 5, 5, 2, 0, 0, 0);
      face.position.set(4.5, 2.5, 0);
      face.rotation.z = -0.6;
      head.add(face, eyes(k, 4.4, 4.6, 2.2, 0.55), rod(k, m, [6, -0.5, 0], [6.5, -4.5, 0], 1, 0.2, 8));
      for (const s of [-1, 1]) {
        const horn = k.ring(k.paint(TOY.cream), 2.6, 0.7, 0.5, 6, s * 1.6, true, Math.PI * 1.1);
        head.add(horn, k.box(m, 2.5, 1.2, 2.5, 0.5, 2, 4.4, s * 3.4));
      }
      tail.add(rod(k, m, [0, 0, 0], [-1.5, 3, 0], 0.8, 0.3));
      return g;
    },
    animate: (root, t) => {
      const h = part(root, "head");
      if (h) h.rotation.z = (t % 4) < 0.6 ? -0.4 * Math.sin(((t % 4) / 0.6) * Math.PI) : 0;
    },
  },
  {
    id: "life-chickens",
    name: "Chickens",
    category: C,
    tags: ["animal", "chicken", "hen", "rooster", "farm", "eggs"],
    notes: "Two hens and a rooster pecking at the ground round a scatter of corn. A hen house sends egg crates on the early train; the rooster could wake the layout in the morning.",
    build: (k) => {
      const g = new Group();
      const birds: [string, number, number, number][] = [
        [TOY.white, 0, 0, 0],
        ["#a85a2a", -9, 6, 2.2],
        ["#5a3a2a", 7, -7, -0.8],
      ];
      birds.forEach(([col, x, z, ry], i) => {
        const b = bird(k, col, { r: i === 2 ? 4.4 : 3.6, legs: 2.5, headName: `peck-${i}`, beakCol: TOY.yellow });
        const h = b.getObjectByName(`peck-${i}`)!;
        const r = i === 2 ? 4.4 : 3.6;
        h.add(k.many(3, (j) => k.ball(k.paint(TOY.red), r * 0.2, r * 0.1 + j * r * 0.18, r * 1.05 + Math.sin(j) * 0.4, 0)));
        h.add(k.ball(k.paint(TOY.red), r * 0.16, r * 0.75, r * 0.05, 0, 1.6));
        if (i === 2) b.add(rod(k, k.paint(TOY.green), [-3, 7.8, 0], [-8, 12, 0], 2, 0.2), rod(k, k.paint(TOY.black), [-3.4, 7, 0], [-7.6, 9.8, 0], 1.6, 0.2));
        g.add(k.at(b, x, 0, z, ry));
      });
      for (let i = 0; i < 9; i++) g.add(k.ball(k.paint(TOY.yellow), 0.5, 4 + Math.sin(i * 2.4) * 4, 0.4, 3 + Math.cos(i * 2.4) * 4));
      return g;
    },
    animate: (root, t) => {
      for (let i = 0; i < 3; i++) {
        const h = part(root, PECKS[i]);
        if (h) h.rotation.z = -Math.max(0, Math.sin(t * 3 + i * 2.1)) * 0.9;
      }
    },
  },
  {
    id: "life-ducks",
    name: "Duck and ducklings",
    category: C,
    tags: ["animal", "duck", "ducklings", "pond", "water", "bob"],
    notes: "A white duck leading a line of three yellow ducklings across a felt pond, all bobbing. Ducks crossing near the river bridge could hold up a slow train until they're over.",
    build: (k) => {
      const g = new Group();
      g.add(pond(k, 28));
      const line: [number, number, number, string][] = [
        [10, 0, 1, TOY.white],
        [0, 3, 0.55, TOY.yellow],
        [-8, -2, 0.55, TOY.yellow],
        [-16, 2, 0.55, TOY.yellow],
      ];
      line.forEach(([x, z, s, col], i) => {
        const d = bird(k, col, { r: 4.4, headName: "", neck: 1.5 });
        d.scale.setScalar(s);
        g.add(pivot(DUCKS[i], x, -0.6, z, d));
      });
      return g;
    },
    animate: (root, t) => {
      for (let i = 0; i < 4; i++) {
        const d = part(root, DUCKS[i]);
        if (!d) continue;
        d.position.y = -0.6 + Math.sin(t * 2.5 + i * 1.3) * 0.4;
        d.rotation.z = Math.sin(t * 2.5 + i * 1.3 + 0.8) * 0.08;
      }
    },
  },
  {
    id: "life-swans",
    name: "Pair of swans",
    category: C,
    tags: ["animal", "swan", "pond", "river", "water", "elegant"],
    notes: "Two white swans with curved necks and orange beaks gliding face to face on a pond. Grace the park lake; they could glide under a bridge only when no train is crossing.",
    build: (k) => {
      const g = new Group();
      g.add(pond(k, 32));
      for (const [i, x, ry] of [[0, -9, 0], [1, 9, Math.PI]] as const) {
        const s = new Group();
        const w = k.paint(TOY.white);
        s.add(egg(k, w, 6, 0, 3, 0, 1.4, 0.65, 1));
        for (const side of [-1, 1]) {
          const wing = egg(k, w, 4.5, -2.5, 5.5, side * 3.5, 1.5, 0.6, 0.45);
          wing.rotation.z = 0.35;
          s.add(wing);
        }
        s.add(rod(k, w, [-7, 4.5, 0], [-10, 8, 0], 2.4, 0.4));
        s.add(rod(k, w, [5, 4, 0], [3, 11, 0], 1.6, 1.3), rod(k, w, [3, 11, 0], [4.2, 16, 0], 1.3, 1.2));
        s.add(k.ball(w, 2, 5, 16.5, 0), beak(k, k.paint(TOY.orange), 0.9, 3.6, 6.4, 16, 0), k.ball(k.paint(TOY.black), 0.8, 6.6, 16.5, 0));
        s.add(eyes(k, 5.6, 17.3, 1.4, 0.4));
        g.add(pivot(SWANS[i], x, -0.2, 0, k.at(s, 0, 0, 0, ry)));
      }
      return g;
    },
    animate: (root, t) => {
      for (let i = 0; i < 2; i++) {
        const s = part(root, SWANS[i]);
        if (s) s.position.y = -0.2 + Math.sin(t * 1.6 + i * Math.PI) * 0.35;
      }
    },
  },
  {
    id: "life-geese",
    name: "Honking geese",
    category: C,
    tags: ["animal", "goose", "geese", "farm", "honk"],
    notes: "Two grey farmyard geese on orange legs, necks stretching out to honk in turn. Guard the farm gate: they chase off anyone who leaves it open (a gentle penalty for blocking the road).",
    build: (k) => {
      const g = new Group();
      for (const [i, x, z, ry] of [[0, 4, -5, 0.3], [1, -5, 6, -0.4]] as const) {
        const b = bird(k, i ? TOY.grey : TOY.white, { r: 5, legs: 4, neck: 7, headName: GEESE[i] });
        g.add(k.at(b, x, 0, z, ry));
      }
      return g;
    },
    animate: (root, t) => {
      for (let i = 0; i < 2; i++) {
        const h = part(root, GEESE[i]);
        const p = (t + i * 1.5) % 3;
        if (h) h.rotation.z = p < 0.8 ? -Math.sin((p / 0.8) * Math.PI) * 0.7 : 0;
      }
    },
  },
  {
    id: "life-rabbit",
    name: "Rabbit with carrot",
    category: C,
    tags: ["animal", "rabbit", "bunny", "hop", "carrot", "field"],
    notes: "A grey rabbit with tall ears and a cotton tail hopping beside a carrot. Rabbits pop out of hill tunnels; a carrot delivery to the allotments could be a tiny cargo job.",
    build: (k) => {
      const g = new Group();
      const b = pivot("bunny", 0, 0, 0);
      const m = k.paint("#9a9590");
      b.add(egg(k, m, 4.4, 0, 4.4, 0, 1.25, 0.95, 0.95));
      for (const s of [-1, 1]) b.add(egg(k, m, 2.6, -2.2, 2.6, s * 2.6, 1.4, 1, 0.6), k.capsule(m, 0.9, 1.6, 3.4, 0, s * 1.4));
      b.add(k.ball(m, 3, 5, 8.6, 0), k.ball(k.paint(TOY.white), 1.8, -5.4, 5, 0));
      for (const s of [-1, 1]) {
        b.add(rod(k, m, [4, 10.6, s * 1.2], [2, 17, s * 2.2], 1.1, 0.8));
        b.add(rod(k, k.paint(TOY.pink), [4.4, 11.4, s * 1.2], [2.4, 16.4, s * 2.2], 0.6, 0.4));
      }
      b.add(eyes(k, 7.3, 9.4, 1.5, 0.5), k.ball(k.paint(TOY.pink), 0.6, 7.9, 8.2, 0));
      g.add(b);
      g.add(rod(k, k.paint(TOY.orange), [9, 1.4, 6], [17, 1.4, 4], 1.4, 0.2), ...[-0.6, 0, 0.6].map((dz) => rod(k, k.paint(TOY.leaf), [9, 1.4, 6], [6, 4.5, 6 + dz * 3], 0.4, 0.2)));
      return g;
    },
    animate: (root, t) => {
      const b = part(root, "bunny");
      if (!b) return;
      const p = (t % 1.4) / 1.4;
      b.position.y = p < 0.4 ? Math.sin((p / 0.4) * Math.PI) * 5 : 0;
    },
  },
  {
    id: "life-fox",
    name: "Fox",
    category: C,
    tags: ["animal", "fox", "woods", "wild", "tail"],
    notes: "A russet fox with black socks, a pointed snout and a white-tipped brush of a tail. Lurks at the woodland edge near the hen house: keep the chicken train running on time.",
    build: (k) => {
      const { g, head, tail } = quad(k, TOY.orange, 18, 7, 7, 6, 1.3, TOY.black);
      const m = k.paint(TOY.orange);
      const w = k.paint(TOY.white);
      g.add(egg(k, w, 2.6, 7, 9, 0, 1, 1, 1.1));
      head.add(k.ball(m, 3.4, 2, 2.5, 0), beak(k, m, 1.8, 5, 4, 1.6, 0), k.ball(k.paint(TOY.black), 0.7, 9, 1.6, 0));
      for (const s of [-1, 1]) {
        head.add(egg(k, w, 1.6, 3.6, 1.2, s * 2, 1.3, 0.8, 0.6));
        head.add(rod(k, m, [1.4, 4.8, s * 1.6], [1, 8.4, s * 2.2], 1.3, 0.1, 8), rod(k, k.paint(TOY.black), [1.1, 7.4, s * 2.05], [1, 8.6, s * 2.2], 0.5, 0.05, 8));
      }
      head.add(eyes(k, 4.6, 3.8, 1.4, 0.5));
      tail.add(rod(k, m, [0, 0, 0], [-7, -2, 0], 1.6, 3), k.ball(w, 3, -8.5, -2.4, 0));
      return g;
    },
    animate: (root, t) => {
      const tl = part(root, "tail");
      if (tl) tl.rotation.y = Math.sin(t * 1.3) * 0.4;
    },
  },
  {
    id: "life-deer",
    name: "Deer",
    category: C,
    tags: ["animal", "deer", "stag", "antlers", "woods", "wild"],
    notes: "A fawn-coloured stag with branching antlers and a white tail, turning his head to watch the train. A forest scene: deer by the line could be a sightseeing stop for the tourist coach.",
    build: (k) => {
      const coat = "#b07a45";
      const { g, head, tail } = quad(k, coat, 22, 9, 10, 14, 1.3, coat, TOY.black);
      const m = k.paint(coat);
      g.add(spots(k, TOY.cream, 4.55, [[-4, 20, 1], [0, 21, 0.9], [4, 20, 1], [-7, 18, 0.8]]));
      head.add(rod(k, m, [-1.5, 0, 0], [2.4, 8, 0], 2.6, 2));
      head.add(k.ball(m, 2.8, 3.5, 9.2, 0), beak(k, m, 1.8, 3.6, 5, 8.4, 0), k.ball(k.paint(TOY.black), 0.6, 8.4, 8.4, 0), eyes(k, 5.2, 10, 1.7, 0.5));
      const ant = k.wood;
      for (const s of [-1, 1]) {
        head.add(rod(k, m, [2.8, 11, s * 2], [2.2, 12.2, s * 4], 0.9, 0.3, 8));
        head.add(rod(k, ant, [3, 11.4, s * 1.2], [2.4, 16, s * 3.4], 0.5, 0.35), rod(k, ant, [2.4, 16, s * 3.4], [0.6, 19, s * 4.6], 0.35, 0.2));
        head.add(rod(k, ant, [2.6, 14.2, s * 2.6], [5, 16.4, s * 3.4], 0.3, 0.2), rod(k, ant, [2.4, 16, s * 3.4], [3.6, 19, s * 3.6], 0.3, 0.2));
      }
      tail.add(rod(k, k.paint(TOY.white), [0, 0, 0], [-1.5, 2, 0], 1, 0.5));
      return g;
    },
    animate: (root, t) => {
      const h = part(root, "head");
      if (h) h.rotation.y = Math.sin(t * 0.6) * 0.5;
    },
  },
  {
    id: "life-bear",
    name: "Bear",
    category: C,
    tags: ["animal", "bear", "woods", "wild", "honey"],
    notes: "A big round brown bear with a cream muzzle and button ears, swaying its head. Lives in the mountain forest; a honey wagon passing by might need to keep its doors shut.",
    build: (k) => {
      const coat = "#6a4128";
      const { g, head, tail } = quad(k, coat, 28, 17, 16, 7, 3.6);
      const m = k.paint(coat);
      head.add(k.ball(m, 6.4, 3.5, 2.5, 0), egg(k, k.paint("#d9b98a"), 2.8, 8.8, 1.2, 0, 1, 0.8, 1), k.ball(k.paint(TOY.black), 1, 11.4, 2, 0));
      for (const s of [-1, 1]) head.add(k.ball(m, 2, 1.8, 8, s * 4.2), k.ball(k.paint("#d9b98a"), 1.1, 2.6, 8, s * 4.2));
      head.add(eyes(k, 8.2, 4.4, 2.2, 0.65));
      tail.add(k.ball(m, 2.2, -0.5, 0, 0));
      return g;
    },
    animate: (root, t) => {
      const h = part(root, "head");
      if (h) {
        h.rotation.x = Math.sin(t * 1.1) * 0.15;
        h.rotation.y = Math.sin(t * 0.55) * 0.2;
      }
    },
  },

  // ——— Wild and small creatures ———
  {
    id: "life-owl",
    name: "Owl on a post",
    category: C,
    tags: ["animal", "owl", "bird", "night", "post", "woods"],
    notes: "A round brown owl with big yellow eyes on a fence post, its head swivelling round. Wakes at night: a night-time layout with owls, lanterns and lit signals.",
    build: (k) => {
      const g = new Group();
      g.add(k.cyl(k.wood, 3.6, 22, 0, 0, 0, 3.4, 16), k.cyl(k.cut, 3.42, 0.3, 0, 21.9, 0, 3.42, 16));
      const m = k.paint("#7a5230");
      g.add(k.capsule(m, 4.4, 4, 0, 22, 0), egg(k, k.paint(TOY.cream), 3.4, 2, 26, 0, 0.6, 1.1, 0.9));
      for (const s of [-1, 1]) g.add(egg(k, k.paint("#5a3a20"), 3.2, -0.8, 27, s * 3.6, 1.1, 1.4, 0.45));
      for (const s of [-1, 1]) g.add(k.box(k.paint(TOY.yellow), 2.2, 0.8, 1.4, 0.3, 2.6, 22, s * 1.6));
      const h = pivot("head", 0, 33, 0);
      h.add(k.ball(m, 4.2, 0, 1.5, 0), k.cylX(k.paint(TOY.cream), 3.4, 1, 3.4, 1.5, 0, 24));
      for (const s of [-1, 1]) {
        h.add(k.cylX(k.paint(TOY.yellow), 1.5, 1, 3.9, 2.2, s * 1.6, 16), k.ball(k.paint(TOY.black), 0.8, 4.3, 2.2, s * 1.6));
        h.add(rod(k, m, [0.5, 4.5, s * 2.4], [0, 7.6, s * 3.4], 1.2, 0.1, 8));
      }
      h.add(rod(k, k.paint(TOY.orange), [4.2, 1.4, 0], [4.8, -0.6, 0], 0.6, 0.05, 8));
      g.add(h);
      return g;
    },
    animate: (root, t) => {
      const h = part(root, "head");
      if (h) h.rotation.y = Math.sin(t * 0.7) * 1.3;
    },
  },
  {
    id: "life-squirrel",
    name: "Squirrel on a stump",
    category: C,
    tags: ["animal", "squirrel", "acorn", "stump", "woods", "tail"],
    notes: "A red squirrel on a tree stump, nibbling an acorn, bushy tail flicking. Squirrels stash acorns in the forest; spot all the hidden ones for a little collectable hunt.",
    build: (k) => {
      const g = new Group();
      g.add(k.cyl(k.paint(TOY.brown), 7.5, 7, 0, 0, 0, 7, 20), k.cyl(k.wood, 7, 0.4, 0, 7, 0, 7, 20), k.ring(k.cut, 4, 0.2, 0, 7.4, 0), k.ring(k.cut, 1.8, 0.2, 0, 7.4, 0));
      const m = k.paint("#b8552a");
      const s = new Group();
      s.add(egg(k, m, 3.2, 0, 4, 0, 1, 1.3, 0.9), egg(k, k.paint(TOY.cream), 2, 1.7, 4.6, 0, 0.6, 1.3, 1));
      for (const z of [-1, 1]) s.add(egg(k, m, 1.8, -0.4, 1.6, z * 2.2, 1.6, 0.9, 0.7));
      s.add(k.ball(m, 2.4, 1.6, 9.2, 0), eyes(k, 3.5, 9.8, 1, 0.42), k.ball(k.paint(TOY.black), 0.4, 4, 8.8, 0));
      for (const z of [-1, 1]) s.add(rod(k, m, [1, 10.8, z * 1.2], [0.8, 13, z * 1.6], 0.8, 0.1, 8));
      s.add(egg(k, k.paint("#8a5a2a"), 1, 3.6, 6.6, 0, 1, 1.2, 1), k.cyl(k.paint("#5a3a1a"), 1.05, 0.8, 3.6, 7.4, 0, 0.9, 12));
      const tail = pivot("tail", -2.4, 2, 0);
      const pts: [number, number, number][] = [[-1, 1, 1.8], [-3, 4, 2.4], [-3.6, 8, 2.8], [-2.6, 11.6, 2.8], [-0.6, 13.8, 2.4]];
      for (const [x, y, r] of pts) tail.add(k.ball(m, r, x, y, 0));
      s.add(tail);
      g.add(k.at(s, 0, 7.4, 0));
      return g;
    },
    animate: (root, t) => {
      const tl = part(root, "tail");
      if (tl) tl.rotation.z = (t % 2.2) < 0.3 ? Math.sin(((t % 2.2) / 0.3) * Math.PI) * 0.3 : 0;
    },
  },
  {
    id: "life-frog",
    name: "Frog on a lily pad",
    category: C,
    tags: ["animal", "frog", "pond", "lily pad", "hop", "water"],
    notes: "A green frog with bulging eyes on a lily pad with a pink flower, hopping. A pond puzzle: hop the frog pad to pad across the stream when the bridge is down.",
    build: (k) => {
      const g = new Group();
      g.add(pond(k, 18));
      g.add(k.cyl(k.paint(TOY.leaf), 8, 0.8, 0, 1.2, 0, 8, 28), k.cyl(k.paint(TOY.leaf), 4, 0.8, 10, 1.2, 8, 4, 20));
      for (let i = 0; i < 6; i++) g.add(k.ball(k.paint(TOY.pink), 1.3, 10 + Math.cos(i) * 1.6, 2.6, 8 + Math.sin(i) * 1.6, 0.6));
      g.add(k.ball(k.paint(TOY.yellow), 1, 10, 3, 8));
      const f = pivot("frog", 0, 2, 0);
      const m = k.paint("#4fa04a");
      f.add(egg(k, m, 4, 0, 2.8, 0, 1.2, 0.7, 1), egg(k, k.paint(TOY.yellow), 3, 1.5, 2, 0, 1, 0.5, 1));
      for (const s of [-1, 1]) {
        f.add(k.ball(m, 1.6, 2.4, 5.2, s * 2), k.ball(k.paint(TOY.white), 1, 3.2, 5.6, s * 2), k.ball(k.paint(TOY.black), 0.5, 4, 5.8, s * 2));
        f.add(egg(k, m, 2.2, -3, 1.4, s * 3.8, 1.6, 0.6, 0.8), k.box(m, 2.6, 0.6, 2, 0.25, -0.8, 0, s * 5));
        f.add(k.capsule(m, 0.7, 1.4, 3.5, 0, s * 2.4));
      }
      f.add(k.box(k.paint("#2d6b3f"), 0.4, 0.4, 4, 0.15, 4.6, 2.8, 0));
      g.add(f);
      return g;
    },
    animate: (root, t) => {
      const f = part(root, "frog");
      if (!f) return;
      const p = (t % 3) / 3;
      f.position.y = 2 + (p < 0.25 ? Math.sin((p / 0.25) * Math.PI) * 9 : 0);
    },
  },
  {
    id: "life-fish-jumping",
    name: "Leaping fish",
    category: C,
    tags: ["animal", "fish", "river", "pond", "jump", "water"],
    notes: "An orange fish leaping in an arc out of a felt pool, with splash rings where it goes in and out. Place under a river bridge: catch the moment it leaps as your train crosses.",
    build: (k) => {
      const g = new Group();
      g.add(pond(k, 24));
      for (const x of [-12, 12]) g.add(k.ring(k.paint(TOY.white), 3, 0.35, x, 1.3, 0), k.ring(k.paint(TOY.sky), 5, 0.3, x, 1.25, 0));
      const fish = pivot("fish", 0, 14, 0);
      const m = k.paint(TOY.orange);
      fish.add(egg(k, m, 3, 0, 0, 0, 2, 1, 0.7));
      fish.add(k.extrude(m, [[0, 0], [-5, 3.5], [-4, 0], [-5, -3.5]], 1, -5, 0, 0, 0.3));
      fish.add(k.extrude(m, [[0, 0], [3, 0], [-1, 2.6]], 0.8, -1, 2.4, 0, 0.3));
      fish.add(eyes(k, 4.2, 0.8, 1.6, 0.55));
      for (const s of [-1, 1]) fish.add(k.cylX(k.paint(TOY.cream), 1.1, 0.4, 2.6, -0.8, s * 2, 10));
      g.add(fish);
      for (let i = 0; i < 3; i++) g.add(pivot(DROPS[i], -12, 2, 0, k.ball(k.paint(TOY.sky), 0.8, 0, 0, 0)));
      return g;
    },
    animate: (root, t) => {
      const f = part(root, "fish");
      const p = (t % 3) / 3;
      const leap = Math.min(1, p / 0.45);
      if (f) {
        f.position.x = -12 + leap * 24;
        f.position.y = -2 + Math.sin(leap * Math.PI) * 18;
        f.rotation.z = Math.atan2(Math.cos(leap * Math.PI) * 18 * Math.PI, 24);
        f.visible = p < 0.45;
      }
      for (let i = 0; i < 3; i++) {
        const d = part(root, DROPS[i]);
        if (!d) continue;
        const s = Math.min(1, p / 0.25);
        d.visible = p < 0.25;
        d.position.set(-12 + (i - 1) * s * 4, 2 + Math.sin(s * Math.PI) * 5, (i - 1) * s * 2);
      }
    },
  },
  {
    id: "life-elephant",
    name: "Circus elephant on a drum",
    category: C,
    tags: ["animal", "elephant", "circus", "trunk", "show"],
    notes: "A grey circus elephant in a red-and-gold blanket and a little fez, standing on a starry drum, swinging its trunk. Arrives on the circus train: unload it at the big-top siding for a show.",
    build: (k) => {
      const g = new Group();
      g.add(k.cyl(k.paint(TOY.red), 20, 10, 0, 0, 0, 20, 36), k.cyl(k.paint(TOY.yellow), 20.4, 1.4, 0, 0, 0, 20.4, 36), k.cyl(k.paint(TOY.yellow), 20.4, 1.4, 0, 8.6, 0, 20.4, 36));
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        g.add(k.ball(k.paint(TOY.white), 1.4, Math.cos(a) * 20.1, 5, Math.sin(a) * 20.1));
      }
      const grey = "#9a9ea6";
      const { g: e, head, tail } = quad(k, grey, 34, 18, 18, 12, 3.8);
      e.add(k.box(k.paint(TOY.red), 14, 2, 19, 0.8, 0, 28.5, 0), k.box(k.paint(GOLD), 14.4, 1, 19.4, 0.4, 0, 28, 0), k.box(k.paint(TOY.red), 12, 7, 19.2, 1, 0, 22, 0));
      const m = k.paint(grey);
      head.add(k.ball(m, 8, 4, 2, 0), eyes(k, 10.4, 5, 3.6, 0.8));
      for (const s of [-1, 1]) {
        head.add(egg(k, m, 7, 1, 2, s * 8, 0.25, 1.1, 1), rod(k, k.paint(TOY.cream), [10, -1.5, s * 3], [15, -5, s * 3.5], 1.1, 0.4, 10));
      }
      head.add(k.cone(k.paint(TOY.red), 2.6, 4, 3, 9.4, 0, 16), rod(k, k.paint(GOLD), [3, 13.2, 0], [0, 11, 0], 0.3), k.ball(k.paint(GOLD), 0.8, 0, 11, 0));
      const trunk = pivot("trunk", 10.5, 0, 0, rod(k, m, [0, 0, 0], [2, -8, 0], 3, 2.2), rod(k, m, [2, -8, 0], [3, -14, 0], 2.2, 1.6), rod(k, m, [3, -14, 0], [5.5, -16, 0], 1.6, 1.3));
      head.add(trunk);
      tail.add(rod(k, m, [0, 0, 0], [-1.5, -10, 0], 0.7), k.ball(k.paint(TOY.black), 1, -1.5, -10.5, 0, 1.5));
      g.add(k.at(e, 0, 10, 0));
      return g;
    },
    animate: (root, t) => {
      const tr = part(root, "trunk");
      if (tr) {
        tr.rotation.z = 0.3 + Math.sin(t * 1.4) * 0.35;
        tr.rotation.x = Math.sin(t * 0.9) * 0.2;
      }
    },
  },
  {
    id: "life-giraffe",
    name: "Giraffe",
    category: C,
    tags: ["animal", "giraffe", "zoo", "safari", "tall"],
    notes: "A tall yellow giraffe with brown patches, ossicones and a swaying neck. Too tall for tunnels: a giraffe wagon needs a route with no low bridges to reach the zoo.",
    build: (k) => {
      const { g, head, tail } = quad(k, TOY.yellow, 24, 11, 12, 28, 1.8, TOY.yellow, TOY.brown);
      head.name = "neck";
      const m = k.paint(TOY.yellow);
      const br = k.paint(TOY.brown);
      g.add(spots(k, TOY.brown, 5.55, [[-6, 34, 2.2], [0, 36, 2], [6, 33, 1.8], [-1, 31, 1.6], [-9, 37, 1.4]]));
      head.add(rod(k, m, [-1, 0, 0], [7, 28, 0], 3.4, 2.4));
      for (const [x, y] of [[0.5, 6], [2.5, 13], [4.4, 20]]) head.add(k.cylZ(br, 1.3, 6, x, y, 0, 12));
      head.add(rod(k, br, [-3.2, 3, 0], [4.6, 29, 0], 0.9));
      const face = k.box(m, 10, 4.6, 4.6, 2, 0, 0, 0);
      face.position.set(10, 27.8, 0);
      face.rotation.z = -0.25;
      head.add(face, eyes(k, 9, 30.2, 2.3, 0.55));
      for (const s of [-1, 1]) {
        head.add(rod(k, m, [7.5, 30.5, s * 1.2], [7, 34, s * 1.6], 0.6), k.ball(br, 0.9, 7, 34.2, s * 1.6));
        head.add(rod(k, m, [6, 30, s * 2], [4.6, 31, s * 4.2], 0.9, 0.3, 8));
      }
      tail.add(rod(k, m, [0, 0, 0], [-2, -10, 0], 0.6), k.ball(br, 1, -2, -10.5, 0, 1.5));
      return g;
    },
    animate: (root, t) => {
      const n = part(root, "neck");
      const tl = part(root, "tail");
      if (n) n.rotation.z = Math.sin(t * 0.8) * 0.08;
      if (tl) tl.rotation.x = Math.sin(t * 2) * 0.3;
    },
  },
  {
    id: "life-penguins",
    name: "Penguins on an ice floe",
    category: C,
    tags: ["animal", "penguin", "ice", "zoo", "cold", "waddle"],
    notes: "Two waddling penguins and a fish on a little ice floe. A cold-store wagon of fish keeps the zoo penguins happy; they could ride a polar express on a snowy layout.",
    build: (k) => {
      const g = new Group();
      g.add(k.feltDisc(24, k.water));
      g.add(k.lathe(k.paint(TOY.white), [[0.01, 0], [16, 0], [15, 3], [0.01, 3.4]], 0, 0.6, 0, 9));
      for (const [i, x, z, s] of [[0, 3, -4, 1], [1, -5, 5, 0.8]] as const) {
        const p = pivot(PENGUINS[i], x, 3.6, z);
        const b = k.paint(TOY.black);
        p.add(k.capsule(b, 4.5, 6), egg(k, k.paint(TOY.white), 3.6, 2, 6.6, 0, 0.6, 1.4, 0.95));
        p.add(beak(k, k.paint(TOY.orange), 0.9, 3, 4, 12, 0), eyes(k, 3.6, 13.2, 1.6, 0.5, TOY.white));
        for (const side of [-1, 1]) {
          const fl = egg(k, b, 2.8, 0, 8, side * 4.4, 0.6, 1.6, 0.35);
          fl.rotation.x = side * 0.25;
          p.add(fl, k.box(k.paint(TOY.orange), 3, 0.8, 1.8, 0.3, 2.4, 0, side * 1.8));
        }
        p.scale.setScalar(s);
        g.add(p);
      }
      g.add(k.at(egg(k, k.paint(TOY.sky), 1.5, 9, 4.6, 6, 2, 0.6, 0.6), 0, 0, 0, 0.4));
      return g;
    },
    animate: (root, t) => {
      for (let i = 0; i < 2; i++) {
        const p = part(root, PENGUINS[i]);
        if (p) p.rotation.x = Math.sin(t * 5 + i * 2) * 0.15;
      }
    },
  },
  {
    id: "life-seagulls",
    name: "Seagulls on mooring posts",
    category: C,
    tags: ["animal", "seagull", "bird", "harbour", "seaside", "posts", "flying"],
    notes: "Gulls bobbing on three weathered mooring posts while another wheels overhead. Harbour dressing: gulls gather when the fish train arrives and scatter when it whistles.",
    build: (k) => {
      const g = new Group();
      g.add(pond(k, 30));
      const gull = (name: string, flying: boolean): Group => {
        const b = pivot(name, 0, 0, 0);
        const w = k.paint(TOY.white);
        b.add(egg(k, w, 3, 0, 3.5, 0, 1.4, 0.8, 0.85), k.ball(w, 2, 3.4, 5.6, 0));
        b.add(beak(k, k.paint(TOY.yellow), 0.6, 2.6, 5, 5.2, 0), k.ball(k.paint(TOY.red), 0.3, 6.2, 5, 0), eyes(k, 4.4, 6.2, 1.3, 0.35));
        b.add(rod(k, k.paint(TOY.black), [-3, 3.9, 0], [-6, 4.4, 0], 1.2, 0.3));
        for (const s of [-1, 1]) {
          const wing = pivot(flying ? (s > 0 ? "flap-r" : "flap-l") : "", -0.5, 4.6, s * 1.8);
          const wm = egg(k, k.paint(TOY.grey), 3, flying ? 0 : -1.5, 0, flying ? s * 5 : 0, flying ? 0.9 : 1.6, 0.25, flying ? 1.8 : 0.5);
          wing.add(wm, k.ball(k.paint(TOY.black), 0.9, flying ? -0.5 : -5, 0, flying ? s * 9.5 : 0, 0.4));
          b.add(wing);
        }
        if (!flying) for (const s of [-1, 1]) b.add(rod(k, k.paint(TOY.orange), [0, 0, s * 0.9], [0, 1.6, s * 0.9], 0.35));
        return b;
      };
      const posts: [number, number, number][] = [[-14, -6, 14], [0, 8, 18], [14, -4, 12]];
      posts.forEach(([x, z, h], i) => {
        g.add(k.cyl(k.paint("#8a6a4a"), 3.4, h, x, 0, z, 3.2, 16), k.ring(k.paint(TOY.black), 3.4, 0.4, x, h * 0.6, z), dome(k, k.paint("#8a6a4a"), 3.2, 1.6, x, h, z));
        g.add(k.at(pivot(`perch-${i}`, x, h + 1.4, z, gull("", false)), 0, 0, 0, i * 1.1 - 1));
      });
      g.add(pivot("flyer", 0, 40, 0, gull("glider", true)));
      return g;
    },
    animate: (root, t) => {
      for (let i = 0; i < 3; i++) {
        const p = part(root, PERCHES[i]);
        if (p) p.rotation.z = Math.max(0, Math.sin(t * 2 + i * 1.7)) * -0.25;
      }
      const f = part(root, "flyer");
      if (f) {
        const a = t * 0.7;
        f.position.set(Math.cos(a) * 22, 40 + Math.sin(t * 1.3) * 3, Math.sin(a) * 22);
        f.rotation.y = -a - Math.PI / 2;
      }
      const flap = Math.sin(t * 5) * 0.5;
      const r = part(root, "flap-r");
      const l = part(root, "flap-l");
      if (r) r.rotation.x = -flap;
      if (l) l.rotation.x = flap;
    },
  },
  {
    id: "life-butterfly",
    name: "Butterfly and flower",
    category: C,
    tags: ["animal", "butterfly", "insect", "flower", "garden", "flutter"],
    notes: "A blue-and-yellow butterfly fluttering round a tall pink flower on a patch of grass. Garden dressing for a cottage halt: the more flowers you plant, the more butterflies appear.",
    build: (k) => {
      const g = new Group();
      g.add(k.feltDisc(12));
      g.add(rod(k, k.paint(TOY.leaf), [0, 0, 0], [1, 20, 0], 0.6, 0.5));
      for (const s of [-1, 1]) g.add(egg(k, k.paint(TOY.leaf), 2.4, s * 2, 7 + s, s * 0.5, 1.4, 0.3, 0.8));
      g.add(k.ball(k.paint(TOY.yellow), 1.8, 1, 21, 0, 0.8));
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        g.add(egg(k, k.paint(TOY.pink), 1.9, 1 + Math.cos(a) * 3, 21, Math.sin(a) * 3, 1, 0.45, 1));
      }
      const fly = pivot("fly", 8, 24, 0);
      fly.add(rod(k, k.paint(TOY.black), [-2.2, 0, 0], [2.2, 0, 0], 0.5, 0.4));
      for (const s of [-1, 1]) {
        fly.add(rod(k, k.paint(TOY.black), [2, 0.2, s * 0.3], [3.6, 2.2, s * 1.2], 0.12, 0.12, 6), k.ball(k.paint(TOY.black), 0.3, 3.6, 2.2, s * 1.2));
        const wing = pivot(s > 0 ? "wing-r" : "wing-l", 0, 0, s * 0.3);
        wing.add(egg(k, k.paint(TOY.blue), 2.2, 0.6, 0, s * 2.4, 1, 0.15, 1.1), egg(k, k.paint(TOY.yellow), 1.4, -1.4, 0, s * 1.8, 1, 0.12, 1));
        wing.add(k.ball(k.paint(TOY.white), 0.5, 0.8, 0.3, s * 2.8, 0.3));
        fly.add(wing);
      }
      g.add(fly);
      return g;
    },
    animate: (root, t) => {
      const f = part(root, "fly");
      if (f) {
        f.position.set(Math.cos(t * 0.9) * 8, 24 + Math.sin(t * 2.1) * 3, Math.sin(t * 0.9) * 8);
        f.rotation.y = -t * 0.9 - Math.PI / 2;
      }
      const flap = Math.sin(t * 16) * 0.8;
      const r = part(root, "wing-r");
      const l = part(root, "wing-l");
      if (r) r.rotation.x = -flap;
      if (l) l.rotation.x = flap;
    },
  },
  {
    id: "life-dinosaur",
    name: "Toy dinosaur",
    category: C,
    tags: ["animal", "dinosaur", "toy", "prehistoric", "park", "nod"],
    notes: "A chunky green long-neck dinosaur with orange back plates and a yellow belly, nodding. A dinosaur park on the layout: a fossil wagon from the quarry fills the museum.",
    build: (k) => {
      const g = new Group();
      const m = k.paint(TOY.leaf);
      g.add(egg(k, m, 10, 0, 17, 0, 1.5, 0.75, 0.9), egg(k, k.paint(TOY.yellow), 8, 1, 14.5, 0, 1.4, 0.55, 0.85));
      for (const x of [-8, 8]) for (const z of [-5, 5]) g.add(k.cyl(m, 3.6, 13, x, 0, z, 3.2, 16), k.cyl(k.paint(TOY.cream), 3.8, 1, x, 0, z, 3.7, 16));
      g.add(rod(k, m, [-12, 18, 0], [-34, 22, 0], 5, 0.8));
      const plates = [-24, -16, -8, 0, 8];
      plates.forEach((x, i) => {
        const y = x < -12 ? 20.5 + (x + 24) * 0.12 : 24.5 - Math.abs(x) * 0.04;
        const size = 2.2 + (i === 0 ? 0 : 0.6) + (i > 1 ? 0.4 : 0);
        g.add(k.cone(k.paint(TOY.orange), size, size * 1.4, x, y - 1, 0, 4));
      });
      const neck = pivot("neck", 12, 21, 0);
      neck.add(rod(k, m, [-2, -2, 0], [8, 16, 0], 4, 3));
      neck.add(egg(k, m, 4.6, 10, 18, 0, 1.4, 0.85, 0.95), eyes(k, 12, 20.2, 2.4, 0.8));
      neck.add(k.ball(k.paint(TOY.black), 0.4, 15.8, 17.6, -1.2), k.ball(k.paint(TOY.black), 0.4, 15.8, 17.6, 1.2));
      g.add(neck);
      return g;
    },
    animate: (root, t) => {
      const n = part(root, "neck");
      if (n) n.rotation.z = Math.sin(t * 1.2) * 0.12 - 0.05;
    },
  },
];


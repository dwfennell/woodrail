import { Group, type Material, type Mesh, type Object3D } from "three";
import { type Kit, TOY } from "../kit";
import type { Asset } from "../types";

/**
 * Road, farm, works, water and air vehicles at toy scale: chunky lacquered bodies on round black wheels with red hubs,
 * about 40–90 mm long (ships and airships a bit more). They face +x and stand on y = 0; boats sit on a blue felt disc.
 */

type Pt = [number, number];

// ——— Parts, and finding them again for animation ———

/** A named pivot group at (x, y, z) holding `parts`. */
function pivot(name: string, x: number, y: number, z: number, ...parts: Object3D[]): Group {
  const g = new Group();
  g.name = name;
  g.position.set(x, y, z);
  for (const p of parts) g.add(p);
  return g;
}

/** Every descendant called `name`, found once and cached on the root (animate runs every frame). */
function parts(root: Object3D, name: string): Object3D[] {
  let cache = root.userData.vehParts as Map<string, Object3D[]> | undefined;
  if (!cache) {
    cache = new Map();
    root.userData.vehParts = cache;
  }
  let list = cache.get(name);
  if (!list) {
    const found: Object3D[] = [];
    root.traverse((o) => {
      if (o.name === name) found.push(o);
    });
    list = found;
    cache.set(name, list);
  }
  return list;
}

function part(root: Object3D, name: string): Object3D | undefined {
  return parts(root, name)[0];
}

/** Turn every part called "wheel" as if rolling forward at `speed` mm/s (each wheel keeps its radius in userData.r). */
function rollWheels(root: Object3D, t: number, speed = 30): void {
  for (const w of parts(root, "wheel")) w.rotation.z = (-t * speed) / ((w.userData.r as number) || 6.5);
}

/** Lamps called `name` flash in turn. */
function blink(root: Object3D, name: string, t: number, hz = 2): void {
  const list = parts(root, name);
  for (let i = 0; i < list.length; i++) list[i].visible = (Math.floor(t * hz) + i) % 2 === 0;
}

/** A boat (the part called "boat") rocks gently on its felt water. */
function bob(root: Object3D, t: number, amount = 1): void {
  const b = part(root, "boat");
  if (!b) return;
  b.position.y = Math.sin(t * 1.6) * 0.6 * amount;
  b.rotation.x = Math.sin(t * 1.1) * 0.04 * amount;
  b.rotation.z = Math.sin(t * 1.3) * 0.025 * amount;
}

/** A chunky road wheel: black tyre, red hub, a wooden bar across so you can see it turn. Axle along z. */
function roadWheel(k: Kit, x: number, z: number, r = 6.5, hub: string = TOY.red, w = 5, y = r): Group {
  const g = pivot("wheel", x, y, z);
  g.userData.r = r;
  g.add(k.cylZ(k.paint(TOY.black), r, w, 0, 0, 0, 20));
  g.add(k.cylZ(k.paint(hub), r * 0.52, w + 0.6, 0, 0, 0, 14));
  g.add(k.box(k.wood, r * 0.9, r * 0.22, w + 0.9, 0, 0, -r * 0.11, 0));
  return g;
}

/** Wheels at each x, both sides `halfW` out from the centre line. */
function wheelSet(k: Kit, xs: number[], halfW: number, r = 6.5, hub: string = TOY.red, w = 5): Group {
  const g = new Group();
  for (const x of xs) for (const s of [-1, 1]) g.add(roadWheel(k, x, s * halfW, r, hub, w));
  return g;
}

/** A band of glass through a body: sticks out a little on every side so it reads as windows all round. */
function glass(k: Kit, len: number, h: number, w: number, x: number, y: number, z = 0): Mesh {
  return k.box(k.glass, len, h, w, 0.8, x, y, z);
}

/** A pair of lamps at the front (or back) of a body. */
function lamps(k: Kit, x: number, y: number, halfW: number, color: string = TOY.cream, r = 2.2): Group {
  return k.group(k.ball(k.paint(color), r, x, y, -halfW), k.ball(k.paint(color), r, x, y, halfW));
}

/** A roof beacon: grey base, dim dome, and a bright dome called `name` that blink() flashes. */
function beacon(k: Kit, color: string, x: number, y: number, z: number, name = "flash"): Group {
  const bright = k.ball(k.paint(color), 2.6, 0, 2.6, 0);
  bright.name = name;
  return k.at(k.group(k.cyl(k.paint(TOY.grey), 2.6, 1.6, 0, 0, 0, 2.6, 14), k.ball(k.paint(TOY.grey), 2.3, 0, 2.4, 0), bright), x, y, z);
}

/** A rod from (x1, y1) to (x2, y2) in the x/y plane at depth z. */
function rod(k: Kit, mat: Material, x1: number, y1: number, x2: number, y2: number, r = 1, z = 0): Mesh {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const m = k.cyl(mat, r, Math.hypot(dx, dy), 0, 0, 0, r, 10);
  m.position.set((x1 + x2) / 2, (y1 + y2) / 2, z);
  m.rotation.z = Math.atan2(-dx, dy);
  return m;
}

/** A plan outline (x, and z drawn as −y on paper) cut `h` thick, its base on y. Hulls, wings, decks. */
function plan(k: Kit, mat: Material, outline: Pt[], h: number, y = 0, x = 0, z = 0, bevel = 0.8): Mesh {
  const m = k.extrude(mat, outline, h, 0, 0, 0, bevel);
  m.rotation.x = -Math.PI / 2;
  m.position.set(x, y + h / 2, z);
  return m;
}

/** A turned shape lying along x: the profile's height runs along +x from `x`. Fuselages, tanks, drums. */
function latheX(k: Kit, mat: Material, profile: Pt[], x = 0, y = 0, z = 0, segments = 24): Mesh {
  const m = k.lathe(mat, profile, 0, 0, 0, segments);
  m.rotation.z = -Math.PI / 2;
  m.position.set(x, y, z);
  return m;
}

/** A pointed boat hull, `len` long, `w` wide, `h` deep: a red bottom band, a painted top band and a beech deck. */
function hull(k: Kit, color: string, len: number, w: number, h: number, bottom: string = TOY.red, y = 0.4): Group {
  const L = len / 2;
  const W = w / 2;
  const outline = (s: number): Pt[] => [
    [-L * s, -W * s],
    [L * 0.4 * s, -W * s],
    [L * s, 0],
    [L * 0.4 * s, W * s],
    [-L * s, W * s],
  ];
  return k.group(
    plan(k, k.paint(bottom), outline(0.96), h * 0.4, y, 0, 0, 1.5),
    plan(k, k.paint(color), outline(1), h * 0.6, y + h * 0.4, 0, 0, 1.5),
    plan(k, k.wood, outline(0.88), 1, y + h, 0, 0, 0.4),
  );
}

/** Blue felt water for a boat to sit on. */
function water(k: Kit, r: number): Mesh {
  return k.feltDisc(r, k.water);
}

/** A two-bladed propeller called "prop" turning about x, at the nose. */
function propeller(k: Kit, x: number, y: number, z = 0, r = 10): Group {
  return pivot(
    "prop",
    x,
    y,
    z,
    k.cylX(k.paint(TOY.red), 2.6, 4, 0, 0, 0, 14),
    k.box(k.wood, 1.4, r * 2, 3.2, 0.6, 0.8, -r, 0),
  );
}

/** A truck cab at x (its front at x + 9), `h` tall, sat on the chassis. */
function cab(k: Kit, color: string, x: number, h = 22): Group {
  const c = k.paint(color);
  return k.group(
    k.box(c, 18, h, 28, 4, x, 6),
    glass(k, 14, 7, 28.8, x + 1.5, 6 + h - 11),
    k.box(k.glass, 1.2, 8, 22, 0.5, x + 9, 6 + h - 12),
    lamps(k, x + 9.2, 11, 9),
    k.box(k.paint(TOY.black), 3, 3.5, 28, 1, x + 9.5, 4),
  );
}

/** A beech chassis rail under a truck. */
function chassis(k: Kit, len: number, cx = 0): Mesh {
  return k.box(k.wood, len, 5, 22, 1, cx, 7);
}

/** A saloon car: low body, cabin with glass all round, bumpers, four wheels. About 60 long. */
function saloon(k: Kit, color: string, roof: string = color): Group {
  const c = k.paint(color);
  return k.group(
    k.box(c, 58, 11, 26, 4, 0, 5),
    k.box(k.paint(roof), 30, 10, 23, 4, -4, 14),
    glass(k, 31, 6, 24, -4, 16.5),
    lamps(k, 29, 11, 8),
    lamps(k, -29, 11, 8, TOY.red, 1.8),
    k.box(k.paint(TOY.black), 3, 3, 26, 1, 29.5, 4.5),
    k.box(k.paint(TOY.black), 3, 3, 26, 1, -29.5, 4.5),
    wheelSet(k, [-18, 18], 12.5),
  );
}

/** A slope-fronted van body (about 66 long, 32 tall) with windscreen and cab windows. */
function van(k: Kit, color: string): Group {
  const outline: Pt[] = [
    [-32, 0],
    [32, 0],
    [32, 12],
    [24, 26],
    [-32, 26],
  ];
  const ws = k.box(k.glass, 1.2, 13, 22, 0.5);
  ws.position.set(29.1, 25.6, 0);
  ws.rotation.z = 0.52;
  return k.group(
    k.extrude(k.paint(color), outline, 26, 0, 6, 0, 1.5),
    ws,
    glass(k, 9, 7, 27.6, 19, 20),
    lamps(k, 33, 12, 9),
    lamps(k, -33, 12, 9, TOY.red, 1.8),
    k.box(k.paint(TOY.black), 3, 3.5, 27, 1, 33.5, 4.5),
    k.box(k.paint(TOY.black), 3, 3.5, 27, 1, -33.5, 4.5),
    wheelSet(k, [-20, 20], 12.5),
  );
}

/** A bus body: one or two decks of windows, white roof, wheels. */
function bus(k: Kit, color: string, len = 88, decks = 1): Group {
  const c = k.paint(color);
  const h = decks === 1 ? 26 : 44;
  const g = k.group(
    k.box(c, len, h, 26, 4, 0, 5),
    glass(k, len - 14, 8, 26.6, -4, 17),
    k.box(k.glass, 1.2, 12, 22, 0.5, len / 2, 14),
    k.box(k.paint(TOY.white), len - 4, 2.5, 24, 1, 0, 5 + h),
    k.box(k.paint(TOY.black), 1, 4, 16, 0.3, len / 2 + 0.2, 5 + h - 6),
    k.box(k.glass, 9, 16, 0.8, 0.3, len / 2 - 14, 7, 13.2),
    lamps(k, len / 2 + 0.3, 10, 9),
    lamps(k, -len / 2 - 0.3, 10, 9, TOY.red, 1.8),
    k.box(k.paint(TOY.black), 3, 3.5, 26, 1, len / 2 + 0.5, 4),
    wheelSet(k, [-(len / 2 - 16), len / 2 - 16], 12.5, 7),
  );
  if (decks > 1) {
    g.add(glass(k, len - 6, 8, 26.6, 0, 35));
    g.add(k.box(k.paint(TOY.cream), len + 0.4, 2.5, 26.4, 1, 0, 29));
  }
  return g;
}

// ——— The catalogue ———

export const ASSETS: Asset[] = [
  // ——— Cars and vans ———
  {
    id: "veh-family-car",
    name: "Family car",
    category: "Vehicles",
    tags: ["car", "road", "town"],
    notes: "A chunky red saloon on four round wheels. Cars could queue at a level crossing and honk if the barrier stays down too long.",
    build: (k) => saloon(k, TOY.red),
    animate: (root, t) => rollWheels(root, t),
  },
  {
    id: "veh-taxi",
    name: "Taxi",
    category: "Vehicles",
    tags: ["car", "taxi", "road", "town"],
    notes: "A yellow cab with a roof sign and a chequered stripe. Taxis could wait at the station rank and carry passengers who missed their train.",
    build: (k) => {
      const g = saloon(k, TOY.yellow);
      g.add(k.box(k.paint(TOY.cream), 12, 5, 14, 1.5, -4, 24));
      g.add(k.box(k.paint(TOY.black), 12.4, 1.5, 14.4, 0.5, -4, 26));
      for (let i = 0; i < 7; i++) g.add(k.box(k.paint(TOY.black), 4, 2.4, 26.4, 0, -24 + i * 8, 10));
      return g;
    },
    animate: (root, t) => rollWheels(root, t),
  },
  {
    id: "veh-police-car",
    name: "Police car",
    category: "Vehicles",
    tags: ["car", "police", "emergency", "light", "road"],
    notes: "A white car with a blue stripe and a blinking light bar. It could chase a runaway wagon down the line, lights flashing.",
    build: (k) => {
      const g = saloon(k, TOY.white);
      g.add(k.box(k.paint(TOY.blue), 59, 3, 26.6, 1, 0, 9));
      g.add(k.box(k.paint(TOY.black), 16, 2, 10, 0.8, -4, 24));
      g.add(beacon(k, TOY.blue, -4, 25.5, -3));
      g.add(beacon(k, TOY.red, -4, 25.5, 3));
      return g;
    },
    animate: (root, t) => {
      rollWheels(root, t, 45);
      blink(root, "flash", t, 4);
    },
  },
  {
    id: "veh-ambulance",
    name: "Ambulance",
    category: "Vehicles",
    tags: ["van", "ambulance", "emergency", "hospital", "light"],
    notes: "A white van with a red band and two blue beacons. A hospital could call it to the station when a peg passenger feels poorly.",
    build: (k) => {
      const g = van(k, TOY.white);
      g.add(k.box(k.paint(TOY.red), 66, 4, 27.4, 1, -1, 13));
      g.add(k.box(k.paint(TOY.red), 2.5, 10, 27.6, 0, -14, 20));
      g.add(k.box(k.paint(TOY.red), 10, 2.5, 27.6, 0, -14, 23.75));
      g.add(beacon(k, TOY.blue, 18, 32.5, -7));
      g.add(beacon(k, TOY.blue, 18, 32.5, 7));
      return g;
    },
    animate: (root, t) => {
      rollWheels(root, t, 45);
      blink(root, "flash", t, 3);
    },
  },
  {
    id: "veh-delivery-van",
    name: "Delivery van",
    category: "Vehicles",
    tags: ["van", "delivery", "parcel", "doors", "town"],
    notes: "An orange van whose back doors swing open on a parcel. It could fetch parcels from a goods wagon and drop them at houses round town.",
    build: (k) => {
      const g = van(k, TOY.orange);
      const o = k.paint(TOY.orange);
      g.add(k.box(k.cut, 0.6, 22, 24, 0, -33.4, 8));
      g.add(k.box(k.paint("#c9a36b"), 12, 10, 12, 1, -24, 6));
      g.add(pivot("doorL", -33.8, 0, -12.5, k.box(o, 1.6, 22, 12.4, 0.6, 0, 8, 6.2)));
      g.add(pivot("doorR", -33.8, 0, 12.5, k.box(o, 1.6, 22, 12.4, 0.6, 0, 8, -6.2)));
      return g;
    },
    animate: (root, t) => {
      const a = Math.max(0, Math.sin(t * 0.8)) * 1.6;
      const l = part(root, "doorL");
      const r = part(root, "doorR");
      if (l) l.rotation.y = a;
      if (r) r.rotation.y = -a;
    },
  },
  {
    id: "veh-post-van",
    name: "Post van",
    category: "Vehicles",
    tags: ["van", "post", "mail", "letters", "town"],
    notes: "A red van with a yellow stripe and a letter on its side. It could meet the mail coach at the station and empty the post box by the platform.",
    build: (k) => {
      const g = van(k, TOY.red);
      g.add(k.box(k.paint(TOY.yellow), 66, 3, 27.4, 1, -1, 10));
      g.add(k.box(k.paint(TOY.cream), 14, 9, 27.6, 1, -12, 18));
      g.add(rod(k, k.paint(TOY.red), -19, 27, -12, 22.5, 0.7, 13.9));
      g.add(rod(k, k.paint(TOY.red), -12, 22.5, -5, 27, 0.7, 13.9));
      g.add(rod(k, k.paint(TOY.red), -19, 27, -12, 22.5, 0.7, -13.9));
      g.add(rod(k, k.paint(TOY.red), -12, 22.5, -5, 27, 0.7, -13.9));
      return g;
    },
    animate: (root, t) => rollWheels(root, t),
  },
  {
    id: "veh-ice-cream-van",
    name: "Ice-cream van",
    category: "Vehicles",
    tags: ["van", "ice cream", "seaside", "park", "hatch"],
    notes: "A pink and cream van with a giant cone on the roof and a serving hatch that props open. Parked by the beach station, it could draw a crowd of peg people.",
    build: (k) => {
      const g = van(k, TOY.pink);
      g.add(k.box(k.paint(TOY.cream), 66, 6, 27.4, 1, -1, 8));
      g.add(k.box(k.cut, 22, 10, 0.6, 0, -12, 17, 13.6));
      g.add(pivot("hatch", -12, 27, 13.9, k.box(k.paint(TOY.cream), 22, 10, 1.2, 0.5, 0, -10, 0)));
      const cone = k.cone(k.paint("#d9a35b"), 4.5, 13, 0, 0, 0);
      cone.rotation.x = Math.PI;
      cone.position.set(-14, 39, 0);
      g.add(cone);
      g.add(k.ball(k.paint(TOY.cream), 5, -14, 46, 0));
      g.add(k.ball(k.paint(TOY.pink), 4, -14, 51, 0));
      g.add(k.ball(k.paint(TOY.red), 1.5, -14, 55.5, 0));
      g.add(k.cyl(k.wood, 1.5, 7, -14, 32, 0, 1.5, 10));
      return g;
    },
    animate: (root, t) => {
      const h = part(root, "hatch");
      if (h) h.rotation.x = -Math.max(0, Math.sin(t * 0.7)) * 1.3;
    },
  },
  {
    id: "veh-camper-van",
    name: "Camper van",
    category: "Vehicles",
    tags: ["van", "camper", "holiday", "roof"],
    notes: "A two-tone camper whose roof pops up. It could park by a campsite near the lake and set off along the road when the holiday train arrives.",
    build: (k) => {
      const g = van(k, TOY.teal);
      g.add(k.box(k.paint(TOY.cream), 66, 8, 27.4, 1, -1, 22));
      g.add(glass(k, 20, 6, 27.6, -10, 22));
      g.add(k.box(k.paint(TOY.orange), 30, 6, 0.2, 0, -10, 13, 0));
      g.add(pivot("roof", -24, 31.5, 0, k.box(k.paint(TOY.cream), 44, 3, 24, 1.2, 22, 0, 0)));
      return g;
    },
    animate: (root, t) => {
      const r = part(root, "roof");
      if (r) r.rotation.z = -Math.max(0, Math.sin(t * 0.6)) * 0.35;
    },
  },

  // ——— Buses ———
  {
    id: "veh-town-bus",
    name: "Town bus",
    category: "Vehicles",
    tags: ["bus", "road", "town", "passengers"],
    notes: "A long green single-decker with a destination board. A bus stop beside the station could swap passengers between road and rail.",
    build: (k) => bus(k, TOY.green),
    animate: (root, t) => rollWheels(root, t),
  },
  {
    id: "veh-double-decker",
    name: "Double-decker bus",
    category: "Vehicles",
    tags: ["bus", "double decker", "town", "passengers"],
    notes: "A tall red bus with two decks of windows and a cream band between them. It needs a tall bridge: a low one could stop it and force a detour.",
    build: (k) => bus(k, TOY.red, 84, 2),
    animate: (root, t) => rollWheels(root, t),
  },
  {
    id: "veh-school-bus",
    name: "School bus",
    category: "Vehicles",
    tags: ["bus", "school", "children", "road"],
    notes: "A yellow bus with a long bonnet and black stripes. It could fetch peg children from the station each morning to the school.",
    build: (k) => {
      const y = k.paint(TOY.yellow);
      const g = k.group(
        k.box(y, 70, 26, 26, 4, -8, 5),
        glass(k, 58, 8, 26.6, -10, 17),
        k.box(k.glass, 1.2, 10, 22, 0.5, 27, 18),
        k.box(y, 18, 14, 22, 4, 34, 5),
        k.box(k.paint(TOY.grey), 1, 8, 14, 0.5, 43.2, 8),
        lamps(k, 43.2, 15, 7.5),
        k.box(k.paint(TOY.black), 3, 3.5, 26, 1, 44, 4),
        k.box(k.paint(TOY.black), 70.4, 1.4, 26.4, 0.3, -8, 14),
        k.box(k.paint(TOY.black), 70.4, 1.4, 26.4, 0.3, -8, 26),
        k.box(k.paint(TOY.white), 66, 2.5, 24, 1, -8, 31),
        lamps(k, -43.3, 10, 9, TOY.red, 1.8),
        lamps(k, 26, 30, 8, TOY.orange, 1.6),
        wheelSet(k, [-28, 32], 12.5, 7),
      );
      const sign = k.box(k.paint(TOY.red), 1, 6, 6, 1, 0, 0, 0);
      sign.position.set(10, 16, -13.8);
      sign.name = "stop";
      g.add(sign);
      return g;
    },
    animate: (root, t) => {
      rollWheels(root, t);
      blink(root, "stop", t, 1);
    },
  },
  {
    id: "veh-trolleybus",
    name: "Trolleybus",
    category: "Vehicles",
    tags: ["bus", "tram", "trolley", "electric", "poles"],
    notes: "A blue tram-bus with two poles reaching up to an overhead wire. Wires strung along a street could let it run a route without rails.",
    build: (k) => {
      const g = bus(k, TOY.blue, 86);
      g.add(k.box(k.paint(TOY.grey), 16, 3, 14, 1, -16, 33.5));
      for (const z of [-4, 4]) {
        g.add(rod(k, k.paint(TOY.black), -10, 36, -48, 60, 0.8, z));
        g.add(k.cylZ(k.metal, 1.8, 2, -48, 60, z, 12));
      }
      return g;
    },
    animate: (root, t) => rollWheels(root, t),
  },

  // ——— Emergency and works ———
  {
    id: "veh-fire-engine",
    name: "Fire engine",
    category: "Vehicles",
    tags: ["fire", "engine", "ladder", "emergency", "rescue"],
    notes: "A red fire engine whose ladder turns and lifts on a turntable, with a blinking beacon. A burning barn by the line could need it delivered on a flat wagon.",
    build: (k) => {
      const r = k.paint(TOY.red);
      const ladder = new Group();
      ladder.name = "ladder";
      for (const z of [-4, 4]) ladder.add(k.cylX(k.paint(TOY.cream), 1.2, 64, 30, 0, z, 10));
      for (let i = 0; i < 12; i++) ladder.add(k.cylZ(k.paint(TOY.cream), 0.7, 8, 2 + i * 5.3, 0, 0, 8));
      const turntable = pivot("turntable", -18, 30, 0, k.cyl(k.paint(TOY.grey), 7, 3, 0, 0, 0, 7, 20), k.box(r, 8, 6, 8, 1.5, 0, 3, 0), k.at(ladder, 0, 7, 0));
      return k.group(
        chassis(k, 82),
        k.box(r, 56, 18, 28, 3, -11, 12),
        cab(k, TOY.red, 31, 24),
        k.box(k.paint(TOY.grey), 54, 1, 28.4, 0.3, -11, 20),
        k.cylX(k.paint(TOY.white), 4, 30, -18, 25, -9, 16),
        k.ring(k.paint(TOY.black), 5, 1.4, -26, 18, 14.6, true),
        k.ring(k.paint(TOY.black), 5, 1.4, -10, 18, 14.6, true),
        beacon(k, TOY.blue, 31, 30, -6),
        beacon(k, TOY.blue, 31, 30, 6),
        turntable,
        wheelSet(k, [-26, 30], 12.5, 7),
      );
    },
    animate: (root, t) => {
      const tt = part(root, "turntable");
      const l = part(root, "ladder");
      if (tt) tt.rotation.y = Math.sin(t * 0.4) * 0.8;
      if (l) l.rotation.z = (0.5 - 0.5 * Math.cos(t * 0.6)) * 0.75;
      blink(root, "flash", t, 4);
    },
  },
  {
    id: "veh-tow-truck",
    name: "Tow truck",
    category: "Vehicles",
    tags: ["tow", "truck", "breakdown", "hook", "crane"],
    notes: "A yellow breakdown truck with a lifting boom and swinging hook. It could haul a car stalled on the level crossing out of the train's way.",
    build: (k) => {
      const y = k.paint(TOY.yellow);
      const hook = pivot("hook", -38, 0, 0, k.cyl(k.metal, 0.6, 12, 0, -12, 0, 0.6, 8), k.ring(k.metal, 2.5, 0.9, 0, -14, 0, true, Math.PI * 1.4));
      const boom = pivot("boom", -14, 22, 0, k.box(k.paint(TOY.black), 40, 4, 5, 1.5, -20, -2, 0), hook);
      boom.rotation.z = -0.4;
      hook.rotation.z = 0.4;
      return k.group(
        chassis(k, 70, -4),
        cab(k, TOY.yellow, 22),
        k.box(y, 36, 8, 26, 2, -12, 12),
        k.box(k.paint(TOY.grey), 8, 10, 10, 1.5, -10, 20),
        beacon(k, TOY.orange, 22, 28, 0),
        boom,
        wheelSet(k, [-24, 22], 12.5, 7),
      );
    },
    animate: (root, t) => {
      const b = part(root, "boom");
      const h = part(root, "hook");
      const a = -0.35 - 0.25 * Math.sin(t * 0.7);
      if (b) b.rotation.z = a;
      if (h) h.rotation.z = -a + Math.sin(t * 2.1) * 0.15;
      blink(root, "flash", t, 3);
    },
  },
  {
    id: "veh-crane-truck",
    name: "Crane truck",
    category: "Vehicles",
    tags: ["crane", "truck", "lift", "works", "outriggers"],
    notes: "A mobile crane on a long truck with outriggers: the cab slews and the jib luffs. It could lift fallen wagons back onto the track after a derailment.",
    build: (k) => {
      const o = k.paint(TOY.orange);
      const hook = pivot("hook", 58, 0, 0, k.cyl(k.metal, 0.5, 14, 0, -14, 0, 0.5, 8), k.box(k.paint(TOY.black), 5, 4, 5, 1, 0, -18, 0), k.ring(k.metal, 2.2, 0.8, 0, -20, 0, true, Math.PI * 1.4));
      const jib = pivot(
        "jib",
        6,
        12,
        0,
        k.box(k.paint(TOY.yellow), 60, 5, 7, 1.5, 28, -2.5, 0),
        k.box(k.paint(TOY.yellow), 40, 3.5, 5, 1, 50, -1.75, 0),
        hook,
      );
      jib.rotation.z = 0.3;
      hook.rotation.z = -0.3;
      const slew = pivot(
        "slew",
        -18,
        13,
        0,
        k.cyl(k.paint(TOY.grey), 11, 3, 0, 0, 0, 11, 24),
        k.box(o, 24, 12, 22, 3, -2, 3, 0),
        k.box(o, 10, 10, 9, 2, 4, 15, 7),
        glass(k, 8, 5, 9.6, 4.5, 18, 7),
        k.box(k.paint(TOY.black), 8, 10, 20, 2, -12, 3, 0),
        jib,
      );
      const outriggers = new Group();
      for (const x of [-32, 12]) for (const s of [-1, 1]) {
        outriggers.add(k.box(k.paint(TOY.black), 4, 3, 10, 0.5, x, 7, s * 16));
        outriggers.add(k.cyl(k.paint(TOY.grey), 1.2, 6, x, 1, s * 20, 1.2, 10));
        outriggers.add(k.cyl(k.paint(TOY.black), 3, 1.2, x, 0, s * 20, 3, 14));
      }
      return k.group(chassis(k, 88), cab(k, TOY.orange, 35), k.box(k.paint(TOY.grey), 60, 2, 24, 0.5, -10, 11), outriggers, slew, wheelSet(k, [-30, -16, 34], 12.5, 7));
    },
    animate: (root, t) => {
      const s = part(root, "slew");
      const j = part(root, "jib");
      const h = part(root, "hook");
      if (s) s.rotation.y = Math.sin(t * 0.35) * 1.3;
      const a = 0.35 + 0.25 * Math.sin(t * 0.55);
      if (j) j.rotation.z = a;
      if (h) h.rotation.z = -a;
    },
  },
  {
    id: "veh-dump-truck",
    name: "Dump truck",
    category: "Vehicles",
    tags: ["truck", "tipper", "dump", "works", "gravel"],
    notes: "A blue tipper whose body tips back to pour out its load of stones. It could fill a hopper wagon at a quarry siding, or tip ballast for new track.",
    build: (k) => {
      const yel = k.paint(TOY.yellow);
      const load = new Group();
      for (let i = 0; i < 9; i++) load.add(k.ball(k.paint(i % 2 ? TOY.grey : "#a9aaad"), 5, 8 + (i % 3) * 14 + (i > 5 ? 4 : 0), 6 + Math.floor(i / 3) * 1.5, -8 + Math.floor(i / 3) * 8, 0.8));
      const bed = pivot(
        "bed",
        -38,
        12,
        0,
        k.box(yel, 52, 3, 28, 1, 26, 0, 0),
        k.box(yel, 52, 12, 2.5, 1, 26, 0, -13),
        k.box(yel, 52, 12, 2.5, 1, 26, 0, 13),
        k.box(yel, 3, 16, 28, 1, 51, 0, 0),
        k.box(yel, 6, 2, 28, 0.8, 54, 14, 0),
        load,
      );
      return k.group(chassis(k, 80), cab(k, TOY.blue, 30), k.box(k.paint(TOY.grey), 6, 6, 4, 1, -6, 10, 0), bed, wheelSet(k, [-26, -12, 30], 12.5, 7));
    },
    animate: (root, t) => {
      const b = part(root, "bed");
      if (b) b.rotation.z = Math.max(0, Math.sin(t * 0.7)) * 0.75;
    },
  },
  {
    id: "veh-cement-mixer",
    name: "Cement mixer truck",
    category: "Vehicles",
    tags: ["truck", "cement", "mixer", "drum", "works"],
    notes: "A truck with a striped drum that keeps turning. Building sites in town could need cement from a siding before a new station can go up.",
    build: (k) => {
      const drum = pivot(
        "drum",
        0,
        0,
        0,
        latheX(k, k.paint(TOY.orange), [
          [4, 0],
          [9, 5],
          [13, 16],
          [13, 30],
          [10, 42],
          [6, 50],
        ], -26),
      );
      for (let i = 0; i < 4; i++) {
        const stripe = k.box(k.paint(TOY.white), 22, 1, 3, 0.4, 0, 12.6, 0);
        const holder = new Group();
        holder.add(stripe);
        holder.position.x = -4;
        holder.rotation.x = (i * Math.PI) / 2;
        drum.add(holder);
      }
      const mount = pivot("mount", -12, 27, 0, drum);
      mount.rotation.z = -0.18;
      return k.group(
        chassis(k, 82),
        cab(k, TOY.white, 31),
        k.box(k.paint(TOY.grey), 4, 14, 20, 1, 15, 10, 0),
        k.box(k.paint(TOY.grey), 4, 10, 18, 1, -34, 10, 0),
        k.cone(k.paint(TOY.grey), 4, 8, -42, 20, 0),
        mount,
        wheelSet(k, [-28, -14, 31], 12.5, 7),
      );
    },
    animate: (root, t) => {
      const d = part(root, "drum");
      if (d) d.rotation.x = t * 1.8;
    },
  },
  {
    id: "veh-petrol-tanker",
    name: "Petrol tanker",
    category: "Vehicles",
    tags: ["truck", "tanker", "fuel", "oil", "road"],
    notes: "A white road tanker with a red band and a ladder. It could fill up from a tank wagon at the depot and supply a filling station in town.",
    build: (k) => {
      const tank = latheX(k, k.paint(TOY.white), [
        [0, 0],
        [8, 1],
        [11.5, 4],
        [12, 9],
        [12, 49],
        [11.5, 54],
        [8, 57],
        [0, 58],
      ], -42, 24);
      const g = k.group(
        chassis(k, 82),
        cab(k, TOY.red, 31),
        tank,
        k.cylX(k.paint(TOY.red), 12.3, 6, -13, 24, 0, 28),
        k.cylX(k.paint(TOY.red), 12.3, 3, -32, 24, 0, 28),
        k.cylX(k.paint(TOY.red), 12.3, 3, 6, 24, 0, 28),
        k.box(k.paint(TOY.grey), 40, 1.5, 4, 0.5, -13, 36, 0),
        k.box(k.paint(TOY.orange), 6, 5, 0.6, 0.5, -13, 10, 13.2),
        wheelSet(k, [-30, -16, 31], 12.5, 7),
      );
      for (const x of [-30, -20, 0]) g.add(k.cyl(k.paint(TOY.grey), 3, 2, x, 35.5, 0, 3, 14));
      for (let i = 0; i < 4; i++) g.add(k.box(k.paint(TOY.grey), 0.8, 0.8, 6, 0, -43, 14 + i * 5, 0));
      g.add(k.box(k.paint(TOY.grey), 0.8, 22, 0.8, 0, -43, 13, -3));
      g.add(k.box(k.paint(TOY.grey), 0.8, 22, 0.8, 0, -43, 13, 3));
      return g;
    },
    animate: (root, t) => rollWheels(root, t),
  },
  {
    id: "veh-log-truck",
    name: "Log truck",
    category: "Vehicles",
    tags: ["truck", "logs", "timber", "forest"],
    notes: "A green truck carrying a stack of turned logs between black stakes. It could bring logs from the forest to load onto the timber wagon at the sawmill siding.",
    build: (k) => {
      const g = k.group(chassis(k, 88, -4), cab(k, TOY.green, 31), k.box(k.paint(TOY.green), 62, 3, 26, 1, -13, 12), wheelSet(k, [-34, -20, 31], 12.5, 7));
      const rows: [number, number][] = [
        [-8, 0],
        [0, 0],
        [8, 0],
        [-4, 1],
        [4, 1],
        [0, 2],
      ];
      for (const [z, row] of rows) {
        const log = k.cylX(k.wood, 4.4, 60, -14, 19.5 + row * 7.6, z, 14);
        g.add(log);
        g.add(k.cylX(k.cut, 3.2, 60.4, -14, 19.5 + row * 7.6, z, 12));
      }
      for (const x of [-38, -14, 12]) for (const s of [-1, 1]) g.add(k.box(k.paint(TOY.black), 2.5, 22, 2.5, 0.6, x, 14, s * 13.5));
      return g;
    },
    animate: (root, t) => rollWheels(root, t),
  },

  // ——— Farm and building site ———
  {
    id: "veh-tractor-trailer",
    name: "Tractor and hay trailer",
    category: "Vehicles",
    tags: ["tractor", "farm", "trailer", "hay"],
    notes: "A red tractor with big back wheels towing a trailer of round hay bales. The farm could send hay to the station to be loaded for the town's horses.",
    build: (k) => {
      const r = k.paint(TOY.red);
      const tractor = k.group(
        k.box(r, 30, 13, 16, 3, 14, 7),
        k.box(k.paint(TOY.grey), 2, 9, 12, 0.6, 29.5, 8),
        k.cyl(k.paint(TOY.black), 1.4, 12, 22, 20, 0, 1.4, 10),
        k.box(r, 16, 8, 20, 2, -4, 7),
        k.box(k.paint(TOY.black), 6, 6, 8, 1.5, -6, 15),
        k.peg(TOY.blue, TOY.yellow, -4, 13, 0),
        k.box(k.paint(TOY.cream), 20, 2, 26, 1, -2, 34),
        roadWheel(k, -6, 14, 11, TOY.yellow, 7),
        roadWheel(k, -6, -14, 11, TOY.yellow, 7),
        roadWheel(k, 20, 10.5, 6, TOY.yellow, 4.5),
        roadWheel(k, 20, -10.5, 6, TOY.yellow, 4.5),
        lamps(k, 29.5, 15, 5),
      );
      for (const x of [-11, 7]) for (const z of [-10, 10]) tractor.add(k.box(k.paint(TOY.black), 1.6, 20, 1.6, 0.5, x, 15, z));
      const trailer = k.group(
        rod(k, k.paint(TOY.black), -26, 9, -12, 9, 1.2),
        k.box(k.paint(TOY.green), 46, 4, 30, 1, -50, 10),
        k.box(k.paint(TOY.green), 46, 5, 2, 0.6, -50, 14, -14),
        k.box(k.paint(TOY.green), 46, 5, 2, 0.6, -50, 14, 14),
        roadWheel(k, -50, 15, 7, TOY.yellow, 4.5),
        roadWheel(k, -50, -15, 7, TOY.yellow, 4.5),
      );
      for (const x of [-64, -50, -36]) {
        for (const z of [-7, 7]) trailer.add(k.cylZ(k.paint(TOY.yellow), 6.5, 12, x, 20.5, z, 18));
      }
      trailer.add(k.cylZ(k.paint(TOY.yellow), 6.5, 12, -57, 32.5, 0, 18));
      trailer.add(k.cylZ(k.paint(TOY.yellow), 6.5, 12, -43, 32.5, 0, 18));
      return k.group(tractor, trailer);
    },
    animate: (root, t) => rollWheels(root, t, 25),
  },
  {
    id: "veh-combine-harvester",
    name: "Combine harvester",
    category: "Vehicles",
    tags: ["combine", "harvester", "farm", "wheat", "reel"],
    notes: "A big green combine with a spinning reel at the front and a grain pipe. Harvest time could fill grain wagons waiting at a farm siding.",
    build: (k) => {
      const g = k.paint(TOY.green);
      const reel = pivot("reel", 44, 15, 0, k.cylZ(k.paint(TOY.yellow), 1.5, 50, 0, 0, 0, 10));
      for (let i = 0; i < 5; i++) {
        const a = (i * Math.PI * 2) / 5;
        reel.add(k.cylZ(k.paint(TOY.yellow), 1, 48, Math.cos(a) * 8, Math.sin(a) * 8, 0, 8));
        for (const z of [-20, 0, 20]) reel.add(rod(k, k.paint(TOY.yellow), 0, 0, Math.cos(a) * 8, Math.sin(a) * 8, 0.6, z));
      }
      return k.group(
        k.box(g, 54, 26, 28, 4, -4, 9),
        k.box(g, 20, 6, 28, 2, -18, 35),
        k.box(g, 16, 12, 22, 3, 14, 35),
        glass(k, 14, 9, 22.6, 16, 37),
        k.box(k.paint(TOY.cream), 17, 2, 23, 1, 14, 47),
        k.peg(TOY.blue, TOY.yellow, 13, 32, 0),
        k.box(k.paint(TOY.yellow), 16, 6, 52, 2, 40, 3),
        k.box(k.paint(TOY.yellow), 3, 8, 52, 1, 47, 3),
        k.box(k.paint(TOY.grey), 20, 4, 8, 1, 30, 9),
        reel,
        rod(k, k.paint(TOY.yellow), 26, 15, 28, 15, 1.5, 24),
        rod(k, k.paint(TOY.yellow), -10, 36, 10, 46, 2, 15),
        k.cyl(k.paint(TOY.black), 1.4, 8, -26, 41, 6, 1.4, 10),
        lamps(k, 22.5, 42, 8),
        roadWheel(k, 10, 15, 11, TOY.yellow, 7),
        roadWheel(k, 10, -15, 11, TOY.yellow, 7),
        roadWheel(k, -22, 13, 7, TOY.yellow, 5),
        roadWheel(k, -22, -13, 7, TOY.yellow, 5),
      );
    },
    animate: (root, t) => {
      const r = part(root, "reel");
      if (r) r.rotation.z = -t * 2.2;
      rollWheels(root, t, 12);
    },
  },
  {
    id: "veh-forklift",
    name: "Forklift",
    category: "Vehicles",
    tags: ["forklift", "pallet", "goods", "yard", "lift"],
    notes: "A small yellow forklift raising a pallet with a crate. In the goods yard it could load crates into a van wagon, one press per crate.",
    build: (k) => {
      const yel = k.paint(TOY.yellow);
      const fork = pivot(
        "fork",
        0,
        2,
        0,
        k.box(k.paint(TOY.black), 2, 14, 18, 0.6, 21, 0, 0),
        k.box(k.paint(TOY.grey), 18, 1.5, 3, 0.4, 30, 0, -5),
        k.box(k.paint(TOY.grey), 18, 1.5, 3, 0.4, 30, 0, 5),
        k.box(k.wood, 18, 3, 18, 0.5, 31, 1.5, 0),
        k.box(k.paint("#c9a36b"), 14, 12, 14, 1, 31, 4.5, 0),
        k.box(k.cut, 14.2, 1.2, 14.2, 0, 31, 10, 0),
      );
      const g = k.group(
        k.box(yel, 34, 12, 22, 3, 0, 5),
        k.box(k.paint(TOY.grey), 8, 14, 22, 3, -14, 5),
        k.box(k.paint(TOY.black), 6, 5, 8, 1.5, -4, 17),
        k.peg(TOY.orange, TOY.yellow, -3, 16, 0),
        k.box(yel, 24, 2, 22, 1, -2, 40),
        k.box(k.paint(TOY.black), 2, 40, 2, 0.5, 19, 2, -6),
        k.box(k.paint(TOY.black), 2, 40, 2, 0.5, 19, 2, 6),
        k.box(k.paint(TOY.black), 2, 2, 14, 0.5, 19, 40, 0),
        fork,
        roadWheel(k, 10, 11, 6, TOY.red, 5),
        roadWheel(k, 10, -11, 6, TOY.red, 5),
        roadWheel(k, -10, 11, 5, TOY.red, 5),
        roadWheel(k, -10, -11, 5, TOY.red, 5),
        beacon(k, TOY.orange, -6, 42, 0),
      );
      for (const x of [-12, 8]) for (const z of [-10, 10]) g.add(k.box(k.paint(TOY.black), 1.6, 23, 1.6, 0.5, x, 17, z));
      return g;
    },
    animate: (root, t) => {
      const f = part(root, "fork");
      if (f) f.position.y = 2 + (0.5 - 0.5 * Math.cos(t * 0.8)) * 22;
      blink(root, "flash", t, 2);
    },
  },
  {
    id: "veh-digger",
    name: "Digger",
    category: "Vehicles",
    tags: ["digger", "excavator", "tracks", "works", "arm"],
    notes: "A tracked digger whose cab slews while the boom, arm and bucket scoop. It could dig a cutting for new track, or load spoil into a dump truck.",
    build: (k) => {
      const yel = k.paint(TOY.yellow);
      const bucket = pivot(
        "bucket",
        24,
        0,
        0,
        k.extrude(k.paint(TOY.grey), [
          [0, 2],
          [8, -2],
          [10, -10],
          [2, -10],
          [-2, -2],
        ], 14, 0, 0, 0, 0.8),
      );
      bucket.rotation.z = -0.4;
      const stick = pivot("stick", 30, 0, 0, k.box(yel, 26, 4.5, 5, 1.5, 12, -2.25, 0), bucket);
      stick.rotation.z = -1.4;
      const boom = pivot("boom", 12, 14, 0, k.box(yel, 32, 6, 6, 2, 15, -3, 0), k.cylZ(k.paint(TOY.grey), 2.5, 8, 30, 0, 0, 12), stick);
      boom.rotation.z = 0.6;
      const house = pivot(
        "house",
        0,
        12,
        0,
        k.cyl(k.paint(TOY.black), 11, 2, 0, 0, 0, 11, 24),
        k.box(yel, 34, 12, 26, 3, -2, 2, 0),
        k.box(k.paint(TOY.grey), 10, 14, 26, 3, -18, 2, 0),
        k.box(yel, 14, 16, 12, 3, 4, 14, -6),
        glass(k, 14.6, 8, 12.6, 4, 19, -6),
        k.peg(TOY.blue, TOY.yellow, 4, 12, -6),
        k.cyl(k.paint(TOY.black), 1.4, 10, -10, 14, 8, 1.4, 10),
        boom,
      );
      const g = k.group(house);
      for (const z of [-11, 11]) {
        g.add(k.box(k.paint(TOY.black), 50, 10, 8, 4, 0, 0, z));
        for (const x of [-18, -6, 6, 18]) g.add(k.cylZ(k.paint(TOY.grey), 3, 8.6, x, 5.5, z, 12));
      }
      g.add(k.box(k.paint(TOY.grey), 30, 4, 14, 1, 0, 7));
      return g;
    },
    animate: (root, t) => {
      const h = part(root, "house");
      const b = part(root, "boom");
      const s = part(root, "stick");
      const bu = part(root, "bucket");
      if (h) h.rotation.y = Math.sin(t * 0.3) * 0.6;
      if (b) b.rotation.z = 0.55 + 0.25 * Math.sin(t * 0.7);
      if (s) s.rotation.z = -1.35 + 0.4 * Math.sin(t * 0.7 + 1);
      if (bu) bu.rotation.z = -0.5 + 0.6 * Math.sin(t * 0.7 + 2);
    },
  },
  {
    id: "veh-road-roller",
    name: "Road roller",
    category: "Vehicles",
    tags: ["roller", "steam", "road", "works"],
    notes: "A green roller with a big front drum, a canopy and a chimney. It could flatten a new road felt into place, crossing the line at a level crossing.",
    build: (k) => {
      const g = k.paint(TOY.green);
      const roller = pivot("wheel", 24, 10, 0, k.cylZ(k.paint(TOY.grey), 10, 26, 0, 0, 0, 24), k.cylZ(k.paint(TOY.red), 4, 27, 0, 0, 0, 14), k.box(k.wood, 7, 2, 27.4, 0, 0, -1, 0));
      roller.userData.r = 10;
      const out = k.group(
        k.box(g, 40, 14, 20, 3, -4, 8),
        k.cylX(g, 7, 24, 8, 20, 0, 20),
        k.box(k.paint(TOY.red), 6, 22, 8, 1.5, 24, 6, 0),
        k.box(k.paint(TOY.black), 8, 4, 30, 1, 24, 20, 0),
        roller,
        k.cyl(k.paint(TOY.black), 2.5, 22, 16, 22, 0, 3, 14),
        k.cyl(k.paint(TOY.red), 3.4, 2, 16, 43, 0, 3.4, 14),
        k.box(k.paint(TOY.black), 6, 6, 8, 1.5, -14, 22),
        k.peg(TOY.blue, TOY.black, -14, 20, 0),
        k.box(k.paint(TOY.cream), 34, 2, 26, 1, -6, 44),
        roadWheel(k, -16, 14, 9, TOY.red, 6),
        roadWheel(k, -16, -14, 9, TOY.red, 6),
      );
      for (const x of [-20, 8]) for (const z of [-11, 11]) out.add(k.box(k.paint(TOY.black), 1.6, 22, 1.6, 0.5, x, 22, z));
      return out;
    },
    animate: (root, t) => rollWheels(root, t, 15),
  },

  // ——— Two wheels and four legs ———
  {
    id: "veh-motorbike",
    name: "Motorbike",
    category: "Vehicles",
    tags: ["motorbike", "motorcycle", "rider", "road"],
    notes: "A small red motorbike with a peg rider in a helmet. It could race a train along a road beside the line, a little speed game.",
    build: (k) => {
      const red = k.paint(TOY.red);
      return k.group(
        roadWheel(k, 16, 0, 7, TOY.grey, 4),
        roadWheel(k, -16, 0, 7, TOY.grey, 4),
        k.box(red, 18, 8, 9, 3, 2, 11),
        k.box(k.paint(TOY.black), 14, 3, 8, 1.2, -9, 15),
        k.box(k.paint(TOY.grey), 14, 5, 6, 1.5, -2, 7),
        rod(k, k.paint(TOY.grey), 16, 7, 12, 22, 1.2, -2.5),
        rod(k, k.paint(TOY.grey), 16, 7, 12, 22, 1.2, 2.5),
        k.cylZ(k.paint(TOY.black), 1, 16, 12, 22, 0, 8),
        k.ball(k.paint(TOY.cream), 2.6, 15, 18, 0),
        k.box(red, 10, 2, 6, 0.8, 16, 14, 0),
        k.box(red, 10, 2, 6, 0.8, -15, 14, 0),
        k.cylX(k.paint(TOY.grey), 1.6, 12, -12, 6, 5, 10),
        k.peg(TOY.black, null, -6, 15, 0),
        k.ball(k.paint(TOY.white), 3.8, -6, 30, 0),
      );
    },
    animate: (root, t) => rollWheels(root, t, 60),
  },
  {
    id: "veh-bicycle",
    name: "Bicycle with rider",
    category: "Vehicles",
    tags: ["bicycle", "bike", "rider", "peg", "path"],
    notes: "A bicycle with a peg rider and a little basket. Cyclists could pedal along a country lane, ringing a bell at the crossing.",
    build: (k) => {
      const frame = k.paint(TOY.blue);
      const bike = (x: number): Group => {
        const w = pivot("wheel", x, 9.6, 0, k.ring(k.paint(TOY.black), 8.4, 1.2, 0, 0, 0, true), k.cylZ(k.paint(TOY.grey), 1.4, 3, 0, 0, 0, 10));
        w.userData.r = 9.6;
        for (let i = 0; i < 3; i++) {
          const s = k.box(k.paint(TOY.grey), 16, 0.5, 0.5, 0);
          s.position.y = 0;
          s.rotation.z = (i * Math.PI) / 3;
          w.add(s);
        }
        return w;
      };
      const crank = pivot("crank", 0, 9.6, 0, k.cylZ(k.paint(TOY.grey), 2.5, 2, 0, 0, 0, 12), rod(k, k.paint(TOY.grey), 0, 0, 0, 5, 0.6, 2.5), rod(k, k.paint(TOY.grey), 0, 0, 0, -5, 0.6, -2.5));
      return k.group(
        bike(14),
        bike(-14),
        crank,
        rod(k, frame, -14, 9.6, 0, 9.6, 0.9),
        rod(k, frame, 0, 9.6, -3, 21, 0.9),
        rod(k, frame, -14, 9.6, -3, 21, 0.9),
        rod(k, frame, -3, 21, 11, 21, 0.9),
        rod(k, frame, 0, 9.6, 11, 21, 0.9),
        rod(k, frame, 14, 9.6, 11, 24, 0.9),
        k.cylZ(k.paint(TOY.black), 0.8, 12, 11, 24.5, 0, 8),
        k.box(k.paint(TOY.black), 6, 1.6, 3.5, 0.6, -3.5, 21.5),
        k.box(k.paint("#c9a36b"), 6, 5, 7, 1, 16, 21),
        k.peg(TOY.red, TOY.blue, -4, 22, 0),
      );
    },
    animate: (root, t) => {
      rollWheels(root, t, 25);
      const c = part(root, "crank");
      if (c) c.rotation.z = -t * 3;
    },
  },
  {
    id: "veh-horse-cart",
    name: "Horse and cart",
    category: "Vehicles",
    tags: ["horse", "cart", "farm", "wagon", "old"],
    notes: "A brown horse pulling a two-wheeled cart with a peg driver and milk churns. It could bring churns from the farm to the milk platform for the morning train.",
    build: (k) => {
      const brown = k.paint(TOY.brown);
      const body = k.capsule(brown, 6, 16, 0, 0, 0);
      body.rotation.z = Math.PI / 2;
      body.position.set(0, 22, 0);
      const head = pivot("head", 9, 26, 0, rod(k, brown, 0, 0, 6, 10, 3.2), k.box(brown, 12, 5.5, 5.5, 2, 9, 8, 0), k.ball(k.paint(TOY.black), 0.9, 12, 12, 2.5), k.ball(k.paint(TOY.black), 0.9, 12, 12, -2.5), k.cone(brown, 1.4, 4, 4, 13, 1.5), k.cone(brown, 1.4, 4, 4, 13, -1.5));
      const horse = k.at(
        k.group(
          body,
          head,
          k.box(k.paint(TOY.black), 10, 3, 2, 1, 8, 32, 0),
          rod(k, k.paint(TOY.black), -11, 23, -15, 12, 1.4),
        ),
        28,
        0,
        0,
      );
      for (const x of [-8, 8]) for (const z of [-3.5, 3.5]) {
        horse.add(k.cyl(brown, 1.9, 18, x, 0, z, 1.9, 10));
        horse.add(k.cyl(k.paint(TOY.black), 2.2, 2.5, x, 0, z, 2.2, 10));
      }
      const wheel = (z: number): Group => {
        const w = pivot("wheel", -14, 12, z, k.ring(k.paint(TOY.red), 11, 1.4, 0, 0, 0, true), k.cylZ(k.paint(TOY.red), 2.4, 4, 0, 0, 0, 12));
        w.userData.r = 12;
        for (let i = 0; i < 4; i++) {
          const s = k.box(k.paint(TOY.red), 22, 1.2, 1.2, 0);
          s.rotation.z = (i * Math.PI) / 4;
          w.add(s);
        }
        return w;
      };
      const cart = k.group(
        k.box(k.wood, 34, 3, 24, 1, -14, 14),
        k.box(k.wood, 34, 7, 2, 0.8, -14, 17, -11),
        k.box(k.wood, 34, 7, 2, 0.8, -14, 17, 11),
        k.box(k.wood, 2, 7, 24, 0.8, -30, 17, 0),
        wheel(-14),
        wheel(14),
        rod(k, k.wood, 0, 15, 26, 21, 1, -8),
        rod(k, k.wood, 0, 15, 26, 21, 1, 8),
        k.box(k.wood, 6, 2, 22, 0.6, -2, 22),
        k.peg(TOY.green, TOY.brown, -2, 18, 0),
      );
      for (const z of [-5, 5]) cart.add(k.lathe(k.paint(TOY.grey), [[0, 0], [4, 0], [4, 7], [2.5, 9], [2.5, 11], [3, 11.5], [0, 11.5]], -22, 17, z, 16));
      return k.group(horse, cart);
    },
    animate: (root, t) => {
      rollWheels(root, t, 18);
      const h = part(root, "head");
      if (h) h.rotation.z = Math.sin(t * 3) * 0.12;
    },
  },

  // ——— On the water ———
  {
    id: "veh-rowing-boat",
    name: "Rowing boat",
    category: "Vehicles",
    tags: ["boat", "rowing", "oars", "lake", "water"],
    notes: "A little beech rowing boat with a peg rower pulling on two oars. It could ferry a passenger across the river where there is no bridge yet.",
    build: (k) => {
      const oar = (s: 1 | -1): Group => {
        const blade = k.box(k.paint(TOY.red), 8, 0.8, 4, 0.3, 0, -0.4, s * 22);
        const o = pivot("oar", -2, 9, s * 10, k.cylZ(k.wood, 0.8, 26, 0, 0, s * 9, 8), blade);
        o.rotation.x = s * 0.35;
        return o;
      };
      const boat = pivot("boat", 0, 0, 0, hull(k, "#d8b483", 46, 20, 7, TOY.blue));
      boat.add(k.box(k.wood, 4, 2, 18, 0.5, -2, 7));
      boat.add(k.box(k.wood, 4, 2, 16, 0.5, 14, 7));
      boat.add(k.peg(TOY.yellow, TOY.red, -6, 6, 0));
      boat.add(oar(1));
      boat.add(oar(-1));
      return k.group(water(k, 42), boat);
    },
    animate: (root, t) => {
      bob(root, t, 0.6);
      const oars = parts(root, "oar");
      const a = Math.sin(t * 2.2) * 0.5;
      for (let i = 0; i < oars.length; i++) {
        const s = oars[i].position.z > 0 ? 1 : -1;
        oars[i].rotation.y = s * a;
      }
    },
  },
  {
    id: "veh-sailing-boat",
    name: "Sailing boat",
    category: "Vehicles",
    tags: ["boat", "sail", "yacht", "lake", "water"],
    notes: "A white sailing dinghy with a cream mainsail and red jib. Boats on a lake could drift with the wind, and a swing bridge must open for the mast.",
    build: (k) => {
      const main = k.extrude(k.paint(TOY.cream), [
        [0, 0],
        [0, 46],
        [-26, 0],
      ], 1, -0.2, 13, 0, 0.3);
      const jib = k.extrude(k.paint(TOY.red), [
        [0, 0],
        [0, 38],
        [20, 0],
      ], 1, 2, 13, 0, 0.3);
      const boat = pivot(
        "boat",
        0,
        0,
        0,
        hull(k, TOY.white, 56, 22, 8, TOY.blue),
        k.cyl(k.wood, 1.2, 54, 1, 8, 0, 1, 10),
        k.cylX(k.wood, 1, 28, -12, 12.5, 0, 8),
        main,
        jib,
        k.extrude(k.paint(TOY.red), [
          [0, 0],
          [7, 2],
          [0, 4],
        ], 0.6, 1.5, 58, 0, 0.2),
        k.peg(TOY.orange, TOY.yellow, -18, 9, 0),
      );
      return k.group(water(k, 44), boat);
    },
    animate: (root, t) => bob(root, t, 1.4),
  },
  {
    id: "veh-car-ferry",
    name: "Car ferry",
    category: "Vehicles",
    tags: ["ferry", "boat", "cars", "ramp", "water"],
    notes: "A blue ferry with a car on deck and a bow ramp that lowers. A ferry crossing could carry road vehicles over a river that the trains cross by bridge.",
    build: (k) => {
      const car = k.at(
        k.group(k.box(k.paint(TOY.yellow), 22, 6, 12, 2, 0, 0), k.box(k.paint(TOY.yellow), 11, 5, 11, 2, -2, 5), glass(k, 11.6, 3, 11.6, -2, 6), wheelSet(k, [-7, 7], 6, 3, TOY.red, 2.5)),
        14,
        11,
        0,
      );
      const ramp = pivot("ramp", 46, 11, 0, k.box(k.paint(TOY.grey), 12, 2, 24, 0.6, 6, -1, 0));
      ramp.rotation.z = 1.3;
      const boat = pivot(
        "boat",
        0,
        0,
        0,
        hull(k, TOY.blue, 100, 36, 10, TOY.red),
        k.box(k.paint(TOY.cream), 36, 14, 30, 3, -26, 11),
        glass(k, 34, 5, 30.6, -26, 17),
        k.box(k.paint(TOY.white), 18, 9, 22, 2.5, -30, 25),
        glass(k, 18.6, 4, 18, -30, 28.5),
        k.cyl(k.paint(TOY.yellow), 5, 14, -40, 25, 0, 5, 18),
        k.cyl(k.paint(TOY.black), 5.2, 3, -40, 36, 0, 5.2, 18),
        k.box(k.paint(TOY.white), 60, 4, 1.5, 0.5, 6, 11, -16),
        k.box(k.paint(TOY.white), 60, 4, 1.5, 0.5, 6, 11, 16),
        k.ring(k.paint(TOY.red), 3, 1, -8, 15, 16.2, true),
        car,
        ramp,
      );
      return k.group(water(k, 62), boat);
    },
    animate: (root, t) => {
      bob(root, t, 0.6);
      const r = part(root, "ramp");
      if (r) r.rotation.z = 1.3 - Math.max(0, Math.sin(t * 0.5)) * 1.3;
    },
  },
  {
    id: "veh-cargo-ship",
    name: "Container ship",
    category: "Vehicles",
    tags: ["ship", "cargo", "containers", "harbour", "water"],
    notes: "A long ship stacked with colourful containers and a bridge at the stern. At the harbour, a crane could swap its containers onto flat wagons, one colour per town.",
    build: (k) => {
      const boat = pivot(
        "boat",
        0,
        0,
        0,
        hull(k, TOY.black, 130, 34, 12, TOY.red),
        k.box(k.paint(TOY.white), 18, 12, 30, 2, -52, 13),
        k.box(k.paint(TOY.white), 14, 10, 26, 2, -52, 25),
        glass(k, 14.6, 4, 30, -50, 30),
        k.box(k.paint(TOY.white), 6, 2, 34, 0.6, -47, 34),
        k.cyl(k.paint(TOY.orange), 4, 14, -60, 25, 0, 3.5, 16),
        k.cyl(k.paint(TOY.black), 3.6, 3, -60, 39, 0, 3.6, 16),
        k.cyl(k.paint(TOY.white), 1, 16, 56, 13, 0, 1, 8),
      );
      const colours = [TOY.red, TOY.blue, TOY.yellow, TOY.green, TOY.orange, TOY.teal, TOY.purple];
      let c = 0;
      for (let col = 0; col < 5; col++) {
        for (const z of [-7.5, 7.5]) {
          const layers = col === 4 ? 1 : 2;
          for (let l = 0; l < layers; l++) {
            boat.add(k.box(k.paint(colours[c++ % colours.length]), 17, 9.5, 14, 0.8, -30 + col * 18.5, 13 + l * 10, z));
          }
        }
      }
      return k.group(water(k, 76), boat);
    },
    animate: (root, t) => bob(root, t, 0.35),
  },
  {
    id: "veh-tugboat",
    name: "Tugboat",
    category: "Vehicles",
    tags: ["tug", "boat", "harbour", "tow", "water"],
    notes: "A stubby red tug with tyre fenders and a fat funnel. It could nudge a ship into the harbour so its cargo can reach the railway.",
    build: (k) => {
      const boat = pivot(
        "boat",
        0,
        0,
        0,
        hull(k, TOY.red, 60, 28, 10, TOY.black),
        k.box(k.paint(TOY.cream), 24, 12, 20, 3, -2, 11),
        k.box(k.paint(TOY.cream), 14, 10, 18, 2.5, 2, 23),
        glass(k, 14.6, 4, 18.6, 2, 27),
        k.box(k.paint(TOY.red), 16, 2, 20, 0.8, 2, 33),
        k.cyl(k.paint(TOY.black), 5.5, 20, -10, 22, 0, 5, 18),
        k.cyl(k.paint(TOY.red), 5.6, 3, -10, 36, 0, 5.4, 18),
        k.cyl(k.paint(TOY.black), 2.4, 4, -24, 11, 0, 2.4, 12),
        beacon(k, TOY.orange, 6, 35, 0),
      );
      for (const x of [-20, -8, 4, 16]) for (const s of [-1, 1]) {
        const tyre = k.ring(k.paint(TOY.black), 2.6, 1.3, x, 6.5, s * 15, true);
        boat.add(tyre);
      }
      boat.add(k.ring(k.paint(TOY.black), 4, 1.8, 31, 6, 0, false));
      return k.group(water(k, 44), boat);
    },
    animate: (root, t) => {
      bob(root, t, 1);
      blink(root, "flash", t, 1.5);
    },
  },
  {
    id: "veh-paddle-steamer",
    name: "Paddle steamer",
    category: "Vehicles",
    tags: ["paddle", "steamer", "boat", "river", "water"],
    notes: "A white river steamer with tall twin funnels and turning paddle wheels on each side. It could run day trips from the riverside station when the excursion train arrives.",
    build: (k) => {
      const paddle = (z: number): Group => {
        const p = pivot("paddle", 0, 12, z, k.cylZ(k.paint(TOY.red), 3, 6, 0, 0, 0, 14));
        for (let i = 0; i < 8; i++) {
          const arm = new Group();
          arm.rotation.z = (i * Math.PI) / 4;
          arm.add(k.box(k.paint(TOY.red), 1.2, 11, 1.2, 0, 0, 0, 0));
          arm.add(k.box(k.wood, 2, 4, 6, 0.5, 0, 9, 0));
          p.add(arm);
        }
        return p;
      };
      const boat = pivot(
        "boat",
        0,
        0,
        0,
        hull(k, TOY.white, 90, 24, 8, TOY.red),
        k.box(k.paint(TOY.cream), 50, 10, 22, 2.5, -6, 9),
        glass(k, 46, 4, 22.6, -6, 13),
        k.box(k.paint(TOY.red), 52, 1.5, 24, 0.6, -6, 19),
        k.box(k.paint(TOY.white), 14, 7, 14, 2, 14, 20.5),
        glass(k, 14.6, 3, 14.6, 14, 23),
        k.cyl(k.paint(TOY.black), 3.6, 30, -2, 20, -4, 3.6, 16),
        k.cyl(k.paint(TOY.black), 3.6, 30, -2, 20, 4, 3.6, 16),
        k.cyl(k.paint(TOY.red), 3.8, 3, -2, 44, -4, 3.8, 16),
        k.cyl(k.paint(TOY.red), 3.8, 3, -2, 44, 4, 3.8, 16),
        k.ring(k.paint(TOY.white), 14.5, 1.8, 0, 12, -16, true, Math.PI),
        k.ring(k.paint(TOY.white), 14.5, 1.8, 0, 12, 16, true, Math.PI),
        paddle(-16),
        paddle(16),
        k.cyl(k.wood, 0.8, 14, -36, 8, 0, 0.8, 8),
        k.extrude(k.paint(TOY.blue), [
          [0, 0],
          [7, 2],
          [0, 4],
        ], 0.6, -36, 18, 0, 0.2),
      );
      return k.group(water(k, 54), boat);
    },
    animate: (root, t) => {
      bob(root, t, 0.5);
      for (const p of parts(root, "paddle")) p.rotation.z = -t * 2;
    },
  },
  {
    id: "veh-fishing-boat",
    name: "Fishing boat",
    category: "Vehicles",
    tags: ["fishing", "boat", "trawler", "harbour", "fish", "water"],
    notes: "A teal fishing boat with a wheelhouse, a swinging net boom and crates of fish. Its catch could go by fish van to the station for the express to town.",
    build: (k) => {
      const boom = pivot("boom", 14, 22, 0, k.cylX(k.wood, 0.9, 24, 12, 0, 0, 8), k.cyl(k.paint(TOY.grey), 0.4, 10, 24, -10, 0, 0.4, 6), k.ball(k.paint(TOY.grey), 4, 24, -12, 0, 0.8));
      boom.rotation.y = 0.6;
      const boat = pivot(
        "boat",
        0,
        0,
        0,
        hull(k, TOY.teal, 62, 24, 9, TOY.red),
        k.box(k.paint(TOY.white), 16, 14, 16, 2.5, -16, 10),
        glass(k, 16.6, 5, 16.6, -16, 17),
        k.box(k.paint(TOY.red), 18, 2, 18, 0.8, -16, 24),
        k.cyl(k.wood, 1.2, 30, 14, 10, 0, 1, 10),
        boom,
        k.box(k.paint(TOY.orange), 7, 5, 7, 1, 2, 10, -6),
        k.box(k.paint(TOY.orange), 7, 5, 7, 1, 2, 10, 6),
        k.box(k.paint(TOY.blue), 7, 5, 7, 1, 2, 15, -6),
        k.ring(k.paint(TOY.red), 2.8, 1, -16, 16, 8.5, true),
      );
      for (let i = 0; i < 3; i++) boat.add(k.ball(k.paint(TOY.sky), 1.4, 0 + i * 2, 15.5, 6, 0.6));
      return k.group(water(k, 44), boat);
    },
    animate: (root, t) => {
      bob(root, t, 1);
      const b = part(root, "boom");
      if (b) b.rotation.y = 0.6 * Math.sin(t * 0.5);
    },
  },
  {
    id: "veh-submarine",
    name: "Submarine",
    category: "Vehicles",
    tags: ["submarine", "boat", "periscope", "sea", "water"],
    notes: "A yellow submarine riding half under the felt with a turning periscope and spinning propeller. It could pop up in the harbour as a surprise visitor.",
    build: (k) => {
      const periscope = pivot("periscope", 4, 22, 0, k.cyl(k.paint(TOY.grey), 1, 12, 0, 0, 0, 1, 10), k.cylX(k.paint(TOY.grey), 1.2, 5, 1.8, 12, 0, 10), k.cylX(k.glass, 1.1, 0.8, 4.4, 12, 0, 10));
      const prop = pivot("prop", -41, 4, 0, k.cylX(k.paint(TOY.red), 1.5, 3, 0, 0, 0, 10), k.box(k.paint(TOY.red), 1, 12, 3, 0.4, 0, -6, 0), k.box(k.paint(TOY.red), 1, 3, 12, 0.4, 0, -1.5, 0));
      const boat = pivot(
        "boat",
        0,
        0,
        0,
        latheX(k, k.paint(TOY.yellow), [
          [0, 0],
          [4, 1],
          [8, 6],
          [10, 16],
          [10, 56],
          [8, 70],
          [4, 78],
          [0, 80],
        ], -40, 4),
        k.box(k.paint(TOY.yellow), 16, 13, 8, 3, 2, 10),
        k.extrude(k.paint(TOY.yellow), [
          [0, 0],
          [6, 0],
          [0, 9],
        ], 1.6, -38, 6, 0, 0.4),
        k.box(k.paint(TOY.yellow), 4, 1.6, 22, 0.6, -36, 3.2),
        k.box(k.paint(TOY.yellow), 5, 1.4, 18, 0.6, 2, 18),
        periscope,
        prop,
      );
      for (const x of [-20, -8, 16, 28]) for (const s of [-1, 1]) boat.add(k.cylZ(k.glass, 2, 1, x, 7, s * 9.4, 12));
      return k.group(water(k, 50), boat);
    },
    animate: (root, t) => {
      bob(root, t, 0.8);
      const p = part(root, "periscope");
      const pr = part(root, "prop");
      if (p) p.rotation.y = t * 0.6;
      if (pr) pr.rotation.x = t * 8;
    },
  },

  // ——— In the air ———
  {
    id: "veh-seaplane",
    name: "Seaplane",
    category: "Vehicles",
    tags: ["seaplane", "plane", "floats", "propeller", "water", "air"],
    notes: "A red high-wing seaplane on twin floats with a spinning propeller. It could land on the lake to drop mail where the railway doesn't reach.",
    build: (k) => {
      const float = (z: number): Mesh =>
        latheX(k, k.paint(TOY.white), [
          [0, 0],
          [3, 2],
          [4, 8],
          [4, 30],
          [2.5, 40],
          [0, 44],
        ], -24, 4.5, z, 14);
      const boat = pivot(
        "boat",
        0,
        0,
        0,
        float(-13),
        float(13),
        latheX(k, k.paint(TOY.red), [
          [0, 0],
          [2, 2],
          [5, 20],
          [7, 40],
          [7, 50],
          [5, 56],
        ], -32, 20, 0, 18),
        k.ball(k.glass, 5.5, 14, 25, 0, 0.8),
        plan(k, k.paint(TOY.yellow), [
          [-8, -42],
          [8, -42],
          [8, 42],
          [-8, 42],
        ], 2.4, 27, 10, 0, 1),
        plan(k, k.paint(TOY.yellow), [
          [-5, -14],
          [4, -14],
          [4, 14],
          [-5, 14],
        ], 1.6, 21, -29, 0, 0.6),
        k.extrude(k.paint(TOY.red), [
          [0, 0],
          [10, 0],
          [3, 13],
          [-1, 13],
        ], 1.6, -32, 22, 0, 0.5),
        propeller(k, 25, 20, 0, 9),
      );
      for (const z of [-13, 13]) {
        boat.add(rod(k, k.paint(TOY.grey), 6, 7, 8, 20, 0.8, z * 0.8));
        boat.add(rod(k, k.paint(TOY.grey), -8, 7, -6, 20, 0.8, z * 0.8));
        boat.add(rod(k, k.paint(TOY.grey), 8, 20, 10, 27, 0.8, z * 1.6));
      }
      return k.group(water(k, 50), boat);
    },
    animate: (root, t) => {
      bob(root, t, 0.7);
      const p = part(root, "prop");
      if (p) p.rotation.x = t * 18;
    },
  },
  {
    id: "veh-propeller-plane",
    name: "Propeller plane",
    category: "Vehicles",
    tags: ["plane", "aeroplane", "propeller", "airport", "air"],
    notes: "A blue low-wing plane on fat wheels with a spinning propeller. An airfield beside the line could swap passengers with an airport shuttle train.",
    build: (k) => {
      const g = k.group(
        latheX(k, k.paint(TOY.blue), [
          [0, 0],
          [2, 2],
          [5, 18],
          [8, 42],
          [8, 54],
          [6, 62],
        ], -34, 16, 0, 20),
        k.ball(k.glass, 5.5, 10, 22, 0, 0.8),
        plan(k, k.paint(TOY.white), [
          [-10, -46],
          [6, -46],
          [12, 0],
          [6, 46],
          [-10, 46],
        ], 2.6, 9, 6, 0, 1),
        plan(k, k.paint(TOY.white), [
          [-5, -16],
          [4, -16],
          [4, 16],
          [-5, 16],
        ], 1.6, 17, -30, 0, 0.6),
        k.extrude(k.paint(TOY.red), [
          [0, 0],
          [11, 0],
          [3, 14],
          [-2, 14],
        ], 1.6, -35, 18, 0, 0.5),
        propeller(k, 29, 16, 0, 10),
        rod(k, k.paint(TOY.grey), 8, 4.5, 8, 10, 0.9, -12),
        rod(k, k.paint(TOY.grey), 8, 4.5, 8, 10, 0.9, 12),
        roadWheel(k, 8, -12, 4.5, TOY.red, 3.5),
        roadWheel(k, 8, 12, 4.5, TOY.red, 3.5),
        rod(k, k.paint(TOY.grey), -30, 2.5, -30, 14, 0.7),
        roadWheel(k, -30, 0, 2.5, TOY.red, 2),
      );
      for (const z of [-40, 40]) g.add(k.box(k.paint(TOY.red), 14, 2.8, 6, 1, 4, 9, z));
      return g;
    },
    animate: (root, t) => {
      const p = part(root, "prop");
      if (p) p.rotation.x = t * 20;
    },
  },
  {
    id: "veh-helicopter",
    name: "Helicopter",
    category: "Vehicles",
    tags: ["helicopter", "rotor", "rescue", "air"],
    notes: "An orange helicopter on skids with a spinning main rotor and tail rotor. A helipad on a hilltop could take rescue missions to places the trains can't reach.",
    build: (k) => {
      const o = k.paint(TOY.orange);
      const rotor = pivot("rotor", 0, 32, 0, k.cyl(k.paint(TOY.grey), 2.5, 3, 0, 0, 0, 2.5, 14), k.box(k.paint(TOY.black), 92, 1.2, 5, 0.5, 0, 2, 0), k.box(k.paint(TOY.black), 5, 1.2, 92, 0.5, 0, 2, 0));
      const tail = pivot("tailrotor", -50, 22, 2.5, k.cylZ(k.paint(TOY.grey), 1.5, 2, 0, 0, 0, 10), k.box(k.paint(TOY.black), 2, 16, 1, 0.4, 0, -8, 0.6));
      return k.group(
        k.ball(o, 14, 0, 18, 0, 0.85),
        k.ball(k.glass, 10, 6, 20, 0, 0.8),
        k.cyl(o, 3, 6, 0, 28, 0, 3, 14),
        latheX(k, o, [
          [2, 0],
          [3, 10],
          [5, 30],
          [7, 40],
        ], -52, 21, 0, 14),
        k.extrude(o, [
          [0, 0],
          [8, 0],
          [2, 12],
          [-2, 12],
        ], 1.6, -52, 20, 0, 0.5),
        tail,
        k.box(k.paint(TOY.white), 22, 2, 28.4, 0.6, -2, 16),
        k.cylX(k.paint(TOY.grey), 1.4, 40, 0, 1.4, -11, 10),
        k.cylX(k.paint(TOY.grey), 1.4, 40, 0, 1.4, 11, 10),
        rod(k, k.paint(TOY.grey), -8, 1.4, -6, 8, 0.8, -10),
        rod(k, k.paint(TOY.grey), 8, 1.4, 6, 8, 0.8, -10),
        rod(k, k.paint(TOY.grey), -8, 1.4, -6, 8, 0.8, 10),
        rod(k, k.paint(TOY.grey), 8, 1.4, 6, 8, 0.8, 10),
        rotor,
      );
    },
    animate: (root, t) => {
      const r = part(root, "rotor");
      const tr = part(root, "tailrotor");
      if (r) r.rotation.y = t * 12;
      if (tr) tr.rotation.z = t * 20;
    },
  },
  {
    id: "veh-hot-air-balloon",
    name: "Hot air balloon",
    category: "Vehicles",
    tags: ["balloon", "hot air", "basket", "sky", "air"],
    notes: "A striped balloon with a wicker basket that rises and settles on its launch field, its burner flaring. It could float over the layout at a summer fair, viewed from a scenic line.",
    build: (k) => {
      const profile: Pt[] = [
        [4, 0],
        [10, 6],
        [20, 18],
        [27, 32],
        [29, 42],
        [27, 52],
        [20, 60],
        [10, 65],
        [0, 66],
      ];
      const colours = [TOY.red, TOY.yellow, TOY.blue, TOY.yellow, TOY.red, TOY.yellow, TOY.blue, TOY.red];
      const balloon = pivot(
        "balloon",
        0,
        0,
        0,
        k.box(k.paint("#c9a36b"), 14, 11, 14, 2, 0, 1.2),
        k.box(k.paint(TOY.brown), 15, 1.6, 15, 0.6, 0, 11),
        k.peg(TOY.green, TOY.red, -3, 3, -2),
        k.cyl(k.paint(TOY.grey), 3, 4, 0, 22, 0, 3, 12),
      );
      const flame = k.cone(k.paint(TOY.orange), 2.2, 6, 0, 26, 0, 12);
      flame.name = "flame";
      balloon.add(flame);
      for (const [x, z] of [
        [-6, -6],
        [6, -6],
        [-6, 6],
        [6, 6],
      ]) {
        const r1 = rod(k, k.paint(TOY.brown), 0, 12, 0, 31, 0.5);
        r1.position.set(x, 21.5, z);
        r1.rotation.set(-z * 0.03, 0, x * 0.03);
        balloon.add(r1);
      }
      for (let i = 0; i < profile.length - 1; i++) {
        balloon.add(k.lathe(k.paint(colours[i]), [profile[i], profile[i + 1]], 0, 30, 0, 28));
      }
      return k.group(k.feltDisc(30), balloon);
    },
    animate: (root, t) => {
      const b = part(root, "balloon");
      if (b) {
        b.position.y = (0.5 - 0.5 * Math.cos(t * 0.4)) * 30;
        b.rotation.y = t * 0.1;
      }
      blink(root, "flame", t, 5);
    },
  },
  {
    id: "veh-airship",
    name: "Airship",
    category: "Vehicles",
    tags: ["airship", "blimp", "mooring mast", "air"],
    notes: "A cream airship tethered nose-first to a mooring mast, its gondola propellers turning as it swings in the breeze. A mast beside the station could make it a sky-rail interchange.",
    build: (k) => {
      const c = k.paint(TOY.cream);
      const ship = pivot(
        "ship",
        64,
        66,
        0,
        latheX(k, c, [
          [0, 0],
          [9, 6],
          [15, 22],
          [16, 46],
          [14, 74],
          [9, 96],
          [3, 110],
          [0, 112],
        ], -114, 0, 0, 28),
        k.cylX(k.paint(TOY.red), 16.2, 4, -62, 0, 0, 28),
        k.box(k.paint(TOY.blue), 26, 8, 10, 3, -54, -24, 0),
        glass(k, 22, 3, 10.6, -52, -20),
        rod(k, k.paint(TOY.grey), -60, -16, -60, -13, 0.8),
      );
      for (const a of [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2]) {
        const fin = new Group();
        fin.rotation.x = a;
        fin.position.x = -104;
        fin.add(
          k.extrude(k.paint(TOY.red), [
            [0, 6],
            [16, 10],
            [12, 22],
            [0, 22],
          ], 1.6, 0, 0, 0, 0.5),
        );
        ship.add(fin);
      }
      for (const z of [-8, 8]) {
        ship.add(k.box(k.paint(TOY.grey), 4, 1.2, 4, 0.4, -64, -18, z * 0.7));
        ship.add(pivot("prop", -69, -16, z, k.box(k.wood, 1, 10, 2.4, 0.4, 0, -5, 0)));
      }
      return k.group(
        k.cyl(k.paint(TOY.grey), 12, 3, 64, 0, 0, 10, 20),
        k.cyl(k.paint(TOY.red), 2.5, 60, 64, 3, 0, 2, 12),
        k.ball(k.paint(TOY.red), 3.5, 64, 64, 0),
        k.box(k.paint(TOY.grey), 8, 2, 8, 0.6, 64, 40),
        ship,
      );
    },
    animate: (root, t) => {
      const s = part(root, "ship");
      if (s) {
        s.rotation.y = Math.sin(t * 0.25) * 0.4;
        s.rotation.z = Math.sin(t * 0.4) * 0.03;
      }
      for (const p of parts(root, "prop")) p.rotation.x = t * 14;
    },
  },
  {
    id: "veh-rocket-pad",
    name: "Rocket on launch pad",
    category: "Vehicles",
    tags: ["rocket", "space", "launch", "gantry", "pad"],
    notes: "A white and red rocket on a pad beside a gantry tower whose arm swings away; its engine flame flickers. A space centre at the end of a branch line could need fuel tanker trains before launch day.",
    build: (k) => {
      const w = k.paint(TOY.white);
      const flame = pivot("flame", 0, 9, 0);
      const f = k.cone(k.paint(TOY.orange), 5, 10, 0, -10, 0, 16);
      f.rotation.x = Math.PI;
      f.position.y = -4;
      flame.add(f);
      const f2 = k.cone(k.paint(TOY.yellow), 3, 6, 0, -6, 0, 12);
      f2.rotation.x = Math.PI;
      f2.position.y = -3;
      flame.add(f2);
      const rocket = k.group(
        k.lathe(w, [
          [0, 0],
          [6, 0],
          [9, 6],
          [9, 70],
          [8, 80],
          [5, 90],
          [0, 98],
        ], 0, 12, 0, 28),
        k.cyl(k.paint(TOY.red), 9.2, 4, 0, 30, 0, 9.2, 28),
        k.cyl(k.paint(TOY.red), 9.2, 4, 0, 56, 0, 9.2, 28),
        k.cyl(k.paint(TOY.black), 5, 4, 0, 9, 0, 3, 16),
        k.cylZ(k.glass, 2.5, 1, 0, 76, 8.6, 14),
        flame,
      );
      for (let i = 0; i < 4; i++) {
        const fin = new Group();
        fin.rotation.y = (i * Math.PI) / 2;
        fin.add(
          k.extrude(k.paint(TOY.red), [
            [0, 0],
            [8, -6],
            [8, 4],
            [0, 18],
          ], 1.6, 8, 12, 0, 0.5),
        );
        rocket.add(fin);
      }
      const arm = pivot("arm", -24, 74, 0, k.box(k.paint(TOY.orange), 16, 3, 4, 1, 8, -1.5, 0));
      const g = k.group(k.box(k.paint(TOY.grey), 70, 6, 60, 2, 0, 0), k.box(k.cut, 16, 0.6, 16, 0, 0, 5.8), rocket, arm);
      for (const [x, z] of [
        [-30, -4],
        [-30, 4],
        [-22, -4],
        [-22, 4],
      ]) g.add(k.box(k.paint(TOY.orange), 2, 84, 2, 0.5, x, 6, z));
      for (let i = 0; i < 6; i++) g.add(k.box(k.paint(TOY.orange), 10, 1.6, 10, 0.4, -26, 14 + i * 14, 0));
      g.add(k.box(k.paint(TOY.red), 12, 2, 12, 0.6, -26, 90, 0));
      return g;
    },
    animate: (root, t) => {
      const a = part(root, "arm");
      const f = part(root, "flame");
      if (a) a.rotation.y = Math.max(0, Math.sin(t * 0.4)) * 1.4;
      if (f) {
        f.scale.y = 0.8 + 0.3 * Math.abs(Math.sin(t * 23));
        f.visible = Math.sin(t * 0.4) > 0.3;
      }
    },
  },
  {
    id: "veh-space-shuttle",
    name: "Space shuttle on transporter",
    category: "Vehicles",
    tags: ["shuttle", "space", "orbiter", "transporter", "bay doors"],
    notes: "A winged orbiter riding on a low wheeled transporter, its cargo-bay doors opening. A special flat wagon could carry it from the factory to the launch pad.",
    build: (k) => {
      const w = k.paint(TOY.white);
      const doorL = pivot("doorL", 0, 34, -7, k.box(w, 32, 1.2, 7.4, 0.4, -8, 0, 3.7));
      const doorR = pivot("doorR", 0, 34, 7, k.box(w, 32, 1.2, 7.4, 0.4, -8, 0, -3.7));
      const shuttle = k.group(
        k.box(w, 56, 14, 16, 4, -8, 20),
        k.box(k.paint(TOY.black), 54, 2, 16.4, 1, -8, 19.5),
        latheX(k, w, [
          [8, 0],
          [7.5, 8],
          [5, 16],
          [0, 20],
        ], 19, 27, 0, 20),
        k.box(k.cut, 30, 0.4, 13, 0, -8, 33.8),
        k.ball(k.paint(TOY.black), 4, 31, 31, 0, 0.6),
        plan(k, w, [
          [-36, -30],
          [-14, -30],
          [16, -8],
          [16, 8],
          [-14, 30],
          [-36, 30],
        ], 2.4, 20, 0, 0, 0.8),
        k.extrude(w, [
          [0, 0],
          [16, 0],
          [6, 22],
          [0, 22],
        ], 2, -36, 33, 0, 0.6),
        doorL,
        doorR,
      );
      for (const [y, z] of [
        [30, 0],
        [24, -4.5],
        [24, 4.5],
      ]) shuttle.add(latheX(k, k.paint(TOY.grey), [
        [2, 0],
        [3.6, 6],
      ], -42, y, z, 14));
      const trailer = k.group(k.box(k.paint(TOY.yellow), 80, 6, 30, 2, -6, 8), k.box(k.paint(TOY.grey), 8, 6, 8, 1, -18, 14), k.box(k.paint(TOY.grey), 8, 6, 8, 1, 6, 14), wheelSet(k, [-36, -22, 10, 24], 13, 5.5));
      return k.group(trailer, shuttle);
    },
    animate: (root, t) => {
      const a = Math.max(0, Math.sin(t * 0.5)) * 1.9;
      const l = part(root, "doorL");
      const r = part(root, "doorR");
      if (l) l.rotation.x = -a;
      if (r) r.rotation.x = a;
    },
  },
];

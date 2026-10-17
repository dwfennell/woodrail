import { Group, Shape, type Material, type Mesh, type Object3D } from "three";
import { TOY, type Kit } from "../kit";
import type { Asset } from "../types";

/** Working mechanisms (cranes, signals, crossings, turntables) and bridges & tunnels. */

const STONE = "#b9b2a6";
const DARK_STONE = "#8f877b";
const RUST = "#a4512f";
const LIT_RED = "#ff4a2e";
const LIT_GREEN = "#4dff7a";
const LIT_AMBER = "#ffc23a";
/** Deck height of raised bridges: the slab's base, so its top sits at a hill block's 64. */
const DECK = 52;

// ——— Local helpers ———

function named<T extends Object3D>(o: T, name: string): T {
  o.name = name;
  return o;
}

/** An empty, named group at (x, y, z) holding `parts`: the thing `animate` turns or moves. */
function pivot(name: string, x: number, y: number, z: number, ...parts: Object3D[]): Group {
  const g = new Group();
  g.name = name;
  g.position.set(x, y, z);
  for (const p of parts) g.add(p);
  return g;
}

/** Find a named part once, then remember it on the root (animate runs every frame). */
function part(root: Object3D, name: string): Object3D {
  const cache = (root.userData.parts ??= {}) as Record<string, Object3D>;
  let o = cache[name];
  if (!o) {
    const found = root.getObjectByName(name);
    if (!found) throw new Error(`no part ${name}`);
    o = cache[name] = found;
  }
  return o;
}

/** A square beam from (x1, y1) to (x2, y2) in the x/y plane at `z`; `t` thick, `tz` deep. */
function strut(k: Kit, mat: Material, x1: number, y1: number, x2: number, y2: number, z = 0, t = 3, tz = t): Mesh {
  const len = Math.hypot(x2 - x1, y2 - y1);
  const m = k.box(mat, len, t, tz, Math.min(1, t / 3), (x1 + x2) / 2, (y1 + y2) / 2 - t / 2, z);
  m.rotation.z = Math.atan2(y2 - y1, x2 - x1);
  return m;
}

/** A beam from (z1, y1) to (z2, y2) in the z/y plane at `x`; `tx` wide along x. */
function strutZ(k: Kit, mat: Material, z1: number, y1: number, z2: number, y2: number, x = 0, t = 3, tx = t): Group {
  return k.at(k.group(strut(k, mat, -z1, y1, -z2, y2, 0, t, tx)), x, 0, 0, Math.PI / 2);
}

function ease(u: number): number {
  return u * u * (3 - 2 * u);
}

/** 0 → 1 → 0 over `period` seconds, holding at each end. */
function cycle(t: number, period: number): number {
  const p = (((t / period) % 1) + 1) % 1;
  if (p < 0.15) return 0;
  if (p < 0.35) return ease((p - 0.15) / 0.2);
  if (p < 0.65) return 1;
  if (p < 0.85) return 1 - ease((p - 0.65) / 0.2);
  return 0;
}

/** A wall `len` long (along x) and `h` high with arches [centre x, radius, springing height] cut from its foot. */
function archShape(len: number, h: number, arches: readonly [number, number, number][]): Shape {
  const s = new Shape();
  s.moveTo(-len / 2, 0);
  for (const [cx, r, sy] of arches) {
    s.lineTo(cx - r, 0);
    s.lineTo(cx - r, sy);
    s.absarc(cx, sy, r, Math.PI, 0, true);
    s.lineTo(cx + r, 0);
  }
  s.lineTo(len / 2, 0);
  s.lineTo(len / 2, h);
  s.lineTo(-len / 2, h);
  return s;
}

/** A rounded hill's cross-section `w` wide and `h` high with tunnel arches [centre, radius, springing] at its foot. */
function hillShape(w: number, h: number, arches: readonly [number, number, number][]): Shape {
  const s = new Shape();
  s.moveTo(-w / 2, 0);
  for (const [cx, r, sy] of arches) {
    s.lineTo(cx - r, 0);
    s.lineTo(cx - r, sy);
    s.absarc(cx, sy, r, Math.PI, 0, true);
    s.lineTo(cx + r, 0);
  }
  s.lineTo(w / 2, 0);
  s.bezierCurveTo(w / 2, h * 0.7, w * 0.22, h, 0, h);
  s.bezierCurveTo(-w * 0.22, h, -w / 2, h * 0.7, -w / 2, 0);
  return s;
}

/** An outline drawn across the track (x = z across, y up), run `length` along the track, centred at `x`. */
function alongTrack(k: Kit, mat: Material, shape: Shape, length: number, x = 0, bevel = 1.5): Mesh {
  const m = k.extrude(mat, shape, length, 0, 0, 0, bevel);
  m.rotation.y = Math.PI / 2;
  m.position.x = x;
  return m;
}

/** A red-and-white striped boom along +x, `len` long, `t` thick, from its pivot. */
function stripedBoom(k: Kit, len: number, t = 3.5): Group {
  const g = new Group();
  const n = 6;
  const seg = len / n;
  for (let i = 0; i < n; i++) g.add(k.box(k.paint(i % 2 ? TOY.white : TOY.red), seg + 0.2, t, t, 1, seg * (i + 0.5), -t / 2, 0));
  return g;
}

/** A crate of `w` with banding. */
function crate(k: Kit, w: number, x = 0, y = 0, z = 0, color: string = TOY.orange): Group {
  return k.group(
    k.box(k.paint(color), w, w * 0.8, w, 1.2, x, y, z),
    k.box(k.wood, w + 0.6, 1.4, w + 0.6, 0.4, x, y + w * 0.15, z),
    k.box(k.wood, w + 0.6, 1.4, w + 0.6, 0.4, x, y + w * 0.6, z),
  );
}

/** A little heap of coal lumps around (x, y, z). */
function coalHeap(k: Kit, r: number, x = 0, y = 0, z = 0): Group {
  const g = new Group();
  g.add(k.cone(k.coal, r, r * 0.55, x, y, z, 14));
  for (let i = 0; i < 6; i++) {
    const a = i * 1.07;
    g.add(k.ball(k.coal, r * 0.22, x + Math.cos(a) * r * 0.55, y + r * 0.12, z + Math.sin(a) * r * 0.55));
  }
  return g;
}

/** A stone pier `w` (x) × `d` (z) up to `h`, with a cap. */
function pier(k: Kit, w: number, h: number, d: number, x = 0, z = 0): Group {
  return k.group(k.box(k.paint(STONE), w, h - 4, d, 2, x, 0, z), k.box(k.paint(DARK_STONE), w + 4, 4, d + 4, 1, x, h - 4, z));
}

/**
 * A strip of river felt along z under a bridge, for showing it off. It's an `underlay`: left out when the bridge is
 * placed in the game, where it stands over the map's own river (or none).
 */
function river(k: Kit, w: number, len: number, x = 0): Mesh {
  const m = k.box(k.water, w, 1.2, len, 0.5, x, 0, 0);
  m.userData.underlay = true;
  return m;
}

/** A signal lamp: dark housing with a lit lens named `name` (shown when lit) and a dull lens behind it. */
function lens(k: Kit, lit: string, name: string, x: number, y: number, z: number, r = 2.6): Group {
  return k.group(k.ball(k.paint(TOY.black), r * 0.95, x, y, z), named(k.ball(k.paint(lit), r, x + 0.6, y, z), name));
}

// ——— Mechanisms ———

const mechanisms: Asset[] = [
  {
    id: "mech-gantry-crane",
    name: "Gantry crane",
    category: "Mechanisms",
    tags: ["crane", "container", "freight", "yard", "gantry"],
    notes: "A rolling yellow gantry that straddles the line and lifts containers on and off flat wagons. A freight yard could ask the player to stop a flat wagon exactly under the trolley.",
    build: (k) => {
      const y = k.paint(TOY.yellow);
      // Over a 216 straight (the game's kit piece, kit-gantry-crane).
      const g = k.group(k.trackSlab(216));
      for (const z of [-58, 58]) {
        g.add(k.box(y, 76, 8, 10, 2, 0, 4, z));
        for (const x of [-30, 30]) g.add(k.wheel(5, x, 5, z + Math.sign(z) * 7));
        for (const x of [-30, 30]) g.add(strut(k, y, x, 12, x * 0.27, 112, z, 7, 7));
        g.add(k.box(y, 30, 8, 8, 2, 0, 104, z));
      }
      for (const x of [-9, 9]) g.add(k.box(y, 7, 9, 134, 2, x, 112, 0));
      // Driver's cab under one end.
      g.add(k.box(k.paint(TOY.red), 16, 16, 16, 2, 0, 88, 46));
      g.add(k.box(k.glass, 16.4, 6, 10, 1, 0, 95, 46));
      const cable = pivot("cable", 0, 0, 0, k.cyl(k.metal, 0.7, 1, -6, -1, 0, 0.7, 8), k.cyl(k.metal, 0.7, 1, 6, -1, 0, 0.7, 8));
      const hook = pivot(
        "hook",
        0,
        -50,
        0,
        k.box(k.paint(TOY.black), 50, 4, 22, 1, 0, -4, 0),
        k.box(k.paint(TOY.blue), 60, 24, 24, 2, 0, -28, 0),
        k.many(5, (i) => k.box(k.paint("#245a99"), 2, 24.4, 24.4, 0.5, -24 + i * 12, -28, 0)),
      );
      g.add(pivot("trolley", 0, 121, 0, k.box(k.paint(TOY.red), 26, 10, 22, 2), k.cylZ(k.metal, 3, 24, 0, 5, 0, 12), cable, hook));
      return g;
    },
    animate: (root, t) => {
      part(root, "trolley").position.z = Math.sin(t * 0.5) * 40;
      const len = 50 + 18 * Math.sin(t * 1.1);
      part(root, "cable").scale.y = len;
      part(root, "hook").position.y = -len;
    },
  },
  {
    id: "mech-harbour-crane",
    name: "Harbour crane",
    category: "Mechanisms",
    tags: ["crane", "harbour", "dock", "port", "slewing"],
    notes: "A tall portal crane on four legs over the dockside line, its long jib slewing round to swing crates from ships to wagons. Pairs with a quay piece: boats bring cargo, trains take it inland.",
    build: (k) => {
      const red = k.paint(TOY.red);
      // Over a 162 straight (the game's kit piece, kit-harbour-crane).
      const g = k.group(k.trackSlab(162));
      for (const x of [-24, 24]) for (const z of [-27, 27]) g.add(k.box(red, 8, 60, 8, 2, x, 0, z));
      for (const z of [-27, 27]) g.add(k.box(red, 56, 6, 8, 2, 0, 50, z));
      g.add(k.box(k.paint(TOY.black), 62, 6, 62, 2, 0, 60, 0));
      const slew = pivot(
        "slew",
        0,
        66,
        0,
        k.cyl(k.wood, 18, 4, 0, 0, 0, 18, 24),
        k.box(k.paint(TOY.cream), 36, 26, 28, 3, -4, 4, 0),
        k.box(k.glass, 6, 9, 22, 1, 14, 16, 0),
        k.roof(red, 40, 30, 8, -4, 30, 0),
        k.box(k.paint(TOY.grey), 14, 20, 26, 2, -28, 4, 0),
        strut(k, red, -10, 38, 6, 70, 0, 5),
        strut(k, k.metal, 6, 70, 118, 80, 0, 1.2),
        strut(k, red, 10, 14, 120, 80, -5, 5),
        strut(k, red, 10, 14, 120, 80, 5, 5),
        k.many(6, (i) => strut(k, red, 26 + i * 16, 23.5 + i * 9.5, 34 + i * 16, 28 + i * 9.5, 0, 2, 12)),
        k.cylZ(k.metal, 3.5, 14, 120, 80, 0, 12),
        k.cyl(k.metal, 0.7, 48, 120, 32, 0, 0.7, 8),
        k.box(k.paint(TOY.black), 8, 5, 8, 1, 120, 27, 0),
        crate(k, 18, 120, 6, 0, TOY.green),
      );
      g.add(slew);
      return g;
    },
    animate: (root, t) => {
      part(root, "slew").rotation.y = Math.sin(t * 0.35) * 1.4;
    },
  },
  {
    id: "mech-magnet-crane",
    name: "Magnet crane",
    category: "Mechanisms",
    tags: ["crane", "magnet", "scrap", "yard", "metal"],
    notes: "A scrapyard crane whose round electromagnet picks up iron. In Woodrail it could pick up anything with a magnet coupler: lift a wagon off one line and set it on another.",
    build: (k) => {
      const g = k.group(k.feltDisc(60, k.road));
      g.add(k.cyl(k.paint(TOY.blue), 9, 84, 0, 1, 0, 6, 20));
      for (let i = 0; i < 5; i++) g.add(k.box(k.paint(RUST), 10 - i, 3, 7, 0.6, 30 + i * 3, 1 + i * 3, -24 + (i % 2) * 4));
      const cable = pivot("cable", 0, 0, 0, k.cyl(k.metal, 0.7, 1, 0, -1, 0, 0.7, 8));
      const magnet = pivot(
        "magnet",
        0,
        -30,
        0,
        k.cyl(k.paint(TOY.black), 14, 8, 0, -8, 0, 14, 24),
        k.cyl(k.metal, 12, 1.2, 0, -9, 0, 12, 24),
        k.box(k.paint(RUST), 16, 4, 6, 1, 0, -13, 0),
      );
      const slew = pivot(
        "slew",
        0,
        85,
        0,
        k.cyl(k.wood, 10, 4),
        k.box(k.paint(TOY.yellow), 20, 18, 18, 3, -6, 4, 0),
        k.box(k.glass, 4, 7, 14, 1, 4, 12, 0),
        k.box(k.paint(TOY.grey), 12, 12, 16, 2, -20, 4, 0),
        k.box(k.paint(TOY.yellow), 86, 6, 7, 2, 40, 10, 0),
        k.cylZ(k.metal, 3, 10, 80, 10, 0, 12),
        pivot("lift", 80, 10, 0, cable, magnet),
      );
      g.add(slew);
      return g;
    },
    animate: (root, t) => {
      part(root, "slew").rotation.y = Math.sin(t * 0.5) * 0.9;
      const len = 30 + 22 * (0.5 + 0.5 * Math.sin(t * 1.1));
      part(root, "cable").scale.y = len;
      part(root, "magnet").position.y = -len;
    },
  },
  {
    id: "mech-turntable",
    name: "Locomotive turntable",
    category: "Mechanisms",
    tags: ["turntable", "rotate", "depot", "engine shed", "turn"],
    notes: "A round pit with a turning deck that lines an engine up with any of its radiating tracks, a quarter or eighth turn at a time. It would turn trains around in a tight space, or feed the stalls of a roundhouse.",
    build: (k) => {
      const g = k.group(k.cyl(k.cut, 92, 4, 0, 0, 0, 92, 48), k.ring(k.wood, 92, 3, 0, 4, 0), k.ring(k.metal, 82, 1.2, 0, 4.2, 0));
      for (const a of [0, Math.PI / 4, -Math.PI / 4, Math.PI]) g.add(k.trackSlab(50, Math.cos(a) * 118, 0, -Math.sin(a) * 118).rotateY(a));
      g.add(
        pivot(
          "deck",
          0,
          0,
          0,
          k.trackSlab(174, 0, 4, 0),
          k.cyl(k.paint(TOY.red), 8, 18, 0, 0, 0, 8, 20),
          k.many(2, (i) => k.cylZ(k.paint(TOY.black), 4, 44, i ? 84 : -84, 5, 0, 14)),
          k.many(2, (i) => k.box(k.paint(TOY.red), 3, 14, 3, 1, i ? 70 : -70, 16, i ? 22 : -22)),
          k.many(2, (i) => k.box(k.paint(TOY.red), 30, 3, 3, 1, i ? 70 : -70, 30, i ? 22 : -22)),
          k.peg(TOY.blue, TOY.black, 76, 16, -22),
        ),
      );
      return g;
    },
    animate: (root, t) => {
      const phase = t * 0.25;
      const whole = Math.floor(phase);
      const f = phase - whole;
      part(root, "deck").rotation.y = (whole + (f < 0.5 ? 0 : ease(f * 2 - 1))) * (Math.PI / 4);
    },
  },
  {
    id: "mech-transfer-table",
    name: "Transfer table",
    category: "Mechanisms",
    tags: ["traverser", "transfer", "shed", "sideways", "yard"],
    notes: "A traverser: a short deck that slides sideways in a pit, moving a car from one parallel track to the next. A compact alternative to points in a crowded works yard.",
    build: (k) => {
      const g = k.group(k.box(k.cut, 120, 4, 200, 1), k.box(k.wood, 124, 2, 4, 0.5, 0, 2, 100), k.box(k.wood, 124, 2, 4, 0.5, 0, 2, -100));
      for (const x of [-40, 40]) g.add(k.box(k.metal, 3, 1.5, 196, 0.5, x, 4, 0));
      for (const z of [-60, 0, 60]) {
        g.add(k.trackSlab(50, -86, 0, z));
        g.add(k.trackSlab(50, 86, 0, z));
      }
      g.add(
        pivot(
          "deck",
          0,
          0,
          0,
          k.box(k.paint(TOY.blue), 112, 6, 48, 2, 0, 0, 0),
          k.trackSlab(118, 0, 5, 0),
          k.many(4, (i) => k.cylX(k.paint(TOY.red), 4, 6, i < 2 ? -40 : 40, 4, i % 2 ? 18 : -18, 14)),
          k.box(k.paint(TOY.yellow), 14, 18, 12, 2, 50, 17, 26),
          k.peg(TOY.orange, TOY.yellow, 36, 17, 30),
        ),
      );
      return g;
    },
    animate: (root, t) => {
      const p = (t * 0.2) % 4;
      const stop = [-60, 0, 60, 0][Math.floor(p)];
      const next = [0, 60, 0, -60][Math.floor(p)];
      const f = p % 1;
      part(root, "deck").position.z = f < 0.5 ? stop : stop + (next - stop) * ease(f * 2 - 1);
    },
  },
  {
    id: "mech-coal-chute",
    name: "Coal chute",
    category: "Mechanisms",
    tags: ["coal", "chute", "bunker", "loading", "hopper"],
    notes: "A timber coal bunker on stilts with a hinged chute that drops down over the line. Park a hopper underneath and the chute tips to fill it: a mine could produce coal that towns want delivered.",
    build: (k) => {
      // Beside a 108 straight (the game's kit piece, kit-coal-chute).
      const g = k.group(k.trackSlab(108));
      for (const x of [-26, 26]) for (const z of [-34, -70]) g.add(k.box(k.wood, 6, 70, 6, 1.5, x, 0, z));
      g.add(strut(k, k.wood, -26, 10, 26, 60, -34, 3), strut(k, k.wood, -26, 60, 26, 10, -70, 3));
      g.add(k.box(k.paint(TOY.black), 64, 34, 46, 3, 0, 70, -52));
      g.add(k.box(k.paint(TOY.red), 66, 4, 48, 1.5, 0, 102, -52));
      g.add(coalHeap(k, 22, 0, 104, -52));
      g.add(k.box(k.paint(TOY.white), 26, 9, 1.4, 0.5, 0, 82, -28.4));
      const chute = pivot(
        "chute",
        0,
        76,
        -30,
        k.box(k.paint(TOY.grey), 18, 2.5, 40, 1, 0, 0, 20),
        k.box(k.paint(TOY.grey), 2, 7, 40, 0.8, -9, 0, 20),
        k.box(k.paint(TOY.grey), 2, 7, 40, 0.8, 9, 0, 20),
        k.ball(k.coal, 3, -2, 4, 30),
        k.ball(k.coal, 2.6, 3, 4, 22),
      );
      g.add(chute);
      g.add(k.cyl(k.metal, 0.6, 40, 0, 76, -6, 0.6, 6));
      return g;
    },
    animate: (root, t) => {
      part(root, "chute").rotation.x = 0.15 + 0.6 * cycle(t, 6);
    },
  },
  {
    id: "mech-grain-elevator",
    name: "Grain elevator",
    category: "Mechanisms",
    tags: ["grain", "silo", "farm", "elevator", "wheat"],
    notes: "A tall red elevator house with twin silos and a swinging spout that pours grain into wagons below. A farm line could ship grain at harvest to the mill in town.",
    build: (k) => {
      // Beside a 162 straight (the game's kit piece, kit-grain-elevator).
      const g = k.group(k.trackSlab(162));
      g.add(k.box(k.paint(TOY.red), 50, 150, 46, 3, -10, 0, -60));
      g.add(k.roof(k.paint(TOY.grey), 54, 50, 18, -10, 150, -60));
      for (let i = 0; i < 3; i++) g.add(k.box(k.paint(TOY.white), 10, 12, 1.4, 1, -10, 40 + i * 36, -36.6));
      for (const x of [34, 70]) {
        g.add(k.cyl(k.paint(TOY.cream), 17, 110, x, 0, -66, 17, 24));
        g.add(k.cone(k.paint(TOY.grey), 18, 12, x, 110, -66, 24));
        for (let i = 0; i < 4; i++) g.add(k.ring(k.paint(TOY.grey), 17.3, 0.8, x, 20 + i * 24, -66));
      }
      g.add(k.box(k.paint(TOY.white), 32, 10, 1.4, 1, -10, 125, -36.6));
      g.add(
        pivot(
          "spout",
          -10,
          100,
          -36,
          k.cylZ(k.metal, 4, 6, 0, 0, 2, 12),
          strutZ(k, k.paint(TOY.yellow), 0, 0, 44, -50, 0, 5),
          k.cone(k.paint(TOY.yellow), 4, 6, 0, -56, 44, 12),
        ),
      );
      return g;
    },
    animate: (root, t) => {
      part(root, "spout").rotation.y = Math.sin(t * 0.6) * 0.5;
    },
  },
  {
    id: "mech-log-loader",
    name: "Log loader",
    category: "Mechanisms",
    tags: ["timber", "logs", "forest", "crane", "loader"],
    notes: "A post crane by a log pile, its grab swinging trunks onto a timber wagon. Woodrail already has timber wagons: a forest siding with this loader gives them somewhere to fill up.",
    build: (k) => {
      // Beside a 162 straight (the game's kit piece, kit-log-loader).
      const g = k.group(k.trackSlab(162));
      for (let row = 0; row < 3; row++)
        for (let i = 0; i < 3 - row; i++) g.add(k.cylX(k.paint(TOY.brown), 5, 60, -20, 5 + row * 9, -48 + (i - (2 - row) / 2) * 10.5, 16));
      g.add(k.cyl(k.paint(TOY.green), 7, 76, 40, 0, -40, 5, 18));
      g.add(k.box(k.paint(TOY.green), 20, 6, 20, 2, 40, 0, -40));
      g.add(
        pivot(
          "boom",
          40,
          76,
          -40,
          k.cyl(k.wood, 7, 4),
          k.box(k.paint(TOY.yellow), 70, 6, 6, 2, -24, 4, 0),
          k.box(k.paint(TOY.grey), 14, 10, 10, 2, 8, 0, 0),
          k.cyl(k.metal, 0.7, 30, -54, -24, 0, 0.7, 8),
          k.box(k.paint(TOY.black), 10, 4, 14, 1, -54, -28, 0),
          k.box(k.paint(TOY.black), 3, 10, 3, 1, -54, -36, -6),
          k.box(k.paint(TOY.black), 3, 10, 3, 1, -54, -36, 6),
          k.cylX(k.paint(TOY.brown), 5, 56, -54, -31, 0, 16),
        ),
      );
      return g;
    },
    animate: (root, t) => {
      part(root, "boom").rotation.y = 0.9 + Math.sin(t * 0.5) * 0.9;
    },
  },
  {
    id: "mech-cargo-conveyor",
    name: "Cargo conveyor",
    category: "Mechanisms",
    tags: ["conveyor", "belt", "crates", "factory", "loading"],
    notes: "An inclined belt carrying crates up and over a line, tipping them into a wagon parked beneath. Factories could load parcels this way while the player shunts empties in and fulls out.",
    build: (k) => {
      // Its track runs along z at x 86, a 216 straight (the game's kit piece, kit-cargo-conveyor).
      const g = k.group(k.at(k.trackSlab(216), 86, 0, 0, Math.PI / 2));
      const belt = k.paint(TOY.black);
      g.add(strut(k, belt, -90, 14, 70, 72, 0, 4, 22));
      for (const z of [-12, 12]) g.add(strut(k, k.paint(TOY.blue), -90, 18, 70, 76, z, 3, 2));
      for (const [x, h] of [
        [-70, 18],
        [-10, 40],
        [50, 62],
      ])
        for (const z of [-10, 10]) g.add(k.box(k.paint(TOY.blue), 4, h, 4, 1, x, 0, z));
      g.add(k.cylZ(k.paint(TOY.red), 5, 24, -90, 12, 0, 16), k.cylZ(k.paint(TOY.red), 5, 24, 70, 70, 0, 16));
      g.add(k.box(k.paint(TOY.yellow), 26, 10, 26, 2, -100, 0, 30));
      for (let i = 0; i < 4; i++) g.add(named(crate(k, 12, 0, 0, 0, [TOY.orange, TOY.green, TOY.purple, TOY.teal][i]), `c${i}`));
      return g;
    },
    animate: (root, t) => {
      const angle = Math.atan2(58, 160);
      for (let i = 0; i < 4; i++) {
        const f = (t * 0.12 + i / 4) % 1;
        const c = part(root, `c${i}`);
        c.position.set(-86 + 152 * f, 16 + 55 * f, 0);
        c.rotation.z = angle;
      }
    },
  },
  {
    id: "mech-train-lift",
    name: "Train lift tower",
    category: "Mechanisms",
    tags: ["lift", "elevator", "vertical", "tower", "level"],
    notes: "A lift tower that carries a whole car up to a high-level track and back down. A space-saving way between ground level and a layer of hills, with a satisfying wait at the top.",
    build: (k) => {
      const g = k.group(k.trackSlab(80, -90, 0, 0));
      const blue = k.paint(TOY.blue);
      for (const x of [-46, 46]) for (const z of [-32, 32]) g.add(k.box(blue, 8, 200, 8, 2, x, 0, z));
      for (const z of [-32, 32]) {
        g.add(k.box(blue, 100, 8, 8, 2, 0, 200, z));
        for (let i = 0; i < 4; i++) g.add(strut(k, blue, -42, 20 + i * 44, 42, 60 + i * 44, z, 2.5));
        g.add(named(k.box(k.paint(TOY.grey), 12, 26, 6, 1.5, 0, 147, z * 1.18), z < 0 ? "cw0" : "cw1"));
      }
      g.add(k.box(blue, 8, 8, 72, 2, -46, 200, 0), k.box(blue, 8, 8, 72, 2, 46, 200, 0));
      g.add(named(k.cylZ(k.paint(TOY.red), 14, 6, 0, 214, 0, 16), "gear"));
      g.add(k.box(k.paint(TOY.yellow), 10, 8, 4, 1, 0, 210, 0));
      // The upper track, held up on a pier.
      g.add(pier(k, 30, 150, 40, 106, 0), k.trackSlab(80, 90, 150, 0));
      g.add(
        pivot(
          "lift",
          0,
          0,
          0,
          k.box(k.paint(TOY.yellow), 88, 4, 56, 1.5),
          k.trackSlab(88, 0, 4, 0),
          k.box(k.paint(TOY.yellow), 88, 3, 3, 1, 0, 28, -26),
          k.box(k.paint(TOY.yellow), 88, 3, 3, 1, 0, 28, 26),
          k.many(4, (i) => k.box(k.paint(TOY.yellow), 3, 26, 3, 1, i < 2 ? -42 : 42, 4, i % 2 ? 26 : -26)),
        ),
      );
      return g;
    },
    animate: (root, t) => {
      const f = cycle(t, 10);
      part(root, "lift").position.y = 146 * f;
      part(root, "cw0").position.y = 160 - 146 * f;
      part(root, "cw1").position.y = 160 - 146 * f;
      part(root, "gear").rotation.z = f * 9;
    },
  },
  {
    id: "mech-train-wash",
    name: "Train wash",
    category: "Mechanisms",
    tags: ["wash", "brushes", "clean", "depot", "water"],
    notes: "A drive-through wash with spinning brushes and sprays. Engines could get grubby on coal runs and come out shining, with a little sparkle, after a pass through.",
    build: (k) => {
      // Its track a 108 straight (the kit's: src/track/kits.ts).
      const g = k.group(k.trackSlab(108));
      const frame = k.paint(TOY.teal);
      for (const x of [-34, 34]) {
        for (const z of [-36, 36]) g.add(k.box(frame, 7, 74, 7, 2, x, 0, z));
        g.add(k.box(frame, 7, 8, 80, 2, x, 74, 0));
      }
      for (const z of [-36, 36]) g.add(k.box(frame, 75, 6, 7, 2, 0, 76, z));
      g.add(k.box(k.paint(TOY.white), 50, 12, 2, 1, 0, 82, 39));
      const brush = (name: string, z: number) => {
        const b = pivot(name, 0, 12, z, k.cyl(k.paint(TOY.blue), 7, 50, 0, 0, 0, 7, 16), k.cyl(k.metal, 1.5, 56, 0, 0, 0, 1.5, 8));
        for (let i = 0; i < 5; i++) b.add(k.cyl(k.paint(TOY.sky), 9, 3, 0, 4 + i * 10, 0, 9, 10));
        return b;
      };
      g.add(brush("brushL", -27), brush("brushR", 27));
      const top = pivot("brushTop", 0, 66, 0, k.cylZ(k.paint(TOY.blue), 6, 46, 0, 0, 0, 16));
      for (let i = 0; i < 5; i++) top.add(k.cylZ(k.paint(TOY.sky), 8, 3, 0, 0, -18 + i * 9, 10));
      g.add(top);
      const drops = pivot("drops", 0, 0, 0);
      for (let i = 0; i < 8; i++) drops.add(k.ball(k.paint(TOY.sky), 1.4, -30 + (i % 4) * 2, 30 + i * 4, i % 2 ? 30 : -30));
      // Dripping only while it's washing (the kit's motion and `animate` show them).
      drops.visible = false;
      g.add(drops);
      return g;
    },
    animate: (root, t) => {
      part(root, "brushL").rotation.y = t * 6;
      part(root, "brushR").rotation.y = -t * 6;
      part(root, "brushTop").rotation.z = t * 5;
      part(root, "drops").visible = Math.floor(t * 4) % 2 === 0;
    },
  },
  {
    id: "mech-level-crossing",
    name: "Level crossing with barriers",
    category: "Mechanisms",
    tags: ["crossing", "barrier", "road", "boom", "lights"],
    notes: "A road crossing the line with striped booms and flashing red lamps. The booms drop as a train approaches; cars on the road wait, and running a red could cost a star.",
    build: (k) => {
      const g = k.group(k.trackSlab(140), k.box(k.road, 54, 1.2, 240, 0.5, 0, 0, 0));
      for (const z of [-30, 30]) g.add(strutZ(k, k.road, z, 0, z * 0.7, 12, 0, 2, 54));
      for (const [x, z, name] of [
        [-32, -36, "boomA"],
        [32, 36, "boomB"],
      ] as const) {
        g.add(k.cyl(k.paint(TOY.white), 3, 30, x, 0, z, 3, 14), k.box(k.paint(TOY.black), 10, 6, 10, 2, x, 0, z));
        g.add(k.box(k.paint(TOY.black), 3, 8, 16, 1, x, 22, z));
        const s = Math.sign(z);
        const tag = name === "boomA" ? "litA" : "litB";
        g.add(lens(k, LIT_RED, `${tag}0`, x, 26, z - 5, 2.2), lens(k, LIT_RED, `${tag}1`, x, 26, z + 5, 2.2));
        const b = pivot(name, x, 18, z + s * 6, stripedBoom(k, 62), k.box(k.paint(TOY.grey), 8, 6, 5, 1, -4, -3, 0));
        b.rotation.y = x < 0 ? 0 : Math.PI;
        g.add(b);
      }
      return g;
    },
    animate: (root, t) => {
      const down = cycle(t, 8);
      const lift = (1 - down) * 1.35;
      part(root, "boomA").rotation.z = lift;
      part(root, "boomB").rotation.z = lift;
      const blink = Math.floor(t * 3) % 2 === 0;
      const on = down > 0.02;
      part(root, "litA0").visible = on && blink;
      part(root, "litB0").visible = on && blink;
      part(root, "litA1").visible = on && !blink;
      part(root, "litB1").visible = on && !blink;
    },
  },
  {
    id: "mech-gated-crossing",
    name: "Gated crossing",
    category: "Mechanisms",
    tags: ["crossing", "gates", "road", "keeper", "country"],
    notes: "An old country crossing with four white swing gates that close across the road for trains, then swing back across the line to let carts through. A crossing keeper could be a tappable job.",
    build: (k) => {
      const g = k.group(k.trackSlab(140), k.box(k.road, 50, 1.2, 220, 0.5));
      const gate = (len: number) => {
        const w = k.paint(TOY.white);
        const p = new Group();
        p.add(k.box(w, len, 3, 2.5, 1, len / 2, 4, 0), k.box(w, len, 3, 2.5, 1, len / 2, 16, 0), k.box(w, 3, 16, 2.5, 1, len - 1.5, 4, 0));
        p.add(strut(k, w, 2, 6, len - 2, 17, 0, 2, 2));
        p.add(k.cylZ(k.paint(TOY.red), 4, 3, len / 2, 12, 0, 16));
        return p;
      };
      let i = 0;
      for (const x of [25, -25])
        for (const z of [26, -26]) {
          g.add(k.cyl(k.paint(TOY.black), 2.5, 26, x, 0, z, 2.5, 12), k.ball(k.paint(TOY.white), 2.6, x, 27, z));
          const road = x > 0 ? Math.PI : 0;
          const p = pivot(`gate${i++}`, x, 0, z, gate(24));
          p.userData.road = road;
          // Across the line: a quarter turn from across the road.
          p.userData.rail = z > 0 ? Math.PI / 2 : x > 0 ? (3 * Math.PI) / 2 : -Math.PI / 2;
          p.rotation.y = p.userData.rail;
          g.add(p);
        }
      g.add(k.box(k.paint(TOY.cream), 20, 22, 18, 2, 50, 0, -60), k.roof(k.paint(TOY.red), 24, 22, 10, 50, 22, -60), k.peg(TOY.green, TOY.black, 50, 0, -46));
      return g;
    },
    animate: (root, t) => {
      const f = cycle(t, 9);
      for (let i = 0; i < 4; i++) {
        const p = part(root, `gate${i}`);
        p.rotation.y = p.userData.rail + (p.userData.road - p.userData.rail) * f;
      }
    },
  },
  {
    id: "mech-semaphore-signal",
    name: "Semaphore signal",
    category: "Mechanisms",
    tags: ["signal", "semaphore", "arm", "stop", "clear"],
    notes: "A tall wooden post with a red arm that raises to clear and drops to stop, and a lamp with coloured glass. Tap to toggle it and trains stop at it; a block of signals could make a single line safe for two trains.",
    build: (k) => {
      const g = k.group(k.trackSlab(80, 0, 0, 36));
      g.add(k.box(k.paint(DARK_STONE), 12, 6, 12, 2), k.box(k.paint(TOY.white), 5, 112, 5, 1.5, 0, 6, 0), k.cone(k.paint(TOY.red), 4, 8, 0, 118, 0, 12));
      for (let i = 0; i < 9; i++) g.add(k.box(k.metal, 1, 1, 8, 0.3, -5, 14 + i * 10, 0));
      g.add(k.box(k.metal, 1, 90, 1, 0.3, -5, 10, -3.5), k.box(k.metal, 1, 90, 1, 0.3, -5, 10, 3.5));
      g.add(k.box(k.paint(TOY.black), 6, 6, 6, 1.5, 4, 86, 0), named(k.ball(k.paint(LIT_AMBER), 1.8, 7.2, 89, 0), "lamp"));
      g.add(
        pivot(
          "arm",
          3.5,
          104,
          0,
          k.box(k.paint(TOY.red), 2.5, 7, 40, 1.2, 0, -3.5, -22),
          k.box(k.paint(TOY.white), 2.8, 7.2, 3, 0.5, 0, -3.6, -34),
          k.cylX(k.paint(TOY.black), 3, 2, 0, 0, 0, 14),
          k.cylX(k.paint(LIT_RED), 2.5, 1.5, 0.6, -10, 3, 12),
          k.cylX(k.paint(LIT_GREEN), 2.5, 1.5, 0.6, -10, 9, 12),
        ),
      );
      return g;
    },
    animate: (root, t) => {
      part(root, "arm").rotation.x = 0.7 * cycle(t, 5);
    },
  },
  {
    id: "mech-colour-light-signal",
    name: "Colour light signal",
    category: "Mechanisms",
    tags: ["signal", "lights", "red", "green", "amber", "modern"],
    notes: "A slim modern signal with red, amber and green lamps under hoods. It could show the state of the block ahead automatically: red while a train is in it, amber one block behind, green when clear.",
    build: (k) => {
      const g = k.group(k.trackSlab(80, 0, 0, 30), k.box(k.paint(TOY.grey), 10, 4, 10, 1.5));
      g.add(k.cyl(k.paint(TOY.grey), 2.4, 70, 0, 4, 0, 2.4, 12), k.box(k.paint(TOY.black), 8, 30, 12, 3, 0, 72, 0));
      g.add(k.box(k.paint(TOY.white), 8.4, 2, 12.4, 0.5, 0, 72, 0));
      const lamps: [string, string, number][] = [
        [LIT_RED, "red", 96],
        [LIT_AMBER, "amber", 87],
        [LIT_GREEN, "green", 78],
      ];
      for (const [c, n, y] of lamps) {
        g.add(k.cylX(k.paint("#3a3a3a"), 3, 1, 4.2, y, 0, 16), named(k.cylX(k.paint(c), 3, 1.2, 4.4, y, 0, 16), n));
        g.add(k.box(k.paint(TOY.black), 4, 0.8, 8, 0.3, 6, y + 3, 0));
      }
      return g;
    },
    animate: (root, t) => {
      const s = Math.floor(t / 1.2) % 3;
      part(root, "red").visible = s === 0;
      part(root, "amber").visible = s === 1;
      part(root, "green").visible = s === 2;
    },
  },
  {
    id: "mech-signal-gantry",
    name: "Signal gantry",
    category: "Mechanisms",
    tags: ["signal", "gantry", "double track", "lights", "bridge"],
    notes: "A lattice bridge spanning two tracks with a signal head over each line. A natural piece for a double-track main line, each head showing whether its own line is clear.",
    build: (k) => {
      const g = k.group(k.trackSlab(100, 0, 0, -24), k.trackSlab(100, 0, 0, 24));
      const grey = k.paint(TOY.grey);
      for (const z of [-62, 62]) {
        g.add(k.box(grey, 12, 4, 12, 1.5, 0, 0, z), k.box(grey, 7, 104, 7, 2, 0, 4, z));
      }
      for (const y of [96, 108]) g.add(k.box(grey, 6, 4, 132, 1.5, 0, y, 0));
      for (let i = 0; i < 8; i++) g.add(strutZ(k, grey, -56 + i * 14, 98, -49 + i * 14, 108, 0, 2));
      for (let i = 0; i < 9; i++) g.add(k.box(k.paint(TOY.yellow), 2, 10, 2, 0.5, -8, 112, -56 + i * 14));
      g.add(k.box(k.paint(TOY.yellow), 2, 2, 116, 0.5, -8, 122, 0), k.box(k.paint(TOY.white), 14, 2, 120, 0.5, -3, 112, 0));
      for (const [z, i] of [
        [-24, 0],
        [24, 1],
      ] as const) {
        g.add(k.box(grey, 3, 10, 3, 1, 0, 86, z), k.box(k.paint(TOY.black), 8, 22, 12, 3, 2, 66, z));
        g.add(lens(k, LIT_RED, `r${i}`, 5.6, 82, z), lens(k, LIT_GREEN, `g${i}`, 5.6, 72, z));
      }
      return g;
    },
    animate: (root, t) => {
      const a = Math.floor(t / 2) % 2 === 0;
      part(root, "r0").visible = a;
      part(root, "g0").visible = !a;
      part(root, "r1").visible = !a;
      part(root, "g1").visible = a;
    },
  },
  {
    id: "mech-buffer-stop-lamp",
    name: "Buffer stop with lamp",
    category: "Mechanisms",
    tags: ["buffer", "end", "stop", "lamp", "siding"],
    notes: "A sturdy timber buffer stop at a track's end with sprung buffers and a blinking red lamp. Trains bumping gently into it could bounce back a little; hitting it fast could jolt the cargo off.",
    build: (k) => {
      const g = k.group(k.trackSlab(90));
      for (const z of [-14, 14]) {
        g.add(strut(k, k.paint(TOY.brown), 10, 12, 36, 34, z, 6, 6));
        g.add(k.box(k.paint(TOY.brown), 6, 22, 6, 1.5, 36, 12, z));
      }
      g.add(k.box(k.paint(TOY.red), 8, 12, 46, 2, 30, 24, 0), k.box(k.paint(TOY.white), 8.4, 3, 12, 0.5, 30, 28.5, 0));
      for (const z of [-14, 14]) g.add(k.cylX(k.metal, 2, 8, 22, 30, z, 12), k.cylX(k.paint(TOY.black), 5, 2, 17, 30, z, 16));
      g.add(k.box(k.paint(TOY.black), 3, 14, 3, 1, 34, 36, 0), k.box(k.paint(TOY.black), 7, 8, 7, 2, 34, 50, 0));
      g.add(k.cone(k.paint(TOY.black), 5, 4, 34, 58, 0, 12), named(k.ball(k.paint(LIT_RED), 2.6, 30.6, 54, 0), "lamp"));
      return g;
    },
    animate: (root, t) => {
      part(root, "lamp").visible = t % 1.4 < 0.8;
    },
  },
  {
    id: "mech-lever-frame",
    name: "Signal lever frame",
    category: "Mechanisms",
    tags: ["levers", "signal box", "points", "signalman", "control"],
    notes: "A row of colour-coded levers on a frame with a signalman behind it: red for signals, black for points, yellow for distant signals. A tabletop control panel for the whole layout, one lever per points or signal.",
    build: (k) => {
      const g = k.group(k.box(k.paint(TOY.cream), 100, 10, 26, 2), k.box(k.paint(TOY.brown), 104, 3, 30, 1, 0, 10, 0));
      g.add(k.box(k.paint(TOY.black), 40, 7, 1.4, 0.5, 0, 2, 13.4));
      const colours = [TOY.red, TOY.red, TOY.black, TOY.black, TOY.blue, TOY.yellow, TOY.red, TOY.black];
      colours.forEach((c, i) => {
        const x = -42 + i * 12;
        g.add(k.box(k.cut, 3, 0.6, 14, 0, x, 13, 0));
        g.add(pivot(`lv${i}`, x, 13, 0, k.box(k.paint(c), 2.5, 34, 2.5, 1), k.ball(k.metal, 2, 0, 34, 0), k.box(k.paint(TOY.white), 3, 4, 3, 0.8, 0, 26, 0)));
      });
      g.add(k.peg(TOY.blue, TOY.black, 0, 0, -26));
      return g;
    },
    animate: (root, t) => {
      for (let i = 0; i < 8; i++) part(root, `lv${i}`).rotation.x = -0.35 + 0.7 * cycle(t + i * 0.9, 7);
    },
  },
  {
    id: "mech-water-crane",
    name: "Water crane",
    category: "Mechanisms",
    tags: ["water", "steam", "column", "refill", "tank"],
    notes: "A turned iron water column whose arm swings out over the track to fill a steam engine's tank. Steam engines could need water every so many laps, so routes have to pass one.",
    build: (k) => {
      const g = k.group(k.trackSlab(108, 0, 0, 38), k.cyl(k.paint(DARK_STONE), 12, 4, 0, 0, 0, 12, 20));
      g.add(
        k.lathe(
          k.paint(TOY.black),
          [
            [0, 0],
            [8, 0],
            [8, 6],
            [5, 10],
            [4.5, 50],
            [6, 54],
            [6, 58],
            [0, 58],
          ],
          0,
          4,
          0,
          20,
        ),
      );
      g.add(k.cylZ(k.paint(TOY.red), 5, 2, 7, 18, 0, 12));
      g.add(
        pivot(
          "arm",
          0,
          62,
          0,
          k.cyl(k.paint(TOY.black), 6, 6, 0, 0, 0, 6, 16),
          k.cylX(k.paint(TOY.black), 3.5, 46, 22, 4, 0, 14),
          k.cyl(k.paint(TOY.black), 4, 4, 45, 0, 0, 4, 12),
          k.capsule(k.paint(TOY.brown), 3, 12, 45, -18, 0),
          k.ball(k.paint(TOY.red), 3.5, 0, 12, 0),
          strut(k, k.paint(TOY.black), -14, 4, 0, 4, 0, 2),
          k.ball(k.paint(TOY.yellow), 3, -14, 3, 0),
        ),
      );
      return g;
    },
    animate: (root, t) => {
      part(root, "arm").rotation.y = -Math.PI / 2 * cycle(t, 7);
    },
  },
  {
    id: "mech-coaling-crane",
    name: "Coaling stage crane",
    category: "Mechanisms",
    tags: ["coal", "crane", "grab", "depot", "steam"],
    notes: "A raised coaling stage with a small crane and a clamshell grab that opens over an engine's tender. Steam engines could need both coal and water to keep running, giving depots a purpose.",
    build: (k) => {
      const g = k.group(k.trackSlab(108, 0, 0, 40));
      g.add(k.box(k.paint("#a85d3a"), 80, 40, 40, 2, 0, 0, -20), k.box(k.paint(DARK_STONE), 84, 4, 44, 1, 0, 40, -20));
      for (let i = 0; i < 4; i++) g.add(k.box(k.cut, 10, 14, 1, 0.5, -30 + i * 20, 14, 0.2));
      g.add(coalHeap(k, 16, -20, 44, -24), coalHeap(k, 12, 22, 44, -30));
      g.add(k.cyl(k.paint(TOY.green), 5, 30, 10, 44, -6, 4, 16));
      const jaw = (name: string, s: number) =>
        pivot(name, 0, -2, 0, k.box(k.paint(TOY.grey), 10, 9, 3, 1, 0, -9, s * 2), k.box(k.paint(TOY.grey), 10, 2, 6, 0.6, 0, -11, s * 4));
      g.add(
        pivot(
          "slew",
          10,
          74,
          -6,
          k.cyl(k.wood, 5, 3),
          k.box(k.paint(TOY.green), 6, 6, 50, 2, 0, 3, 22),
          k.box(k.paint(TOY.grey), 10, 10, 12, 2, 0, 0, -10),
          k.cylX(k.metal, 3, 8, 0, 6, 46, 12),
          k.cyl(k.metal, 0.6, 18, 0, -12, 46, 0.6, 6),
          pivot("grab", 0, -12, 46, k.box(k.paint(TOY.black), 8, 4, 8, 1, 0, -4, 0), jaw("jawA", -1), jaw("jawB", 1)),
        ),
      );
      return g;
    },
    animate: (root, t) => {
      part(root, "slew").rotation.y = 0.6 * Math.sin(t * 0.6);
      const open = 0.6 * cycle(t, 4);
      part(root, "jawA").rotation.x = open;
      part(root, "jawB").rotation.x = -open;
    },
  },
  {
    id: "mech-tipping-dump",
    name: "Wagon tipper",
    category: "Mechanisms",
    tags: ["tipper", "dump", "unloading", "quarry", "gravel"],
    notes: "A cradle that grips a wagon and rolls it sideways to empty its load into a pit. Unload ore or gravel without a hopper door: a quarry line ends here and the player keeps it fed.",
    build: (k) => {
      // 216 of track in all, the cradle's in the middle (the game's kit piece, kit-tipping-dump).
      const g = k.group(k.trackSlab(58, -79, 0, 0), k.trackSlab(58, 79, 0, 0));
      g.add(k.box(k.cut, 100, 3, 64, 1, 0, 0, 52), coalHeap(k, 22, -10, 3, 54), coalHeap(k, 14, 22, 3, 62));
      g.add(k.box(k.paint(STONE), 100, 6, 6, 1.5, 0, 0, 84), k.box(k.paint(STONE), 100, 6, 6, 1.5, 0, 0, 20));
      for (const x of [-46, 46]) g.add(k.box(k.paint(TOY.blue), 8, 30, 10, 2, x, 0, 18));
      g.add(
        pivot(
          "tilt",
          0,
          24,
          18,
          k.box(k.paint(TOY.blue), 100, 4, 46, 1.5, 0, -24, -18),
          k.trackSlab(98, 0, -20, -18),
          k.ring(k.paint(TOY.yellow), 24, 3, -46, -4, -18, true, Math.PI).rotateY(Math.PI / 2),
          k.ring(k.paint(TOY.yellow), 24, 3, 46, -4, -18, true, Math.PI).rotateY(Math.PI / 2),
          k.box(k.paint(TOY.red), 64, 8, 30, 2, 0, -14, -18),
          k.box(k.paint(TOY.grey), 64, 20, 30, 2, 0, -6, -18),
          k.cone(k.paint("#8a6a4a"), 13, 10, 0, 14, -18, 14),
        ),
      );
      return g;
    },
    animate: (root, t) => {
      part(root, "tilt").rotation.x = 1.1 * cycle(t, 7);
    },
  },
  {
    id: "mech-fuel-station",
    name: "Refuelling station",
    category: "Mechanisms",
    tags: ["fuel", "diesel", "tank", "pump", "depot"],
    notes: "A big yellow tank on a cradle with a pump and a swinging hose arm. Diesel engines could visit to fill up, the gauge needle rising as the player holds the pump.",
    build: (k) => {
      const g = k.group(k.trackSlab(108, 0, 0, 36));
      for (const x of [-30, 30]) g.add(k.box(k.paint(TOY.grey), 8, 16, 32, 2, x, 0, -30));
      g.add(k.cylX(k.paint(TOY.yellow), 18, 90, 0, 32, -30, 24));
      for (const s of [-1, 1]) {
        const cap = k.ball(k.paint(TOY.yellow), 18, s * 45, 32, -30);
        cap.scale.x = 0.3;
        g.add(cap);
      }
      g.add(k.box(k.paint(TOY.red), 40, 4, 1.4, 0.5, 0, 30, -11.2));
      g.add(k.box(k.paint(TOY.red), 14, 30, 12, 2, 46, 0, 4), k.cylZ(k.paint(TOY.white), 4, 1, 46, 22, 10.5, 16));
      g.add(named(k.box(k.paint(TOY.black), 0.8, 3.5, 0.6, 0, 46, 22, 11.2), "needle"));
      g.add(k.cyl(k.paint(TOY.grey), 2.5, 40, 30, 0, 4, 2.5, 12));
      g.add(
        pivot(
          "arm",
          30,
          40,
          4,
          k.cylZ(k.paint(TOY.black), 2, 30, 0, 0, 15, 12),
          k.cyl(k.paint(TOY.black), 1.5, 14, 0, -14, 30, 1.5, 8),
          k.box(k.paint(TOY.red), 4, 4, 4, 1, 0, -18, 30),
        ),
      );
      return g;
    },
    animate: (root, t) => {
      const f = cycle(t, 8);
      part(root, "arm").rotation.y = 1.3 * (1 - f);
      part(root, "needle").rotation.z = -1.2 + 2.4 * f;
    },
  },
  {
    id: "mech-whistle-post",
    name: "Whistle post and bell",
    category: "Mechanisms",
    tags: ["whistle", "sound", "bell", "sign", "post"],
    notes: "A white post marked W with a little bell on a bracket. Drop it before a crossing or a tunnel and passing engines toot; the bell could ring for every train that goes by.",
    build: (k) => {
      const g = k.group(k.box(k.paint(DARK_STONE), 10, 4, 10, 1.5), k.box(k.paint(TOY.white), 4, 50, 4, 1.5, 0, 4, 0));
      g.add(k.box(k.paint(TOY.black), 2, 20, 20, 2, -1, 33, 0), k.box(k.paint(TOY.white), 3, 18, 18, 2, 0.5, 34, 0));
      g.add(
        k.extrude(
          k.paint(TOY.black),
          [
            [-6, 6],
            [-4, 6],
            [-2.5, 0.5],
            [-1, 4],
            [1, 4],
            [2.5, 0.5],
            [4, 6],
            [6, 6],
            [3.5, -6],
            [1.5, -6],
            [0, -2],
            [-1.5, -6],
            [-3.5, -6],
          ],
          1,
          1.8,
          43,
          0,
          0.2,
        ).rotateY(Math.PI / 2),
      );
      g.add(k.box(k.paint(TOY.black), 2, 2, 16, 0.5, 0, 56, 7));
      g.add(pivot("bell", 0, 56, 14, k.lathe(k.paint(TOY.yellow), [
        [0, -1],
        [6, -10],
        [5, -9],
        [3.5, -4],
        [2.5, -1],
        [0, 0],
      ], 0, 0, 0, 20), k.ball(k.metal, 1.6, 0, -9, 0)));
      return g;
    },
    animate: (root, t) => {
      part(root, "bell").rotation.x = Math.sin(t * 6) * 0.4;
    },
  },
  {
    id: "mech-ticket-barrier",
    name: "Ticket barriers",
    category: "Mechanisms",
    tags: ["station", "tickets", "gates", "passengers", "barrier"],
    notes: "A row of station ticket gates with paddles that flip open as each passenger passes. A busy station could count passengers through, and a fare could be the game's way of earning stars.",
    build: (k) => {
      const g = k.group(k.box(k.paint(TOY.grey), 90, 2, 50, 1));
      for (let i = 0; i < 4; i++) {
        const z = -27 + i * 18;
        g.add(k.box(k.paint(TOY.cream), 30, 22, 6, 2, 0, 2, z), k.box(k.paint(TOY.black), 10, 2, 6.4, 0.5, 8, 24, z));
        g.add(k.box(k.paint(i % 2 ? LIT_GREEN : LIT_RED), 3, 3, 1, 0.5, -12, 18, z + 3.3));
      }
      for (let i = 0; i < 3; i++) {
        const z = -18 + i * 18;
        g.add(pivot(`flapA${i}`, 0, 12, z - 6, k.box(k.paint(TOY.red), 2, 10, 6, 1, 0, -5, 3)));
        g.add(pivot(`flapB${i}`, 0, 12, z + 6, k.box(k.paint(TOY.red), 2, 10, 6, 1, 0, -5, -3)));
      }
      g.add(k.peg(TOY.purple, null, -26, 2, -18), k.peg(TOY.yellow, TOY.blue, -36, 2, 0), k.peg(TOY.teal, null, 30, 2, 18));
      return g;
    },
    animate: (root, t) => {
      for (let i = 0; i < 3; i++) {
        const open = 1.4 * cycle(t + i * 1.3, 4);
        part(root, `flapA${i}`).rotation.y = open;
        part(root, `flapB${i}`).rotation.y = -open;
      }
    },
  },
  {
    id: "mech-weighbridge",
    name: "Weighbridge",
    category: "Mechanisms",
    tags: ["weigh", "scale", "freight", "dial", "goods yard"],
    notes: "A steel plate in the track with a little hut whose big dial weighs each wagon that stops on it. Contracts could ask for an exact tonnage: fill hoppers until the needle hits the mark.",
    build: (k) => {
      // A 108 straight (the game's kit piece, kit-weighbridge).
      const g = k.group(k.trackSlab(108), k.box(k.metal, 70, 1, 42, 0.4, 0, 0, 0), k.box(k.paint(TOY.black), 72, 2, 2, 0.5, 0, 10.5, 21), k.box(k.paint(TOY.black), 72, 2, 2, 0.5, 0, 10.5, -21));
      g.add(k.box(k.paint(TOY.green), 34, 34, 28, 3, 0, 0, -50), k.roof(k.paint(TOY.red), 38, 32, 12, 0, 34, -50));
      g.add(k.box(k.glass, 12, 10, 1, 0.5, -9, 14, -35.8), k.box(k.paint(TOY.cream), 10, 18, 1, 0.5, 10, 0, -35.8));
      g.add(k.cylZ(k.paint(TOY.white), 9, 2, -6, 50, -35, 24), k.ring(k.paint(TOY.black), 9, 1, -6, 50, -34, true));
      g.add(k.box(k.paint(TOY.white), 4, 16, 4, 1, -6, 34, -36), k.box(k.paint(TOY.red), 1, 3, 0.5, 0, -6, 56, -33.8));
      g.add(pivot("needle", -6, 50, -33.6, k.box(k.paint(TOY.black), 1.2, 7.5, 0.6, 0.2, 0, 0, 0), k.cylZ(k.paint(TOY.black), 1.4, 1, 0, 0, 0, 10)));
      return g;
    },
    animate: (root, t) => {
      part(root, "needle").rotation.z = 2 - 2.6 * cycle(t, 6) + Math.sin(t * 9) * 0.05 * cycle(t, 6);
    },
  },
  {
    id: "mech-drop-hopper",
    name: "Overhead drop hopper",
    category: "Mechanisms",
    tags: ["hopper", "drop", "gravel", "loading", "bin"],
    notes: "A big bin on legs over the line whose bottom doors swing open to drop a load straight into the wagon below. The player times a slow crawl underneath to fill a whole rake of hoppers.",
    build: (k) => {
      // Over a 162 straight (the game's kit piece, kit-drop-hopper).
      const g = k.group(k.trackSlab(162));
      for (const x of [-30, 30]) for (const z of [-32, 32]) g.add(k.box(k.paint(TOY.grey), 6, 80, 6, 1.5, x, 0, z));
      g.add(k.box(k.paint(TOY.orange), 70, 30, 70, 3, 0, 80, 0));
      g.add(k.lathe(k.paint(TOY.orange), [
        [10, 0],
        [32, 22],
        [0.01, 22],
      ], 0, 58, 0, 4).rotateY(Math.PI / 4));
      g.add(k.box(k.paint(TOY.white), 40, 10, 1, 0.5, 0, 92, 35.4), coalHeap(k, 28, 0, 110, 0));
      g.add(k.box(k.paint(TOY.black), 24, 4, 24, 1, 0, 54, 0));
      g.add(pivot("doorA", -12, 54, 0, k.box(k.paint(TOY.black), 12, 2, 22, 0.5, 6, -2, 0)), pivot("doorB", 12, 54, 0, k.box(k.paint(TOY.black), 12, 2, 22, 0.5, -6, -2, 0)));
      const stream = pivot("stream", 0, 0, 0);
      for (let i = 0; i < 6; i++) stream.add(k.ball(k.coal, 3, (i % 3) * 3 - 3, 24 + i * 5, (i % 2) * 4 - 2));
      g.add(stream);
      return g;
    },
    animate: (root, t) => {
      const f = cycle(t, 5);
      part(root, "doorA").rotation.z = -1.3 * f;
      part(root, "doorB").rotation.z = 1.3 * f;
      part(root, "stream").visible = f > 0.6;
    },
  },
  {
    id: "mech-track-cleaner",
    name: "Track cleaning wagon",
    category: "Mechanisms",
    tags: ["cleaning", "brush", "maintenance", "wagon", "depot"],
    notes: "A short maintenance wagon with spinning brushes underneath and a little cab. Running it round could sweep away leaves or snow that slow other trains down.",
    build: (k) => {
      const len = 80;
      const g = k.group(k.bogies(len), k.coupler(len, 1), k.coupler(len, -1));
      g.add(k.box(k.paint(TOY.yellow), len - 6, 8, 30, 2, 0, 12, 0));
      g.add(k.box(k.paint(TOY.yellow), 28, 22, 28, 3, -18, 20, 0), k.box(k.glass, 29, 8, 20, 1, -18, 30, 0), k.box(k.paint(TOY.black), 30, 3, 30, 1, -18, 42, 0));
      g.add(k.cyl(k.paint(TOY.orange), 3, 3, -18, 45, 0, 3, 12), named(k.ball(k.paint(LIT_AMBER), 2.4, -18, 50, 0), "beacon"));
      g.add(k.cylX(k.paint(TOY.teal), 9, 28, 16, 29, 0, 20), k.box(k.paint(TOY.grey), 30, 3, 22, 1, 16, 20, 0));
      for (const x of [-4, 4]) {
        const b = pivot(x < 0 ? "brushA" : "brushB", x, 9, 0, k.cylZ(k.paint(TOY.red), 3, 26, 0, 0, 0, 12));
        for (let i = 0; i < 6; i++) b.add(k.box(k.paint(TOY.black), 1, 3, 24, 0.3, Math.cos(i) * 3.5, Math.sin(i) * 3.5 - 1.5, 0).rotateZ(i));
        g.add(b);
      }
      return g;
    },
    animate: (root, t) => {
      part(root, "brushA").rotation.z = t * 10;
      part(root, "brushB").rotation.z = t * 10;
      part(root, "beacon").visible = Math.floor(t * 3) % 2 === 0;
    },
  },
  {
    id: "mech-loop-the-loop",
    name: "Loop-the-loop",
    category: "Mechanisms",
    tags: ["loop", "coaster", "stunt", "fun", "fairground"],
    notes: "A vertical wooden track loop on a pair of trestles: a stunt piece where a fast enough train rolls round upside down, held in by its magnets. Too slow and it falls off, so the player has to build up speed.",
    build: (k) => {
      const R = 54;
      const cy = 12 + R;
      const g = k.group(k.trackSlab(120, -72, 0, 0), k.trackSlab(120, 72, 0, 0));
      const n = 28;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        const seg = k.box(k.wood, ((2 * Math.PI * (R + 6)) / n) * 1.04, 8, 40, 0.8, 0, -4, 0);
        seg.position.set(Math.sin(a) * (R + 4), cy - Math.cos(a) * (R + 4), 0);
        seg.rotation.z = a;
        g.add(seg);
      }
      for (const z of [-30, 30]) {
        g.add(strutZ(k, k.paint(TOY.red), z * 1.8, 0, z, cy, 0, 5), strut(k, k.paint(TOY.red), -40, 0, 0, cy, z, 5), strut(k, k.paint(TOY.red), 40, 0, 0, cy, z, 5));
      }
      g.add(k.cylZ(k.paint(TOY.yellow), 4, 64, 0, cy, 0, 14));
      g.add(
        pivot(
          "car",
          0,
          cy,
          0,
          k.box(k.paint(TOY.blue), 26, 14, 30, 4, 0, -(R - 2) + 4, 0),
          k.peg(TOY.yellow, null, 0, -(R - 2) + 12, 0),
          k.wheel(5, -8, -(R - 2) + 3, 13),
          k.wheel(5, 8, -(R - 2) + 3, 13),
          k.wheel(5, -8, -(R - 2) + 3, -13),
          k.wheel(5, 8, -(R - 2) + 3, -13),
        ),
      );
      return g;
    },
    animate: (root, t) => {
      part(root, "car").rotation.z = t * 2.2;
    },
  },
  {
    id: "mech-lighthouse-beacon",
    name: "Lighthouse beacon",
    category: "Mechanisms",
    tags: ["lighthouse", "beacon", "coast", "light", "harbour"],
    notes: "A striped lighthouse on a rocky base with a turning lamp. On a coastal layout its sweep could light the way for night running, or signal boats into the harbour station.",
    build: (k) => {
      const g = k.group(k.cyl(k.paint(DARK_STONE), 30, 10, 0, 0, 0, 24, 16));
      for (let i = 0; i < 5; i++) g.add(k.cyl(k.paint(i % 2 ? TOY.white : TOY.red), 16 - i * 1.4, 20, 0, 10 + i * 20, 0, 16 - (i + 1) * 1.4, 24));
      g.add(k.cyl(k.paint(TOY.black), 12, 3, 0, 110, 0, 12, 24), k.ring(k.paint(TOY.black), 11.5, 0.7, 0, 118, 0));
      g.add(k.cyl(k.glass, 7, 14, 0, 113, 0, 7, 20), k.cone(k.paint(TOY.red), 9, 9, 0, 127, 0, 20), k.ball(k.paint(TOY.black), 2, 0, 137, 0));
      g.add(k.box(k.paint(TOY.black), 5, 9, 1, 0.5, 0, 22, 15.6));
      g.add(pivot("beam", 0, 120, 0, k.ball(k.paint(LIT_AMBER), 4, 0, 0, 0), k.cylX(k.paint(LIT_AMBER), 2.5, 10, 5, 0, 0, 12), k.cylX(k.paint(LIT_AMBER), 2.5, 10, -5, 0, 0, 12)));
      return g;
    },
    animate: (root, t) => {
      part(root, "beam").rotation.y = t * 1.5;
    },
  },
];

// ——— Bridges & tunnels ———

const bridges: Asset[] = [
  {
    id: "mech-stone-arch-bridge",
    name: "Stone arch bridge",
    category: "Bridges & tunnels",
    tags: ["bridge", "arch", "stone", "river", "raised"],
    notes: "A two-arch stone bridge carrying the line high over a river, with parapets and keystones. It lifts track to hill-block height so a layout can cross water or a lower line.",
    build: (k) => {
      const g = k.group(river(k, 70, 140, 0));
      g.add(k.extrude(k.paint(STONE), archShape(200, DECK, [
        [-46, 30, 18],
        [46, 30, 18],
      ]), 40, 0, 0, 0, 1.5));
      g.add(k.trackSlab(204, 0, DECK, 0));
      for (const z of [-22, 22]) g.add(k.box(k.paint(DARK_STONE), 204, 9, 4, 1.2, 0, DECK + 4, z));
      for (const x of [-46, 46]) for (const z of [-20.5, 20.5]) g.add(k.box(k.paint(DARK_STONE), 8, 10, 1.6, 0.6, x, 46, z));
      for (const z of [-20.5, 20.5]) g.add(k.box(k.paint(DARK_STONE), 10, 30, 1.6, 0.6, 0, 0, z));
      return g;
    },
  },
  {
    id: "mech-viaduct",
    name: "Tall viaduct",
    category: "Bridges & tunnels",
    tags: ["viaduct", "arches", "valley", "stone", "high"],
    notes: "A long run of five tall arches striding across a valley. It could carry a line over a whole row of hills or a town square below.",
    build: (k) => {
      const H = 110;
      const g = new Group();
      const arches: [number, number, number][] = [-120, -60, 0, 60, 120].map((cx) => [cx, 21, 64]);
      g.add(k.extrude(k.paint("#c9a07a"), archShape(296, H, arches), 38, 0, 0, 0, 1.5));
      for (const cx of [-90, -30, 30, 90]) for (const z of [-20, 20]) g.add(k.box(k.paint("#a87e5c"), 14, 60, 2, 0.6, cx, 0, z));
      g.add(k.box(k.paint("#a87e5c"), 300, 5, 44, 1.2, 0, H - 5, 0));
      g.add(k.trackSlab(300, 0, H, 0));
      for (const z of [-22, 22]) g.add(k.box(k.paint("#a87e5c"), 300, 7, 3, 1, 0, H + 4, z));
      return g;
    },
  },
  {
    id: "mech-suspension-bridge",
    name: "Suspension bridge",
    category: "Bridges & tunnels",
    tags: ["suspension", "cables", "towers", "long span", "river"],
    notes: "Two tall towers and sweeping cables holding a long deck over a wide river. A showpiece span: the only way across a wide river without piers in the water.",
    build: (k) => {
      const red = k.paint(TOY.red);
      const Y = 40;
      const g = k.group(river(k, 150, 160, 0));
      for (const x of [-140, 140]) g.add(k.box(k.paint(STONE), 30, Y, 50, 2, x, 0, 0));
      g.add(k.trackSlab(300, 0, Y, 0));
      for (const x of [-90, 90]) {
        g.add(pier(k, 22, Y, 56, x, 0));
        for (const z of [-26, 26]) g.add(k.box(red, 8, 110, 8, 2, x, Y, z));
        for (const y of [Y + 40, Y + 104]) g.add(k.box(red, 8, 8, 60, 2, x, y, 0));
      }
      const top = Y + 106;
      const sag = Y + 22;
      const n = 12;
      for (const z of [-26, 26]) {
        let px = -90;
        let py = top;
        for (let i = 1; i <= n; i++) {
          const x = -90 + (180 * i) / n;
          const u = x / 90;
          const y = sag + (top - sag) * u * u;
          g.add(strut(k, k.metal, px, py, x, y, z, 1.6));
          if (i < n) g.add(k.cyl(k.metal, 0.6, y - (Y + 12), x, Y + 12, z, 0.6, 6));
          px = x;
          py = y;
        }
        for (const s of [-1, 1]) g.add(strut(k, k.metal, s * 90, top, s * 150, Y + 12, z, 1.6));
      }
      return g;
    },
  },
  {
    id: "mech-bascule-bridge",
    name: "Bascule bridge",
    category: "Bridges & tunnels",
    tags: ["drawbridge", "bascule", "opening", "river", "boats"],
    notes: "Two leaves that lift upward from the middle like a drawbridge, letting tall boats through. Tap to raise it; trains must wait, and a train that doesn't would end up in the river.",
    build: (k) => {
      const Y = 36;
      const g = k.group(river(k, 80, 160, 0));
      for (const x of [-86, 86]) g.add(pier(k, 90, Y - 12, 76, x, 0), k.trackSlab(90, x, Y - 12, 0));
      g.add(k.box(k.paint(TOY.cream), 18, 20, 16, 2, 60, Y - 12, -28), k.roof(k.paint(TOY.red), 22, 20, 8, 60, Y + 8, -28), k.box(k.glass, 18.4, 6, 10, 1, 60, Y - 2, -28));
      const leaf = (name: string, s: 1 | -1) =>
        pivot(
          name,
          -s * 41,
          Y,
          0,
          k.trackSlab(41, (s * 41) / 2, -12, 0),
          k.box(k.paint(TOY.blue), 41, 10, 3, 1, (s * 41) / 2, -6, 22),
          k.box(k.paint(TOY.blue), 41, 10, 3, 1, (s * 41) / 2, -6, -22),
          k.box(k.paint(TOY.grey), 10, 16, 36, 2, -s * 6, -26, 0),
          k.cylZ(k.metal, 3, 52, 0, -6, 0, 12),
        );
      g.add(leaf("leafL", 1), leaf("leafR", -1));
      return g;
    },
    animate: (root, t) => {
      const a = 1.2 * cycle(t, 8);
      part(root, "leafL").rotation.z = a;
      part(root, "leafR").rotation.z = -a;
    },
  },
  {
    id: "mech-swing-bridge",
    name: "Swing bridge",
    category: "Bridges & tunnels",
    tags: ["swing bridge", "pivot", "canal", "opening", "boats"],
    notes: "A truss deck balanced on a central round pier that swings a quarter turn to open the channel either side. A canal crossing that turns the layout into a puzzle of boats and trains taking turns.",
    build: (k) => {
      const Y = 30;
      const g = k.group(river(k, 150, 170, 0));
      g.add(k.cyl(k.paint(STONE), 22, Y - 14, 0, 0, 0, 22, 28), k.cyl(k.paint(DARK_STONE), 18, 2, 0, Y - 14, 0, 18, 28));
      for (const x of [-110, 110]) g.add(k.box(k.paint(STONE), 60, Y - 12, 50, 2, x, 0, 0), k.trackSlab(60, x, Y - 12, 0));
      const deck = pivot("deck", 0, 0, 0, k.trackSlab(158, 0, Y - 12, 0), k.cyl(k.paint(TOY.black), 12, 4, 0, Y - 16, 0, 12, 20));
      for (const z of [-22, 22]) {
        deck.add(k.box(k.paint(TOY.green), 158, 3, 3, 1, 0, Y + 16, z), k.box(k.paint(TOY.green), 158, 3, 3, 1, 0, Y, z));
        for (let i = 0; i < 8; i++) deck.add(strut(k, k.paint(TOY.green), -78 + i * 19.5, Y, -78 + (i + 1) * 19.5, Y + 16, z, 2.4));
      }
      deck.add(k.box(k.paint(TOY.cream), 12, 10, 8, 2, 0, Y + 19, 0), k.roof(k.paint(TOY.red), 14, 10, 4, 0, Y + 29, 0), k.peg(TOY.red, TOY.blue, 12, Y, 30));
      g.add(deck);
      return g;
    },
    animate: (root, t) => {
      part(root, "deck").rotation.y = (Math.PI / 2) * cycle(t, 9);
    },
  },
  {
    id: "mech-lift-bridge",
    name: "Vertical lift bridge",
    category: "Bridges & tunnels",
    tags: ["lift bridge", "towers", "counterweight", "opening", "harbour"],
    notes: "A span hoisted straight up between two steel towers, counterweights dropping as it rises. Another way to let boats under, with the deck staying level the whole time.",
    build: (k) => {
      const Y = 30;
      const blue = k.paint(TOY.blue);
      const g = k.group(river(k, 90, 160, 0));
      for (const x of [-96, 96]) g.add(k.box(k.paint(STONE), 88, Y - 12, 70, 2, x, 0, 0), k.trackSlab(88, x, Y - 12, 0));
      for (const x of [-58, 58]) {
        for (const z of [-28, 28]) g.add(k.box(blue, 8, 140, 8, 2, x, Y - 12, z));
        g.add(k.box(blue, 10, 10, 66, 2, x, Y + 128, 0));
        for (const z of [-28, 28]) g.add(k.cylZ(k.paint(TOY.red), 8, 4, x, Y + 138, z * 0.8, 16));
        for (let i = 0; i < 3; i++) g.add(strutZ(k, blue, -28, Y + i * 40, 28, Y + 40 + i * 40, x, 2.5));
      }
      for (const z of [-28, 28]) {
        g.add(k.box(blue, 124, 6, 6, 2, 0, Y + 134, z));
        for (const x of [-58, 58]) g.add(named(k.box(k.paint(TOY.grey), 12, 20, 6, 1.5, x, 120, z * 1.25), `cw${x < 0 ? 0 : 1}${z < 0 ? 0 : 1}`));
      }
      const span = pivot("span", 0, 0, 0, k.trackSlab(104, 0, Y - 12, 0));
      for (const z of [-23, 23]) {
        span.add(k.box(k.paint(TOY.yellow), 104, 3, 3, 1, 0, Y + 14, z));
        for (let i = 0; i < 6; i++) span.add(strut(k, k.paint(TOY.yellow), -52 + i * 17.3, Y, -52 + (i + 1) * 17.3, Y + 14, z, 2.4));
      }
      g.add(span);
      return g;
    },
    animate: (root, t) => {
      const f = cycle(t, 9);
      part(root, "span").position.y = 80 * f;
      const cw = 50 + 80 * (1 - f);
      part(root, "cw00").position.y = cw;
      part(root, "cw01").position.y = cw;
      part(root, "cw10").position.y = cw;
      part(root, "cw11").position.y = cw;
    },
  },
  {
    id: "mech-rope-bridge",
    name: "Rope bridge",
    category: "Bridges & tunnels",
    tags: ["rope", "wobbly", "gorge", "adventure", "sway"],
    notes: "A sagging, swaying track slung on ropes between two rocky cliffs. A daring gorge crossing: slow trains make it, fast ones set it swinging and risk a derailment.",
    build: (k) => {
      const Y = 52;
      const g = new Group();
      for (const s of [-1, 1]) {
        g.add(k.box(k.paint(DARK_STONE), 50, Y, 64, 6, s * 125, 0, 0), k.box(k.felt, 50, 3, 64, 1, s * 125, Y, 0));
        g.add(k.trackSlab(40, s * 120, Y, 0));
        for (const z of [-26, 26]) g.add(k.cyl(k.paint(TOY.brown), 3, 34, s * 100, Y, z, 2.6, 12));
      }
      const deck = pivot("deck", 0, Y, 0);
      const n = 8;
      const seg = 200 / n;
      const sag = (x: number) => -16 * (1 - (x / 100) ** 2);
      for (let i = 0; i < n; i++) {
        const x0 = -100 + i * seg;
        const x1 = x0 + seg;
        const slab = k.trackSlab(seg - 1, 0, -6, 0);
        slab.position.set((x0 + x1) / 2, (sag(x0) + sag(x1)) / 2 - 6, 0);
        slab.rotation.z = Math.atan2(sag(x1) - sag(x0), seg);
        deck.add(slab);
        for (const z of [-24, 24]) {
          deck.add(strut(k, k.paint("#c9b48a"), x0, sag(x0) + 24, x1, sag(x1) + 24, z, 1.2));
          deck.add(strut(k, k.paint("#c9b48a"), x0, sag(x0) - 13, x1, sag(x1) - 13, z, 1.2));
          if (i > 0) deck.add(k.cyl(k.paint("#c9b48a"), 0.5, 37, x0, sag(x0) - 13, z, 0.5, 6));
        }
      }
      g.add(deck);
      return g;
    },
    animate: (root, t) => {
      part(root, "deck").rotation.x = Math.sin(t * 1.6) * 0.05;
    },
  },
  {
    id: "mech-truss-bridge",
    name: "Steel truss bridge",
    category: "Bridges & tunnels",
    tags: ["truss", "girder", "steel", "lattice", "river"],
    notes: "A riveted lattice truss on stone abutments, the classic railway girder bridge. A sturdy single span over a river or road, able to carry the heaviest freight.",
    build: (k) => {
      const Y = 34;
      const green = k.paint(TOY.green);
      const g = k.group(river(k, 110, 160, 0));
      for (const x of [-96, 96]) g.add(k.box(k.paint(STONE), 34, Y, 52, 3, x, 0, 0));
      g.add(k.trackSlab(220, 0, Y, 0));
      const top = Y + 56;
      const n = 8;
      const p = 160 / n;
      for (const z of [-24, 24]) {
        g.add(k.box(green, 172, 5, 4, 1.2, 0, Y + 8, z), k.box(green, 160 - p, 5, 4, 1.2, 0, top - 5, z));
        for (let i = 0; i < n; i++) {
          const x0 = -80 + i * p;
          const up = i % 2 === 0;
          if (i === 0) g.add(strut(k, green, -86, Y + 10, x0 + p, top - 2, z, 4));
          else if (i === n - 1) g.add(strut(k, green, x0, top - 2, 86, Y + 10, z, 4));
          else g.add(strut(k, green, x0, up ? Y + 10 : top - 2, x0 + p, up ? top - 2 : Y + 10, z, 3));
          if (i > 0) g.add(k.box(green, 2.5, top - Y - 12, 2.5, 0.8, x0, Y + 10, z));
        }
      }
      for (let i = 1; i < n; i += 2) g.add(k.box(green, 3, 3, 52, 1, -80 + i * p, top - 4, 0));
      for (const x of [-60, 60]) g.add(k.box(k.paint(TOY.white), 20, 7, 1, 0.4, x, top - 14, 26.5));
      return g;
    },
  },
  {
    id: "mech-covered-bridge",
    name: "Covered bridge",
    category: "Bridges & tunnels",
    tags: ["covered", "wooden", "barn", "rural", "roof"],
    notes: "A barn-red covered timber bridge on stone footings, trains rumbling through in shade. A cosy countryside crossing, perhaps the home of an owl or two.",
    build: (k) => {
      const Y = 24;
      const red = k.paint("#a83a2c");
      const g = k.group(river(k, 70, 140, 0));
      for (const x of [-80, 80]) g.add(k.box(k.paint(STONE), 30, Y, 56, 3, x, 0, 0));
      g.add(k.trackSlab(190, 0, Y, 0));
      for (const z of [-25, 25]) {
        g.add(k.box(red, 180, 50, 4, 1, 0, Y + 12, z));
        for (const x of [-50, 0, 50]) g.add(k.box(k.cut, 16, 10, 4.4, 0.8, x, Y + 34, z));
        g.add(k.box(k.paint(TOY.white), 182, 3, 4.6, 0.8, 0, Y + 12, z));
      }
      const gable = new Shape();
      gable.moveTo(-28, 0);
      gable.lineTo(28, 0);
      gable.lineTo(0, 24);
      for (const x of [-89, 89]) {
        const m = k.extrude(red, gable, 3, 0, Y + 62, 0, 0.6);
        m.rotation.y = Math.PI / 2;
        m.position.x = x;
        g.add(m);
      }
      g.add(k.roof(k.paint(TOY.grey), 196, 62, 24, 0, Y + 62, 0));
      g.add(k.box(k.paint(TOY.cream), 2, 7, 26, 0.6, 91, Y + 64, 0));
      return g;
    },
  },
  {
    id: "mech-trestle",
    name: "Timber trestle",
    category: "Bridges & tunnels",
    tags: ["trestle", "timber", "wooden", "frontier", "raised"],
    notes: "A frontier-style timber trestle of splayed bents and cross-bracing. A light, cheap way to raise a line across a gully: perhaps it creaks if an overloaded train crosses.",
    build: (k) => {
      const Y = 54;
      const w = k.paint("#b68a5a");
      const g = k.group(k.trackSlab(240, 0, Y, 0));
      for (const z of [-10, 10]) g.add(k.box(w, 236, 5, 6, 1, 0, Y - 5, z));
      for (let i = 0; i < 5; i++) {
        const x = -96 + i * 48;
        g.add(k.box(w, 8, 4, 46, 1, x, Y - 9, 0));
        for (const s of [-1, 1]) {
          g.add(strutZ(k, w, s * 30, 0, s * 15, Y - 9, x, 5));
          g.add(strutZ(k, w, s * 4, 0, s * 4, Y - 9, x, 5));
        }
        g.add(strutZ(k, w, -27, 8, 27, Y - 14, x + 3, 2.5), strutZ(k, w, 27, 8, -27, Y - 14, x - 3, 2.5));
        g.add(k.box(w, 4, 3, 60, 0.8, x, 20, 0));
        if (i < 4) g.add(strut(k, w, x, 22, x + 48, Y - 14, 18, 2.4), strut(k, w, x, Y - 14, x + 48, 22, -18, 2.4));
      }
      return g;
    },
  },
  {
    id: "mech-tunnel-portal",
    name: "Tunnel portal",
    category: "Bridges & tunnels",
    tags: ["tunnel", "portal", "stone", "entrance", "hill"],
    notes: "A dressed-stone tunnel mouth with a keystone and date plaque, set into a grassy bank. It clips onto a hill block's side so the line can disappear into the hillside.",
    build: (k) => {
      const g = k.group(k.trackSlab(110));
      const face = archShape(120, 86, [[0, 25, 32]]);
      g.add(alongTrack(k, k.paint(STONE), face, 10, 0, 1));
      g.add(k.box(k.paint(DARK_STONE), 14, 6, 126, 1.5, 0, 86, 0));
      g.add(k.box(k.paint(DARK_STONE), 12, 10, 9, 1, 0, 55, 0));
      g.add(k.box(k.paint(TOY.cream), 11.5, 7, 22, 1, 0, 68, 0));
      const bank = hillShape(130, 92, [[0, 25, 32]]);
      g.add(alongTrack(k, k.felt, bank, 50, -30, 2));
      return g;
    },
  },
  {
    id: "mech-mountain-tunnel",
    name: "Mountain tunnel",
    category: "Bridges & tunnels",
    tags: ["tunnel", "mountain", "hill", "snow", "through"],
    notes: "A whole felt mountain with a snowy peak, pine trees and stone portals at both ends. A big centrepiece: trains vanish for a moment, and a tunnel is a good place to hide a passing loop.",
    build: (k) => {
      const L = 140;
      const g = k.group(k.trackSlab(L + 40));
      g.add(alongTrack(k, k.felt, hillShape(190, 130, [[0, 25, 32]]), L, 0, 3));
      g.add(k.cone(k.paint(TOY.white), 30, 22, 0, 120, 0, 18));
      for (const s of [-1, 1]) {
        g.add(alongTrack(k, k.paint(STONE), archShape(68, 68, [[0, 25, 32]]), 8, (s * L) / 2, 1));
        g.add(k.box(k.paint(DARK_STONE), 10, 5, 72, 1, (s * L) / 2, 68, 0));
      }
      for (const [x, y, z] of [
        [-40, 102, 50],
        [30, 100, -56],
        [-30, 118, -30],
        [50, 82, 70],
      ]) {
        g.add(k.cyl(k.paint(TOY.brown), 2, 8, x, y - 4, z, 2, 8), k.cone(k.paint(TOY.green), 9, 22, x, y + 2, z, 12));
      }
      return g;
    },
  },
  {
    id: "mech-double-tunnel",
    name: "Double-track tunnel",
    category: "Bridges & tunnels",
    tags: ["tunnel", "double track", "twin", "portal", "main line"],
    notes: "A broad hillside with twin arched bores for a double-track main line. Two trains pass in opposite directions, disappearing into the hill side by side.",
    build: (k) => {
      const arches: [number, number, number][] = [
        [-26, 22, 34],
        [26, 22, 34],
      ];
      const g = k.group(k.trackSlab(140, 0, 0, -26), k.trackSlab(140, 0, 0, 26));
      g.add(alongTrack(k, k.felt, hillShape(220, 120, arches), 90, 0, 3));
      g.add(alongTrack(k, k.paint(STONE), archShape(120, 76, arches), 8, 46, 1), alongTrack(k, k.paint(STONE), archShape(120, 76, arches), 8, -46, 1));
      for (const x of [-46, 46]) {
        g.add(k.box(k.paint(DARK_STONE), 10, 5, 124, 1, x, 76, 0));
        for (const z of [-26, 26]) g.add(k.box(k.paint(DARK_STONE), 9.5, 10, 8, 1, x, 52, z));
      }
      g.add(k.box(k.paint(TOY.white), 9, 9, 30, 1, 46, 62, 0));
      return g;
    },
  },
  {
    id: "mech-rock-cutting",
    name: "Rock cutting",
    category: "Bridges & tunnels",
    tags: ["cutting", "rock", "cliff", "gorge", "boulders"],
    notes: "The line runs through a channel blasted into rock, steep grey walls topped with grass and a few boulders. It ties track into a hill at ground level without a full tunnel; a rockfall could block it until a crane clears it.",
    build: (k) => {
      const g = k.group(k.trackSlab(200));
      const wall = new Shape();
      wall.moveTo(24, 0);
      wall.lineTo(90, 0);
      wall.lineTo(90, 64);
      wall.lineTo(40, 64);
      wall.lineTo(32, 40);
      wall.lineTo(28, 20);
      for (const s of [-1, 1]) {
        const m = k.extrude(k.paint(DARK_STONE), wall, 200, 0, 0, 0, 2);
        m.rotation.y = -s * (Math.PI / 2);
        g.add(m);
        g.add(k.box(k.felt, 200, 3, 50, 1, 0, 64, s * 65));
        g.add(k.box(k.paint(STONE), 200, 3, 6, 1, 0, 30, s * 31).rotateX(s * 0.4));
      }
      for (const [x, z, r] of [
        [-60, 30, 7],
        [20, -32, 9],
        [70, 34, 5],
        [-20, 74, 10],
      ])
        g.add(k.ball(k.paint(STONE), r, x, z > 60 ? 67 + r * 0.5 : r * 0.6, z, 0.75));
      return g;
    },
  },
  {
    id: "mech-river-ford",
    name: "River ford",
    category: "Bridges & tunnels",
    tags: ["ford", "river", "water", "splash", "shallow"],
    notes: "The track dips across a shallow river on a stone causeway, ripples lapping either side. A cheap low crossing; after rain the water might rise and close it until it drains.",
    build: (k) => {
      const g = k.group(k.box(k.water, 70, 1.6, 200, 0.5, 0, 0, 0));
      for (const s of [-1, 1]) g.add(k.box(k.felt, 30, 2.2, 200, 1, s * 50, 0, 0).translateY(-0.3));
      g.add(k.box(k.paint(STONE), 76, 6, 50, 2, 0, 0, 0), k.trackSlab(180, 0, 4, 0));
      for (let i = 0; i < 10; i++) g.add(k.ball(k.paint(i % 2 ? STONE : DARK_STONE), 3 + (i % 3), -32 + i * 7, 2, i % 2 ? 28 : -28, 0.6));
      for (let i = 0; i < 4; i++) g.add(named(k.ring(k.paint(TOY.sky), 5, 0.6, -20 + i * 14, 1.8, (i % 2 ? 1 : -1) * (40 + i * 8)), `rip${i}`));
      g.add(k.box(k.paint(TOY.white), 3, 30, 3, 1, 46, 0, -36), k.box(k.paint(TOY.yellow), 2, 12, 20, 1, 46, 26, -36));
      return g;
    },
    animate: (root, t) => {
      for (let i = 0; i < 4; i++) {
        const s = 0.6 + ((t * 0.5 + i * 0.25) % 1) * 1.6;
        part(root, `rip${i}`).scale.set(s, 1, s);
      }
    },
  },
  {
    id: "mech-road-over-rail",
    name: "Road over rail bridge",
    category: "Bridges & tunnels",
    tags: ["overbridge", "road", "road bridge", "crossing", "grade separated"],
    notes: "A road carried over the line on a brick bridge with ramps either side. No waiting at a crossing: road traffic and trains each keep moving, at the cost of more space.",
    build: (k) => {
      const Y = 70;
      const g = k.group(k.trackSlab(200));
      const brick = k.paint("#b5583f");
      for (const s of [-1, 1]) {
        g.add(k.box(brick, 60, Y - 8, 20, 2, 0, 0, s * 40));
        const bank = new Shape();
        bank.moveTo(-s * 50, 0);
        bank.lineTo(-s * 170, 0);
        bank.lineTo(-s * 50, Y);
        g.add(alongTrack(k, k.felt, bank, 50, 0, 1));
        g.add(strutZ(k, k.road, s * 50, Y + 1, s * 170, 1, 0, 2, 50));
      }
      g.add(k.box(brick, 60, 8, 120, 2, 0, Y - 8, 0), k.box(k.road, 50, 1, 120, 0.3, 0, Y, 0));
      for (const x of [-27, 27]) g.add(k.box(brick, 4, 8, 120, 1, x, Y, 0));
      g.add(k.box(k.paint(TOY.white), 1, 1, 60, 0, 0, Y + 1, 0), k.box(k.paint(TOY.cream), 1, 7, 30, 0.5, 30.5, Y - 8, 0));
      return g;
    },
  },
];

export const ASSETS: Asset[] = [...mechanisms, ...bridges];

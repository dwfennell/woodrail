import { Group, Shape, type Material, type Object3D } from "three";
import { TOY, type Kit } from "../kit";
import type { Asset } from "../types";

/**
 * Engines and rolling stock. Every vehicle shares the game's running gear: a beech chassis slab on four red wheels
 * (kit.bogies) with a magnet coupler at each end, the deck top at DECK. Bodies sit on the deck and face +x.
 */

/** Top of the chassis slab: where bodies and loads sit. */
const DECK = 19;
/** Windows look printed on: a pale sky-blue pane, as on the game's own cars. */
const PANE = "#a9cfe6";
/** A lit lamp, and the same lamp dark. */
const LIT = "#fff3a6";
/** Radius of the white dot on each wheel (and the crank pin the connecting rods ride on). */
const CRANK = 3.6;

const insetFor = (L: number) => Math.min(18, L / 2 - 10);

// ——— Running gear ———

/** Chassis slab, wheels (named "wheels", each with a dot so the turning shows) and couplers. */
function base(k: Kit, L: number, opts: { inset?: number; wheel?: string; chassis?: boolean; chassisColor?: string } = {}): Group {
  const g = new Group();
  const inset = opts.inset ?? insetFor(L);
  if (opts.chassis !== false) g.add(k.box(opts.chassisColor ? k.paint(opts.chassisColor) : k.wood, L - 4, 7, 30, 2, 0, 12, 0));
  const wheels = k.bogies(L, inset, opts.wheel ?? TOY.red);
  wheels.name = "wheels";
  for (const w of wheels.children) w.add(k.cylZ(k.paint(TOY.cream), 1.2, 0.8, 0, CRANK, Math.sign(w.position.z) * 2.7, 8));
  g.add(wheels);
  for (const s of [-1, 1] as const) {
    g.add(k.box(k.wood, 6, 4, 6, 0.8, s * (L / 2 - 1), 13, 0));
    g.add(k.coupler(L, s, 15));
  }
  return g;
}

/** Side rods linking the wheels on each side, riding the crank pins (named "rods"). */
function rods(k: Kit, L: number, color: string, inset = insetFor(L)): Group {
  const ax = L / 2 - inset;
  const g = new Group();
  g.name = "rods";
  for (const z of [-16.9, 16.9]) {
    g.add(k.box(k.paint(color), 2 * ax + 5, 2, 1.2, 0.5, 0, 6.5, z));
    for (const x of [-ax, ax]) g.add(k.cylZ(k.metal, 1.3, 2, x, 7.5, z + Math.sign(z) * 0.8, 10));
  }
  g.position.y = CRANK;
  return g;
}

/** A hoop round the x axis (boiler bands, tank straps). */
function hoop(k: Kit, mat: Material, r: number, tube: number, x: number, y: number, z = 0): Object3D {
  const m = k.ring(mat, r, tube, x, y, z, true);
  m.rotation.y = Math.PI / 2;
  return m;
}

/** Three smoke puffs that rise from (x, y, z) when animated (named "puffs"). */
function puffs(k: Kit, x: number, y: number, z = 0): Group {
  const g = k.many(3, (i) => k.ball(k.paint(TOY.white), 3, -i * 3, i * 7, 0));
  g.name = "puffs";
  g.position.set(x, y, z);
  return g;
}

/** A lamp: a dark bulb with a lit one over it whose visibility blinks (named `name`). */
function lamp(k: Kit, name: string, color: string, r: number, x: number, y: number, z: number): Group {
  const lit = k.ball(k.paint(color), r, x, y, z);
  lit.name = name;
  return k.group(k.ball(k.paint(TOY.black), r * 0.92, x, y, z), lit);
}

/** Printed windows along both sides: `n` panes across `len`, centred at x. */
function windows(k: Kit, len: number, n: number, h: number, y: number, x = 0, gap = 7, color = PANE): Group {
  const g = new Group();
  const pw = len / n;
  for (let i = 0; i < n; i++) for (const z of [-16.3, 16.3]) g.add(k.box(k.paint(color), pw - gap, h, 0.8, 0.3, x - len / 2 + pw * (i + 0.5), y, z));
  return g;
}

interface Steam {
  g: Group;
  /** The boiler and its fittings, turned with the boiler's tilt; x from the cab front, y from the boiler's axis. */
  bg: Group;
  cabX: number;
  cabLen: number;
  bLen: number;
  r: number;
  chimX: number;
}

/** A turned-wood steam engine: boiler, chimney, dome, cab with a rounded roof, buffer beam, side rods. */
function steam(
  k: Kit,
  o: { L: number; body: string; trim: string; r?: number; cabLen?: number; tanks?: "side" | "saddle"; dome?: boolean; wheel?: string; tilt?: number; lift?: number; chimney?: string },
): Steam {
  const L = o.L;
  const r = o.r ?? 11;
  const cabLen = o.cabLen ?? Math.round(L * 0.3);
  const body = k.paint(o.body);
  const trim = k.paint(o.trim);
  const g = base(k, L, { wheel: o.wheel });
  g.add(rods(k, L, TOY.grey));
  const cabX = -L / 2 + 2 + cabLen / 2;
  const bBack = cabX + cabLen / 2;
  const bLen = L / 2 - 4 - bBack;
  const bg = new Group();
  bg.position.set(bBack, DECK + r + (o.lift ?? 0), 0);
  bg.rotation.z = o.tilt ?? 0;
  g.add(bg);
  bg.add(k.cylX(body, r, bLen, bLen / 2, 0, 0));
  bg.add(k.cylX(k.metal, r * 0.9, 2.5, bLen + 1, 0, 0));
  bg.add(k.ball(trim, 1.6, bLen + 2.6, 0, 0));
  for (const f of [0.3, 0.7]) bg.add(hoop(k, trim, r + 0.2, 1, bLen * f, 0));
  const chimX = bLen - 7;
  bg.add(k.lathe(o.chimney ? k.paint(o.chimney) : k.metal, [[3.6, 0], [3.6, 9], [5.4, 12.5], [5.4, 14.5], [0, 14.5]], chimX, r - 2, 0, 20));
  if (o.dome !== false) bg.add(k.ball(trim, 4.5, bLen * 0.42, r - 0.5, 0));
  if (o.tanks === "side") for (const s of [-1, 1]) bg.add(k.box(body, bLen * 0.68, r * 1.25, 7, 1.5, bLen * 0.38, -r, s * 12.5));
  if (o.tanks === "saddle") bg.add(k.cylX(body, r + 3, bLen * 0.6, bLen * 0.4, 2.5, 0));
  // Cab: windows printed on each side, two round spectacle windows looking forward over the boiler.
  g.add(k.box(body, cabLen, 30, 32, 2.5, cabX, DECK, 0));
  g.add(windows(k, cabLen, 1, 9, DECK + 16, cabX, cabLen * 0.4));
  for (const z of [-9, 9]) g.add(k.cylX(k.paint(PANE), 3, 0.8, bBack + 0.3, DECK + 25, z, 16));
  g.add(k.box(trim, cabLen + 5, 3.5, 36, 1.6, cabX, DECK + 30, 0));
  // Buffer beam and buffers.
  g.add(k.box(trim, 4, 8, 32, 1.2, L / 2 - 4, 10.5, 0));
  for (const z of [-10, 10]) g.add(k.cylX(k.metal, 2.2, 3, L / 2 - 0.5, 14.5, z, 12));
  return { g, bg, cabX, cabLen, bLen, r, chimX };
}

/** A plain coach body with printed windows and a rounded roof. */
function coach(k: Kit, L: number, color: string, roof: string, o: { h?: number; n?: number; winH?: number; band?: string } = {}): Group {
  const g = base(k, L);
  const h = o.h ?? 30;
  const len = L - 8;
  g.add(k.box(k.paint(color), len, h, 32, 2.5, 0, DECK, 0));
  if (o.band) g.add(k.box(k.paint(o.band), len - 2, 4, 32.6, 0.5, 0, DECK + 4, 0));
  const winH = o.winH ?? 10;
  g.add(windows(k, len, o.n ?? 4, winH, DECK + h * 0.62 - winH / 2));
  g.add(k.box(k.paint(roof), len + 4, 3.5, 36, 1.6, 0, DECK + h, 0));
  return g;
}

/** A closed van: body, roof, and a sliding door outlined on each side. */
function van(k: Kit, L: number, color: string, roof: string, h = 28): Group {
  const g = base(k, L);
  g.add(k.box(k.paint(color), L - 8, h, 32, 2.5, 0, DECK, 0));
  g.add(k.box(k.paint(roof), L - 4, 3.5, 36, 1.6, 0, DECK + h, 0));
  for (const z of [-16.3, 16.3]) {
    for (const x of [-11, 11]) g.add(k.box(k.paint(roof), 1.6, h - 6, 0.8, 0.3, x, DECK + 3, z));
    g.add(k.box(k.paint(roof), 24, 1.6, 0.8, 0.3, 0, DECK + 2, z));
  }
  return g;
}

/** A tank wagon: barrel on saddles, rounded ends, straps, a filler dome. Returns the barrel's centre height. */
function tanker(k: Kit, L: number, color: string, band: string): { g: Group; y: number; len: number } {
  const g = base(k, L);
  const r = 12;
  const len = L - 22;
  const y = DECK + 3 + r;
  for (const x of [-len / 3, len / 3]) g.add(k.box(k.paint(band), 6, 6, 26, 1, x, DECK, 0));
  g.add(k.cylX(k.paint(color), r, len, 0, y, 0));
  for (const s of [-1, 1]) {
    const cap = k.ball(k.paint(color), r, (s * len) / 2, y, 0);
    cap.scale.x = 0.45;
    g.add(cap);
  }
  for (const x of [-len / 3, len / 3]) g.add(hoop(k, k.paint(band), r + 0.2, 1, x, y));
  g.add(k.cyl(k.paint(band), 4.5, 4, 0, y + r - 1, 0, 4.5, 20));
  g.add(k.cyl(k.paint(band), 5.2, 1.4, 0, y + r + 3, 0, 5.2, 20));
  return { g, y, len };
}

/** A coal tender: a box body with a heaped load. */
function tender(k: Kit, L: number, color: string, trim: string): Group {
  const g = base(k, L, { inset: 14 });
  g.add(k.box(k.paint(color), L - 6, 18, 32, 2.5, 0, DECK, 0));
  g.add(k.box(k.paint(trim), L - 4, 2.5, 33, 1, 0, DECK + 16, 0));
  coalHeap(k, g, L - 14, 26, DECK + 15);
  return g;
}

/** A heap of coal lumps filling a `len` × `width` load whose surface is about at y. */
function coalHeap(k: Kit, g: Group, len: number, width: number, y: number): void {
  g.add(k.box(k.coal, len, 2, width, 0.5, 0, y - 1, 0));
  const nx = Math.round(len / 7);
  for (let i = 0; i < nx; i++)
    for (let j = 0; j < 4; j++) {
      const x = -len / 2 + 3.5 + i * ((len - 7) / (nx - 1));
      const z = -width / 2 + 3.5 + j * ((width - 7) / 3) + ((i % 2) - 0.5) * 2;
      const crown = 1 - Math.abs(x / len) * 1.4 - Math.abs(z / width) * 0.8;
      const lump = k.ball(k.coal, 3 + ((i + j) % 3) * 0.4, x, y + crown * 4, z, 0.8);
      g.add(lump);
    }
}

/** A little toy car (for the transporter): body, cabin, four wheels. About 26 long, 15 high. */
function toyCar(k: Kit, color: string, x: number, y: number): Group {
  const g = new Group();
  g.add(k.box(k.paint(color), 26, 7, 14, 2.5, 0, 2.5, 0));
  g.add(k.box(k.paint(color), 13, 6, 12, 2.5, -2, 9, 0));
  g.add(k.box(k.paint(PANE), 13.4, 3.5, 12.4, 1, -2, 10.5, 0));
  for (const wx of [-8, 8]) for (const wz of [-6.5, 6.5]) g.add(k.cylZ(k.paint(TOY.black), 2.6, 2, wx, 2.6, wz, 14));
  return k.at(g, x, y, 0);
}

/** A star outline (for emblems), centred on (0, 0). */
function star(r: number, inner = r * 0.45): [number, number][] {
  const pts: [number, number][] = [];
  for (let i = 0; i < 10; i++) {
    const a = Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 ? inner : r;
    pts.push([Math.cos(a) * rr, Math.sin(a) * rr]);
  }
  return pts;
}

// ——— Animation helpers (parts found once per root, then cached: nothing allocated per frame) ———

const partCache = new WeakMap<Object3D, Map<string, Object3D[]>>();
const NONE: Object3D[] = [];

function parts(root: Object3D, name: string): Object3D[] {
  let byName = partCache.get(root);
  if (!byName) partCache.set(root, (byName = new Map()));
  let list = byName.get(name);
  if (!list) {
    const found: Object3D[] = [];
    root.traverse((o) => {
      if (o.name === name) found.push(o);
    });
    list = found.length ? found : NONE;
    byName.set(name, list);
  }
  return list;
}

/** Turn the wheels (and side rods) as if rolling forward. */
function roll(root: Object3D, t: number, speed = 3): void {
  const a = -t * speed;
  for (const w of parts(root, "wheels")) for (const c of w.children) c.rotation.z = a;
  for (const r of parts(root, "rods")) r.position.set(-CRANK * Math.sin(a), CRANK * Math.cos(a), 0);
}

/** Smoke rising from every "puffs" group. */
function smoke(root: Object3D, t: number): void {
  for (const p of parts(root, "puffs")) {
    const n = p.children.length;
    for (let i = 0; i < n; i++) {
      const f = (t * 0.7 + i / n) % 1;
      const c = p.children[i];
      c.position.set(-f * 12, f * 24, 0);
      c.scale.setScalar(0.4 + f * 1.1);
    }
  }
}

function blink(root: Object3D, name: string, on: boolean): void {
  for (const p of parts(root, name)) p.visible = on;
}

/** Engines: wheels, rods and smoke. */
const chuff = (root: Object3D, t: number) => {
  roll(root, t);
  smoke(root, t);
};

/** Raise a pantograph: lower arm, upper arm and head (built from `panto`). */
function setPanto(arm1: Object3D, arm2: Object3D, head: Object3D, a: number): void {
  arm1.rotation.z = a;
  arm2.position.set(-10 + 18 * Math.cos(a), 18 * Math.sin(a), 0);
  arm2.rotation.z = Math.PI - a;
  head.position.set(-10, 36 * Math.sin(a) + 1, 0);
}

// ——— Engines ———

const engines: Asset[] = [
  {
    id: "train-tank-engine",
    name: "Tank engine",
    category: "Trains",
    tags: ["engine", "steam", "tank", "green"],
    notes: "A short steam engine carrying its water in side tanks, so it needs no tender. A good starter engine: cheap, nimble on tight curves, but it must stop at a water tower more often.",
    build: (k) => {
      const s = steam(k, { L: 80, body: TOY.green, trim: TOY.red, tanks: "side" });
      s.bg.add(puffs(k, s.chimX, s.r + 15));
      return s.g;
    },
    animate: chuff,
  },
  {
    id: "train-tender-engine",
    name: "Tender engine and tender",
    category: "Trains",
    tags: ["engine", "steam", "tender", "express", "blue"],
    notes: "A long-boilered express engine coupled to its coal tender. Faster than a tank engine and goes further between coal stops; the tender could be swapped for a bigger one as an upgrade.",
    build: (k) => {
      const s = steam(k, { L: 92, body: TOY.blue, trim: TOY.red, r: 12, cabLen: 26 });
      s.bg.add(puffs(k, s.chimX, s.r + 15));
      // A second pair of driving wheels is suggested by a big splasher over each side.
      for (const z of [-15, 15]) s.g.add(k.box(k.paint(TOY.red), 30, 4, 3, 1, 4, 12.5, z));
      const t = tender(k, 56, TOY.blue, TOY.red);
      return k.group(k.at(s.g, 30, 0, 0), k.at(t, -49, 0, 0));
    },
    animate: chuff,
  },
  {
    id: "train-saddle-tank",
    name: "Saddle tank engine",
    category: "Trains",
    tags: ["engine", "steam", "saddle tank", "industrial", "red"],
    notes: "A stubby works engine with its water in a tank slung over the boiler like a saddle. Lives at a quarry or harbour: strong but slow, ideal for shunting heavy wagons.",
    build: (k) => {
      const s = steam(k, { L: 72, body: TOY.red, trim: TOY.black, tanks: "saddle", dome: false, cabLen: 24, r: 10 });
      s.bg.add(puffs(k, s.chimX, s.r + 15));
      return s.g;
    },
    animate: chuff,
  },
  {
    id: "train-shunter",
    name: "Diesel shunter",
    category: "Trains",
    tags: ["engine", "diesel", "shunter", "yard", "orange", "beacon"],
    notes: "A small yard diesel with a long hood, a tall cab and a flashing roof beacon. Could auto-sort wagons in a yard: tap it, then tap the siding each wagon should go to.",
    build: (k) => {
      const L = 66;
      const g = base(k, L);
      const orange = k.paint(TOY.orange);
      g.add(k.box(orange, 34, 18, 26, 3, 12, DECK, 0));
      for (let i = 0; i < 4; i++) for (const z of [-13.2, 13.2]) g.add(k.box(k.cut, 2, 10, 0.6, 0.3, 3 + i * 6, DECK + 4, z));
      g.add(k.box(orange, 22, 30, 32, 2.5, -19, DECK, 0));
      g.add(windows(k, 22, 1, 9, DECK + 17, -19, 8));
      g.add(k.box(k.paint(PANE), 0.8, 8, 22, 0.3, -7.8, DECK + 20, 0));
      g.add(k.box(k.paint(TOY.black), 26, 3, 36, 1.4, -19, DECK + 30, 0));
      g.add(k.cyl(k.metal, 2, 6, 22, DECK + 17, 0, 2, 12));
      // Hazard-striped buffer beams.
      for (const x of [L / 2 - 2, -L / 2 + 2])
        for (let i = 0; i < 5; i++) g.add(k.box(k.paint(i % 2 ? TOY.black : TOY.yellow), 4, 8, 6.4, 0.4, x, 10.5, -12.8 + i * 6.4));
      g.add(lamp(k, "beacon", "#ffb347", 2.7, -19, DECK + 35.5, 0));
      g.add(k.ball(k.paint(LIT), 2, L / 2 - 4, DECK + 8, 0));
      return g;
    },
    animate: (root, t) => {
      roll(root, t, 1.5);
      blink(root, "beacon", Math.floor(t * 3) % 2 === 0);
    },
  },
  {
    id: "train-diesel",
    name: "Mainline diesel",
    category: "Trains",
    tags: ["engine", "diesel", "mainline", "double cab", "blue"],
    notes: "A long double-cabbed diesel with yellow noses and roof fans. Drives either way without a turntable, so it suits point-to-point lines with no loop at the end.",
    build: (k) => {
      const L = 110;
      const g = base(k, L, { inset: 20 });
      g.add(k.box(k.paint(TOY.blue), 104, 26, 32, 4, 0, DECK, 0));
      g.add(k.box(k.paint(TOY.cream), 100, 3, 32.6, 0.5, 0, DECK + 6, 0));
      for (const s of [-1, 1]) {
        g.add(k.box(k.paint(TOY.yellow), 3, 16, 30, 1.2, s * 51.5, DECK + 1, 0));
        g.add(k.box(k.paint(PANE), 1, 8, 24, 0.4, s * 52.2, DECK + 16, 0));
        g.add(k.ball(k.paint(LIT), 2, s * 53, DECK + 5, 0));
        for (const z of [-16.3, 16.3]) g.add(k.box(k.paint(PANE), 9, 8, 0.8, 0.3, s * 43, DECK + 15, z));
      }
      for (let i = 0; i < 6; i++) for (const z of [-16.3, 16.3]) g.add(k.box(k.cut, 2, 9, 0.6, 0.3, -15 + i * 6, DECK + 13, z));
      for (const x of [-16, 16]) {
        g.add(k.cyl(k.metal, 6, 1.5, x, DECK + 25.5, 0, 6, 20));
        const fan = k.box(k.paint(TOY.grey), 10, 0.8, 1.6, 0.3, x, DECK + 27, 0);
        fan.name = "fan";
        g.add(fan);
      }
      return g;
    },
    animate: (root, t) => {
      roll(root, t);
      for (const f of parts(root, "fan")) f.rotation.y = t * 6;
    },
  },
  {
    id: "train-electric",
    name: "Electric engine",
    category: "Trains",
    tags: ["engine", "electric", "pantograph", "overhead wire", "red"],
    notes: "A boxy electric engine whose pantograph rises to touch an overhead wire. Fast and quiet but only runs where wire masts have been built, an interesting trade-off for the player.",
    build: (k) => {
      const L = 100;
      const g = base(k, L, { inset: 20 });
      g.add(k.box(k.paint(TOY.red), 94, 26, 32, 4, 0, DECK, 0));
      g.add(k.box(k.paint(TOY.grey), 60, 2, 22, 0.6, 0, DECK + 26, 0));
      for (const s of [-1, 1]) {
        g.add(k.box(k.paint(PANE), 1, 8, 24, 0.4, s * 47.2, DECK + 15, 0));
        g.add(k.ball(k.paint(LIT), 2, s * 48, DECK + 5, 0));
      }
      g.add(windows(k, 80, 5, 7, DECK + 14));
      const bolt: [number, number][] = [[1, 7], [5, 7], [2, 1], [5, 1], [-2, -8], [0, -1], [-3, -1]];
      for (const z of [-16.4, 16.4]) g.add(k.extrude(k.paint(TOY.yellow), bolt, 1, 0, DECK + 7, z, 0.3));
      for (const x of [-6, 6, 26, 34]) g.add(k.cyl(k.paint(TOY.white), 1.6, 2.5, x, DECK + 28, 0, 1.6, 10));
      const panto = new Group();
      panto.position.set(20, DECK + 30, 0);
      const arm1 = new Group();
      arm1.name = "arm1";
      arm1.position.x = -10;
      arm1.add(k.box(k.metal, 18, 1.4, 12, 0.5, 9, -0.7, 0));
      const arm2 = new Group();
      arm2.name = "arm2";
      arm2.add(k.box(k.metal, 18, 1.4, 6, 0.5, 9, -0.7, 0));
      const head = new Group();
      head.name = "panhead";
      head.add(k.cylZ(k.metal, 1, 26, 0, 0, 0, 10), k.box(k.paint(TOY.grey), 4, 1.5, 20, 0.5, 0, -2, 0));
      panto.add(arm1, arm2, head);
      setPanto(arm1, arm2, head, 0.6);
      g.add(panto);
      return g;
    },
    animate: (root, t) => {
      roll(root, t);
      const a = 0.25 + 0.4 * (0.5 + 0.5 * Math.sin(t * 0.8));
      setPanto(parts(root, "arm1")[0], parts(root, "arm2")[0], parts(root, "panhead")[0], a);
    },
  },
  {
    id: "train-high-speed",
    name: "High-speed power car",
    category: "Trains",
    tags: ["engine", "high speed", "bullet", "nose", "modern", "white"],
    notes: "A sleek power car with a long sloping nose and a red stripe. The fastest engine, but it needs gentle curves; running it on tight bends could cost passengers' comfort points.",
    build: (k) => {
      const L = 110;
      const g = base(k, L, { inset: 20 });
      const white = k.paint(TOY.white);
      g.add(k.box(white, 72, 28, 32, 3, -17, DECK, 0));
      const nose = new Shape();
      nose.moveTo(0, 0);
      nose.lineTo(36, 0);
      nose.lineTo(36, 5);
      nose.quadraticCurveTo(30, 22, 0, 28);
      nose.lineTo(0, 0);
      g.add(k.extrude(white, nose, 31, 18, DECK, 0, 1));
      const screen = k.box(k.paint(TOY.black), 15, 1, 24, 0.4, 0, 0, 0);
      screen.position.set(18 + 20.2, DECK + 21.8, 0);
      screen.rotation.z = -0.47;
      g.add(screen);
      g.add(k.box(k.paint(TOY.red), 104, 3, 32.4, 0.6, 0, DECK + 7, 0));
      g.add(k.ball(k.paint(LIT), 1.8, 53, DECK + 3.5, 0));
      g.add(windows(k, 60, 6, 6, DECK + 15, -20, 4));
      g.add(k.box(k.paint(TOY.grey), 40, 2, 20, 0.6, -20, DECK + 28, 0));
      return g;
    },
    animate: (root, t) => roll(root, t, 5),
  },
  {
    id: "train-tram",
    name: "Tram",
    category: "Trains",
    tags: ["engine", "tram", "street", "trolley pole", "town", "cream", "green"],
    notes: "A town tram with open platforms and a trolley pole. Runs on street track through the town square, stopping at every corner for peg passengers.",
    build: (k) => {
      const L = 76;
      const g = base(k, L, { inset: 16 });
      const green = k.paint(TOY.green);
      g.add(k.box(k.paint(TOY.cream), 52, 30, 32, 2.5, 0, DECK, 0));
      g.add(k.box(green, 53, 12, 32.6, 2, 0, DECK, 0));
      g.add(windows(k, 52, 3, 10, DECK + 16));
      for (const s of [-1, 1]) {
        g.add(k.box(green, 3, 14, 28, 1, s * 35, DECK, 0));
        for (const z of [-14, 14]) g.add(k.cyl(k.metal, 0.9, 30, s * 35, DECK, z, 0.9, 10));
        g.add(k.ball(k.paint(LIT), 2, s * 36.6, DECK + 9, 0));
      }
      g.add(k.box(green, 76, 3.5, 34, 1.6, 0, DECK + 30, 0));
      g.add(k.box(k.paint(TOY.black), 3, 6, 22, 0.6, 33, DECK + 33.5, 0));
      g.add(k.box(k.paint(TOY.yellow), 0.6, 4, 18, 0.2, 34.6, DECK + 34.5, 0));
      g.add(k.peg(TOY.blue, TOY.black, 29, DECK, 6));
      const pole = new Group();
      pole.name = "pole";
      pole.position.set(-8, DECK + 34, 0);
      pole.rotation.z = 1.1;
      pole.add(k.cyl(k.metal, 0.8, 40, 0, 0, 0, 0.8, 10), k.cylZ(k.paint(TOY.black), 2, 2.5, 0, 40, 0, 12));
      g.add(k.cyl(k.paint(TOY.black), 3, 3, -8, DECK + 33, 0, 3, 14), pole);
      return g;
    },
    animate: (root, t) => {
      roll(root, t, 2);
      for (const p of parts(root, "pole")) p.rotation.z = 1.1 + Math.sin(t * 5) * 0.03;
    },
  },
  {
    id: "train-steam-railcar",
    name: "Steam railcar",
    category: "Trains",
    tags: ["engine", "railcar", "steam", "branch line", "passenger", "brown"],
    notes: "A single coach with its own little upright boiler in the front compartment. A cheap way to serve a sleepy branch line: one car, few passengers, no engine needed.",
    build: (k) => {
      const L = 96;
      const g = base(k, L);
      const brown = k.paint(TOY.brown);
      g.add(k.box(brown, 64, 30, 32, 2.5, -12, DECK, 0));
      g.add(k.box(k.paint(TOY.cream), 62, 12, 32.6, 2, -12, DECK + 14, 0));
      g.add(windows(k, 64, 4, 9, DECK + 15.5, -12));
      g.add(k.box(brown, 3, 14, 30, 1, 42, DECK, 0));
      for (const z of [-14, 14]) g.add(k.cyl(k.metal, 0.9, 30, 43, DECK, z, 0.9, 10));
      g.add(k.cyl(k.paint(TOY.black), 6.5, 32, 32, DECK, 0, 6.5, 20));
      g.add(hoop(k, k.paint(TOY.yellow), 6.7, 0.8, 32, DECK + 12));
      g.add(k.cyl(k.metal, 2.6, 8, 32, DECK + 32, 0, 3, 14));
      g.add(k.box(k.paint(TOY.cream), 92, 3.5, 36, 1.6, 0, DECK + 30, 0));
      g.add(k.peg(TOY.blue, TOY.black, 24, DECK, 9));
      g.add(puffs(k, 32, DECK + 42));
      return g;
    },
    animate: chuff,
  },
  {
    id: "train-battery-engine",
    name: "Battery engine with button",
    category: "Trains",
    tags: ["engine", "battery", "button", "headlights", "yellow", "modern"],
    notes: "A rounded battery engine with a big red button on its roof: press it and the headlights come on and it sets off. In game, tapping the button could start or stop any engine, a one-touch control for small players.",
    build: (k) => {
      const L = 70;
      const g = base(k, L, { inset: 16 });
      g.add(k.box(k.paint(TOY.yellow), 60, 24, 30, 7, 0, DECK, 0));
      g.add(k.box(k.paint(PANE), 0.8, 8, 20, 0.3, 30, DECK + 13, 0));
      g.add(windows(k, 24, 1, 8, DECK + 13, 18, 8));
      g.add(k.box(k.paint(TOY.grey), 26, 1.4, 18, 0.5, -10, DECK + 23.5, 0));
      g.add(k.box(k.paint(TOY.red), 8, 0.8, 2, 0.2, -10, DECK + 24.9, 0), k.box(k.paint(TOY.red), 2, 0.8, 8, 0.2, -10, DECK + 24.9, 0));
      g.add(k.cyl(k.paint(TOY.cream), 6, 3, 14, DECK + 23, 0, 6, 24));
      const button = k.cyl(k.paint(TOY.red), 4.5, 3, 14, DECK + 26, 0, 4.2, 24);
      button.name = "button";
      button.userData.y0 = button.position.y;
      g.add(button);
      for (const z of [-9, 9]) g.add(lamp(k, "light", LIT, 2.4, 29.5, DECK + 6, z));
      return g;
    },
    animate: (root, t) => {
      const phase = t % 3;
      for (const b of parts(root, "button")) b.position.y = (b.userData.y0 as number) - (phase < 0.3 ? 1.6 : 0);
      blink(root, "light", phase >= 0.3 && phase < 2.5);
      roll(root, phase < 0.3 ? 0 : t, 2.5);
    },
  },
  {
    id: "train-rack-engine",
    name: "Rack mountain engine",
    category: "Trains",
    tags: ["engine", "steam", "rack", "cog", "mountain", "incline"],
    notes: "A mountain engine with a tilted boiler (level when climbing) and a cog wheel underneath that grips a toothed rack. Could climb steep rack-track up hills that ordinary engines can't.",
    build: (k) => {
      const s = steam(k, { L: 80, body: TOY.red, trim: TOY.black, tanks: "side", cabLen: 26, tilt: -0.1, lift: 4, r: 10 });
      s.bg.add(puffs(k, s.chimX, s.r + 15));
      const cog = new Group();
      cog.name = "cog";
      cog.position.set(0, 7, 0);
      cog.add(k.cylZ(k.metal, 4.2, 6, 0, 0, 0, 16));
      for (let i = 0; i < 10; i++) {
        const tooth = k.group(k.box(k.paint(TOY.grey), 1.8, 2.4, 6, 0.3, 0, 3.8, 0));
        tooth.rotation.z = (i / 10) * Math.PI * 2;
        cog.add(tooth);
      }
      s.g.add(cog);
      return s.g;
    },
    animate: (root, t) => {
      chuff(root, t);
      for (const c of parts(root, "cog")) c.rotation.z = -t * 4;
    },
  },
  {
    id: "train-snowplough-engine",
    name: "Snowplough engine",
    category: "Trains",
    tags: ["engine", "steam", "snow", "plough", "winter", "blue"],
    notes: "A tank engine with a yellow V-plough on the front and snow on its roof. In a winter map, snowdrifts could block the line until the plough clears them.",
    build: (k) => {
      const L = 80;
      const s = steam(k, { L, body: TOY.blue, trim: TOY.red, tanks: "side" });
      s.bg.add(puffs(k, s.chimX, s.r + 15));
      const yellow = k.paint(TOY.yellow);
      for (const side of [-1, 1]) {
        const blade = k.box(yellow, 21.5, 14, 2.5, 0.8, 0, 0, 0);
        blade.position.set(L / 2 + 6, 9, side * 8);
        blade.rotation.y = side * 0.85;
        s.g.add(blade);
      }
      s.g.add(k.box(yellow, 4, 4, 30, 1, L / 2 - 2, 16, 0));
      const white = k.paint(TOY.white);
      const snow = k.ball(white, 1, s.cabX, DECK + 33.5, 0);
      snow.scale.set(14, 3, 16);
      s.g.add(snow);
      for (const z of [-7, 7]) s.g.add(k.ball(white, 3, L / 2 + 8, 16.5, z, 0.6));
      return s.g;
    },
    animate: chuff,
  },
  {
    id: "train-fire-engine",
    name: "Fire engine train",
    category: "Trains",
    tags: ["engine", "fire", "ladder", "rescue", "water", "red", "siren"],
    notes: "A red rescue engine with a water tank, hose reel, a ladder that raises and flashing blue lamps. A burning barn could call it out; the player must route it there before the fire spreads.",
    build: (k) => {
      const L = 96;
      const g = base(k, L);
      const red = k.paint(TOY.red);
      g.add(k.box(red, 24, 28, 32, 3, 33, DECK, 0));
      g.add(windows(k, 24, 1, 9, DECK + 15, 33, 8));
      g.add(k.box(k.paint(PANE), 0.8, 9, 24, 0.3, 45.2, DECK + 15, 0));
      g.add(k.box(k.paint(TOY.white), 24.4, 3, 32.4, 0.5, 33, DECK + 6, 0));
      g.add(k.cylX(red, 11, 44, -2, DECK + 11, 0));
      for (const x of [-16, 12]) g.add(hoop(k, k.paint(TOY.white), 11.2, 1, x, DECK + 11));
      for (const x of [-18, 14]) g.add(k.box(k.paint(TOY.grey), 3, 25, 4, 0.6, x, DECK, 0));
      g.add(k.cylZ(k.wood, 7, 28, -38, DECK + 8, 0));
      g.add(k.cylZ(k.paint(TOY.yellow), 7.6, 24, -38, DECK + 8, 0));
      g.add(k.cyl(k.paint(TOY.yellow), 2.5, 3, 46.5, DECK + 10, 0, 2.5, 14));
      for (const [i, z] of [[0, -6], [1, 6]] as const) {
        g.add(lamp(k, i ? "lamp-b" : "lamp-a", "#5aa9ff", 2.6, 38, DECK + 30.5, z));
      }
      const ladder = new Group();
      ladder.name = "ladder";
      ladder.position.set(-42, DECK + 26, 0);
      for (const z of [-5, 5]) ladder.add(k.box(k.wood, 72, 1.6, 1.6, 0.4, 36, -0.8, z));
      for (let i = 0; i < 12; i++) ladder.add(k.cylZ(k.wood, 0.7, 10, 3 + i * 6, 0, 0, 8));
      g.add(ladder);
      g.add(k.box(k.paint(TOY.grey), 4, 7, 14, 0.8, -42, DECK + 19, 0));
      g.add(k.peg(TOY.blue, TOY.yellow, -38, DECK + 15, 0));
      return g;
    },
    animate: (root, t) => {
      roll(root, t);
      const on = Math.floor(t * 4) % 2 === 0;
      blink(root, "lamp-a", on);
      blink(root, "lamp-b", !on);
      for (const l of parts(root, "ladder")) l.rotation.z = 0.35 * (0.5 - 0.5 * Math.cos(t * 0.6));
    },
  },
  {
    id: "train-circus-engine",
    name: "Circus engine",
    category: "Trains",
    tags: ["engine", "steam", "circus", "balloons", "stars", "purple"],
    notes: "A purple and gold saddle-tank engine with a striped chimney, stars on its cab and balloons tied to the roof. Heads the circus train; when it arrives the circus tent goes up in town.",
    build: (k) => {
      const s = steam(k, { L: 84, body: TOY.purple, trim: TOY.yellow, tanks: "saddle", chimney: TOY.red });
      const white = k.paint(TOY.white);
      for (const h of [3, 7, 11]) s.bg.add(k.ring(white, 3.75, 0.7, s.chimX, s.r - 2 + h, 0));
      s.bg.add(puffs(k, s.chimX, s.r + 15));
      for (const z of [-16.6, 16.6]) s.g.add(k.extrude(k.paint(TOY.yellow), star(5), 1.2, s.cabX, DECK + 8, z, 0.3));
      const balloons = new Group();
      balloons.name = "balloons";
      balloons.position.set(s.cabX, DECK + 33.5, 0);
      for (const [i, c] of [TOY.red, TOY.yellow, TOY.sky].entries()) {
        const b = k.group(k.cyl(k.paint(TOY.white), 0.3, 18, 0, 0, 0, 0.3, 6), k.ball(k.paint(c), 4.5, 0, 22, 0, 1.15));
        b.position.set(-3 + i * 3, 0, -5 + i * 5);
        b.rotation.x = (i - 1) * 0.3;
        balloons.add(b);
      }
      s.g.add(balloons);
      return s.g;
    },
    animate: (root, t) => {
      chuff(root, t);
      for (const b of parts(root, "balloons")) b.children.forEach((c, i) => (c.rotation.z = Math.sin(t * 2 + i * 1.7) * 0.15));
    },
  },
  {
    id: "train-mail-engine",
    name: "Mail engine",
    category: "Trains",
    tags: ["engine", "steam", "mail", "post", "letters", "red"],
    notes: "A red engine with an envelope on its cab and a swing-out arm that snatches mail bags from lineside posts without stopping. Picks up and drops mail at towns along its route for bonus points.",
    build: (k) => {
      const s = steam(k, { L: 84, body: TOY.red, trim: TOY.black });
      s.bg.add(puffs(k, s.chimX, s.r + 15));
      for (const z of [-16.4, 16.4]) {
        s.g.add(k.box(k.paint(TOY.cream), 11, 7, 0.6, 0.2, s.cabX, DECK + 5, z));
        for (const side of [-1, 1]) {
          const flap = k.box(k.paint(TOY.red), 6.5, 0.8, 0.8, 0.2, 0, 0, 0);
          flap.position.set(s.cabX + side * 2.6, DECK + 10, z + Math.sign(z) * 0.4);
          flap.rotation.z = side * 0.55;
          s.g.add(flap);
        }
      }
      const arm = new Group();
      arm.name = "arm";
      arm.position.set(s.cabX + s.cabLen / 2 - 2, DECK + 22, 16.5);
      arm.add(k.cyl(k.metal, 1.4, 4, 0, -2, 0, 1.4, 10));
      arm.add(k.box(k.paint(TOY.black), 1.6, 1.6, 14, 0.4, 0, -0.8, 7));
      arm.add(k.cyl(k.paint(TOY.brown), 0.4, 4, 0, -4.5, 14, 0.4, 6));
      arm.add(k.capsule(k.paint(TOY.cream), 3, 4, 0, -14.5, 14));
      s.g.add(arm);
      return s.g;
    },
    animate: (root, t) => {
      chuff(root, t);
      for (const a of parts(root, "arm")) a.rotation.y = (Math.PI / 2) * (0.5 + 0.5 * Math.sin(t));
    },
  },
];

// ——— Wagons ———

const wagons: Asset[] = [
  {
    id: "train-open-wagon",
    name: "Open wagon with sacks",
    category: "Wagons",
    tags: ["wagon", "open", "goods", "sacks", "flour", "green"],
    notes: "A plain low-sided wagon carrying sacks of flour. The general-purpose goods wagon: a mill could fill it and a bakery in town could ask for it.",
    build: (k) => {
      const L = 80;
      const g = base(k, L);
      const green = k.paint(TOY.green);
      g.add(k.box(green, 72, 3, 32, 1, 0, DECK, 0));
      for (const z of [-14.5, 14.5]) g.add(k.box(green, 72, 14, 3, 1, 0, DECK, z));
      for (const x of [-34.5, 34.5]) g.add(k.box(green, 3, 14, 32, 1, x, DECK, 0));
      for (const z of [-15, 15]) for (const x of [-18, 0, 18]) g.add(k.box(k.paint(TOY.cream), 1.4, 12, 0.6, 0.2, x, DECK + 1, z + Math.sign(z) * 1.8));
      for (const [i, x] of [-22, -8, 7, 21].entries()) {
        const sack = k.group(k.capsule(k.paint(TOY.cream), 4.5, 4, 0, 0, 0), k.ring(k.paint(TOY.brown), 2.6, 0.6, 0, 11.5, 0));
        sack.position.set(x, DECK + 2, i % 2 ? 5 : -5);
        sack.rotation.z = i % 2 ? 0.2 : -0.15;
        g.add(sack);
      }
      return g;
    },
    animate: (root, t) => roll(root, t),
  },
  {
    id: "train-coal-tender",
    name: "Coal tender",
    category: "Wagons",
    tags: ["tender", "coal", "water", "fuel", "steam"],
    notes: "A tender heaped with coal and with a water filler at the back. Coupled behind a steam engine it stretches how far the engine runs between coal stages.",
    build: (k) => {
      const g = tender(k, 64, TOY.green, TOY.red);
      g.add(k.cyl(k.paint(TOY.black), 4, 3, -24, DECK + 18, 0, 4, 16));
      g.add(k.cyl(k.paint(TOY.red), 4.6, 1.2, -24, DECK + 21, 0, 4.6, 16));
      g.add(k.box(k.paint(TOY.cream), 1, 5, 6, 0.3, 0, DECK + 6, 16.3));
      return g;
    },
    animate: (root, t) => roll(root, t),
  },
  {
    id: "train-milk-tanker",
    name: "Milk tanker",
    category: "Wagons",
    tags: ["wagon", "tanker", "milk", "dairy", "farm", "white"],
    notes: "A white tank wagon with blue straps and a pair of churns on its end platform. Collects milk from the dairy farm for the town; it spoils if left standing too long.",
    build: (k) => {
      const { g, len } = tanker(k, 86, TOY.white, TOY.blue);
      for (const z of [-7, 7])
        g.add(k.lathe(k.paint(TOY.grey), [[3.2, 0], [3.4, 6], [2, 8.5], [2.2, 10.5], [0, 10.5]], -len / 2 - 4.5, DECK, z, 16));
      // A milk-drop emblem on each side of the barrel.
      for (const z of [-12.3, 12.3]) g.add(k.extrude(k.paint(TOY.blue), [[0, 6], [3, 1], [2, -2], [0, -3], [-2, -2], [-3, 1]], 0.8, 18, DECK + 15, z, 0.2));
      return g;
    },
    animate: (root, t) => roll(root, t),
  },
  {
    id: "train-fuel-tanker",
    name: "Fuel tanker",
    category: "Wagons",
    tags: ["wagon", "tanker", "fuel", "oil", "hazard", "black"],
    notes: "A black tank wagon with a yellow band, a walkway ladder and a hazard diamond. Fuels the diesel depot; a spill could close a line for a while if it's derailed.",
    build: (k) => {
      const { g, y, len } = tanker(k, 90, TOY.black, TOY.yellow);
      g.add(k.cylX(k.paint(TOY.yellow), 12.2, 6, 0, y, 0));
      for (const z of [-16.4, 16.4]) {
        const d = k.box(k.paint(TOY.orange), 6, 6, 0.8, 0.3, 0, 0, 0);
        d.position.set(len / 4, y, z * 0.75);
        d.rotation.z = Math.PI / 4;
        g.add(d);
      }
      for (const x of [6, 10]) g.add(k.box(k.paint(TOY.grey), 1, 26, 1, 0.3, x, DECK, 13));
      for (let i = 0; i < 6; i++) g.add(k.cylX(k.paint(TOY.grey), 0.5, 4, 8, DECK + 3 + i * 4, 13, 6));
      g.add(k.box(k.wood, len * 0.7, 1.2, 6, 0.4, 0, y + 12, 0));
      return g;
    },
    animate: (root, t) => roll(root, t),
  },
  {
    id: "train-water-tanker",
    name: "Water tanker with tap",
    category: "Wagons",
    tags: ["wagon", "tanker", "water", "tap", "drip", "blue"],
    notes: "A sky-blue water tank with a dripping tap at one end. Brings water to a dry farm or refills a water tower far from any river.",
    build: (k) => {
      const { g, y, len } = tanker(k, 80, TOY.sky, TOY.blue);
      const x = -len / 2 - 4;
      g.add(k.cylX(k.metal, 1.4, 6, x, y - 6, 0, 10));
      g.add(k.cyl(k.metal, 1.2, 3, x - 3, y - 9, 0, 1.2, 10));
      g.add(k.cyl(k.paint(TOY.red), 2.2, 1, x - 3, y - 3.5, 0, 2.2, 12));
      const drip = k.ball(k.water, 1, x - 3, y - 10.5, 0, 1.3);
      drip.name = "drip";
      drip.userData.y0 = drip.position.y;
      g.add(drip);
      return g;
    },
    animate: (root, t) => {
      roll(root, t);
      const f = (t * 0.8) % 1;
      for (const d of parts(root, "drip")) {
        d.position.y = (d.userData.y0 as number) - f * f * 14;
        d.visible = f < 0.95;
      }
    },
  },
  {
    id: "train-log-carrier",
    name: "Log carrier",
    category: "Wagons",
    tags: ["wagon", "logs", "timber", "forest", "stakes"],
    notes: "A bolster wagon with tall red-capped stakes holding a pyramid of logs. Runs from the forest to the sawmill; a log crane could load it a log at a time.",
    build: (k) => {
      const L = 96;
      const g = base(k, L);
      for (const x of [-30, 30]) g.add(k.box(k.paint(TOY.red), 6, 4, 32, 1, x, DECK, 0));
      for (const x of [-36, -12, 12, 36])
        for (const z of [-15.5, 15.5]) g.add(k.cyl(k.wood, 1.6, 26, x, DECK, z, 1.6, 10), k.ball(k.paint(TOY.red), 2.4, x, DECK + 26, z));
      const rows: [number, number][] = [[-10, 0], [0, 0], [10, 0], [-5, 1], [5, 1], [0, 2]];
      for (const [z, row] of rows) {
        const y = DECK + 4 + 5 + row * 8.66;
        g.add(k.cylX(k.wood, 5, 82, (z % 3) * 0.6, y, z, 16));
        for (const s of [-1, 1]) g.add(k.cylX(k.cut, 4, 0.4, s * 41.1 + (z % 3) * 0.6, y, z, 14));
      }
      return g;
    },
    animate: (root, t) => roll(root, t),
  },
  {
    id: "train-flatbed-crates",
    name: "Flatbed with crates",
    category: "Wagons",
    tags: ["wagon", "flat", "crates", "barrel", "goods", "parcels"],
    notes: "A flat wagon with strapped crates and a barrel. Mixed goods for the town shop; each crate could be a separate order the player delivers.",
    build: (k) => {
      const L = 90;
      const g = base(k, L);
      g.add(k.box(k.paint(TOY.blue), L - 6, 2, 32, 0.8, 0, DECK, 0));
      const deck = DECK + 2;
      g.add(k.box(k.wood, 22, 18, 22, 1, -24, deck, 0));
      g.add(k.box(k.cut, 2, 18.6, 22.6, 0.3, -24, deck - 0.3, 0), k.box(k.cut, 22.6, 2, 22.6, 0.3, -24, deck + 8, 0));
      g.add(k.box(k.paint(TOY.red), 16, 14, 18, 1, 2, deck, 0));
      g.add(k.box(k.paint(TOY.yellow), 10, 9, 10, 1, 2, deck + 14, 1));
      g.add(k.box(k.cut, 16.6, 1.6, 18.6, 0.3, 2, deck + 6, 0));
      g.add(k.lathe(k.paint(TOY.brown), [[7, 0], [8.4, 8], [7, 16], [0, 16]], 28, deck, 0, 20));
      for (const h of [3, 13]) g.add(k.ring(k.metal, 7.7, 0.6, 28, deck + h, 0));
      for (const x of [-40, 40]) g.add(k.box(k.paint(TOY.blue), 2, 6, 32, 0.6, x, deck, 0));
      return g;
    },
    animate: (root, t) => roll(root, t),
  },
  {
    id: "train-car-transporter",
    name: "Car transporter",
    category: "Wagons",
    tags: ["wagon", "cars", "transporter", "double deck", "factory"],
    notes: "A long two-deck wagon carrying six little toy cars. Takes new cars from a factory to the town showroom, where they could drive off onto the road mat.",
    build: (k) => {
      const L = 112;
      const g = base(k, L, { inset: 20 });
      const yellow = k.paint(TOY.yellow);
      g.add(k.box(yellow, L - 6, 2, 32, 0.6, 0, DECK, 0));
      const up = DECK + 24;
      g.add(k.box(yellow, L - 6, 2.5, 32, 0.8, 0, up, 0));
      for (const x of [-52, -18, 18, 52]) for (const z of [-15, 15]) g.add(k.box(yellow, 2.5, 24, 2.5, 0.6, x, DECK + 2, z));
      for (const z of [-15.3, 15.3]) g.add(k.box(yellow, L - 8, 2, 1.6, 0.6, 0, up + 7, z));
      for (const x of [-40, -13, 13, 40]) for (const z of [-15.3, 15.3]) g.add(k.box(yellow, 1.6, 7, 1.6, 0.4, x, up + 2.5, z));
      const colours = [TOY.red, TOY.blue, TOY.green, TOY.white, TOY.orange, TOY.teal];
      for (let i = 0; i < 6; i++) g.add(toyCar(k, colours[i], -34 + (i % 3) * 34, i < 3 ? DECK + 2 : up + 2.5));
      return g;
    },
    animate: (root, t) => roll(root, t),
  },
  {
    id: "train-livestock-van",
    name: "Livestock van",
    category: "Wagons",
    tags: ["wagon", "animals", "sheep", "cow", "farm", "slatted"],
    notes: "A slatted cattle van with a sheep, a cow and a pig peeking out over the top board. Moves animals from the farm to market; they could moo and baa when the train stops.",
    build: (k) => {
      const L = 84;
      const g = base(k, L);
      const brown = k.paint(TOY.brown);
      g.add(k.box(k.cut, L - 12, 30, 26, 1, 0, DECK, 0));
      for (const x of [-38.5, 38.5]) g.add(k.box(brown, 3, 30, 32, 1, x, DECK, 0));
      for (let i = 0; i < 4; i++) for (const z of [-14.8, 14.8]) g.add(k.box(brown, L - 10, 4, 2.4, 0.8, 0, DECK + 1 + i * 6, z));
      for (const x of [-20, 0, 20]) for (const z of [-15.4, 15.4]) g.add(k.box(brown, 3, 30, 2, 0.6, x, DECK, z));
      g.add(k.box(k.paint(TOY.white), L - 4, 3.5, 36, 1.6, 0, DECK + 30, 0));
      const hy = DECK + 26.5;
      const heads: Group[] = [];
      // Sheep: woolly head, black face.
      const sheep = k.group(k.ball(k.paint(TOY.white), 3.8, 0, 0, 0), k.ball(k.paint(TOY.black), 2.4, 0, -0.5, 2.6), k.ball(k.paint(TOY.black), 1, -3, 1, 1.5), k.ball(k.paint(TOY.black), 1, 3, 1, 1.5));
      heads.push(k.at(sheep, -12, hy, 16.5));
      // Cow: patched face, cream horns.
      const cow = k.group(
        k.box(k.paint(TOY.white), 6, 6, 6, 2, 0, -3, 0),
        k.box(k.paint(TOY.pink), 5, 2.8, 2, 0.8, 0, -3.5, 3),
        k.ball(k.paint(TOY.black), 1.8, -1.5, 1, 2.2),
        k.cone(k.paint(TOY.cream), 0.9, 3, -2.8, 2.5, 0),
        k.cone(k.paint(TOY.cream), 0.9, 3, 2.8, 2.5, 0),
      );
      cow.rotation.y = Math.PI;
      heads.push(k.at(cow, 12, hy, -16.5));
      // Pig: pink head and snout.
      const pig = k.group(k.ball(k.paint(TOY.pink), 3.4, 0, 0, 0), k.cylZ(k.paint(TOY.pink), 1.6, 2, 0, -0.6, 3.4, 12), k.cone(k.paint(TOY.pink), 1.1, 2.2, -2.2, 2.2, 0), k.cone(k.paint(TOY.pink), 1.1, 2.2, 2.2, 2.2, 0));
      heads.push(k.at(pig, 24, hy, 16.5));
      for (const h of heads) {
        h.name = "head";
        h.userData.y0 = h.position.y;
        g.add(h);
      }
      return g;
    },
    animate: (root, t) => {
      roll(root, t);
      parts(root, "head").forEach((h, i) => (h.position.y = (h.userData.y0 as number) + Math.max(0, Math.sin(t * 1.6 + i * 2.1)) * 1.6));
    },
  },
  {
    id: "train-mail-van",
    name: "Mail van with slot",
    category: "Wagons",
    tags: ["wagon", "van", "mail", "post", "letters", "slot", "red"],
    notes: "A red sorting van with a real letter slot in its side and a post-horn emblem. Peg people on platforms could post letters into it as it waits at a station.",
    build: (k) => {
      const g = van(k, 84, TOY.red, TOY.black);
      for (const z of [-16.4, 16.4]) {
        g.add(k.box(k.paint(TOY.yellow), 14, 4, 0.8, 0.3, -28, DECK + 15, z));
        g.add(k.box(k.cut, 10, 1.4, 1, 0.2, -28, DECK + 16.3, z + Math.sign(z) * 0.2));
        const horn = k.ring(k.paint(TOY.yellow), 3.4, 0.8, 26, DECK + 15, z, true, Math.PI * 1.5);
        g.add(horn, k.cone(k.paint(TOY.yellow), 1.8, 4, 29.4, DECK + 12.5, z));
      }
      const letter = k.box(k.paint(TOY.white), 8, 0.6, 6, 0.2, -28, DECK + 16.7, 22);
      letter.name = "letter";
      g.add(letter);
      return g;
    },
    animate: (root, t) => {
      roll(root, t, 1);
      const f = (t * 0.5) % 1;
      for (const l of parts(root, "letter")) {
        l.position.z = 26 - f * 12;
        l.visible = f < 0.8;
      }
    },
  },
  {
    id: "train-refrigerated-van",
    name: "Refrigerated van",
    category: "Wagons",
    tags: ["wagon", "van", "fridge", "cold", "ice cream", "fish", "white"],
    notes: "A white insulated van with a snowflake emblem and a whirring cooling fan on its end. Carries fish from the harbour or ice cream to the seaside, against the clock before it melts.",
    build: (k) => {
      const L = 86;
      const g = van(k, L, TOY.white, TOY.blue);
      for (const z of [-16.4, 16.4]) {
        g.add(k.box(k.paint(TOY.blue), L - 9, 3, 0.8, 0.3, 0, DECK + 22, z));
        for (const a of [0, Math.PI / 3, (2 * Math.PI) / 3]) {
          const arm = k.box(k.paint(TOY.sky), 12, 1.6, 0.8, 0.3, 0, 0, 0);
          arm.position.set(-26, DECK + 12, z);
          arm.rotation.z = a;
          g.add(arm);
          const arm2 = arm.clone();
          arm2.position.x = 26;
          g.add(arm2);
        }
      }
      const ux = -L / 2 + 1;
      g.add(k.box(k.paint(TOY.grey), 4, 16, 22, 1, ux, DECK + 6, 0));
      g.add(k.cylX(k.paint(TOY.black), 6, 0.8, ux - 2.2, DECK + 14, 0, 20));
      const fan = new Group();
      fan.name = "fan";
      fan.position.set(ux - 3, DECK + 14, 0);
      fan.add(k.box(k.paint(TOY.white), 0.8, 10, 2, 0.3, 0, -5, 0), k.box(k.paint(TOY.white), 0.8, 2, 10, 0.3, 0, -1, 0));
      g.add(fan);
      return g;
    },
    animate: (root, t) => {
      roll(root, t);
      for (const f of parts(root, "fan")) f.rotation.x = t * 8;
    },
  },
  {
    id: "train-crane-wagon",
    name: "Crane wagon",
    category: "Wagons",
    tags: ["wagon", "crane", "jib", "hook", "breakdown", "slewing", "yellow"],
    notes: "A breakdown crane on a wagon: its cab and jib slew round on a turntable and a hook hangs from the tip. Could lift a derailed car back onto the track, or load crates from a yard.",
    build: (k) => {
      const L = 96;
      const g = base(k, L);
      const yellow = k.paint(TOY.yellow);
      g.add(k.box(k.paint(TOY.grey), L - 6, 2, 32, 0.6, 0, DECK, 0));
      for (const x of [-30, 30]) for (const z of [-17, 17]) g.add(k.box(yellow, 6, 3, 4, 0.8, x, 13, z));
      const turret = new Group();
      turret.name = "turret";
      turret.position.set(-6, DECK + 2, 0);
      turret.add(k.cyl(k.wood, 13, 3, 0, 0, 0, 13, 32));
      turret.add(k.box(yellow, 20, 18, 22, 2, -4, 3, 0));
      turret.add(k.box(k.paint(PANE), 8, 7, 22.6, 0.3, 0, 11, 0));
      turret.add(k.box(k.paint(TOY.black), 24, 2.5, 26, 1, -4, 21, 0));
      turret.add(k.box(k.paint(TOY.grey), 8, 10, 20, 1.5, -15, 3, 0));
      const jib = new Group();
      jib.position.set(6, 12, 0);
      jib.rotation.z = 0.5;
      for (const z of [-3.5, 3.5]) jib.add(k.box(yellow, 52, 3, 2, 0.6, 26, -1.5, z));
      for (let i = 0; i < 5; i++) jib.add(k.cylZ(yellow, 0.7, 7, 6 + i * 10, 0, 0, 8));
      turret.add(jib);
      const tipX = 6 + 52 * Math.cos(0.5);
      const tipY = 12 + 52 * Math.sin(0.5);
      turret.add(k.cylZ(k.metal, 2, 8, tipX, tipY, 0, 12));
      turret.add(k.cyl(k.paint(TOY.black), 0.5, 18, tipX, tipY - 18, 0, 0.5, 6));
      turret.add(k.box(k.paint(TOY.red), 5, 4, 4, 1, tipX, tipY - 22, 0));
      turret.add(k.ring(k.metal, 2.2, 0.8, tipX, tipY - 24.5, 0, true, Math.PI * 1.4));
      g.add(turret);
      return g;
    },
    animate: (root, t) => {
      roll(root, t, 0.5);
      for (const tt of parts(root, "turret")) tt.rotation.y = Math.sin(t * 0.5) * 1.3;
    },
  },
  {
    id: "train-magnet-wagon",
    name: "Magnetic loading wagon",
    category: "Wagons",
    tags: ["wagon", "magnet", "scrap", "crane", "metal", "loader"],
    notes: "A tray of scrap with a slewing arm whose magnet drops, picks up a piece and lifts it. Picks up metal loads with magnets, just as the toy trains couple; a scrapyard could trade it for coins.",
    build: (k) => {
      const L = 96;
      const g = base(k, L);
      const blue = k.paint(TOY.blue);
      g.add(k.box(blue, 52, 3, 32, 1, -18, DECK, 0));
      for (const z of [-14.5, 14.5]) g.add(k.box(blue, 52, 10, 3, 1, -18, DECK, z));
      for (const x of [-42.5, 6.5]) g.add(k.box(blue, 3, 10, 32, 1, x, DECK, 0));
      const scrap = [TOY.grey, TOY.black, TOY.grey, TOY.brown, TOY.grey, TOY.black, TOY.grey];
      scrap.forEach((c, i) => {
        const p = k.box(c === TOY.brown ? k.paint(c) : i % 2 ? k.metal : k.paint(c), 7, 3, 5, 0.6, 0, 0, 0);
        p.position.set(-36 + i * 6, DECK + 6 + (i % 3), ((i * 7) % 5) * 4 - 8);
        p.rotation.set(i * 0.7, i * 1.3, i * 0.4);
        g.add(p);
      });
      const turret = new Group();
      turret.name = "turret";
      turret.position.set(26, DECK, 0);
      turret.add(k.cyl(k.paint(TOY.yellow), 8, 3, 0, 0, 0, 8, 24), k.cyl(k.paint(TOY.yellow), 4, 22, 0, 3, 0, 3.4, 16));
      const arm = k.box(k.paint(TOY.yellow), 46, 3, 4, 1, 0, 0, 0);
      arm.position.set(-21, 25 + 6.6, 0);
      arm.rotation.z = -0.3;
      turret.add(arm);
      const hang = new Group();
      hang.position.set(-44, 25 + 13.2, 0);
      const rope = k.cyl(k.paint(TOY.black), 0.5, 1, 0, -1, 0, 0.5, 6);
      rope.name = "rope";
      const disc = k.group(k.cyl(k.metal, 6, 3, 0, -3, 0, 6, 24), k.cyl(k.paint(TOY.red), 2, 2, 0, 0, 0, 2, 12), k.box(k.paint(TOY.grey), 8, 2.5, 5, 0.5, 0, -5.5, 0));
      disc.name = "magdisc";
      hang.add(rope, disc);
      turret.add(hang);
      g.add(turret);
      return g;
    },
    animate: (root, t) => {
      roll(root, t, 0.5);
      const drop = 14 + 8 * Math.sin(t * 1.2);
      for (const r of parts(root, "rope")) r.scale.y = drop;
      for (const d of parts(root, "magdisc")) d.position.y = -drop;
      for (const tt of parts(root, "turret")) tt.rotation.y = Math.sin(t * 0.6) * 0.4;
    },
  },
  {
    id: "train-tipper-wagon",
    name: "Tipper wagon",
    category: "Wagons",
    tags: ["wagon", "tipper", "dump", "gravel", "ballast", "quarry", "yellow"],
    notes: "A side-tipping skip full of gravel that tilts over to dump its load. Fills a hole for a new bridge or tips ballast by the line; tipping could pour gravel onto the felt.",
    build: (k) => {
      const L = 84;
      const g = base(k, L);
      for (const x of [-30, 30]) g.add(k.box(k.paint(TOY.grey), 4, 5, 30, 1, x, DECK, 0));
      const skip = new Group();
      skip.name = "skip";
      skip.position.set(0, DECK + 4, -15);
      const body = k.extrude(k.paint(TOY.yellow), [[-14, 0], [14, 0], [17, 16], [-17, 16]], 70, 0, 0, 15, 1);
      body.rotation.y = Math.PI / 2;
      skip.add(body);
      skip.add(k.box(k.paint(TOY.orange), 72, 2, 35, 0.8, 0, 15.5, 15));
      for (let i = 0; i < 10; i++) skip.add(k.ball(k.paint(TOY.grey), 4, -27 + i * 6, 17.5, 15 + ((i * 5) % 7) - 3, 0.6));
      skip.add(k.cylX(k.metal, 1.5, 70, 0, 0, 0, 10));
      g.add(skip);
      return g;
    },
    animate: (root, t) => {
      roll(root, t, 0.5);
      for (const s of parts(root, "skip")) s.rotation.x = -0.6 * (0.5 - 0.5 * Math.cos(t * 0.9));
    },
  },
  {
    id: "train-sleeper-coach",
    name: "Sleeper coach",
    category: "Wagons",
    tags: ["coach", "sleeper", "night", "moon", "passenger", "navy"],
    notes: "A navy night coach with little curtained windows and a moon and stars on its side. A night train between faraway towns; passengers pay more but only travel after dark.",
    build: (k) => {
      const L = 100;
      const g = coach(k, L, "#1f3f73", TOY.cream, { n: 6, winH: 6 });
      const winY = DECK + 30 * 0.62 - 3;
      const pw = (L - 8) / 6;
      for (let i = 0; i < 6; i++)
        for (const z of [-16.6, 16.6]) g.add(k.box(k.paint(TOY.pink), (pw - 7) / 2, 6.2, 0.6, 0.2, -(L - 8) / 2 + pw * (i + 0.5) - (pw - 7) / 4, winY - 0.1, z));
      for (const z of [-16.3, 16.3]) {
        g.add(k.cylZ(k.paint(TOY.yellow), 4.5, 0.8, -34, DECK + 7, z, 20));
        g.add(k.cylZ(k.paint("#1f3f73"), 4, 1.2, -32.2, DECK + 8, z, 20));
        for (const [x, y] of [[-24, 9], [-18, 5], [-12, 10]]) g.add(k.extrude(k.paint(TOY.yellow), star(1.6), 0.8, x, DECK + y, z + Math.sign(z) * 0.2, 0.2));
      }
      return g;
    },
    animate: (root, t) => roll(root, t),
  },
  {
    id: "train-dining-car",
    name: "Dining car",
    category: "Wagons",
    tags: ["coach", "dining", "restaurant", "kitchen", "passenger", "maroon"],
    notes: "A maroon dining car with big windows, table lamps and a smoking kitchen chimney. Passengers on long trips are happier with one in the train; it could boost fares on a long line.",
    build: (k) => {
      const L = 100;
      const g = coach(k, L, "#7a2a35", TOY.cream, { n: 3, winH: 12, band: TOY.cream });
      const len = L - 8;
      for (let i = 0; i < 3; i++)
        for (const z of [-16.8, 16.8]) {
          const x = -len / 2 + (len / 3) * (i + 0.5);
          g.add(k.cyl(k.paint(TOY.yellow), 1.6, 2.2, x, DECK + 13.8, z, 0.8, 10));
          g.add(k.box(k.paint(TOY.white), len / 3 - 7, 1.2, 0.5, 0.2, x, DECK + 13, z));
        }
      g.add(k.cyl(k.metal, 2.4, 7, -38, DECK + 33, 0, 2, 14));
      g.add(puffs(k, -38, DECK + 41));
      return g;
    },
    animate: (root, t) => {
      roll(root, t);
      smoke(root, t * 0.6);
    },
  },
  {
    id: "train-observation-car",
    name: "Observation car",
    category: "Wagons",
    tags: ["coach", "observation", "dome", "scenic", "view", "passenger", "green"],
    notes: "A tail-end coach with a rounded, glazed end and a framed glass dome where peg passengers look out. Scenic routes past mountains and lakes could earn more with one at the back.",
    build: (k) => {
      const L = 96;
      const g = base(k, L);
      const green = k.paint(TOY.green);
      const cream = k.paint(TOY.cream);
      g.add(k.box(green, 76, 30, 32, 2.5, 8, DECK, 0));
      g.add(windows(k, 70, 4, 10, DECK + 13, 10));
      g.add(k.cyl(green, 15, 8, -30, DECK, 0, 15, 32));
      g.add(k.cyl(k.paint(PANE), 14.6, 18, -30, DECK + 8, 0, 14.6, 32));
      for (const a of [0.8, 1.6, 2.4, 3.14]) g.add(k.cyl(cream, 0.9, 18, -30 - Math.sin(a) * 14.8, DECK + 8, Math.cos(a) * 14.8, 0.9, 8));
      g.add(k.cyl(green, 15, 4, -30, DECK + 26, 0, 15, 32));
      g.add(k.box(cream, 80, 3.5, 34, 1.5, 9, DECK + 30, 0));
      g.add(k.cyl(cream, 16, 3.5, -30, DECK + 30, 0, 16, 32));
      // Dome: a framed glass bubble (glazing bars only, so the pegs inside show).
      const top = DECK + 33.5;
      for (const x of [-4, 10, 24]) {
        const rib = k.ring(cream, 12, 0.9, x, top, 0, true, Math.PI);
        rib.rotation.y = Math.PI / 2;
        g.add(rib);
      }
      for (const z of [-11.6, 11.6]) g.add(k.cylX(cream, 0.9, 30, 10, top + 0.5, z, 8));
      g.add(k.cylX(cream, 0.9, 30, 10, top + 12, 0, 8));
      for (const [i, x] of [-1, 10, 21].entries()) g.add(k.peg([TOY.red, TOY.yellow, TOY.blue][i], null, x, top - 12, i % 2 ? 4 : -4));
      return g;
    },
    animate: (root, t) => roll(root, t),
  },
  {
    id: "train-double-decker",
    name: "Double-decker coach",
    category: "Wagons",
    tags: ["coach", "double deck", "commuter", "passenger", "tall", "red"],
    notes: "A tall coach with two rows of windows. Carries twice the passengers on a busy commuter line, but won't fit under low bridges or through old tunnels.",
    build: (k) => {
      const L = 100;
      const g = base(k, L);
      const len = L - 8;
      g.add(k.box(k.paint(TOY.red), len, 46, 32, 3, 0, DECK, 0));
      g.add(k.box(k.paint(TOY.cream), len + 0.4, 3, 32.4, 0.5, 0, DECK + 22, 0));
      g.add(windows(k, len - 16, 5, 9, DECK + 9, 0, 5));
      g.add(windows(k, len - 4, 6, 9, DECK + 30, 0, 5));
      for (const s of [-1, 1]) for (const z of [-16.3, 16.3]) g.add(k.box(k.paint(TOY.yellow), 6, 18, 0.8, 0.3, s * (len / 2 - 5), DECK + 2, z));
      g.add(k.box(k.paint(TOY.grey), len + 2, 3.5, 34, 1.6, 0, DECK + 46, 0));
      return g;
    },
    animate: (root, t) => roll(root, t),
  },
  {
    id: "train-caboose-cupola",
    name: "Caboose with cupola",
    category: "Wagons",
    tags: ["caboose", "guard", "brake van", "cupola", "tail lamp", "red"],
    notes: "A red caboose with open porches, a lookout cupola, a stove chimney and a blinking tail lamp. The guard rides at the back: a train with one could be allowed longer, heavier loads.",
    build: (k) => {
      const L = 64;
      const g = base(k, L, { inset: 16 });
      const red = k.paint(TOY.red);
      const black = k.paint(TOY.black);
      g.add(k.box(red, 40, 26, 32, 2.5, 0, DECK, 0));
      g.add(windows(k, 40, 2, 8, DECK + 13));
      for (const s of [-1, 1]) {
        g.add(k.box(k.paint(PANE), 0.8, 8, 10, 0.3, s * 20.2, DECK + 13, 0));
        for (const z of [-14, 14]) g.add(k.cyl(k.paint(TOY.yellow), 0.8, 26, s * 29, DECK, z, 0.8, 8));
        g.add(k.cylZ(k.paint(TOY.yellow), 0.8, 28, s * 29, DECK + 12, 0, 8));
        for (const z of [-14, 14]) g.add(k.cylX(k.paint(TOY.yellow), 0.8, 9, s * 24.5, DECK + 12, z, 8));
      }
      g.add(k.box(black, 64, 3, 36, 1.5, 0, DECK + 26, 0));
      g.add(k.box(red, 16, 10, 22, 2, 0, DECK + 29, 0));
      for (const z of [-11.2, 11.2]) g.add(k.box(k.paint(PANE), 12, 5, 0.6, 0.2, 0, DECK + 31.5, z));
      g.add(k.box(black, 20, 2.5, 26, 1, 0, DECK + 39, 0));
      g.add(k.cyl(k.metal, 1.8, 8, 14, DECK + 29, 6, 1.8, 10));
      g.add(lamp(k, "tail", "#ff5a4a", 2.2, -29.8, DECK + 16, 10));
      g.add(k.peg(TOY.blue, TOY.black, -25, DECK, -5));
      return g;
    },
    animate: (root, t) => {
      roll(root, t);
      blink(root, "tail", Math.floor(t * 2) % 2 === 0);
    },
  },
  {
    id: "train-caboose-bay",
    name: "Bay-window caboose",
    category: "Wagons",
    tags: ["caboose", "guard", "bay window", "brake van", "yellow"],
    notes: "A yellow caboose that looks out through bay windows on its sides instead of a roof cupola. A low-roofed variant that fits through tunnels where the cupola caboose can't.",
    build: (k) => {
      const L = 70;
      const g = base(k, L, { inset: 16 });
      const yellow = k.paint(TOY.yellow);
      g.add(k.box(yellow, 50, 28, 32, 2.5, 0, DECK, 0));
      g.add(windows(k, 50, 2, 8, DECK + 14, 0, 30));
      for (const z of [-1, 1]) {
        g.add(k.box(yellow, 16, 16, 6, 1.5, 0, DECK + 6, z * 17));
        g.add(k.box(k.paint(PANE), 10, 7, 0.6, 0.2, 0, DECK + 10.5, z * 20.2));
        g.add(k.box(k.paint(TOY.brown), 18, 1.6, 7, 0.5, 0, DECK + 22, z * 17));
      }
      for (const s of [-1, 1]) {
        g.add(k.box(k.paint(PANE), 0.8, 8, 10, 0.3, s * 25.2, DECK + 14, 0));
        for (const z of [-14, 14]) g.add(k.cyl(k.paint(TOY.brown), 0.8, 12, s * 32, DECK, z, 0.8, 8));
        g.add(k.cylZ(k.paint(TOY.brown), 0.8, 28, s * 32, DECK + 12, 0, 8));
      }
      g.add(k.box(k.paint(TOY.brown), 56, 3, 36, 1.5, 0, DECK + 28, 0));
      g.add(k.cyl(k.metal, 1.8, 7, -12, DECK + 31, 6, 1.8, 10));
      return g;
    },
    animate: (root, t) => roll(root, t),
  },
  {
    id: "train-treasure-wagon",
    name: "Treasure wagon",
    category: "Wagons",
    tags: ["wagon", "gold", "treasure", "bank", "armoured", "door", "secure"],
    notes: "A riveted armoured van whose door swings open on a stack of gold bars. Carries gold from the mine to the bank; a fun bonus job, and maybe a target for a cheeky peg bandit.",
    build: (k) => {
      const L = 86;
      const g = base(k, L);
      const green = k.paint(TOY.green);
      const gold = k.paint("#d9a520");
      g.add(k.box(green, 76, 26, 24, 2, 0, DECK, -4));
      for (const s of [-1, 1]) g.add(k.box(green, 26, 26, 8, 1, s * 25, DECK, 12));
      g.add(k.box(green, 24, 6, 8, 1, 0, DECK + 20, 12));
      g.add(k.box(k.cut, 24, 20, 0.5, 0, 0, DECK, 8.1));
      for (const [x, y, z] of [[-6, 0, 12], [0, 0, 12], [6, 0, 12], [-3, 3, 12], [3, 3, 12], [0, 6, 12], [-6, 0, 6], [6, 0, 6]] as const)
        g.add(k.box(gold, 5.5, 3, 4, 0.6, x, DECK + y, z));
      g.add(k.box(k.paint(TOY.black), 80, 3, 36, 1.5, 0, DECK + 26, 0));
      for (let i = 0; i < 6; i++) for (const y of [4, 22]) for (const z of [-16.2, 16.2]) if (Math.abs(-34 + i * 13.6) > 14) g.add(k.ball(gold, 1, -34 + i * 13.6, DECK + y, z));
      const door = new Group();
      door.name = "door";
      door.position.set(-12, DECK, 16.8);
      door.add(k.box(green, 24, 20, 1.5, 0.6, 12, 0, 0));
      door.add(k.cylZ(gold, 2.4, 1, 18, 10, 1, 16), k.box(k.paint(TOY.black), 1, 3, 0.6, 0.2, 18, 8.5, 1.6));
      for (const x of [3, 21]) for (const y of [3, 17]) door.add(k.ball(gold, 1, x, y, 0.8));
      g.add(door);
      return g;
    },
    animate: (root, t) => {
      roll(root, t, 0.5);
      for (const d of parts(root, "door")) d.rotation.y = -1.6 * Math.max(0, Math.sin(t * 0.7));
    },
  },
  {
    id: "train-circus-cage",
    name: "Circus cage wagon",
    category: "Wagons",
    tags: ["wagon", "circus", "lion", "cage", "animals", "red"],
    notes: "A barred circus wagon with a lion pacing inside, on yellow wheels. Part of the circus train; the circus only opens in town once every wagon has arrived.",
    build: (k) => {
      const L = 90;
      const g = base(k, L, { wheel: TOY.yellow });
      const red = k.paint(TOY.red);
      const yellow = k.paint(TOY.yellow);
      g.add(k.box(red, 84, 3, 32, 1, 0, DECK, 0));
      for (const x of [-40, 40]) for (const z of [-14, 14]) g.add(k.box(red, 4, 30, 4, 1, x, DECK + 3, z));
      for (let i = 1; i < 13; i++) for (const z of [-14.5, 14.5]) g.add(k.cyl(yellow, 0.9, 30, -40 + (i * 80) / 13, DECK + 3, z, 0.9, 8));
      for (let i = 1; i < 5; i++) for (const x of [-40.5, 40.5]) g.add(k.cyl(yellow, 0.9, 30, x, DECK + 3, -14 + (i * 28) / 5, 0.9, 8));
      g.add(k.box(red, 88, 4, 36, 1.5, 0, DECK + 33, 0));
      g.add(k.box(yellow, 90, 1.6, 37, 0.5, 0, DECK + 37, 0));
      for (let i = 0; i < 9; i++) for (const z of [-18, 18]) g.add(k.ball(yellow, 1.8, -40 + i * 10, DECK + 32.5, z));
      const lion = new Group();
      lion.name = "lion";
      lion.position.set(0, DECK + 3, 0);
      const fur = k.paint(TOY.yellow);
      const mane = k.paint(TOY.orange);
      const body = k.ball(fur, 6.5, 0, 10, 0);
      body.scale.x = 1.6;
      lion.add(body);
      for (const x of [-6, 6]) for (const z of [-3.5, 3.5]) lion.add(k.cyl(fur, 1.8, 6, x, 0, z, 1.8, 10));
      lion.add(k.ball(mane, 6, 11, 15, 0));
      lion.add(k.ball(fur, 4, 14, 15, 0));
      lion.add(k.ball(k.paint(TOY.black), 1, 17.8, 15, 0));
      const tail = k.cyl(fur, 0.7, 9, -10, 11, 0, 0.7, 6);
      tail.rotation.z = 0.8;
      lion.add(tail, k.ball(mane, 1.6, -16, 16, 0));
      g.add(lion);
      return g;
    },
    animate: (root, t) => {
      roll(root, t, 0.5);
      for (const l of parts(root, "lion")) {
        l.position.x = Math.sin(t * 0.7) * 12;
        l.rotation.y = Math.cos(t * 0.7) >= 0 ? 0 : Math.PI;
      }
    },
  },
  {
    id: "train-cement-mixer",
    name: "Cement mixer wagon",
    category: "Wagons",
    tags: ["wagon", "cement", "mixer", "drum", "building", "construction", "orange"],
    notes: "A wagon with a tilted mixing drum that turns as it goes, and a water tank. Brings concrete to a building site; in game it could be how new bridges and stations get built.",
    build: (k) => {
      const L = 96;
      const g = base(k, L);
      const grey = k.paint(TOY.grey);
      g.add(k.box(grey, L - 6, 2, 32, 0.6, 0, DECK, 0));
      g.add(k.box(grey, 4, 12, 26, 1, -26, DECK, 0), k.box(grey, 4, 20, 26, 1, 4, DECK, 0));
      const tilt = new Group();
      tilt.position.set(-32, DECK + 16, 0);
      tilt.rotation.z = -Math.PI / 2 + 0.25;
      const drum = new Group();
      drum.name = "drum";
      drum.add(k.lathe(k.paint(TOY.orange), [[0, 0], [8, 0], [13, 7], [13, 22], [7, 34], [5, 38], [0, 38]], 0, 0, 0, 28));
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2;
        const fin = k.box(k.paint(TOY.white), 2.5, 13, 2.5, 0.6, 13 * Math.cos(a), 8, 13 * Math.sin(a));
        fin.rotation.y = -a;
        fin.rotation.x = 0.25;
        drum.add(fin);
      }
      for (const h of [10, 20]) drum.add(k.ring(k.paint(TOY.white), 13.1, 0.9, 0, h, 0));
      tilt.add(drum);
      g.add(tilt);
      g.add(k.cylX(k.paint(TOY.blue), 7, 22, 32, DECK + 9, 0));
      g.add(k.box(grey, 3, 10, 18, 0.8, 32, DECK, 0));
      return g;
    },
    animate: (root, t) => {
      roll(root, t);
      for (const d of parts(root, "drum")) d.rotation.y = t * 2;
    },
  },
  {
    id: "train-well-wagon-boat",
    name: "Well wagon with boat",
    category: "Wagons",
    tags: ["wagon", "well", "boat", "harbour", "low loader", "oversize"],
    notes: "A low well wagon carrying a little cabin boat on cradles. Delivers a boat from the boatyard to the harbour, where a crane lifts it onto the water.",
    build: (k) => {
      const L = 110;
      const g = base(k, L, { inset: 14, chassis: false });
      const blue = k.paint(TOY.blue);
      for (const s of [-1, 1]) g.add(k.box(blue, 26, 7, 30, 2, s * 40, 12, 0));
      g.add(k.box(blue, 58, 4, 30, 1, 0, 4, 0));
      for (const z of [-14.5, 14.5]) g.add(k.box(blue, 60, 14, 3, 1, 0, 4, z));
      for (const x of [-16, 16]) g.add(k.box(k.wood, 5, 4, 20, 1, x, 8, 0));
      const boat = new Group();
      boat.position.set(0, 12, 0);
      boat.add(k.extrude(k.paint(TOY.white), [[-26, 0], [18, 0], [30, 14], [-28, 14]], 22, 0, 0, 0, 2));
      boat.add(k.box(k.paint(TOY.red), 50, 2.5, 24.5, 0.5, -1, 3, 0));
      boat.add(k.box(k.wood, 54, 1.5, 22, 0.5, 0, 14, 0));
      boat.add(k.box(k.paint(TOY.cream), 20, 10, 16, 2, -6, 15.5, 0));
      boat.add(k.box(k.paint(PANE), 16, 4, 16.6, 0.5, -6, 20, 0));
      boat.add(k.box(k.paint(TOY.blue), 23, 2, 18, 0.8, -6, 25.5, 0));
      boat.add(k.cyl(k.wood, 1, 22, 8, 15.5, 0, 0.8, 8));
      boat.add(k.extrude(k.paint(TOY.red), [[0, 0], [7, 2.5], [0, 5]], 0.6, 8.8, 32, 0, 0.1));
      boat.add(k.ring(k.paint(TOY.orange), 2.8, 1, -20, 8, 11.6, true));
      g.add(boat);
      return g;
    },
    animate: (root, t) => roll(root, t),
  },
  {
    id: "train-hopper-chute",
    name: "Hopper with chute",
    category: "Wagons",
    tags: ["wagon", "hopper", "coal", "chute", "unload", "grain"],
    notes: "A tall coal hopper with a funnel bottom and a side chute that swings down to pour its load. Unloads itself at a lineside bunker with no crane, if it stops in the right place.",
    build: (k) => {
      const L = 86;
      const g = base(k, L);
      const teal = k.paint(TOY.teal);
      g.add(k.extrude(teal, [[-20, 0], [20, 0], [38, 20], [-38, 20]], 30, 0, DECK + 2, 0, 1));
      g.add(k.box(teal, 78, 10, 32, 1.5, 0, DECK + 21, 0));
      for (const x of [-34, 34]) g.add(k.box(k.paint(TOY.black), 4, 18, 30, 0.8, x, DECK, 0));
      for (const z of [-15.5, 15.5]) g.add(k.box(k.paint(TOY.yellow), 80, 2.5, 3, 0.6, 0, DECK + 30, z));
      for (const x of [-38.5, 38.5]) g.add(k.box(k.paint(TOY.yellow), 3, 2.5, 34, 0.6, x, DECK + 30, 0));
      coalHeap(k, g, 70, 26, DECK + 31.5);
      g.add(k.box(k.paint(TOY.black), 10, 6, 6, 1, 0, DECK + 2, 13));
      const chute = new Group();
      chute.name = "chute";
      chute.position.set(0, DECK + 5, 16);
      chute.add(k.box(k.paint(TOY.yellow), 8, 1.4, 18, 0.4, 0, 0, 9));
      for (const x of [-4.2, 4.2]) chute.add(k.box(k.paint(TOY.yellow), 1, 3, 18, 0.3, x, 0, 9));
      const lumps = new Group();
      lumps.name = "lumps";
      for (let i = 0; i < 3; i++) lumps.add(k.ball(k.coal, 1.8, (i - 1) * 2, 2.6, i * 6));
      chute.add(lumps);
      g.add(chute);
      return g;
    },
    animate: (root, t) => {
      roll(root, t, 0.5);
      const open = 0.5 - 0.5 * Math.cos(t * 0.6);
      for (const c of parts(root, "chute")) c.rotation.x = -1.3 + 1.7 * open;
      for (const l of parts(root, "lumps")) {
        l.visible = open > 0.85;
        l.position.z = (t * 14) % 6;
      }
    },
  },
  {
    id: "train-peg-coach",
    name: "Open coach with peg passengers",
    category: "Wagons",
    tags: ["coach", "passenger", "open", "excursion", "seaside", "pegs", "people"],
    notes: "An open-sided excursion coach with a striped canopy and six peg passengers on benches. Seaside specials in summer; the pegs could hop off at the beach station.",
    build: (k) => {
      const L = 96;
      const g = base(k, L);
      const blue = k.paint(TOY.blue);
      g.add(k.box(k.wood, L - 6, 2, 32, 0.6, 0, DECK, 0));
      for (const z of [-15, 15]) g.add(k.box(blue, L - 8, 9, 2, 0.6, 0, DECK + 2, z));
      for (const x of [-44, 44]) g.add(k.box(blue, 2, 9, 32, 0.6, x, DECK + 2, 0));
      for (const x of [-44, -15, 15, 44]) for (const z of [-15, 15]) g.add(k.cyl(k.wood, 1.2, 28, x, DECK + 2, z, 1.2, 10));
      for (let i = 0; i < 6; i++) g.add(k.box(k.paint(i % 2 ? TOY.white : TOY.red), 92 / 6, 3, 38, i === 0 || i === 5 ? 1.2 : 0, -46 + (92 / 6) * (i + 0.5), DECK + 30, 0));
      g.add(k.box(k.wood, 84, 5, 5, 0.8, 0, DECK + 2, 0));
      const pegs = new Group();
      pegs.name = "pegs";
      const coats = [TOY.red, TOY.yellow, TOY.green, TOY.purple, TOY.orange, TOY.teal];
      for (let i = 0; i < 6; i++) {
        const p = k.peg(coats[i], i === 2 ? TOY.yellow : null, -30 + (i % 3) * 30 + (i < 3 ? 0 : 8), DECK + 2, i < 3 ? -7 : 7);
        p.userData.y0 = p.position.y;
        pegs.add(p);
      }
      g.add(pegs);
      return g;
    },
    animate: (root, t) => {
      roll(root, t);
      for (const p of parts(root, "pegs")) p.children.forEach((c, i) => (c.position.y = (c.userData.y0 as number) + Math.abs(Math.sin(t * 3 + i)) * 1.2));
    },
  },
];

export const ASSETS: Asset[] = [...engines, ...wagons];

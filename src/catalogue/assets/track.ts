import { BufferGeometry, Float32BufferAttribute, Group, Mesh, Path, Shape, type Material, type Object3D } from "three";
import { TOY, type Kit } from "../kit";
import type { Asset } from "../types";

/**
 * New track piece ideas: grooved beech (40 wide, 12 thick, grooves 26 apart) with round peg-and-hole ends. Every piece
 * is swept along a centre line (straight, arc, S, sine, helix), so curves, ramps, banking and spirals share one helper.
 */

// ——— Centre lines ———

/** A sample on a track's centre line: position of the slab's base, heading `a` (direction (cos a, 0, sin a)), pitch, bank. */
interface S {
  x: number;
  y: number;
  z: number;
  a: number;
  p: number;
  b: number;
}

const W = 40;
const H = 12;
const GROOVE = 13;
const PI = Math.PI;

const pt = (x: number, y: number, z: number, a: number, p = 0, b = 0): S => ({ x, y, z, a, p, b });

/** A straight `len` long from (x, z) heading `a`, its base at `y`, rising `rise` over its length. */
function line(x: number, z: number, a: number, len: number, y = 0, rise = 0): S[] {
  const p = Math.atan2(rise, len);
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [pt(x, y, z, a, p), pt(x + c * len, y + rise, z + s * len, a, p)];
}

/** An arc of `radius` turning `sweep` (positive turns toward +z when heading +x), its base at `y`, rising `rise`. */
function arc(x: number, z: number, a: number, radius: number, sweep: number, y = 0, rise = 0): S[] {
  const sg = Math.sign(sweep);
  const cx = x - sg * radius * Math.sin(a);
  const cz = z + sg * radius * Math.cos(a);
  const n = Math.min(48, Math.max(4, Math.ceil((radius * Math.abs(sweep)) / 10)));
  const p = Math.atan2(rise, radius * Math.abs(sweep));
  const out: S[] = [];
  for (let i = 0; i <= n; i++) {
    const ang = a + (sweep * i) / n;
    out.push(pt(cx + sg * radius * Math.sin(ang), y + (rise * i) / n, cz - sg * radius * Math.cos(ang), ang, p));
  }
  return out;
}

/** Continue a path from its last sample. */
function then(path: S[], next: (s: S) => S[]): S[] {
  const last = path[path.length - 1];
  return [...path, ...next(last).slice(1)];
}

/** An S-bend `len` long shifting the line `off` sideways (toward +z for positive `off`). */
function sBend(x: number, z: number, len: number, off: number, y = 0): S[] {
  const th = 2 * Math.atan(off / len);
  const r = len / (2 * Math.sin(Math.abs(th)));
  return then(arc(x, z, 0, r, th, y), (s) => arc(s.x, s.z, s.a, r, -th, y));
}

/** A free-form centre line through `f(t)` for t in 0..1 (headings and pitch from neighbouring points). */
function fnPath(n: number, f: (t: number) => [number, number, number], bank?: (t: number) => number): S[] {
  const pts = Array.from({ length: n + 1 }, (_, i) => f(i / n));
  return pts.map((q, i) => {
    const a0 = pts[Math.max(0, i - 1)];
    const a1 = pts[Math.min(n, i + 1)];
    const dx = a1[0] - a0[0];
    const dz = a1[2] - a0[2];
    return pt(q[0], q[1], q[2], Math.atan2(dz, dx), Math.atan2(a1[1] - a0[1], Math.hypot(dx, dz)), bank ? bank(i / n) : 0);
  });
}

/** Move a sample `l` sideways (toward +z when heading +x). */
const shift = (s: S, l: number): S => ({ ...s, x: s.x - Math.sin(s.a) * l, z: s.z + Math.cos(s.a) * l });
/** Turn a sample round (for connectors on a path's far end). */
const flip = (s: S): S => ({ ...s, a: s.a + PI, p: -s.p });
const lifted = (path: S[], dy: number): S[] => path.map((s) => ({ ...s, y: s.y + dy }));

// ——— Swept meshes ———

/** Sweep a convex cross-section (lateral l, height v pairs, anticlockwise from bottom left) along a path. */
function sweep(path: S[], prof: readonly [number, number][]): BufferGeometry {
  const pos: number[] = [];
  const idx: number[] = [];
  const corner = (s: S, l: number, v: number) => {
    const cb = Math.cos(s.b);
    const sb = Math.sin(s.b);
    const lat = l * cb - v * sb;
    pos.push(s.x - Math.sin(s.a) * lat, s.y + l * sb + v * cb, s.z + Math.cos(s.a) * lat);
  };
  const m = prof.length;
  const n = path.length;
  for (let j = 0; j < m; j++) {
    const c0 = prof[j];
    const c1 = prof[(j + 1) % m];
    const base = pos.length / 3;
    for (const s of path) {
      corner(s, c0[0], c0[1]);
      corner(s, c1[0], c1[1]);
    }
    for (let i = 0; i < n - 1; i++) {
      const a = base + 2 * i;
      idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
  }
  for (const [s, end] of [
    [path[0], false],
    [path[n - 1], true],
  ] as const) {
    const base = pos.length / 3;
    for (const [l, v] of prof) corner(s, l, v);
    for (let j = 1; j < m - 1; j++) {
      if (end) idx.push(base, base + j + 1, base + j);
      else idx.push(base, base + j, base + j + 1);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute("position", new Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function meshOf(g: BufferGeometry, mat: Material): Mesh {
  const m = new Mesh(g, mat);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

/** The slab's cross-section: `w` wide, 12 thick, its top edges chamfered. */
const slabProfile = (w: number, h = H): [number, number][] => [
  [-w / 2, 0],
  [w / 2, 0],
  [w / 2, h - 1.2],
  [w / 2 - 1.2, h],
  [-w / 2 + 1.2, h],
  [-w / 2, h - 1.2],
];
const grooveProfile = (l: number): [number, number][] => [
  [l - 3, H - 0.1],
  [l + 3, H - 0.1],
  [l + 3, H + 0.25],
  [l - 3, H + 0.25],
];

/** A round peg on a neck, sticking out forward from sample `s`. */
function pegAt(k: Kit, s: S): Group {
  const g = k.group(k.box(k.wood, 9, 10, 6.5, 1, 3.5, 1, 0), k.cyl(k.wood, 6, 10, 12, 1, 0, 6, 20));
  g.position.set(s.x, s.y, s.z);
  g.rotation.set(0, -s.a, s.p);
  return g;
}

/** A round hole with its neck slot, opening backward from sample `s` (s heads into the piece). */
function holeAt(k: Kit, s: S): Group {
  const g = k.group(k.cyl(k.cut, 6.6, H + 0.6, 12, -0.15, 0, 6.6, 20), k.box(k.cut, 8, H + 0.6, 7.4, 0, 3.85, -0.15, 0));
  g.position.set(s.x, s.y, s.z);
  g.rotation.set(0, -s.a, s.p);
  return g;
}

type End = "peg" | "hole" | null;
interface TrackOpts {
  /** Board width (wider for double track). */
  w?: number;
  /** Lateral offsets of each line of track on the board. */
  offs?: number[];
  start?: End;
  end?: End;
  /** Small height nudge so overlapping boards (switches, crossings) don't fight. */
  lift?: number;
  /** false: grooves only (a line routed into another board). */
  slab?: boolean;
}

/** A grooved board along `path` with peg/hole ends (hole at the start, peg at the end by default). */
function track(k: Kit, path0: S[], o: TrackOpts = {}): Group {
  const { w = W, offs = [0], start = "hole", end = "peg", lift = 0, slab = true } = o;
  const path = lift ? lifted(path0, lift) : path0;
  const g = new Group();
  if (slab) g.add(meshOf(sweep(path, slabProfile(w)), k.wood));
  for (const off of offs) for (const gz of [-GROOVE, GROOVE]) g.add(meshOf(sweep(path, grooveProfile(off + gz)), k.cut));
  const s0 = path[0];
  const s1 = path[path.length - 1];
  for (const off of offs) {
    if (start === "hole") g.add(holeAt(k, shift(s0, off)));
    if (start === "peg") g.add(pegAt(k, flip(shift(s0, off))));
    if (end === "peg") g.add(pegAt(k, shift(s1, off)));
    if (end === "hole") g.add(holeAt(k, flip(shift(s1, off))));
  }
  return g;
}

/** Turned beech columns from the mat up to the underside of the path at the given samples. */
function posts(k: Kit, path: S[], every: number, from = 0): Group {
  const g = new Group();
  for (let i = from; i < path.length; i += every) {
    const s = path[i];
    if (s.y < 4) continue;
    g.add(k.cyl(k.wood, 6, s.y, s.x, 0, s.z, 4.5, 16));
    g.add(k.cyl(k.wood, 8, 2, s.x, 0, s.z, 8, 16));
  }
  return g;
}

/** A wedge (a ramp): `len` along local x, `h` high at x = 0 down to nothing at x = len, `w` wide. */
function wedge(k: Kit, mat: Material, len: number, h: number, w: number): Mesh {
  return k.extrude(
    mat,
    [
      [0, 0],
      [len, 0],
      [len, 0.4],
      [0, h],
    ],
    w,
    0,
    0,
    0,
    0.4,
  );
}

function named<T extends Object3D>(o: T, name: string): T {
  o.name = name;
  return o;
}

const T = (id: string, name: string, tags: string[], notes: string, build: (k: Kit) => Object3D, animate?: Asset["animate"]): Asset => ({
  id: `track-${id}`,
  name,
  category: "Track",
  tags: ["track", ...tags],
  notes,
  build,
  ...(animate ? { animate } : {}),
});

/** Square wave −1/+1 that flips every `period` seconds. */
const toggle = (t: number, period: number) => (Math.floor(t / period) % 2 === 0 ? 1 : -1);

// ——— The pieces ———

export const ASSETS: Asset[] = [
  // Straights
  T(
    "mini-straight",
    "Mini straight",
    ["straight", "short", "filler"],
    "A thumb-length 27 mm straight for closing awkward gaps. The game could offer it as a gap-filler that snaps in when a loop is a few millimetres short.",
    (k) => track(k, line(-13.5, 0, 0, 27)),
  ),
  T(
    "long-straight",
    "Long straight",
    ["straight", "long"],
    "A 288 mm straight, four grid squares long. Quick to lay long mainlines; could be a reward unlocked after building a big layout.",
    (k) => track(k, line(-144, 0, 0, 288)),
  ),
  T(
    "rumble-straight",
    "Rumble straight",
    ["straight", "bumpy", "sound", "novelty"],
    "A straight with turned ridges across the grooves so trains rattle over it. In the game it could shake the cars, play a clatter and slow trains a little.",
    (k) => {
      const g = track(k, line(-72, 0, 0, 144));
      for (let x = -54; x <= 54; x += 12) g.add(k.cylZ(k.wood, 1.4, 38, x, H, 0, 10));
      return g;
    },
  ),
  T(
    "sleeper-straight",
    "Sleeper-look straight",
    ["straight", "sleepers", "decorative"],
    "A straight with painted sleepers under the grooves, like real rail. A cosmetic skin the player could pick for mainline track.",
    (k) => {
      const g = track(k, line(-108, 0, 0, 216));
      for (let x = -96; x <= 96; x += 16) g.add(k.box(k.paint(TOY.brown), 6, 0.3, 36, 0, x, H - 0.15, 0));
      return g;
    },
  ),
  T(
    "adapter-peg-peg",
    "Peg-to-peg adapter",
    ["adapter", "connector", "male"],
    "A short straight with a peg on both ends for when two holes face each other. The game could add one automatically when the player joins two holes.",
    (k) => track(k, line(-27, 0, 0, 54), { start: "peg", end: "peg" }),
  ),
  T(
    "adapter-hole-hole",
    "Hole-to-hole adapter",
    ["adapter", "connector", "female"],
    "A short straight with a hole on both ends for joining two pegs. Pairs with the peg-to-peg adapter so any two ends can meet.",
    (k) => track(k, line(-27, 0, 0, 54), { start: "hole", end: "hole" }),
  ),
  T(
    "dog-bone",
    "Dog-bone joiner",
    ["adapter", "connector", "tiny"],
    "A loose double peg that joins two holes nose to nose with no track between. A tiny free part that could be found in a toy box hidden in the scenery.",
    (k) => k.group(k.box(k.wood, 14, 9, 6.5, 1, 0, 0, 0), k.cyl(k.wood, 6, 9, -10, 0, 0, 6, 20), k.cyl(k.wood, 6, 9, 10, 0, 0, 6, 20)),
  ),
  T(
    "dead-end-siding",
    "Dead-end siding",
    ["buffer", "siding", "end"],
    "A short siding that ends in a red buffer beam with sprung buffers. Good for parking wagons; a siding could hold cars waiting for a delivery.",
    (k) => {
      const g = track(k, line(-54, 0, 0, 108), { end: null });
      g.add(k.box(k.paint(TOY.red), 10, 14, 40, 2, 49, H, 0));
      g.add(k.box(k.wood, 6, 26, 10, 1.5, 51, 0, -14));
      g.add(k.box(k.wood, 6, 26, 10, 1.5, 51, 0, 14));
      for (const z of [-11, 11]) g.add(k.cylX(k.paint(TOY.black), 3.5, 5, 41.5, 19, z, 16));
      return g;
    },
  ),
  T(
    "end-ramp",
    "Track-end ramp",
    ["ramp", "end", "mat"],
    "A wedge that runs the track down onto the mat, so trains can roll off onto the floor. Could let toy cars and trains drive between track and road.",
    (k) => {
      const g = new Group();
      g.add(
        k.extrude(
          k.wood,
          [
            [-40, 0],
            [30, 0],
            [30, H],
            [0, H],
            [-40, 0.8],
          ],
          W - 1.6,
          0,
          0.8,
          0,
        ),
      );
      const slope = Math.atan2(H - 0.8, 40);
      const len = Math.hypot(40, H - 0.8);
      for (const gz of [-GROOVE, GROOVE]) {
        g.add(k.box(k.cut, 30, 0.35, 6, 0, 15, H + 0.75, gz));
        const s = k.box(k.cut, len, 0.35, 6, 0, 0, 0, 0);
        s.position.set(-20, 0.8 + (H - 0.8) / 2 + 0.75, gz);
        s.rotation.z = slope;
        g.add(s);
      }
      g.add(holeAt(k, pt(30, 0.8, 0, PI)));
      return g;
    },
  ),
  // Curves
  T(
    "tight-curve",
    "Tight curve",
    ["curve", "tight", "small"],
    "An eighth-turn on a 54 mm radius for tiny loops round a single block. Trains might have to slow down or risk tipping in the game.",
    (k) => track(k, arc(-20, -10, 0, 54, PI / 4)),
  ),
  T(
    "wide-curve",
    "Wide sweeping curve",
    ["curve", "wide", "large"],
    "A sixteenth-turn on a 360 mm radius for big, gentle mainline sweeps. Fast trains could keep their full speed through it.",
    (k) => track(k, arc(-70, -14, 0, 360, PI / 8)),
  ),
  T(
    "quarter-turn",
    "Quarter-turn curve",
    ["curve", "90", "corner"],
    "A full 90° corner in one piece on a 108 mm radius. Makes square layouts in four pieces, handy for a beginner's first loop.",
    (k) => track(k, arc(-54, -54, 0, 108, PI / 2)),
  ),
  T(
    "banked-curve",
    "Banked curve",
    ["curve", "banked", "tilted", "fast"],
    "A curve that tilts inward in the middle, like a racing track. In the game, trains could take it at full speed without slowing.",
    (k) => {
      const base = arc(-64, -26, 0, 180, PI / 4);
      const n = base.length - 1;
      const path = base.map((s, i) => {
        const e = Math.sin((PI * i) / n);
        return { ...s, y: 5.2 * e, b: -0.22 * e };
      });
      const g = track(k, path);
      for (const i of [Math.round(n * 0.3), Math.round(n / 2), Math.round(n * 0.7)]) {
        const s = shift(path[i], -12);
        const h = path[i].y + 12 * Math.sin(-path[i].b) - 0.3;
        const b = k.box(k.wood, 10, h, 14, 1);
        b.position.set(s.x, h / 2, s.z);
        b.rotation.y = -s.a;
        g.add(b);
      }
      return g;
    },
  ),
  T(
    "ascending-curve",
    "Ascending curve",
    ["curve", "ramp", "climb", "upgrade"],
    "A curve that climbs 32 mm as it turns, on turned posts. Lets a line climb up onto a hill while it turns a corner.",
    (k) => {
      const path = arc(-64, -26, 0, 180, PI / 4, 0, 32);
      return k.group(track(k, path), posts(k, path, 6, 6));
    },
  ),
  T(
    "wiggle-track",
    "Wiggle track",
    ["wiggle", "s", "novelty"],
    "A straight that snakes gently from side to side. Ends line up like a normal straight, so it's a fun swap-in that makes cars sway.",
    (k) => track(k, fnPath(40, (t) => [-108 + 216 * t, 0, -6 * Math.cos(4 * PI * t)])),
  ),
  T(
    "zig-zag",
    "Mini zig-zag",
    ["zigzag", "wiggle", "tight", "novelty"],
    "Short, tight alternating bends that jink the line left and right. Could slow trains down like a chicane before a station.",
    (k) => {
      let path = arc(-75, 0, 0, 36, PI / 6);
      for (const sw of [-PI / 3, PI / 3, -PI / 3, PI / 6]) path = then(path, (s) => arc(s.x, s.z, s.a, 36, sw));
      return track(k, path);
    },
  ),
  T(
    "snake-track",
    "Flexible snake track",
    ["flexible", "snake", "jointed", "animated"],
    "A chain of short jointed links that bends to fit any gap. In the game it could stretch between two loose ends the player drags together.",
    (k) => {
      const root = new Group();
      let parent: Object3D = root;
      for (let i = 0; i < 7; i++) {
        const j = named(new Group(), `j${i}`);
        j.position.x = i === 0 ? -105 : 30;
        j.add(k.trackSlab(28, 14));
        j.add(k.cyl(k.paint(TOY.red), 3, 0.5, 0, H, 0, 3, 12));
        if (i === 0) j.add(holeAt(k, pt(0, 0, 0, 0)));
        if (i === 6) j.add(pegAt(k, pt(30, 0, 0, 0)));
        parent.add(j);
        parent = j;
      }
      return root;
    },
    (root, t) => {
      for (let i = 1; i < 7; i++) {
        const j = root.getObjectByName(`j${i}`);
        if (j) j.rotation.y = 0.16 * Math.sin(t * 1.6 - i * 0.8);
      }
    },
  ),
  // Crossings
  T(
    "crossing-45",
    "45° crossing",
    ["crossing", "diamond", "45"],
    "Two straights crossing at 45°, a narrow diamond. Lets figure-of-eights fit in a smaller space; collisions on the diamond could be a puzzle.",
    (k) => {
      const c = Math.cos(PI / 4) * 72;
      return k.group(track(k, line(-72, 0, 0, 144)), track(k, line(-c, -c, PI / 4, 144), { lift: 0.06 }));
    },
  ),
  T(
    "curved-crossing",
    "Curve-over-straight crossing",
    ["crossing", "curve", "diamond"],
    "A curve cutting across a straight on one board. Lets a branch line swing across the main line without a bridge.",
    (k) => k.group(track(k, line(-72, 0, 0, 144)), track(k, arc(-72, -45, 0, 180, PI / 4), { lift: 0.06 })),
  ),
  T(
    "road-crossing",
    "Road crossing piece",
    ["crossing", "road", "level crossing"],
    "A straight with a road laid flush across it and ramps down to the mat each side. Toy cars and trains share it; pair with barriers for a puzzle.",
    (k) => {
      const g = track(k, line(-72, 0, 0, 144));
      for (const [z, w] of [
        [0, 20],
        [18, 3.4],
        [-18, 3.4],
      ]) g.add(k.box(k.road, 40, 0.3, w, 0, 0, H, z));
      for (const side of [-1, 1]) {
        const r = wedge(k, k.road, 32, H, 40);
        r.position.z = side * 20;
        r.rotation.y = -side * (PI / 2);
        g.add(r);
        for (let i = -1; i <= 1; i++) g.add(k.box(k.paint(TOY.white), 3, 0.25, 6, 0, i * 12, H + 0.3, side * 18));
      }
      return g;
    },
  ),
  // Switches
  T(
    "three-way-switch",
    "Three-way switch",
    ["switch", "points", "three-way"],
    "One line splitting three ways: left, straight and right. A single tap could cycle through the three routes.",
    (k) =>
      k.group(
        track(k, line(-72, 0, 0, 144)),
        track(k, arc(-72, 0, 0, 180, PI / 4), { start: null, lift: 0.06 }),
        track(k, arc(-72, 0, 0, 180, -PI / 4), { start: null, lift: 0.12 }),
      ),
  ),
  T(
    "y-split",
    "Y-split",
    ["switch", "y", "wye", "points"],
    "A symmetric split: the line curves both left and right, no straight. Balanced branches for a station throat or a reversing triangle.",
    (k) => k.group(track(k, arc(-64, 0, 0, 180, PI / 4)), track(k, arc(-64, 0, 0, 180, -PI / 4), { start: null, lift: 0.06 })),
  ),
  T(
    "curved-switch",
    "Curved switch",
    ["switch", "curve", "points"],
    "A switch on a curve: an inner tight curve and an outer wide one from the same start. Lets a branch leave in the middle of a bend.",
    (k) => k.group(track(k, arc(-64, -40, 0, 180, PI / 4)), track(k, arc(-64, -40, 0, 108, PI / 4), { start: null, lift: 0.06 })),
  ),
  T(
    "lever-switch",
    "Switch with lever",
    ["switch", "lever", "points", "animated"],
    "A switch with a lever on a side block that swings a red tongue across the grooves. The player flicks the lever to set the route.",
    (k) => {
      const g = k.group(track(k, line(-72, 0, 0, 144)), track(k, arc(-72, 0, 0, 180, PI / 4), { start: null, lift: 0.06 }));
      const tongue = named(new Group(), "tongue");
      tongue.position.set(-40, H + 0.1, 6);
      tongue.add(k.box(k.paint(TOY.red), 32, 1.2, 3, 0.5, 16, 0, 0));
      tongue.add(k.cyl(k.metal, 2, 1.6, 0, 0, 0, 2, 12));
      g.add(tongue);
      g.add(k.box(k.wood, 26, 9, 14, 2, -40, 0, -30));
      const lever = named(new Group(), "lever");
      lever.position.set(-40, 9, -30);
      lever.add(k.cyl(k.paint(TOY.black), 1.4, 18, 0, 0, 0, 1.2, 10));
      lever.add(k.ball(k.paint(TOY.red), 3, 0, 19, 0));
      g.add(lever);
      return g;
    },
    (root, t) => {
      const s = toggle(t, 1.5);
      const lever = root.getObjectByName("lever");
      const tongue = root.getObjectByName("tongue");
      if (lever) lever.rotation.z = s * 0.45;
      if (tongue) tongue.rotation.y = s > 0 ? 0 : -0.16;
    },
  ),
  // Double track
  T(
    "double-straight",
    "Double-track straight",
    ["double", "parallel", "straight"],
    "Two parallel lines on one wide board. Fast to lay a two-way mainline where trains pass each other.",
    (k) => track(k, line(-108, 0, 0, 216), { w: 88, offs: [-22, 22] }),
  ),
  T(
    "double-curve",
    "Double-track curve",
    ["double", "parallel", "curve"],
    "Two concentric curves on one board, keeping a double line together through a bend.",
    (k) => track(k, arc(-64, -40, 0, 180, PI / 4), { w: 88, offs: [-22, 22] }),
  ),
  T(
    "crossover",
    "Crossover",
    ["double", "crossover", "switch"],
    "A double-track board with a diagonal linking the two lines. Trains can hop from one line to the other to overtake.",
    (k) => k.group(track(k, line(-108, 0, 0, 216), { w: 88, offs: [-22, 22] }), track(k, sBend(-72, -22, 144, 44), { slab: false, start: null, end: null })),
  ),
  T(
    "scissors-crossover",
    "Scissors crossover",
    ["double", "crossover", "scissors", "diamond"],
    "Two crossovers overlaid in an X, so trains can swap lines in either direction. A great junction for a busy station approach.",
    (k) =>
      k.group(
        track(k, line(-108, 0, 0, 216), { w: 88, offs: [-22, 22] }),
        track(k, sBend(-80, -22, 160, 44), { slab: false, start: null, end: null }),
        track(k, sBend(-80, 22, 160, -44), { slab: false, start: null, end: null }),
      ),
  ),
  T(
    "rail-and-road",
    "Rail-and-road straight",
    ["road", "double", "street"],
    "A wide board with a track on one side and a felt road with a dashed centre line on the other. Builds a street-running tramway in one go.",
    (k) => {
      const g = track(k, line(-108, 0, 0, 216), { w: 88, offs: [-22] });
      g.add(k.box(k.road, 214, 0.4, 38, 0, 0, H, 22));
      for (let x = -90; x <= 90; x += 30) g.add(k.box(k.paint(TOY.white), 14, 0.2, 2, 0, x, H + 0.4, 22));
      g.add(k.box(k.paint(TOY.grey), 216, 2, 3, 0.5, 0, H, 2));
      return g;
    },
  ),
  // Slopes and spirals
  T(
    "hump",
    "Hump track",
    ["hump", "hill", "bump", "novelty"],
    "A straight with a rounded hump in the middle on a solid beech base. Trains slow on the way up and speed down the other side.",
    (k) => {
      const hy = (t: number) => 18 * Math.sin(PI * t) ** 2;
      const path = fnPath(32, (t) => [-108 + 216 * t, hy(t), 0]);
      const top: [number, number][] = [];
      for (let i = 31; i >= 1; i--) top.push([-108 + (216 * i) / 32, Math.max(0.3, hy(i / 32) - 0.2)]);
      const base = k.extrude(
        k.wood,
        [
          [-108, 0],
          [108, 0],
          ...top,
        ],
        30,
        0,
        0,
        0,
        0.5,
      );
      return k.group(track(k, path), base);
    },
  ),
  T(
    "helix-segment",
    "Helix half-turn",
    ["helix", "spiral", "climb", "riser"],
    "Half a turn of helix that climbs a full riser height on turned posts. Stack two for a full spiral up to a second level.",
    (k) => {
      const r = 108;
      const path = fnPath(36, (t) => [r * Math.sin(PI * t), 64 * t, -r * Math.cos(PI * t)]);
      return k.group(track(k, path), posts(k, path, 6, 6));
    },
  ),
  T(
    "spiral-riser",
    "Spiral tower",
    ["spiral", "helix", "tower", "climb"],
    "A turn-and-a-quarter spiral round a central turned column, carried on spokes. Lifts a line 96 mm in a small footprint; a showpiece for a mountain line.",
    (k) => {
      const r = 90;
      const turns = 1.25;
      const path = fnPath(60, (t) => [r * Math.cos(2 * PI * turns * t - PI / 2), 96 * t, r * Math.sin(2 * PI * turns * t - PI / 2)]);
      const g = k.group(track(k, path));
      g.add(k.cyl(k.wood, 14, 112, 0, 0, 0, 12, 24));
      g.add(k.cyl(k.wood, 22, 4, 0, 0, 0, 22, 24));
      g.add(k.ball(k.paint(TOY.red), 10, 0, 116, 0));
      for (let i = 6; i < path.length; i += 6) {
        const s = path[i];
        const arm = new Group();
        arm.position.set(0, s.y - 6, 0);
        arm.rotation.y = -Math.atan2(s.z, s.x);
        arm.add(k.box(k.wood, 72, 6, 10, 1, 13 + 36, 0, 0));
        g.add(arm);
      }
      return g;
    },
  ),
  T(
    "see-saw",
    "See-saw track",
    ["seesaw", "tilting", "novelty", "animated"],
    "A straight balanced on a pivot that tips as a train rolls across it. Could be a puzzle: a heavy wagon tips it the right way to line up a branch.",
    (k) => {
      const g = new Group();
      g.add(
        k.extrude(
          k.paint(TOY.red),
          [
            [-14, 0],
            [14, 0],
            [0, 8],
          ],
          36,
          0,
          0.6,
          0,
          0.6,
        ),
      );
      const deck = named(new Group(), "deck");
      deck.position.y = 8;
      deck.add(track(k, line(-108, 0, 0, 216)));
      g.add(deck);
      return g;
    },
    (root, t) => {
      const deck = root.getObjectByName("deck");
      if (deck) deck.rotation.z = 0.06 * Math.sin(t * 0.9);
    },
  ),
  // Special-purpose straights
  T(
    "stop-go",
    "Stop-and-go track",
    ["stop", "button", "signal", "animated"],
    "A straight with a push button that flips a red/green disc and raises a little stop block between the grooves. Trains wait on red until the player taps it.",
    (k) => {
      const g = track(k, line(-72, 0, 0, 144));
      g.add(k.box(k.wood, 34, 14, 14, 2, 0, 0, -28));
      const button = named(k.group(k.cyl(k.paint(TOY.red), 4.5, 4, 0, 0, 0, 4, 20)), "button");
      button.position.set(-8, 14, -28);
      g.add(button);
      const flag = named(new Group(), "flag");
      flag.position.set(8, 14, -28);
      flag.add(k.cyl(k.paint(TOY.black), 1.2, 18, 0, 0, 0, 1.2, 10));
      flag.add(k.cylX(k.paint(TOY.red), 7, 1.2, 0.7, 22, 0, 20));
      flag.add(k.cylX(k.paint(TOY.leaf), 7, 1.2, -0.7, 22, 0, 20));
      g.add(flag);
      g.add(named(k.box(k.paint(TOY.red), 6, 4, 10, 1, 20, H - 3, 0), "stopper"));
      return g;
    },
    (root, t) => {
      const s = toggle(t, 1.6);
      const flag = root.getObjectByName("flag");
      const stopper = root.getObjectByName("stopper");
      const button = root.getObjectByName("button");
      if (flag) flag.rotation.y = s > 0 ? 0 : PI;
      if (stopper) stopper.position.y = (s > 0 ? 3 : -1.2) + 2;
      if (button) button.position.y = 14 - (t % 1.6 < 0.2 ? 1.5 : 0);
    },
  ),
  T(
    "chime-track",
    "Chime track",
    ["sound", "music", "chime", "animated"],
    "A straight with a row of lacquered chime bars beside it; passing wheels trip little hammers that ding a tune. Each layout could hide a melody to find.",
    (k) => {
      const g = track(k, line(-108, 0, 0, 216));
      g.add(k.box(k.wood, 170, 6, 24, 2, 0, 0, -36));
      const colours = [TOY.red, TOY.orange, TOY.yellow, TOY.leaf, TOY.blue, TOY.purple];
      colours.forEach((c, i) => {
        const x = -70 + i * 28;
        g.add(k.box(k.paint(c), 9, 3, 20 - i * 1.6, 1, x, 6, -38));
        const h = named(new Group(), `h${i}`);
        h.position.set(x, 13, -24);
        h.add(k.cylZ(k.wood, 0.9, 13, 0, 0, -6.5, 10));
        h.add(k.ball(k.wood, 2.4, 0, 0, -13));
        h.add(k.cylZ(k.metal, 1.6, 3, 0, 0, 0, 10));
        g.add(h);
      });
      return g;
    },
    (root, t) => {
      for (let i = 0; i < 6; i++) {
        const h = root.getObjectByName(`h${i}`);
        if (!h) continue;
        const d = (((t * 3 - i) % 8) + 8) % 8;
        h.rotation.x = d < 1 ? 0.5 * Math.sin(d * PI) : 0;
      }
    },
  ),
  T(
    "uncoupler",
    "Uncoupling track",
    ["uncouple", "magnet", "shunting"],
    "A straight with a red magnet bar between the grooves that pulls couplers apart. Stop over it to drop off wagons in a siding.",
    (k) => {
      const g = track(k, line(-54, 0, 0, 108));
      g.add(k.box(k.paint(TOY.red), 60, 2.5, 12, 1, 0, H, 0));
      g.add(k.box(k.metal, 54, 0.4, 8, 0, 0, H + 2.5, 0));
      return g;
    },
  ),
  T(
    "water-trough",
    "Water trough track",
    ["water", "trough", "steam", "refill"],
    "A straight with a long water trough between the grooves for engines to scoop from on the move. Could refill a steam engine without stopping.",
    (k) => {
      const g = track(k, line(-108, 0, 0, 216));
      g.add(k.box(k.wood, 168, 1.2, 16, 0.4, 0, H, 0));
      g.add(k.box(k.water, 160, 1.4, 12, 0, 0, H, 0));
      g.add(k.cyl(k.wood, 4, 26, -90, 0, -28, 3.4, 16));
      g.add(k.cylX(k.paint(TOY.blue), 2, 14, -84, 24, -28, 12));
      return g;
    },
  ),
  T(
    "roller-track",
    "Roller track",
    ["roller", "treadmill", "novelty", "animated"],
    "A straight with spinning beech rollers set into a dark tray. A train can run on the spot like a treadmill, or be carried along with no power.",
    (k) => {
      const g = track(k, line(-72, 0, 0, 144));
      g.add(k.box(k.cut, 104, 0.3, 36, 0, 0, H, 0));
      for (let i = 0; i < 8; i++) {
        const r = named(new Group(), `roller${i}`);
        r.position.set(-49 + i * 14, H + 1.5, 0);
        r.add(k.cylZ(k.wood, 3, 36, 0, 0, 0, 16));
        r.add(k.box(k.paint(TOY.red), 1.6, 0.6, 36.4, 0, 0, 2.6, 0));
        g.add(r);
      }
      g.add(k.box(k.paint(TOY.yellow), 16, 10, 10, 2, 0, 0, -26));
      return g;
    },
    (root, t) => {
      for (let i = 0; i < 8; i++) {
        const r = root.getObjectByName(`roller${i}`);
        if (r) r.rotation.z = -t * 6;
      }
    },
  ),
  T(
    "platform-edge",
    "Platform-edge straight",
    ["platform", "station", "halt"],
    "A wide board with the track along one side and a raised cream platform on the other. Any straight becomes a stop where peg people board.",
    (k) => {
      const g = track(k, line(-108, 0, 0, 216), { w: 72, offs: [-16] });
      g.add(k.box(k.paint(TOY.cream), 214, 8, 28, 1.2, 0, H, 20));
      g.add(k.box(k.paint(TOY.yellow), 214, 0.3, 3, 0, 0, H + 8, 8));
      g.add(k.box(k.paint(TOY.green), 30, 4, 7, 1, 40, H + 8, 28));
      g.add(k.peg(TOY.red, null, -30, H + 8, 22));
      g.add(k.peg(TOY.blue, TOY.black, -14, H + 8, 26));
      return g;
    },
  ),
  T(
    "tunnel-stubs",
    "Tunnel-portal track",
    ["tunnel", "portal", "arch"],
    "A straight with a stone arch portal at each end, ready to be buried in a hill. Hides a train for a moment, so a whole tunnel isn't needed.",
    (k) => {
      const g = track(k, line(-108, 0, 0, 216));
      const arch = () => {
        const s = new Shape();
        s.moveTo(-32, 0);
        s.lineTo(-23, 0);
        s.lineTo(-23, 30);
        s.absarc(0, 30, 23, PI, 0, true);
        s.lineTo(23, 0);
        s.lineTo(32, 0);
        s.lineTo(32, 30);
        s.absarc(0, 30, 32, 0, PI, false);
        return s;
      };
      for (const x of [-92, 92]) {
        const p = k.extrude(k.paint(TOY.grey), arch(), 14, 0, 0, 0, 1);
        p.rotation.y = PI / 2;
        p.position.x = x;
        g.add(p);
        g.add(k.box(k.paint(TOY.red), 8, 8, 16, 1, x, 58, 0));
      }
      return g;
    },
  ),
  // Big pieces
  T(
    "turntable",
    "Turntable",
    ["turntable", "rotate", "depot", "animated"],
    "A round pit with a turning deck and five radial tracks. Turns an engine round or sends it to any stall of a roundhouse.",
    (k) => {
      const g = new Group();
      const ring = new Shape();
      ring.absarc(0, 0, 84, 0, 2 * PI, false);
      const hole = new Path();
      hole.absarc(0, 0, 72, 0, 2 * PI, true);
      ring.holes.push(hole);
      const rim = k.extrude(k.wood, ring, H, 0, 0, 0, 0.6);
      rim.rotation.x = -PI / 2;
      rim.position.y = H / 2;
      g.add(rim);
      g.add(k.cyl(k.cut, 72.5, 0.4, 0, 0, 0, 72.5, 48));
      for (const a of [0, PI / 4, PI / 2, (3 * PI) / 4, PI]) {
        g.add(track(k, line(72 * Math.cos(a), 72 * Math.sin(a), a, 52), { start: null, lift: 0.06 }));
      }
      const deck = named(new Group(), "deck");
      deck.add(track(k, line(-70, 0, 0, 140, 0.4), { start: null, end: null }));
      deck.add(k.cyl(k.paint(TOY.red), 8, 1, 0, H + 0.4, 0, 8, 20));
      deck.add(k.box(k.paint(TOY.yellow), 8, 6, 8, 1, 60, H + 0.4, -14));
      g.add(deck);
      return g;
    },
    (root, t) => {
      const deck = root.getObjectByName("deck");
      if (deck) deck.rotation.y = t * 0.5;
    },
  ),
  T(
    "transfer-table",
    "Transfer table",
    ["transfer", "traverser", "depot", "animated"],
    "A sliding deck in a long pit that shuttles a car sideways between three parallel tracks. A compact way into a fan of sidings.",
    (k) => {
      const g = new Group();
      g.add(k.box(k.cut, 72, 0.4, 150, 0));
      for (const x of [-40, 40]) g.add(k.box(k.wood, 8, H, 166, 1.5, x, 0, 0));
      for (const z of [-79, 79]) g.add(k.box(k.wood, 72, H, 8, 1.5, 0, 0, z));
      for (const z of [-48, 0, 48]) {
        g.add(track(k, line(-88, z, 0, 44), { end: null, lift: 0.06 }));
        g.add(track(k, line(44, z, 0, 44), { start: null, lift: 0.06 }));
      }
      for (const x of [-30, 30]) g.add(k.box(k.metal, 2, 0.6, 148, 0, x, 0.4, 0));
      const deck = named(new Group(), "deck");
      deck.add(track(k, line(-35, 0, 0, 70, 0.4), { start: null, end: null }));
      deck.add(k.box(k.paint(TOY.blue), 6, 10, 6, 1, 0, H + 0.4, -17));
      g.add(deck);
      return g;
    },
    (root, t) => {
      const deck = root.getObjectByName("deck");
      if (deck) deck.position.z = 48 * Math.max(-1, Math.min(1, 1.6 * Math.sin(t * 0.7)));
    },
  ),
  T(
    "balloon-loop",
    "Balloon loop",
    ["loop", "reversing", "teardrop", "switch"],
    "A lead-in track with a teardrop loop that brings the train back the way it came. Turns a whole train round without a turntable.",
    (k) => {
      const th = PI / 6;
      const L = 140;
      let a = arc(0, 0, 0, 180, -th);
      a = then(a, (s) => line(s.x, s.z, s.a, L));
      const R = -a[a.length - 1].z / Math.cos(th);
      a = then(a, (s) => arc(s.x, s.z, s.a, R, (PI + 2 * th) / 2));
      let b = arc(a[a.length - 1].x, a[a.length - 1].z, a[a.length - 1].a, R, (PI + 2 * th) / 2);
      b = then(b, (s) => line(s.x, s.z, s.a, L));
      b = then(b, (s) => arc(s.x, s.z, s.a, 180, -th));
      const g = k.group(
        track(k, line(-108, 0, 0, 108), { end: null }),
        track(k, a, { start: null, end: null, lift: 0.06 }),
        track(k, b, { start: null, end: null, lift: 0.12 }),
      );
      g.add(k.box(k.wood, 20, 8, 12, 2, -20, 0, 30));
      g.add(k.cyl(k.paint(TOY.red), 1.4, 14, -20, 8, 30, 1.2, 10));
      return g;
    },
  ),
];

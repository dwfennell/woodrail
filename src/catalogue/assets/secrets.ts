import { Group, Mesh, Shape, SphereGeometry, Vector3, type Material, type Object3D } from "three";
import { TOY, type Kit } from "../kit";
import { pennant, sitePaint, stick } from "../build-parts";
import type { Asset } from "../types";
import { HALT_Z, SHIPWRECK_SEA_Z } from "../secret-frame";

export { SECRET_HALT, SHIPWRECK_SEA_Z, type HaltPiece } from "../secret-frame";

/**
 * Secret sites (design spec 2026-11-05, part 3): hidden places found by laying track to them, as ruins are. Each is one
 * builder over `found`: before, dulled to a mossy grey, grown over and fogged, an old platform rotting in the
 * brambles; after, in its own colours, the spectacle restored (the mine's headframe and a cart of gold, the castle's
 * keep flying its banners, the whole ship heeled on the sand by its treasure, the stones standing in their ring) and
 * its halt mended, so tourists ride out to see it.
 *
 * Every site is laid out round the same halt (`SECRET_HALT`): a siding along x on the site's +z side, a straight and a
 * buffer as real track pieces that join the network at the straight's open (−x) end, its platform and nameboard in
 * the model. A site and its halt fit in about 300 × 330 mm (x −150…150, z −135…190, the buffer's end at x 108 + its
 * length). Registered as `secret-<name>-hidden` and `secret-<name>`, so the game can swap a placed prop's asset when
 * it's found. Not in Game mode: on Sandbox's Nature tab only.
 *
 * Built to stay under 8,000 triangles at `PROP_DETAIL` (merged into the prop batches): plain boxes for thin and many
 * parts, few-sided spheres for leaves, mist and heaps (`blob`), rounded boxes and turned shapes only where they read.
 */

const CAT = "Scenery" as const;

// ——— The halt every site comes with ———

/** The platform: 200 long, 28 deep, its edge 1 off the track's (the track 40 wide), deck 14 high. */
const PLAT = { length: 200, depth: 28, z: HALT_Z - 20 - 1 - 14, top: 14 } as const;

// ——— Small parts ———

/** A seeded random number source (0…1), so a site looks the same every time it's built. */
function rnd(seed: number): () => number {
  let s = seed * 9301 + 49297;
  return () => (s = (s * 9301 + 49297) % 233280) / 233280;
}

/** A low, few-sided ball (leaves, mist, heaps, rocks): about 80 triangles at most. */
function blob(mat: Material, r: number, x: number, y: number, z: number, sy = 1, w = 8, h = 6): Mesh {
  const m = new Mesh(new SphereGeometry(r, w, h), mat);
  m.position.set(x, y, z);
  m.scale.y = sy;
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

/** A plain beam from `a` to `b`, `t` square. */
function beam(k: Kit, mat: Material, a: [number, number, number], b: [number, number, number], t = 3): Mesh {
  const d = new Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  const m = k.box(mat, t, d.length(), t, 0);
  m.position.set((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2);
  m.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), d.normalize());
  return m;
}

/** A gable roof of two plain boards along x: `w` long, `d` across, `h` to the ridge, eaves on y. */
function gable(k: Kit, mat: Material, w: number, d: number, h: number, x: number, y: number, z: number, t = 2.5): Group {
  const g = new Group();
  const slope = Math.hypot(d / 2, h) + 2;
  const angle = Math.atan2(h, d / 2);
  for (const side of [-1, 1]) {
    const panel = k.box(mat, w, t, slope, 0);
    panel.position.set(0, h / 2, (side * d) / 4);
    panel.rotation.x = side * angle;
    g.add(panel);
  }
  return k.at(g, x, y, z);
}

/** Brambles and ivy: `n` squashed leaf blobs round (x, z) over `r`, sitting on y. */
function brambles(k: Kit, n: number, r: number, x: number, z: number, seed: number, y = 0, color = "#55734a"): Group {
  const g = new Group();
  const R = rnd(seed);
  for (let i = 0; i < n; i++) {
    const a = R() * Math.PI * 2;
    const d = Math.sqrt(R()) * r;
    const s = 7 + R() * 7;
    g.add(blob(k.paint(i % 3 ? color : "#46603e"), s, x + Math.cos(a) * d, y + s * 0.4, z + Math.sin(a) * d, 0.7, 7, 5));
  }
  return g;
}

/**
 * Ground mist: clumps of pale cotton-wool puffs round (x, z) over `r` (a hidden site, fogged), each clump a big puff
 * with smaller ones banked against it, so it reads as a cloud lying on the ground.
 */
function mist(k: Kit, n: number, r: number, x: number, z: number, seed: number, y = 4): Group {
  const g = new Group();
  g.name = "mist";
  const R = rnd(seed);
  const mats = [k.paint("#eef1ee"), k.paint("#e2e7e4"), k.paint("#d5dcd9")];
  for (let i = 0; i < n; i++) {
    const a = R() * Math.PI * 2;
    const d = Math.sqrt(R()) * r;
    const cx = x + Math.cos(a) * d;
    const cz = z + Math.sin(a) * d;
    const s = 20 + R() * 10;
    const t = R() * Math.PI;
    for (const [u, v, f] of [[0, 0, 1], [0.9, 0.2, 0.75], [-0.85, -0.25, 0.8], [0.3, -0.8, 0.6]] as const) {
      const dx = (u * Math.cos(t) - v * Math.sin(t)) * s;
      const dz = (u * Math.sin(t) + v * Math.cos(t)) * s;
      const m = blob(mats[(i + Math.round(f * 4)) % 3], s * f, cx + dx, y + (f === 1 ? 3 : 0), cz + dz, 0.36, 8, 5);
      m.castShadow = false;
      g.add(m);
    }
  }
  return g;
}

/** A glint: a little white four-sided star (gold catching the light). */
function glint(k: Kit, x: number, y: number, z: number, s = 2.2): Group {
  const g = new Group();
  const mat = k.paint(TOY.white);
  g.add(k.cone(mat, s, s * 2, 0, 0, 0, 4));
  const down = k.cone(mat, s, s * 2, 0, -s * 2, 0, 4);
  down.rotation.x = Math.PI;
  g.add(down);
  return k.at(g, x, y, z, Math.PI / 4);
}

/** A round-topped tree (a ball of leaves on a trunk). */
function tree(k: Kit, paint: (c: string) => Material, x: number, z: number, h = 40, color: string = TOY.leaf): Group {
  return k.group(k.cyl(paint(TOY.brown), 3, h * 0.5, x, 0, z, 2.4, 8), blob(paint(color), h * 0.38, x, h * 0.72, z, 0.9));
}

/** A pine (two cones on a trunk). */
function pine(k: Kit, paint: (c: string) => Material, x: number, z: number, h = 60): Group {
  return k.group(k.cyl(paint(TOY.brown), 2.6, h * 0.3, x, 0, z, 2, 6), k.cone(paint(TOY.green), h * 0.3, h * 0.55, x, h * 0.18, z, 8), k.cone(paint(TOY.green), h * 0.22, h * 0.45, x, h * 0.5, z, 8));
}

/** Bunting: little three-sided flags hanging along a line from `a` to `b`. */
function bunting(k: Kit, a: [number, number, number], b: [number, number, number], n: number): Group {
  const g = new Group();
  g.add(beam(k, k.paint(TOY.black), a, b, 0.6));
  const colors = [TOY.red, TOY.yellow, TOY.blue, TOY.green];
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n;
    const sag = Math.sin(t * Math.PI) * 3;
    const f = k.cone(k.paint(colors[i % 4]), 2.4, 5, 0, 0, 0, 3);
    f.rotation.x = Math.PI;
    f.position.set(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t - sag - 2.5, a[2] + (b[2] - a[2]) * t);
    g.add(f);
  }
  return g;
}

/**
 * The site's halt: the platform along x by the siding (`SECRET_HALT`), a shelter, the nameboard in the site's colour
 * with its emblem on both faces, lamps, bunting, tourists, and a path from the platform's back to the site at `pathX`.
 * Not found yet: the same platform rotting in the brambles, its board fallen, no track to it.
 */
function halt(k: Kit, found: boolean, accent: string, emblem: (k: Kit) => Object3D, pathX: number, seed: number): Group {
  const g = new Group();
  const { paint, wood } = sitePaint(k, found);
  const Z = PLAT.z;
  const top = PLAT.top;
  const back = Z - PLAT.depth / 2;
  // The path from the platform's back steps toward the site.
  g.add(k.box(paint("#d9c8a0"), 26, 1.6, 34, 0, pathX, 0, back - 17));
  if (!found) {
    // Three broken lengths of deck, one sagging; two shelter posts, the board face down in the weeds.
    for (const [x0, x1, tilt] of [[-100, -46, 0], [-38, 22, 0.08], [34, 100, 0]] as const) {
      const d = k.box(wood, x1 - x0, top - (tilt ? 4 : 0), PLAT.depth, 0, (x0 + x1) / 2, 0, Z);
      d.rotation.z = tilt;
      g.add(d);
    }
    g.add(stick(k, wood, 3, 22, 3, -80, top, Z - 10));
    const leaning = stick(k, wood, 3, 22, 3, -44, top - 4, Z - 10);
    leaning.rotation.z = -0.5;
    g.add(leaning);
    const board = stick(k, paint(accent), 52, 2.4, 14, 50, top + 1, Z + 2);
    board.rotation.z = 0.15;
    g.add(board, stick(k, wood, 2, 12, 2, 26, top, Z + 2));
    // (Kept to the platform's width: the track bed beside it stays clear for the line that finds it.)
    for (const x of [-84, -20, 40, 86]) g.add(brambles(k, 3, 5, x, Z - 7, seed + 100 + x, 8));
    g.add(brambles(k, 5, 18, pathX, back - 22, seed + 3));
    return g;
  }
  g.add(k.box(k.wood, PLAT.length, top, PLAT.depth, 1.5, 0, 0, Z));
  g.add(stick(k, k.paint(TOY.white), PLAT.length, 0.8, 3, 0, top, Z + PLAT.depth / 2 - 2));
  // Steps down at the back to the path.
  for (let i = 0; i < 3; i++) g.add(stick(k, k.wood, 24, top - i * 4.5, 5, pathX, 0, back - 2.5 - i * 5));
  // The shelter: posts, a back wall in the site's colour, a red roof, a bench.
  const sx = -64;
  for (const [dx, dz] of [[-19, -11], [19, -11], [-19, 7], [19, 7]]) g.add(stick(k, k.paint(accent), 3, 26, 3, sx + dx, top, Z + dz));
  g.add(stick(k, k.paint(accent), 40, 22, 2, sx, top, Z - 11.5));
  g.add(gable(k, k.paint(TOY.red), 48, 26, 9, sx, top + 26, Z - 2));
  g.add(stick(k, k.wood, 30, 2, 7, sx, top + 7, Z - 6), stick(k, k.wood, 30, 6, 1.5, sx, top + 9, Z - 9.5));
  for (const dx of [-12, 12]) g.add(stick(k, k.wood, 2, 7, 6, sx + dx, top, Z - 6));
  // The nameboard: on two black posts, a white frame, the site's colour and its emblem on both faces.
  const bx = 34;
  for (const dx of [-27, 27]) g.add(stick(k, k.paint(TOY.black), 2.4, 38, 2.4, bx + dx, top, Z + 2));
  g.add(stick(k, k.paint(TOY.white), 58, 20, 2.2, bx, top + 24, Z + 2), stick(k, k.paint(accent), 52, 15, 3, bx, top + 26.5, Z + 2));
  for (const s of [1, -1]) {
    const e = emblem(k);
    e.position.set(bx, top + 34, Z + 2 + s * 1.7);
    if (s < 0) e.rotation.y = Math.PI;
    g.add(e);
  }
  // Lamps, bunting from the shelter to the far lamp, tourists come to see.
  for (const lx of [-8, 92]) {
    g.add(k.cyl(k.paint(TOY.black), 1.2, 32, lx, top, Z + 8, 1.2, 6));
    g.add(stick(k, k.paint(TOY.yellow), 5, 6, 5, lx, top + 32, Z + 8), stick(k, k.paint(TOY.black), 7, 1.6, 7, lx, top + 38, Z + 8));
  }
  g.add(bunting(k, [sx + 20, top + 30, Z + 8], [-8, top + 31, Z + 8], 7));
  g.add(bunting(k, [-8, top + 31, Z + 8], [bx - 27, top + 36, Z + 4], 5));
  g.add(k.peg(TOY.red, TOY.yellow, -30, top, Z + 4), k.peg(TOY.blue, null, -22, top, Z - 2), k.peg(TOY.purple, TOY.white, 70, top, Z + 2));
  return g;
}

// ——— Emblems for the nameboards (about 40 × 12, in x/y, facing +z) ———

const emblems = {
  mine: (k: Kit) => {
    const g = new Group();
    for (const s of [-1, 1]) {
      const h = stick(k, k.paint(TOY.brown), 1.6, 13, 1, 0, 0, 0);
      h.position.set(-8, -6, 0);
      h.rotation.z = s * 0.7;
      g.add(h);
    }
    g.add(blob(k.paint(TOY.yellow), 4, 8, 0, 0.5, 0.8, 7, 5), blob(k.paint(TOY.yellow), 2.6, 13, -1.5, 0.5, 0.8, 7, 5));
    return g;
  },
  castle: (k: Kit) => {
    const crown = k.extrude(k.paint(TOY.yellow), [[-10, -5], [10, -5], [11, 4], [6, 0], [3, 6], [0, 1], [-3, 6], [-6, 0], [-11, 4]], 1, 0, 0, 0, 0.2);
    return k.group(crown, blob(k.paint(TOY.red), 1.6, 0, -2, 0.6, 1, 6, 4));
  },
  lake: (k: Kit) => k.group(
    k.extrude(k.paint(TOY.white), [[-11, -3], [11, -3], [14, 1], [-14, 1]], 1, 0, -2, 0, 0.2),
    k.extrude(k.paint(TOY.yellow), [[0, 0], [0, 10], [7, 0]], 0.8, 0, -1, 0, 0.2),
  ),
  ship: (k: Kit) => {
    const g = new Group();
    g.add(stick(k, k.paint(TOY.yellow), 2, 13, 1, 0, -6, 0), stick(k, k.paint(TOY.yellow), 10, 1.8, 1, 0, 4, 0));
    g.add(k.ring(k.paint(TOY.yellow), 2, 0.7, 0, 8.4, 0, true));
    g.add(k.at(k.ring(k.paint(TOY.yellow), 6, 1, 0, 0, 0, true, Math.PI), 0, -3, 0, 0).rotateZ(Math.PI));
    return g;
  },
  stones: (k: Kit) => {
    const grey = k.paint("#d7d3c9");
    return k.group(stick(k, grey, 4, 10, 1, -5, -6, 0), stick(k, grey, 4, 10, 1, 5, -6, 0), stick(k, grey, 16, 3, 1, 0, 4, 0), blob(k.paint(TOY.yellow), 2.6, 12, 4, 0.5, 1, 6, 4));
  },
  footprint: (k: Kit) => {
    const g = new Group();
    const sole = blob(k.paint(TOY.brown), 7, -3, -1, 0.4, 0.45, 8, 5);
    sole.scale.z = 0.15;
    g.add(sole);
    for (const [x, y, r] of [[7, 4, 2.2], [9, 0, 1.8], [8, -3.5, 1.5], [6, -6, 1.3]] as const) g.add(k.cylZ(k.paint(TOY.brown), r, 1, x, y, 0, 8));
    return g;
  },
};

// ——— The lost mine: a rock face with its adit, the headframe over the shaft, a cart of gold ———

function cart(k: Kit, paint: (c: string) => Material, load: "gold" | "rock" | "none"): Group {
  const g = new Group();
  // Along z (its rails), 24 long, 18 wide.
  g.add(k.box(paint(TOY.red), 18, 13, 24, 1.5, 0, 4, 0));
  g.add(stick(k, paint(TOY.black), 19, 2, 25, 0, 15, 0));
  for (const z of [-7, 7]) g.add(k.cylX(paint(TOY.black), 3.6, 20, 0, 4, z, 8));
  if (load === "gold") {
    const R = rnd(7);
    for (let i = 0; i < 7; i++) g.add(blob(paint(TOY.yellow), 3.4 + R() * 1.8, -5 + (i % 3) * 5, 17 + (i > 4 ? 3 : 0), -7 + Math.floor(i / 3) * 6 + R() * 2, 0.8, 7, 5));
  } else if (load === "rock") {
    for (let i = 0; i < 4; i++) g.add(blob(paint("#7b766d"), 4.2, -4 + (i % 2) * 8, 16, -5 + Math.floor(i / 2) * 9, 0.75, 6, 4));
  }
  return g;
}

function lostMine(k: Kit, found: boolean): Object3D {
  const g = new Group();
  const { paint, wood } = sitePaint(k, found);
  const rocks = [paint("#878d96"), paint("#757b85"), paint("#9aa0a8")];
  // The yard: packed gravel.
  g.add(k.box(paint("#d6bf8e"), 290, 2, 220, 1, 0, 0, -12));
  // The rock face: chunky stepped blocks along the back, an upper tier, boulders in front.
  const blocks: [number, number, number, number, number, number, number][] = [
    [-108, -95, 64, 74, 60, 0, 0], [-46, -106, 66, 104, 56, 1, 0], [30, -100, 84, 96, 64, 0, 0], [100, -97, 62, 82, 60, 1, 0],
    [142, -72, 28, 46, 50, 2, 0], [-142, -64, 26, 40, 46, 2, 0], [-62, -112, 50, 30, 40, 2, 104], [22, -110, 56, 40, 44, 2, 96],
    [90, -106, 40, 26, 40, 0, 82], [-128, -26, 22, 18, 20, 0, 0], [126, -32, 26, 22, 24, 1, 0], [74, -54, 26, 20, 20, 2, 0],
  ];
  for (const [x, z, w, h, d, m, y] of blocks) g.add(k.box(rocks[m], w, h, d, 5, x, y, z));
  // Seams of gold in the rock.
  const gold = paint(TOY.yellow);
  for (const [x, y, z, a] of [[-56, 62, -77.4, 0.5], [-34, 38, -77.4, -0.3], [54, 72, -67.4, 0.2], [66, 30, -67.4, -0.6], [-112, 52, -64.4, 0.4], [108, 56, -66.4, -0.2], [12, 112, -87.4, 0.3]] as const) {
    const s = stick(k, gold, 12, 2.4, 1.4, x, y, z);
    s.rotation.z = a;
    g.add(s, stick(k, gold, 5, 2, 1.4, x + 6, y + 3, z));
  }
  // The adit: a dark mouth with a timber portal, its lamp.
  const ax = 20;
  g.add(k.box(k.cut, 34, 44, 4, 0, ax, 0, -67));
  for (const dx of [-20, 20]) g.add(stick(k, wood, 6, 48, 6, ax + dx, 0, -64));
  g.add(stick(k, wood, 52, 7, 8, ax, 46, -64), stick(k, wood, 30, 5, 3, ax, 53, -61));
  // Rails out of the adit to a buffer by the path, sleepers under them.
  const steel = paint(TOY.grey);
  for (const dx of [-6, 6]) g.add(stick(k, steel, 1.8, 2, 164, ax + dx, 1.5, 16));
  for (let i = 0; i < 12; i++) if (found || i % 3 !== 1) g.add(stick(k, wood, 20, 1.6, 4, ax, 1, -58 + i * 14));
  g.add(stick(k, wood, 22, 8, 4, ax, 1, 99));
  // The winding house: brick walls, slate roof, a tall chimney.
  const wh = { x: -116, z: 4 };
  g.add(k.box(paint("#a8553a"), 42, 32, 40, 1.5, wh.x, 0, wh.z));
  g.add(gable(k, paint("#4c5866"), 48, 46, 14, wh.x, 32, wh.z, 3));
  g.add(k.cyl(paint(TOY.black), 5, 76, wh.x - 12, 0, wh.z - 12, 4, 10), k.cyl(paint(TOY.red), 6, 4, wh.x - 12, 76, wh.z - 12, 6, 10));
  g.add(stick(k, k.cut, 1, 14, 12, wh.x + 21.3, 4, wh.z + 6), stick(k, k.cut, 1, 8, 8, wh.x + 21.3, 18, wh.z - 10));
  // The headframe over the shaft: four splayed legs, braces, a deck, the big sheave wheel, its back-stays.
  const hf = new Group();
  const H = 118;
  const red = paint(TOY.red);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) hf.add(beam(k, wood, [sx * 18, 0, sz * 14], [sx * 7, H, sz * 6], 4));
  for (const y of [40, 80]) {
    const sp = 18 - (11 * y) / H;
    const sq = 14 - (8 * y) / H;
    for (const sz of [-1, 1]) hf.add(stick(k, wood, sp * 2 + 4, 3, 3, 0, y, sz * sq));
    for (const sx of [-1, 1]) hf.add(stick(k, wood, 3, 3, sq * 2 + 4, sx * sp, y, 0));
  }
  for (const sz of [-1, 1]) hf.add(beam(k, wood, [-18, 0, sz * 14], [11, 80, sz * 9], 2.4), beam(k, wood, [18, 0, sz * 14], [-11, 80, sz * 9], 2.4));
  hf.add(stick(k, wood, 22, 4, 18, 0, H, 0));
  for (const sz of [-1, 1]) hf.add(beam(k, wood, [-34, 0, sz * 12], [-3, H, sz * 6], 3.4));
  const wheel = new Group();
  wheel.add(k.ring(red, 14, 2.2, 0, 0, 0, true));
  for (const a of [0, Math.PI / 3, (2 * Math.PI) / 3]) {
    const sp = stick(k, red, 2, 26, 1.4, 0, -13, 0);
    sp.rotation.z = a;
    wheel.add(k.group(sp));
  }
  wheel.add(k.cylZ(paint(TOY.black), 3, 5, 0, 0, 0, 8));
  // The shaft's collar under it, the cage hanging on its rope.
  hf.add(k.box(k.cut, 22, 3, 18, 0, 0, 0, 0), stick(k, paint("#5c4a3a"), 26, 4, 22, 0, 0, 0).translateY(-0.5));
  if (found) {
    hf.add(k.at(wheel, 0, H + 16, 0));
    hf.add(stick(k, paint(TOY.black), 0.8, 54, 0.8, 0, H - 38, 0), k.box(paint(TOY.yellow), 12, 16, 10, 0, 0, H - 56, 0));
    hf.add(beam(k, paint(TOY.black), [-14, H + 18, 0], [wh.x + 76, 30, wh.z], 0.8));
    hf.add(pennant(k, TOY.yellow, 26, 0, H + 30, 0));
  }
  if (!found) hf.rotation.z = 0.16;
  g.add(k.at(hf, -60, 0, -34));
  if (!found) {
    // The wheel fallen at the foot of the frame.
    const w = k.at(wheel, -30, 4, -2);
    w.rotation.x = Math.PI / 2 - 0.15;
    g.add(w);
  }
  if (found) {
    // Gold in the cart at the mouth, catching the light; a second cart of rock; bars stacked by the rails.
    g.add(k.at(cart(k, paint, "gold"), ax, 2, 46), k.at(cart(k, paint, "rock"), ax, 2, 4));
    for (const [x, y, z] of [[ax - 2, 26, 46], [ax + 5, 23, 40], [ax - 6, 22, 52], [-46, 72, -76], [58, 78, -66], [108, 62, -65]] as const) g.add(glint(k, x, y, z, 2.4));
    for (let i = 0; i < 6; i++) g.add(k.box(gold, 12, 4, 6, 0, ax + 26 + (i % 3) * 0 + (i < 3 ? 0 : 1), 1 + Math.floor(i / 3) * 4, 62 + (i % 3) * 6.5 - (i < 3 ? 0 : -3)));
    g.add(glint(k, ax + 27, 13, 68, 2));
    // The adit's lamp lit; dynamite in a crate; barrels; a pick and shovel; the prospector who found it.
    g.add(stick(k, paint(TOY.black), 1, 8, 1, ax + 14, 38, -59), k.box(paint(TOY.yellow), 5, 7, 5, 0, ax + 14, 31, -59), stick(k, paint(TOY.black), 6, 1.4, 6, ax + 14, 38, -59));
    g.add(k.box(wood, 22, 12, 16, 1, 70, 0, 6));
    for (let i = 0; i < 4; i++) g.add(k.cyl(paint(TOY.red), 2.2, 10, 64 + i * 4, 9, 6 + (i % 2) * 3, 2.2, 6));
    for (const [x, z] of [[-86, 30], [-74, 36], [-82, 44]] as const) g.add(k.cyl(paint(TOY.brown), 7, 16, x, 0, z, 6, 10), k.cyl(paint(TOY.black), 7.3, 1.6, x, 4, z, 7.3, 10), k.cyl(paint(TOY.black), 6.8, 1.6, x, 11, z, 6.8, 10));
    g.add(beam(k, paint(TOY.brown), [-6, 0, -60], [2, 34, -64], 2), beam(k, paint(TOY.grey), [-6, 33, -62], [10, 31, -66], 2.4));
    g.add(beam(k, paint(TOY.brown), [46, 0, -60], [50, 34, -64], 2), k.box(paint(TOY.grey), 8, 10, 1.6, 0, 46, -1, -60));
    g.add(k.peg(TOY.blue, TOY.yellow, ax + 18, 0, 34), k.peg(TOY.red, null, -40, 0, 70), k.peg(TOY.green, TOY.white, -28, 0, 80));
    g.add(pennant(k, TOY.red, 30, 22, 136, -110));
  } else {
    // Boarded up, the empty cart on its side, grown over and fogged.
    for (const [y, a] of [[8, 0.1], [20, -0.08], [32, 0.05]] as const) {
      const p = stick(k, wood, 40, 5, 2, ax, y, -63);
      p.rotation.z = a;
      g.add(p);
    }
    const x1 = stick(k, wood, 48, 4, 2, ax, 22, -62);
    x1.rotation.z = 0.8;
    g.add(x1);
    const c = k.at(cart(k, paint, "none"), ax + 30, 9, 30);
    c.rotation.z = 1.45;
    g.add(c);
    g.add(brambles(k, 9, 34, ax, -50, 2), brambles(k, 6, 26, -60, -20, 5), brambles(k, 6, 30, -116, 30, 9), brambles(k, 5, 26, 100, -50, 11));
    g.add(mist(k, 9, 120, 0, -30, 3, 6));
  }
  g.add(halt(k, found, TOY.yellow, emblems.mine, -30, 21));
  return g;
}

// ——— The castle: walls, four towers, a gatehouse and the keep, banners flying ———

function castle(k: Kit, found: boolean): Object3D {
  const g = new Group();
  const { paint, wood } = sitePaint(k, found);
  const stone = paint("#d2c7b0");
  const stone2 = paint("#b8ad96");
  const roofRed = paint(TOY.red);
  // The mound: a broad grassy hill, the castle on its top (y 22).
  const Y = 22;
  g.add(k.cyl(paint("#6b9a4c"), 124, Y, 0, 0, -28, 102, 40));
  const cz = -30;
  const S = 62;
  const merlons = (len: number, x: number, y: number, z: number, ry: number, keep = (i: number) => i >= 0) => {
    const m = new Group();
    const n = Math.floor(len / 14);
    for (let i = 0; i < n; i++) if (keep(i)) m.add(stick(k, stone, 7, 8, 12, -len / 2 + 7 + i * 14 + (len - n * 14) / 2, 0, 0));
    return k.at(m, x, y, z, ry);
  };
  // Curtain walls: back, both sides, the front either side of the gate (lower and gapped when ruined).
  const walls: [number, number, number, number][] = [
    [0, cz - S, 2 * S, 0], [-S, cz, 2 * S, Math.PI / 2], [S, cz, 2 * S, Math.PI / 2],
    [-(S + 22) / 2, cz + S, S - 22, 0], [(S + 22) / 2, cz + S, S - 22, 0],
  ];
  for (const [i, [x, z, len, ry]] of walls.entries()) {
    const h = found ? 40 : [26, 16, 30, 12, 22][i];
    const w = k.at(k.box(stone, len, h, 11, 1.2), x, Y, z, ry);
    if (!found && i === 1) w.scale.x = 0.55; // a breach in the west wall
    g.add(w);
    g.add(merlons(len, x, Y + h, z, ry, found ? undefined : (j) => j % 3 === 0 && i !== 1));
  }
  // Four round corner towers with conical red roofs and pennants (broken stumps when ruined).
  for (const [i, [x, z]] of ([[-S, cz - S], [S, cz - S], [-S, cz + S], [S, cz + S]] as const).entries()) {
    const h = found ? 66 : [52, 34, 26, 44][i];
    g.add(k.cyl(stone2, 15, h, x, Y, z, 15, 24));
    g.add(k.cyl(stone, 17.5, 6, x, Y + h - 4, z, 17.5, 24));
    for (const a of [0, 1, 2, 3, 4, 5, 6, 7]) if (found || a % 3 === 0) g.add(stick(k, stone2, 3, 10, 1, x + Math.cos((a * Math.PI) / 4) * 15.6, Y + 26, z + Math.sin((a * Math.PI) / 4) * 15.6).rotateY(-(a * Math.PI) / 4 + Math.PI / 2));
    if (found) {
      g.add(k.cone(roofRed, 20, 32, x, Y + h + 2, z, 16));
      g.add(pennant(k, i % 2 ? TOY.yellow : TOY.blue, 20, x, Y + h + 33, z));
    }
  }
  // The gatehouse on the front (+z): two square towers, the arch, the portcullis, the drawbridge down.
  const gz = cz + S;
  for (const sx of [-1, 1]) {
    const h = found ? 58 : sx < 0 ? 40 : 30;
    g.add(k.box(stone2, 24, h, 24, 1.2, sx * 21, Y, gz));
    for (const [dx, dz] of [[-8, -8], [8, -8], [-8, 8], [8, 8]]) if (found || dx < 0) g.add(stick(k, stone, 7, 8, 7, sx * 21 + dx, Y + h, gz + dz));
    g.add(stick(k, k.cut, 4, 9, 1, sx * 21, Y + h - 22, gz + 12.3));
  }
  g.add(k.box(stone, 20, 16, 22, 0, 0, Y + 32, gz));
  g.add(stick(k, k.cut, 18, 32, 1, 0, Y, gz + 11.2));
  const iron = paint(TOY.black);
  const portY = found ? Y + 22 : Y + 2;
  for (const dx of [-6, -2, 2, 6]) g.add(stick(k, iron, 1.4, found ? 12 : 26, 1.4, dx, portY, gz + 12));
  for (const y of found ? [4, 9] : [6, 14, 22]) g.add(stick(k, iron, 17, 1.4, 1.4, 0, portY + y, gz + 12));
  if (found) {
    const bridge = stick(k, wood, 18, 2.5, 34, 0, 0, 0);
    bridge.position.set(0, Y - 4, gz + 28);
    bridge.rotation.x = 0.36;
    g.add(bridge);
    for (const sx of [-1, 1]) g.add(beam(k, iron, [sx * 9, Y + 30, gz + 12], [sx * 9, Y - 3, gz + 44], 0.8));
  }
  // The keep: a tall square tower, corner turrets with red caps, windows, the great flag and its banners.
  const kz = cz - 14;
  const KH = found ? 100 : 62;
  g.add(k.box(stone, 52, KH, 48, 2, 0, Y, kz));
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    if (!found && sx * sz > 0) continue;
    g.add(k.cyl(stone2, 7, found ? 22 : 10, sx * 24, Y + KH - 2, kz + sz * 22, 7, 14));
    if (found) g.add(k.cone(roofRed, 9, 16, sx * 24, Y + KH + 20, kz + sz * 22, 12));
  }
  for (let i = 0; i < 3; i++) g.add(stick(k, stone, 8, 8, 6, -10 + i * 10, Y + KH, kz + 21), stick(k, stone, 8, 8, 6, -10 + i * 10, Y + KH, kz - 21));
  for (const [x, y] of [[-12, 46], [12, 46], [0, 72], [-12, 72], [12, 72]] as const) if (y < KH - 8) g.add(stick(k, k.cut, 5, 10, 1, x, Y + y, kz + 24.2));
  g.add(stick(k, k.cut, 10, 16, 1, 0, Y, kz + 24.2));
  if (found) {
    g.add(k.cyl(wood, 1.4, 46, 0, Y + KH, kz, 1.4, 8));
    const flag = new Shape();
    flag.moveTo(0, 0);
    flag.lineTo(34, 0);
    flag.lineTo(28, -10);
    flag.lineTo(34, -20);
    flag.lineTo(0, -20);
    g.add(k.extrude(paint(TOY.red), flag, 1.4, 1, Y + KH + 46, kz, 0.3), stick(k, paint(TOY.yellow), 30, 4, 1.8, 15, Y + KH + 34, kz));
    g.add(blob(paint(TOY.yellow), 2.4, 0, Y + KH + 47, kz, 1, 6, 4));
    // Long banners down the keep's front and the gatehouse towers: swallowtails, a yellow bar across each.
    const banner = (color: string, x: number, y: number, z: number, h: number) =>
      k.group(
        k.extrude(paint(color), [[-7, 0], [7, 0], [7, -h], [0, -h + 7], [-7, -h]], 1, x, y, z, 0.2),
        stick(k, paint(TOY.yellow), 14, 3, 1.6, x, y - h * 0.35, z),
        stick(k, wood, 18, 1.6, 1.6, x, y, z),
      );
    g.add(banner(TOY.red, -15, Y + 92, kz + 25, 40), banner(TOY.blue, 15, Y + 92, kz + 25, 40));
    for (const sx of [-1, 1]) g.add(banner(sx < 0 ? TOY.blue : TOY.red, sx * 21, Y + 52, gz + 13, 24));
    g.add(bunting(k, [-S, Y + 44, gz], [-30, Y + 56, gz], 6), bunting(k, [30, Y + 56, gz], [S, Y + 44, gz], 6));
    // In the bailey: a well, a market tent, a knight and visitors; a path down the mound to the halt.
    g.add(k.cyl(stone2, 8, 8, 34, Y, cz + 24, 8, 14), k.cyl(k.water, 6, 1, 34, Y + 7.4, cz + 24, 6, 12), stick(k, wood, 2, 16, 2, 28, Y + 8, cz + 24), stick(k, wood, 2, 16, 2, 40, Y + 8, cz + 24), gable(k, roofRed, 18, 10, 5, 34, Y + 24, cz + 24, 1.6));
    g.add(k.cone(paint(TOY.yellow), 14, 20, -34, Y, cz + 24, 8), k.cone(paint(TOY.red), 6, 8, -34, Y + 20, cz + 24, 8));
    g.add(k.peg(TOY.grey, TOY.grey, -14, Y, cz + 40), k.peg(TOY.red, TOY.yellow, 12, Y, cz + 44), k.peg(TOY.pink, null, 0, 0, 96), k.peg(TOY.blue, TOY.white, 8, 0, 104));
  } else {
    // Rubble in the gateway, ivy up the walls, a dead tree, mist round the mound.
    for (let i = 0; i < 6; i++) g.add(blob(stone2, 5 + (i % 3), -10 + i * 4, Y + 3, gz + 18 + (i % 2) * 6, 0.6, 6, 4));
    g.add(brambles(k, 10, 60, 0, cz, 4, Y), brambles(k, 7, 30, -S, cz - 20, 6, Y + 8), brambles(k, 6, 28, S, cz - S, 8, Y + 12));
    const dead = beam(k, paint(TOY.brown), [80, 0, 40], [86, 54, 30], 4);
    g.add(dead, beam(k, paint(TOY.brown), [84, 38, 32], [100, 58, 26], 2.4), beam(k, paint(TOY.brown), [86, 44, 31], [72, 62, 34], 2.4));
    g.add(mist(k, 10, 130, 0, -20, 12, 8));
  }
  g.add(halt(k, found, TOY.red, emblems.castle, 0, 31));
  return g;
}

// ——— The hidden lake: a waterfall, an island with its temple, a boathouse, boats and swans ———

function boat(k: Kit, paint: (c: string) => Material, color: string): Group {
  const g = new Group();
  const hull = k.extrude(paint(color), [[-12, 0], [10, 0], [16, 6], [-14, 6]], 11, 0, 0, 0, 1.2);
  g.add(hull, stick(k, k.wood, 3, 1, 9, -4, 5, 0), stick(k, k.wood, 3, 1, 9, 5, 5, 0));
  return g;
}

function swan(k: Kit, x: number, z: number, ry: number): Group {
  const white = k.paint(TOY.white);
  const g = new Group();
  g.add(blob(white, 6, 0, 4, 0, 0.6, 8, 5), blob(white, 3.6, -5, 6, 0, 0.7, 6, 4));
  g.add(beam(k, white, [3, 5, 0], [5, 15, 0], 2.2), blob(white, 2.4, 5.5, 16, 0, 1, 6, 4));
  const beak = k.cone(k.paint(TOY.orange), 1.1, 3.4, 0, 0, 0, 6);
  beak.rotation.z = -Math.PI / 2;
  beak.position.set(9, 15.6, 0);
  g.add(beak);
  return k.at(g, x, 2, z, ry);
}

function lake(k: Kit, found: boolean): Object3D {
  const g = new Group();
  const { paint, wood } = sitePaint(k, found);
  const water = found ? k.water : paint("#7e9198");
  const R = rnd(13);
  g.add(k.cyl(paint("#6aa04f"), 140, 2, 0, 0, -12, 140, 48));
  const lz = -26;
  g.add(k.cyl(water, 100, 1.6, 0, 2, lz, 100, 48));
  // Rocks round the shore (left open at the front, where the jetty comes in).
  for (let i = 0; i < 26; i++) {
    const a = (i / 26) * Math.PI * 2;
    if (Math.sin(a) > 0.85) continue;
    const r = 6 + R() * 6;
    g.add(k.cyl(paint(i % 2 ? "#9a968c" : "#aaa69a"), r, 4 + R() * 5, Math.cos(a) * 102, 0, lz + Math.sin(a) * 102, r * 0.8, 7));
  }
  // The waterfall: a cliff at the back, water spilling down it into a pool, foam at its foot.
  const rock = [paint("#8f8a80"), paint("#a29d92")];
  for (const [x, z, w, h, d, m] of [[-56, -132, 40, 62, 30, 0], [-8, -138, 44, 84, 30, 1], [40, -132, 46, 58, 28, 0], [-92, -122, 30, 38, 26, 1], [80, -120, 30, 34, 26, 1], [-14, -140, 56, 24, 26, 0]] as const) g.add(k.box(rock[m], w, h, d, 4, x, z === -140 ? 84 : 0, z));
  g.add(k.box(water, 22, 76, 3, 0, -8, 4, -121.5), k.box(water, 26, 2, 16, 0, -8, 76, -130));
  if (found) for (const [x, s] of [[-16, 7], [-6, 9], [2, 6], [-10, 5]] as const) g.add(blob(k.paint(TOY.white), s, x, 4, -114 + (s % 3), 0.5, 7, 5));
  // The island and its little round temple: a ring of white columns under a teal dome.
  const ix = -28;
  const iz = lz - 10;
  g.add(k.cyl(paint("#79a858"), 28, 5, ix, 0, iz, 30, 20), k.cyl(paint(TOY.white), 19, 4, ix, 5, iz, 20, 20));
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    g.add(k.cyl(paint(TOY.white), 2.2, found ? 24 : 18, ix + Math.cos(a) * 15, 9, iz + Math.sin(a) * 15, 2.2, 8));
  }
  if (found) {
    g.add(k.cyl(paint(TOY.cream), 19, 4, ix, 33, iz, 19, 20));
    g.add(k.lathe(paint(TOY.teal), [[18, 0], [17, 5], [14, 10], [9, 14], [0, 16]], ix, 37, iz, 16), blob(paint(TOY.yellow), 3, ix, 55, iz, 1, 6, 4));
  } else {
    // Its dome fallen in, one column down.
    const col = k.cyl(paint(TOY.white), 2.2, 20, 0, 0, 0, 2.2, 8);
    col.rotation.z = Math.PI / 2;
    col.position.set(ix + 10, 8, iz + 24);
    g.add(col);
  }
  // The boathouse on stilts at the water's edge, a jetty from it to the path.
  const bx = 78;
  const bz = -40;
  for (const [x, z] of [[-14, -14], [14, -14], [-14, 14], [14, 14]]) g.add(stick(k, wood, 3, 12, 3, bx + x, 0, bz + z));
  g.add(stick(k, wood, 34, 2, 34, bx, 12, bz), k.box(paint(TOY.green), 32, 24, 30, 1.2, bx, 14, bz), stick(k, k.cut, 1, 16, 18, bx - 16.4, 14, bz));
  const roof = gable(k, paint(TOY.red), 38, 36, 14, bx, 38, bz, 2.5);
  if (!found) roof.rotation.z = 0.12;
  g.add(roof, stick(k, k.paint(TOY.white), 1, 5, 6, bx - 16.4, 30, bz));
  const jx = 40;
  g.add(stick(k, wood, 14, 2, 120, jx, 7, 34), stick(k, wood, 30, 2, 14, jx + 20, 7, -18));
  for (let i = 0; i < 5; i++) g.add(stick(k, wood, 2.4, 9, 2.4, jx + 8, 0, -16 + i * 26), stick(k, wood, 2.4, 9, 2.4, jx - 8, 0, -16 + i * 26));
  // Reeds in clumps, lily pads.
  for (const [x, z] of [[-90, 10], [-70, 40], [90, 20], [-96, -60], [70, -96]] as const)
    for (let j = 0; j < 4; j++) g.add(k.cyl(paint("#6b8f3a"), 0.9, 14 + j * 3, x + (j % 2) * 4, 2, z + j * 3, 0.5, 4), k.cyl(paint(TOY.brown), 1.4, 5, x + (j % 2) * 4, 14 + j * 3, z + j * 3, 1.4, 5));
  if (found) {
    for (const [x, z] of [[-60, 14], [-50, 24], [10, 30], [18, 16], [-70, -6], [56, 30]] as const) g.add(k.cyl(paint(TOY.leaf), 5, 0.6, x, 3.6, z, 5, 8));
    for (const [x, z] of [[-50, 24], [10, 30], [-70, -6]] as const) g.add(blob(paint(TOY.pink), 2.2, x, 5, z, 0.8, 6, 4));
    // Boats out on the water and tied at the jetty, swans, a fisher, a bench.
    const b1 = k.at(boat(k, paint, TOY.red), 10, 3, -10, 0.5);
    b1.add(k.peg(TOY.yellow, TOY.blue, 0, 4, 0), beam(k, k.wood, [0, 10, -12], [4, 4, 10], 1));
    g.add(b1, k.at(boat(k, paint, TOY.blue), jx - 16, 3, 50, Math.PI / 2), k.at(boat(k, paint, TOY.yellow), ix + 26, 3, iz - 10, 2.2));
    g.add(swan(k, -66, -40, 0.4), swan(k, -50, -46, 0.6), swan(k, 26, -74, 2.6));
    g.add(k.peg(TOY.green, TOY.yellow, jx, 9, 56), beam(k, paint(TOY.brown), [jx + 2, 18, 56], [jx - 24, 34, 50], 1), stick(k, paint(TOY.black), 0.5, 30, 0.5, jx - 24, 4, 50));
    g.add(stick(k, k.wood, 26, 2, 8, -60, 8, 86), stick(k, k.wood, 26, 8, 2, -60, 10, 82), stick(k, k.wood, 2, 8, 6, -70, 0, 86), stick(k, k.wood, 2, 8, 6, -50, 0, 86));
    g.add(k.box(paint(TOY.red), 30, 0.8, 22, 0.2, -100, 2, 64), k.peg(TOY.cream, TOY.green, -94, 2, 70), k.peg(TOY.purple, null, -106, 2, 58));
    g.add(pennant(k, TOY.yellow, 18, bx, 52, bz));
    for (const [x, z, h] of [[-120, -70, 46], [118, -80, 40], [-112, 52, 38]] as const) g.add(tree(k, paint, x, z, h));
    for (const [x, z] of [[-110, -100], [104, -100], [128, 10]] as const) g.add(pine(k, paint, x, z, 64));
  } else {
    // A thick ring of woods, mist lying on the water, the dome's ghost through it, a boat sunk to its bow.
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2 + 0.1;
      if (Math.sin(a) > 0.8) continue;
      g.add(pine(k, paint, Math.cos(a) * 124, lz + Math.sin(a) * 118, 70 + (i % 3) * 10));
    }
    for (const [x, z] of [[-70, 66], [86, 60], [-30, 84]] as const) g.add(pine(k, paint, x, z, 60));
    const sunk = k.at(boat(k, paint, TOY.blue), 4, -2, 10, 0.4);
    sunk.rotation.z = 0.6;
    g.add(sunk);
    g.add(mist(k, 10, 90, 0, lz, 14, 6), brambles(k, 6, 40, jx, 40, 15, 8));
  }
  g.add(halt(k, found, TOY.blue, emblems.lake, jx, 41));
  return g;
}

// ——— The shipwreck: a whole galleon heeled on the beach, its treasure spilling out ———

function palm(k: Kit, paint: (c: string) => Material, x: number, z: number, lean: number): Group {
  const g = new Group();
  for (let i = 0; i < 6; i++) g.add(k.cyl(paint("#9a7048"), 3.4 - i * 0.2, 11, i * lean, i * 10.4, 0, 3.2 - i * 0.2, 7));
  const tx = 6 * lean;
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const leaf = stick(k, paint(TOY.leaf), 30, 1.2, 7, 0, 0, 0);
    leaf.position.set(tx + Math.cos(a) * 12, 62, Math.sin(a) * 12);
    leaf.rotation.y = -a;
    leaf.rotation.z = -0.45;
    g.add(k.group(leaf));
  }
  g.add(blob(paint(TOY.brown), 3, tx + 2, 60, 2, 1, 6, 4), blob(paint(TOY.brown), 3, tx - 2, 60, -2, 1, 6, 4));
  return k.at(g, x, 0, z);
}


function shipwreck(k: Kit, found: boolean): Object3D {
  const g = new Group();
  const { paint, wood } = sitePaint(k, found);
  const sand = paint("#e6d29f");
  // The beach, to a straight seaward edge (z = SHIPWRECK_SEA_Z) where the map's sea begins: the site stands on a shore,
  // its sand over the beach squares, its halt inland. The sea and surf past that edge are the catalogue's (an underlay:
  // left out in the game, where the map's own sea is there).
  const sea = SHIPWRECK_SEA_Z;
  g.add(k.box(sand, 290, 2.6, -sea, 1, 0, 0, sea / 2), k.cyl(sand, 122, 2.6, 0, 0, 22, 120, 48));
  const shore = new Group();
  shore.userData.underlay = true;
  shore.add(k.box(found ? k.water : paint("#7e9198"), 330, 2, 70, 0, 0, 0, sea - 35));
  for (const [x, w] of [[-100, 60], [-20, 80], [76, 70]] as const) shore.add(stick(k, paint(TOY.white), w, 2, 4, x, 1.6, sea - 4 - (x % 7)));
  g.add(shore);
  // The ship: a toy galleon's hull (stern castle at −x, bow at +x), deck, stripe, portholes, a hole in her side.
  const ship = new Group();
  const side = new Shape();
  side.moveTo(-84, 56);
  side.lineTo(-84, 18);
  side.quadraticCurveTo(-80, 0, -54, 0);
  side.lineTo(48, 0);
  side.quadraticCurveTo(84, 4, 98, 40);
  side.quadraticCurveTo(60, 30, 20, 30);
  side.lineTo(-44, 30);
  side.quadraticCurveTo(-70, 32, -84, 56);
  const hullBrown = paint("#8a5a34");
  ship.add(k.extrude(hullBrown, side, 48, 0, 0, 0, 6));
  ship.add(stick(k, k.wood, 120, 2, 38, -6, 28, 0));
  ship.add(stick(k, paint(TOY.red), 150, 3, 49, -4, 2, 0));
  for (const z of [-24.4, 24.4]) ship.add(stick(k, paint(TOY.yellow), 118, 3, 1, -6, 22, z));
  for (let i = 0; i < 5; i++) ship.add(k.cylZ(paint(TOY.black), 2.6, 49.4, -52 + i * 22, 14, 0, 8));
  // Stern castle: a raised deck, gallery windows across its stern, a rail.
  ship.add(k.box(paint("#6e4628"), 30, 16, 44, 1, -66, 30, 0));
  for (const z of [-12, 0, 12]) ship.add(stick(k, paint(TOY.yellow), 1, 8, 7, -84.6, 34, z));
  for (let i = 0; i < 5; i++) ship.add(stick(k, k.wood, 2, 7, 2, -78 + i * 6, 46, 20), stick(k, k.wood, 2, 7, 2, -78 + i * 6, 46, -20));
  ship.add(stick(k, k.wood, 30, 1.6, 2, -66, 53, 20), stick(k, k.wood, 30, 1.6, 2, -66, 53, -20));
  // A hole stove in her +z side, ribs across it.
  ship.add(stick(k, k.cut, 26, 14, 1, -18, 6, 24.4));
  for (const x of [-26, -18, -10]) ship.add(stick(k, wood, 2.4, 16, 2, x, 5, 25));
  if (found) {
    // Bowsprit and figurehead; the mainmast with its yards, sails, crow's nest and the black flag; rigging.
    ship.add(beam(k, k.wood, [84, 34, 0], [136, 58, 0], 3.4), blob(paint(TOY.yellow), 5, 96, 30, 0, 1.3, 7, 5), blob(k.wood, 3.4, 99, 40, 0, 1, 6, 4));
    const mx = 6;
    ship.add(k.cyl(k.wood, 3.6, 150, mx, 28, 0, 2.6, 10));
    for (const [y, len] of [[78, 76], [124, 56]] as const) ship.add(k.cylZ(k.wood, 1.6, len, mx, 28 + y, 0, 6));
    const sail = (w: number, h: number, y: number) => {
      const s = k.extrude(paint(TOY.cream), [[-w / 2, 0], [w / 2, 0], [w / 2 - 3, h], [-w / 2 + 3, h]], 2.4, 0, 0, 0, 0.4);
      s.rotation.y = Math.PI / 2;
      s.rotation.x = 0.12;
      s.position.set(mx + 4, 28 + y, 0);
      return s;
    };
    ship.add(sail(70, 40, 38), sail(52, 34, 88));
    ship.add(stick(k, paint(TOY.red), 1.6, 6, 72, mx + 5, 60, 0));
    ship.add(k.cyl(k.wood, 8, 6, mx, 166, 0, 9, 12));
    ship.add(k.extrude(paint(TOY.black), [[0, 0], [24, 0], [24, -15], [0, -15]], 1.2, mx, 190, 0, 0.2), blob(paint(TOY.white), 2.8, mx + 12, 184, 0, 1, 6, 4));
    for (const a of [0.6, -0.6]) {
      const bone = stick(k, paint(TOY.white), 10, 1.2, 1.6, mx + 12, 179, 0);
      bone.rotation.z = a;
      ship.add(bone);
    }
    const rope = paint("#4a3a2a");
    ship.add(beam(k, rope, [mx, 176, 0], [134, 56, 0], 0.8), beam(k, rope, [mx, 176, 0], [-80, 50, 0], 0.8));
    for (const z of [-22, 22]) ship.add(beam(k, rope, [mx, 150, 0], [mx - 16, 30, z], 0.8), beam(k, rope, [mx, 150, 0], [mx + 16, 30, z], 0.8));
    // The mizzen, broken off short on the stern castle.
    ship.add(k.cyl(k.wood, 2.6, 34, -66, 46, 0, 2.2, 8));
  } else {
    // Her mast broken off at the deck, seaweed hung on her.
    ship.add(k.cyl(wood, 3.6, 22, 6, 28, 0, 3.4, 10));
    ship.add(brambles(k, 6, 50, -10, 0, 17, 18, "#4f6f45"));
  }
  // Heeled toward the beach, her keel bedded in the sand (deeper, and banked over, before she's found).
  ship.rotation.x = found ? 0.2 : 0.3;
  ship.rotation.z = found ? 0.05 : 0;
  g.add(k.at(ship, -14, found ? 3 : 0, -36));
  // Sand banked against her keel; dunes, palms.
  for (const [x, z, r] of [[-70, -8, 22], [40, -6, 26], [-20, -2, 20], [80, -40, 18]] as const) g.add(blob(sand, r, x, 0, z, 0.35, 10, 6));
  g.add(palm(k, paint, 112, 40, 1.2), palm(k, paint, 126, 6, 0.8), palm(k, paint, -120, 54, -1));
  if (found) {
    // The treasure: the chest thrown open by the path, heaped and spilling gold, jewels, a goblet, a crown.
    const tx = 42;
    const tz = 64;
    const gold = paint(TOY.yellow);
    const chest = new Group();
    chest.add(k.box(paint(TOY.brown), 28, 16, 18, 1.5, 0, 0, 0));
    for (const x of [-9, 9]) chest.add(stick(k, gold, 2.4, 16.4, 18.4, x, 0, 0));
    const lid = k.box(paint(TOY.brown), 28, 4, 18, 1.2, 0, 0, 0);
    lid.position.set(0, 22, -11);
    lid.rotation.x = -1.2;
    chest.add(lid);
    for (let i = 0; i < 8; i++) chest.add(blob(gold, 3.6, -9 + (i % 4) * 6, 17 + (i > 3 ? 2.5 : 0), -3 + Math.floor(i / 4) * 6, 0.7, 7, 5));
    chest.add(blob(paint(TOY.red), 2.6, -4, 21, 1, 1, 6, 4), blob(paint(TOY.blue), 2.4, 6, 20, -2, 1, 6, 4));
    g.add(k.at(chest, tx, 2, tz, -0.3));
    const R = rnd(29);
    for (let i = 0; i < 10; i++) g.add(k.cyl(gold, 3, 1, tx + 14 + R() * 26, 2, tz - 10 + R() * 28, 3, 8));
    g.add(k.cone(gold, 12, 9, tx + 22, 2, tz + 6, 12));
    for (const [c, x, z] of [[TOY.red, 30, 6], [TOY.green, 26, 14], [TOY.blue, 38, -4], [TOY.purple, 18, -10]] as const) g.add(blob(paint(c), 2.6, tx + x, 4, tz + z, 1, 6, 4));
    g.add(k.lathe(gold, [[3.5, 0], [1, 1.5], [1, 7], [4.5, 9], [5, 14]], tx - 22, 2, tz + 4, 12));
    g.add(k.ring(gold, 5, 1.2, tx + 36, 4, tz + 22));
    for (let i = 0; i < 5; i++) g.add(k.cone(gold, 1.4, 4, tx + 36 + Math.cos(i * 1.26) * 5, 4.5, tz + 22 + Math.sin(i * 1.26) * 5, 4));
    for (const [x, y, z] of [[0, 26, 2], [26, 12, 4], [-20, 18, 4], [36, 10, 22], [12, 24, -6]] as const) g.add(glint(k, tx + x, y, tz + z));
    // An anchor in the sand, barrels washed up, a crab, a digger and visitors, a flag on the beach.
    const ax = -80;
    const az = 60;
    g.add(stick(k, paint(TOY.black), 3.4, 36, 3.4, ax, 0, az), stick(k, paint(TOY.black), 20, 3, 3, ax, 30, az), k.at(k.ring(paint(TOY.black), 12, 2, 0, 0, 0, true, Math.PI), ax, 12, az, 0).rotateZ(Math.PI), k.ring(paint(TOY.black), 3.4, 1, ax, 39, az, true));
    for (const [x, z] of [[-44, 30], [-34, 38]] as const) g.add(k.cyl(paint(TOY.brown), 7, 16, x, 0, z, 6, 10), k.cyl(paint(TOY.black), 7.3, 1.6, x, 4, z, 7.3, 10), k.cyl(paint(TOY.black), 6.8, 1.6, x, 11, z, 6.8, 10));
    g.add(blob(paint(TOY.red), 4, 90, 3, 80, 0.6, 7, 4), blob(paint(TOY.red), 1.8, 85, 4, 77, 1, 5, 4), blob(paint(TOY.red), 1.8, 95, 4, 77, 1, 5, 4));
    g.add(k.peg(TOY.blue, TOY.red, tx - 10, 2, tz + 22), beam(k, paint(TOY.brown), [tx - 4, 2, tz + 20], [tx - 2, 20, tz + 24], 1.4), k.peg(TOY.yellow, null, tx + 54, 2, tz + 8), k.peg(TOY.green, TOY.white, -16, 2, 96));
    g.add(pennant(k, TOY.red, 34, 100, 2, 70));
  } else {
    // The chest buried to its lid, the fallen mast half in the sand, seaweed, sea mist rolling in.
    g.add(k.box(paint(TOY.brown), 28, 6, 18, 1.2, 42, -1, 64), stick(k, paint(TOY.yellow), 2.4, 6.4, 18.4, 33, -1, 64));
    const m = k.cyl(wood, 3.4, 110, 0, 0, 0, 2.6, 10);
    m.rotation.z = Math.PI / 2 - 0.08;
    m.rotation.y = 0.3;
    m.position.set(40, 4, 20);
    g.add(m);
    for (const [x, z, r] of [[-60, -20, 30], [10, -18, 34], [70, -26, 26]] as const) g.add(blob(sand, r, x, 4, z, 0.5, 10, 6));
    g.add(brambles(k, 7, 60, 0, 20, 19, 0, "#4f6f45"), mist(k, 10, 110, 0, -40, 23, 8));
  }
  g.add(halt(k, found, TOY.teal, emblems.ship, 20, 51));
  return g;
}

// ——— The standing stones: a full ring of sarsens capped with lintels, a horseshoe of trilithons, midsummer ———

function stones(k: Kit, found: boolean): Object3D {
  const g = new Group();
  const { paint } = sitePaint(k, found);
  const greys = [paint("#aaa69c"), paint("#9b978c"), paint("#b6b2a6")];
  const cz = -20;
  g.add(k.cyl(paint("#79a858"), 140, 1.5, 0, 0, -10, 140, 48));
  // The bank and ditch round it, open at the avenue.
  g.add(k.at(k.ring(paint("#6e9a50"), 112, 5, 0, 0, 0, false, Math.PI * 1.8), 0, 1, cz, -Math.PI / 2 + Math.PI * 0.1));
  // The outer ring: sarsens all round, a continuous ring of lintels on top (ruined: a third fallen, the lintels down).
  const N = 16;
  const R = 82;
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2;
    const h = 36 + ((i * 7) % 3) * 2;
    const fallen = !found && i % 3 === 1;
    const s = k.box(greys[i % 3], 13, h, 9, 2.5, 0, 0, 0);
    if (fallen) {
      s.rotation.y = -a;
      s.rotation.z = Math.PI / 2;
      s.position.set(Math.cos(a) * (R + 14), 5, cz + Math.sin(a) * (R + 14));
    } else {
      s.rotation.y = -a + Math.PI / 2;
      s.position.set(Math.cos(a) * R, h / 2, cz + Math.sin(a) * R);
      if (!found) s.rotation.z = (i % 2 ? 1 : -1) * 0.08;
    }
    g.add(s);
    const b = ((i + 0.5) / N) * Math.PI * 2;
    const l = stick(k, greys[(i + 1) % 3], 33, 7, 9, 0, 0, 0);
    if (found) {
      l.position.set(Math.cos(b) * R, 38, cz + Math.sin(b) * R);
      l.rotation.y = -b + Math.PI / 2;
      g.add(l);
    } else if (i % 4 === 2) {
      l.position.set(Math.cos(b) * (R + 18), 0, cz + Math.sin(b) * (R + 18));
      l.rotation.y = -b + 0.4;
      g.add(l);
    } else if (i % 4 === 0) {
      l.position.set(Math.cos(b) * R, 38, cz + Math.sin(b) * R);
      l.rotation.y = -b + Math.PI / 2;
      g.add(l);
    }
  }
  // The horseshoe of five great trilithons, open to the avenue (+z).
  for (let i = 0; i < 5; i++) {
    const ang = -Math.PI / 2 + (i - 2) * 0.62;
    const x = Math.cos(ang) * 46;
    const z = cz + Math.sin(ang) * 40;
    const h = i === 2 ? 64 : 52;
    const down = !found && (i === 1 || i === 4);
    const tri = new Group();
    for (const dx of [-8, 8]) tri.add(k.box(greys[(i + 1) % 3], 13, h, 11, 3, dx, 0, 0));
    tri.add(stick(k, greys[i % 3], 32, 8, 12, 0, h, 0));
    if (down) {
      tri.children[1].rotation.z = 1.4;
      tri.children[1].position.set(24, 6, 6);
      tri.children[2].position.set(10, 0, 18);
      tri.children[2].rotation.y = 0.6;
    }
    g.add(k.at(tri, x, 0, z, -ang - Math.PI / 2));
  }
  // The capstone: a great dolmen at the heart, its altar stone in front.
  for (const [x, z] of [[-12, -6], [12, -6], [0, 10]] as const) g.add(stick(k, greys[1], 9, 22, 9, x, 0, cz + z));
  const cap = k.box(greys[2], 40, 8, 30, 4, 0, 0, 0);
  if (found) cap.position.set(0, 22, cz);
  else {
    cap.position.set(10, 10, cz + 4);
    cap.rotation.z = -0.35;
  }
  g.add(cap, k.box(greys[0], 28, 8, 14, 2, 0, 0, cz + 30));
  // The avenue: stones in pairs down to the halt, and the heel stone.
  for (let i = 0; i < 3; i++) for (const sx of [-1, 1]) g.add(stick(k, greys[i % 3], 7, 14 - i * 2, 6, sx * 20, 0, 84 + i * 12));
  g.add(k.box(greys[1], 14, 30, 12, 3, 22, 0, 74).rotateZ(0.12));
  if (!found) {
    g.add(brambles(k, 12, 90, 0, cz, 17), mist(k, 8, 90, 0, cz, 27, 6));
  }
  g.add(halt(k, found, TOY.purple, emblems.stones, 0, 61));
  return g;
}


/** The stones' ring radius and middle (z), shared with their midsummer dressing. */
const STONES = { R: 82, cz: -20, N: 16 } as const;

/**
 * Midsummer at the standing stones (found): the sun in the gap, garlands on the stones, flowers round the horseshoe, a
 * bonfire, dancers and a picnic. Its own asset (`secret-stones-midsummer`), in the site's frame: the game draws it over
 * the found stones in June only.
 */
function midsummer(k: Kit): Object3D {
  const g = new Group();
  const paint = (c: string) => k.paint(c);
  const { R, cz, N } = STONES;
  const sun = k.cylZ(paint(TOY.yellow), 10, 2, 0, 66, cz - R, 20);
  g.add(sun);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const ray = stick(k, paint(TOY.orange), 2, 7, 2, 0, 0, 0);
    ray.position.set(Math.sin(a) * 15, 66 + Math.cos(a) * 15 - 3.5, cz - R);
    ray.rotation.z = -a;
    g.add(ray);
  }
  for (let i = 0; i < N; i += 2) {
    const a = (i / N) * Math.PI * 2;
    g.add(k.at(k.ring(paint(TOY.blue), 3.4, 0.8, 0, 0, 0, true, Math.PI * 1.6), Math.cos(a) * (R - 4.7), 20, cz + Math.sin(a) * (R - 4.7), -a + Math.PI / 2));
  }
  for (let i = 0; i < 20; i++) {
    const a = (i / 20) * Math.PI * 2;
    g.add(blob(paint(i % 2 ? TOY.pink : TOY.yellow), 2.4, Math.cos(a) * 30, 3, cz + Math.sin(a) * 26, 1, 5, 4));
  }
  g.add(k.cone(paint(TOY.orange), 7, 14, 0, 0, cz + 50, 7), k.cone(paint(TOY.yellow), 4, 10, 0, 2, cz + 50, 6));
  for (const a of [0.4, 1.4, 2.6, 3.8, 5]) g.add(stick(k, paint(TOY.brown), 12, 2, 2, Math.cos(a) * 5, 0, cz + 50 + Math.sin(a) * 5).rotateY(a));
  const colors = [TOY.white, TOY.cream, TOY.white, TOY.green, TOY.white, TOY.pink];
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + 0.3;
    g.add(k.peg(colors[i], i % 2 ? TOY.yellow : null, Math.cos(a) * 18, 0, cz + 50 + Math.sin(a) * 14));
  }
  g.add(k.box(paint(TOY.red), 26, 0.8, 20, 0.2, -70, 1.5, 76), k.peg(TOY.blue, TOY.red, -66, 1.5, 80));
  return g;
}

// ——— The giant's footprint: a pond as big as a field, the giant's stride, a look-out tower over it ———

function soleShape(): Shape {
  // A left foot from above (x along it, the heel at −x): a narrow heel, the arch drawn in on the inner (−y) side, a
  // broad ball under the toes.
  const s = new Shape();
  s.moveTo(-76, 0);
  s.bezierCurveTo(-76, 18, -60, 22, -40, 20);
  s.bezierCurveTo(-10, 18, 20, 30, 50, 28);
  s.bezierCurveTo(66, 26, 72, 12, 72, 0);
  s.bezierCurveTo(72, -14, 66, -28, 50, -28);
  s.bezierCurveTo(30, -28, 10, -12, -20, -13);
  s.bezierCurveTo(-50, -14, -76, -20, -76, 0);
  return s;
}

function footprint(k: Kit, found: boolean): Object3D {
  const g = new Group();
  const { paint } = sitePaint(k, found);
  g.add(k.cyl(paint("#79a858"), 142, 1.5, 0, 0, -10, 142, 48));
  const water = found ? k.water : paint("#76888c");
  const rim = paint("#8a6a44");
  // The print: a raised earthen rim, sunk water in it, five round toes; turned a little across the field.
  const print = (scale: number, x: number, z: number, ry: number) => {
    const p = new Group();
    // (Its outline as a polygon of a few points a curve: the extrusion's own 16 a curve cost twice the triangles.)
    const outline = soleShape().getPoints(6).map((v) => [v.x, v.y] as [number, number]);
    const s = k.extrude(rim, outline, 3.4, 0, 0, 0, 0.6);
    s.rotation.x = -Math.PI / 2;
    s.position.y = 0.4;
    s.scale.set(1.1, 1.14, 1);
    const w = k.extrude(water, outline, 1.6, 0, 0, 0, 0.3);
    w.rotation.x = -Math.PI / 2;
    w.position.y = 2.6;
    p.add(s, w);
    for (const [tx, ty, r] of [[86, -17, 11.5], [88, 3, 8], [84, 17, 7], [77, 28, 6], [67, 36, 5]] as const) p.add(k.cyl(rim, r + 3, 3.4, tx, 0.4, -ty, r + 3, 20), k.cyl(water, r, 1.6, tx, 2.6, -ty, r, 20));
    p.scale.setScalar(scale);
    return k.at(p, x, 0, z, ry);
  };
  g.add(print(1.15, -30, -30, 0.25));
  // The next stride: the toes of a second print at the field's far edge, half under the turf.
  const toe2 = new Group();
  for (const [tx, tz, r] of [[0, 0, 12], [-3, -19, 8.5], [-9, -31, 7.5]] as const) toe2.add(k.cyl(rim, r + 3, 3, tx, 0, tz, r + 3, 20), k.cyl(water, r, 1.4, tx, 2.4, tz, r, 20));
  g.add(k.at(toe2, 112, 0, -110, 0.25));
  // The giant's walking staff, dropped: a great knotted log with a crook, and a boulder he kicked, cracked in two.
  const staff = k.cylX(paint("#8a6238"), 7, 170, 0, 0, 0, 10);
  staff.position.set(10, 7, -116);
  staff.rotation.y = 0.12;
  g.add(staff, k.at(k.ring(paint("#8a6238"), 14, 7, 0, 0, 0, true, Math.PI * 1.2), 98, 15, -125, 0.12));
  for (const x of [-40, 0, 40]) g.add(blob(paint("#6f5030"), 5, x + 10, 10, -114 - x * 0.12, 0.7, 6, 4));
  g.add(k.box(paint("#9a968c"), 30, 34, 30, 9, -112, 0, -78).rotateY(0.3), k.box(paint("#aaa69a"), 26, 28, 26, 8, -96, 0, -96).rotateY(-0.2));
  if (found) {
    // A look-out tower beside it, people on top; the tale on a big painted board; ducks; picnics; flowers.
    const tw = new Group();
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) tw.add(beam(k, k.wood, [sx * 16, 0, sz * 16], [sx * 11, 70, sz * 11], 3.4));
    for (const y of [24, 48]) tw.add(stick(k, k.wood, 30, 2.4, 2.4, 0, y, 14 - y / 10), stick(k, k.wood, 30, 2.4, 2.4, 0, y, -14 + y / 10));
    tw.add(stick(k, k.wood, 30, 3, 30, 0, 70, 0));
    for (const [dx, dz, w, d] of [[0, 14, 30, 2], [0, -14, 30, 2], [14, 0, 2, 30], [-14, 0, 2, 30]] as const) tw.add(stick(k, paint(TOY.red), w, 8, d, dx, 73, dz));
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) tw.add(stick(k, k.wood, 2.4, 24, 2.4, sx * 13, 73, sz * 13));
    tw.add(k.cone(paint(TOY.green), 24, 16, 0, 97, 0, 4).rotateY(Math.PI / 4));
    tw.add(beam(k, k.wood, [20, 0, 18], [12, 70, 12], 1.6), beam(k, k.wood, [26, 0, 12], [18, 70, 6], 1.6));
    for (let i = 0; i < 7; i++) tw.add(beam(k, k.wood, [21 - i * 1.1 + 0, 8 + i * 9, 17 - i * 0.6], [27 - i * 1.1, 8 + i * 9, 11 - i * 0.6], 1.2));
    tw.add(k.peg(TOY.red, TOY.yellow, -5, 73, 3), k.peg(TOY.blue, null, 5, 73, -4));
    g.add(k.at(tw, 96, 0, 30));
    const board = new Group();
    for (const dx of [-30, 30]) board.add(stick(k, k.wood, 4, 64, 4, dx, 0, 0));
    board.add(stick(k, paint(TOY.sky), 70, 46, 3, 0, 16, 0), stick(k, paint(TOY.leaf), 70, 10, 3.4, 0, 16, 0));
    const giant = new Shape();
    giant.moveTo(-10, 0);
    for (const [x, y] of [[-4, 0], [-2, 18], [2, 18], [4, 0], [10, 0], [8, 26], [15, 40], [11, 42], [7, 34], [7, 42], [-7, 42], [-7, 34], [-11, 42], [-15, 40], [-8, 26]] as const) giant.lineTo(x, y);
    const fig = k.extrude(paint("#5a7a3a"), giant, 1.6, 0, 0, 0, 0.3);
    fig.scale.setScalar(0.85);
    board.add(k.at(fig, -14, 20, 2), blob(paint("#d9b98c"), 5.4, -14, 59, 2.4, 1, 7, 5));
    board.add(k.at(emblems.footprint(k), 16, 40, 2), stick(k, paint(TOY.cream), 26, 4, 1, 16, 26, 2), stick(k, paint(TOY.cream), 20, 4, 1, 16, 32, 2));
    board.add(gable(k, paint(TOY.red), 76, 8, 5, 0, 62, 0, 1.6));
    g.add(k.at(board, -84, 0, 60, 0.35));
    const R = rnd(37);
    for (let i = 0; i < 5; i++) {
      const x = -60 + i * 18 + R() * 8;
      const z = -30 + (R() - 0.5) * 20;
      g.add(blob(paint(TOY.white), 3.4, x, 5, z, 0.7, 7, 5), blob(paint(TOY.green), 2.2, x + 3, 8.4, z, 1, 6, 4));
      const bill = k.cone(paint(TOY.orange), 0.9, 2.6, 0, 0, 0, 5);
      bill.rotation.z = -Math.PI / 2;
      bill.position.set(x + 6, 8.2, z);
      g.add(bill);
    }
    g.add(k.box(paint(TOY.red), 26, 0.8, 20, 0.2, 40, 1.5, 70), k.box(paint(TOY.blue), 26, 0.8, 20, 0.2, -30, 1.5, 84));
    g.add(k.peg(TOY.red, null, 36, 2, 74), k.peg(TOY.yellow, TOY.blue, 46, 2, 66), k.peg(TOY.blue, null, -26, 2, 88), k.peg(TOY.pink, TOY.white, -36, 2, 80));
    for (let i = 0; i < 10; i++) g.add(blob(paint(i % 2 ? TOY.pink : TOY.yellow), 2.2, -8 + (i % 5) * 4, 2, 100 + Math.floor(i / 5) * 5, 1, 5, 4));
    g.add(tree(k, paint, 130, -50, 44), tree(k, paint, -130, 10, 40), tree(k, paint, 60, -120, 36));
  } else {
    // Grown over and fogged: only the toes show clear through the mist.
    g.add(brambles(k, 14, 90, -30, -30, 23), mist(k, 9, 90, -30, -30, 31, 6));
    g.add(tree(k, paint, 130, -50, 44), tree(k, paint, -130, 10, 40), tree(k, paint, 60, -120, 36), tree(k, paint, -60, 70, 38), tree(k, paint, 70, 60, 42));
  }
  g.add(halt(k, found, TOY.green, emblems.footprint, -10, 71));
  return g;
}

// ——— The assets: hidden and found ———

interface Secret {
  id: string;
  name: string;
  tags: string[];
  notes: string;
  build: (k: Kit, found: boolean) => Object3D;
}

export const SECRETS: readonly Secret[] = [
  {
    id: "secret-lost-mine",
    name: "Lost mine",
    tags: ["secret", "mine", "headframe", "cart", "gold", "rock", "halt"],
    notes: "A rock face seamed with gold, an adit in it, the headframe and winding house over the shaft, carts on the rails. Found, the wheel turns again, a cart's full of glinting gold (coins), the mine can be reopened for half price, and its halt takes tourists.",
    build: lostMine,
  },
  {
    id: "secret-castle",
    name: "Ruined castle",
    tags: ["secret", "castle", "keep", "towers", "banners", "mound", "halt"],
    notes: "Curtain walls, four round towers, a gatehouse and a tall keep on a grassy mound. Found, it's restored: red roofs, banners and the great flag, the drawbridge down to its own halt, where day-trippers get off.",
    build: castle,
  },
  {
    id: "secret-lake",
    name: "Hidden lake",
    tags: ["secret", "lake", "waterfall", "temple", "island", "boathouse", "swans", "halt"],
    notes: "A lake ringed by woods under a waterfall, a round temple on its island, a boathouse and jetty. Found, the mist lifts: boats, swans and a fisher, a boating day out (riders) from its halt.",
    build: lake,
  },
  {
    id: "secret-shipwreck",
    name: "Shipwreck",
    tags: ["secret", "ship", "galleon", "wreck", "treasure", "beach", "coast", "halt"],
    notes: "A galleon heeled over on the beach, her hull stove in, palms by the surf. Found, her mast and sails stand, the chest spills gold and jewels (coins), and tourists ride out to her halt.",
    build: shipwreck,
  },
  {
    id: "secret-stones",
    name: "Standing stones",
    tags: ["secret", "stones", "circle", "trilithon", "capstone", "midsummer", "halt"],
    notes: "A full ring of stones capped with lintels round a horseshoe of trilithons and a dolmen's capstone, an avenue to it. Found, they stand again and midsummer brings visitors from every town to its halt.",
    build: stones,
  },
  {
    id: "secret-footprint",
    name: "Giant's footprint",
    tags: ["secret", "giant", "footprint", "pond", "ducks", "legend", "halt"],
    notes: "A footprint-shaped pond as big as a field, the next stride's toes beyond it, the giant's dropped staff. Found, ducks move in, a look-out tower goes up, a painted board tells the tale, and families come by train to picnic.",
    build: footprint,
  },
];

export const ASSETS: Asset[] = [
  ...SECRETS.flatMap((s) => [
  {
    id: `${s.id}-hidden`,
    name: `${s.name} (not found yet)`,
    trayLabel: `${s.name}?`,
    category: CAT,
    tags: [...s.tags, "hidden"],
    notes: `${s.name} before it's found: grown over, fogged and grey, an old platform rotting in the brambles. Lay track to it to find it.`,
    build: (k: Kit) => s.build(k, false),
  },
  { id: s.id, name: s.name, category: CAT, tags: [...s.tags, "found"], notes: s.notes, build: (k: Kit) => s.build(k, true) },
  ]),
  {
    id: "secret-stones-midsummer",
    name: "Midsummer at the stones",
    category: CAT,
    tags: ["secret", "stones", "midsummer", "garlands", "bonfire"],
    notes: "Drawn over the found standing stones in June: the sun in the gap, garlands, flowers, a bonfire, dancers and a picnic.",
    build: midsummer,
  },
];


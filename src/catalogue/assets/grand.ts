import { Group, type Object3D } from "three";
import { TOY, type Kit } from "../kit";
import { goodsStacks, hoarding, named, pennant, plinth, ribs, scaffold, stick, towerCrane, vault } from "../build-parts";
import type { Asset } from "../types";

/** Glass as the toys paint it: a pale sky-blue lacquer (the game's glass material draws dark in the props' batches). */
const GLASS = "#bcdcea";

/**
 * Grand projects (design spec 2026-11-05, part 2): map-wide builds that go up as goods arrive. Each is one builder
 * over its build stage (1 scaffold and foundations, 2 half built, 3 finished), registered as an asset per stage
 * (`grand-<name>-<stage>`), so the game can swap a placed prop's asset as a stage completes. Not in Game mode: on
 * Sandbox's Buildings tab only. About 3 to 4 hill blocks across (a block is 72 mm).
 */

export type Stage = 1 | 2 | 3;
export const STAGES: readonly Stage[] = [1, 2, 3];

const CAT = "Stations & buildings" as const;

// ——— The Grand Exhibition hall: glass and iron, in the town buildings' toy style ———

/** The town buildings' colours (tools/blender/bldg_parts.py): printed-look windows, stone, frames. */
const WIN = "#2b3644";
const STONE = "#b9b2a5";
const FRAME = "#fbf6ec";
/** Victorian ironwork, in the toy's green. */
const IRON = "#2d6b3f";

/** A printed-look window on a wall facing ±z (its face at z): a dark pane in a white surround, just proud of the wall. */
function winZ(k: Kit, x: number, y: number, z: number, w = 9, h = 13): Group {
  const g = new Group();
  g.add(k.box(k.paint(FRAME), w + 2, h + 2, 1, 0, 0, -1, 0), k.box(k.paint(WIN), w, h, 1.3, 0, 0, 0, 0));
  return k.at(g, x, y, z);
}

/** The same on a wall facing ±x. */
function winX(k: Kit, x: number, y: number, z: number, w = 9, h = 13): Group {
  return k.at(winZ(k, 0, 0, 0, w, h), x, y, z, Math.PI / 2);
}

/** A half-round glass end to a vault along x: a pane with an iron rim and three glazing bars, facing ±x at x. */
function vaultEnd(k: Kit, r: number, x: number, y: number, z = 0): Group {
  const g = new Group();
  const pts: [number, number][] = [];
  for (let i = 0; i <= 12; i++) pts.push([Math.cos((i / 12) * Math.PI) * r, Math.sin((i / 12) * Math.PI) * r]);
  const pane = k.extrude(k.paint(GLASS), pts, 2, 0, 0, 0, 0.3);
  g.add(pane);
  g.add(k.ring(k.paint(IRON), r, 2, 0, 0, 0, true, Math.PI));
  for (const a of [Math.PI / 4, Math.PI / 2, (3 * Math.PI) / 4]) {
    const bar = k.box(k.paint(IRON), 2, r, 2.6, 0, 0, 0, 0);
    bar.geometry.translate(0, r / 2, 0);
    bar.position.set(0, 0, 0);
    bar.rotation.z = a - Math.PI / 2;
    g.add(bar);
  }
  g.add(k.box(k.paint(IRON), 2 * r, 2.4, 2.6, 0.6, 0, 0, 0));
  return k.at(g, x, y, z, Math.PI / 2);
}

/** A glass vault along x on its iron ribs: `len` long, radius `r`, springing at y; glazed over `glazed` of its length from −x. */
function glassVault(k: Kit, r: number, len: number, x: number, y: number, z: number, glazed = len): Group {
  const g = new Group();
  const n = Math.max(2, Math.round(len / 26));
  g.add(ribs(k, k.paint(IRON), r + 0.5, len, n + 1, x, y, z, 2.2));
  if (glazed > 0) g.add(vault(k, k.paint(GLASS), r, glazed, x - len / 2 + glazed / 2, y, z, 16));
  // The ridge and two purlins along it (a little of the toy's chunk), over the glazed part.
  if (glazed > 0) {
    g.add(k.box(k.paint(IRON), glazed, 3, 4, 1, x - len / 2 + glazed / 2, y + r - 1, z));
    for (const s of [-1, 1]) {
      const p = k.box(k.paint(IRON), glazed, 2, 2.5, 0, 0, 0, 0);
      p.position.set(x - len / 2 + glazed / 2, y + r * Math.sin(Math.PI / 4) - 1, z + s * r * Math.cos(Math.PI / 4));
      p.rotation.x = -s * (Math.PI / 4);
      g.add(p);
    }
  }
  return g;
}

/** The front porch (+x): a cream block with a pediment, a red door, a clock lantern like the market hall's. */
function porch(k: Kit, x: number, y: number): Group {
  const g = new Group();
  const cream = k.paint(TOY.cream);
  g.add(k.box(cream, 26, 30, 40, 3, 0, 0, 0));
  g.add(k.extrude(cream, [[-22, 0], [22, 0], [0, 12]], 28, 0, 0, 0, 0.6).rotateY(Math.PI / 2).translateY(30));
  g.add(k.box(k.paint(TOY.red), 1.4, 18, 12, 0.8, 13.4, 0, 0), k.box(k.paint(TOY.yellow), 1.6, 1.6, 4, 0.4, 14, 9, 3));
  for (const z of [-13, 13]) g.add(winX(k, 13.4, 12, z, 7, 11));
  // The clock lantern.
  g.add(k.box(k.paint(TOY.white), 12, 10, 12, 1.4, 0, 40, 0));
  g.add(k.cylX(k.paint(TOY.white), 3.8, 1.2, 6.4, 45, 0, 16), k.box(k.paint(TOY.black), 0.6, 3, 0.6, 0, 7.1, 45, 0), k.box(k.paint(TOY.black), 0.6, 0.6, 2.4, 0, 7.1, 45, 1));
  g.add(k.cone(k.paint(TOY.teal), 10.6, 9, 0, 50, 0, 4).rotateY(Math.PI / 4), k.ball(k.paint(TOY.yellow), 1.6, 0, 60, 0));
  return k.at(g, x, y, 0);
}

/** A turned lamp post, its foot at (x, y, z). */
function lampPost(k: Kit, x: number, y: number, z: number): Group {
  const g = new Group();
  g.add(k.cyl(k.paint(TOY.black), 2.4, 3, 0, 0, 0, 2, 10), k.cyl(k.paint(TOY.black), 1, 26, 0, 3, 0, 1, 8));
  g.add(k.ball(k.paint(TOY.yellow), 2.8, 0, 31, 0), k.cone(k.paint(TOY.black), 3, 3, 0, 33, 0, 8));
  return k.at(g, x, y, z);
}

/** A site hut: a little cream block with a red roof, a window and a door. */
function siteHut(k: Kit, x: number, z: number): Group {
  const g = new Group();
  g.add(k.box(k.paint(TOY.cream), 26, 16, 18, 2.5, 0, 0, 0));
  g.add(k.roof(k.paint(TOY.red), 30, 22, 7, 0, 15.5, 0, 2.5));
  g.add(winZ(k, -5, 6, 9.2, 7, 7), k.box(k.paint(TOY.blue), 7, 12, 1.2, 0.5, 7, 0, 9.2));
  return k.at(g, x, 0, z);
}

/** A board fence round a site, on posts, painted in two colours, a gate gap at +x. */
function siteFence(k: Kit, w: number, d: number, x = 0, z = 0): Group {
  const g = new Group();
  const a = k.paint(TOY.blue);
  const b = k.paint(TOY.white);
  const post = k.wood;
  const run = (x0: number, z0: number, x1: number, z1: number) => {
    const len = Math.hypot(x1 - x0, z1 - z0);
    const n = Math.max(1, Math.round(len / 18));
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n;
      const board = k.box(i % 2 ? b : a, len / n - 1, 14, 2.4, 0, 0, 0, 0);
      board.position.set(x0 + (x1 - x0) * t, 9, z0 + (z1 - z0) * t);
      board.rotation.y = -Math.atan2(z1 - z0, x1 - x0);
      g.add(board);
    }
    for (let i = 0; i <= n; i++) g.add(k.box(post, 3, 18, 3, 0, x0 + ((x1 - x0) * i) / n, 2, z0 + ((z1 - z0) * i) / n));
  };
  const x0 = x - w / 2, x1 = x + w / 2, z0 = z - d / 2, z1 = z + d / 2;
  run(x0, z0, x1, z0);
  run(x0, z1, x1, z1);
  run(x0, z0, x0, z1);
  run(x1, z0, x1, z - 16);
  run(x1, z + 16, x1, z1);
  return g;
}

function exhibition(k: Kit, stage: Stage): Object3D {
  const g = new Group();
  const L = 220;
  const W = 80;
  const WALL = 22;
  const cream = k.paint(TOY.cream);
  const iron = k.paint(IRON);
  // The ground: a stone step and a beech floor, as the town's buildings stand on.
  g.add(k.box(k.paint(STONE), L + 60, 2, W + 70, 0.8, 0, 0, 0));
  g.add(k.box(k.wood, L + 50, 2, W + 60, 1, 0, 2, 0));
  const y0 = 4;
  if (stage === 1) {
    // A fenced site: the hall's iron columns started, a hut, the goods brought so far, a crane.
    g.add(siteFence(k, L + 44, W + 54, 0, 0));
    for (let i = 0; i <= 6; i++) for (const s of [-1, 1]) g.add(k.box(iron, 4, i < 4 ? WALL + 8 : 8, 4, 0, -L / 2 + (L * i) / 6, y0, (s * W) / 2));
    g.add(k.box(k.paint(STONE), L, 4, W, 1, 0, y0, 0));
    g.add(siteHut(k, L / 2 - 4, W / 2 - 6));
    g.add(goodsStacks(k, 30, -6));
    g.add(goodsStacks(k, -60, 8));
    g.add(towerCrane(k, 120, 110, -L / 2 + 14, -W / 2 + 8, 0));
    g.add(k.peg(TOY.orange, TOY.yellow, 6, y0 + 4, 20), k.peg(TOY.orange, TOY.yellow, -20, y0 + 4, -14));
    return g;
  }
  // The walls: a cream block all round, with printed-look windows; iron columns between them.
  for (const s of [-1, 1]) {
    g.add(k.box(cream, L, WALL, 8, 3, 0, y0, s * (W / 2 - 4)));
    for (let i = 0; i < 9; i++) g.add(winZ(k, -L / 2 + 14 + i * ((L - 28) / 8), y0 + 6, s * W / 2 + s * 0.4));
    for (let i = 0; i <= 8; i++) g.add(k.box(iron, 4, WALL + 2, 4, 0, -L / 2 + (L * i) / 8, y0, s * (W / 2 + 1)));
  }
  g.add(k.box(cream, 8, WALL, W, 3, -L / 2 + 4, y0, 0));
  g.add(k.box(cream, 8, WALL, W, 3, L / 2 - 4, y0, 0));
  const top = y0 + WALL;
  // A cornice the vault springs from.
  for (const s of [-1, 1]) g.add(k.box(k.paint(TOY.white), L + 4, 3, 10, 1, 0, top, s * (W / 2 - 3)));
  g.add(glassVault(k, W / 2, L, 0, top + 3, 0, stage === 3 ? L : L * 0.45));
  if (stage === 3) {
    g.add(vaultEnd(k, W / 2, -L / 2, top + 3), vaultEnd(k, W / 2, L / 2, top + 3));
    // The transept: a taller crossing across the middle, glazed, with its own glass ends.
    const T = 64;
    const TW = W + 50;
    for (const s of [-1, 1]) {
      g.add(k.box(cream, T, WALL + 6, 8, 3, 0, y0, s * (TW / 2 - 4)));
      for (const dx of [-16, 16]) g.add(winZ(k, dx, y0 + 6, s * TW / 2 + s * 0.4, 9, 16));
      for (const sx of [-1, 1]) g.add(k.box(cream, 8, WALL + 6, (TW - W) / 2, 3, sx * (T / 2 - 4), y0, s * (W / 2 + (TW - W) / 4)));
    }
    const tv = new Group();
    tv.add(glassVault(k, T / 2, TW, 0, 0, 0));
    tv.add(vaultEnd(k, T / 2, -TW / 2, 0), vaultEnd(k, T / 2, TW / 2, 0));
    tv.rotation.y = Math.PI / 2;
    tv.position.set(0, top + 9, 0);
    g.add(tv);
    g.add(k.box(k.paint(TOY.white), T + 4, 3, TW + 4, 1, 0, top + 6, 0));
    // A lantern over the crossing, flags along the ridge.
    g.add(k.cyl(k.paint(FRAME), 9, 10, 0, top + 9 + T / 2, 0, 9, 10), k.cone(k.paint(TOY.teal), 11, 12, 0, top + 19 + T / 2, 0, 10));
    g.add(pennant(k, TOY.red, 22, 0, top + 31 + T / 2, 0));
    for (const fx of [-L / 2 + 22, -60, 60, L / 2 - 22]) g.add(pennant(k, fx < 0 ? TOY.blue : TOY.yellow, 18, fx, top + 3 + W / 2, 0));
    // The porch, a path to it, lamps and the first visitors.
    g.add(porch(k, L / 2 + 13, y0));
    g.add(k.box(k.paint("#d9cdb6"), 22, 1, 20, 0.4, L / 2 + 37, y0, 0));
    for (const s of [-1, 1]) g.add(lampPost(k, L / 2 + 36, y0, s * 18));
    g.add(k.peg(TOY.red, TOY.black, L / 2 + 40, y0, 6), k.peg(TOY.blue, null, L / 2 + 44, y0, -6), k.peg(TOY.purple, TOY.yellow, L / 2 + 34, y0, -2));
  } else {
    // Half built: the far half's glass not on yet, scaffolding over it, a crane and goods.
    g.add(scaffold(k, L * 0.55, W + 14, W / 2 + WALL + 10, L * 0.22, 0));
    g.add(towerCrane(k, 130, 120, L / 2 + 20, -W / 2 - 18, Math.PI));
    g.add(goodsStacks(k, L / 2 + 10, W / 2 + 18));
    g.add(siteHut(k, -L / 2 + 10, W / 2 + 22));
  }
  return g;
}

// ——— The cathedral ———

function cathedral(k: Kit, stage: Stage): Object3D {
  const g = new Group();
  const stone = k.paint("#d8cdb8");
  const dark = k.paint("#a99d88");
  const roof = k.paint("#4f6a8a");
  const L = 220;
  const W = 64;
  const H = stage === 1 ? 10 : stage === 2 ? 44 : 70;
  g.add(plinth(k, L + 30, W + 90, 5, -10, 0, "#bdb4a3"));
  const base = 5;
  // Nave and aisles.
  g.add(k.box(stone, L, H, W, 1.5, 0, base, 0));
  for (const s of [-1, 1]) g.add(k.box(dark, L - 20, H * 0.6, 18, 1, -10, base, s * (W / 2 + 9)));
  // Transept.
  g.add(k.box(stone, 60, H, W + 80, 1.5, -40, base, 0));
  // West towers, at the front (+x).
  const TH = stage === 1 ? 14 : stage === 2 ? 70 : 128;
  for (const s of [-1, 1]) {
    g.add(k.box(stone, 38, TH, 38, 1.5, L / 2 + 6, base, s * 30));
    if (stage === 3) {
      for (const [px, pz] of [[-14, -14], [14, -14], [-14, 14], [14, 14]]) g.add(k.cone(dark, 4, 16, L / 2 + 6 + px, base + TH, s * 30 + pz, 4));
      g.add(k.cone(roof, 16, 30, L / 2 + 6, base + TH, s * 30, 4));
      for (const y of [40, 80]) g.add(k.box(k.cut, 2, 18, 8, 0, L / 2 + 25, base + y, s * 30));
    }
  }
  if (stage === 3) {
    // Roofs, the spire over the crossing, the rose window and the doors.
    g.add(k.roof(roof, L, W + 6, 34, 0, base + H, 0, 3));
    const tr = k.roof(roof, W + 80, 66, 34, 0, 0, 0, 3);
    tr.rotation.y = Math.PI / 2;
    g.add(k.at(tr, -40, base + H, 0));
    g.add(k.box(stone, 30, 30, 30, 1, -40, base + H + 20, 0));
    g.add(k.cone(roof, 18, 90, -40, base + H + 50, 0, 8));
    g.add(k.cyl(k.paint(TOY.yellow), 1, 14, -40, base + H + 138, 0, 1, 6), k.box(k.paint(TOY.yellow), 1.6, 1.6, 9, 0, -40, base + H + 147, 0));
    const rose = k.cylX(k.paint(TOY.blue), 15, 2, L / 2 + 1, base + 50, 0, 16);
    g.add(rose, k.cylX(k.paint(TOY.red), 8, 2.6, L / 2 + 1.5, base + 50, 0, 12), k.cylX(k.paint(TOY.yellow), 3, 3, L / 2 + 2, base + 50, 0, 8));
    g.add(k.extrude(k.paint(TOY.brown), [[-11, 0], [11, 0], [11, 18], [0, 28], [-11, 18]], 3, 0, 0, 0, 0.4).rotateY(Math.PI / 2).translateZ(L / 2 + 1).translateY(base));
    // Lancet windows down the sides.
    for (let i = 0; i < 6; i++) for (const s of [-1, 1]) g.add(k.box(k.paint("#3d5d86"), 7, 22, 1, 0, -L / 2 + 20 + i * 26, base + 32, s * (W / 2 + 0.6)));
    g.add(k.peg(TOY.purple, TOY.black, L / 2 + 30, 0, 0), k.peg(TOY.cream, null, L / 2 + 36, 0, 10));
  } else {
    g.add(scaffold(k, 80, W + 10, H + 26, 40, 0));
    for (const s of [-1, 1]) g.add(scaffold(k, 44, 44, TH + 20, L / 2 + 6, s * 30));
    g.add(goodsStacks(k, -L / 2 - 4, W / 2 + 30));
    g.add(towerCrane(k, stage === 1 ? 110 : 150, 120, -60, -W / 2 - 44, 0));
    if (stage === 1) g.add(hoarding(k, L + 40, W + 100, TOY.red, -10, 0));
  }
  return g;
}

// ——— The Royal Train: an engine and two saloons, gold and crimson, on its display track ———

function royalTrain(k: Kit, stage: Stage): Object3D {
  const g = new Group();
  const pane = k.paint(GLASS);
  const CAR = 92;
  g.add(k.trackSlab(3 * CAR + 40, 0, 0, 0));
  const crimson = stage === 3 ? k.paint("#9c1f2e") : k.wood;
  const gold = stage === 3 ? k.paint("#d9a72c") : k.wood;
  const cream = stage === 3 ? k.paint(TOY.cream) : k.wood;
  const frame = k.paint(TOY.black);
  const y0 = 12;
  const wheelColor = stage === 3 ? "#d9a72c" : TOY.red;
  const cars: number[] = [CAR, 0, -CAR];
  // Frames and wheels go on first.
  for (const cx of cars) {
    g.add(k.box(frame, CAR - 8, 4, 26, 0.6, cx, y0 + 2, 0));
    for (const x of [-(CAR / 2 - 18), CAR / 2 - 18]) for (const z of [-13, 13]) g.add(k.wheel(6, cx + x, y0 + 7.5, z, wheelColor));
  }
  if (stage === 1) {
    g.add(goodsStacks(k, 0, 44));
    for (const cx of cars) for (const s of [-1, 1]) g.add(k.box(k.paint("#c9a26b"), 6, 10, 30, 0.6, cx + s * 30, 0, 0));
    return g;
  }
  // The engine: boiler, smokebox, dome and chimney, cab, buffer beam.
  const ex = CAR;
  g.add(k.cylX(crimson, 12, 56, ex + 8, y0 + 22, 0, 20));
  g.add(k.cylX(frame, 12.5, 10, ex + 38, y0 + 22, 0, 20));
  for (const bx of [ex - 6, ex + 10, ex + 26]) g.add(k.cylX(gold, 12.6, 2, bx, y0 + 22, 0, 20));
  g.add(k.cyl(frame, 4.5, 14, ex + 36, y0 + 32, 0, 5.5, 12), k.ball(gold, 6, ex + 16, y0 + 34, 0, 0.8));
  g.add(k.box(crimson, 26, 34, 30, 2, ex - 30, y0 + 4, 0));
  g.add(k.box(gold, 30, 3, 34, 1, ex - 30, y0 + 38, 0));
  for (const s of [-1, 1]) g.add(k.box(k.cut, 10, 10, 1, 0, ex - 30, y0 + 24, s * 15.2));
  g.add(k.box(k.paint(TOY.red), 4, 8, 30, 0.6, ex + 44, y0 + 2, 0));
  // The saloons: crimson below, cream window band, a clerestory roof, gold lining.
  for (const cx of [0, -CAR]) {
    g.add(k.box(crimson, CAR - 6, 18, 30, 2, cx, y0 + 4, 0));
    g.add(k.box(cream, CAR - 6, 12, 30.4, 1, cx, y0 + 22, 0));
    if (stage === 3) for (let i = 0; i < 5; i++) for (const s of [-1, 1]) g.add(k.box(pane, 10, 8, 1, 0, cx - 32 + i * 16, y0 + 24, s * 15.4));
    g.add(k.box(gold, CAR - 4, 2, 32, 0.6, cx, y0 + 21, 0));
    g.add(k.box(crimson, CAR - 4, 3, 33, 1.5, cx, y0 + 34, 0), k.box(gold, CAR - 30, 5, 16, 1.5, cx, y0 + 37, 0));
  }
  if (stage === 2) {
    g.add(scaffold(k, 70, 40, 54, -CAR, 0));
    g.add(goodsStacks(k, CAR, 46));
    return g;
  }
  // A crown on the royal saloon, and flags at the front.
  const crown = new Group();
  crown.add(k.cyl(gold, 7, 5, 0, 0, 0, 8, 10));
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    crown.add(k.ball(gold, 1.6, Math.cos(a) * 7.5, 6.5, Math.sin(a) * 7.5));
  }
  crown.add(k.ball(k.paint(TOY.red), 3, 0, 5, 0));
  g.add(k.at(crown, -CAR, y0 + 42, 0));
  for (const s of [-1, 1]) g.add(pennant(k, s < 0 ? TOY.red : TOY.blue, 14, ex + 44, y0 + 10, s * 12));
  return g;
}

// ——— Grand Central: a station front with a clock tower, an arched train shed behind ———

function grandCentral(k: Kit, stage: Stage): Object3D {
  const g = new Group();
  const pane = k.paint(GLASS);
  const brick = k.paint("#b5553c");
  const stone = k.paint(TOY.cream);
  const iron = k.paint("#3e5f78");
  const SHED = 200;
  const SW = 120;
  g.add(plinth(k, SHED + 80, SW + 70, 4, -30, 0, "#cdbfa8"));
  // Three tracks run through the shed along x (slabs: the real pieces would sit here).
  for (const z of [-40, 0, 40]) g.add(k.trackSlab(SHED, -SHED / 2 + 10, 4, z));
  for (const z of [-20, 20]) g.add(k.box(stone, SHED - 20, 8, 16, 1, -SHED / 2 + 20, 4, z));
  // The front building across the tracks' ends (facing +x), the clock tower in the middle.
  const FH = stage === 1 ? 12 : stage === 2 ? 36 : 54;
  const fx = 40;
  g.add(k.box(brick, 34, FH, SW + 50, 1.5, fx, 4, 0));
  const TH = stage === 1 ? 20 : stage === 2 ? 70 : 128;
  g.add(k.box(brick, 36, TH, 36, 1.5, fx + 6, 4, 0));
  if (stage === 3) {
    g.add(k.box(stone, 36, 4, SW + 52, 1, fx, 4 + FH, 0));
    for (let i = 0; i < 7; i++) {
      const z = -SW / 2 - 10 + i * ((SW + 20) / 6);
      if (Math.abs(z) < 22) continue;
      g.add(k.extrude(k.paint("#3d5d86"), [[-6, 0], [6, 0], [6, 16], [0, 22], [-6, 16]], 2, 0, 0, 0, 0.3).rotateY(Math.PI / 2).translateZ(fx + 17).translateY(18).translateX(-z));
    }
    // The tower: clock faces, a stone band, a pyramid roof and a gilt finial.
    g.add(k.box(stone, 38, 4, 38, 1, fx + 6, 4 + TH - 30, 0));
    const clock = new Group();
    clock.add(k.cylX(stone, 12, 2, 0, 0, 0, 20), k.cylX(k.paint(TOY.black), 1.2, 3, 0.4, 0, 0, 8));
    clock.add(named(k.box(k.paint(TOY.black), 1, 10, 1.6, 0, 1.6, 0, 0), "minute"));
    clock.add(named(k.box(k.paint(TOY.black), 1, 1.6, 7, 0, 1.6, 0, 3), "hour"));
    g.add(k.at(clock, fx + 25, 4 + TH - 14, 0));
    g.add(k.cone(k.paint("#4f6a8a"), 26, 34, fx + 6, 4 + TH, 0, 4).rotateY(Math.PI / 4));
    g.add(k.cyl(k.paint(TOY.yellow), 1, 10, fx + 6, 4 + TH + 32, 0, 1, 6), k.ball(k.paint(TOY.yellow), 2.4, fx + 6, 4 + TH + 44, 0));
    // The great arch over the entrance, and the sign.
    g.add(k.at(k.ring(stone, 14, 2.6, 0, 0, 0, true, Math.PI), fx + 25, 4 + 22, 0, Math.PI / 2));
    g.add(k.box(k.paint(TOY.green), 4, 10, 60, 1, fx + 18, 4 + FH - 16, -SW / 2 + 22));
    g.add(k.peg(TOY.red, TOY.black, fx + 40, 0, 6), k.peg(TOY.blue, null, fx + 46, 0, -8));
  } else {
    g.add(scaffold(k, 44, 44, TH + 24, fx + 6, 0));
    g.add(towerCrane(k, 150, 120, -60, SW / 2 + 30, Math.PI));
    g.add(goodsStacks(k, fx + 50, 50));
  }
  // The train shed: iron ribs, glass over what's done.
  if (stage >= 2) {
    const top = 4 + 34;
    for (const s of [-1, 1]) for (let i = 0; i <= 6; i++) g.add(stick(k, iron, 3, 34, 3, -SHED + 20 + (i * (SHED - 20)) / 6, 4, (s * SW) / 2));
    g.add(ribs(k, iron, SW / 2, SHED - 20, 7, -SHED / 2 + 10, top, 0, 1.8));
    const done = stage === 3 ? SHED - 20 : (SHED - 20) * 0.4;
    g.add(vault(k, pane, SW / 2 - 1, done, -SHED / 2 + 10 + (SHED - 20) / 2 - done / 2, top, 0, 14));
  }
  return g;
}

// ——— The World's Fair wheel ———

const SPOKES = 12;

function ferrisWheel(k: Kit, stage: Stage): Object3D {
  const g = new Group();
  const R = 110;
  const HUB = R + 22;
  const steel = k.paint(TOY.white);
  const red = k.paint(TOY.red);
  g.add(plinth(k, 150, 110, 5, 0, 0, "#d9cdb6"));
  // The legs: an A-frame each side of the wheel (the wheel turns in x/y).
  for (const s of [-1, 1]) {
    for (const lean of [-1, 1]) {
      const leg = stick(k, red, 5, HUB + 6, 5, 0, 0, 0);
      leg.position.set(lean * 34, (HUB + 6) / 2 + 2, s * 20);
      leg.rotation.z = lean * 0.27;
      g.add(leg);
    }
  }
  if (stage === 1) {
    g.add(scaffold(k, 40, 52, HUB - 10, 0, 0));
    g.add(towerCrane(k, 180, 130, -70, -50, 0));
    g.add(goodsStacks(k, 60, 40));
    return g;
  }
  g.add(k.cylZ(k.paint(TOY.grey), 8, 46, 0, HUB, 0, 16));
  const wheel = named(new Group(), "wheel");
  wheel.position.set(0, HUB, 0);
  const arc = stage === 3 ? Math.PI * 2 : Math.PI * 1.1;
  for (const z of [-10, 10]) wheel.add(k.ring(steel, R, 2, 0, 0, z, true, arc), k.ring(red, R * 0.55, 1.4, 0, 0, z, true, arc));
  const n = stage === 3 ? SPOKES : Math.round(SPOKES * 0.55);
  for (let i = 0; i < n; i++) {
    const a = (i / SPOKES) * Math.PI * 2;
    for (const z of [-10, 10]) {
      const spoke = stick(k, steel, R, 1.6, 1.6, 0, 0, 0);
      spoke.geometry.translate(R / 2, -0.8, 0);
      spoke.position.set(0, 0, z);
      spoke.rotation.z = a;
      wheel.add(spoke);
    }
  }
  g.add(wheel);
  if (stage === 3) {
    // Gondolas hang level from the rim (turned back as the wheel turns: see animate).
    const colors = [TOY.red, TOY.yellow, TOY.blue, TOY.green, TOY.orange, TOY.purple];
    for (let i = 0; i < SPOKES; i++) {
      const a = (i / SPOKES) * Math.PI * 2;
      const pod = named(new Group(), "gondola");
      pod.position.set(Math.cos(a) * R, HUB + Math.sin(a) * R, 0);
      pod.add(k.box(k.paint(colors[i % colors.length]), 16, 12, 18, 2, 0, -16, 0), k.box(k.paint(TOY.cream), 18, 3, 20, 1.2, 0, -5, 0));
      pod.add(stick(k, k.metal, 1, 6, 1, 0, -5, 0));
      g.add(pod);
    }
    // A ticket booth, a flag on top, the crowd.
    g.add(k.box(k.paint(TOY.cream), 20, 18, 16, 2, 58, 5, 30), k.roof(k.paint(TOY.red), 22, 18, 8, 58, 23, 30, 2));
    g.add(pennant(k, TOY.red, 20, 0, HUB + 8, 0));
    g.add(k.peg(TOY.blue, null, 44, 5, -30), k.peg(TOY.pink, TOY.yellow, 52, 5, -20), k.peg(TOY.green, null, 60, 5, -36));
  } else {
    g.add(towerCrane(k, 200, 140, -80, -56, 0));
    g.add(goodsStacks(k, 60, 40));
  }
  return g;
}

function turnWheel(root: Object3D, t: number): void {
  const a = t * 0.15;
  root.traverse((o) => {
    if (o.name === "wheel") o.rotation.z = a;
  });
  let i = 0;
  root.traverse((o) => {
    if (o.name !== "gondola") return;
    const ang = (i++ / SPOKES) * Math.PI * 2 + a;
    o.position.set(Math.cos(ang) * 110, 132 + Math.sin(ang) * 110, 0);
  });
}

// ——— The assets: one per stage ———

interface Project {
  id: string;
  name: string;
  tags: string[];
  notes: string;
  build: (k: Kit, stage: Stage) => Object3D;
  animate?: (root: Object3D, t: number) => void;
}

const STAGE_NAMES: Record<Stage, string> = { 1: "foundations", 2: "half built", 3: "finished" };

export const PROJECTS: readonly Project[] = [
  {
    id: "grand-exhibition",
    name: "Grand Exhibition hall",
    tags: ["grand project", "exhibition", "glass", "iron", "hall"],
    notes: "A long hall of glass on iron ribs with a taller transept, flags on the ridge. A grand project: stone and planks for the foundations, iron and bricks for the hall, every town's own good for the stands. Opening day brings the Royal Train.",
    build: exhibition,
  },
  {
    id: "grand-cathedral",
    name: "Cathedral",
    tags: ["grand project", "cathedral", "spire", "church", "towers"],
    notes: "A stone nave and transept, two west towers, a spire over the crossing and a rose window. A grand project for a market city: stone by the trainload, bricks, then planks and tools for the roofs. Its day: bells, a wedding and bunting in every town.",
    build: cathedral,
  },
  {
    id: "grand-royal-train",
    name: "Royal Train",
    tags: ["grand project", "royal", "train", "engine", "saloon", "gold"],
    notes: "An engine and two saloons in crimson and gold on a display track, a crown on the royal saloon. Built at the engine works from iron, tools and furniture, then run through every city on opening day.",
    build: royalTrain,
  },
  {
    id: "grand-central",
    name: "Grand Central station",
    tags: ["grand project", "station", "clock tower", "train shed", "terminus"],
    notes: "A brick front with a tall clock tower and an arched glass train shed over three tracks. A grand project for a big network: bricks, iron and glass (stone), and passengers carried. Its day: every line's trains meet under the clock.",
    build: grandCentral,
  },
  {
    id: "grand-ferris-wheel",
    name: "World's Fair wheel",
    tags: ["grand project", "ferris wheel", "fair", "funfair", "animated"],
    notes: "A tall wheel on red A-frames with twelve coloured gondolas that stay level as it turns, a ticket booth below. A grand project for a resort: iron and tools for the wheel, food and riders for the fair. Its day: crowds from every town, by train.",
    build: ferrisWheel,
    animate: turnWheel,
  },
];

export const ASSETS: Asset[] = PROJECTS.flatMap((p) =>
  STAGES.map((stage): Asset => ({
    id: `${p.id}-${stage}`,
    name: `${p.name} (${STAGE_NAMES[stage]})`,
    trayLabel: stage === 3 ? p.name : `${p.name.split(" ")[0]} ${stage}/3`,
    category: p.id === "grand-royal-train" ? "Trains" : CAT,
    tags: [...p.tags, `stage ${stage}`],
    notes: stage === 3 ? p.notes : `${p.name}, ${STAGE_NAMES[stage]} (stage ${stage} of 3): the building site as the goods arrive.`,
    build: (k) => p.build(k, stage),
    animate: stage === 3 ? p.animate : undefined,
  })),
);

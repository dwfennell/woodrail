import { Group, type Object3D } from "three";
import { TOY, type Kit } from "../kit";
import { goodsStacks, named, pennant, plinth, ribs, scaffold, stick, towerCrane, vault } from "../build-parts";
import type { Asset } from "../types";
import { ROYAL_ENGINE_LENGTH, ROYAL_SALOON_LENGTH, buildRoyalEngine, buildRoyalSaloon } from "./royal-train";

/** Glass as the toys paint it: a pale sky-blue lacquer (the game's glass material draws dark in the props' batches). */
const GLASS = "#bcdcea";

/**
 * Grand projects (design spec 2026-11-05, part 2): map-wide builds that go up as goods arrive. Each is one builder
 * over its build stage (0 the fenced plot, 1 scaffold and foundations, 2 half built, 3 finished, 4 a last flourish),
 * registered as an asset per stage (`grand-<name>-<stage>`), so the game swaps a placed prop's asset as a stage
 * completes (src/game/grand.ts). On Sandbox's Buildings tab too. About 3 to 5 hill blocks across (a block is 72 mm).
 */

export type Stage = 0 | 1 | 2 | 3 | 4;

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

/** A string of bunting from (x0, z0) to (x1, z1) at height y: a cord and little triangles in the toy's colours. */
function bunting(k: Kit, x0: number, z0: number, x1: number, z1: number, y: number): Group {
  const g = new Group();
  const len = Math.hypot(x1 - x0, z1 - z0);
  const cord = k.box(k.paint(TOY.white), len, 0.6, 0.6, 0, 0, 0, 0);
  cord.position.set((x0 + x1) / 2, y, (z0 + z1) / 2);
  cord.rotation.y = -Math.atan2(z1 - z0, x1 - x0);
  g.add(cord);
  const n = Math.max(3, Math.round(len / 9));
  const colors = [TOY.red, TOY.yellow, TOY.blue, TOY.green, TOY.orange];
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n;
    const tri = k.extrude(k.paint(colors[i % colors.length]), [[-3, 0], [3, 0], [0, -6]], 0.6, 0, 0, 0, 0);
    tri.position.set(x0 + (x1 - x0) * t, y, z0 + (z1 - z0) * t);
    tri.rotation.y = -Math.atan2(z1 - z0, x1 - x0);
    g.add(tri);
  }
  return g;
}

/** An elm: a turned trunk and three big leaf balls (the 1851 hall kept its elms). */
function elm(k: Kit, x: number, z: number): Group {
  const g = new Group();
  g.add(k.cyl(k.paint(TOY.cream), 7, 3, 0, 0, 0, 7, 10), k.cyl(k.paint("#8a5a34"), 3, 34, 0, 3, 0, 2.4, 8));
  for (const [dx, dy, dz, r] of [[0, 44, 0, 16], [-7, 34, 5, 11]] as const) g.add(k.ball(k.paint(TOY.leaf), r, dx, dy, dz));
  return k.at(g, x, 0, z);
}

/** A statue on a plinth: a stone block and a gilded figure with its arm raised. */
function statue(k: Kit, x: number, y: number, z: number): Group {
  const g = new Group();
  const gilt = k.paint("#d9a441");
  g.add(k.box(k.paint(STONE), 12, 14, 12, 0, 0, 0, 0), k.box(k.paint(FRAME), 14, 2, 14, 0, 0, 14, 0));
  g.add(k.cyl(gilt, 3.6, 11, 0, 16, 0, 2.8, 10), k.ball(gilt, 2.8, 0, 29, 0));
  const arm = k.box(gilt, 1.6, 8, 1.6, 0, 0, 0, 0);
  arm.position.set(2.6, 28, 0);
  arm.rotation.z = -0.5;
  g.add(arm);
  return k.at(g, x, y, z);
}

/** A little exhibit stand: a counter under a striped awning, things to show on it. */
function stand(k: Kit, x: number, z: number, a: string, ry = 0): Group {
  const g = new Group();
  g.add(k.box(k.wood, 18, 10, 10, 0, 0, 0, 0));
  for (let j = 0; j < 4; j++) g.add(k.box(k.paint(j % 2 ? TOY.white : a), 4.8, 1.2, 14, 0, -7.2 + j * 4.8, 22, 0));
  for (const dx of [-8, 8]) g.add(k.cyl(k.wood, 0.8, 12, dx, 10, -5, 0.8, 6));
  g.add(k.ball(k.paint(TOY.red), 2.4, -4, 12.4, 0), k.box(k.paint(TOY.blue), 4, 4, 4, 0, 3, 10, 0), k.cyl(k.paint(TOY.yellow), 2, 5, 7, 10, 1, 2, 8));
  return k.at(g, x, 0, z, ry);
}

/** The Exhibition's last flourishes (stage 4): what its opening day adds. */
function flourishes(k: Kit, L: number, W: number, top: number, y0: number): Group {
  const g = new Group();
  const iron = k.paint(IRON);
  const gold = k.paint("#d9a441");
  const fx = L / 2 + 26;
  // The path on to the gates, lamps along it, bunting between them.
  g.add(k.box(k.paint("#d9cdb6"), 90, 1, 22, 0.4, fx + 45, y0, 0));
  for (const s of [-1, 1]) {
    g.add(lampPost(k, fx + 60, y0, s * 16));
    g.add(bunting(k, fx + 10, s * 18, fx + 30, s * 16, y0 + 26), bunting(k, fx + 30, s * 16, fx + 60, s * 16, y0 + 26), bunting(k, fx + 60, s * 16, fx + 86, s * 20, y0 + 26));
  }
  // The crystal fountain: a stone basin, water, glassy tiers and a sparkle on top.
  const cx = fx + 45;
  g.add(k.cyl(k.paint(STONE), 15, 5, cx, y0, 0, 15, 16), k.cyl(k.water, 13, 1, cx, y0 + 4.6, 0, 13, 16));
  g.add(k.lathe(k.paint(GLASS), [[0.1, 0], [3, 0], [3, 10], [9, 12], [2.4, 14], [2.4, 22], [6, 24], [1.6, 26], [0.1, 30]], cx, y0 + 5, 0, 12));
  g.add(k.ball(k.paint(FRAME), 2.4, cx, y0 + 36, 0));
  // Ornate iron gates with a crest: stone piers with gold balls, an arch of iron, railings.
  const gx = fx + 90;
  for (const s of [-1, 1]) {
    g.add(k.box(k.paint(STONE), 9, 28, 9, 0, gx, y0, s * 19), k.ball(gold, 3, gx, y0 + 31, s * 19));
    for (let i = 0; i < 4; i++) g.add(k.box(iron, 1.2, 20, 1.2, 0, gx, y0, s * (5 + i * 3.4)));
    g.add(k.box(iron, 1.4, 1.4, 14, 0, gx, y0 + 18, s * 10));
    for (let i = 0; i < 4; i++) g.add(k.box(iron, 1.2, 14, 1.2, 0, gx, y0, s * (28 + i * 6)));
    g.add(k.box(iron, 1.4, 1.4, 24, 0, gx, y0 + 13, s * 37));
  }
  g.add(k.at(k.ring(iron, 15, 1.6, 0, 0, 0, true, Math.PI), gx, y0 + 22, 0, Math.PI / 2));
  g.add(k.cylX(gold, 5, 1.6, gx, y0 + 40, 0, 14), k.cylX(k.paint("#b0283a"), 3, 2, gx, y0 + 40, 0, 10));
  // Statues on plinths inside the gates.
  for (const s of [-1, 1]) g.add(statue(k, gx - 14, y0, s * 30));
  // An arched clock over the entrance: a gold-rimmed face on the glass front.
  g.add(k.cylX(k.paint(FRAME), 10, 1.6, L / 2 + 2, top + 3 + 22, 0, 18), k.at(k.ring(gold, 10.5, 1.2, 0, 0, 0, true), L / 2 + 2.6, top + 25, 0, Math.PI / 2));
  g.add(k.box(k.paint(TOY.black), 1, 8, 1, 0, L / 2 + 3, top + 25, 0), k.box(k.paint(TOY.black), 1, 1, 6, 0, L / 2 + 3, top + 25, 2.4));
  // Exhibit stands outside the long sides, and elms by the transept's ends.
  for (const s of [-1, 1]) {
    g.add(stand(k, 60, s * (W / 2 + 22), s > 0 ? TOY.red : TOY.blue, s > 0 ? 0 : Math.PI));
    g.add(elm(k, -50, s * (W / 2 + 62)));
  }
  g.add(k.peg(TOY.green, null, cx - 14, y0, 10), k.peg(TOY.pink, TOY.yellow, cx + 14, y0, -10), k.peg(TOY.yellow, TOY.red, gx + 8, y0, 4));
  return g;
}

/** The Exhibition's grounds on opening day (x0, x1, z0, z1): every stage is laid out as wide. */
const EXHIBITION_SITE = [-140, 238, -118, 118] as const;

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
  // (The grounds laid out from the start, as wide as opening day's gates and stands: the site keeps its size.)
  if (stage < 4) g.add(k.box(k.paint("#d9cdb6"), EXHIBITION_SITE[1] - EXHIBITION_SITE[0], 0.6, EXHIBITION_SITE[3] - EXHIBITION_SITE[2], 0.2, (EXHIBITION_SITE[0] + EXHIBITION_SITE[1]) / 2, 0, 0));
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
  g.add(glassVault(k, W / 2, L, 0, top + 3, 0, stage >= 3 ? L : L * 0.45));
  if (stage >= 3) {
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
    if (stage === 4) g.add(flourishes(k, L, W, top, y0));
  } else {
    // Half built: the far half's glass not on yet, scaffolding over it, a crane and goods.
    g.add(scaffold(k, L * 0.55, W + 14, W / 2 + WALL + 10, L * 0.22, 0));
    g.add(towerCrane(k, 130, 120, L / 2 + 20, -W / 2 - 18, Math.PI));
    g.add(goodsStacks(k, L / 2 + 10, W / 2 + 18));
    g.add(siteHut(k, -L / 2 + 10, W / 2 + 22));
  }
  return g;
}

// ——— The cathedral: the biggest thing in a city ———

/** Stained glass: the toy's jewel colours. */
const JEWELS = ["#b0283a", "#2f5fb5", "#e3a92c", "#2d8a55", "#7a3f9a"] as const;
const CLEAR = "#5d7488";

/** A pointed lancet window (flat, `w` wide, `h` tall) facing ±z at z; jewel-coloured once glazed. */
function lancet(k: Kit, x: number, y: number, z: number, w: number, h: number, color: string): Group {
  const g = new Group();
  const pts: [number, number][] = [[-w / 2, 0], [w / 2, 0], [w / 2, h - w * 0.7], [0, h], [-w / 2, h - w * 0.7]];
  g.add(k.extrude(k.paint(color), pts, 1.4, 0, 0, 0, 0));
  return k.at(g, x, y, z);
}

/** A round window facing +x (rotate for ±z): a stone ring, a pane, and in stained glass a ring of jewel petals. */
function rose(k: Kit, r: number, stained: boolean, x: number, y: number, z: number, ry = 0): Group {
  const g = new Group();
  g.add(k.ring(k.paint("#e8dfcc"), r, 2.2, 0, 0, 0, true));
  g.add(k.cylZ(k.paint(stained ? "#2f5fb5" : CLEAR), r, 1.2, 0, 0, 0, 16));
  if (stained) {
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      g.add(k.cylZ(k.paint(JEWELS[i % JEWELS.length]), r * 0.26, 1.8, Math.cos(a) * r * 0.62, Math.sin(a) * r * 0.62, 0, 10));
    }
    g.add(k.cylZ(k.paint("#e3a92c"), r * 0.28, 2, 0, 0, 0, 10));
  } else {
    for (const a of [0, Math.PI / 4, Math.PI / 2, (3 * Math.PI) / 4]) {
      const bar = k.box(k.paint("#e8dfcc"), 2 * r, 1.6, 2, 0, 0, 0, 0);
      bar.position.set(0, 0, 0);
      bar.rotation.z = a;
      g.add(bar);
    }
  }
  // (Built facing ±z; turned to face +x by default.)
  return k.at(g, x, y, z, ry);
}

function cathedral(k: Kit, stage: number): Object3D {
  const g = new Group();
  const stone = k.paint("#ded3bd");
  const trim = k.paint("#c4b79d");
  const roofM = k.paint("#556a80");
  const gold = k.paint("#e3a92c");
  const stained = stage >= 4;
  const glass = (i: number) => (stained ? JEWELS[i % JEWELS.length] : CLEAR);
  // Nave along x (the west front at +x), aisles either side, transept across, an apse at the east end.
  const L = 200, W = 56, AW = 26, H = 80, AH = 42;
  const TX = -40, TW = 56, TL = W + 2 * AW + 60;
  const TOWER = 42, TH = 175;
  g.add(k.box(k.paint(STONE), L + 140, 2, TL + 50, 0.8, -10, 0, 0));
  g.add(k.box(k.wood, L + 130, 2, TL + 40, 1, -10, 2, 0));
  const y0 = 4;
  if (stage === 1) {
    // The footings laid out: low walls on the plan, stone stacked, a crane, the masons' hut.
    g.add(siteFence(k, L + 120, TL + 30, -10, 0));
    const low = 9;
    for (const s of [-1, 1]) {
      g.add(k.box(trim, L, low, 6, 0, 0, y0, s * (W / 2)));
      g.add(k.box(trim, L - 20, low, 6, 0, -10, y0, s * (W / 2 + AW)));
      g.add(k.box(trim, TOWER, low + 6, TOWER, 1, L / 2 + TOWER / 2 - 4, y0, s * (W / 2 + AW - TOWER / 2)));
    }
    g.add(k.box(trim, 6, low, TL, 0, TX - TW / 2, y0, 0), k.box(trim, 6, low, TL, 0, TX + TW / 2, y0, 0));
    g.add(k.cyl(trim, W / 2, low, -L / 2, y0, 0, W / 2, 10));
    g.add(goodsStacks(k, 0, 0), goodsStacks(k, TX, TL / 2 - 20));
    g.add(siteHut(k, L / 2 + 40, -TL / 2 + 6));
    g.add(towerCrane(k, 150, 130, -L / 2 - 40, -TL / 2 + 10, 0));
    g.add(k.peg(TOY.orange, TOY.yellow, 20, y0, 10), k.peg(TOY.orange, TOY.yellow, -50, y0, -20), k.peg(TOY.cream, TOY.black, 40, y0, -30));
    return grander(g);
  }
  const part = stage === 2 ? 0.55 : 1;
  const h = H * part, ah = AH * Math.min(1, part * 1.4), th = stage === 2 ? 90 : TH;
  // Aisles, nave, transept and apse.
  for (const s of [-1, 1]) g.add(k.box(stone, L - 20, ah, AW, 2, -10, y0, s * (W / 2 + AW / 2)));
  g.add(k.box(stone, L, h, W, 2, 0, y0, 0));
  g.add(k.box(stone, TW, h, TL, 2, TX, y0, 0));
  g.add(k.cyl(stone, W / 2, h, -L / 2, y0, 0, W / 2, 12));
  // Buttress piers down each side, and pinnacles on them.
  const bays = [-70, -10, 20, 50, 80];
  for (const s of [-1, 1])
    for (const bx of bays) {
      g.add(k.box(trim, 9, Math.min(ah + 8, AH + 8), 9, 1, bx, y0, s * (W / 2 + AW + 3)));
      if (stage >= 3) g.add(k.cone(trim, 5, 14, bx, y0 + AH + 8, s * (W / 2 + AW + 3), 4));
    }
  // West towers flanking the front.
  for (const s of [-1, 1]) g.add(k.box(stone, TOWER, th, TOWER, 2, L / 2 + TOWER / 2 - 4, y0, s * (W / 2 + AW - TOWER / 2)));
  // Windows: aisle lancets, and (once the walls are up) the clerestory's tall ones.
  let wi = 0;
  for (const s of [-1, 1])
    for (const bx of [-55, -25, 5, 35, 65]) {
      g.add(lancet(k, bx, y0 + 10, s * (W / 2 + AW + 0.4), 9, Math.min(24, ah - 14), glass(wi++)));
      if (stage >= 3) g.add(lancet(k, bx, y0 + AH + 10, s * (W / 2 + 0.4), 10, 26, glass(wi++)));
    }
  if (stage === 2) {
    g.add(scaffold(k, 90, W + 2 * AW + 16, h + 26, 20, 0));
    for (const s of [-1, 1]) g.add(scaffold(k, TOWER + 10, TOWER + 10, th + 20, L / 2 + TOWER / 2 - 4, s * (W / 2 + AW - TOWER / 2)));
    g.add(towerCrane(k, 190, 150, -L / 2 - 30, -TL / 2 - 10, 0));
    g.add(goodsStacks(k, TX, TL / 2 + 16), goodsStacks(k, L / 2 + 50, -40));
    g.add(siteHut(k, L / 2 + 50, TL / 2 - 10));
    return grander(g);
  }
  // Roofs: steep slate over the nave, the transept and the aisles; a cone over the apse.
  const top = y0 + H;
  g.add(k.roof(roofM, L, W + 6, 50, 0, top, 0, 3.5));
  const tr = k.roof(roofM, TL, TW + 6, 50, 0, 0, 0, 3.5);
  tr.rotation.y = Math.PI / 2;
  g.add(k.at(tr, TX, top, 0));
  for (const s of [-1, 1]) {
    const ar = k.box(roofM, L - 20, 3, AW + 8, 1, 0, 0, 0);
    ar.position.set(-10, y0 + AH + 6, s * (W / 2 + AW / 2));
    ar.rotation.x = s * 0.45;
    g.add(ar);
  }
  g.add(k.cone(roofM, W / 2 + 3, 40, -L / 2, top, 0, 12));
  // Flying buttresses: an arch from each pier up to the nave wall.
  for (const s of [-1, 1])
    for (const bx of bays) {
      const fly = k.ring(trim, AW + 3, 2.4, 0, 0, 0, true, Math.PI / 2);
      fly.rotation.y = s > 0 ? -Math.PI / 2 : Math.PI / 2;
      fly.position.set(bx, y0 + AH + 6, s * (W / 2));
      g.add(fly);
    }
  // The crossing: a lantern tower and a slender spire.
  g.add(k.box(stone, 34, 30, 34, 2, TX, top + 30, 0));
  for (const s of [-1, 1]) g.add(lancet(k, TX, top + 36, s * 17.4, 8, 18, glass(wi++)));
  g.add(k.cone(roofM, 22, 90, TX, top + 60, 0, 8));
  g.add(k.box(gold, 1.6, 16, 1.6, 0, TX, top + 150, 0), k.box(gold, 1.6, 1.6, 9, 0, TX, top + 160, 0));
  // The towers' tops: a band, belfry openings, pinnacles and spires.
  for (const s of [-1, 1]) {
    const tx = L / 2 + TOWER / 2 - 4, tz = s * (W / 2 + AW - TOWER / 2);
    g.add(k.box(trim, TOWER + 4, 4, TOWER + 4, 1, tx, y0 + TH - 40, tz));
    for (const d of [-1, 1]) g.add(lancet(k, tx + d * 9, y0 + TH - 32, tz + s * (TOWER / 2 + 0.4), 7, 24, "#2b3644"));
    for (const [px, pz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) g.add(k.cone(trim, 5, 22, tx + px * (TOWER / 2 - 4), y0 + TH, tz + pz * (TOWER / 2 - 4), 4));
    g.add(k.cone(roofM, 18, 64, tx, y0 + TH, tz, 4).rotateY(Math.PI / 4));
    g.add(k.ball(gold, 2.4, tx, y0 + TH + 66, tz));
  }
  // The west front between the towers: a gable, the rose window, three portals.
  const fx = L / 2;
  g.add(k.extrude(stone, [[-W / 2, 0], [W / 2, 0], [0, 50]], 6, 0, 0, 0, 0).rotateY(Math.PI / 2).translateY(top).translateZ(fx));
  g.add(rose(k, 17, stained, fx + 0.8, y0 + 56, 0, Math.PI / 2));
  for (const [z, w, hh] of [[0, 18, 34], [-(W / 2 + AW - TOWER / 2), 12, 26], [W / 2 + AW - TOWER / 2, 12, 26]] as const) {
    const portal = k.extrude(k.paint("#5a3a22"), [[-w / 2, 0], [w / 2, 0], [w / 2, hh - w * 0.6], [0, hh], [-w / 2, hh - w * 0.6]], 2, 0, 0, 0, 0);
    g.add(k.at(portal, z === 0 ? fx + 1 : fx + TOWER - 3, y0, z, Math.PI / 2));
  }
  // Rose windows in the transept ends.
  for (const s of [-1, 1]) g.add(rose(k, 14, stained, TX, y0 + 52, s * (TL / 2 + 0.8)));
  if (stained) {
    // Its day: bunting to the gate, a wedding party at the door.
    g.add(pennant(k, TOY.red, 22, fx + 30, y0, -26), pennant(k, TOY.blue, 22, fx + 30, y0, 26));
    g.add(k.box(k.paint("#d9cdb6"), 40, 1, 22, 0.4, fx + 30, y0, 0));
    g.add(k.peg(TOY.white, null, fx + 24, y0, 3), k.peg(TOY.black, TOY.black, fx + 24, y0, -5), k.peg(TOY.pink, TOY.yellow, fx + 34, y0, 8), k.peg(TOY.purple, null, fx + 36, y0, -9));
  }
  return grander(g);
}

/** The cathedral is drawn a fifth bigger than it's modelled: the biggest thing in a city (as BUILDING_SCALE does). */
function grander(g: Group): Group {
  g.scale.setScalar(CATHEDRAL_SCALE);
  return g;
}
const CATHEDRAL_SCALE = 1.2;

// ——— The Royal Train: built at the engine works, then run (src/catalogue/assets/royal-train.ts) ———

function royalTrain(k: Kit, stage: Stage): Object3D {
  const g = new Group();
  const E = ROYAL_ENGINE_LENGTH;
  const S = ROYAL_SALOON_LENGTH;
  // Engine, saloon with the crown, observation saloon, coupled (2 mm apart) along x on a display track.
  const xs = [E / 2 + 2 + S / 2 - 2, -2, -2 - (S + 2)];
  // (Wheels in the grooves, as the game lifts its code cars: AXLE_HEIGHT − 7.5.)
  const lift = 7.5;
  g.add(k.trackSlab(E + 2 * S + 40, (xs[0] + xs[2]) / 2, 0, 0));
  if (stage === 1) {
    // On the works' blocks: the frames and wheels, nothing built up yet.
    for (const [i, x] of xs.entries()) {
      const len = i === 0 ? E : S;
      g.add(k.box(k.paint(TOY.black), len - 4, 5, 28, 1, x, lift + 12, 0));
      g.add(k.at(k.bogies(len, i === 0 ? 20 : 18, "#c9a26b"), x, lift, 0));
      for (const s of [-1, 1]) g.add(k.box(k.paint("#c9a26b"), 6, 10, 30, 0.6, x + s * 26, 12, 0));
    }
    g.add(goodsStacks(k, xs[1], 46));
    return g;
  }
  const bare = stage === 2;
  g.add(k.at(buildRoyalEngine(k, bare), xs[0], lift, 0));
  g.add(k.at(buildRoyalSaloon(k, { crown: true, bare }), xs[1], lift, 0));
  g.add(k.at(buildRoyalSaloon(k, { balcony: true, bare }), xs[2], lift, 0));
  if (bare) g.add(goodsStacks(k, xs[1], 46));
  return g;
}

// ——— Grand Central: a through station, three tracks through a glass train shed, the station building alongside ———

/**
 * The tracks' centres across the shed (z), 60 apart: real track runs through along x (the model leaves room for it:
 * nothing stands within 24 mm of a centre below the shed's springing), so trains drive in one end and out the other.
 */
export const CENTRAL_TRACKS = [-60, 0, 60] as const;
/** The shed's length along x, and how far its platforms run past it either end. */
const SHED = 260;
const PLAT = 340;
/** Platform tops: the town platforms' height (bldg_parts.py `platform`, 13 above the felt). */
const PLAT_H = 14;

/** Block letters, 4 × 5, by rows top down ('#' a block): enough for the station's name board. */
const FONT: Record<string, string[]> = {
  G: [".###", "#...", "#.##", "#..#", ".###"],
  R: ["###.", "#..#", "###.", "#.#.", "#..#"],
  A: [".##.", "#..#", "####", "#..#", "#..#"],
  N: ["#..#", "##.#", "#.##", "#..#", "#..#"],
  D: ["###.", "#..#", "#..#", "#..#", "###."],
  C: [".###", "#...", "#...", "#...", ".###"],
  E: ["####", "#...", "###.", "#...", "####"],
  T: ["####", ".#..", ".#..", ".#..", ".#.."],
  L: ["#...", "#...", "#...", "#...", "####"],
};

/** `text` in gold block letters on a wall facing +z, centred on x, its baseline at y; `px` the size of a block. */
function goldLetters(k: Kit, text: string, x: number, y: number, z: number, px = 2.2): Group {
  const g = new Group();
  const gold = k.paint("#e3b23c");
  const w = text.length * 5 * px - px;
  let cx = x - w / 2;
  for (const ch of text) {
    const rows = FONT[ch];
    if (rows)
      rows.forEach((row, r) => {
        // Each run of blocks in a row is one box.
        for (let c = 0; c < 4; ) {
          if (row[c] !== "#") {
            c++;
            continue;
          }
          let e = c;
          while (e < 4 && row[e] === "#") e++;
          g.add(k.box(gold, (e - c) * px, px, 1.2, 0, cx + ((c + e) / 2) * px, y + (4 - r) * px, z));
          c = e;
        }
      });
    cx += 5 * px;
  }
  return g;
}

/** A clock face facing +x at (x, y, z): a cream face, a gold rim, black hands at ten to two. */
function clockFace(k: Kit, r: number, x: number, y: number, z: number, ry = 0): Group {
  const g = new Group();
  g.add(k.cylX(k.paint(FRAME), r, 1.6, 0, 0, 0, 16), k.at(k.ring(k.paint("#e3b23c"), r, 1, 0, 0, 0, true), 0.8, 0, 0, Math.PI / 2));
  const minute = k.box(k.paint(TOY.black), 1, r * 0.8, 1.2, 0, 1.2, 0, 0);
  minute.geometry.translate(0, r * 0.4 - (r * 0.8) / 2, 0);
  minute.rotation.x = 0.6;
  const hour = k.box(k.paint(TOY.black), 1, r * 0.55, 1.4, 0, 1.2, 0, 0);
  hour.geometry.translate(0, r * 0.27 - (r * 0.55) / 2, 0);
  hour.rotation.x = -0.9;
  g.add(minute, hour, k.cylX(k.paint(TOY.black), 1.4, 2, 1.4, 0, 0, 8));
  return k.at(g, x, y, z, ry);
}

/** A toy cab: a black body with a yellow band, a roof light, four wheels; facing +x. */
function cab(k: Kit, x: number, z: number, ry = 0): Group {
  const g = new Group();
  g.add(k.box(k.paint(TOY.black), 30, 9, 14, 0, 0, 3, 0), k.box(k.paint(TOY.black), 16, 8, 13, 0, -3, 12, 0));
  g.add(k.box(k.paint(TOY.yellow), 30.4, 2, 14.4, 0, 0, 7, 0), k.box(k.paint(TOY.yellow), 4, 2, 4, 0, -3, 20, 0));
  for (const s of [-1, 1]) g.add(k.box(k.paint("#2b3644"), 13, 5, 0.6, 0, -3, 13.5, s * 6.8));
  for (const wx of [-9, 9]) for (const s of [-1, 1]) g.add(k.cylZ(k.paint("#2a2b2e"), 3.6, 2, wx, 3.6, s * 6.4, 10));
  return k.at(g, x, 0, z, ry);
}

/** A station bench, facing +z. */
function bench(k: Kit, x: number, y: number, z: number, ry = 0): Group {
  const g = new Group();
  g.add(k.box(k.wood, 14, 1.4, 5, 0, 0, 5, 0), k.box(k.wood, 14, 5, 1.2, 0, 0, 6.4, -2.4));
  for (const s of [-1, 1]) g.add(k.box(k.paint(IRON), 1.2, 5, 5, 0, s * 6, 0, 0));
  return k.at(g, x, y, z, ry);
}

/** A departure board on two posts: dark, with lines in amber. */
function departures(k: Kit, x: number, y: number, z: number): Group {
  const g = new Group();
  for (const s of [-1, 1]) g.add(k.box(k.paint(IRON), 1.6, 24, 1.6, 0, 0, 0, s * 9));
  g.add(k.box(k.paint("#1d2430"), 3, 12, 22, 0, 0, 22, 0));
  for (let i = 0; i < 3; i++) for (const s of [-1, 1]) g.add(k.box(k.paint("#f2b233"), 3.4, 1.2, 8, 0, 0, 25 + i * 3, s * 5));
  return k.at(g, x, y, z);
}

function grandCentral(k: Kit, stage: Stage): Object3D {
  const g = new Group();
  const stone = k.paint("#e2d8c4");
  const trim = k.paint(FRAME);
  const iron = k.paint(IRON);
  const brick = k.paint("#a8553a");
  const SPRING = 62; // the shed's sides: trains (about 50 tall) run under its ends' glass screens
  const SW = 210; // the shed's span across z
  const BZ = SW / 2 + 22; // the building's middle (z), alongside the shed
  // The ground: a stone step under the whole of it, the forecourt beyond the building.
  g.add(k.box(k.paint(STONE), PLAT + 20, 2, SW + 150, 0.8, 0, 0, 40));
  // Platforms between and beside the tracks (none on a track: they stop 21 short of each centre).
  const platZ = [-90.5, -30, 30, 90.5];
  const platW = [19, 18, 18, 19];
  platZ.forEach((z, i) => g.add(k.box(trim, PLAT, PLAT_H - 2, platW[i], 1, 0, 2, z), k.box(k.paint("#f2d34a"), PLAT, 0.6, 1.4, 0, 0, PLAT_H, z + (z < 0 ? platW[i] / 2 - 1.6 : -(platW[i] / 2 - 1.6)))));
  if (stage === 1) {
    // The platforms laid, the shed's columns started, the building's footings; a fence round the building side.
    for (let i = 0; i <= 8; i++) for (const s of [-1, 1]) g.add(k.box(iron, 4, i % 2 ? 30 : 14, 4, 0, -SHED / 2 + (SHED * i) / 8, PLAT_H, s * (SW / 2 - 4)));
    g.add(k.box(k.paint(STONE), 230, 8, 46, 1, 0, 2, BZ + 4));
    g.add(siteFence(k, 250, 80, 0, BZ + 14));
    g.add(goodsStacks(k, -60, BZ + 70), goodsStacks(k, 60, BZ + 70), siteHut(k, 120, BZ + 70));
    g.add(towerCrane(k, 160, 140, -150, BZ + 40, 0));
    g.add(k.peg(TOY.orange, TOY.yellow, 20, 2, BZ + 4), k.peg(TOY.orange, TOY.yellow, -30, 2, BZ + 10));
    return g;
  }
  // The shed's sides: a brick wall on the far side with arched windows, iron columns on the building side.
  g.add(k.box(brick, SHED, SPRING - 2, 8, 2, 0, 2, -SW / 2 - 4));
  for (let i = 0; i < 8; i++) g.add(winZ(k, -SHED / 2 + 18 + i * ((SHED - 36) / 7), 24, -SW / 2 + 0.4, 10, 22));
  for (let i = 0; i <= 8; i++) g.add(k.box(iron, 4, SPRING - PLAT_H, 4, 0, -SHED / 2 + (SHED * i) / 8, PLAT_H, SW / 2 - 4));
  g.add(k.box(trim, SHED + 6, 4, 10, 1, 0, SPRING - 2, -SW / 2 - 3), k.box(trim, SHED + 6, 4, 10, 1, 0, SPRING - 2, SW / 2 - 3));
  // The arched glass roof: a flatter arch than a half round (segmental), on green ribs; glass ends above the trains.
  const roof = new Group();
  roof.add(glassVault(k, SW / 2, SHED, 0, 0, 0, stage >= 3 ? SHED : SHED * 0.35));
  if (stage >= 3) roof.add(vaultEnd(k, SW / 2, -SHED / 2, 0), vaultEnd(k, SW / 2, SHED / 2, 0));
  roof.scale.set(1, 0.5, 1);
  roof.position.y = SPRING + 2;
  g.add(roof);
  // The station building alongside, facing +z: stone, two storeys of windows, a cornice and a balustrade.
  const BW = 240;
  const BH = stage >= 3 ? 64 : 34;
  g.add(k.box(stone, BW, BH, 40, 3, 0, 2, BZ));
  const front = BZ + 20;
  for (let i = 0; i < 10; i++) {
    const wx = -BW / 2 + 16 + i * ((BW - 32) / 9);
    if (Math.abs(wx) < 30) continue;
    g.add(winZ(k, wx, 12, front + 0.4, 10, 16));
    if (stage >= 3) g.add(winZ(k, wx, 40, front + 0.4, 10, 14));
  }
  if (stage === 2) {
    g.add(scaffold(k, 120, 52, 70, 40, BZ));
    g.add(scaffold(k, 46, 46, 110, 0, BZ));
    g.add(towerCrane(k, 180, 150, -150, BZ + 50, 0), goodsStacks(k, 80, BZ + 66), siteHut(k, -100, BZ + 66));
    return g;
  }
  g.add(k.box(trim, BW + 4, 4, 44, 1, 0, 2 + BH, BZ));
  for (let i = 0; i < 24; i++) g.add(k.box(trim, 2, 6, 2, 0, -BW / 2 + 5 + i * ((BW - 10) / 23), 6 + BH, front));
  g.add(k.box(trim, BW + 4, 2, 3, 0, 0, 12 + BH, front));
  // The portico: columns either side of the great arched entrance, a pediment over it.
  for (const cx2 of [-48, -36, -24, 24, 36, 48]) g.add(k.cyl(trim, 3, 46, cx2, 2, front + 8, 3, 10), k.box(trim, 8, 3, 8, 0, cx2, 48, front + 8));
  g.add(k.box(trim, 108, 6, 14, 1, 0, 50, front + 6));
  g.add(k.extrude(trim, [[-56, 0], [56, 0], [0, 18]], 12, 0, 0, front + 6, 0).translateY(56));
  g.add(k.extrude(k.paint("#2b3644"), [[-14, 0], [14, 0], [14, 22], [10, 30], [0, 34], [-10, 30], [-14, 22]], 1.4, 0, 2, front + 0.8, 0));
  g.add(k.at(k.ring(k.paint("#e3b23c"), 15, 1.4, 0, 0, 0, true, Math.PI), 0, 24, front + 1.4));
  // The name in gold letters on a dark board above the entrance.
  g.add(k.box(k.paint("#1f3f73"), 150, 16, 2, 0.6, 0, 76, front + 4));
  g.add(goldLetters(k, "GRAND CENTRAL", 0, 79.5, front + 5.2, 2));
  // The clock tower over the entrance: four faces, a belfry, a spire and a gilt finial; flags.
  const TX = 0, TZ = BZ - 4, TW = 40, TH = 150;
  g.add(k.box(stone, TW, TH, TW, 3, TX, 2, TZ));
  g.add(k.box(trim, TW + 4, 4, TW + 4, 1, TX, TH - 34, TZ), k.box(trim, TW + 4, 4, TW + 4, 1, TX, TH, TZ));
  for (const [dx, dz, ry] of [[TW / 2, 0, 0], [-TW / 2, 0, Math.PI], [0, TW / 2, -Math.PI / 2], [0, -TW / 2, Math.PI / 2]] as const) g.add(clockFace(k, 13, TX + dx, TH - 16, TZ + dz, ry));
  g.add(k.cone(k.paint("#3f6f63"), TW / 2 + 6, 56, TX, TH + 4, TZ, 4).rotateY(Math.PI / 4));
  g.add(k.cyl(k.paint("#e3b23c"), 1.2, 14, TX, TH + 58, TZ, 1.2, 6), k.ball(k.paint("#e3b23c"), 3, TX, TH + 74, TZ));
  for (const fx of [-BW / 2 + 10, -70, 70, BW / 2 - 10]) g.add(pennant(k, fx < 0 ? TOY.red : TOY.blue, 20, fx, 14 + BH, front - 4));
  // Canopies over the platforms' ends outside the shed, with benches, a departure board, passengers.
  for (const end of [-1, 1]) {
    const ex = end * (SHED / 2 + 36);
    platZ.forEach((z, i) => {
      const w = platW[i];
      for (const px of [-20, 20]) g.add(k.box(iron, 2, 24, 2, 0, ex + px, PLAT_H, z));
      g.add(k.box(iron, 52, 2, 2, 0, ex, PLAT_H + 23, z));
      g.add(k.roof(k.paint(i % 2 ? TOY.red : TOY.green), 58, w + 8, 6, ex, PLAT_H + 24, z, 2));
    });
  }
  g.add(departures(k, 0, PLAT_H, -30), departures(k, 0, PLAT_H, 30));
  for (const [x, z] of [[-60, -30], [60, -30], [-60, 30], [60, 30], [-90, 90.5], [90, -90.5]] as const) g.add(bench(k, x, PLAT_H, z + (z > 0 ? -3 : 3), z > 0 ? 0 : Math.PI));
  const coats = [TOY.red, TOY.blue, TOY.yellow, TOY.purple, TOY.green, TOY.pink, TOY.orange];
  [[-40, -32], [40, 28], [46, 33], [100, 90], [-20, -29]].forEach(([x, z], i) => g.add(k.peg(coats[i % coats.length], i % 3 === 0 ? TOY.black : null, x, PLAT_H, z)));
  // The forecourt: paving, lamp posts, cabs waiting, people coming and going.
  const FZ = front + 40;
  g.add(k.box(k.paint("#d9cdb6"), 200, 1, 50, 0.4, 0, 2, FZ));
  for (const lx of [-90, -45, 45, 90]) g.add(lampPost(k, lx, 2, FZ + 22));
  g.add(cab(k, -70, FZ + 6, 0), cab(k, -30, FZ + 6, 0), cab(k, 66, FZ + 6, Math.PI));
  g.add(k.peg(TOY.blue, TOY.black, 8, 2, FZ - 10), k.peg(TOY.pink, null, -8, 2, FZ - 4));
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
  // (The fairground's paving as wide as the wheel turns, from the start: the site keeps its size.)
  g.add(k.box(k.paint("#d9cdb6"), 240, 0.6, 134, 0.2, 0, 0, -3));
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

// ——— Stage 0: the fenced plot, as a project is started ———

/**
 * A grand project's plot before its first goods: the ground marked out over the whole site (as wide as its biggest
 * stage, so nothing is built where it will grow), a two-colour board fence with a gate, a site hut, a sign in the
 * project's colour and a couple of surveyors. `site` is x0, x1, z0, z1 (mm, the model's own frame).
 */
function plot(k: Kit, site: readonly [number, number, number, number], color: string): Object3D {
  const g = new Group();
  const [x0, x1, z0, z1] = site;
  const w = x1 - x0;
  const d = z1 - z0;
  const cx = (x0 + x1) / 2;
  const cz = (z0 + z1) / 2;
  g.add(k.box(k.paint("#cdbb98"), w, 1.2, d, 0.3, cx, 0, cz));
  g.add(siteFence(k, w - 8, d - 8, cx, cz));
  g.add(siteHut(k, x1 - 30, z1 - 26));
  // The sign: a board on two posts by the gate, in the project's colour, a white stripe across it.
  const sign = new Group();
  sign.add(k.box(k.wood, 3, 26, 3, 0, -16, 0, 0), k.box(k.wood, 3, 26, 3, 0, 16, 0, 0));
  sign.add(k.box(k.paint(color), 44, 20, 2.4, 1, 0, 20, 0), k.box(k.paint(TOY.white), 36, 3, 2.8, 0.5, 0, 28, 0));
  g.add(k.at(sign, x1 + 6, 0, cz + 30, Math.PI / 2));
  // Stakes and string marking out the first walls, and the surveyors.
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) g.add(k.box(k.wood, 2, 8, 2, 0, cx + sx * w * 0.3, 0, cz + sz * d * 0.25));
  g.add(k.box(k.paint(TOY.white), w * 0.6, 0.6, 0.6, 0, cx, 6, cz - d * 0.25), k.box(k.paint(TOY.white), w * 0.6, 0.6, 0.6, 0, cx, 6, cz + d * 0.25));
  g.add(k.peg(TOY.orange, TOY.yellow, cx - 20, 1, cz), k.peg(TOY.orange, TOY.yellow, cx + 24, 1, cz - 12));
  return g;
}

/** Each project's whole site in its model's frame (the union of its stages' footprints, measured: grand.test.ts). */
const SITES: Record<string, readonly [number, number, number, number]> = {
  "grand-exhibition": EXHIBITION_SITE,
  "grand-cathedral": [-216, 207, -135, 139],
  "grand-royal-train": [-156, 156, -20, 61],
  "grand-central": [-196, 196, -140, 220],
  "grand-ferris-wheel": [-120, 120, -70, 64],
};

// ——— The assets: one per stage ———

interface Project {
  id: string;
  name: string;
  tags: string[];
  notes: string;
  build: (k: Kit, stage: Stage) => Object3D;
  animate?: (root: Object3D, t: number) => void;
  /** Its last stage (3, or 4 with a last flourish), and that stage's name. */
  stages: 3 | 4;
  last?: string;
}

const STAGE_NAMES: Record<Stage, string> = { 0: "site", 1: "foundations", 2: "half built", 3: "finished", 4: "finished" };
/** Each project's sign colour on its plot. */
const SIGN: Record<string, string> = { "grand-exhibition": TOY.blue, "grand-cathedral": TOY.purple, "grand-royal-train": "#7a1f2e", "grand-central": TOY.green, "grand-ferris-wheel": TOY.red };

export const PROJECTS: readonly Project[] = [
  {
    id: "grand-exhibition",
    name: "Grand Exhibition hall",
    tags: ["grand project", "exhibition", "glass", "iron", "hall"],
    notes: "A long hall of glass on green iron ribs with a taller transept and a porch with a clock lantern; on opening day, gates with a crest, a crystal fountain, statues, elms, stands and bunting. A grand project: stone and planks for the foundations, iron and bricks for the hall, an exhibit from each kind of city for the stands. Opening day brings the Royal Train.",
    build: exhibition,
    stages: 4,
    last: "opening day",
  },
  {
    id: "grand-cathedral",
    name: "Cathedral",
    tags: ["grand project", "cathedral", "spire", "church", "towers"],
    notes: "A tall stone nave with steep slate roofs, aisles held by flying buttresses, a transept, twin west towers with spires, a spire over the crossing and rose windows; its last stage puts in the stained glass. A grand project for a market city: stone by the trainload, bricks and timber for the roofs, then stained glass (glass from sand and coal, and paint). Its day: bells, a wedding and bunting in every town.",
    build: cathedral,
    stages: 4,
    last: "stained glass",
  },
  {
    id: "grand-royal-train",
    name: "Royal Train",
    tags: ["grand project", "royal", "train", "engine", "saloon", "gold"],
    notes: "An engine in royal claret lined out in gold with polished brass, a crowned saloon and an observation saloon, on a display track at the works (the cars themselves are car-ready: royal-train.ts). Built from iron, tools and furniture, then run through every city.",
    build: royalTrain,
    stages: 3,
  },
  {
    id: "grand-central",
    name: "Grand Central station",
    tags: ["grand project", "station", "clock tower", "train shed", "through station"],
    notes: "A through station: three tracks run through an arched glass train shed on green ironwork, platforms between them with canopies, benches and a departure board; alongside, a stone building with columns, a great arched entrance, the name in gold letters, flags, and a clock tower with four faces; cabs and lamps on the forecourt. A grand project for a big network: bricks, iron, stone and glass, and passengers carried. Its day: every line's trains meet under the clock.",
    build: grandCentral,
    stages: 3,
  },
  {
    id: "grand-ferris-wheel",
    name: "World's Fair wheel",
    tags: ["grand project", "ferris wheel", "fair", "funfair", "animated"],
    notes: "A tall wheel on red A-frames with twelve coloured gondolas that stay level as it turns, a ticket booth below. A grand project for a resort: iron and tools for the wheel, food and riders for the fair. Its day: crowds from every town, by train.",
    build: ferrisWheel,
    animate: turnWheel,
    stages: 3,
  },
];

/** Each project's stages, 0 (the plot) to its last. */
export const stagesOf = (p: Project): Stage[] => (p.stages === 4 ? [0, 1, 2, 3, 4] : [0, 1, 2, 3]);

export const ASSETS: Asset[] = PROJECTS.flatMap((p) =>
  stagesOf(p).map((stage): Asset => {
    const name = stage === p.stages && p.last ? p.last : STAGE_NAMES[stage];
    return {
      id: `${p.id}-${stage}`,
      name: `${p.name} (${name})`,
      trayLabel: stage === p.stages ? p.name : `${p.name.split(" ")[0]} ${stage}/${p.stages}`,
      category: p.id === "grand-royal-train" ? "Trains" : CAT,
      tags: [...p.tags, `stage ${stage}`],
      notes: stage === p.stages ? p.notes : stage === 0 ? `${p.name}'s plot, fenced off and marked out, before its first goods arrive.` : `${p.name}, ${name} (stage ${stage} of ${p.stages}): the building site as the goods arrive.`,
      build: (k: Kit) => (stage === 0 ? plot(k, SITES[p.id], SIGN[p.id]) : p.build(k, stage)),
      animate: stage >= 3 ? p.animate : undefined,
    };
  }),
);

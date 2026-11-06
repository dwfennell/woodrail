import { Group, type Object3D } from "three";
import { TOY, type Kit } from "../kit";
import type { Asset } from "../types";

/**
 * The Royal Train (design spec 2026-11-05, a grand project's reward): an engine in royal claret lined out in gold
 * with polished brass, and saloons with clerestory roofs, gilded panels and curtained windows, the last with an
 * observation balcony and the first with a crown on its roof. Car-ready code models, built as the game's code cars
 * are (`cold-van.ts`): facing +x, centred, standing on y = 0 at its wheels' feet, the engine 96 long and the saloons 88
 * (the engine's and the coach's lengths: `CAR_SPECS`), its four wheels under a node named `bogies`. So the game could run
 * them as looks of its engine and coach (a `royal` CarLook, `codeCarModel` in render/train-models.ts) without other
 * changes. Not hooked up: design only. `bare` builds them in plain beech (the build stage before the paint).
 */

export const ROYAL_ENGINE_LENGTH = 96;
export const ROYAL_SALOON_LENGTH = 88;
export const ROYAL_BOGIES = "bogies";

const CLARET = "#7a1f2e";
const GOLD = "#e3b23c";
const BRASS = "#d9a441";
const CREAM = "#f3ead6";
const CURTAIN = "#e98aa8";

interface Paints {
  claret: ReturnType<Kit["paint"]>;
  gold: ReturnType<Kit["paint"]>;
  brass: ReturnType<Kit["paint"]>;
  cream: ReturnType<Kit["paint"]>;
}
const paints = (k: Kit, bare: boolean): Paints =>
  bare ? { claret: k.wood, gold: k.wood, brass: k.wood, cream: k.wood } : { claret: k.paint(CLARET), gold: k.paint(GOLD), brass: k.paint(BRASS), cream: k.paint(CREAM) };

/** A flag on a short pole, its foot at (x, y, z). */
function flag(k: Kit, color: string, x: number, y: number, z: number): Group {
  const g = new Group();
  g.add(k.cyl(k.paint(BRASS), 0.7, 14, 0, 0, 0, 0.7, 6));
  g.add(k.box(k.paint(color), 8, 5, 0.6, 0, 4.4, 8.5, 0), k.box(k.paint(TOY.white), 8, 1.2, 0.8, 0, 4.4, 10.4, 0));
  return k.at(g, x, y, z);
}

/** The royal crest: a gold roundel with a crimson heart and a little crown, on a side facing ±z at z. */
function crest(k: Kit, x: number, y: number, z: number): Group {
  const g = new Group();
  g.add(k.cylZ(k.paint(GOLD), 5.2, 1, 0, 0, 0, 16), k.cylZ(k.paint("#b0283a"), 3.4, 1.4, 0, 0, 0, 12));
  g.add(k.box(k.paint(GOLD), 5, 2, 1.4, 0, 0, 5.4, 0));
  for (const dx of [-2, 0, 2]) g.add(k.box(k.paint(GOLD), 1, 1.6, 1.4, 0, dx, 7.4, 0));
  return k.at(g, x, y, z);
}

/** The engine, facing +x. */
export function buildRoyalEngine(k: Kit, bare = false): Group {
  const len = ROYAL_ENGINE_LENGTH;
  const p = paints(k, bare);
  const bogies = k.bogies(len, 20, bare ? "#c9a26b" : CLARET);
  bogies.name = ROYAL_BOGIES;
  const g = k.group(bogies, k.coupler(len, 1), k.coupler(len, -1));
  const black = k.paint(TOY.black);
  const deck = 12;
  g.add(k.box(black, len - 4, 5, 28, 1, 0, deck, 0));
  // Running plate lined in gold, the buffer beam in claret with brass buffers.
  g.add(k.box(p.gold, len - 6, 1.2, 30, 0.4, 0, deck + 5, 0));
  g.add(k.box(p.claret, 4, 9, 32, 1, len / 2 - 3, deck - 1, 0));
  for (const z of [-10, 10]) g.add(k.cylX(p.brass, 2.6, 5, len / 2 + 1.5, deck + 4, z, 12));
  // The boiler: claret, gold bands, a black smokebox with a brass door.
  const by = deck + 6 + 11;
  g.add(k.cylX(p.claret, 11, 48, 10, by, 0, 20));
  for (const bx of [-8, 8, 24]) g.add(k.cylX(p.gold, 11.5, 1.6, bx, by, 0, 20));
  g.add(k.cylX(black, 11.6, 10, 39, by, 0, 20), k.cylX(p.brass, 6, 1, 44.5, by, 0, 14));
  // Chimney with a brass cap, a polished brass dome and safety valves.
  g.add(k.cyl(black, 3.6, 11, 39, by + 9, 0, 4.2, 12), k.cyl(p.brass, 5, 2, 39, by + 19, 0, 4.2, 12));
  g.add(k.ball(p.brass, 6, 20, by + 10, 0, 0.85), k.cyl(p.brass, 2, 7, 4, by + 9, 0, 1.6, 8));
  // The headboard on the smokebox: cream lined in gold.
  g.add(k.box(p.gold, 2, 8, 24, 0.6, 44, by + 9, 0), k.box(p.cream, 2.4, 5.6, 21, 0.4, 44.4, by + 10.2, 0));
  // The cab: claret lined in gold, a crest each side, a cream roof with a gold edge.
  const cx = -28;
  g.add(k.box(p.claret, 28, 32, 30, 2, cx, deck + 5, 0));
  for (const s of [-1, 1]) {
    g.add(k.box(p.gold, 24, 18, 0.6, 0.3, cx, deck + 8, s * 15.1), k.box(p.claret, 22, 16, 0.8, 0.3, cx, deck + 9, s * 15.2));
    g.add(k.box(k.paint("#2b3644"), 10, 9, 1, 0.3, cx + 4, deck + 26, s * 15.2));
    if (!bare) g.add(crest(k, cx - 4, deck + 15, s * 15.8));
  }
  g.add(k.box(p.cream, 32, 3, 34, 1.2, cx, deck + 37, 0), k.box(p.gold, 33, 1.2, 35, 0.4, cx, deck + 36, 0));
  // Flags on the buffer beam.
  if (!bare) g.add(flag(k, "#b0283a", len / 2 - 2, deck + 8, -13), flag(k, "#2f5fb5", len / 2 - 2, deck + 8, 13));
  return g;
}

/** A saloon, facing +x: `crown` on its roof (the lead saloon), `balcony` at its back end (the last). */
export function buildRoyalSaloon(k: Kit, opts: { crown?: boolean; balcony?: boolean; bare?: boolean } = {}): Group {
  const len = ROYAL_SALOON_LENGTH;
  const p = paints(k, opts.bare ?? false);
  const bogies = k.bogies(len, 18, opts.bare ? "#c9a26b" : CLARET);
  bogies.name = ROYAL_BOGIES;
  const g = k.group(bogies, k.coupler(len, 1), k.coupler(len, -1));
  const deck = 12;
  g.add(k.box(k.paint(TOY.black), len - 4, 5, 28, 1, 0, deck, 0));
  const back = opts.balcony ? 14 : 0;
  const bl = len - 8 - back;
  const bx = back / 2;
  // The body: claret below with gilded panels, a cream window band with curtained windows.
  g.add(k.box(p.claret, bl, 15, 30, 2, bx, deck + 5, 0));
  g.add(k.box(p.cream, bl, 12, 30.2, 1, bx, deck + 20, 0));
  for (const s of [-1, 1]) {
    for (let i = 0; i < 4; i++) {
      const wx = bx - bl / 2 + 10 + i * ((bl - 20) / 3);
      g.add(k.box(p.gold, 12, 9, 0.6, 0, wx, deck + 8, s * 15.1));
      g.add(k.box(p.claret, 10, 7, 0.8, 0, wx, deck + 9, s * 15.2));
      g.add(k.box(k.paint("#2b3644"), 9, 8, 0.8, 0, wx, deck + 22, s * 15.3));
      if (!opts.bare) for (const d of [-1, 1]) g.add(k.box(k.paint(CURTAIN), 2.2, 8, 1, 0, wx + d * 3.6, deck + 22, s * 15.4));
    }
    g.add(k.box(p.gold, bl, 1.2, 0.6, 0, bx, deck + 19.5, s * 15.2));
    if (!opts.bare && !opts.balcony) g.add(crest(k, bx, deck + 9.5, s * 15.8));
  }
  // A clerestory roof: the cream roof, a raised middle with little windows, gold edges.
  g.add(k.box(p.cream, bl + 4, 3, 34, 1.2, bx, deck + 32, 0), k.box(p.gold, bl + 5, 1, 35, 0.3, bx, deck + 31.6, 0));
  g.add(k.box(p.claret, bl - 16, 5, 14, 1, bx, deck + 35, 0));
  for (const s of [-1, 1]) for (let i = 0; i < 5; i++) g.add(k.box(k.paint("#2b3644"), 5, 2.4, 0.6, 0, bx - (bl - 26) / 2 + i * ((bl - 26) / 4), deck + 36.4, s * 7.1));
  if (opts.balcony) {
    // The observation balcony: an open end with a gold rail and a canopy over it.
    const ex = -len / 2 + 4 + back / 2;
    g.add(k.box(p.claret, back, 2, 30, 0.6, ex, deck + 5, 0));
    for (const z of [-14, 14]) g.add(k.box(p.gold, back, 1.2, 1.2, 0, ex, deck + 14, z));
    g.add(k.box(p.gold, 1.2, 1.2, 28, 0, ex - back / 2 + 1, deck + 14, 0));
    for (const z of [-14, -5, 5, 14]) g.add(k.box(p.gold, 1, 8, 1, 0, ex - back / 2 + 1, deck + 7, z));
    g.add(k.box(p.cream, back + 2, 2, 34, 0.8, ex, deck + 32, 0));
    for (const z of [-14, 14]) g.add(k.box(p.gold, 1.2, 25, 1.2, 0, ex - back / 2 + 1, deck + 7, z));
  }
  if (opts.crown && !opts.bare) {
    const crown = new Group();
    crown.add(k.cyl(k.paint(GOLD), 7, 5, 0, 0, 0, 8, 12));
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      crown.add(k.ball(k.paint(GOLD), 1.8, Math.cos(a) * 7.4, 7, Math.sin(a) * 7.4));
    }
    crown.add(k.ball(k.paint("#b0283a"), 3.6, 0, 6, 0), k.box(k.paint(GOLD), 1.2, 5, 1.2, 0, 0, 9, 0));
    // (Set down into the clerestory a little: the car keeps under track a level up, `TRAIN_HEADROOM`.)
    g.add(k.at(crown, bx, deck + 37.5, 0));
  }
  return g;
}

/** A car's bogies (its four wheels). */
export function royalBogies(root: Object3D): Object3D {
  return root.getObjectByName(ROYAL_BOGIES)!;
}

export const ASSETS: Asset[] = [
  {
    id: "train-royal-engine",
    name: "Royal engine",
    category: "Trains",
    tags: ["royal", "engine", "steam", "claret", "gold", "brass"],
    notes: "An engine in royal claret lined out in gold, polished brass dome and buffers, a crest on the cab, a headboard and flags. The Grand Project's Royal Train: yours to run once it's built.",
    build: (k) => buildRoyalEngine(k),
  },
  {
    id: "train-royal-saloon",
    name: "Royal saloon",
    category: "Trains",
    tags: ["royal", "saloon", "coach", "clerestory", "crown"],
    notes: "A claret and cream saloon with a clerestory roof, gilded panels, curtained windows and a crown on its roof.",
    build: (k) => buildRoyalSaloon(k, { crown: true }),
  },
  {
    id: "train-royal-observation",
    name: "Royal observation saloon",
    category: "Trains",
    tags: ["royal", "saloon", "observation", "balcony"],
    notes: "The Royal Train's last saloon, with an open observation balcony and a gold rail at its back end.",
    build: (k) => buildRoyalSaloon(k, { balcony: true }),
  },
];

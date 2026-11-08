import { Group, type Object3D } from "three";
import { TOY, type Kit } from "../kit";
import type { Asset } from "../types";
import { boatFelt, flat, hullOutline } from "./boat-parts";

/**
 * Water transport (docs/superpowers/specs/2026-11-04-water-transport.md): the river tug and its barges, the cargo
 * ship, the train ferry, the river landing and the ferry slip. Wooden-toy boats at the trains' scale (a barge about a
 * wagon long), facing +x, standing on y = 0, on blue felt just round the hull. Docks run along x, land at −z (the
 * landing) or −x (the slip).
 */

const STONE = "#b9b2a6";
/** Loose stone in a barge: darker than the cut stone of a quay, so it reads as rock. */
const ROCK = "#8f8a82";
/** Iron ore: rust-red rock. */
const ORE = "#a4512f";
const BARK = "#8a5a32";
const LOG_END = "#d9b27c";
const COAL = "#2d2a28";
const GRAIN = "#e2c25a";
const HULL_GREEN = "#2d6b3f";
const NAVY = "#24456e";

// ——— Parts ———

/** A named pivot group at (x, y, z) holding `parts`. */
function pivot(name: string, x: number, y: number, z: number, ...parts: Object3D[]): Group {
  const g = new Group();
  g.name = name;
  g.position.set(x, y, z);
  for (const p of parts) g.add(p);
  return g;
}

/** The first descendant called `name`, found once and cached on the root (animate runs every frame). */
function part(root: Object3D, name: string): Object3D | undefined {
  const cache = (root.userData.waterParts ??= {}) as Record<string, Object3D | null>;
  if (!(name in cache)) cache[name] = root.getObjectByName(name) ?? null;
  return cache[name] ?? undefined;
}

/** A boat's gentle bob on the water (its "boat" pivot). */
function bob(root: Object3D, t: number, amount = 1): void {
  const b = part(root, "boat");
  if (!b) return;
  b.position.y = Math.sin(t * 1.6) * 0.5 * amount;
  b.rotation.x = Math.sin(t * 1.1) * 0.03 * amount;
  b.rotation.z = Math.sin(t * 1.3) * 0.02 * amount;
}

/**
 * A toy hull, `len` × `w`, `h` deep, its bow drawn in by `bow` (0 for a barge's blunt ends): a dark bottom band, a
 * painted band and a beech deck on top (at y = 0.4 + h).
 */
function hull(k: Kit, len: number, w: number, h: number, color: string, bottom: string, bow: number): Group {
  return k.group(
    flat(k, k.paint(bottom), hullOutline(len - 2, w - 2, bow), h * 0.35, 0.4),
    flat(k, k.paint(color), hullOutline(len, w, bow), h * 0.65, 0.4 + h * 0.35),
    flat(k, k.wood, hullOutline(len - 6, w - 6, bow), 1, 0.4 + h),
  );
}

/** A lifebuoy on a boat's or a quay's side, facing ±z. */
function buoy(k: Kit, x: number, y: number, z: number): Object3D {
  return k.ring(k.paint(TOY.red), 3, 1.1, x, y, z, true);
}

/** A mooring bollard (a black post with a round cap), its base on y. */
function bollard(k: Kit, x: number, y: number, z: number): Group {
  return k.group(k.cyl(k.paint(TOY.black), 2.2, 4, x, y, z, 2.2, 14), k.ball(k.paint(TOY.black), 2.6, x, y + 4.4, z, 0.6));
}

// ——— The river tug ———

const TUG_LEN = 70;
const TUG_W = 30;

function riverTug(k: Kit): Group {
  const deck = 10.4;
  const boat = pivot(
    "boat",
    0,
    0,
    0,
    hull(k, TUG_LEN, TUG_W, 10, TOY.red, TOY.black, 1),
    // A low cabin, so it passes under any bridge: cream walls, a window band, a red lid.
    k.box(k.paint(TOY.cream), 24, 9, 18, 2.5, 4, deck),
    k.box(k.glass, 24.6, 3.6, 18.6, 0.8, 4, deck + 4.4),
    k.box(k.paint(TOY.red), 28, 2.2, 22, 0.8, 4, deck + 9),
    // A stubby funnel with a red band.
    k.cyl(k.paint(TOY.black), 4.4, 10, -12, deck, 0, 4, 18),
    k.cyl(k.paint(TOY.red), 4.6, 2.6, -12, deck + 5, 0, 4.4, 18),
    // The towing post at the stern and the magnet that holds the first barge, as a train's coupler does.
    k.cyl(k.wood, 2.6, 6, -25, deck, 0, 2.2, 14),
    k.ball(k.wood, 3, -25, deck + 6.4, 0, 0.6),
    k.coupler(TUG_LEN, -1, 6),
    // A rope fender round the bow.
    k.cylZ(k.paint(TOY.brown), 3, 12, TUG_LEN / 2 - 1, 6, 0, 14),
    // A little flag at the stern.
    k.cyl(k.wood, 0.7, 14, -31, deck, 0, 0.7, 8),
    k.box(k.paint(TOY.yellow), 7, 5, 0.8, 0.3, -27.4, deck + 9, 0),
  );
  for (const x of [-16, -2, 12]) for (const s of [-1, 1]) boat.add(k.ring(k.paint(TOY.black), 2.6, 1.2, x, 6, s * (TUG_W / 2 - 0.6), true));
  return k.group(boatFelt(k, TUG_LEN, TUG_W, 1, 52), boat);
}

// ——— Barges ———

const BARGE_LEN = 88;
const BARGE_W = 34;
/** The top of a barge's hold floor, where its load sits. */
const HOLD = 13.4;

type BargeLoad = "empty" | "logs" | "stone" | "ore" | "coal" | "grain";

/** A heap of loose goods in the hold (coal, grain): two squashed mounds, as a hopper's heap. */
function heap(k: Kit, color: string): Group {
  const g = new Group();
  const mat = k.paint(color);
  for (const x of [-16, 16]) {
    const m = k.ball(mat, 15, x, HOLD - 1, 0, 0.42);
    m.scale.x = 1.3;
    g.add(m);
  }
  const top = k.ball(mat, 11, 0, HOLD + 1, 0, 0.5);
  top.scale.x = 1.8;
  g.add(top);
  return g;
}

function bargeLoad(k: Kit, load: BargeLoad): Object3D | null {
  switch (load) {
    case "logs": {
      const g = new Group();
      const r = 3.6;
      const rows: [number, number][] = [
        [-9, 0],
        [0, 0],
        [9, 0],
        [-4.5, 1],
        [4.5, 1],
        [0, 2],
      ];
      for (const [z, row] of rows) {
        const y = HOLD + r + row * r * 1.7;
        g.add(k.cylX(k.paint(BARK), r, 64, 0, y, z, 14));
        for (const s of [-1, 1]) g.add(k.cylX(k.paint(LOG_END), r - 0.6, 0.6, s * 32.2, y, z, 14));
      }
      return g;
    }
    case "stone":
    case "ore": {
      const g = new Group();
      const mat = k.paint(load === "ore" ? ORE : ROCK);
      const rocks: [number, number, number][] = [
        [-24, -7, 6],
        [-22, 7, 5],
        [-9, 0, 7],
        [5, -8, 5.5],
        [6, 6, 6.5],
        [20, -2, 6],
        [26, 9, 4.5],
        [-2, 10, 4],
        [14, -11, 4],
      ];
      for (const [x, z, r] of rocks) g.add(k.ball(mat, r, x, HOLD + r * 0.5, z, 0.7));
      return g;
    }
    case "coal":
      return heap(k, COAL);
    case "grain":
      return heap(k, GRAIN);
    default:
      return null;
  }
}

function barge(k: Kit, load: BargeLoad): Group {
  const top = 12.4;
  const boat = pivot(
    "boat",
    0,
    0,
    0,
    hull(k, BARGE_LEN, BARGE_W, 11, HULL_GREEN, TOY.black, 0),
    // The open hold: a dark floor inside a beech rim.
    flat(k, k.cut, hullOutline(BARGE_LEN - 14, BARGE_W - 12, 0), 0.8, top + 0.4),
    k.coupler(BARGE_LEN, 1, 6),
    k.coupler(BARGE_LEN, -1, 6),
  );
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) boat.add(bollard(k, sx * (BARGE_LEN / 2 - 5), top, sz * (BARGE_W / 2 - 4)));
  const goods = bargeLoad(k, load);
  if (goods) {
    goods.name = "load";
    boat.add(goods);
  }
  return k.group(boatFelt(k, BARGE_LEN, BARGE_W, 0, 56), boat);
}

// ——— The cargo ship ———

const SHIP_LEN = 240;
const SHIP_W = 56;

/** The cargo ship's hold: where its containers sit, between raised sides (x from the bridge to the forecastle). */
const HOLD_AFT = -76;
const HOLD_FORE = 96;
/** How high the ship's sides stand above its deck: the bottom tier of containers sits down inside them. */
const SIDES = 13;

function cargoShip(k: Kit): Group {
  const deck = 14.4;
  const holdLen = HOLD_FORE - HOLD_AFT;
  const holdMid = (HOLD_AFT + HOLD_FORE) / 2;
  const side = SHIP_W / 2 - 2.5;
  const boat = pivot(
    "boat",
    0,
    0,
    0,
    hull(k, SHIP_LEN, SHIP_W, 14, NAVY, TOY.red, 1),
    // The hold: a dark floor between raised navy sides, capped in white, and a raised forecastle at the bow that
    // closes it in front, so the containers stand down in the ship rather than on a flat deck.
    flat(k, k.cut, hullOutline(holdLen, SHIP_W - 8, 0), 0.8, deck),
    k.box(k.paint(NAVY), holdLen + 8, SIDES, 5, 1, holdMid, deck, -side),
    k.box(k.paint(NAVY), holdLen + 8, SIDES, 5, 1, holdMid, deck, side),
    k.box(k.paint(TOY.white), holdLen + 8, 2, 6, 0.8, holdMid, deck + SIDES, -side),
    k.box(k.paint(TOY.white), holdLen + 8, 2, 6, 0.8, holdMid, deck + SIDES, side),
    flat(k, k.paint(NAVY), hullOutline(SHIP_LEN / 2 - HOLD_FORE, SHIP_W - 14, 1.4), SIDES, deck, (HOLD_FORE + SHIP_LEN / 2) / 2 - 2, 0),
    flat(k, k.wood, hullOutline(SHIP_LEN / 2 - HOLD_FORE - 4, SHIP_W - 20, 1.4), 1, deck + SIDES, (HOLD_FORE + SHIP_LEN / 2) / 2 - 2, 0),
    k.box(k.paint(TOY.white), 4, SIDES + 2, SHIP_W - 8, 1, HOLD_FORE + 2, deck),
    // The bridge at the stern: two white storeys, a window band, the funnel behind.
    k.box(k.paint(TOY.white), 30, 22, 50, 2.5, -94, deck),
    k.box(k.paint(TOY.white), 24, 12, 44, 2.5, -94, deck + 22),
    k.box(k.glass, 24.6, 4.4, 44.6, 0.8, -94, deck + 28),
    k.box(k.paint(TOY.white), 8, 2, 56, 0.6, -88, deck + 34),
    k.cyl(k.paint(TOY.orange), 6, 22, -110, deck + 14, 0, 5.4, 18),
    k.cyl(k.paint(TOY.black), 5.6, 4, -110, deck + 36, 0, 5.6, 18),
    // A mast on the forecastle.
    k.cyl(k.wood, 1.4, 26, 106, deck + SIDES, 0, 1.2, 10),
    k.ball(k.paint(TOY.yellow), 2.4, 106, deck + SIDES + 27, 0),
  );
  // Cell guides: posts up the inside of the sides between the bays, which the containers slot between.
  for (let col = 0; col <= 6; col++) for (const s of [-1, 1]) boat.add(k.box(k.paint(TOY.white), 2, SIDES + 6, 2, 0.4, -72 + col * 28, deck, s * (side - 3.4)));
  const colours = [TOY.red, TOY.blue, TOY.yellow, TOY.green, TOY.orange, TOY.teal, TOY.purple, TOY.white];
  let c = 0;
  for (let col = 0; col < 6; col++) {
    for (const z of [-13, 0, 13]) {
      const layers = 2 + ((col + Math.round(z)) & 1);
      for (let l = 0; l < layers; l++) boat.add(k.box(k.paint(colours[c++ % colours.length]), 25, 11, 12, 1, -58 + col * 28, deck + 0.8 + l * 11.4, z));
    }
  }
  return k.group(boatFelt(k, SHIP_LEN, SHIP_W, 1, 140), boat);
}

// ——— The train ferry ———

const FERRY_LEN = 320;
const FERRY_W = 72;
/** The train deck's track: from the open stern to the buffer by the wheelhouse (room for an engine and two wagons). */
const FERRY_TRACK = 270;

function trainFerry(k: Kit): Group {
  const deck = 14.4;
  const trackX = -FERRY_LEN / 2 + FERRY_TRACK / 2 + 4;
  const fore = trackX + FERRY_TRACK / 2;
  const boat = pivot(
    "boat",
    0,
    0,
    0,
    hull(k, FERRY_LEN, FERRY_W, 14, TOY.white, TOY.red, 0.5),
    flat(k, k.paint(TOY.blue), hullOutline(FERRY_LEN + 1, FERRY_W + 1, 0.5), 3, 7),
    k.trackSlab(FERRY_TRACK, trackX, deck, 0),
    // White sides along the train deck, with lifebuoys.
    k.box(k.paint(TOY.white), FERRY_TRACK - 10, 8, 4, 1, trackX + 5, deck, -(FERRY_W / 2 - 4)),
    k.box(k.paint(TOY.white), FERRY_TRACK - 10, 8, 4, 1, trackX + 5, deck, FERRY_W / 2 - 4),
    buoy(k, trackX - 40, deck + 4, -(FERRY_W / 2 - 1.6)),
    buoy(k, trackX + 60, deck + 4, FERRY_W / 2 - 1.6),
    // A buffer at the track's end.
    k.box(k.paint(TOY.red), 6, 10, 36, 1, fore - 4, deck + 12),
    // The forecastle and a tall wheelhouse at the bow, standing over the train so the captain can see down the
    // deck, a yellow funnel behind it.
    k.box(k.paint(TOY.white), FERRY_LEN / 2 - fore - 6, 22, FERRY_W - 14, 2, (fore + FERRY_LEN / 2 - 6) / 2, deck),
    k.box(k.paint(TOY.cream), 26, 22, 50, 2.5, fore + 18, deck + 22),
    k.box(k.glass, 26.6, 6, 50.6, 0.8, fore + 18, deck + 33),
    k.box(k.paint(TOY.red), 30, 2.6, 58, 0.8, fore + 18, deck + 44),
    k.cyl(k.wood, 1, 18, fore + 18, deck + 46.6, 0, 1, 8),
    k.box(k.paint(TOY.red), 8, 5, 0.8, 0.3, fore + 22.4, deck + 58, 0),
    k.cyl(k.paint(TOY.yellow), 6, 30, fore + 2, deck + 22, 0, 5.4, 18),
    k.cyl(k.paint(TOY.black), 5.6, 4, fore + 2, deck + 52, 0, 5.6, 18),
  );
  // Yellow-and-black ends on the sides at the open stern, so you can see where trains roll on.
  for (const s of [-1, 1]) boat.add(k.box(k.paint(TOY.yellow), 6, 9, 4.6, 1, -FERRY_LEN / 2 + 8, deck, s * (FERRY_W / 2 - 4)));
  return k.group(boatFelt(k, FERRY_LEN, FERRY_W, 0.5, 0), boat);
}

// ——— The river landing ———

const LANDING_LEN = 216;
/** The landing's siding, on the land side (−z). */
const LANDING_TRACK_Z = -40;
/** The quay's top: level with the track's top. */
const QUAY = 12;

function landing(k: Kit): Group {
  const g = new Group();
  // Water by the jetty, for the catalogue's viewer only.
  const river = k.box(k.water, LANDING_LEN + 40, 1.2, 70, 0.6, 0, -0.4, 66);
  river.userData.underlay = true;
  g.add(river);
  g.add(k.trackSlab(LANDING_LEN, 0, 0, LANDING_TRACK_Z));
  // The quay: beech planks between the track and the water, a stone edge on the water side.
  g.add(k.box(k.wood, LANDING_LEN, QUAY, 46, 1.2, 0, 0, 3));
  for (const z of [-12, -3, 6, 15]) g.add(k.box(k.cut, LANDING_LEN - 2, 0.4, 0.8, 0, 0, QUAY, z));
  g.add(k.box(k.paint(STONE), LANDING_LEN, QUAY - 2, 5, 1, 0, 0, 28));
  // The jetty: planks on piles out over the water.
  g.add(k.box(k.wood, 76, 4, 34, 1, 12, QUAY - 4, 47));
  // (The kit's jetty: x −26 to 50, z 30 to 64; `kit-landing` in src/track/kits.ts stands its footprint there.)
  for (const x of [-22, 12, 46]) for (const z of [34, 60]) g.add(k.cyl(k.paint(TOY.brown), 2.6, QUAY - 4, x, 0, z, 2.6, 12));
  for (const x of [-20, 44]) g.add(bollard(k, x, QUAY, 61));
  for (const x of [-88, 96]) g.add(bollard(k, x, QUAY, 27));
  // A hand crane on the quay, its jib swung out over the jetty.
  const jib = pivot(
    "jib",
    -28,
    QUAY + 36,
    10,
    k.box(k.paint(TOY.yellow), 46, 3.4, 3.4, 0.8, 21, -1.7, 0),
    k.cyl(k.paint(TOY.black), 0.5, 16, 42, -18, 0, 0.5, 6),
    k.box(k.paint(TOY.orange), 6, 5, 6, 1, 42, -23, 0),
  );
  jib.rotation.y = -1.2;
  g.add(k.cyl(k.paint(TOY.red), 6, 5, -28, QUAY, 10, 5, 18), k.cyl(k.wood, 2.6, 34, -28, QUAY + 5, 10, 2.4, 14), jib);
  // A goods shed at the far end, a red roof.
  g.add(k.box(k.paint(TOY.cream), 36, 20, 26, 2, 70, QUAY, 4));
  g.add(k.roof(k.paint(TOY.red), 40, 30, 10, 70, QUAY + 20, 4));
  g.add(k.box(k.paint(TOY.brown), 12, 14, 1, 0.5, 70, QUAY, 17.6));
  // Goods waiting: crates and logs.
  g.add(k.box(k.paint(TOY.orange), 10, 9, 10, 1, -74, QUAY, 4), k.box(k.paint(TOY.blue), 10, 9, 10, 1, -74, QUAY, 15), k.box(k.paint(TOY.orange), 10, 8, 10, 1, -74, QUAY + 9, 9));
  for (const [z, y] of [
    [-4, 0],
    [4, 0],
    [0, 1],
  ] as const) g.add(k.cylX(k.paint(BARK), 3.4, 34, 6, QUAY + 3.4 + y * 5.8, z, 12));
  // A lifebuoy on its post, and a lamp.
  g.add(k.cyl(k.wood, 1.2, 16, -100, QUAY, 22, 1.2, 8), buoy(k, -100, QUAY + 12, 23.4));
  g.add(k.cyl(k.paint(TOY.black), 1, 30, 100, QUAY, 22, 1, 8), k.ball(k.paint(TOY.cream), 3, 100, QUAY + 32, 22));
  return g;
}

// ——— The ferry slip ———

const PIER_LEN = 150;

function ferrySlip(k: Kit): Group {
  const g = new Group();
  const sea = k.box(k.water, 130, 1.2, 150, 0.6, 100, -0.4, 0);
  sea.userData.underlay = true;
  g.add(sea);
  // The pier: a stone block carrying the track out to the water.
  const end = PIER_LEN / 2 - 20;
  g.add(k.box(k.paint(STONE), PIER_LEN, 12, 56, 1.5, -20, 0, 0));
  g.add(k.trackSlab(PIER_LEN, -20, 12, 0));
  // The link span: a hinged ramp of track that meets the ferry's deck, held by chains from a red frame.
  const span = pivot("span", end, 12, 0, k.trackSlab(60, 30, -2, 0), k.box(k.paint(TOY.yellow), 60, 6, 3, 0.8, 30, -2, -21.5), k.box(k.paint(TOY.yellow), 60, 6, 3, 0.8, 30, -2, 21.5));
  span.rotation.z = -0.03;
  g.add(span);
  for (const s of [-1, 1]) {
    g.add(k.box(k.paint(TOY.red), 6, 62, 6, 1, end + 52, 0, s * 34));
    g.add(k.cyl(k.paint(TOY.grey), 0.6, 44, end + 56, 16, s * 22, 0.6, 6));
  }
  g.add(k.box(k.paint(TOY.red), 8, 6, 76, 1, end + 52, 62, 0));
  // Dolphins: clusters of piles the ferry noses up to.
  for (const s of [-1, 1]) for (const [dx, dz] of [
    [0, 0],
    [5, 4],
    [5, -4],
  ] as const) {
    g.add(k.cyl(k.paint(TOY.brown), 3, 18, end + 74 + dx, 0, s * 44 + dz, 3, 12), k.cyl(k.paint(TOY.black), 3.1, 2, end + 74 + dx, 18, s * 44 + dz, 3.1, 12));
  }
  // The slip's hut beside the pier, and a red/green light for the trains.
  g.add(k.box(k.paint(STONE), 34, 12, 24, 1.5, -60, 0, -40));
  g.add(k.box(k.paint(TOY.cream), 22, 16, 18, 2, -60, 12, -40), k.roof(k.paint(TOY.blue), 26, 22, 8, -60, 28, -40), k.box(k.glass, 10, 6, 0.8, 0.4, -60, 18, -30.6));
  g.add(k.cyl(k.paint(TOY.black), 1, 30, end - 6, 12, 26, 1, 8), k.box(k.paint(TOY.black), 6, 12, 6, 1, end - 6, 40, 26));
  const red = k.ball(k.paint("#ff4a2e"), 1.8, end - 6, 49, 29.2);
  const green = k.ball(k.paint("#4dff7a"), 1.8, end - 6, 44, 29.2);
  red.name = "stop";
  green.name = "go";
  g.add(red, green);
  return g;
}

// ——— Yards: where boats are built ———

/** A yard's berth: where a hull being built lies, along its line, on cradles at the water's edge (z out from the line). */
export const YARD_BERTH = { boatyard: { x: 30, z: 52 }, shipyard: { x: 0, z: 66 } } as const;

/** Timber cradles and the greased ways a hull slides down sideways into the water (`len` along x, from z0 out to z1). */
function ways(k: Kit, x: number, len: number, z0: number, z1: number, top: number): Group {
  const g = new Group();
  const run = z1 - z0;
  const drop = top;
  const slope = Math.atan2(drop, run);
  for (const dx of [-len * 0.35, 0, len * 0.35]) {
    const plank = k.box(k.wood, 8, 3, Math.hypot(run, drop), 0.6, 0, 0, 0);
    plank.position.set(x + dx, top / 2, (z0 + z1) / 2);
    plank.rotation.x = slope;
    g.add(plank);
    // A cradle block under the hull, at the top of the ways.
    g.add(k.box(k.paint(TOY.brown), 10, 6, 12, 1, x + dx, top - 2, z0 + 6));
  }
  return g;
}

/** A yard's stacked goods: planks and iron bars waiting to go into a hull. */
function yardGoods(k: Kit, x: number, y: number, z: number): Group {
  const g = new Group();
  for (let i = 0; i < 4; i++) g.add(k.box(k.wood, 30, 2.6, 12, 0.4, x, y + i * 2.8, z));
  for (let i = 0; i < 3; i++) g.add(k.box(k.paint(TOY.grey), 22, 3, 4, 0.4, x + 22, y + i * 3.2, z - 4 + i * 4));
  return g;
}

function boatyard(k: Kit): Group {
  const g = landing(k);
  // (The landing's base: its siding, quay and jetty. Its shed and crates make way for the yard's own.)
  for (const c of [...g.children]) if (c.position.x > 40 && c.position.x < 100 && c.position.z > -10 && c.position.z < 25 && c.position.y >= QUAY) g.remove(c);
  const b = YARD_BERTH.boatyard;
  g.add(ways(k, b.x, 80, b.z - 18, b.z + 26, QUAY));
  // An open boat shed over the berth's back: posts and a red roof.
  for (const x of [b.x - 44, b.x + 44]) for (const z of [-14, 22]) g.add(k.cyl(k.wood, 1.8, 34, x, QUAY, z, 1.8, 10));
  g.add(k.roof(k.paint(TOY.red), 100, 44, 12, b.x, QUAY + 34, 4));
  g.add(yardGoods(k, -60, QUAY, 10));
  return g;
}

function shipyard(k: Kit): Group {
  const g = new Group();
  const sea = k.box(k.water, 260, 1.2, 90, 0.6, 0, -0.4, 110);
  sea.userData.underlay = true;
  g.add(sea);
  g.add(k.trackSlab(216, 0, 0, -40));
  // The yard: a wide stone quay, the ship's berth on its cradles at the water's edge.
  g.add(k.box(k.paint(STONE), 216, QUAY, 70, 1.5, 0, 0, 12));
  const b = YARD_BERTH.shipyard;
  g.add(ways(k, b.x, 220, b.z - 22, b.z + 40, QUAY));
  // A red gantry crane straddling the berth, its trolley over the hull.
  for (const x of [-110, 110]) for (const z of [20, 104]) g.add(k.box(k.paint(TOY.red), 6, 70, 6, 1, x, 0, z));
  for (const z of [20, 104]) g.add(k.box(k.paint(TOY.red), 226, 6, 6, 1, 0, 70, z));
  const trolley = pivot("trolley", 0, 76, 62, k.box(k.paint(TOY.yellow), 16, 8, 92, 1, 0, 0, 0), k.cyl(k.paint(TOY.black), 0.6, 30, 0, -30, 0, 0.6, 6), k.box(k.paint(TOY.orange), 8, 6, 8, 1, 0, -36, 0));
  g.add(trolley);
  // A brick shed at the back, and goods waiting.
  g.add(k.box(k.paint("#b5553a"), 50, 26, 22, 2, -70, QUAY, -8), k.roof(k.paint(TOY.grey), 54, 26, 10, -70, QUAY + 26, -8));
  g.add(yardGoods(k, 40, QUAY, -8));
  return g;
}

/** A hull being built (`stage` 0: a keel and its ribs; 1: planked, unpainted), `len` × `w`, lying along x. */
function hullFrame(k: Kit, len: number, w: number, h: number, stage: 0 | 1): Group {
  const g = new Group();
  g.add(k.box(k.paint(TOY.brown), len, 3, 6, 0.8, 0, 0, 0));
  const n = Math.round(len / 12);
  for (let i = 0; i <= n; i++) {
    const x = -len / 2 + (i * len) / n;
    const f = 1 - (Math.abs(x) / (len / 2)) ** 3 * (x > 0 ? 0.8 : 0.2);
    const half = (w / 2) * f;
    for (const s of [-1, 1]) g.add(k.box(k.wood, 2.4, h, 2.4, 0.4, x, 2, s * half));
    g.add(k.box(k.wood, 2.4, 2, half * 2, 0.4, x, 2, 0));
  }
  // Scaffolding poles at the corners.
  for (const s of [-1, 1]) for (const x of [-len / 2 - 6, len / 2 + 6]) g.add(k.cyl(k.wood, 1, h + 14, x, 0, s * (w / 2 + 6), 1, 8));
  if (stage === 1) g.add(flat(k, k.wood, hullOutline(len, w, 1), h * 0.7, 2));
  return g;
}

// ——— The assets ———

const BARGES: [BargeLoad, string, string][] = [
  ["empty", "Barge", "An open river barge with magnet couplers at both ends, as a wagon has: a tug pulls up to three, four loads each."],
  ["logs", "Barge of logs", "A barge with logs from a riverside forest, on its way to the sawmill's landing."],
  ["stone", "Barge of stone", "A barge heaped with stone from the quarry."],
  ["ore", "Barge of ore", "A barge of rust-red iron ore from the mine, for the foundry."],
  ["coal", "Barge of coal", "A barge heaped with coal, as a hopper is."],
  ["grain", "Barge of grain", "A barge heaped with grain for the mill."],
];

export const ASSETS: Asset[] = [
  {
    id: "water-river-tug",
    name: "River tug",
    category: "Vehicles",
    tags: ["tug", "boat", "river", "barge", "tow", "water"],
    notes: "A low red tug, low enough for any bridge, with a towing post and a magnet at the stern for its barges. The player buys one at a landing and gives it a route, as a train.",
    build: riverTug,
    // (Boats are looked at close: their hulls round.)
    detail: 1,
    animate: (root, t) => bob(root, t, 1),
  },
  ...BARGES.map(([load, name, notes]): Asset => ({
    id: load === "empty" ? "water-barge" : `water-barge-${load}`,
    name,
    category: "Vehicles",
    tags: ["barge", "boat", "river", "water", ...(load === "empty" ? [] : [load])],
    notes,
    build: (k) => barge(k, load),
    animate: (root, t) => bob(root, t, 0.6),
  })),
  {
    id: "water-cargo-ship",
    name: "Cargo ship",
    category: "Vehicles",
    tags: ["ship", "cargo", "containers", "harbour", "sea", "water"],
    notes: "A big navy ship stacked with containers, about as long as a train. It calls at a harbour by the sea, takes 24 loads and pays a town's full price for them.",
    build: cargoShip,
    detail: 1,
    animate: (root, t) => bob(root, t, 0.3),
  },
  {
    id: "water-train-ferry",
    name: "Train ferry",
    category: "Vehicles",
    tags: ["ferry", "train", "ship", "sea", "abroad", "water"],
    notes: "A white ferry with track on its deck for an engine and two wagons, its wheelhouse at the bow. A train rolls on at the slip and goes abroad.",
    build: trainFerry,
    detail: 1,
    animate: (root, t) => bob(root, t, 0.35),
  },
  {
    id: "water-landing",
    name: "River landing",
    category: "Stations & buildings",
    tags: ["landing", "jetty", "quay", "river", "barge", "crane", "water"],
    notes: "A siding beside a plank quay and a jetty on piles, a hand crane and a goods shed: trains and barges leave goods here for each other.",
    build: landing,
    animate: (root, t) => {
      const j = part(root, "jib");
      if (j) j.rotation.y = -1.2 + Math.sin(t * 0.4) * 0.5;
    },
  },
  {
    id: "water-boatyard",
    name: "Boatyard",
    category: "Stations & buildings",
    tags: ["boatyard", "slipway", "river", "tug", "barge", "water"],
    notes: "A riverside yard with a siding, an open boat shed and greased ways down to the water: trains bring it planks and iron, and tugs and barges are built there and slide into the river.",
    build: boatyard,
  },
  {
    id: "water-shipyard",
    name: "Shipyard",
    category: "Stations & buildings",
    tags: ["shipyard", "slipway", "sea", "ship", "ferry", "gantry", "water"],
    notes: "A seaside yard with a red gantry crane over a long berth: trains bring it iron, planks and tools, and cargo ships and ferries are built there and launched sideways into the sea.",
    build: shipyard,
    animate: (root, t) => {
      const tr = part(root, "trolley");
      if (tr) tr.position.x = Math.sin(t * 0.3) * 60;
    },
  },
  {
    id: "water-tug-frame",
    name: "Tug being built",
    category: "Vehicles",
    tags: ["tug", "hull", "frame", "boatyard", "water"],
    notes: "A tug's keel and ribs on the boatyard's ways: half built.",
    build: (k) => hullFrame(k, TUG_LEN, TUG_W, 10, 0),
  },
  {
    id: "water-tug-planked",
    name: "Tug, planked",
    category: "Vehicles",
    tags: ["tug", "hull", "boatyard", "water"],
    notes: "A tug's hull planked, nearly done: next it's painted and slides into the river.",
    build: (k) => hullFrame(k, TUG_LEN, TUG_W, 10, 1),
  },
  {
    id: "water-ship-frame",
    name: "Ship being built",
    category: "Vehicles",
    tags: ["ship", "hull", "frame", "shipyard", "water"],
    notes: "A cargo ship's keel and ribs on the shipyard's ways, under the gantry: half built.",
    build: (k) => hullFrame(k, SHIP_LEN, SHIP_W, 16, 0),
  },
  {
    id: "water-ship-planked",
    name: "Ship, planked",
    category: "Vehicles",
    tags: ["ship", "hull", "shipyard", "water"],
    notes: "A ship's hull planked, nearly done: next it's painted and launched sideways into the sea.",
    build: (k) => hullFrame(k, SHIP_LEN, SHIP_W, 16, 1),
  },
  {
    id: "water-ferry-slip",
    name: "Ferry slip",
    category: "Mechanisms",
    tags: ["ferry", "slip", "pier", "ramp", "sea", "water"],
    notes: "A stone pier carrying the track out to sea and a hinged ramp held by chains from a red frame: the train ferry ties up at its end.",
    build: ferrySlip,
    animate: (root, t) => {
      const s = part(root, "span");
      if (s) s.rotation.z = -0.03 + Math.sin(t * 0.8) * 0.01;
      const on = (t * 0.25) % 1 < 0.5;
      const r = part(root, "stop");
      const g = part(root, "go");
      if (r) r.visible = on;
      if (g) g.visible = !on;
    },
  },
];

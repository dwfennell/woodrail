import { Group, type Object3D } from "three";
import { TOY, type Kit } from "../kit";
import { named, pennant, stick } from "../build-parts";
import type { Asset } from "../types";

/** Glass as the toys paint it: a pale sky-blue lacquer (the game's glass material draws dark in the props' batches). */
const GLASS = "#bcdcea";

/**
 * The landmarks of the town paths (design spec 2026-11-05, part 1): the building a city puts up when it settles on
 * its path. Each is about two hill blocks across, a little bigger than the town hall, so it reads as the town's own.
 * Not in Game mode: on Sandbox's Buildings tab only.
 */

const CAT = "Stations & buildings" as const;

// ——— Industrial city: the engine works ———

function engineWorks(k: Kit): Object3D {
  const g = new Group();
  const pane = k.paint(GLASS);
  const brick = k.paint("#a84a34");
  const dark = k.paint("#5b5f66");
  g.add(k.box(k.paint("#9b958a"), 150, 3, 110, 0.6, 0, 0, 0));
  // The erecting shop: a long brick hall with a saw-tooth roof of north lights.
  g.add(k.box(brick, 120, 40, 80, 1.5, -10, 3, 0));
  for (let i = 0; i < 5; i++) {
    const tooth = k.extrude(dark, [[0, 0], [24, 0], [24, 16]], 80, 0, 0, 0, 0.4);
    tooth.position.set(-70 + i * 24, 43, 0);
    g.add(tooth);
    g.add(k.box(pane, 1, 15, 78, 0, -46 + i * 24 - 0.6, 43, 0));
  }
  // Big arched doors at the front (+x), a track running in.
  for (const z of [-20, 20]) {
    g.add(k.box(k.cut, 1, 26, 26, 0, 50.6, 3, z));
    g.add(k.at(k.ring(k.paint(TOY.cream), 13, 1.6, 0, 0, 0, true, Math.PI), 50.8, 29, z, Math.PI / 2));
    g.add(k.trackSlab(40, 70, 3, z));
  }
  // A tall chimney with bands, a water tank on legs.
  g.add(k.cyl(brick, 9, 120, -60, 3, -46, 6.5, 14));
  for (const y of [40, 80, 118]) g.add(k.cyl(dark, 8.5 - y / 40, 3, -60, 3 + y, -46, 8.5 - y / 40, 14));
  for (const [x, z] of [[-6, -6], [6, -6], [-6, 6], [6, 6]]) g.add(stick(k, dark, 2.4, 30, 2.4, 52 + x, 3, -44 + z));
  g.add(k.box(k.paint(TOY.green), 22, 14, 22, 1.5, 52, 33, -44));
  // An engine on show by the door, and the works' name board.
  g.add(k.box(k.paint(TOY.cream), 3, 8, 70, 1, 51, 46, 0), k.box(k.paint(TOY.red), 3.6, 4, 60, 0.6, 51, 48, 0));
  const engine = new Group();
  engine.add(k.cylX(k.paint(TOY.green), 9, 40, 4, 18, 0, 16), k.box(k.paint(TOY.green), 16, 22, 24, 1.5, -20, 6, 0));
  engine.add(k.cyl(k.paint(TOY.black), 3.5, 10, 20, 24, 0, 4.5, 10));
  for (const x of [-14, 4, 18]) for (const z of [-10, 10]) engine.add(k.cylZ(k.paint(TOY.red), 6, 3, x, 7, z, 12));
  g.add(k.at(engine, 84, 3, 20));
  return g;
}

// ——— Market town: the guildhall over its market ———

function guildhall(k: Kit): Object3D {
  const g = new Group();
  const timber = k.paint("#5a3a22");
  const plaster = k.paint(TOY.cream);
  g.add(k.box(k.paint("#d9cdb6"), 130, 2, 110, 0.4, 0, 0, 0));
  // Stone pillars hold up the hall; the market's under it.
  for (const x of [-40, -13, 13, 40]) for (const z of [-26, 26]) g.add(k.cyl(k.paint("#c4b9a4"), 4, 26, x, 2, z, 4, 10));
  g.add(k.box(timber, 92, 4, 62, 1, 0, 28, 0));
  // The hall: cream plaster, dark beams, a jettied upper floor.
  g.add(k.box(plaster, 88, 26, 58, 1, 0, 32, 0));
  for (const s of [-1, 1]) {
    for (let i = 0; i < 7; i++) g.add(stick(k, timber, 3, 26, 1.4, -42 + i * 14, 32, s * 29.4));
    const brace = stick(k, timber, 2, 30, 1.4, 0, 0, 0);
    brace.position.set(-28, 45, s * 29.6);
    brace.rotation.z = 0.8;
    g.add(brace);
    g.add(stick(k, timber, 88, 2.4, 1.4, 0, 44, s * 29.4));
    for (let i = 0; i < 3; i++) g.add(k.box(k.paint("#3d5d86"), 9, 9, 1, 0, -22 + i * 22, 37, s * 29.8));
  }
  for (const s of [-1, 1]) for (let i = 0; i < 4; i++) g.add(stick(k, timber, 1.4, 26, 3, s * 44.4, 32, -21 + i * 14));
  g.add(k.roof(k.paint(TOY.red), 96, 64, 28, 0, 58, 0, 3));
  // A clock cupola on the ridge.
  g.add(k.box(plaster, 14, 16, 14, 1, 0, 78, 0), k.cone(k.paint(TOY.green), 11, 18, 0, 94, 0, 8), k.ball(k.paint(TOY.yellow), 2.4, 0, 113, 0));
  g.add(k.cylX(k.paint(TOY.white), 5, 1, 7.4, 86, 0, 14));
  // Market stalls under it and out front, with striped awnings.
  const colors = [TOY.red, TOY.blue, TOY.green, TOY.yellow];
  [[-26, 0], [0, 0], [26, 0], [56, -30], [56, 30]].forEach(([x, z], i) => {
    g.add(k.box(k.wood, 16, 8, 10, 0.6, x, 2, z));
    g.add(k.box(k.paint(colors[i % colors.length]), 18, 1.4, 13, 0.4, x, 18, z), stick(k, k.wood, 1, 8, 1, x - 8, 10, z - 5), stick(k, k.wood, 1, 8, 1, x + 8, 10, z - 5));
    g.add(k.ball(k.paint(i % 2 ? TOY.orange : TOY.leaf), 2.4, x - 3, 11, z), k.ball(k.paint(TOY.red), 2.4, x + 3, 11, z));
  });
  // The market cross.
  g.add(k.cyl(k.paint("#c4b9a4"), 6, 4, 50, 2, 0, 8, 8), k.cyl(k.paint("#c4b9a4"), 2.4, 30, 50, 6, 0, 2, 8), k.box(k.paint("#c4b9a4"), 2.4, 2.4, 12, 0, 50, 30, 0));
  g.add(k.peg(TOY.purple, null, 40, 2, 14), k.peg(TOY.orange, TOY.green, 62, 2, -10));
  return g;
}

// ——— Seaside resort: the pier, its pavilion and a helter-skelter ———

function pier(k: Kit): Object3D {
  const g = new Group();
  const deck = k.paint("#c9a26b");
  const white = k.paint(TOY.white);
  // Water under the pier, for the catalogue only (in the game it stands out over the real sea).
  const sea = k.box(k.water, 230, 1, 90, 0, 60, 0, 0);
  sea.userData.underlay = true;
  g.add(sea);
  // The promenade end on land, the deck out over the water (+x) on legs.
  g.add(k.box(k.paint("#e3cf9a"), 40, 4, 80, 1, -60, 0, 0));
  g.add(k.box(deck, 200, 3, 22, 0.6, 30, 18, 0));
  for (let i = 0; i < 8; i++) for (const z of [-9, 9]) g.add(k.cyl(white, 1.6, 18, -40 + i * 26, 0, z, 1.6, 8));
  for (const z of [-11, 11]) g.add(stick(k, white, 196, 1.2, 1, 30, 26, z));
  for (let i = 0; i < 6; i++) for (const z of [-11, 11]) {
    g.add(k.cyl(k.paint(TOY.black), 0.8, 18, -36 + i * 34, 21, z, 0.8, 6), k.ball(k.paint(TOY.cream), 2, -36 + i * 34, 40, z));
  }
  // The pavilion at the end: a white hall, a green onion dome, flags.
  const px = 118;
  g.add(k.box(deck, 50, 3, 56, 1, px, 18, 0));
  for (const z of [-20, 20]) g.add(k.cyl(white, 2, 18, px, 0, z, 2, 8));
  g.add(k.box(white, 40, 24, 46, 1.5, px, 21, 0));
  for (let i = 0; i < 4; i++) for (const s of [-1, 1]) g.add(k.box(k.paint(TOY.sky), 7, 12, 1, 0, px - 14 + i * 9.4, 28, s * 23.2));
  g.add(k.lathe(k.paint(TOY.teal), [[0.1, 0], [16, 0], [18, 6], [15, 14], [8, 22], [2, 28], [0.1, 30]], px, 45, 0, 16));
  g.add(pennant(k, TOY.red, 18, px, 75, 0));
  for (const z of [-22, 22]) g.add(k.cone(k.paint(TOY.teal), 5, 12, px + 18, 45, z, 8));
  // The helter-skelter on the promenade, striped red and white.
  const hx = -64;
  for (let i = 0; i < 7; i++) g.add(k.cyl(k.paint(i % 2 ? TOY.white : TOY.red), 11 - i * 0.6, 9, hx, 4 + i * 9, -18, 11 - (i + 1) * 0.6, 12));
  g.add(k.cone(k.paint(TOY.red), 10, 14, hx, 67, -18, 12), pennant(k, TOY.yellow, 10, hx, 80, -18));
  for (let i = 0; i < 14; i++) {
    const a = i * 0.9;
    const slide = k.box(k.paint(TOY.yellow), 10, 1.2, 6, 0.3, 0, 0, 0);
    slide.position.set(hx + Math.cos(a) * 13, 60 - i * 4, -18 + Math.sin(a) * 13);
    slide.rotation.y = -a;
    g.add(slide);
  }
  // Bathing huts on the sand.
  [TOY.blue, TOY.yellow, TOY.pink, TOY.green].forEach((c, i) => {
    g.add(k.box(k.paint(c), 10, 14, 10, 1, -70 + i * 13, 4, 26), k.roof(k.paint(TOY.white), 12, 12, 5, -70 + i * 13, 18, 26, 1.2));
  });
  return g;
}

// ——— University city: the observatory ———

function observatory(k: Kit): Object3D {
  const g = new Group();
  const stone = k.paint("#e2d8c4");
  g.add(k.box(k.paint("#79a858"), 140, 2, 110, 0.4, 0, 0, 0));
  // A stone hall with a columned portico at the front (+x).
  g.add(k.box(stone, 80, 36, 70, 1.5, -10, 2, 0));
  g.add(k.box(stone, 20, 4, 60, 1, 38, 2, 0));
  for (let i = 0; i < 6; i++) g.add(k.cyl(k.paint(TOY.white), 3, 30, 44, 6, -25 + i * 10, 3, 10));
  g.add(k.extrude(stone, [[-34, 0], [34, 0], [0, 14]], 22, 0, 0, 0, 0.6).rotateY(Math.PI / 2).translateY(36).translateZ(38));
  for (let i = 0; i < 4; i++) for (const s of [-1, 1]) g.add(k.box(k.paint("#3d5d86"), 10, 14, 1, 0, -38 + i * 18, 14, s * 35.4));
  // The dome, turned a little, its slit open and the telescope out of it.
  const dome = named(new Group(), "dome");
  dome.add(k.ball(k.paint(TOY.white), 28, 0, 0, 0, 1));
  // The shutter slit: a dark strip over the dome's crown, down its front.
  const slit = k.box(k.cut, 34, 3, 9, 0, 0, 0, 0);
  slit.position.set(8, 25, 0);
  slit.rotation.z = -0.45;
  dome.add(slit);
  const scope = k.cylX(k.paint(TOY.blue), 4, 44, 0, 0, 0, 12);
  scope.rotation.z = 0.7;
  scope.position.set(10, 16, 0);
  dome.add(scope, k.cylX(k.paint(TOY.yellow), 4.6, 3, 26, 30, 0, 12).rotateZ(0.7));
  g.add(k.cyl(stone, 30, 8, -10, 38, 0, 30, 20));
  g.add(k.at(dome, -10, 46, 0));
  // A clock-tower gate to the quad, a scholar or two.
  g.add(k.box(k.paint("#b5553c"), 16, 60, 16, 1, 30, 2, -48), k.cone(k.paint("#4f6a8a"), 12, 18, 30, 62, -48, 4).rotateY(Math.PI / 4));
  g.add(k.cylX(k.paint(TOY.white), 5, 1, 38.4, 50, -48, 14));
  g.add(k.peg(TOY.black, TOY.black, 56, 2, 10), k.peg(TOY.purple, TOY.black, 60, 2, -6));
  return g;
}

// ——— Port city: the customs house and harbour-master's tower ———

function customsHouse(k: Kit): Object3D {
  const g = new Group();
  const pane = k.paint(GLASS);
  const pale = k.paint("#eadfca");
  g.add(k.box(k.paint("#b9b2a5"), 150, 4, 110, 0.6, 0, 0, 0));
  // The customs house: a long front with a pediment and a clock.
  g.add(k.box(pale, 90, 40, 50, 1.5, -20, 4, -20));
  g.add(k.roof(k.paint("#4f6a8a"), 94, 54, 14, -20, 44, -20, 2.5));
  g.add(k.extrude(pale, [[-20, 0], [20, 0], [0, 12]], 4, 0, 0, 0, 0.4).rotateY(Math.PI / 2).translateY(44).translateZ(25.5).translateX(20));
  for (let i = 0; i < 5; i++) g.add(k.box(k.paint("#3d5d86"), 1, 14, 9, 0, 25.6, 22, -50 + i * 15));
  g.add(k.box(k.paint(TOY.green), 1, 18, 12, 0, 25.6, 4, -20));
  // The harbour master's tower: striped, with a lantern room.
  const tx = 30;
  const tz = 32;
  for (let i = 0; i < 5; i++) g.add(k.cyl(k.paint(i % 2 ? TOY.white : TOY.red), 13 - i * 0.8, 16, tx, 4 + i * 16, tz, 13 - (i + 1) * 0.8, 14));
  g.add(k.cyl(k.paint(TOY.black), 11, 2, tx, 84, tz, 11, 14), k.cyl(pane, 8, 12, tx, 86, tz, 8, 12), k.ball(k.paint(TOY.yellow), 4, tx, 92, tz));
  g.add(k.cone(k.paint(TOY.red), 10, 10, tx, 98, tz, 12));
  // The quay's edge: bollards, an anchor on a plinth, a jib crane with a crate.
  for (let i = 0; i < 5; i++) g.add(k.cyl(k.paint(TOY.black), 2.6, 6, 70, 4, -46 + i * 20, 3, 10));
  g.add(k.box(k.paint("#c4b9a4"), 16, 8, 16, 1, -50, 4, 34));
  const anchor = new Group();
  anchor.add(stick(k, k.paint(TOY.black), 3, 26, 3, 0, 0, 0), stick(k, k.paint(TOY.black), 16, 3, 3, 0, 20, 0));
  anchor.add(k.at(k.ring(k.paint(TOY.black), 10, 1.6, 0, 0, 0, true, Math.PI), 0, 6, 0, 0).rotateZ(Math.PI));
  anchor.add(k.ring(k.paint(TOY.black), 3, 1, 0, 28, 0, true));
  g.add(k.at(anchor, -50, 12, 34));
  const crane = new Group();
  crane.add(k.cyl(k.paint(TOY.yellow), 3, 40, 0, 0, 0, 3, 10));
  const jib = stick(k, k.paint(TOY.yellow), 40, 3, 3, 0, 0, 0);
  jib.position.set(16, 46, 0);
  jib.rotation.z = 0.35;
  crane.add(jib, stick(k, k.metal, 0.6, 20, 0.6, 34, 34, 0), k.box(k.paint(TOY.brown), 10, 8, 10, 1, 34, 26, 0));
  g.add(k.at(crane, 56, 4, 40));
  g.add(pennant(k, TOY.blue, 24, -20, 58, -20));
  g.add(k.peg(TOY.blue, TOY.black, 46, 4, -10), k.peg(TOY.cream, TOY.blue, 50, 4, 8));
  return g;
}

export const ASSETS: Asset[] = [
  {
    id: "path-engine-works",
    name: "Engine works",
    category: CAT,
    tags: ["town path", "industrial", "works", "chimney", "landmark"],
    notes: "A brick erecting shop with a saw-tooth roof, a tall chimney and an engine on show by the doors. An industrial city's landmark: industries near it work faster, and it builds the Royal Train.",
    build: engineWorks,
  },
  {
    id: "path-guildhall",
    name: "Guildhall and market",
    category: CAT,
    tags: ["town path", "market", "guildhall", "stalls", "landmark"],
    notes: "A timber-framed hall on stone pillars with the market under it, a clock cupola and a market cross. A market town's landmark: it pays more for food and every train brings more riders.",
    build: guildhall,
  },
  {
    id: "path-pier",
    name: "Pier and pavilion",
    category: CAT,
    tags: ["town path", "resort", "pier", "seaside", "helter-skelter", "landmark"],
    notes: "A pier on white legs out over the sea, a pavilion with a green dome at its end, a helter-skelter and bathing huts. A resort's landmark: summer crowds come by train.",
    build: pier,
  },
  {
    id: "path-observatory",
    name: "Observatory",
    category: CAT,
    tags: ["town path", "university", "observatory", "dome", "telescope", "landmark"],
    notes: "A stone hall with a portico, a white dome with its telescope out, and a clock-tower gate. A university city's landmark: research goes faster on every school on the map.",
    build: observatory,
  },
  {
    id: "path-customs-house",
    name: "Customs house",
    category: CAT,
    tags: ["town path", "port", "harbour", "customs", "lighthouse", "landmark"],
    notes: "A pale customs house with a pediment, a striped harbour master's tower with a lantern, bollards, an anchor and a jib crane. A port city's landmark: better prices with the boats, and the way to goods from abroad.",
    build: customsHouse,
  },
];

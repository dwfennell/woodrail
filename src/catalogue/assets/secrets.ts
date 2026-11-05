import { Group, Shape, type Object3D } from "three";
import { TOY, type Kit } from "../kit";
import { bushes, pennant, sitePaint, stick } from "../build-parts";
import type { Asset } from "../types";

/**
 * Secret sites (design spec 2026-11-05, part 3): hidden places found by laying track to them, as ruins are. Each is one
 * builder over `found`: before, dulled to a mossy grey and grown over; after, in its own colours with what you found
 * (a cart of gold, a flag on the tower, a boat at the jetty). Registered as `secret-<name>-hidden` and `secret-<name>`,
 * so the game can swap a placed prop's asset when it's found. Not in Game mode: on Sandbox's Nature tab only.
 */

const CAT = "Scenery" as const;

// ——— The lost mine: an adit in a rock face, a cart on rails ———

function lostMine(k: Kit, found: boolean): Object3D {
  const g = new Group();
  const { paint, wood } = sitePaint(k, found);
  const rock = paint("#9a9488");
  // The rock face behind (stepped blocks), the adit cut in it.
  g.add(k.box(rock, 70, 54, 40, 4, -30, 0, 0), k.box(rock, 50, 30, 30, 4, -36, 54, -4), k.box(paint("#857f73"), 40, 40, 26, 4, -24, 0, 34));
  g.add(k.box(rock, 46, 36, 30, 4, -28, 0, -34));
  g.add(k.box(k.cut, 4, 30, 22, 0, 5.5, 0, 0));
  for (const z of [-12, 12]) g.add(stick(k, wood, 4, 32, 4, 7, 0, z));
  g.add(stick(k, wood, 5, 5, 30, 7, 32, 0));
  // Rails out of the adit.
  for (const z of [-5, 5]) g.add(stick(k, paint(TOY.grey), 60, 1.4, 1.4, 34, 1, z));
  for (let i = 0; i < 6; i++) g.add(stick(k, wood, 3, 1, 16, 10 + i * 10, 0, 0));
  if (found) {
    // A cart full of gold at the mouth, a lamp lit, a sign.
    const cart = new Group();
    cart.add(k.box(k.paint(TOY.red), 18, 10, 14, 1.5, 0, 4, 0));
    for (const x of [-5, 5]) for (const z of [-6, 6]) cart.add(k.cylZ(k.paint(TOY.black), 3, 2, x, 3, z, 10));
    for (let i = 0; i < 6; i++) cart.add(k.ball(k.paint(TOY.yellow), 3.2, -5 + (i % 3) * 5, 15, -3 + Math.floor(i / 3) * 6));
    g.add(k.at(cart, 30, 0, 0));
    g.add(k.cyl(k.paint(TOY.black), 1, 22, 10, 0, 18, 1, 6), k.ball(k.paint(TOY.yellow), 3, 10, 24, 18));
    g.add(k.box(wood, 2, 10, 20, 0.6, 18, 34, 0), k.box(k.paint(TOY.cream), 2.4, 6, 16, 0.4, 18, 36, 0));
    g.add(pennant(k, TOY.yellow, 26, -34, 84, -4));
  } else {
    // Boarded up and grown over.
    for (const y of [6, 16, 24]) g.add(stick(k, wood, 2, 4, 26, 9, y, 0));
    g.add(bushes(k, 9, 26, 20, 4, 3));
    g.add(bushes(k, 5, 18, -20, 30, 7));
  }
  return g;
}

// ——— The ruined castle on its mound ———

function castle(k: Kit, found: boolean): Object3D {
  const g = new Group();
  const { paint } = sitePaint(k, found);
  const stone = paint("#c4b9a4");
  const dark = paint("#a59a85");
  g.add(k.cyl(paint("#6b9a4c"), 96, 16, 0, 0, 0, 80, 16));
  const y = 16;
  // Broken curtain walls (some gone), with merlons on what's left.
  const walls: [number, number, number, number, number][] = [
    [0, -60, 110, 34, 0],
    [-56, 0, 80, 26, Math.PI / 2],
    [56, 22, 50, 30, Math.PI / 2],
  ];
  for (const [x, z, len, h, ry] of walls) {
    const w = new Group();
    w.add(k.box(stone, len, h, 10, 1, 0, 0, 0));
    for (let i = 0; i < Math.floor(len / 14); i++) if (i % 3 !== 2) w.add(k.box(stone, 7, 7, 10, 0.8, -len / 2 + 7 + i * 14, h, 0));
    g.add(k.at(w, x, y, z, ry));
  }
  // Two round towers, one standing tall, one broken.
  g.add(k.cyl(dark, 20, 86, -50, y, -54, 20, 14), k.cyl(dark, 18, 40, 50, y, -54, 18, 14));
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2;
    g.add(k.box(dark, 6, 8, 6, 0.6, -50 + Math.cos(a) * 17, y + 86, -54 + Math.sin(a) * 17));
  }
  // The gatehouse arch on the front (+x).
  g.add(k.box(stone, 20, 44, 14, 1, 58, y, -20), k.box(stone, 20, 44, 14, 1, 58, y, 22));
  g.add(k.at(k.ring(stone, 14, 4, 0, 0, 0, true, Math.PI), 58, y + 44, 1, Math.PI / 2));
  if (found) {
    g.add(pennant(k, TOY.red, 34, -50, y + 86, -54));
    g.add(k.box(k.paint(TOY.blue), 1, 26, 14, 0.4, 61, y + 6, -20), k.box(k.paint(TOY.blue), 1, 26, 14, 0.4, 61, y + 6, 22));
    g.add(k.peg(TOY.red, TOY.yellow, 70, y - 6, 2), k.peg(TOY.green, null, 76, y - 8, -8), k.peg(TOY.purple, TOY.black, 0, y, 0));
    g.add(k.box(k.paint("#d9cdb6"), 30, 1, 16, 0.4, 84, 0, 1));
  } else {
    // Ivy and brambles all over; the tall tower's top in the trees.
    g.add(bushes(k, 12, 70, 0, 0, 11));
    for (const [x, z] of [[-50, -54], [50, -54], [58, 1]]) g.add(k.ball(k.paint(TOY.green), 14, x, y + 30, z + 14, 0.8));
  }
  return g;
}

// ——— The hidden lake and its boathouse ———

function lake(k: Kit, found: boolean): Object3D {
  const g = new Group();
  const { paint, wood } = sitePaint(k, found);
  g.add(k.cyl(paint("#5f8f4a"), 100, 2, 0, 0, 0, 100, 24));
  g.add(k.cyl(found ? k.water : paint("#6c8790"), 82, 1.2, 0, 2, 0, 82, 24));
  // Reeds round the edge.
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2 + 0.2;
    if (Math.cos(a) > 0.6) continue;
    for (let j = 0; j < 3; j++) g.add(k.cyl(paint("#6b8f3a"), 1, 14 + j * 4, Math.cos(a) * (78 + j * 3), 2, Math.sin(a) * (78 + j * 3) + j * 2, 0.4, 6));
  }
  // The boathouse on stilts over the water's edge (+x), a jetty.
  const bx = 58;
  for (const [x, z] of [[-14, -14], [14, -14], [-14, 14], [14, 14]]) g.add(stick(k, wood, 3, 12, 3, bx + x, 0, z));
  g.add(k.box(wood, 34, 2, 34, 0.6, bx, 12, 0));
  g.add(k.box(paint(TOY.green), 32, 24, 30, 1.2, bx, 14, 0));
  g.add(k.box(k.cut, 1, 16, 18, 0, bx - 16.4, 14, 0));
  g.add(k.roof(paint(TOY.red), 38, 36, 16, bx, 38, 0, 2.5));
  g.add(k.box(wood, 50, 2, 10, 0.4, bx - 40, 8, 24));
  for (let i = 0; i < 4; i++) g.add(stick(k, wood, 2, 8, 2, bx - 60 + i * 14, 0, 28));
  if (found) {
    const boat = new Group();
    boat.add(k.extrude(k.paint(TOY.blue), [[-14, 0], [14, 0], [18, 6], [-18, 6]], 12, 0, 0, 0, 1));
    boat.add(k.box(k.wood, 4, 1, 10, 0.3, -4, 5, 0), k.box(k.wood, 4, 1, 10, 0.3, 6, 5, 0));
    boat.add(k.peg(TOY.red, TOY.yellow, 0, 4, 0));
    g.add(k.at(boat, bx - 44, 2.5, 6, 0.3));
    g.add(pennant(k, TOY.yellow, 18, bx, 54, 0));
    g.add(k.cyl(k.paint(TOY.black), 1, 18, bx - 64, 10, 24, 1, 6), k.ball(k.paint(TOY.yellow), 3, bx - 64, 30, 24));
  } else {
    // A ring of thick woods hides it; the boat sunk to its bow.
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      g.add(k.cyl(paint(TOY.brown), 3, 12, Math.cos(a) * 96, 0, Math.sin(a) * 96, 3, 8), k.cone(paint(TOY.green), 16, 44, Math.cos(a) * 96, 10, Math.sin(a) * 96, 8));
    }
    g.add(k.box(paint(TOY.blue), 10, 5, 8, 1, bx - 44, 1, 6));
    g.add(bushes(k, 6, 20, bx, 28, 5));
  }
  return g;
}

// ——— The shipwreck on the shore ———

function shipwreck(k: Kit, found: boolean): Object3D {
  const g = new Group();
  const { paint, wood } = sitePaint(k, found);
  g.add(k.cyl(paint("#e3cf9a"), 96, 2, 0, 0, 0, 100, 20));
  const sunk = found ? 0 : -2;
  const hull = new Group();
  const side = new Shape();
  side.moveTo(-70, 30);
  side.lineTo(70, 30);
  side.quadraticCurveTo(66, 4, 40, 0);
  side.lineTo(-50, 0);
  side.quadraticCurveTo(-68, 6, -70, 30);
  for (const z of [-20, 20]) hull.add(k.extrude(paint("#8a5a34"), side, 4, 0, 0, z, 0.6));
  hull.add(k.box(paint("#6e4628"), 100, 3, 40, 0.6, -5, 1, 0));
  for (let i = 0; i < 5; i++) hull.add(stick(k, wood, 2, 34, 42, -46 + i * 22, 0, 0)); // ribs showing
  hull.add(k.box(paint(TOY.cream), 2, 28, 2, 0, -40, 30, 0));
  hull.rotation.z = -0.12;
  hull.rotation.x = 0.1;
  g.add(k.at(hull, 0, 6 + sunk, 0));
  // The broken mast, a torn sail.
  const mast = stick(k, wood, 4, 70, 4, 0, 0, 0);
  mast.position.set(10, 20 + sunk, 0);
  mast.rotation.z = 0.5;
  g.add(mast);
  g.add(k.box(paint(TOY.cream), 2, 30, 26, 0.4, -10, 40 + sunk, 6).rotateX(0.2));
  // The treasure chest on the sand.
  const chest = new Group();
  chest.add(k.box(paint(TOY.brown), 16, 10, 11, 1.5, 0, 0, 0));
  chest.add(stick(k, paint(TOY.yellow), 16.4, 1.6, 11.4, 0, 4, 0));
  if (found) {
    const lid = k.box(k.paint(TOY.brown), 16, 3, 11, 1.2, 0, 0, 0);
    lid.position.set(0, 14, -6);
    lid.rotation.x = -1.1;
    chest.add(lid);
    for (let i = 0; i < 5; i++) chest.add(k.ball(k.paint(TOY.yellow), 2.6, -5 + i * 2.5, 11, (i % 2) * 2 - 1));
  } else chest.add(k.box(paint(TOY.brown), 16, 3, 11, 1.2, 0, 10, 0));
  g.add(k.at(chest, 70, 2 + (found ? 0 : -6), 40, -0.4));
  if (found) {
    g.add(pennant(k, TOY.red, 30, 76, 2, -30));
    g.add(k.peg(TOY.blue, TOY.red, 84, 2, 30), k.peg(TOY.yellow, null, 60, 2, 56));
  } else {
    // Seaweed and sand over it.
    g.add(bushes(k, 7, 60, -10, 10, 13, "#4f6f45"));
    g.add(k.cyl(paint("#e3cf9a"), 40, 14, -40, 0, 0, 30, 14));
  }
  return g;
}

// ——— The standing-stone circle ———

function stones(k: Kit, found: boolean): Object3D {
  const g = new Group();
  const { paint } = sitePaint(k, found);
  const grey = paint("#a6a39a");
  g.add(k.cyl(paint("#79a858"), 90, 1.5, 0, 0, 0, 90, 24));
  const N = 10;
  const R = 62;
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2;
    const h = 30 + ((i * 7) % 5) * 4;
    const stone = k.box(grey, 12, h, 7, 2.5, 0, 0, 0);
    const fallen = !found && i % 3 === 1;
    if (fallen) {
      stone.rotation.z = Math.PI / 2;
      stone.position.set(Math.cos(a) * (R + 10), 4, Math.sin(a) * (R + 10));
    } else {
      stone.position.set(Math.cos(a) * R, h / 2 + 1, Math.sin(a) * R);
    }
    stone.rotation.y = -a;
    g.add(stone);
    // Lintels on every other pair, as a trilithon ring.
    if (i % 2 === 0 && !fallen && (found || i % 4 === 0)) {
      const b = ((i + 0.5) / N) * Math.PI * 2;
      const lintel = k.box(grey, 7, 6, 32, 2, 0, 0, 0);
      lintel.position.set(Math.cos(b) * R, 34, Math.sin(b) * R);
      lintel.rotation.y = -b;
      g.add(lintel);
    }
  }
  g.add(k.box(grey, 24, 8, 14, 2, 0, 1, 0));
  if (found) {
    // A garland of flowers round the altar stone, spirals painted on, and a picnic.
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2;
      g.add(k.ball(k.paint(i % 2 ? TOY.pink : TOY.yellow), 2.4, Math.cos(a) * 22, 3, Math.sin(a) * 22));
    }
    for (let i = 0; i < N; i += 2) {
      const a = (i / N) * Math.PI * 2;
      g.add(k.at(k.ring(k.paint(TOY.blue), 3, 0.8, 0, 0, 0, true, Math.PI * 1.6), Math.cos(a) * (R - 3.6), 18, Math.sin(a) * (R - 3.6), -a + Math.PI / 2));
    }
    g.add(k.box(k.paint(TOY.red), 26, 0.8, 20, 0.2, 40, 1.5, 20), k.peg(TOY.cream, TOY.green, 36, 2, 26));
  } else {
    g.add(bushes(k, 10, 80, 0, 0, 17));
  }
  return g;
}

// ——— The giant's footprint ———

function footprint(k: Kit, found: boolean): Object3D {
  const g = new Group();
  const { paint } = sitePaint(k, found);
  g.add(k.cyl(paint("#79a858"), 100, 1.5, 0, 0, 0, 100, 24));
  // The sole: an outline, cut into the grass, filled with water.
  const sole = new Shape();
  sole.moveTo(-70, 0);
  sole.bezierCurveTo(-70, 30, -20, 34, 10, 30);
  sole.bezierCurveTo(50, 26, 62, 14, 62, 0);
  sole.bezierCurveTo(62, -16, 40, -24, 0, -22);
  sole.bezierCurveTo(-30, -20, -70, -26, -70, 0);
  const water = found ? k.water : paint("#6c8790");
  const rim = paint("#8a6a44");
  const s = k.extrude(rim, sole, 2.4, 0, 0, 0, 0.4);
  s.rotation.x = -Math.PI / 2;
  s.position.y = 1.2;
  s.scale.set(1.08, 1.08, 1);
  g.add(s);
  const w = k.extrude(water, sole, 1.6, 0, 0, 0, 0.3);
  w.rotation.x = -Math.PI / 2;
  w.position.y = 2.2;
  g.add(w);
  // Five toes.
  for (const [x, z, r] of [[78, -6, 12], [72, 18, 9], [62, 34, 8], [50, 46, 7], [38, 54, 6]] as const) {
    g.add(k.cyl(rim, r + 2, 2.4, x, 1.2, -z + 10, r + 2, 16), k.cyl(water, r, 1.6, x, 2.2, -z + 10, r, 16));
  }
  if (found) {
    // A signpost, ducks on the water, a family come to see.
    g.add(k.cyl(k.wood, 1.4, 30, -86, 0, -40, 1.4, 8), k.box(k.paint(TOY.cream), 26, 9, 2, 0.6, -80, 24, -40));
    for (const [x, z] of [[-30, 4], [-10, -8], [20, 6]]) g.add(k.ball(k.paint(TOY.white), 3, x, 5, z, 0.7), k.ball(k.paint(TOY.green), 2, x + 3, 8, z));
    g.add(k.peg(TOY.red, null, -86, 2, 30), k.peg(TOY.yellow, TOY.blue, -78, 2, 40), k.peg(TOY.blue, null, -94, 2, 44));
  } else {
    g.add(bushes(k, 14, 70, 0, 0, 23));
  }
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
    tags: ["secret", "mine", "cart", "gold", "rock"],
    notes: "An old adit in a rock face with a cart on its rails. Found by laying track to it: the cart's full of gold (coins), and the mine can be reopened for half price.",
    build: lostMine,
  },
  {
    id: "secret-castle",
    name: "Ruined castle",
    tags: ["secret", "castle", "ruin", "tower", "mound"],
    notes: "Broken walls, a gatehouse and a tall round tower on a grassy mound. Found, it flies a flag and draws day-trippers: a halt near it fills with people wanting to go there.",
    build: castle,
  },
  {
    id: "secret-lake",
    name: "Hidden lake",
    tags: ["secret", "lake", "boathouse", "boat", "reeds", "jetty"],
    notes: "A still lake ringed by woods, a boathouse on stilts and a jetty. Found, its rowing boat is mended and the lake gives a boating day out (riders) and a fishing spot.",
    build: lake,
  },
  {
    id: "secret-shipwreck",
    name: "Shipwreck",
    tags: ["secret", "ship", "wreck", "treasure", "beach", "coast"],
    notes: "A wooden ship heeled over on the sand, its mast broken, a chest beside it. Found, the chest is full of gold (coins), and the wreck's figurehead goes to a museum.",
    build: shipwreck,
  },
  {
    id: "secret-stones",
    name: "Standing stones",
    tags: ["secret", "stones", "circle", "ancient", "monument"],
    notes: "A ring of tall stones and lintels round an altar stone. Found, they stand again with a garland, and midsummer brings visitors from every town.",
    build: stones,
  },
  {
    id: "secret-footprint",
    name: "Giant's footprint",
    tags: ["secret", "giant", "footprint", "pond", "ducks", "legend"],
    notes: "A footprint-shaped pond as big as a field, with five round toes. Found, ducks move in, a sign tells the tale, and families come to picnic.",
    build: footprint,
  },
];

export const ASSETS: Asset[] = SECRETS.flatMap((s) => [
  {
    id: `${s.id}-hidden`,
    name: `${s.name} (not found yet)`,
    trayLabel: `${s.name}?`,
    category: CAT,
    tags: [...s.tags, "hidden"],
    notes: `${s.name} before it's found: grown over and grey, half hidden. Lay track to it to find it.`,
    build: (k: Kit) => s.build(k, false),
  },
  { id: s.id, name: s.name, category: CAT, tags: [...s.tags, "found"], notes: s.notes, build: (k: Kit) => s.build(k, true) },
]);

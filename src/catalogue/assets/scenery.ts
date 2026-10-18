import { Group, Shape, type Material, type Mesh, type Object3D } from "three";
import { TOY, type Kit } from "../kit";
import type { Asset } from "../types";

/** Scenery (trees, fields, water, fences, sky pieces) and Town & road (roads, street furniture, park and playground). */

// ——— Local colours ———
const C = {
  sand: "#e8cf94",
  snow: "#fbfbf7",
  stone: "#a9a6a0",
  dark: "#6d6a66",
  soil: "#6b4a30",
  lime: "#8cc152",
  moss: "#5a9e3e",
  autumn: "#d4622a",
  amber: "#f0a030",
  bronze: "#6f7d5c",
  brick: "#a8553a",
  lamp: "#fff2b0",
  dim: "#3a3a3a",
  flame: "#ff9a2e",
  water: "#4f9fd6",
} as const;

// ——— Local helpers ———

const named = <T extends Object3D>(o: T, name: string): T => {
  o.name = name;
  return o;
};

/** Find a named part once, then remember it on the root (animate is called every frame). */
function part(root: Object3D, name: string): Object3D | undefined {
  const cache = (root.userData.parts ??= {}) as Record<string, Object3D | undefined>;
  if (!(name in cache)) cache[name] = root.getObjectByName(name);
  return cache[name];
}

/** All parts whose name starts with `prefix`, in build order, found once. */
function partsOf(root: Object3D, prefix: string): Object3D[] {
  const cache = (root.userData.lists ??= {}) as Record<string, Object3D[]>;
  let list = cache[prefix];
  if (!list) {
    list = [];
    root.traverse((o) => {
      if (o.name.startsWith(prefix)) list!.push(o);
    });
    cache[prefix] = list;
  }
  return list;
}

/** A turned beech base disc, `r` across, 3 thick. */
const base = (k: Kit, r: number, mat?: Material) => k.cyl(mat ?? k.wood, r, 3, 0, 0, 0, r - 0.6, 36);

/** A flat outline (x, -z) laid on the ground, `thick` high, its base at y. */
function slab(k: Kit, mat: Material, shape: Shape | readonly [number, number][], thick: number, y = 0, bevel = 0): Mesh {
  const m = k.extrude(mat, shape, thick, 0, 0, 0, bevel);
  m.rotation.x = -Math.PI / 2;
  m.position.y = y + thick / 2;
  return m;
}

/** An annular sector from angle a0 to a1 (in the shape's x/y plane). */
function arcShape(rIn: number, rOut: number, a0: number, a1: number): Shape {
  const s = new Shape();
  s.moveTo(Math.cos(a0) * rOut, Math.sin(a0) * rOut);
  s.absarc(0, 0, rOut, a0, a1, false);
  s.lineTo(Math.cos(a1) * rIn, Math.sin(a1) * rIn);
  s.absarc(0, 0, rIn, a1, a0, true);
  return s;
}

/** A rounded lump of rock: a squashed ball. */
function rock(k: Kit, r: number, x: number, z: number, sy = 0.65, sx = 1.2, ry = 0, color: string = C.stone): Mesh {
  const m = k.ball(k.paint(color), r, x, r * sy * 0.7, z, sy);
  m.scale.x = sx;
  m.rotation.y = ry;
  return m;
}

/** A little flower: green stem and a coloured head. */
const flower = (k: Kit, color: string, x: number, z: number, h = 9, y = 0) =>
  k.group(k.cyl(k.paint(TOY.leaf), 0.6, h, x, y, z, 0.6, 6), k.ball(k.paint(color), 2, x, y + h + 1, z), k.ball(k.paint(TOY.yellow), 0.9, x, y + h + 2.6, z));

/** A turned trunk. */
const trunk = (k: Kit, r: number, h: number, y = 3, mat?: Material) => k.cyl(mat ?? k.wood, r, h, 0, y, 0, r * 0.75, 16);

/** A straight road (grey felt on a beech board) `len` long along x, with a dashed centre line. */
function roadStraight(k: Kit, len: number, dashes = true): Group {
  const g = new Group();
  g.add(k.box(k.wood, len, 5, 56, 1.5));
  g.add(k.box(k.road, len - 0.4, 1, 48, 0, 0, 5, 0));
  if (dashes) {
    const n = Math.max(1, Math.floor(len / 24));
    for (let i = 0; i < n; i++) g.add(k.box(k.paint(TOY.white), 10, 0.4, 2, 0, -len / 2 + (len / n) * (i + 0.5), 6, 0));
  }
  return g;
}

// ——— Scenery ———

const scenery: Asset[] = [
  {
    id: "scene-lollipop-tree",
    name: "Lollipop tree",
    category: "Scenery",
    tags: ["tree", "round", "classic"],
    notes: "The classic turned tree: a beech dowel with a glossy green ball. Plant rows of them along the line; a forest of them could hide a tunnel mouth.",
    build: (k) => k.group(base(k, 12), trunk(k, 3, 30), k.ball(k.paint(TOY.leaf), 16, 0, 46, 0)),
  },
  {
    id: "scene-cone-fir",
    name: "Cone fir",
    category: "Scenery",
    tags: ["tree", "fir", "pine", "conifer"],
    notes: "A tall, tapered fir in dark green lacquer. Mountain lines look right lined with these; a timber yard could need firs nearby to fell.",
    build: (k) => k.group(base(k, 12), trunk(k, 3, 12), k.cone(k.paint(TOY.green), 14, 62, 0, 12, 0, 20)),
  },
  {
    id: "scene-stacked-disc-tree",
    name: "Stacked disc tree",
    category: "Scenery",
    tags: ["tree", "fir", "discs", "stacking"],
    notes: "Four green discs threaded on a dowel, smallest at the top, like a stacking toy. Could double as a toddler puzzle: tap to stack the discs in order.",
    build: (k) => {
      const g = k.group(base(k, 13), k.cyl(k.wood, 2.4, 70, 0, 3, 0, 2.4, 12), k.ball(k.wood, 3.4, 0, 74, 0));
      [17, 14, 11, 8].forEach((r, i) => g.add(k.cyl(k.paint(i % 2 ? TOY.leaf : TOY.green), r, 7, 0, 14 + i * 14, 0, r - 2, 28)));
      return g;
    },
  },
  {
    id: "scene-birch",
    name: "Silver birch",
    category: "Scenery",
    tags: ["tree", "birch", "white"],
    notes: "A slim white trunk with black bands and a small oval crown of light green. Clusters of birches suit a lakeside or a northern forest theme.",
    build: (k) => {
      const g = k.group(base(k, 10), trunk(k, 2.6, 46, 3, k.paint(TOY.white)));
      for (const y of [10, 19, 27, 36, 42]) g.add(k.cyl(k.paint(TOY.black), 2.62 - (y - 3) * 0.012, 1.2, 0, y, 0, 2.6 - (y - 3) * 0.012, 16));
      g.add(k.ball(k.paint(C.lime), 12, 0, 56, 0, 1.45));
      return g;
    },
  },
  {
    id: "scene-palm",
    name: "Palm tree",
    category: "Scenery",
    tags: ["tree", "palm", "tropical", "beach", "animated"],
    notes: "A leaning ringed trunk with drooping fronds and coconuts, swaying in the breeze. Goes with the beach and a holiday line; coconuts could be a cargo.",
    build: (k) => {
      const g = k.group(base(k, 12, k.paint(C.sand)));
      for (let i = 0; i < 7; i++) g.add(k.cyl(k.wood, 3.6 - i * 0.2, 7, i * 1.2, 3 + i * 6.5, 0, 3.0 - i * 0.2, 14));
      const top = named(new Group(), "fronds");
      top.position.set(8.4, 49, 0);
      const leaf: [number, number][] = [
        [0, -1.5], [8, -3], [18, -3.5], [26, -1.5], [30, 0], [26, 1.5], [18, 3.5], [8, 3], [0, 1.5],
      ];
      for (let i = 0; i < 7; i++) {
        const f = k.extrude(k.paint(i % 2 ? TOY.leaf : TOY.green), leaf, 1.6, 0, 0, 0, 0.5);
        f.rotation.order = "YZX";
        f.rotation.y = (i / 7) * Math.PI * 2;
        f.rotation.z = -0.45;
        f.rotation.x = Math.PI / 2;
        top.add(f);
      }
      for (let i = 0; i < 3; i++) top.add(k.ball(k.paint(TOY.brown), 2.8, Math.cos(i * 2.1) * 3.5, -3, Math.sin(i * 2.1) * 3.5));
      g.add(top);
      return g;
    },
    animate: (root, t) => {
      const f = part(root, "fronds");
      if (f) f.rotation.z = Math.sin(t * 1.4) * 0.06;
    },
  },
  {
    id: "scene-apple-tree",
    name: "Apple tree",
    category: "Scenery",
    tags: ["tree", "apple", "fruit", "orchard"],
    notes: "A round, lumpy crown dotted with red apples. An orchard of them could fill a fruit wagon: a cider press town might ask for apples in autumn.",
    build: (k) => {
      const g = k.group(base(k, 15), trunk(k, 3.4, 26));
      const leaf = k.paint(TOY.leaf);
      g.add(k.ball(leaf, 15, 0, 42, 0), k.ball(leaf, 10, 9, 36, 6), k.ball(leaf, 10, -9, 37, -5), k.ball(leaf, 10, -2, 35, 10));
      const apples: [number, number, number][] = [
        [13, 40, 6], [-12, 42, -3], [4, 48, 13], [-3, 36, 15], [11, 33, -8], [-8, 52, 8], [6, 55, -9], [15, 47, -2],
      ];
      for (const [x, y, z] of apples) g.add(k.ball(k.paint(TOY.red), 2.3, x, y, z));
      g.add(k.ball(k.paint(TOY.red), 2.3, 9, 3.6, 8), k.ball(k.paint(TOY.red), 2.3, -10, 3.6, 4));
      return g;
    },
  },
  {
    id: "scene-autumn-tree",
    name: "Autumn tree",
    category: "Scenery",
    tags: ["tree", "autumn", "fall", "orange", "seasons"],
    notes: "A broad crown in orange, red and amber, with a few leaves dropped on its base. A seasons switch could swap the map's trees between summer, autumn and snow.",
    build: (k) => {
      const g = k.group(base(k, 15), trunk(k, 3.4, 28));
      g.add(k.ball(k.paint(C.autumn), 14, 0, 44, 0), k.ball(k.paint(TOY.red), 10, 9, 38, -5), k.ball(k.paint(C.amber), 10, -8, 39, 6), k.ball(k.paint(TOY.yellow), 8, 3, 53, 6));
      const leaves: [number, number, string][] = [
        [10, 6, C.autumn], [-9, 8, TOY.red], [7, -10, C.amber], [-6, -11, C.autumn], [12, -3, TOY.yellow],
      ];
      for (const [x, z, c] of leaves) g.add(k.cyl(k.paint(c), 2.2, 0.6, x, 3, z, 2.2, 10));
      return g;
    },
  },
  {
    id: "scene-willow",
    name: "Weeping willow",
    category: "Scenery",
    tags: ["tree", "willow", "river", "animated"],
    notes: "A dome of pale green with long fronds hanging to the ground, stirring gently. Belongs beside the pond or river bend; a fisherman peg could sit beneath.",
    build: (k) => {
      const g = k.group(base(k, 20), trunk(k, 4, 30));
      g.add(k.ball(k.paint(C.moss), 16, 0, 40, 0, 0.75));
      const fronds = named(new Group(), "fronds");
      fronds.position.y = 42;
      for (let i = 0; i < 14; i++) {
        const a = (i / 14) * Math.PI * 2;
        const f = k.capsule(k.paint(i % 2 ? C.lime : C.moss), 2, 22, Math.cos(a) * 15, -32, Math.sin(a) * 15);
        fronds.add(f);
      }
      g.add(fronds);
      return g;
    },
    animate: (root, t) => {
      const f = part(root, "fronds");
      if (f) {
        f.rotation.x = Math.sin(t * 0.9) * 0.03;
        f.rotation.z = Math.cos(t * 0.7) * 0.03;
      }
    },
  },
  {
    id: "scene-cactus",
    name: "Desert cactus",
    category: "Scenery",
    tags: ["cactus", "desert", "western"],
    notes: "A tall cactus with two raised arms and a pink flower, on a sandy base. With a few of these and some rocks, a western desert line could carry gold from a mine.",
    build: (k) => {
      const g = k.group(base(k, 13, k.paint(C.sand)));
      const green = k.paint(TOY.leaf);
      g.add(k.capsule(green, 5, 42, 0, 3, 0));
      g.add(k.capsule(green, 3.2, 8, 8, 20, 0), k.cylX(green, 3.2, 7, 4, 22, 0, 12));
      g.add(k.capsule(green, 3.2, 10, -8, 26, 0), k.cylX(green, 3.2, 7, -4, 28, 0, 12));
      g.add(k.ball(k.paint(TOY.pink), 2.5, 0, 55, 0));
      g.add(rock(k, 3, 8, 7));
      return g;
    },
  },
  {
    id: "scene-toadstool",
    name: "Giant toadstool",
    category: "Scenery",
    tags: ["mushroom", "toadstool", "fairy", "woods"],
    notes: "An oversized red-and-white spotted toadstool with two little ones beside it. A fairy-tale woodland stop; peg people could shelter under the big cap when it rains.",
    build: (k) => {
      const g = k.group(base(k, 18, k.felt));
      const shroom = (s: number, x: number, z: number) => {
        const m = new Group();
        m.add(k.lathe(k.paint(TOY.cream), [[0, 0], [5 * s, 0], [4 * s, 8 * s], [3.5 * s, 18 * s], [0, 18 * s]], 0, 0, 0, 20));
        m.add(k.lathe(k.paint(TOY.red), [[0, 17 * s], [13 * s, 17 * s], [12 * s, 21 * s], [8 * s, 26 * s], [0, 28 * s]], 0, 0, 0, 28));
        const n = s > 0.8 ? 7 : 3;
        for (let i = 0; i < n; i++) {
          const a = (i / n) * Math.PI * 2;
          m.add(k.ball(k.paint(TOY.white), 1.6 * s, Math.cos(a) * 9 * s, 23 * s, Math.sin(a) * 9 * s, 0.5));
        }
        if (s > 0.8) m.add(k.ball(k.paint(TOY.white), 1.8, 0, 28, 0, 0.5));
        return k.at(m, x, 1.2, z);
      };
      g.add(shroom(1, 0, 0), shroom(0.4, 12, 8), shroom(0.32, -11, 10));
      return g;
    },
  },
  {
    id: "scene-bush-trio",
    name: "Bush cluster",
    category: "Scenery",
    tags: ["bush", "shrub", "green"],
    notes: "Three squashed green balls on a felt disc: cheap filler for the gaps between track. Could hide a small animal that pops out when a train passes.",
    build: (k) => k.group(k.feltDisc(18), k.ball(k.paint(TOY.leaf), 9, -5, 6, -3, 0.75), k.ball(k.paint(TOY.green), 7, 7, 5, 2, 0.75), k.ball(k.paint(C.moss), 6, -2, 4.5, 9, 0.75)),
  },
  {
    id: "scene-hedge",
    name: "Hedge",
    category: "Scenery",
    tags: ["hedge", "field", "border", "fence"],
    notes: "A clipped hedge section one hill-block long with bumpy top. Lines fields and gardens; hedges could mark plots the player is allowed to build in.",
    build: (k) => {
      const g = k.group(k.box(k.wood, 72, 3, 18, 1), k.box(k.paint(TOY.green), 68, 18, 14, 5, 0, 3, 0));
      for (let i = 0; i < 6; i++) g.add(k.ball(k.paint(i % 2 ? TOY.leaf : TOY.green), 6, -28 + i * 11.2, 20, (i % 3) - 1));
      return g;
    },
  },
  {
    id: "scene-flower-bed",
    name: "Flower bed",
    category: "Scenery",
    tags: ["flowers", "garden", "bed", "colour"],
    notes: "A beech-edged bed of dark soil planted with bright flowers. Gardens by the station; a flower show town could request deliveries of blooms.",
    build: (k) => {
      const g = k.group(k.box(k.wood, 56, 6, 30, 1.5), k.box(k.paint(C.soil), 50, 1, 24, 0, 0, 5.5, 0));
      const colours = [TOY.red, TOY.yellow, TOY.pink, TOY.purple, TOY.white, TOY.orange];
      for (let i = 0; i < 12; i++) g.add(flower(k, colours[i % colours.length], -21 + (i % 6) * 8.4, i < 6 ? -6 : 6, 7 + (i % 3), 6));
      return g;
    },
  },
  {
    id: "scene-tulip-row",
    name: "Tulip planter",
    category: "Scenery",
    tags: ["tulips", "flowers", "planter", "spring"],
    notes: "A long painted planter with a row of turned tulip cups in alternating colours. Spring dressing for a platform edge or a canal-side town.",
    build: (k) => {
      const g = k.group(k.box(k.paint(TOY.blue), 60, 10, 14, 2), k.box(k.paint(C.soil), 56, 1, 10, 0, 0, 9.6, 0));
      const cols = [TOY.red, TOY.yellow, TOY.pink, TOY.orange, TOY.purple, TOY.red, TOY.yellow];
      cols.forEach((c, i) => {
        const x = -24 + i * 8;
        g.add(k.cyl(k.paint(TOY.leaf), 0.7, 12, x, 10, 0, 0.7, 6));
        g.add(k.lathe(k.paint(c), [[0.1, 0], [2.4, 1], [3, 4], [2.8, 6.5], [2.4, 6.5]], x, 21, 0, 16));
        const leaf = k.ball(k.paint(TOY.leaf), 2.2, x + 1.6, 14, 0, 2.2);
        leaf.scale.x = 0.5;
        leaf.rotation.z = -0.35;
        g.add(leaf);
      });
      return g;
    },
  },
  {
    id: "scene-rocks",
    name: "Rocks and boulders",
    category: "Scenery",
    tags: ["rocks", "boulder", "stone", "mountain"],
    notes: "A loose group of rounded grey stones from boulder to pebble. Scatter near cuttings; a rockfall event could block a line until a crane clears it.",
    build: (k) => k.group(k.feltDisc(22), rock(k, 11, -5, -3, 0.75, 1.2, 0.4), rock(k, 7, 10, 6, 0.7, 1.3, 1.1, C.dark), rock(k, 5, -10, 12, 0.6), rock(k, 3, 13, -9, 0.6, 1.2, 0, C.dark), rock(k, 2.4, 3, 14)),
  },
  {
    id: "scene-mountain",
    name: "Snowy mountain",
    category: "Scenery",
    tags: ["mountain", "peak", "snow", "backdrop"],
    notes: "A tall turned peak with a snow cap and a smaller foothill beside it. A backdrop for mountain lines; tunnels through hill blocks could lead the eye up to it.",
    build: (k) => {
      const g = new Group();
      g.add(k.lathe(k.paint(TOY.green), [[0, 0], [60, 0], [52, 20], [40, 50], [26, 80], [14, 105], [0, 120]], 0, 0, 0, 40));
      g.add(k.lathe(k.paint(C.snow), [[25.2, 83], [21.5, 92], [15.2, 105], [1, 120.8], [0, 121]], 0, 0, 0, 40));
      g.add(k.lathe(k.paint(TOY.leaf), [[0, 0], [32, 0], [24, 22], [12, 42], [0, 50]], 46, 0, 30, 32));
      g.add(k.cone(k.paint(TOY.green), 5, 16, 40, 0, -52), k.cone(k.paint(TOY.green), 4, 12, 52, 0, -42));
      return g;
    },
  },
  {
    id: "scene-cliff",
    name: "Cliff face",
    category: "Scenery",
    tags: ["cliff", "rock", "ledge", "mountain", "hill"],
    notes: "A hill block's worth of stepped grey cliff with a grassy top and boulders at its foot. Sets beside track to make a ledge line; goats could graze the top.",
    build: (k) => {
      const g = new Group();
      const side: [number, number][] = [[-36, 0], [36, 0], [36, 64], [10, 64], [6, 52], [-4, 46], [-8, 30], [-18, 24], [-22, 10], [-36, 6]];
      const cliff = k.extrude(k.paint(C.stone), side, 64, 0, 0, 0, 1.5);
      g.add(cliff);
      g.add(k.box(k.felt, 27, 2, 64, 0.5, 23, 64, 0));
      g.add(k.box(k.paint(C.dark), 2, 18, 40, 1, -7, 30, -6), k.box(k.paint(C.dark), 2, 12, 30, 1, -20, 10, 8));
      g.add(rock(k, 6, -40, -14), rock(k, 4, -42, 10, 0.6, 1.2, 0.5, C.dark), rock(k, 3, -32, 22));
      g.add(k.cone(k.paint(TOY.green), 5, 16, 28, 66, -20), k.cone(k.paint(TOY.green), 5, 14, 30, 66, 18));
      return g;
    },
  },
  {
    id: "scene-waterfall",
    name: "Waterfall",
    category: "Scenery",
    tags: ["waterfall", "water", "felt", "river", "animated"],
    notes: "A blue felt cascade down a rock face into a pool, with white foam streaming down. Lead the river felt from it; a mill wheel downstream could turn while it runs.",
    build: (k) => {
      const g = new Group();
      g.add(k.box(k.paint(C.stone), 30, 70, 40, 4, -24, 0, -26), k.box(k.paint(C.stone), 30, 58, 40, 4, -24, 0, 26));
      g.add(k.box(k.paint(C.dark), 34, 64, 16, 3, -26, 0, 0));
      g.add(k.box(k.water, 2, 62, 14, 0.5, -8.4, 2, 0));
      g.add(slab(k, k.water, arcShape(0, 22, 0, Math.PI * 2), 1.4, 0));
      g.add(k.box(k.felt, 30, 2, 92, 0.5, -24, 70, 0));
      for (let i = 0; i < 4; i++) g.add(named(k.box(k.paint(TOY.white), 1, 3, 10, 0.4, -7.2, 0, 0), `foam${i}`));
      g.add(rock(k, 4, 16, -14), rock(k, 3, 18, 12, 0.6, 1.2, 1, C.dark));
      g.add(k.ball(k.paint(TOY.white), 2.5, -4, 1.6, -4, 0.4), k.ball(k.paint(TOY.white), 2, -3, 1.6, 4, 0.4));
      return g;
    },
    animate: (root, t) => {
      const foam = partsOf(root, "foam");
      for (let i = 0; i < foam.length; i++) foam[i].position.y = 62 - ((t * 24 + i * 15) % 58);
    },
  },
  {
    id: "scene-lily-pond",
    name: "Lily pond",
    category: "Scenery",
    tags: ["pond", "water", "lily", "duck", "felt"],
    notes: "An oval of blue felt in a beech rim, with lily pads, a pink water lily and a yellow duck. Ducks could paddle about; a station by the pond could be a picnic stop.",
    build: (k) => {
      const g = new Group();
      const rim = k.cyl(k.wood, 34, 3, 0, 0, 0, 34, 48);
      rim.scale.z = 0.7;
      const water = k.cyl(k.water, 30, 1, 0, 3, 0, 30, 48);
      water.scale.z = 0.7;
      g.add(rim, water);
      const pads: [number, number, number][] = [[-14, -6, 5], [8, 8, 4], [16, -5, 4.5], [-4, 12, 3.5], [-20, 8, 3]];
      for (const [x, z, r] of pads) g.add(k.cyl(k.paint(TOY.leaf), r, 0.8, x, 4, z, r, 18));
      g.add(k.lathe(k.paint(TOY.pink), [[0.1, 0], [2, 0.5], [3, 2.5], [2.6, 3]], 8, 4.8, 8, 10));
      const duck = k.group(k.ball(k.paint(TOY.yellow), 4, 0, 4, 0, 0.75), k.ball(k.paint(TOY.yellow), 2.6, 3, 8, 0), k.cone(k.paint(TOY.orange), 1, 2.6, 5.6, 7.4, 0));
      (duck.children[2] as Mesh).rotation.z = -Math.PI / 2;
      g.add(k.at(duck, -2, 2.6, -8, 0.6));
      return g;
    },
  },
  {
    id: "scene-river-bend",
    name: "River bend",
    category: "Scenery",
    tags: ["river", "water", "felt", "curve"],
    notes: "A quarter-circle of blue river felt with pebbles and reeds on its banks, to join into longer rivers. Bridges carry the line over it; a ferry could cross where there's no bridge.",
    build: (k) => {
      const g = new Group();
      const inner = new Group();
      inner.add(slab(k, k.felt, arcShape(40, 130, 0, Math.PI / 2), 1, 0));
      inner.add(slab(k, k.water, arcShape(64, 106, 0, Math.PI / 2), 1, 0.6));
      const reeds: [number, number][] = [[0.2, 60], [0.5, 59], [0.9, 110], [1.2, 111], [1.4, 60]];
      for (const [a, r] of reeds) for (let j = 0; j < 3; j++) inner.add(k.cyl(k.paint(j === 1 ? TOY.brown : C.moss), 0.8, 10 + j * 3, Math.cos(a + j * 0.03) * r, 1, -Math.sin(a + j * 0.03) * r, 0.5, 6));
      for (const [a, r] of [[0.7, 66], [0.3, 104], [1.0, 102]] as const) inner.add(rock(k, 2.5, Math.cos(a) * r, -Math.sin(a) * r, 0.5));
      k.at(inner, -85, 0, 85);
      g.add(inner);
      return g;
    },
  },
  {
    id: "scene-beach",
    name: "Beach and umbrella",
    category: "Scenery",
    tags: ["beach", "sand", "sea", "umbrella", "holiday"],
    notes: "A sandy half-disc lapped by blue felt sea, with a striped umbrella, towel and bucket. A seaside terminus; holidaymaker pegs could ride out in summer.",
    build: (k) => {
      const g = new Group();
      g.add(slab(k, k.paint(C.sand), arcShape(0, 50, -Math.PI / 2, Math.PI / 2), 3, 0, 0.6));
      g.add(slab(k, k.water, arcShape(50, 64, -Math.PI / 2, Math.PI / 2), 1.2, 0));
      g.add(k.cyl(k.paint(TOY.white), 0.9, 34, 6, 3, 4, 0.9, 8));
      const brolly = k.group(k.cone(k.paint(TOY.red), 18, 7, 0, 0, 0, 8), k.cone(k.paint(TOY.white), 12, 4.8, 0, 2.2, 0, 8), k.cone(k.paint(TOY.red), 6, 2.4, 0, 4.6, 0, 8));
      g.add(k.at(brolly, 6, 33, 4));
      g.add(k.box(k.paint(TOY.blue), 22, 0.6, 10, 0.3, 18, 3, -12), k.box(k.paint(TOY.white), 22, 0.7, 2.5, 0.3, 18, 3, -12));
      g.add(k.cyl(k.paint(TOY.yellow), 3, 6, -10, 3, -16, 4, 16), k.cyl(k.paint(TOY.red), 1.2, 7, -2, 3, -18, 0.6, 8));
      g.add(k.peg(TOY.red, null, 20, 3, 14));
      return g;
    },
  },
  {
    id: "scene-snowy-fir",
    name: "Snowy fir",
    category: "Scenery",
    tags: ["tree", "fir", "snow", "winter"],
    notes: "Three stacked green tiers each capped with white snow. For a winter line with the snowman; snowfall could gradually swap ordinary firs for these.",
    build: (k) => {
      const g = k.group(base(k, 14, k.paint(C.snow)), trunk(k, 3, 10));
      [[18, 10], [14, 26], [10, 40]].forEach(([r, y]) => {
        g.add(k.cone(k.paint(TOY.green), r, 22, 0, y, 0, 24));
        g.add(k.cone(k.paint(C.snow), r * 0.55, 22 * 0.55, 0, y + 22 * 0.45 + 0.4, 0, 24));
      });
      return g;
    },
  },
  {
    id: "scene-snowman",
    name: "Snowman",
    category: "Scenery",
    tags: ["snowman", "winter", "snow", "christmas"],
    notes: "Three white balls with coal buttons, a carrot nose, scarf and top hat. Winter dressing; children pegs could build one beside the station after a snowfall.",
    build: (k) => {
      const g = k.group(base(k, 13, k.paint(C.snow)));
      const w = k.paint(C.snow);
      g.add(k.ball(w, 11, 0, 13, 0), k.ball(w, 8, 0, 29, 0), k.ball(w, 6, 0, 41, 0));
      for (const y of [25, 29, 33]) g.add(k.ball(k.coal, 1.1, 7.6, y, 0));
      g.add(k.ball(k.coal, 0.9, 5.2, 43, -2.2), k.ball(k.coal, 0.9, 5.2, 43, 2.2));
      const nose = k.cone(k.paint(TOY.orange), 1.3, 7, 0, 0, 0, 10);
      nose.rotation.z = -Math.PI / 2;
      nose.position.set(9, 41, 0);
      g.add(nose);
      g.add(k.ring(k.paint(TOY.red), 6.3, 1.6, 0, 35.5, 0), k.box(k.paint(TOY.red), 2.5, 9, 3, 0.8, 4, 26, 5));
      g.add(k.cyl(k.paint(TOY.black), 6.5, 1, 0, 46, 0), k.cyl(k.paint(TOY.black), 4, 8, 0, 46.5, 0));
      return g;
    },
  },
  {
    id: "scene-campfire",
    name: "Campfire",
    category: "Scenery",
    tags: ["campfire", "fire", "camping", "animated"],
    notes: "A ring of stones round crossed logs and flickering lacquer flames. Goes with the tent; a camping stop where scout pegs get off for the night.",
    build: (k) => {
      const g = k.group(k.feltDisc(18));
      for (let i = 0; i < 9; i++) {
        const a = (i / 9) * Math.PI * 2;
        g.add(rock(k, 3, Math.cos(a) * 11, Math.sin(a) * 11, 0.7, 1.3, a));
      }
      for (let i = 0; i < 3; i++) {
        const log = k.cylX(k.paint(TOY.brown), 1.6, 15, 0, 3.4, 0, 10);
        log.rotation.y = (i / 3) * Math.PI;
        log.rotation.z = 0.15;
        g.add(log);
      }
      [[TOY.red, 5, 13], [C.flame, 4, 11], [TOY.yellow, 2.6, 8]].forEach(([c, r, h], i) => g.add(named(k.cone(k.paint(c as string), r as number, h as number, 0, 2, 0, 12), `flame${i}`)));
      return g;
    },
    animate: (root, t) => {
      const f = partsOf(root, "flame");
      for (let i = 0; i < f.length; i++) {
        const s = 1 + Math.sin(t * 11 + i * 2.3) * 0.12 + Math.sin(t * 17 + i) * 0.06;
        f[i].scale.set(1, s, 1);
        f[i].rotation.y = t * (i + 1) * 0.8;
      }
    },
  },
  {
    id: "scene-tent",
    name: "Camping tent",
    category: "Scenery",
    tags: ["tent", "camping", "holiday"],
    notes: "A ridge tent in orange with an open door flap and guy pegs. A campsite by the lake; campers could arrive by train in summer.",
    build: (k) => {
      const g = k.group(k.feltDisc(30));
      const tent = k.extrude(k.paint(TOY.orange), [[-16, 0], [16, 0], [0, 24]], 36, 0, 1.2, 0, 0.6);
      tent.rotation.y = Math.PI / 2;
      g.add(tent);
      const door = k.extrude(k.paint(C.dim), [[-6, 0], [6, 0], [0, 15]], 1, 18.3, 1.2, 0, 0.2);
      door.rotation.y = Math.PI / 2;
      g.add(door);
      const flap = k.extrude(k.paint(TOY.yellow), [[0, 0], [7, 0], [0, 16]], 1, 0, 0, 0, 0.2);
      flap.rotation.y = -Math.PI / 2 + 0.5;
      flap.position.set(18.5, 1.2, 0);
      g.add(flap);
      g.add(k.cyl(k.wood, 0.8, 30, 19, 1.2, 0, 0.8, 8), k.cyl(k.wood, 0.8, 30, -19, 1.2, 0, 0.8, 8));
      for (const x of [-24, 24]) for (const z of [-20, 20]) g.add(k.cyl(k.wood, 0.7, 4, x, 1.2, z, 0.4, 6));
      return g;
    },
  },
  {
    id: "scene-picnic",
    name: "Picnic blanket",
    category: "Scenery",
    tags: ["picnic", "blanket", "basket", "park"],
    notes: "A red-and-white checked blanket with a hamper, a cake and two seated pegs. A park stop; the hamper could be a parcel delivered from the town bakery.",
    build: (k) => {
      const g = new Group();
      for (let i = 0; i < 5; i++) for (let j = 0; j < 4; j++) g.add(k.box(k.paint((i + j) % 2 ? TOY.white : TOY.red), 8, 0.8, 8, 0, -16 + i * 8, 0, -12 + j * 8));
      g.add(k.box(k.paint(TOY.yellow), 12, 8, 8, 1.5, 6, 0.8, -4), k.ring(k.paint(TOY.brown), 4, 0.7, 6, 9, -4, true, Math.PI));
      g.add(k.cyl(k.paint(TOY.cream), 4.5, 4, -6, 0.8, 4), k.cyl(k.paint(TOY.pink), 4.6, 1, -6, 4.8, 4), k.ball(k.paint(TOY.red), 1.2, -6, 6.4, 4));
      g.add(k.peg(TOY.blue, null, -14, 0.8, -8), k.peg(TOY.purple, TOY.yellow, 14, 0.8, 8));
      return g;
    },
  },
  {
    id: "scene-scarecrow",
    name: "Scarecrow",
    category: "Scenery",
    tags: ["scarecrow", "farm", "field", "crows"],
    notes: "A cross-post scarecrow in a patched coat and straw hat, a black crow on one arm. Stands in the crop field; crows could flock to fields that lack one.",
    build: (k) => {
      const g = k.group(base(k, 10, k.paint(C.soil)), k.cyl(k.wood, 1.4, 38, 0, 3, 0, 1.4, 8), k.cylZ(k.wood, 1.2, 34, 0, 30, 0, 8));
      g.add(k.box(k.paint(TOY.blue), 7, 14, 10, 2.5, 0, 18, 0), k.box(k.paint(TOY.red), 1, 4, 4, 0.5, 3.6, 24, -2));
      g.add(k.ball(k.paint(C.sand), 4.5, 0, 37, 0), k.cyl(k.paint(TOY.yellow), 8, 1, 0, 40.5, 0, 8, 20), k.cyl(k.paint(TOY.yellow), 4, 4, 0, 41, 0, 3.4, 16));
      for (const z of [-17, 17]) g.add(k.cone(k.paint(TOY.yellow), 1.8, 3, 0, 28.5, z, 10));
      const crow = k.group(k.ball(k.paint(TOY.black), 2.6, 0, 2.4, 0, 0.8), k.ball(k.paint(TOY.black), 1.6, 2, 4.4, 0));
      g.add(k.at(crow, 0, 31, 12));
      return g;
    },
  },
  {
    id: "scene-haystacks",
    name: "Haystacks and bales",
    category: "Scenery",
    tags: ["hay", "bales", "farm", "harvest"],
    notes: "A round thatched haystack beside two rolled bales. Harvest scenery; bales could be loaded onto a flat wagon and delivered to the farm's barn.",
    build: (k) => {
      const g = k.group(k.feltDisc(32));
      g.add(k.lathe(k.paint(TOY.yellow), [[0, 0], [14, 0], [15, 10], [13, 20], [7, 30], [0, 34]], -10, 1.2, -4, 24));
      g.add(k.cone(k.paint(C.amber), 6, 6, -10, 33, -4, 16));
      for (const [x, z] of [[14, -8], [14, 10]]) {
        g.add(k.cylZ(k.paint(C.amber), 7, 12, x, 8.2, z, 20), k.cylZ(k.paint(TOY.yellow), 5.5, 12.4, x, 8.2, z, 20));
      }
      return g;
    },
  },
  {
    id: "scene-crop-rows",
    name: "Crop field",
    category: "Scenery",
    tags: ["crops", "field", "wheat", "cabbage", "farm"],
    notes: "A hill-block-sized field: ploughed furrows with rows of cabbages and ripe wheat. Fields could ripen over time and need a harvest train to carry the grain away.",
    build: (k) => {
      const g = k.group(k.box(k.wood, 72, 3, 64, 1.5));
      for (let r = 0; r < 6; r++) {
        const z = -25 + r * 10;
        g.add(k.box(k.paint(C.soil), 68, 2, 7, 1, 0, 3, z));
        for (let i = 0; i < 6; i++) {
          const x = -28 + i * 11.2;
          if (r < 3) g.add(k.ball(k.paint(r % 2 ? TOY.leaf : C.lime), 3.2, x, 7, z, 0.85));
          else g.add(k.capsule(k.paint(TOY.yellow), 1.6, 7, x, 5, z));
        }
      }
      return g;
    },
  },
  {
    id: "scene-pumpkin-patch",
    name: "Pumpkin patch",
    category: "Scenery",
    tags: ["pumpkin", "farm", "autumn", "harvest"],
    notes: "Fat ribbed pumpkins on a patch of soil with curling vines. An autumn harvest; pumpkins could go by wagon to a town fair.",
    build: (k) => {
      const g = k.group(k.cyl(k.paint(C.soil), 28, 2, 0, 0, 0, 27, 36));
      const pumpkin = (r: number, x: number, z: number) =>
        k.group(
          k.lathe(k.paint(TOY.orange), [[0, 0], [r * 0.8, r * 0.1], [r, r * 0.6], [r * 0.85, r * 1.15], [0.1, r * 1.25]], x, 2, z, 12),
          k.cyl(k.paint(TOY.green), r * 0.15, r * 0.4, x, 2 + r * 1.2, z, r * 0.12, 8),
        );
      g.add(pumpkin(8, -6, -4), pumpkin(6, 12, 6), pumpkin(5, -10, 14), pumpkin(4, 10, -14), pumpkin(3.4, 18, -2));
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2 + 0.3;
        g.add(k.ball(k.paint(TOY.leaf), 3.2, Math.cos(a) * 21, 2.6, Math.sin(a) * 21, 0.3));
      }
      return g;
    },
  },
  {
    id: "scene-beehives",
    name: "Beehives",
    category: "Scenery",
    tags: ["bees", "honey", "farm", "animated"],
    notes: "Two tiered hives on legs, with a little swarm of bees circling. Honey jars could be a small, valuable cargo; bees busier when flowers are planted nearby.",
    build: (k) => {
      const g = k.group(k.feltDisc(26));
      for (const [x, c] of [[-10, TOY.white], [12, TOY.yellow]] as const) {
        for (const dx of [-5, 5]) for (const dz of [-5, 5]) g.add(k.box(k.wood, 2, 6, 2, 0.4, x + dx, 1.2, dz));
        g.add(k.box(k.paint(c), 15, 7, 15, 1.2, x, 7, 0), k.box(k.paint(c), 16, 7, 16, 1.2, x, 14.5, 0), k.box(k.paint(c), 15, 7, 15, 1.2, x, 22, 0));
        g.add(k.roof(k.paint(TOY.red), 19, 19, 6, x, 29, 0, 2));
        g.add(k.box(k.cut, 0.6, 1.5, 6, 0, x + 7.6, 8, 0));
      }
      const bees = named(new Group(), "bees");
      bees.position.y = 34;
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2;
        bees.add(k.group(k.ball(k.paint(TOY.yellow), 1.3, Math.cos(a) * 14, (i % 3) * 3, Math.sin(a) * 14), k.ball(k.paint(TOY.black), 0.9, Math.cos(a) * 14 + 1, (i % 3) * 3, Math.sin(a) * 14)));
      }
      g.add(bees);
      return g;
    },
    animate: (root, t) => {
      const b = part(root, "bees");
      if (b) {
        b.rotation.y = t * 2.2;
        b.position.y = 34 + Math.sin(t * 6) * 1.5;
      }
    },
  },
  {
    id: "scene-picket-fence",
    name: "Picket fence",
    category: "Scenery",
    tags: ["fence", "picket", "garden", "white"],
    notes: "A white picket fence section, one hill block long, with pointed pales. Fences in garden and station borders; peg children could peer over.",
    build: (k) => {
      const g = new Group();
      const pale: [number, number][] = [[-2, 0], [2, 0], [2, 18], [0, 21], [-2, 18]];
      for (let i = 0; i < 12; i++) g.add(k.extrude(k.paint(TOY.white), pale, 1.6, -33 + i * 6, 0, 0, 0.3));
      g.add(k.box(k.paint(TOY.white), 72, 2, 1.4, 0.4, 0, 5, -1.4), k.box(k.paint(TOY.white), 72, 2, 1.4, 0.4, 0, 13, -1.4));
      return g;
    },
  },
  {
    id: "scene-rail-fence",
    name: "Field rail fence",
    category: "Scenery",
    tags: ["fence", "rail", "farm", "field"],
    notes: "A rustic post-and-rail fence in bare beech. Pens in the farm animals; a cow left out could wander onto the line if a gate is open.",
    build: (k) => {
      const g = new Group();
      for (const x of [-34, 0, 34]) g.add(k.box(k.wood, 4, 22, 4, 1, x, 0, 0));
      for (const y of [6, 12, 18]) g.add(k.box(k.wood, 72, 2.4, 1.8, 0.6, 0, y, 2.6));
      return g;
    },
  },
  {
    id: "scene-stone-wall",
    name: "Dry stone wall",
    category: "Scenery",
    tags: ["wall", "stone", "field", "fence"],
    notes: "Courses of rounded grey stones with a capping row on edge. Hillside field boundaries; a wall could be a cheap way to mark the map's edge.",
    build: (k) => {
      const g = new Group();
      for (let row = 0; row < 3; row++) {
        let x = -36 + (row % 2 ? 3 : 0);
        let i = 0;
        while (x < 34) {
          const w = 7 + ((i * 7 + row * 3) % 5);
          const len = Math.min(w, 36 - x);
          if (len > 2) g.add(k.box(k.paint((i + row) % 3 ? C.stone : C.dark), len - 0.4, 5.6, 10 - row, 2, x + len / 2, row * 5.8, 0));
          x += w;
          i++;
        }
      }
      for (let i = 0; i < 18; i++) g.add(k.box(k.paint(i % 2 ? C.stone : C.dark), 3.4, 5, 7, 1.2, -34 + i * 4, 17.4, 0));
      return g;
    },
  },
  {
    id: "scene-farm-gate",
    name: "Farm gate",
    category: "Scenery",
    tags: ["gate", "farm", "fence", "animated"],
    notes: "A five-bar gate with a diagonal brace that swings open and shut between two posts. Gates could open to let animals cross; leave one open and the sheep get out.",
    build: (k) => {
      const g = k.group(k.box(k.wood, 5, 26, 5, 1, -22, 0, 0), k.box(k.wood, 5, 26, 5, 1, 22, 0, 0));
      g.add(k.ball(k.wood, 3, -22, 26.5, 0), k.ball(k.wood, 3, 22, 26.5, 0));
      const gate = named(new Group(), "gate");
      gate.position.set(-19.5, 0, 0);
      const w = 38;
      for (let i = 0; i < 5; i++) gate.add(k.box(k.paint(TOY.white), w, 2, 1.6, 0.4, w / 2, 4 + i * 4.2, 0));
      gate.add(k.box(k.paint(TOY.white), 2, 20, 1.8, 0.4, 1, 3, 0), k.box(k.paint(TOY.white), 2, 20, 1.8, 0.4, w - 1, 3, 0));
      const brace = k.box(k.paint(TOY.white), Math.hypot(w, 17), 1.6, 1.4, 0.4, 0, 0, 0);
      brace.position.set(w / 2, 13, 1.2);
      brace.rotation.z = Math.atan2(17, w);
      gate.add(brace);
      g.add(gate);
      return g;
    },
    animate: (root, t) => {
      const g = part(root, "gate");
      if (g) g.rotation.y = (0.5 - 0.5 * Math.cos(t * 0.9)) * 1.4;
    },
  },
  {
    id: "scene-stile",
    name: "Stile",
    category: "Scenery",
    tags: ["stile", "footpath", "fence", "walk"],
    notes: "A short rail fence with wooden steps up and over it. Marks a footpath; walker pegs could cross the fields from a halt to the village.",
    build: (k) => {
      const g = new Group();
      for (const x of [-18, 0, 18]) g.add(k.box(k.wood, 3.4, 22, 3.4, 1, x, 0, 0));
      for (const y of [9, 17]) g.add(k.box(k.wood, 40, 2.2, 1.6, 0.5, 0, y, 2.2));
      for (const s of [-1, 1]) {
        g.add(k.box(k.paint(TOY.brown), 12, 2, 6, 0.6, 0, 6, s * 6), k.box(k.wood, 2, 6, 2, 0.4, -5, 0, s * 7.5), k.box(k.wood, 2, 6, 2, 0.4, 5, 0, s * 7.5));
      }
      g.add(k.box(k.paint(TOY.brown), 12, 2, 4, 0.6, 0, 12, 0));
      return g;
    },
  },
  {
    id: "scene-rainbow",
    name: "Rainbow arch",
    category: "Scenery",
    tags: ["rainbow", "arch", "sky", "weather"],
    notes: "A wide rainbow of six turned bands arching over the line between two white clouds. Trains pass beneath; it could appear after a rain shower.",
    build: (k) => {
      const g = new Group();
      const cols = [TOY.red, TOY.orange, TOY.yellow, TOY.leaf, TOY.blue, TOY.purple];
      cols.forEach((c, i) => g.add(k.ring(k.paint(c), 70 - i * 4.2, 2.2, 0, 4, 0, true, Math.PI)));
      for (const x of [-60, 60]) {
        g.add(k.ball(k.paint(TOY.white), 10, x, 10, 0, 0.9), k.ball(k.paint(TOY.white), 7, x - 9, 7, 3), k.ball(k.paint(TOY.white), 7, x + 9, 7, -2));
        g.add(k.box(k.wood, 30, 3, 16, 1, x, 0, 0));
      }
      return g;
    },
  },
  {
    id: "scene-clouds",
    name: "Clouds on sticks",
    category: "Scenery",
    tags: ["clouds", "sky", "weather", "animated"],
    notes: "Puffy white clouds on dowels, one with a grey rain cloud, bobbing gently. Sky dressing; a rain cloud could drift over and water the crops.",
    build: (k) => {
      const g = k.group(k.box(k.wood, 70, 4, 18, 1.5));
      const cloud = (x: number, h: number, color: string, i: number) => {
        g.add(k.cyl(k.wood, 1.2, h, x, 4, 0, 1.2, 8));
        const c = named(k.group(k.ball(k.paint(color), 9, 0, 0, 0, 0.8), k.ball(k.paint(color), 6.5, -9, -2, 0, 0.8), k.ball(k.paint(color), 6.5, 9, -2, 0, 0.8), k.ball(k.paint(color), 5.5, 4, 5, 1)), `cloud${i}`);
        c.position.set(x, h + 4, 0);
        c.userData.baseY = h + 4;
        g.add(c);
      };
      cloud(-20, 70, TOY.white, 0);
      cloud(18, 54, TOY.white, 1);
      cloud(4, 86, TOY.grey, 2);
      return g;
    },
    animate: (root, t) => {
      const cs = partsOf(root, "cloud");
      for (let i = 0; i < cs.length; i++) cs[i].position.y = (cs[i].userData.baseY as number) + Math.sin(t * 0.9 + i * 2) * 2.5;
    },
  },
  {
    id: "scene-sun-moon",
    name: "Sun and moon",
    category: "Scenery",
    tags: ["sun", "moon", "sky", "day", "night", "animated"],
    notes: "A rayed yellow sun and a pale crescent moon on tall sticks; the sun turns slowly. A day/night toggle could raise one and lower the other.",
    build: (k) => {
      const g = k.group(k.box(k.wood, 70, 4, 18, 1.5), k.cyl(k.wood, 1.3, 80, -18, 4, 0, 1.3, 8), k.cyl(k.wood, 1.3, 64, 20, 4, 0, 1.3, 8));
      const sun = named(new Group(), "sun");
      sun.position.set(-18, 92, 0);
      const disc = k.cylZ(k.paint(TOY.yellow), 11, 4, 0, 0, 0, 28);
      sun.add(disc);
      for (let i = 0; i < 10; i++) {
        const ray = k.cone(k.paint(TOY.orange), 2.4, 6, 0, 0, 0, 8);
        const a = (i / 10) * Math.PI * 2;
        ray.position.set(Math.cos(a) * 14, Math.sin(a) * 14, 0);
        ray.rotation.z = a - Math.PI / 2;
        sun.add(ray);
      }
      g.add(sun);
      const moon = new Shape();
      moon.absarc(0, 0, 12, -Math.PI / 2, Math.PI / 2, false);
      moon.absarc(-5, 0, 10.8, Math.PI / 2 - 0.15, -Math.PI / 2 + 0.15, true);
      g.add(k.extrude(k.paint(TOY.cream), moon, 4, 18, 78, 0, 0.8));
      g.add(k.ball(k.paint(TOY.yellow), 1.5, 0, 84, 0), k.ball(k.paint(TOY.yellow), 1.2, 32, 92, 0));
      return g;
    },
    animate: (root, t) => {
      const s = part(root, "sun");
      if (s) s.rotation.z = t * 0.4;
    },
  },
];

// ——— Town & road ———

const town: Asset[] = [
  {
    id: "scene-road-straight",
    name: "Road, straight",
    category: "Town & road",
    tags: ["road", "felt", "straight", "street"],
    notes: "A straight beech board topped with grey road felt and a dashed centre line. Toy cars and buses drive on it; road and rail meeting makes a level crossing.",
    build: (k) => roadStraight(k, 96),
  },
  {
    id: "scene-road-curve",
    name: "Road, curve",
    category: "Town & road",
    tags: ["road", "felt", "curve", "street"],
    notes: "A quarter-turn of grey felt road on beech, dashed along its centre. Four make a ring road round a town; buses could run a loop timetable.",
    build: (k) => {
      const inner = new Group();
      const R = 96;
      inner.add(slab(k, k.wood, arcShape(R - 28, R + 28, 0, Math.PI / 2), 5, 0, 0));
      inner.add(slab(k, k.road, arcShape(R - 24, R + 24, 0, Math.PI / 2), 1, 5, 0));
      for (let i = 0; i < 5; i++) {
        const a = ((i + 0.5) / 5) * (Math.PI / 2);
        const d = k.box(k.paint(TOY.white), 10, 0.4, 2, 0, Math.cos(a) * R, 6, -Math.sin(a) * R);
        d.rotation.y = a + Math.PI / 2;
        inner.add(d);
      }
      return k.at(k.group(inner), -R * 0.6, 0, R * 0.6);
    },
  },
  {
    id: "scene-road-junction",
    name: "Road, T-junction",
    category: "Town & road",
    tags: ["road", "junction", "street", "give way"],
    notes: "A straight road with a side road joining it, give-way lines painted at the mouth. Lets the road network branch; cars could queue at the line.",
    build: (k) => {
      const g = roadStraight(k, 96);
      const side = k.at(roadStraight(k, 40, false), 0, 0, -48);
      side.rotation.y = Math.PI / 2;
      g.add(side);
      g.add(k.box(k.paint(TOY.white), 2, 0.4, 10, 0, 0, 6, -48));
      for (let i = 0; i < 4; i++) g.add(k.box(k.paint(TOY.white), 5, 0.4, 1.4, 0, -18 + i * 7, 6, -25));
      return g;
    },
  },
  {
    id: "scene-roundabout",
    name: "Roundabout",
    category: "Town & road",
    tags: ["road", "roundabout", "crossroads", "town"],
    notes: "A four-way crossroads with a raised grassy island planted with flowers and a little tree. The heart of a town's roads; cars circle until their exit.",
    build: (k) => {
      const g = new Group();
      g.add(k.box(k.wood, 120, 5, 120, 2));
      g.add(k.cyl(k.road, 56, 1, 0, 5, 0, 56, 48));
      for (const r of [0, Math.PI / 2]) {
        const arm = k.box(k.road, 120 - 0.4, 1, 48, 0, 0, 5, 0);
        arm.rotation.y = r;
        g.add(arm);
      }
      g.add(k.ring(k.paint(TOY.white), 38, 0.6, 0, 6, 0));
      g.add(k.cyl(k.paint(TOY.white), 22, 4, 0, 5, 0, 22, 36), k.cyl(k.felt, 20, 1, 0, 9, 0, 20, 36));
      g.add(k.at(k.group(trunk(k, 2, 14, 0), k.ball(k.paint(TOY.leaf), 7, 0, 18, 0)), 0, 10, 0));
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        g.add(flower(k, [TOY.red, TOY.yellow, TOY.pink][i % 3], Math.cos(a) * 14, Math.sin(a) * 14, 5, 10));
      }
      return g;
    },
  },
  {
    id: "scene-zebra-crossing",
    name: "Zebra crossing",
    category: "Town & road",
    tags: ["road", "crossing", "pedestrian", "beacon", "animated"],
    notes: "A road straight with black-and-white stripes and two flashing amber beacons on striped poles. Cars must stop for peg people waiting to cross.",
    build: (k) => {
      const g = roadStraight(k, 64, false);
      for (let i = 0; i < 7; i++) g.add(k.box(k.paint(TOY.white), 18, 0.4, 4.4, 0, 0, 6, -21 + i * 7));
      for (const z of [-30, 30]) {
        for (let i = 0; i < 6; i++) g.add(k.cyl(k.paint(i % 2 ? TOY.white : TOY.black), 1.4, 6, 14, 0 + i * 6, z, 1.4, 10));
        g.add(k.ball(k.paint(C.dim), 3.2, 14, 39, z), named(k.ball(k.paint(C.amber), 3.4, 14, 39, z), "beacon"));
      }
      g.add(k.peg(TOY.red, null, -14, 0, -33));
      return g;
    },
    animate: (root, t) => {
      const on = Math.floor(t * 2) % 2 === 0;
      for (const b of partsOf(root, "beacon")) b.visible = on;
    },
  },
  {
    id: "scene-traffic-lights",
    name: "Traffic lights",
    category: "Town & road",
    tags: ["traffic", "lights", "signal", "road", "animated"],
    notes: "A tall post with a red, amber and green head that cycles through its sequence. Could control a junction or a level crossing; cars wait on red.",
    build: (k) => {
      const g = k.group(base(k, 8, k.paint(TOY.grey)), k.cyl(k.paint(TOY.black), 1.8, 46, 0, 3, 0, 1.8, 12));
      g.add(k.box(k.paint(TOY.black), 8, 24, 8, 2, 0, 46, 0), k.box(k.paint(TOY.yellow), 1, 26, 10, 0.4, -4.3, 45, 0));
      const lamps: [string, number][] = [["red", 64], ["amber", 56], ["green", 48]];
      const lit: Record<string, string> = { red: "#ff3b2f", amber: "#ffb52e", green: "#3fe06a" };
      for (const [n, y] of lamps) {
        g.add(k.cylX(k.paint(C.dim), 2.8, 1, 4.3, y + 2, 0, 16));
        g.add(named(k.cylX(k.paint(lit[n]), 2.9, 1.2, 4.5, y + 2, 0, 16), `lamp-${n}`));
        g.add(k.box(k.paint(TOY.black), 3, 0.8, 6.4, 0.2, 5.8, y + 5, 0));
      }
      return g;
    },
    animate: (root, t) => {
      const p = t % 8;
      const r = part(root, "lamp-red");
      const a = part(root, "lamp-amber");
      const gr = part(root, "lamp-green");
      if (r) r.visible = p < 4;
      if (a) a.visible = (p >= 3 && p < 4) || (p >= 7);
      if (gr) gr.visible = p >= 4 && p < 7;
    },
  },
  {
    id: "scene-street-lamp",
    name: "Street lamp",
    category: "Town & road",
    tags: ["lamp", "street", "light", "night", "animated"],
    notes: "A fluted dark-green lamp post with a lantern that lights up at dusk. Lines platforms and streets; a night mode could light them all.",
    build: (k) => {
      const g = k.group(k.lathe(k.paint(TOY.green), [[0, 0], [5, 0], [5, 2], [3.4, 4], [2.4, 8], [1.4, 12], [1.4, 50], [0, 50]], 0, 0, 0, 20));
      g.add(k.ring(k.paint(TOY.green), 2, 0.6, 0, 46, 0), k.cyl(k.paint(TOY.green), 2.6, 2, 0, 50, 0, 3.4, 12));
      g.add(k.cyl(k.paint(C.dim), 3.6, 7, 0, 52, 0, 4.4, 4), named(k.cyl(k.paint(C.lamp), 3.7, 7, 0, 52, 0, 4.5, 4), "lit"));
      g.add(k.cone(k.paint(TOY.green), 5.4, 4, 0, 59, 0, 4), k.ball(k.paint(TOY.green), 1.2, 0, 63.5, 0));
      return g;
    },
    animate: (root, t) => {
      const l = part(root, "lit");
      if (l) l.visible = t % 8 > 4;
    },
  },
  {
    id: "scene-bus-stop",
    name: "Bus stop",
    category: "Town & road",
    tags: ["bus", "stop", "shelter", "road", "town"],
    notes: "A glazed shelter with a bench, a roundel sign on a pole and a waiting peg. Where buses meet trains: passengers could change from rail to road here.",
    build: (k) => {
      const g = k.group(k.box(k.paint(TOY.grey), 44, 2, 20, 0.6));
      for (const x of [-18, 18]) g.add(k.box(k.paint(TOY.red), 2.4, 30, 2.4, 0.6, x, 2, -7));
      g.add(k.box(k.glass, 34, 24, 1, 0.3, 0, 6, -7), k.box(k.glass, 1, 24, 10, 0.3, -18, 6, -2));
      g.add(k.box(k.paint(TOY.red), 44, 2.4, 18, 0.8, 0, 32, -1));
      g.add(k.box(k.wood, 26, 1.6, 5, 0.5, 0, 9, -4), k.box(k.paint(TOY.red), 2, 7, 2, 0.4, -10, 2, -4), k.box(k.paint(TOY.red), 2, 7, 2, 0.4, 10, 2, -4));
      g.add(k.cyl(k.paint(TOY.grey), 1.2, 36, 26, 0, 6, 1.2, 8));
      g.add(k.cylX(k.paint(TOY.red), 5.4, 1.2, 26, 38, 6), k.cylX(k.paint(TOY.white), 3.6, 1.4, 26, 38, 6), k.box(k.paint(TOY.blue), 1.6, 2, 12, 0.3, 26, 37, 6));
      g.add(k.peg(TOY.purple, TOY.red, 8, 2, 4));
      return g;
    },
  },
  {
    id: "scene-post-box",
    name: "Post box",
    category: "Town & road",
    tags: ["post", "mail", "letters", "red"],
    notes: "A glossy red pillar box with a domed cap and letter slot. Letters posted here could be collected by a mail van and carried by the night mail train.",
    build: (k) => {
      const g = k.group(k.lathe(k.paint(TOY.red), [[0, 0], [7.4, 0], [7.4, 2], [6.2, 3], [6.2, 22], [7, 23], [7, 25], [6, 27.5], [3.5, 29.5], [0, 30]], 0, 0, 0, 28));
      g.add(k.box(k.paint(TOY.black), 1, 1.2, 6, 0.3, 6.2, 19, 0), k.box(k.paint(TOY.yellow), 0.6, 3, 4, 0.2, 6.2, 12, 0));
      return g;
    },
  },
  {
    id: "scene-phone-box",
    name: "Phone box",
    category: "Town & road",
    tags: ["phone", "telephone", "kiosk", "red"],
    notes: "A tall red kiosk with glazed sides, a domed top and a sign panel. A peg inside could call for a train: a phone box at a halt requests a stop.",
    build: (k) => {
      const g = k.group(k.box(k.paint(TOY.red), 18, 2, 18, 0.6));
      for (const [x, z] of [[-7.5, -7.5], [7.5, -7.5], [-7.5, 7.5], [7.5, 7.5]]) g.add(k.box(k.paint(TOY.red), 3, 36, 3, 0.8, x, 2, z));
      g.add(k.box(k.glass, 13, 30, 13, 0.5, 0, 4, 0));
      for (const r of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
        const bars = new Group();
        for (const y of [12, 20, 28]) bars.add(k.box(k.paint(TOY.red), 1, 1.2, 13, 0.2, 6.8, y, 0));
        bars.add(k.box(k.paint(TOY.red), 1, 30, 1.2, 0.2, 6.8, 4, 0));
        bars.add(k.box(k.paint(TOY.white), 1, 3, 9, 0.2, 8.2, 35, 0));
        bars.rotation.y = r;
        g.add(bars);
      }
      g.add(k.box(k.paint(TOY.red), 19, 3, 19, 1, 0, 38, 0));
      g.add(k.lathe(k.paint(TOY.red), [[9, 0], [8, 2.4], [5, 4], [0, 4.6]], 0, 41, 0, 4));
      return g;
    },
  },
  {
    id: "scene-bench",
    name: "Park bench",
    category: "Town & road",
    tags: ["bench", "park", "seat", "platform"],
    notes: "A slatted beech bench with curled green iron ends. Pegs sit and wait on platforms; a busy bench could mean too few trains.",
    build: (k) => {
      const g = new Group();
      for (const x of [-13, 13]) {
        const end = k.extrude(k.paint(TOY.green), [[-4, 0], [-2.5, 0], [-1, 6], [3, 6], [4, 0], [5, 0], [4.5, 7], [-1.5, 7], [-4.5, 18], [-6, 18]], 1.6, 0, 0, 0, 0.3);
        end.rotation.y = Math.PI / 2;
        end.position.x = x;
        g.add(end);
      }
      for (let i = 0; i < 3; i++) g.add(k.box(k.wood, 32, 1.2, 2.8, 0.4, 0, 7, -3 + i * 3.2));
      for (let i = 0; i < 2; i++) {
        const s = k.box(k.wood, 32, 2.6, 1.2, 0.4, 0, 0, 0);
        s.position.set(0, 11 + i * 4, 4.4 + i * 1.2);
        s.rotation.x = -0.25;
        g.add(s);
      }
      return g;
    },
  },
  {
    id: "scene-fountain",
    name: "Town fountain",
    category: "Town & road",
    tags: ["fountain", "water", "square", "town", "animated"],
    notes: "A turned two-tier fountain with pulsing jets and a ring of spray. The centrepiece of a town square; the town could grow once it's surrounded by houses.",
    build: (k) => {
      const g = new Group();
      g.add(k.lathe(k.paint(TOY.cream), [[0, 0], [30, 0], [30, 8], [27, 8], [26, 3], [0, 3]], 0, 0, 0, 40));
      g.add(k.cyl(k.water, 26.5, 1, 0, 5, 0, 26.5, 40));
      g.add(k.lathe(k.paint(TOY.cream), [[0, 0], [4, 0], [3, 10], [2.4, 18], [3, 20], [12, 22], [13, 25], [11, 25], [3, 23], [0, 23]], 0, 3, 0, 28));
      g.add(k.cyl(k.water, 10.6, 0.6, 0, 27.4, 0, 10.6, 24));
      g.add(k.lathe(k.paint(TOY.cream), [[0, 0], [2, 0], [1.5, 8], [3, 10], [0, 11]], 0, 26, 0, 16));
      g.add(named(k.cone(k.water, 1.8, 10, 0, 36, 0, 12), "jet"));
      const spray = named(new Group(), "spray");
      spray.position.y = 6;
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        spray.add(k.ball(k.water, 1.2, Math.cos(a) * 17, 2, Math.sin(a) * 17));
        const jet = k.cyl(k.water, 0.7, 8, Math.cos(a) * 18, 0, Math.sin(a) * 18, 0.7, 6);
        jet.rotation.set(Math.sin(a) * 0.5, 0, -Math.cos(a) * 0.5);
        spray.add(jet);
      }
      g.add(spray);
      return g;
    },
    animate: (root, t) => {
      const j = part(root, "jet");
      if (j) j.scale.y = 1 + Math.sin(t * 4) * 0.35;
      const s = part(root, "spray");
      if (s) {
        s.rotation.y = t * 0.5;
        s.scale.y = 1 + Math.sin(t * 4 + 1) * 0.2;
      }
    },
  },
  {
    id: "scene-bandstand",
    name: "Bandstand",
    category: "Town & road",
    tags: ["bandstand", "park", "music", "band"],
    notes: "An eight-sided park bandstand with slender posts, railings and a red-and-cream roof, three pegs playing inside. A Sunday concert could draw extra passengers to the park station.",
    build: (k) => {
      const g = new Group();
      g.add(k.cyl(k.paint(TOY.cream), 34, 8, 0, 0, 0, 34, 8), k.cyl(k.wood, 33, 1, 0, 8, 0, 33, 8));
      g.add(k.box(k.paint(TOY.cream), 10, 4, 12, 0.6, 37, 0, 0), k.box(k.paint(TOY.cream), 6, 2, 12, 0.6, 40, 4, 0));
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        g.add(k.cyl(k.paint(TOY.green), 1.2, 38, Math.cos(a) * 30, 9, Math.sin(a) * 30, 1.2, 8));
        if (i !== 0) {
          const m = (a + Math.PI / 8) % (Math.PI * 2);
          const rail = k.box(k.paint(TOY.white), 23, 1.4, 1, 0.3, Math.cos(m) * 27.7, 16, Math.sin(m) * 27.7);
          rail.rotation.y = -m + Math.PI / 2;
          g.add(rail);
        }
      }
      const roof = k.cone(k.paint(TOY.red), 40, 18, 0, 47, 0, 8);
      roof.rotation.y = Math.PI / 8;
      g.add(roof, k.cyl(k.paint(TOY.cream), 39.5, 3, 0, 46, 0, 39.5, 8), k.ball(k.paint(TOY.yellow), 2.5, 0, 66, 0));
      g.add(k.peg(TOY.red, TOY.black, -8, 9, -8), k.peg(TOY.blue, TOY.black, 8, 9, 0), k.peg(TOY.red, TOY.black, -6, 9, 10));
      g.add(k.ring(k.paint(TOY.yellow), 2.5, 0.8, 12, 15, 0, true));
      return g;
    },
  },
  {
    id: "scene-playground",
    name: "Playground",
    category: "Town & road",
    tags: ["playground", "swings", "slide", "seesaw", "park", "animated"],
    notes: "Swings on an A-frame, a slide with ladder and a seesaw, all moving, on a green felt mat. A park stop where families get off; busier at weekends.",
    build: (k) => {
      const g = k.group(k.box(k.felt, 120, 1.2, 70, 0.4));
      const SX = -36;
      for (const z of [-20, 20])
        for (const sd of [-1, 1]) {
          const leg = k.cyl(k.paint(TOY.blue), 1.4, 44, 0, 0, 0, 1.4, 8);
          leg.position.set(SX + sd * 6, 22.5, z);
          leg.rotation.z = sd * 0.28;
          g.add(leg);
        }
      g.add(k.cylZ(k.paint(TOY.blue), 1.6, 44, SX, 44, 0, 10));
      [-9, 9].forEach((z, i) => {
        const pivot = named(new Group(), `swing${i}`);
        pivot.position.set(SX, 44, z);
        pivot.add(k.cyl(k.metal, 0.4, 32, 0, -32, -4, 0.4, 4), k.cyl(k.metal, 0.4, 32, 0, -32, 4, 0.4, 4));
        pivot.add(k.box(k.paint(TOY.red), 6, 1.6, 11, 0.6, 0, -33, 0));
        g.add(pivot);
      });
      const slide = new Group();
      for (const z of [-6, 6]) slide.add(k.box(k.paint(TOY.yellow), 2, 30, 2, 0.4, 0, 0, z));
      for (let i = 0; i < 5; i++) slide.add(k.box(k.paint(TOY.yellow), 2, 1.2, 12, 0.3, -2, 5 + i * 5.5, 0));
      slide.add(k.box(k.paint(TOY.yellow), 10, 1.6, 14, 0.4, 4, 29, 0));
      for (const [z, w, h, y] of [[0, 10, 1.6, 15], [-5, 1, 3, 16.4], [5, 1, 3, 16.4]]) {
        const p = k.box(k.paint(TOY.red), 44, h, w, 0.4, 0, 0, 0);
        p.position.set(26, y, z);
        p.rotation.z = -0.62;
        slide.add(p);
      }
      g.add(k.at(slide, -6, 1.2, -18));
      g.add(k.group(k.extrude(k.paint(TOY.green), [[-4, 0], [4, 0], [1.5, 7], [-1.5, 7]], 4, 30, 1.2, 22, 0.4)));
      const see = named(new Group(), "seesaw");
      see.position.set(30, 9, 22);
      see.add(k.box(k.paint(TOY.orange), 44, 2, 6, 0.8, 0, 0, 0));
      for (const x of [-19, 19]) see.add(k.cylZ(k.paint(TOY.black), 1, 8, x, 5, 0, 8));
      see.add(k.peg(TOY.blue, null, -17, 2, 0), k.peg(TOY.pink, null, 17, 2, 0));
      g.add(see);
      return g;
    },
    animate: (root, t) => {
      const s0 = part(root, "swing0");
      const s1 = part(root, "swing1");
      if (s0) s0.rotation.z = Math.sin(t * 2.2) * 0.5;
      if (s1) s1.rotation.z = Math.sin(t * 2.2 + 1.8) * 0.4;
      const ss = part(root, "seesaw");
      if (ss) ss.rotation.z = Math.sin(t * 1.6) * 0.16;
    },
  },
  {
    id: "scene-park-gate",
    name: "Park gates",
    category: "Town & road",
    tags: ["park", "gate", "entrance", "railings"],
    notes: "Two brick pillars topped with balls and an arched sign over open green iron gates, with railings either side. The way into the park; a park needs one to attract visitors.",
    build: (k) => {
      const g = new Group();
      for (const z of [-22, 22]) {
        g.add(k.box(k.paint(C.brick), 10, 40, 10, 1.2, 0, 0, z), k.box(k.paint(TOY.cream), 12, 3, 12, 0.8, 0, 40, z), k.ball(k.paint(TOY.cream), 4, 0, 47, z));
      }
      const arch = k.ring(k.paint(TOY.green), 17, 1, 0, 40, 0, true, Math.PI);
      arch.rotation.y = Math.PI / 2;
      g.add(arch, k.box(k.paint(TOY.cream), 1.6, 6, 18, 0.5, 0, 46, 0));
      for (const s of [-1, 1]) {
        const leaf = new Group();
        for (let i = 0; i < 7; i++) leaf.add(k.cyl(k.paint(TOY.green), 0.6, 28, 0, 2, 2 + i * 2.6, 0.6, 6));
        leaf.add(k.box(k.paint(TOY.green), 1.2, 1.4, 17, 0.2, 0, 6, 9), k.box(k.paint(TOY.green), 1.2, 1.4, 17, 0.2, 0, 26, 9));
        leaf.position.set(0, 0, s * 17);
        leaf.rotation.y = s > 0 ? Math.PI - 1.1 : 1.1;
        g.add(leaf);
      }
      for (const s of [-1, 1]) {
        for (let i = 0; i < 6; i++) g.add(k.cyl(k.paint(TOY.green), 0.6, 20, 0, 0, s * (30 + i * 4), 0.6, 6), k.cone(k.paint(TOY.green), 1, 2.4, 0, 20, s * (30 + i * 4), 6));
        g.add(k.box(k.paint(TOY.green), 1.2, 1.4, 24, 0.2, 0, 16, s * 39));
      }
      return g;
    },
  },
  {
    id: "scene-statue",
    name: "Town statue",
    category: "Town & road",
    tags: ["statue", "monument", "square", "plinth"],
    notes: "A bronze-green figure with a raised arm on a stepped stone plinth, a pigeon on its head. A landmark for a town square; unveiling one could be a reward for a busy town.",
    build: (k) => {
      const g = new Group();
      g.add(k.box(k.paint(C.stone), 28, 4, 28, 1), k.box(k.paint(TOY.cream), 20, 4, 20, 1, 0, 4, 0), k.box(k.paint(C.stone), 14, 18, 14, 1.2, 0, 8, 0), k.box(k.paint(TOY.cream), 17, 3, 17, 1, 0, 26, 0));
      g.add(k.box(k.paint(TOY.yellow), 0.6, 4, 9, 0.2, 7, 14, 0));
      const b = k.paint(C.bronze);
      g.add(k.cyl(b, 6, 20, 0, 29, 0, 4.6, 16), k.ball(b, 4.6, 0, 54, 0));
      const arm = k.capsule(b, 1.8, 13, 0, 0, 0);
      arm.position.set(0, 52, 6);
      arm.rotation.x = 0.35;
      g.add(arm, k.capsule(b, 1.8, 9, 0, 38, -6.2));
      g.add(k.ball(k.paint(TOY.grey), 1.8, 0, 60, 0, 0.9), k.ball(k.paint(TOY.grey), 1.1, 1.6, 61.4, 0));
      return g;
    },
  },
  {
    id: "scene-clock-post",
    name: "Clock post",
    category: "Town & road",
    tags: ["clock", "time", "station", "street", "animated"],
    notes: "A tall black post with a two-faced clock whose hands go round. A timetable mode could use it: trains due on the hour, pegs hurry when it's nearly time.",
    build: (k) => {
      const g = k.group(k.lathe(k.paint(TOY.black), [[0, 0], [6, 0], [6, 3], [3, 6], [2, 10], [2, 50], [0, 50]], 0, 0, 0, 20));
      g.add(k.cylX(k.paint(TOY.black), 10, 6, 0, 60, 0, 32), k.cylX(k.paint(TOY.cream), 8.6, 6.4, 0, 60, 0, 32));
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2;
        for (const s of [-1, 1]) g.add(k.box(k.paint(TOY.black), 0.4, i % 3 ? 0.8 : 1.6, 0.8, 0, s * 3.3, 60 + Math.cos(a) * 7, Math.sin(a) * 7));
      }
      for (const s of [-1, 1]) {
        const hour = named(new Group(), `hour${s > 0 ? "a" : "b"}`);
        hour.position.set(s * 3.5, 60, 0);
        hour.add(k.box(k.paint(TOY.black), 0.4, 4.5, 1.2, 0.2, 0, 0, 0));
        const min = named(new Group(), `min${s > 0 ? "a" : "b"}`);
        min.position.set(s * 3.7, 60, 0);
        min.add(k.box(k.paint(TOY.red), 0.4, 6.8, 0.8, 0.2, 0, 0, 0));
        g.add(hour, min);
      }
      g.add(k.ball(k.paint(TOY.yellow), 2, 0, 71.5, 0));
      return g;
    },
    animate: (root, t) => {
      for (const h of partsOf(root, "hour")) h.rotation.x = -t * 0.25;
      for (const m of partsOf(root, "min")) m.rotation.x = -t * 3;
    },
  },
  {
    id: "scene-signpost",
    name: "Fingerpost",
    category: "Town & road",
    tags: ["signpost", "direction", "road", "sign"],
    notes: "A white fingerpost with arrows pointing off in three directions and a round cap. Arrows could name the player's own stations, pointing the way along the line.",
    build: (k) => {
      const g = k.group(base(k, 6, k.paint(TOY.grey)), k.cyl(k.paint(TOY.white), 1.8, 48, 0, 3, 0, 1.8, 12), k.ball(k.paint(TOY.red), 2.6, 0, 51.5, 0));
      const arrow: [number, number][] = [[0, -2.8], [16, -2.8], [20, 0], [16, 2.8], [0, 2.8]];
      [[0, 44, TOY.white], [2.2, 38, TOY.white], [4.1, 32, TOY.yellow]].forEach(([r, y, c]) => {
        const a = k.extrude(k.paint(c as string), arrow, 1.6, 0, y as number, 0, 0.3);
        a.rotation.y = r as number;
        g.add(a);
        const band = k.extrude(k.paint(TOY.black), [[3, -0.6], [14, -0.6], [14, 0.6], [3, 0.6]], 1.9, 0, y as number, 0, 0.1);
        band.rotation.y = r as number;
        g.add(band);
      });
      return g;
    },
  },
  {
    id: "scene-market-stall",
    name: "Market umbrella stall",
    trayLabel: "Umbrella stall",
    category: "Town & road",
    tags: ["market", "stall", "umbrella", "fruit", "town"],
    notes: "A trestle table of fruit and veg crates under a big striped umbrella, a stallholder peg behind. Market day could need fresh produce brought in by goods train.",
    build: (k) => {
      const g = new Group();
      for (const x of [-14, 14]) for (const z of [-7, 7]) g.add(k.box(k.wood, 2, 14, 2, 0.4, x, 0, z));
      g.add(k.box(k.wood, 34, 2, 18, 0.6, 0, 14, 0));
      const crate = (x: number, c: string) => {
        g.add(k.box(k.wood, 9, 4, 12, 0.6, x, 16, 0));
        for (let i = 0; i < 6; i++) g.add(k.ball(k.paint(c), 1.8, x - 2.2 + (i % 2) * 4.4, 20.4, -4 + Math.floor(i / 2) * 4));
      };
      crate(-10, TOY.red);
      crate(0, TOY.orange);
      crate(10, C.lime);
      g.add(k.cyl(k.wood, 1, 46, 0, 0, -12, 1, 8));
      const brolly = k.group(k.cone(k.paint(TOY.green), 26, 9, 0, 0, 0, 8));
      brolly.add(k.cone(k.paint(TOY.white), 18, 6.3, 0, 2.7, 0, 8), k.cone(k.paint(TOY.green), 9, 3.2, 0, 5.8, 0, 8), k.ball(k.wood, 1.6, 0, 9.4, 0));
      g.add(k.at(brolly, 0, 40, -12));
      g.add(k.peg(TOY.teal, TOY.white, 0, 0, -16));
      return g;
    },
  },
  {
    id: "scene-bins-bollards",
    name: "Bins and bollards",
    category: "Town & road",
    tags: ["bin", "bollard", "street", "rubbish"],
    notes: "A litter bin, a wheelie bin and a row of striped bollards: small street clutter. A recycling train could collect from bins around town.",
    build: (k) => {
      const g = new Group();
      g.add(k.lathe(k.paint(TOY.green), [[0, 0], [5, 0], [6, 14], [6.4, 15], [0, 15]], -18, 0, 0, 20), k.cyl(k.paint(TOY.black), 3, 0.4, -18, 15, 0, 3, 16));
      g.add(k.box(k.paint(TOY.blue), 12, 18, 12, 1.5, -2, 0, 0), k.box(k.paint(TOY.blue), 13, 1.6, 13, 0.6, -2, 18, 0.4));
      g.add(k.cylZ(k.paint(TOY.black), 2.4, 13, -8, 2.4, 0, 12));
      for (let i = 0; i < 3; i++) {
        const x = 12 + i * 8;
        g.add(k.capsule(k.paint(TOY.white), 2.4, 12, x, 0, 0), k.cyl(k.paint(TOY.red), 2.5, 2, x, 9, 0, 2.5, 16), k.cyl(k.paint(TOY.red), 2.5, 2, x, 4, 0, 2.5, 16));
      }
      return g;
    },
  },
  {
    id: "scene-flagpole",
    name: "Flagpole",
    category: "Town & road",
    tags: ["flag", "pole", "wind", "animated"],
    notes: "A tall white pole with a flag that ripples in the wind. Flags show wind direction for the windmill; a flag over a station could show it's open.",
    build: (k) => {
      const g = k.group(base(k, 9, k.paint(TOY.grey)), k.cyl(k.paint(TOY.white), 1.3, 80, 0, 3, 0, 0.9, 12), k.ball(k.paint(TOY.yellow), 2, 0, 84, 0));
      let parent: Object3D = g;
      const seg = 6;
      const start = new Group();
      start.position.set(1, 66, 0);
      g.add(start);
      parent = start;
      for (let i = 0; i < 6; i++) {
        const s = named(new Group(), `flag${i}`);
        if (i > 0) s.position.x = seg;
        s.add(k.box(k.paint(i < 2 ? TOY.blue : i < 4 ? TOY.white : TOY.red), seg, 16, 0.8, 0, seg / 2, 0, 0));
        parent.add(s);
        parent = s;
      }
      return g;
    },
    animate: (root, t) => {
      const fs = partsOf(root, "flag");
      for (let i = 0; i < fs.length; i++) fs[i].rotation.y = Math.sin(t * 4 - i * 0.9) * (0.12 + i * 0.03);
    },
  },
  {
    id: "scene-bunting",
    name: "Bunting",
    category: "Town & road",
    tags: ["bunting", "flags", "fete", "party", "animated"],
    notes: "A line of coloured pennants strung between two poles, fluttering. Strung across a platform for a gala day; a festival event could bring extra passengers.",
    build: (k) => {
      const g = new Group();
      for (const x of [-40, 40]) g.add(k.at(base(k, 6, k.paint(TOY.grey)), x), k.cyl(k.wood, 1.3, 50, x, 0, 0, 1.1, 8), k.ball(k.paint(TOY.red), 2, x, 51, 0));
      const cols = [TOY.red, TOY.yellow, TOY.blue, TOY.leaf, TOY.pink, TOY.orange];
      const n = 11;
      for (let i = 0; i < n; i++) {
        const x = -35 + (70 / (n - 1)) * i;
        const sag = 46 - 6 * (1 - ((x / 40) * (x / 40)));
        const p = named(new Group(), `pennant${i}`);
        p.position.set(x, sag, 0);
        const tri = k.extrude(k.paint(cols[i % cols.length]), [[-3, 0], [3, 0], [0, -8]], 0.8, 0, 0, 0, 0.2);
        p.add(tri);
        g.add(p);
      }
      for (let i = 0; i < 8; i++) {
        const x0 = -40 + i * 10;
        const x1 = x0 + 10;
        const y0 = 46 - 6 * (1 - (x0 / 40) ** 2);
        const y1 = 46 - 6 * (1 - (x1 / 40) ** 2);
        const s = k.cylX(k.paint(TOY.white), 0.35, Math.hypot(10, y1 - y0), (x0 + x1) / 2, (y0 + y1) / 2, 0, 4);
        s.rotation.z = Math.atan2(y1 - y0, 10);
        g.add(s);
      }
      return g;
    },
    animate: (root, t) => {
      const ps = partsOf(root, "pennant");
      for (let i = 0; i < ps.length; i++) ps[i].rotation.x = Math.sin(t * 3 + i * 0.7) * 0.35;
    },
  },
  {
    id: "scene-christmas-tree",
    name: "Christmas tree",
    category: "Town & road",
    tags: ["christmas", "tree", "star", "winter", "lights", "animated"],
    notes: "A tiered fir in a red tub with baubles, twinkling lights and a turning gold star. A town square in winter; lighting it could be a seasonal event that draws crowds.",
    build: (k) => {
      const g = k.group(k.cyl(k.paint(TOY.red), 9, 10, 0, 0, 0, 11, 20), k.cyl(k.paint(TOY.yellow), 11.2, 1.4, 0, 8, 0, 11.2, 20), trunk(k, 2.6, 6, 10));
      const tiers: [number, number, number][] = [[22, 26, 14], [17, 22, 30], [12, 18, 44]];
      for (const [r, h, y] of tiers) g.add(k.cone(k.paint(TOY.green), r, h, 0, y, 0, 24));
      const baubles: [number, number, number, string][] = [
        [16, 20, 0, TOY.red], [-12, 18, 10, TOY.blue], [4, 18, -16, TOY.yellow], [-6, 34, -9, TOY.red], [11, 35, 4, TOY.purple], [-4, 50, 6, TOY.blue], [6, 48, -5, TOY.red],
      ];
      for (const [x, y, z, c] of baubles) g.add(k.ball(k.paint(c), 2.2, x, y, z));
      const lights: [number, number, number][] = [[-15, 22, -6], [8, 26, 12], [12, 22, -12], [-10, 38, 5], [3, 40, 10], [0, 54, -6], [-12, 26, 12], [8, 42, -7]];
      lights.forEach(([x, y, z], i) => g.add(named(k.ball(k.paint(C.lamp), 1.2, x, y, z), `twinkle${i}`)));
      const star = named(new Group(), "star");
      star.position.y = 66;
      const pts: [number, number][] = [];
      for (let i = 0; i < 10; i++) {
        const a = Math.PI / 2 + (i / 10) * Math.PI * 2;
        const r = i % 2 ? 2.8 : 6.5;
        pts.push([Math.cos(a) * r, Math.sin(a) * r]);
      }
      star.add(k.extrude(k.paint(TOY.yellow), pts, 2.4, 0, 0, 0, 0.5));
      g.add(star);
      return g;
    },
    animate: (root, t) => {
      const s = part(root, "star");
      if (s) s.rotation.y = t * 1.2;
      const ls = partsOf(root, "twinkle");
      const step = Math.floor(t * 3);
      for (let i = 0; i < ls.length; i++) ls[i].visible = (i * 7 + step) % 3 !== 0;
    },
  },
  {
    id: "scene-car-park",
    name: "Car park",
    category: "Town & road",
    tags: ["parking", "car park", "barrier", "road", "animated"],
    notes: "A felt car park with marked bays, a pay booth and a lifting barrier, two toy cars parked. Park-and-ride: commuters drive in and take the train into town.",
    build: (k) => {
      const g = k.group(k.box(k.wood, 120, 5, 80, 2), k.box(k.road, 116, 1, 76, 0, 0, 5, 0));
      for (let i = 0; i < 6; i++) {
        const x = -40 + i * 16;
        g.add(k.box(k.paint(TOY.white), 1.2, 0.4, 24, 0, x, 6, -26), k.box(k.paint(TOY.white), 1.2, 0.4, 24, 0, x, 6, 26));
      }
      g.add(k.box(k.paint(TOY.white), 1.6, 0.4, 2, 0, 52, 6, 0));
      g.add(k.box(k.paint(TOY.blue), 10, 0.4, 10, 0, 44, 6, -26), k.box(k.paint(TOY.white), 1.2, 0.5, 6, 0, 44, 6.1, -26), k.box(k.paint(TOY.white), 4, 0.5, 1.2, 0, 44.6, 6.1, -26.5));
      const car = (x: number, z: number, c: string) => {
        const m = k.group(k.box(k.paint(c), 12, 6, 20, 2.5, 0, 3, 0), k.box(k.paint(c), 10, 5, 11, 2, 0, 9, -1), k.box(k.glass, 10.4, 3.4, 11.2, 1, 0, 9.8, -1));
        for (const dx of [-6, 6]) for (const dz of [-6, 6]) m.add(k.cylX(k.paint(TOY.black), 3, 2, dx, 3, dz, 14));
        return k.at(m, x, 5, z);
      };
      g.add(car(-32, -26, TOY.red), car(-16, 26, TOY.yellow), car(16, -26, TOY.teal));
      g.add(k.box(k.paint(TOY.white), 10, 16, 10, 1.5, 50, 6, 30), k.box(k.paint(TOY.red), 12, 2, 12, 0.8, 50, 22, 30), k.box(k.glass, 0.8, 6, 6, 0.2, 45, 13, 30));
      g.add(k.box(k.paint(TOY.white), 4, 12, 4, 0.8, 54, 6, -14));
      const barrier = named(new Group(), "barrier");
      barrier.position.set(54, 15, -14);
      for (let i = 0; i < 6; i++) barrier.add(k.box(k.paint(i % 2 ? TOY.red : TOY.white), 5, 2, 1.6, 0.4, 0, 0, 2.5 + i * 5));
      g.add(barrier);
      return g;
    },
    animate: (root, t) => {
      const b = part(root, "barrier");
      if (b) b.rotation.x = -(0.5 - 0.5 * Math.cos(t * 1.2)) * 1.4;
    },
  },
];

export const ASSETS: Asset[] = [...scenery, ...town];

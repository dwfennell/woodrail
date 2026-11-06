import { Group, type Object3D } from "three";
import { TOY, type Kit } from "../kit";

/**
 * The game's circus cage wagon (the `cage` car kind, Game mode's Circus train: late-game spec K1), after the
 * catalogue's train-circus-cage, cut to the van's length: red, barred in yellow, a lion inside (standing still: the
 * game draws no motion of its own for it). A code model (no Blender one), small and self-contained as the car carrier is.
 */

/** Its length, buffer to buffer, couplers left out (mm): the van's. */
export const CIRCUS_CAGE_LENGTH = 84;

/** Its bogies' node (its four wheels, each turning about z). */
export const CIRCUS_CAGE_BOGIES = "bogies";

/** The wagon, facing +x, centred, standing on y = 0 (its wheels' feet), with its bogies and couplers. */
export function buildCircusCage(k: Kit): Group {
  const len = CIRCUS_CAGE_LENGTH;
  const bogies = k.bogies(len, 18, TOY.yellow);
  bogies.name = CIRCUS_CAGE_BOGIES;
  const g = k.group(bogies, k.coupler(len, 1), k.coupler(len, -1));
  const red = k.paint(TOY.red);
  const yellow = k.paint(TOY.yellow);
  const deck = 15;
  g.add(k.box(k.wood, len - 4, 5, 30, 1.5, 0, 10, 0));
  g.add(k.box(red, len - 4, 3, 32, 1, 0, deck, 0));
  const half = len / 2 - 4;
  for (const x of [-half, half]) for (const z of [-14, 14]) g.add(k.box(red, 4, 26, 4, 1, x, deck + 3, z));
  for (let i = 1; i < 11; i++) for (const z of [-14.5, 14.5]) g.add(k.cyl(yellow, 0.9, 26, -half + (i * 2 * half) / 11, deck + 3, z, 0.9, 8));
  for (let i = 1; i < 5; i++) for (const x of [-half - 0.5, half + 0.5]) g.add(k.cyl(yellow, 0.9, 26, x, deck + 3, -14 + (i * 28) / 5, 0.9, 8));
  g.add(k.box(red, len - 2, 4, 36, 1.5, 0, deck + 29, 0));
  g.add(k.box(yellow, len, 1.6, 37, 0.5, 0, deck + 33, 0));
  for (let i = 0; i < 8; i++) for (const z of [-18, 18]) g.add(k.ball(yellow, 1.8, -35 + i * 10, deck + 28.5, z));
  // The lion, pacing (still) in the middle.
  const lion = new Group();
  lion.name = "lion";
  lion.position.set(4, deck + 3, 0);
  const fur = k.paint(TOY.yellow);
  const mane = k.paint(TOY.orange);
  const body = k.ball(fur, 6, 0, 9, 0);
  body.scale.x = 1.6;
  lion.add(body);
  for (const x of [-5.5, 5.5]) for (const z of [-3.2, 3.2]) lion.add(k.cyl(fur, 1.7, 5, x, 0, z, 1.7, 10));
  lion.add(k.ball(mane, 5.5, 10, 14, 0), k.ball(fur, 3.6, 13, 14, 0), k.ball(k.paint(TOY.black), 1, 16.4, 14, 0));
  g.add(lion);
  return g;
}

/** The bogies' node (to turn its wheels). */
export function circusCageBogies(root: Object3D): Object3D {
  return root.getObjectByName(CIRCUS_CAGE_BOGIES)!;
}

import { Group, type Object3D } from "three";
import { TOY, type Kit } from "../kit";
import { buffers, endRails } from "./wagon-parts";

/**
 * The game's milk tank wagon (the `tanker` car kind, Game mode's Dairy farm): a white barrel with blue bands, a dome
 * on top with a ladder and walkway to it, an outlet each side, buffers and end rails, and two churns on its end platform, in the catalogue's train-milk-tanker colours. A code model (no Blender
 * one), small and self-contained so the game's car code doesn't pull in the whole catalogue (as the track cleaner).
 */

/** Its length, buffer to buffer, couplers left out (mm): the van's. */
export const MILK_TANKER_LENGTH = 84;

/** Its bogies' node (its four wheels, each turning about z). */
export const MILK_TANKER_BOGIES = "bogies";

/** The wagon, facing +x, centred, standing on y = 0 (its wheels' feet), with its bogies and couplers. */
export function buildMilkTanker(k: Kit): Group {
  const len = MILK_TANKER_LENGTH;
  const bogies = k.bogies(len);
  bogies.name = MILK_TANKER_BOGIES;
  const g = k.group(bogies, k.coupler(len, 1), k.coupler(len, -1));
  const deck = 12;
  // The chassis, a beech deck.
  g.add(k.box(k.wood, len - 4, 5, 30, 1.5, 0, deck, 0));
  const blue = k.paint(TOY.blue);
  const white = k.paint(TOY.white);
  const r = 12;
  const barrel = len - 26;
  const y = deck + 3 + r;
  // Cradles under the barrel, then the barrel with rounded ends.
  for (const x of [-barrel / 3, barrel / 3]) g.add(k.box(blue, 6, 6, 26, 1, x, deck + 3, 0));
  g.add(k.cylX(white, r, barrel, 0, y, 0));
  for (const s of [-1, 1]) {
    const cap = k.ball(white, r, (s * barrel) / 2, y, 0);
    cap.scale.x = 0.45;
    g.add(cap);
  }
  // Blue bands round it, and a dome with a lid on top.
  for (const x of [-barrel / 3, barrel / 3]) g.add(k.cylX(blue, r + 0.4, 2, x, y, 0));
  g.add(k.cyl(blue, 4.5, 4, 0, y + r - 1, 0, 4.5, 20));
  g.add(k.cyl(blue, 5.2, 1.4, 0, y + r + 3, 0, 5.2, 20));
  // A ladder up one side to the dome, and a walkway along the top beside it.
  const grey = k.paint(TOY.grey);
  for (const x of [-12, -8]) g.add(k.box(grey, 0.9, 23, 0.9, 0, x, deck + 3, 13));
  for (let i = 0; i < 5; i++) g.add(k.box(grey, 4, 0.8, 0.8, 0, -10, deck + 6 + i * 4, 13));
  g.add(k.box(k.wood, barrel * 0.5, 1.2, 5, 0.4, -barrel / 8 - 6, y + r - 0.5, 4.5));
  // An outlet on each side at the barrel's foot, a red wheel on it.
  for (const s of [-1, 1]) {
    g.add(k.cylZ(k.metal, 1.4, 4, 10, deck + 6.5, s * 12.5, 10));
    g.add(k.cylZ(k.paint(TOY.red), 2.4, 0.8, 10, deck + 6.5, s * 14.8, 12));
  }
  // Buffers, and a rail round the churns' platform.
  g.add(buffers(k, len, 1, deck + 2.5), buffers(k, len, -1, deck + 2.5));
  g.add(endRails(k, -len / 2 + 2.6, deck + 5, 9, 13.6), endRails(k, len / 2 - 2.6, deck + 5, 9, 13.6));
  g.add(k.box(k.metal, 0.8, 0.8, 28, 0, -len / 2 + 2.6, deck + 13.6, 0), k.box(k.metal, 0.8, 0.8, 28, 0, len / 2 - 2.6, deck + 13.6, 0));
  // Two churns on the end platform.
  for (const z of [-7, 7]) g.add(k.lathe(k.paint(TOY.grey), [[3.2, 0], [3.4, 6], [2, 8.5], [2.2, 10.5], [0, 10.5]], -len / 2 + 5, deck + 2.5, z, 16));
  return g;
}

/** Its bogies (its four wheels). */
export function milkTankerBogies(root: Object3D): Object3D {
  return root.getObjectByName(MILK_TANKER_BOGIES)!;
}

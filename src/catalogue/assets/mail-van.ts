import { Group, type Object3D } from "three";
import { TOY, type Kit } from "../kit";

/**
 * The game's mail van (the `mailvan` car kind, Game mode's Post office blueprint): a red sorting van with a black roof,
 * a yellow letter slot and a post horn on each side, after the catalogue's train-mail-van. A code model (no Blender
 * one), small and self-contained as the cold van is.
 */

/** Its length, buffer to buffer, couplers left out (mm): the van's. */
export const MAIL_VAN_LENGTH = 84;

/** Its bogies' node (its four wheels, each turning about z). */
export const MAIL_VAN_BOGIES = "bogies";

/** The van, facing +x, centred, standing on y = 0 (its wheels' feet), with its bogies and couplers. */
export function buildMailVan(k: Kit): Group {
  const len = MAIL_VAN_LENGTH;
  const bogies = k.bogies(len);
  bogies.name = MAIL_VAN_BOGIES;
  const g = k.group(bogies, k.coupler(len, 1), k.coupler(len, -1));
  const deck = 12;
  const h = 26;
  const red = k.paint(TOY.red);
  const black = k.paint(TOY.black);
  const yellow = k.paint(TOY.yellow);
  // The chassis, a beech deck; the red body and a black roof.
  g.add(k.box(k.wood, len - 4, 5, 30, 1.5, 0, deck, 0));
  g.add(k.box(red, len - 12, h, 30, 2.5, 0, deck + 4, 0));
  g.add(k.box(black, len - 8, 3.5, 34, 1.6, 0, deck + 4 + h, 0));
  for (const z of [-15.3, 15.3]) {
    // A yellow letter slot toward one end, and a yellow post horn toward the other.
    g.add(k.box(yellow, 14, 4, 0.8, 0.3, -22, deck + 18, z));
    g.add(k.box(k.cut, 10, 1.4, 1, 0.2, -22, deck + 19.3, z + Math.sign(z) * 0.2));
    g.add(k.ring(yellow, 3.4, 0.8, 20, deck + 16, z, true, Math.PI * 1.5));
    g.add(k.cone(yellow, 1.8, 4, 23.4, deck + 13.5, z));
  }
  return g;
}

/** Its bogies (its four wheels). */
export function mailVanBogies(root: Object3D): Object3D {
  return root.getObjectByName(MAIL_VAN_BOGIES)!;
}
